---
title: Security
description: The trust model of a Shipwick installation, how to expose the API safely, what Shipwick does to protect the server, what it does not do yet, and how to report a vulnerability.
---

# Security

The agent holds the Docker socket, which makes it root on the server it runs on. This page describes the trust model that follows from that, how to expose the API safely, what Shipwick does and does not do, and how to report a vulnerability.

## Trust model

**The Docker socket is root.** The agent needs `/var/run/docker.sock`, and anyone who controls the Docker daemon controls the host: they can start a container that mounts `/`. Consequently:

- **The API token is equivalent to root SSH access to the server.** Treat it so.
- **Shipwick is not a multi-tenant sandbox.** Whoever can submit a `deploy.yaml` to the agent can run arbitrary images on the server.
- **There is one token, and it grants everything.** There are no users, roles or read-only credentials.
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
The token would cross the network in clear text, and the token is root on the server. The production compose file publishes no port for the agent on purpose.
:::

On the server, open ports 80 and 443 and nothing else.

**Caddy's admin API is as sensitive as the agent's.** Whoever reaches it controls all routing and the certificate store. Shipwick talks to it over a unix socket in a volume shared by the agent and Caddy only. Do not move it to a TCP port on the application network: every application container could then reconfigure the proxy.

**The dashboard** should be served over HTTPS too, which `SHIPWICK_DASHBOARD_DOMAIN` does. Signing in sends the token to the dashboard's server; over plain HTTP on anything but loopback that is a root credential in clear text.

## What Shipwick does

### Token handling in the agent

- Only the SHA-256 hash of the token is kept, in memory and on disk. The token itself is never stored.
- The presented token is hashed before comparison and the comparison is constant-time, so neither the token's content nor its length leaks through timing.
- A token must be at least 16 characters. The agent refuses to start with a shorter one.
- If the agent generates its token, it prints it once, directly to standard output and not through the logger, and it cannot be recovered afterwards. Under Docker, "printed" means it is in the container's log (`docker logs`) for as long as that container exists. The installer avoids this by generating the token itself and passing it in. Do the same when setting things up by hand.
- The installer writes the token to `/opt/shipwick/.env` with mode `0600`, in a directory with mode `0700`, and never rewrites an existing `.env`.

### Nothing secret in logs or responses

- Tokens, `Authorization` headers, request bodies and environment values are never logged. The request log holds the method, path, status, duration and remote address.
- Environment values are masked as `********` in every API response. Validation errors never echo a value.
- API responses carry `Cache-Control: no-store`.

### No shell, anywhere

The agent talks to the Docker Engine API directly. It never runs the `docker` command line, and nothing from `deploy.yaml` is ever executed or interpolated into a command.

### Validation

Names, images, domains and health paths are strictly validated. These are the inputs that end up in container names, URLs and the proxy configuration. Unknown fields in `deploy.yaml` are errors, and request bodies are size-limited. The agent re-validates everything the CLI sends: client-side validation is a convenience, not a trust boundary.

### Proxy configuration as data

The Caddy configuration is built as data and serialized, never assembled from strings. Even input that slipped past validation could not change its structure. An application cannot claim a domain that another application, the agent or the dashboard is served on.

### Unprivileged containers

Application containers are never privileged, run with `no-new-privileges`, get no host mounts and publish no host ports. The proxy is the only way in. Their logs are size-capped at 3 files of 10 MB, so an application cannot fill the disk by logging.

### A distroless agent image

The agent image contains the agent binary and CA certificates. It has no shell and no package manager. The binary is statically linked.

### Verified installation

Everything the installer fetches comes from one release and is verified against that release's checksums. Downloads are HTTPS-only. A checksum mismatch installs nothing and leaves a running installation as it was. The images are pinned to the release's version.

### Token handling in deployctl

- `deployctl` never takes the token as a flag. Arguments leak through `ps` and shell history. The token comes from `SHIPWICK_AGENT_TOKEN`, from a prompt without echo, or from standard input.
- The saved configuration file is written with mode `0600`, in a directory created with mode `0700`.
- A saved token belongs to the URL it was saved for. If `--url` or `SHIPWICK_AGENT_URL` points at a different agent, the saved token is not sent there.
- `deployctl` warns before a token crosses the network over plain HTTP to anything other than the local machine.
- `deployctl login` verifies the token against the agent before saving it.

### Session handling in the dashboard

- **The token never reaches JavaScript.** The dashboard's own server verifies it against the agent at sign-in and keeps it in an `httpOnly`, `SameSite=Strict` cookie, `Secure` over HTTPS, valid for 7 days. The browser application only knows whether a session exists. An XSS bug or a malicious browser extension cannot read the token.
- **The browser never talks to the agent.** The dashboard server relays requests and adds the `Authorization` header. The agent therefore needs no CORS support and can stay off the public internet.
- **CSRF.** Every state-changing request must carry the header `X-Shipwick-Request: 1`. A cross-origin page cannot add a custom header without a CORS preflight, and the server never grants one. `Sec-Fetch-Site`, where the browser sends it, must be `same-origin`. `SameSite=Strict` is the second layer.
- **The relay is not an open proxy.** The target host comes only from the dashboard's `SHIPWICK_AGENT_URL`. Only `GET`, `HEAD`, `POST` and `DELETE` are accepted, the path must stay under `/api/v1/`, and only `Accept` and `Content-Type` are forwarded. The browser's cookies never are. Bodies over 128 KB are refused.
- **A `401` from the agent ends the session.** The cookie is cleared and the application returns to the sign-in page.
- The token is never logged by the dashboard. Post-login redirects only accept same-site paths.
- In production the dashboard sends a Content-Security-Policy of `default-src 'self'` (with inline script and style allowed), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. It loads nothing from third parties.
- The dashboard has no database and no credentials of its own. Whoever signs in brings the agent token.

## What Shipwick does not do yet

- **Secrets are stored unencrypted.** Environment values are kept in plain text in the agent's SQLite file. Protect the data directory; it is created with mode `0700`. Anyone who can read it, or who has access to the Docker socket, can read every application's environment. Encrypted secrets are on the roadmap.
- **There is a single token**, not users and roles. Everyone who deploys shares one root-equivalent credential. Rotating it means setting a new `SHIPWICK_AGENT_TOKEN` and restarting the agent.
- **The dashboard has no login rate limiting.** Put it in the reverse proxy if needed. The token is at least 16 characters.
- **Registry credential helpers are not supported.** Private registry credentials are read from the `auths` entries of the Docker configuration file on the server, where they are stored base64-encoded, not encrypted.

## Reporting a vulnerability

Do not open a public issue. Report privately, either way:

- Email **security@shipwick.com**
- GitHub private vulnerability reporting: [Report a vulnerability](https://github.com/shipwick/shipwick/security/advisories/new). Only maintainers see it.

Helpful to include: the version (`deployctl --version`, or `deployctl server status` for the agent's), how the agent is run (the installer, a compose file of your own, a bare process), what an attacker needs to start with, and steps to reproduce. A proof of concept is welcome but not required.

What to expect:

- an acknowledgement within 3 days;
- an assessment, whether the report can be reproduced and how severe it is judged to be, within 10 days;
- a fix released before the details are published, and credit in the release notes unless you prefer otherwise. The disclosure date is agreed with the reporter.

There is no bug bounty. Until 1.0, only the latest release receives security fixes.

### What counts

Vulnerabilities:

- reaching the API, or the dashboard's session, without a valid token;
- recovering the token or an application's environment values from logs, API responses, error messages, the dashboard, or files readable by others;
- input in `deploy.yaml` or an API request that executes a command, escapes the fields it belongs to (proxy configuration, container names, file paths), or yields a privileged container, a host mount or a published host port;
- an application container that can reconfigure the proxy, reach the agent's data, or claim a domain served for another application;
- the CLI sending a saved token somewhere other than the agent it was saved for;
- the installer fetching or running something it did not verify.

Expected behavior, not vulnerabilities:

- a holder of a valid token running arbitrary images, reading environment values of containers through Docker, or otherwise controlling the server;
- anyone with access to the Docker socket, the agent's data directory or Caddy's admin socket doing the same;
- secrets being unencrypted in the SQLite file;
- exposing port 9000 to the internet against the documentation's advice.

If you are unsure which list something belongs to, report it privately anyway.
