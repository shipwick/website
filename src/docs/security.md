---
title: Security
description: The trust model of a Shipwick installation, how to expose the API safely, what Shipwick does to protect the server, how secrets, registry credentials, certificate keys and backups are encrypted and how the key is rotated, what the proxy logs, what Shipwick does not do yet, and how to report a vulnerability.
---

# Security

The agent holds the Docker socket, which makes it root on the server it runs on. This page describes the trust model that follows from that, how to expose the API safely, what Shipwick does and does not do — tokens and roles, what is encrypted at rest and how the key is rotated, backups and exports, what the proxy sees and logs — and how to report a vulnerability.

## Trust model

**The Docker socket is root.** The agent needs `/var/run/docker.sock`, and anyone who controls the Docker daemon controls the host: they can start a container that mounts `/`. Consequently:

- **An `admin` token is equivalent to root SSH access to the server.** Treat it so. The token the installer prints is one.
- **Shipwick is not a multi-tenant sandbox.** Whoever can submit a `deploy.yaml` to the agent, which any `deploy` token can, can run arbitrary images on the server, with any command, as any user inside the container.
- **Roles limit what a token may ask the API for, not what the server trusts.** `read` sees everything, environment values masked and secrets by name only; `deploy` changes what runs, and sends images and static folders; `admin` also deletes applications, manages tokens, secrets, registry credentials and certificates, rotates the encryption key, downloads, restores or removes backups and volumes, and exports and imports the server. A role applies to the whole server, not to one application.
- The same holds for anyone with access to the Docker socket, the agent's data directory or Caddy's admin socket.
- **Whoever holds the backup passphrase and the bucket holds everything**: every application's data, and the agent's database together with the key to it. See [Backups and exports](#backups-and-exports).

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
- **Guessing is answered.** After 20 failed authentications within a minute from one client address, the agent answers wrong tokens from that address with `429 RATE_LIMITED` and a `Retry-After` header for the next minute. A valid token is never refused: behind Caddy every client shares the proxy's address, and behind the dashboard every browser shares the dashboard server's, so a guesser must not be able to lock anyone else out. Only failures count, so a mistyped token does not reach the limit, and `GET /health` is not limited.
- A configured root token must be at least 16 characters. The agent refuses to start with a shorter one.
- If the agent generates its token, it prints it once, directly to standard output and not through the logger, and it cannot be recovered afterwards. Under Docker, "printed" means it is in the container's log (`docker logs`) for as long as that container exists. The installer avoids this by generating the token itself and passing it in. Do the same when setting things up by hand.
- The installer writes the token to `/opt/shipwick/.env` with mode `0600`, in a directory with mode `0700`, and never rewrites an existing `.env`.

Give CI a `deploy` token and people `admin` ones. See [Create tokens for CI and teammates](/docs/tasks/tokens).

### Secrets at rest

The `env` values and the basic-auth passwords of every deployment, the secrets stored with `shipwick secret set`, the registry passwords stored with `shipwick registry login` and the keys of the certificates supplied with `shipwick cert set` are encrypted before they are written to the database, and nothing else is. Names, images, hostnames and the variable names stay in clear, so the file remains debuggable; only the values are ciphertext.

- **The scheme** is AES-256-GCM with a fresh 12-byte random nonce per value and the variable name as additional authenticated data. Binding the name means a ciphertext cut from `DB_PASSWORD` and pasted into `DEBUG_ECHO` does not decrypt: a tampered database cannot make the agent hand a secret to a different variable. The stored form is `enc1:` followed by base64 of nonce and ciphertext; the prefix versions the scheme and marks the value as encrypted.
- **Every kind of value is bound to what it is.** A basic-auth password is sealed under its position in the configuration (`proxy.basic_auth[0].password`), a stored secret under its name, a registry password under `registry:<name>`, a certificate's key under `certificate:<hostname>`. The prefixes keep a registry's password from opening as a secret or a variable that happens to carry the registry's name.
- **The key** is 32 bytes, from `SHIPWICK_ENCRYPTION_KEY` (64 hex characters) or, by default, `encryption.key` in the data directory, created with mode `0600` on the agent's first start. It lives next to the database rather than in it, so a copy of the database alone is useless. Opening the database proves the key against every stored value, so a key that does not match is caught at start, not at the first deployment, and the agent refuses to start with a message that says so.
- **What it protects**: a copy of the database file without the key. A backup, a snapshot, a disk that left the building, a file opened with `sqlite3` by whoever debugs it.
- **What it does not protect against**: root on the server, who can read the key file and the agent's memory; and the values inside running containers, which `docker inspect` shows to anyone with the Docker socket. An `env` value has to be in clear inside the container for the application to use it.
- **Upgrading**: a database written by a release before encryption is recognised by the missing prefix, and its values are encrypted in place, in one transaction, on the first start after the upgrade.
- **The key can be replaced** while the agent runs: see [Key rotation](#key-rotation).

::: warning Back up encryption.key together with shipwick.db
Without the key the database cannot be read, and the agent refuses to start against it. The agent says so in its log when it creates the key. A backup of the data directory that leaves the key out is a backup of nothing. Since 0.5 the agent takes that backup itself, daily and encrypted, once `SHIPWICK_BACKUP_PASSPHRASE` is set, and `shipwick doctor` says when it is not: see [Backups and exports](#backups-and-exports).
:::

### Key rotation

When the key may have been seen — a backup that held it went astray, someone who had the server left — replace it with `shipwick server rotate-key`, or **Rotate encryption key** on the dashboard's server page. Both need the `admin` role. See [Rotate the encryption key](/docs/tasks/rotate-the-encryption-key) for the steps.

- **Nothing is deployed and nothing restarts.** The running agent generates a new key, re-encrypts every stored value under it in one transaction — the `env` values and basic-auth passwords of every deployment record, the secrets, the registry passwords, the certificate keys — and carries on with it.
- **It survives a crash at any point.** The database and the key are two files, and no step changes both. The new key is written next to the key file, as `encryption.key.new`, and synced; the transaction commits; the new key is moved over `encryption.key`. A crash before the commit leaves the old key and a pending key that opens nothing; a crash after it leaves a pending key that opens everything. At its next start the agent tries which of the two opens the data and discards or promotes the pending key accordingly. Nothing is deleted while neither fits.
- **With the key in `SHIPWICK_ENCRYPTION_KEY`** the agent cannot take the last step: it cannot change the environment it will be started with next. The new key is shown once, for you to put there before the agent restarts. Until then the agent keeps working with the new key and holds a copy of it in `encryption.key.new`, so that a lost terminal does not lose the key — which also means that, for as long as that file exists, the data directory holds the key next to the database, the thing setting the variable was meant to avoid. Started with the old key, the agent refuses to start and says where the new one is; started with the new one, it removes the copy. A second rotation is refused until then.
- **The log records the rotation and the token that asked for it, never a key.** It is not an application event.
- **Rotation protects what is written from now on.** A copy of the old database together with the old key stays readable, so a secret that may have leaked with them has to be changed where it is used as well. Backups of the database made before the rotation still need the old key; back up the new one.

### Secrets kept on the server

A value for `${NAME}` in `env` can be stored on the server once, with `shipwick secret set NAME`, so that no laptop and no pipeline has to hold it. What the agent does with it:

- The value is never an argument: `shipwick secret set` asks for it without echo, reads it from standard input, or from a file with `--from-file`. Arguments leak through `ps` and shell history.
- It is written encrypted, like an `env` value, with its name as additional authenticated data, and is read by nobody afterwards: `GET /secrets` lists names and dates only, and the value is never returned, logged or repeated in an error. It goes into containers and nowhere else.
- The agent fills it into the `env` values of a deployment when the deployment is recorded, so the record holds the value and a rollback restores what that deployment ran with. A `${NAME}` that is set neither where `shipwick` runs nor on the server refuses the deployment before anything is recorded.
- Storing and removing a secret needs the `admin` role; listing the names needs `read`. In the dashboard, the value is cleared from the page the moment the request is sent.

### Passwords of the proxy

A basic-auth password in the [`proxy`](/docs/reference/deploy-yaml#proxy) block of `deploy.yaml` is a secret, treated like an `env` value. Write `${ADMIN_PASSWORD}` and it is filled in by the CLI from its environment or `--env-file`, else by the agent from the secrets stored on the server. It is encrypted in the database, shown as `********` wherever the configuration is shown, and Caddy is given a bcrypt hash of it, never the password. It must have at least 8 characters and at most 72 bytes.

Basic authentication sends the password with every request; it is protected by HTTPS, which every domain has. It keeps a staging site or an admin area closed. It is not a login system.

### Registry credentials

Since 0.5 the agent keeps the credentials of private registries itself, stored with `shipwick registry login`.

- The password is never an argument: it is asked for without echo or piped in. The agent checks it against the registry before storing it, with a call that verifies and keeps nothing.
- It is written encrypted, like a secret, and is never listed, logged or returned: `GET /registries` lists the registries a credential is stored for, without passwords. It is sent to the Docker daemon with a pull from its registry and nowhere else. The daemon holds no registry credentials; every pull carries its own.
- Storing and removing a credential needs the `admin` role.
- A registry without a stored credential falls back to the Docker configuration file on the server, where `docker login` stores credentials base64-encoded, not encrypted. See [Pull from private registries](/docs/tasks/private-registries).

### Certificates you supply

The key of a certificate supplied with `shipwick cert set` is read from a file, never logged and never returned: the API answers with what a certificate says about itself — issuer, expiry, names — never the key or the PEM. The chain is public and is stored in clear; the key is encrypted like a secret, bound to its hostname.

The key does leave the database for one place, the proxy, which cannot serve the certificate without it: it is part of the configuration the agent loads into Caddy. Caddy's autosaved copy of that configuration, on the `caddy-config` volume, therefore contains it. That volume is mounted by Caddy alone, and should stay so. See [Certificates](/docs/tasks/certificates).

### The Cloudflare token

`SHIPWICK_CLOUDFLARE_API_TOKEN` can edit the DNS of your zones. Give it the two permissions it needs and no more: *Zone → Zone → Read* and *Zone → DNS → Edit*, on the zones your hostnames are in. Not the Global API Key. Caddy uses it to create and remove the `_acme-challenge` TXT records, nothing else.

- **Where it is.** In `/opt/shipwick/.env`, in the agent's memory, and inside the configuration the agent loads into Caddy — and therefore in Caddy's autosaved copy of it on the `caddy-config` volume.
- **Where it is not.** It is never logged and never returned by the API; `GET /server` says only that the DNS challenge is on. The agent removes it from Caddy's errors before they are logged or shown, and refuses at startup a value that is not of a token's form, without repeating it.
- **Cloudflare's ranges become trusted proxies.** With the token set, Cloudflare's address ranges are trusted proxies of Caddy, so applications find the visitor's address first in `X-Forwarded-For`, followed by Cloudflare's. From any other sender the header is replaced, since anyone can send one. The ranges are the ones Cloudflare publishes; they are compiled into the agent.
- Set the zone's SSL/TLS mode to *Full (strict)*, which checks the certificate Caddy obtained. *Full* accepts any certificate from the server.

See [Put Cloudflare in front](/docs/tasks/cloudflare).

### Backups and exports

A backup is the application's data, and the agent's own is every secret together with the key to them.

- **Without `SHIPWICK_BACKUP_PASSPHRASE`**, application backups are plain tar files in the data directory, as readable as the volumes next to them, and the agent's state is not backed up at all. The key is never written anywhere unencrypted: `encryption.key` next to `shipwick.db` in a directory of backups would be every secret in clear, and no backup is the smaller harm, as long as it is said. `shipwick doctor` and `GET /server` say it.
- **With it**, everything is encrypted before it reaches the disk or the bucket: AES-256-GCM with a key derived from the passphrase by PBKDF2-HMAC-SHA256, a random salt per file. The encryption is the agent's, not the bucket's, so whoever holds the bucket holds nothing they can read — and whoever holds the passphrase and the bucket holds everything, which is why the passphrase is not to be stored in the bucket's account.
- **Tampering is detected.** Truncating, reordering or altering an encrypted backup is detected when it is read.
- **Credentials stay out of sight.** The passphrase and the bucket's two keys are never logged or returned by the API; the log names the bucket and its host.
- **Roles.** Taking and verifying a backup needs the `deploy` role; downloading, restoring or removing one, and anything about the agent's state, needs `admin`.
- **Verification runs the application.** `shipwick backups verify` starts a container of the application's current image on a restored copy of the data, with the application's environment. It has no route, no name another application could find it under and no published ports, but an application that writes somewhere other than its volumes when it starts does that here too.

An **export**, the file `shipwick export` writes to [move a server](/docs/tasks/move-to-a-new-server), holds every secret the server has: the `env` values and basic-auth passwords of every application, the stored secrets, the registry credentials and the certificates with their keys.

- **It is encrypted, always**, in the format backups use. The passphrase is asked for twice without echo, or read from `SHIPWICK_EXPORT_PASSPHRASE`, and must be at least 12 characters. The agent encrypts as it writes, so nothing leaves it unencrypted and nothing is kept on the server. An export written on a schedule is encrypted with `SHIPWICK_BACKUP_PASSPHRASE`, and the agent refuses to start with a schedule and no passphrase.
- **The old key does not travel.** The values are opened for the export and sealed again on import with the new server's own key. API tokens stay behind as well.
- Exporting and importing need the `admin` role.

See [Back up and restore volumes](/docs/tasks/backups).

### What the proxy logs

Since 0.5 the agent reads Caddy's access log to answer `shipwick traffic`. The log is written with that reader in mind:

- **No headers and no query strings.** Request and response headers, TLS details and the remote port are removed before a line is written, and the URI is cut at the question mark, so a token in a query string or an `Authorization` header never reaches the log, let alone the agent. What is left of a request is its time, hostname, method, path, status, duration, size and client address.
- **The agent's and the dashboard's own hostnames are not logged at all.**
- **What is kept.** Per-minute counts and a latency histogram for seven days, in the database, and the last 200 requests of each application in the agent's memory. The access log itself stays in Docker's log files of the Caddy container, capped at 3 files of 10 MB like every container's log.
- Reading traffic and requests needs the `read` role.

See [Traffic](/docs/tasks/traffic).

### Nothing secret in logs or responses

- Tokens, `Authorization` headers, request bodies and environment values are never logged. The request log holds the method, path, status, duration and remote address.
- Environment values and basic-auth passwords are masked as `********` in every API response. Validation errors never echo a value.
- `GET /metrics`, the Prometheus endpoint, is authenticated like the rest of the API: a token with the `read` role. It carries numbers and names — statuses, replica counts, CPU, memory, restarts, the disk, the active alerts — and no values. Give the scraper a `read` token of its own.
- `${NAME}` placeholders keep secrets out of `deploy.yaml` and out of your repository. `shipwick` fills them in from its environment or `--env-file` at deploy time and reports only how many were substituted, never the values; the agent fills the remaining `env` values in from the secrets stored on the server, and a name neither has stops the deployment.
- The webhook URL is a credential: Slack's and Discord's carry the token in the path. It is validated without being echoed, and only its host ever appears in a log line. Plain `http` is refused unless the host is loopback or a private address.
- API responses carry `Cache-Control: no-store`.

### No shell, anywhere

The agent talks to the Docker Engine API directly. It never runs the `docker` command line, and nothing from `deploy.yaml` or an API request is ever executed on the server or interpolated into a command line.

Commands do exist in `deploy.yaml` now: `entrypoint`, `command`, `health.command`, `pre_deploy.command`, `jobs[].command`, and the body of `shipwick run`. Every one of them is an argv, a list of arguments handed to Docker exactly as written; a string is one argument, spaces included, and nothing is split, joined or passed through a shell. Every one of them runs inside a container of the application's own image, as the image's own command would: a replica's process, a one-off container for the hook, a job or a `run`, or, for a command health check, an exec inside the running replica through the Engine API, without a TTY. They change what runs inside the container, which the image always decided anyway. The container's boundaries are the same, and nothing runs on the server itself.

**The server never builds.** With `build: .`, `docker build` runs on the developer's machine, as an argv, with paths that were validated as relative and inside the project; the agent only loads the resulting archive, and refuses one that does not carry exactly one image tagged for that application. A Dockerfile runs whatever it likes, with the network and CPU of the machine it runs on, and that machine is yours, not the server. The same goes for the CLI's other programs: `ssh` in `shipwick server install` and the browser opener in `shipwick open` are run as programs with arguments, never through a shell, with fixed remote commands and validated hostnames.

**A static folder is files and directories only.** The upload of a static application is a tar archive of files and directories with paths inside the folder; a symbolic link is refused, since the proxy's file server would follow it, and the CLI skips one that leads out of the folder before anything is sent. The proxy serves the folder from its own container, `/srv/shipwick/<app>/<digest>`, and nothing else.

### Validation

Names, images, hostnames, health paths, published ports, logging options, build paths, static folders and secret names are strictly validated. These are the inputs that end up in container names, URLs, the proxy configuration, the daemon's configuration and file paths. Unknown fields in `deploy.yaml` are errors, and request bodies are size-limited: 64 KB for a `deploy.yaml`, 4 GB for an image archive, 512 MB for a static folder, 10 GB for a volume archive. The agent re-validates everything the CLI sends: client-side validation is a convenience, not a trust boundary.

### Proxy configuration as data

The Caddy configuration is built as data and serialized, never assembled from strings. Even input that slipped past validation could not change its structure. A hostname is taken per [`path`](/docs/reference/deploy-yaml#path): several applications may share one, each serving a path of its own, and the same path twice is refused. No application can claim a hostname that the agent or the dashboard is served on. The same goes for what the `proxy` block adds — response headers, redirects, the accounts of basic authentication — and for a supplied certificate and the Cloudflare token: they enter the configuration as values of fields, never as text.

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

Everything the installer fetches comes from one release and is verified against that release's checksums. Downloads are HTTPS-only. A checksum mismatch installs nothing and leaves a running installation as it was. The three images — the agent, the dashboard and the proxy, Shipwick's own build of Caddy with the Cloudflare DNS module and nothing else added — are pinned to the release's version.

With a hostname for the API, the installer saves the URL and the token as a context of the user who runs it, so that `shipwick` works on the server. The token goes to the CLI on standard input, never as an argument, and the CLI writes its own file, mode `0600`.

### Token handling in the CLI

- `shipwick` never takes the token as a flag. Arguments leak through `ps` and shell history. The token comes from `SHIPWICK_AGENT_TOKEN`, from a prompt without echo, or from standard input.
- The saved configuration file is written with mode `0600`, in a directory created with mode `0700`. It holds one entry per context, each with its URL and token.
- A saved token belongs to the URL it was saved for. If `--url` or `SHIPWICK_AGENT_URL` points at a different agent, the saved token is not sent there.
- `shipwick` warns before a token crosses the network over plain HTTP to anything other than the local machine.
- `shipwick login` verifies the token against the agent before saving it, unless `--no-check` says not to, for a hostname whose DNS record or certificate does not exist yet. `shipwick server status` shows which token and role you are using.
- The values `shipwick` stores on the server are never arguments either: a secret, a registry password and the passphrase of an export are asked for without echo or piped in, and a certificate's key is read from a file.
- `shipwick token create` prints the new token once, to standard output, and never stores it; put it in the CI secret and move on.
- `shipwick upgrade` writes the new binary next to the old one and renames it over only once its SHA-256 matches the release's `checksums.txt`. A binary under Homebrew's or winget's directories is left to the package manager.

### Session handling in the dashboard

- **The token never reaches JavaScript.** The dashboard's own server verifies it against the agent at sign-in and keeps it in an `httpOnly`, `SameSite=Strict` cookie, `Secure` over HTTPS, valid for 7 days. The browser application only knows whether a session exists and, from `GET /server`, the token's name and role. An XSS bug or a malicious browser extension cannot read the token. A token created on the Tokens page is shown once, in the page, and never stored; so is the new key of a rotation, when the agent's key is set in its environment.
- **The role follows the token.** Whoever signs in brings a token, and what the dashboard offers follows that token's role: controls the role does not cover are disabled with the reason, and the Tokens page appears for `admin` tokens only. That is a courtesy; roles are enforced by the agent, which answers `403` to a request the role does not cover whatever the page does.
- **The browser never talks to the agent.** The dashboard server relays requests and adds the `Authorization` header. The agent therefore needs no CORS support and can stay off the public internet.
- **CSRF.** Every state-changing request must carry the header `X-Shipwick-Request: 1`. A cross-origin page cannot add a custom header without a CORS preflight, and the server never grants one. `Sec-Fetch-Site`, where the browser sends it, must be `same-origin`. `SameSite=Strict` is the second layer.
- **The relay is not an open proxy.** The target host comes only from the dashboard's `SHIPWICK_AGENT_URL`. Only `GET`, `HEAD`, `POST`, `PUT` and `DELETE` are accepted, the path must stay under `/api/v1/` with each segment limited to `[A-Za-z0-9._~-]`, and only `Accept`, `Content-Type` and, for an upload, `Content-Length` are forwarded. The browser's cookies never are. `POST` bodies over 128 KB are refused; a `PUT` body, a volume archive or a secret's value, is streamed through and bounded by the agent's own limits. The dashboard uploads neither static folders nor images: `shipwick deploy` does that.
- **Failed sign-ins are slowed down by the agent.** Every browser reaches the agent from the dashboard server's address, so 20 failed sign-ins within a minute, from anyone, make the agent answer wrong tokens with `429` for a minute; the dashboard shows `Too many failed attempts from this address; try again in a minute` and never presents it as a rejected token. A valid token is never refused.
- **A `401` from the agent ends the session.** The cookie is cleared and the application returns to the sign-in page.
- The token is never logged by the dashboard. Post-login redirects only accept same-site paths.
- In production the dashboard sends a Content-Security-Policy of `default-src 'self'` (with inline script and style allowed), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. It loads nothing from third parties.
- The dashboard has no database and no credentials of its own. Accounts are the agent's named tokens with roles.

## What Shipwick does not do yet

- **Roles are per server, not per application.** A `deploy` token can deploy every application on the server; there is no way to limit a token to one of them.
- **Rate limiting is per client address, and the dashboard is one client.** The agent slows down failed authentications by address, which behind the dashboard is the dashboard server's; there is no limit per token or per browser. Tokens the agent issues are 32 random bytes; a configured root token is at least 16 characters.
- **Registry credential helpers are not supported.** A helper is a program on the host that the Docker command line executes; the agent's container does not have it, and the agent executes nothing. A credential stored with `shipwick registry login` is encrypted; one read from the `auths` entries of the Docker configuration file on the server is stored there base64-encoded, not encrypted. With `build: .` no registry and no credentials are involved.
- **Backups are not encrypted unless you set a passphrase.** Without `SHIPWICK_BACKUP_PASSPHRASE` the backups of volumes are plain tar files, and the agent's own state, the database and the key, is not backed up at all.
- **Rotation does not reach back.** A copy of the database taken before a rotation opens with the key of that time.

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
