---
title: Agent configuration
description: Every environment variable of the Shipwick agent with its default and meaning, the data directory, the encryption key, the webhook, how the API token is resolved and what roles are, the agent's subcommands, and the variables of the production compose file.
---

# Agent configuration

The agent is configured through `SHIPWICK_*` environment variables only. It has no configuration file and no flags. This page lists every variable, describes the data directory and the encryption key, the webhook that notifications go to, the token resolution order and the roles of tokens, the agent's subcommands, and the variables that the production compose file adds.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| [`SHIPWICK_AGENT_TOKEN`](#api-token) | generated | The root API token, `admin`. At least 16 characters. |
| `SHIPWICK_LISTEN_ADDR` | `127.0.0.1:9000` | Address the API listens on. Loopback by default, on purpose. The agent image sets it to `0.0.0.0:9000`. |
| [`SHIPWICK_DATA_DIR`](#data-directory) | `/var/lib/shipwick` on Linux | Directory for the SQLite database, the token hash and the encryption key. |
| [`SHIPWICK_ENCRYPTION_KEY`](#shipwick-encryption-key) | generated | The key that encrypts `env` values in the database: 64 hexadecimal characters. Unset: `encryption.key` in the data directory, created on the first start. |
| `SHIPWICK_DOCKER_NETWORK` | `shipwick` | Docker bridge network that application containers join. A second one, `<network>-services`, is derived from it: application containers join it too and carry their application's names on it while they are ready, and Caddy finds them there. Both are created if they do not exist. |
| [`SHIPWICK_CADDY_ADMIN`](#shipwick-caddy-admin) | none | Caddy's admin endpoint. Unset: domains are recorded but not served. |
| `SHIPWICK_AGENT_DOMAIN` | none | Serve the agent's API over HTTPS at this hostname, through Caddy. Requires `SHIPWICK_CADDY_ADMIN`. |
| `SHIPWICK_DASHBOARD_DOMAIN` | none | Serve the dashboard over HTTPS at this hostname, through Caddy. Requires `SHIPWICK_CADDY_ADMIN`. Must differ from `SHIPWICK_AGENT_DOMAIN`. |
| `SHIPWICK_DASHBOARD_UPSTREAM` | `dashboard:3000` | Where Caddy reaches the dashboard, as `host:port`. The host is a hostname or an IP address; the port is 1 to 65535. Validated only when `SHIPWICK_DASHBOARD_DOMAIN` is set. |
| [`SHIPWICK_WEBHOOK_URL`](#shipwick-webhook-url) | none | Where notifications are posted: a Slack or Discord webhook, or any HTTPS endpoint. Unset: no notifications. |
| [`SHIPWICK_WEBHOOK_SECRET`](#shipwick-webhook-secret) | none | Signs every notification, so that the endpoint can tell it came from the agent. Requires `SHIPWICK_WEBHOOK_URL`. |
| `SHIPWICK_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `SHIPWICK_LOG_FORMAT` | `text` | `text` or `json`. Logs go to standard error. |
| `DOCKER_HOST`, `DOCKER_CONFIG` | Docker defaults | The standard Docker variables are honored. `DOCKER_CONFIG` is the directory that holds `config.json`, which the agent reads for registry credentials. |

The agent refuses to start with an invalid value: an unknown log level or format, a token shorter than 16 characters, a domain that is not a valid hostname, a domain without `SHIPWICK_CADDY_ADMIN`, identical agent and dashboard hostnames, a malformed dashboard upstream, an encryption key that is not 64 hexadecimal characters, a webhook URL that is not an absolute `https` URL (or `http` towards the server itself or a private address), or a webhook secret without a webhook URL. The error names the variable and the rule, never the value: a token, a key and a webhook URL are credentials.

Both hostnames are trimmed, converted to lowercase and validated by the same rule as `domain` in `deploy.yaml`. Applications cannot claim either of them.

### SHIPWICK_LISTEN_ADDR

The API speaks plain HTTP. The default binds it to loopback so that exposing it is an explicit choice. The agent image sets `SHIPWICK_LISTEN_ADDR=0.0.0.0:9000`, so that Caddy and the dashboard can reach the API over the container network. The production compose file publishes no host port for it: the only ways in are Caddy, over HTTPS, and the server itself.

The port of this address is one of the server ports an application cannot publish: `publish[].host` in `deploy.yaml` refuses it, together with 80, 443, 8080 and 8443. See [`publish`](/docs/reference/deploy-yaml#publish).

::: warning
Never expose port 9000 directly to the internet. Serve the API through Caddy with `SHIPWICK_AGENT_DOMAIN`, or reach it over an SSH tunnel or a private network. See [Security](/docs/security).
:::

### SHIPWICK_CADDY_ADMIN

Two forms are accepted:

| Form | Example | |
|---|---|---|
| Unix socket | `unix//run/caddy/admin.sock` | Recommended. Only processes that share the socket can reconfigure the proxy. The path must be absolute. |
| TCP | `http://127.0.0.1:2019` | For a Caddy installed on the host next to an agent running as a plain binary. `http://host:port` without a path. |

The agent echoes this address into the configuration it loads, so that Caddy's admin endpoint stays where it is.

When the variable is unset, routing is disabled: the agent warns at startup, domains are recorded but nothing serves them, and `shipwick server status` reports the proxy as not configured. See [Routing and HTTPS](/docs/concepts/routing-and-https).

### SHIPWICK_AGENT_DOMAIN and SHIPWICK_DASHBOARD_DOMAIN

With `SHIPWICK_AGENT_DOMAIN` set, the agent adds a route for its own API. When the agent runs in a container on the application network, Caddy reaches it at the container's hostname and the port of `SHIPWICK_LISTEN_ADDR`. As a host process, Caddy is assumed to be a host process too, and reaches the agent at the listen address (`127.0.0.1` if the address is unspecified).

With `SHIPWICK_DASHBOARD_DOMAIN` set, the agent adds a route to `SHIPWICK_DASHBOARD_UPSTREAM`.

Both routes have response buffering disabled, so that followed logs arrive line by line.

An application that claims either hostname, as its `domain`, an alias or a redirect, is refused with `already served by Shipwick itself (the agent or the dashboard)`.

### SHIPWICK_ENCRYPTION_KEY

The key the agent encrypts environment values with before it writes them to the database. Every `env` value of every deployment is stored as AES-256-GCM ciphertext; the variable names, and everything else in the record, stay readable. A copy of `shipwick.db` without the key reveals no secrets.

| | |
|---|---|
| Format | 64 hexadecimal characters: 32 random bytes. Generate one with `openssl rand -hex 32`. |
| Normalization | Leading and trailing whitespace is trimmed. |
| Invalid | The agent refuses to start: `SHIPWICK_ENCRYPTION_KEY: expected 64 hexadecimal characters (32 random bytes; generate one with: openssl rand -hex 32)`. The value itself is never repeated. |

The key is determined at startup, in this order:

1. **`SHIPWICK_ENCRYPTION_KEY`**, when set, always wins. Nothing is written to disk.
2. Otherwise, **the key file** in the data directory, `encryption.key`, written by a previous run.
3. Otherwise, **a key is generated** and written to `encryption.key`, mode `0600`, as 64 hexadecimal characters and a newline. The agent logs `created the key that encrypts env values in the database; back it up together with shipwick.db` with the file's path.

The production compose file does not pass `SHIPWICK_ENCRYPTION_KEY` to the agent, so in that setup the key is the file in the `agent-data` volume. Setting the variable yourself is for keeping the key somewhere other than next to the database, in a secrets manager for instance.

::: warning Back up the key together with the database
Without the key the database cannot be read. The agent proves the key against the stored values on every start and refuses to start with a key that does not match: `the encryption key does not match the database (deployment 12, variable DATABASE_URL): restore /var/lib/shipwick/encryption.key from your backup or set SHIPWICK_ENCRYPTION_KEY`. A key file that is not 64 hexadecimal characters is reported as corrupt, with the same two ways out. Rotating the key is not supported yet.
:::

A database written by a release before 0.3.0 is migrated on the first start after upgrading: its environment values are encrypted in place, once, and the agent logs `encrypted the environment values of deployments written before encryption existed` with the number of deployments.

What this does and does not protect: a copy of the database file that left the server, a backup, a snapshot, is unreadable without the key. Root on the server can read the key file and the agent's memory, and the values inside a running container are shown by `docker inspect` to anyone with the Docker socket. See [Security](/docs/security).

### SHIPWICK_WEBHOOK_URL

Where the agent posts notifications: every deployment's outcome, and every application that goes down or recovers. Unset, nothing is sent. See [Get notified](/docs/tasks/notifications).

| | |
|---|---|
| Format | An absolute URL with a host. `https`, or `http` only when the host is `localhost`, a loopback address, a private address (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`) or a link-local address. Any other scheme is refused. |
| Normalization | Leading and trailing whitespace is trimmed. |
| Invalid | The agent refuses to start with one of `must be an absolute URL such as https://hooks.example.com/shipwick`, `must use https; http is allowed only for localhost and private addresses` or `must use https`, prefixed with the variable's name. The URL itself is never repeated: a Slack or Discord URL carries its token in the path. |

The events, and nothing else. A single replica restarting is in `shipwick status`, not in your chat.

| Event | When |
|---|---|
| `deployment.succeeded` | A deployment became active. |
| `deployment.failed` | A deployment failed before it changed anything. |
| `deployment.rolled_back` | A deployment was undone, automatically or by `shipwick rollback`. |
| `application.down` | Every replica of an application stopped serving. |
| `application.recovered` | An application that was down serves again. |
| `job.failed` | A run of a scheduled job, or a `shipwick run` command, exited non-zero, timed out or could not be started. |

The body depends on the host of the URL:

| Host | Body |
|---|---|
| `hooks.slack.com` | `{"text": "<message>"}` |
| `discord.com` or `discordapp.com`, path under `/api/webhooks/` | `{"content": "<message>"}` |
| Anything else | The full event as JSON, below |

```json
{
  "event": "deployment.succeeded",
  "application": "my-api",
  "deployment_id": 42,
  "version": "1.4.2",
  "message": "my-api is running 1.4.2, replacing 1.4.1",
  "at": "2026-03-01T10:00:00Z",
  "server": "vps-1"
}
```

`message` is the same complete sentence the chat formats get. `deployment_id` is `null` for an event that is not about one deployment, such as `application.down`. `at` is UTC, in whole seconds. `server` is the hostname of the server the agent runs on, as Docker reports it.

Every request is a `POST` with `Content-Type: application/json` and `User-Agent: shipwick-agent/<version>`, and, with `SHIPWICK_WEBHOOK_SECRET` set, an `X-Shipwick-Signature` header.

**Delivery.** Events are queued and sent by one sender, in order, so that a slow or dead endpoint never holds up a deployment. Each attempt has 10 seconds. A 2xx response is a delivery. A `5xx` or `429` response, or a connection error, is retried after 1, 5 and 25 seconds, four attempts in all, then given up. Any other response is a rejection and is not retried. The queue holds 256 events; when it is full, the event is dropped. At shutdown the agent gives the queue 5 seconds to drain, then abandons what is left.

**What is logged.** At startup, `notifications go to a webhook` with the webhook's host and nothing more. A dropped, rejected or undelivered notification is a warning that names the event kind, the application and the host. The URL never appears in a log line or an error message, and a connection error is logged without the URL that Go's HTTP client would otherwise repeat.

`GET /server` reports `notifications: {"webhook": true}` when the variable is set, and `shipwick server status` shows it.

### SHIPWICK_WEBHOOK_SECRET

A shared secret that signs every notification. With it set, each request carries

```http
X-Shipwick-Signature: sha256=<hex HMAC-SHA256 of the request body>
```

The HMAC is computed over the raw body with the secret as the key and written as lowercase hexadecimal after `sha256=`. To verify, compute the same over the body exactly as received and compare the two in constant time.

There is no rule on the value; use something long and random, `openssl rand -hex 32` for instance. The variable is not trimmed. Setting it without `SHIPWICK_WEBHOOK_URL` is an error: `SHIPWICK_WEBHOOK_SECRET is set but SHIPWICK_WEBHOOK_URL is not`. Slack and Discord ignore the header; it is for an endpoint of your own.

## Data directory

`SHIPWICK_DATA_DIR` defaults to:

| Platform | Default |
|---|---|
| Linux | `/var/lib/shipwick` |
| Other | `<user config dir>/shipwick`, or `shipwick-data` in the working directory if the user config directory cannot be determined |

The agent image sets `SHIPWICK_DATA_DIR=/var/lib/shipwick` and declares it a volume. The production compose file mounts the `agent-data` volume there.

The directory is created with mode `0700` if it does not exist. It contains:

| File | Content |
|---|---|
| `shipwick.db` | The SQLite database: applications, deployments with their full configuration, replicas, events, job runs, metrics samples and the hashes of the tokens created with `shipwick token create`. Environment values are encrypted. It runs in WAL mode, so SQLite keeps its `-wal` and `-shm` files next to it. |
| `encryption.key` | The key the environment values are encrypted with: 64 hexadecimal characters. Mode `0600`. Created on the first start, unless `SHIPWICK_ENCRYPTION_KEY` is set. See [`SHIPWICK_ENCRYPTION_KEY`](#shipwick-encryption-key). |
| `agent-token.sha256` | The hex-encoded SHA-256 hash of a token the agent generated itself. Mode `0600`. Present only if the agent ever generated its token. |

::: warning Protect this directory, and back it up as a whole
`shipwick.db` and `encryption.key` belong together: the database is only readable with the key, and the key is only useful with the database. Anyone who can read both can read every application's secrets, so the directory stays `0700`. A backup of one without the other is worthless.
:::

The database schema is migrated automatically at startup. An agent refuses to open a database whose schema is newer than it supports, and asks to be upgraded.

## API token

The agent authenticates every API request, except `GET /api/v1/health`, against the SHA-256 hash of a token. Every token has a **role**, and every endpoint requires one; a role includes the ones below it:

| Role | May |
|---|---|
| `read` | See everything: the server, the applications, deployments, logs, events, metrics. |
| `deploy` | And change what runs: deploy, redeploy, roll back, stop, start, run commands. |
| `admin` | And everything else: delete applications, manage tokens. |

There are two kinds of token. The **root token** is the one this section is about: the token the agent is configured with, through `SHIPWICK_AGENT_TOKEN` or generated on the first start. It has the `admin` role and the name `root`, it is not stored in the database, and it cannot be revoked through the API. It is the one the installer prints, and the one to keep for yourself.

Every other token is created with `shipwick token create <name> --role read|deploy|admin`, is shown exactly once, and is stored as a hash in `shipwick.db` with its name and role. `shipwick token ls` shows when each was last used; `shipwick token revoke <name>` ends it. Give CI a `deploy` token and people `admin` ones. A wrong or revoked token is `401 UNAUTHORIZED`; a valid token whose role does not cover the request is `403 FORBIDDEN`, and the answer says which role it has and which it needs. Deployments record which token made them. See [Create tokens for CI and teammates](/docs/tasks/tokens).

The root token's hash is determined at startup, in this order:

1. **`SHIPWICK_AGENT_TOKEN`**, when set, always wins. Its hash is kept in memory. Nothing is written to disk.
2. Otherwise, **the hash persisted in the data directory** by a previous run (`agent-token.sha256`).
3. Otherwise, **a token is generated**: `shw_` followed by 64 hexadecimal characters, from 32 random bytes. Only its hash is persisted. The token itself is printed once to standard output.

The agent only ever keeps the hash, in memory and on disk. A generated token cannot be recovered afterwards. If the hash file is corrupt, the agent refuses to start and says so: delete the file to generate a new token, or set `SHIPWICK_AGENT_TOKEN`.

A generated token is printed directly to standard output, never through the logger, so it does not end up in log aggregation by way of the log stream. Under Docker, however, "printed" means it is in the container's log (`docker logs`) for as long as that container exists. The installer avoids this by generating the token itself and passing it in as `SHIPWICK_AGENT_TOKEN`. Do the same when setting things up by hand, for example with `openssl rand -hex 32`.

To change the root token, set a new `SHIPWICK_AGENT_TOKEN` and restart the agent. Tokens created with `shipwick token create` are not affected; they live in the database. Running applications are not affected by an agent restart.

## Subcommands

```text
shipwick-agent [healthcheck|version]
```

| Invocation | |
|---|---|
| `shipwick-agent` | Run the agent. |
| `shipwick-agent version` | Print the version and exit. |
| `shipwick-agent healthcheck` | Probe the agent configured by the same environment: `GET /api/v1/health` on the port of `SHIPWICK_LISTEN_ADDR`, on `127.0.0.1` if the listen host is unspecified, with a 3 second timeout. Exits `0` on HTTP 200 and `1` otherwise. |

`healthcheck` exists for container health checks: the agent image ships no shell, `curl` or `wget`. The image declares it as its `HEALTHCHECK`, with an interval of 10 seconds, a timeout of 5 seconds, a start period of 5 seconds and 3 retries.

Any other arguments are an error. The agent has no flags.

## Startup and shutdown

At startup the agent resolves the root token and the encryption key, opens the database and encrypts any values an earlier release left in plain text, connects to Docker, ensures the two application networks exist and joins the first if the agent runs in a container, reconciles interrupted deployments and leftover containers, syncs the proxy, starts the supervisor and the webhook sender, and then serves the API. Startup work is bounded by 30 seconds. If Docker is unreachable, the agent exits with an error. If Caddy is unreachable, it logs the error and keeps retrying in the background.

On `SIGINT` or `SIGTERM` the agent shuts down gracefully within 30 seconds; queued notifications get 5 more seconds to be delivered. A second signal kills it immediately. See [Architecture](/docs/concepts/overview#agent-restarts-and-crashes).

## The production compose file

[`configs/compose.production.yml`](https://github.com/shipwick/shipwick/blob/main/configs/compose.production.yml) runs the agent, Caddy and the dashboard as one Compose project named `shipwick`. The installer writes it to `/opt/shipwick/compose.yml`. It reads these variables from a `.env` file next to it:

| Variable | Default | |
|---|---|---|
| `SHIPWICK_AGENT_TOKEN` | required | Passed to the agent. Compose refuses to start without it. |
| `SHIPWICK_AGENT_DOMAIN` | empty | Passed to the agent. Leave empty to not expose the API through Caddy. |
| `SHIPWICK_DASHBOARD_DOMAIN` | empty | Passed to the agent. Leave empty to not expose the dashboard. |
| `SHIPWICK_WEBHOOK_URL` | empty | Passed to the agent. Leave empty for no notifications. |
| `SHIPWICK_WEBHOOK_SECRET` | empty | Passed to the agent. |
| `SHIPWICK_HTTP_PORT` | `80` | Host port published for Caddy's port 80. |
| `SHIPWICK_HTTPS_PORT` | `443` | Host port published for Caddy's port 443, TCP and UDP. |
| `SHIPWICK_AGENT_IMAGE` | `ghcr.io/shipwick/agent:latest` | Agent image. |
| `SHIPWICK_DASHBOARD_IMAGE` | `ghcr.io/shipwick/dashboard:latest` | Dashboard image. |

The image defaults above are those of the file in the repository. In the copy that belongs to a release, which is what the installer fetches, both images are pinned to that release's version.

The installer writes `.env` once, on the first install, with the token and the two hostnames; a `SHIPWICK_WEBHOOK_URL`, `SHIPWICK_WEBHOOK_SECRET`, port or image variable that is set in the environment of that first run is written too. An existing `.env` is never rewritten, so to add or change the webhook later, edit `/opt/shipwick/.env` and run `cd /opt/shipwick && docker compose up -d`. `SHIPWICK_ENCRYPTION_KEY` is not among the file's variables: the agent keeps its key in the `agent-data` volume.

Override the ports only if something else owns 80 and 443. Automatic HTTPS needs the real ones to be reachable from the internet.

The file fixes the rest of the agent's configuration:

| Setting | Value |
|---|---|
| `SHIPWICK_CADDY_ADMIN` | `unix//run/caddy/admin.sock`, a socket in the `caddy-admin` volume that only the agent and Caddy mount |
| `SHIPWICK_LOG_FORMAT` | `json` |
| Dashboard's `SHIPWICK_AGENT_URL` | `http://agent:9000` |
| Agent port | Not published. The only ways in are Caddy and the server itself. |
| Caddy | `caddy:2-alpine`, started with a bootstrap configuration that contains only the admin socket. The agent loads the real configuration. |
| Networks | `shipwick`, shared by all three services and by application containers, and `shipwick-services`, joined by Caddy and by application containers, where Caddy finds an application's replicas by its name |
| Logs | Each of the three containers keeps at most 3 files of 10 MB, like application replicas |
| Restart policy | `unless-stopped` for all three services |

Volumes:

| Volume | Mounted in | Content |
|---|---|---|
| `agent-data` | agent, at `/var/lib/shipwick` | The data directory: the database and the encryption key. Back this volume up. |
| `caddy-data` | Caddy, at `/data` | Certificates. Back this volume up, and do not delete it casually. |
| `caddy-config` | Caddy, at `/config` | Caddy's own configuration directory. Caddy is started with `--resume`. |
| `caddy-admin` | agent and Caddy, at `/run/caddy` | The admin socket |

The agent also mounts `/var/run/docker.sock`, which is root-equivalent access to the server.

The installer replaces `/opt/shipwick/compose.yml` on every upgrade. Your own changes belong in `/opt/shipwick/compose.override.yml`, which Compose merges with it and the installer never touches. The two most common ones:

- **Private images.** Mount the server's `docker login` credentials into the agent: `/root/.docker/config.json:/root/.docker/config.json:ro`. See [Pull from private registries](/docs/tasks/private-registries).
- **No hostname for the API.** Leave `SHIPWICK_AGENT_DOMAIN` empty and publish the API on the server's loopback only, with `ports: ["127.0.0.1:9000:9000"]` on the agent, then reach it through an SSH tunnel. See [Reach the API without a hostname](/docs/tasks/access-without-a-hostname).

## Running the agent as a plain binary

The agent also runs as a plain binary on Linux, next to a Caddy installed on the host:

```bash
SHIPWICK_AGENT_TOKEN=… SHIPWICK_CADDY_ADMIN=http://127.0.0.1:2019 shipwick-agent
```

As a host process on Linux the agent reaches container addresses directly. With Docker Desktop on macOS or Windows it cannot, and warns at startup: applications with a `health` block cannot be deployed by a host-process agent there.
