---
title: Security
description: The trust model of a Shipwick installation, how to expose the API safely, what Shipwick does to protect the server, what it does not do yet, and how to report a vulnerability.
---

# Security

The agent holds the Docker socket, which makes it root on the server it runs on. This page describes the trust model that follows from that, how to expose the API safely, what Shipwick does and does not do, and how to report a vulnerability.

## Trust model

**The Docker socket is root.** The agent needs `/var/run/docker.sock`, and anyone who controls the Docker daemon controls the host: they can start a container that mounts `/`. Consequently:

- **An `admin` token is equivalent to root SSH access to the server.** Treat it so. The token the installer prints is one.
- **Shipwick is not a multi-tenant sandbox.** Whoever can submit a `deploy.yaml` to the agent, which any `deploy` token can, can run arbitrary images on the server, with any command, as any user inside the container.
- **Roles limit what a token may ask the API for, not what the server trusts.** `read` sees everything, environment values masked; `deploy` changes what runs; `admin` also deletes applications, manages tokens and downloads or restores volumes. A role applies to the whole server, not to one application.
- The same holds for anyone with access to the Docker socket, the agent's data directory or Caddy's admin socket.

The agent container runs as root because it needs the Docker socket, which already is root-equivalent access to the host.

## Exposing the API

The API speaks plain HTTP and binds to `127.0.0.1:9000` by default. There are three ways to reach it from elsewhere:

| Method | How |
|---|---|
| HTTPS through Caddy | Set `SHIPWICK_AGENT_DOMAIN`. The API is served at that hostname with an automatically obtained certificate. |
| SSH tunnel | Keep the API on the server's loopback and run `ssh -L 9000:127.0.0.1:9000 user@server`. See [Reach the API without a hostname](/docs/tasks/access-without-a-hostname). |
| Private network | WireGuard, Tailscale or similar. |

::: warning Never expose port 9000 directly to the internet
The token would cross the network in clear text, and an admin token is root on the server. The production compose file publishes no port for the agent on purpose.
:::

On the server, open ports 80 and 443 and nothing else, plus whatever `publish` deliberately binds; see [Unprivileged containers](#unprivileged-containers) for why the firewall alone does not decide that.

**Caddy's admin API is as sensitive as the agent's.** Whoever reaches it controls all routing and the certificate store. Shipwick talks to it over a unix socket in a volume shared by the agent and Caddy only. Do not move it to a TCP port on the application network: every application container could then reconfigure the proxy.

**The dashboard** should be served over HTTPS too, which `SHIPWICK_DASHBOARD_DOMAIN` does. Signing in sends the token to the dashboard's server; over plain HTTP on anything but loopback that is a root credential in clear text.

## What Shipwick does

### Tokens and roles

Every request carries a bearer token, every token has a role, and every endpoint is registered with the role it requires: `read` < `deploy` < `admin`, each including the ones before it. One middleware decides. A wrong or revoked token is `401 UNAUTHORIZED`; a valid token whose role does not cover the endpoint is `403 FORBIDDEN`, and the answer says which role it has and which the endpoint wants.

- **The root token** is the one the agent is configured with: `SHIPWICK_AGENT_TOKEN`, or the one generated on first start. It is `admin`, named `root`, and it is not in the database. The agent keeps only its SHA-256 hash, in memory and in `agent-token.sha256` next to the database, so a lost or corrupt database can never lock the operator out. It cannot be revoked through the API. Rotating it means setting a new `SHIPWICK_AGENT_TOKEN` and restarting the agent.
- **Every other token** is created with `shipwick token create <name> --role read|deploy|admin` and stored as its name, role and the SHA-256 of its value. The value is shown once, in the response that creates it, and nowhere else; the agent cannot show it again. `shipwick token revoke` ends it, and requests with it are `401` from then on.
- **Token values** are 32 random bytes in unpadded base64url behind the prefix `swk_`. The prefix carries no entropy; it is there so that a token is recognisable in the places it must never be, a log line or a commit, and so that a leak scanner can grep for it.
- **Comparison is constant-time.** The presented token is hashed once; the root hash is compared in constant time, and a stored token is looked up by its hash, one indexed query, and then compared in constant time as well, so the database's own comparison cannot be turned into a timing oracle.
- **Who did what is recorded.** Each deployment stores the token that started it (`by`), and a stop or start by a token other than root names it in the application's events. `last_used_at` on a token is written at most once a minute: it says whether a token is still in use, not what it did last.
- A configured root token must be at least 16 characters. The agent refuses to start with a shorter one.
- If the agent generates its token, it prints it once, directly to standard output and not through the logger, and it cannot be recovered afterwards. Under Docker, "printed" means it is in the container's log (`docker logs`) for as long as that container exists. The installer avoids this by generating the token itself and passing it in. Do the same when setting things up by hand.
- The installer writes the token to `/opt/shipwick/.env` with mode `0600`, in a directory with mode `0700`, and never rewrites an existing `.env`.

Give CI a `deploy` token and people `admin` ones. See [Create tokens for CI and teammates](/docs/tasks/tokens).

### Secrets at rest

The `env` values of every deployment are encrypted before they are written to the database, and nothing else is. Names, images, hostnames and the variable names stay in clear, so the file remains debuggable; only the values are ciphertext.

- **The scheme** is AES-256-GCM with a fresh 12-byte random nonce per value and the variable name as additional authenticated data. Binding the name means a ciphertext cut from `DB_PASSWORD` and pasted into `DEBUG_ECHO` does not decrypt: a tampered database cannot make the agent hand a secret to a different variable. The stored form is `enc1:` followed by base64 of nonce and ciphertext; the prefix versions the scheme and marks the value as encrypted.
- **The key** is 32 bytes, from `SHIPWICK_ENCRYPTION_KEY` (64 hex characters) or, by default, `encryption.key` in the data directory, created with mode `0600` on the agent's first start. It lives next to the database rather than in it, so a copy of the database alone is useless. Opening the database proves the key against every stored value, so a key that does not match is caught at start, not at the first deployment, and the agent refuses to start with a message that says so.
- **What it protects**: a copy of the database file without the key. A backup, a snapshot, a disk that left the building, a file opened with `sqlite3` by whoever debugs it.
- **What it does not protect against**: root on the server, who can read the key file and the agent's memory; and the values inside running containers, which `docker inspect` shows to anyone with the Docker socket. An `env` value has to be in clear inside the container for the application to use it.
- **Upgrading**: a database written by a release before encryption is recognised by the missing prefix, and its values are encrypted in place, in one transaction, on the first start after the upgrade.
- **Rotating the key is not supported yet.**

::: warning Back up encryption.key together with shipwick.db
Without the key the database cannot be read, and the agent refuses to start against it. The agent says so in its log when it creates the key. A backup of the data directory that leaves the key out is a backup of nothing.
:::

### Nothing secret in logs or responses

- Tokens, `Authorization` headers, request bodies and environment values are never logged. The request log holds the method, path, status, duration and remote address.
- Environment values are masked as `********` in every API response. Validation errors never echo a value.
- `${NAME}` placeholders keep secrets out of `deploy.yaml` and out of your repository. `shipwick` fills them in from its environment or `--env-file` at deploy time, refuses to deploy while one is unset, and reports only how many were substituted, never the values.
- The webhook URL is a credential: Slack's and Discord's carry the token in the path. It is validated without being echoed, and only its host ever appears in a log line. Plain `http` is refused unless the host is loopback or a private address.
- API responses carry `Cache-Control: no-store`.

### No shell, anywhere

The agent talks to the Docker Engine API directly. It never runs the `docker` command line, and nothing from `deploy.yaml` or an API request is ever executed on the server or interpolated into a command line.

Commands do exist in `deploy.yaml` now: `entrypoint`, `command`, `health.command`, `pre_deploy.command`, `jobs[].command`, and the body of `shipwick run`. Every one of them is an argv, a list of arguments handed to Docker exactly as written; a string is one argument, spaces included, and nothing is split, joined or passed through a shell. Every one of them runs inside a container of the application's own image, as the image's own command would: a replica's process, a one-off container for the hook, a job or a `run`, or, for a command health check, an exec inside the running replica through the Engine API, without a TTY. They change what runs inside the container, which the image always decided anyway. The container's boundaries are the same, and nothing runs on the server itself.

### Validation

Names, images, hostnames, health paths, published ports and logging options are strictly validated. These are the inputs that end up in container names, URLs, the proxy configuration and the daemon's configuration. Unknown fields in `deploy.yaml` are errors, and request bodies are size-limited. The agent re-validates everything the CLI sends: client-side validation is a convenience, not a trust boundary.

### Proxy configuration as data

The Caddy configuration is built as data and serialized, never assembled from strings. Even input that slipped past validation could not change its structure. A hostname belongs to one application in one role: an application cannot claim a hostname that another application answers to as its domain, an alias or a redirect, nor one that the agent or the dashboard is served on.

### Unprivileged containers

Application containers are never privileged, run with `no-new-privileges` and get no host mounts; `volumes` are named Docker volumes, never a host path. Their logs are size-capped at 3 files of 10 MB, so an application cannot fill the disk by logging.

**Published ports are the one exception to "no host ports".** `publish` binds exactly the listed container ports on the server, for services the proxy cannot serve because they are not HTTP. The agent refuses a port it or the proxy listens on, and one another application already publishes, before anything is started; validation refuses `publish` without `recreate` and one replica.

::: warning Published ports bypass the host firewall
On most distributions Docker inserts its own iptables rules ahead of ufw's or firewalld's, so a port published on every address is reachable from the internet whatever the firewall says. Publish only what must be reachable from outside the server, bind it to a private address where one exists (`address: 10.0.0.5`), and keep what only other applications need unpublished: they reach it by name on the `shipwick` network. See [Expose a service that is not HTTP](/docs/tasks/non-http-services).
:::

**Logging drivers refuse sockets and files.** `logging` hands replica logs to a Docker logging driver, whose options reach the daemon as written. The driver list is closed to the ones whose options are checked, a collector address must be `scheme://host:port` (a socket is a path on the server, which Shipwick never mounts), and options that name a certificate or CA file on the server are refused: no application gets to make the daemon read a file.

### A distroless agent image

The agent image contains the agent binary and CA certificates. It has no shell and no package manager. The binary is statically linked.

### Verified installation

Everything the installer fetches comes from one release and is verified against that release's checksums. Downloads are HTTPS-only. A checksum mismatch installs nothing and leaves a running installation as it was. The images are pinned to the release's version.

### Token handling in the CLI

- `shipwick` never takes the token as a flag. Arguments leak through `ps` and shell history. The token comes from `SHIPWICK_AGENT_TOKEN`, from a prompt without echo, or from standard input.
- The saved configuration file is written with mode `0600`, in a directory created with mode `0700`. It holds one entry per context, each with its URL and token.
- A saved token belongs to the URL it was saved for. If `--url` or `SHIPWICK_AGENT_URL` points at a different agent, the saved token is not sent there.
- `shipwick` warns before a token crosses the network over plain HTTP to anything other than the local machine.
- `shipwick login` verifies the token against the agent before saving it. `shipwick server status` shows which token and role you are using.
- `shipwick token create` prints the new token once, to standard output, and never stores it; put it in the CI secret and move on.
- `shipwick upgrade` writes the new binary next to the old one and renames it over only once its SHA-256 matches the release's `checksums.txt`. A binary under Homebrew's or winget's directories is left to the package manager.

### Session handling in the dashboard

- **The token never reaches JavaScript.** The dashboard's own server verifies it against the agent at sign-in and keeps it in an `httpOnly`, `SameSite=Strict` cookie, `Secure` over HTTPS, valid for 7 days. The browser application only knows whether a session exists and, from `GET /server`, the token's name and role. An XSS bug or a malicious browser extension cannot read the token. A token created on the Tokens page is shown once, in the page, and never stored.
- **The role follows the token.** Whoever signs in brings a token, and what the dashboard offers follows that token's role: controls the role does not cover are disabled with the reason, and the Tokens page appears for `admin` tokens only. That is a courtesy; roles are enforced by the agent, which answers `403` to a request the role does not cover whatever the page does.
- **The browser never talks to the agent.** The dashboard server relays requests and adds the `Authorization` header. The agent therefore needs no CORS support and can stay off the public internet.
- **CSRF.** Every state-changing request must carry the header `X-Shipwick-Request: 1`. A cross-origin page cannot add a custom header without a CORS preflight, and the server never grants one. `Sec-Fetch-Site`, where the browser sends it, must be `same-origin`. `SameSite=Strict` is the second layer.
- **The relay is not an open proxy.** The target host comes only from the dashboard's `SHIPWICK_AGENT_URL`. Only `GET`, `HEAD`, `POST`, `PUT` and `DELETE` are accepted, the path must stay under `/api/v1/` with each segment limited to `[A-Za-z0-9._~-]`, and only `Accept`, `Content-Type` and, for an upload, `Content-Length` are forwarded. The browser's cookies never are. `POST` bodies over 128 KB are refused; a `PUT` body, which is only ever a volume archive, is streamed through and bounded by the agent's own 10 GB limit.
- **A `401` from the agent ends the session.** The cookie is cleared and the application returns to the sign-in page.
- The token is never logged by the dashboard. Post-login redirects only accept same-site paths.
- In production the dashboard sends a Content-Security-Policy of `default-src 'self'` (with inline script and style allowed), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. It loads nothing from third parties.
- The dashboard has no database and no credentials of its own. Accounts are the agent's named tokens with roles.

## What Shipwick does not do yet

- **Roles are per server, not per application.** A `deploy` token can deploy every application on the server; there is no way to limit a token to one of them.
- **The encryption key cannot be rotated.** The key that was used to write the database is the key that reads it.
- **The dashboard has no login rate limiting.** Put it in the reverse proxy if needed. Tokens the agent issues are 32 random bytes; a configured root token is at least 16 characters.
- **Registry credential helpers are not supported.** Private registry credentials are read from the `auths` entries of the Docker configuration file on the server, where they are stored base64-encoded, not encrypted.

Protect the data directory regardless of all the above; it is created with mode `0700`. Anyone who can read it has the database and the key, and anyone with the Docker socket can read every application's environment from its containers.

## Reporting a vulnerability

Do not open a public issue. Report privately, either way:

- Email **security@shipwick.com**
- GitHub private vulnerability reporting: [Report a vulnerability](https://github.com/shipwick/shipwick/security/advisories/new). Only maintainers see it.

Helpful to include: the version (`shipwick --version`, or `shipwick server status` for the agent's), how the agent is run (the installer, a compose file of your own, a bare process), what an attacker needs to start with, and steps to reproduce. A proof of concept is welcome but not required.

What to expect:

- an acknowledgement within 3 days;
- an assessment, whether the report can be reproduced and how severe it is judged to be, within 10 days;
- a fix released before the details are published, and credit in the release notes unless you prefer otherwise. The disclosure date is agreed with the reporter.

There is no bug bounty. Until 1.0, only the latest release receives security fixes.

### What counts

Vulnerabilities:

- reaching the API, or the dashboard's session, without a valid token;
- a token doing what its role does not allow;
- recovering a token, the encryption key or an application's environment values from logs, API responses, error messages, the dashboard, or files readable by others; or reading environment values from a copy of the database without the key;
- input in `deploy.yaml` or an API request that executes something on the server itself, escapes the fields it belongs to (proxy configuration, container names, file paths, logging options), or yields a privileged container, a host mount, or a published host port that `publish` did not ask for;
- an application container that can reconfigure the proxy, reach the agent's data, or claim a hostname or a server port held by another application;
- the CLI sending a saved token somewhere other than the agent it was saved for;
- the installer, or `shipwick upgrade`, fetching or running something it did not verify.

Expected behavior, not vulnerabilities:

- a holder of a `deploy` or `admin` token running arbitrary images and commands inside containers, reading environment values of containers through Docker, or otherwise controlling the server;
- anyone with access to the Docker socket, the agent's data directory or Caddy's admin socket doing the same;
- root on the server reading `encryption.key`, or `docker inspect` showing a running container's environment;
- a port published with `publish` being reachable despite the host firewall;
- exposing port 9000 to the internet against the documentation's advice.

If you are unsure which list something belongs to, report it privately anyway.
