---
title: Agent configuration
description: Every environment variable of the Shipwick agent with its default and meaning, the data directory, the encryption key and its rotation, the webhook, the Cloudflare token, the alert thresholds, where backups go, the scheduled export and the standby, how the API token is resolved and what roles are, the agent's subcommands, and the variables of the production compose file.
---

# Agent configuration

The agent is configured through `SHIPWICK_*` environment variables only. It has no configuration file and no flags. This page lists every variable, describes the data directory, the encryption key and how it is rotated, the webhook that notifications go to, the Cloudflare token, the alert thresholds, the variables that say where backups go, the scheduled export and the standby, the token resolution order and the roles of tokens, the agent's subcommands, and the variables that the production compose file adds.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| [`SHIPWICK_AGENT_TOKEN`](#api-token) | generated | The root API token, `admin`. At least 16 characters. |
| `SHIPWICK_LISTEN_ADDR` | `127.0.0.1:9000` | Address the API listens on. Loopback by default, on purpose. The agent image sets it to `0.0.0.0:9000`. |
| [`SHIPWICK_DATA_DIR`](#data-directory) | `/var/lib/shipwick` on Linux | Directory for the SQLite database, the token hash, the encryption key, the backups the agent takes, and the uploaded folders of static applications until they are deployed. |
| [`SHIPWICK_ENCRYPTION_KEY`](#shipwick-encryption-key) | generated | The key that encrypts `env` values, stored secrets, registry passwords and certificate keys in the database: 64 hexadecimal characters. Unset: `encryption.key` in the data directory, created on the first start and replaced by `shipwick server rotate-key`. |
| `SHIPWICK_DOCKER_NETWORK` | `shipwick` | Docker bridge network that application containers join. A second one, `<network>-services`, is derived from it: application containers join it too and carry their application's names on it while they are ready, and Caddy finds them there. Both are created if they do not exist. |
| [`SHIPWICK_CADDY_ADMIN`](#shipwick-caddy-admin) | none | Caddy's admin endpoint. Unset: domains are recorded but not served. |
| `SHIPWICK_AGENT_DOMAIN` | none | Serve the agent's API over HTTPS at this hostname, through Caddy. Requires `SHIPWICK_CADDY_ADMIN`. |
| `SHIPWICK_DASHBOARD_DOMAIN` | none | Serve the dashboard over HTTPS at this hostname, through Caddy. Requires `SHIPWICK_CADDY_ADMIN`. Must differ from `SHIPWICK_AGENT_DOMAIN`. |
| `SHIPWICK_DASHBOARD_UPSTREAM` | `dashboard:3000` | Where Caddy reaches the dashboard, as `host:port`. The host is a hostname or an IP address; the port is 1 to 65535. Validated only when `SHIPWICK_DASHBOARD_DOMAIN` is set. |
| [`SHIPWICK_WEBHOOK_URL`](#shipwick-webhook-url) | none | Where notifications are posted: a Slack or Discord webhook, or any HTTPS endpoint. Unset: no notifications. |
| [`SHIPWICK_WEBHOOK_SECRET`](#shipwick-webhook-secret) | none | Signs every notification, so that the endpoint can tell it came from the agent. Requires `SHIPWICK_WEBHOOK_URL`. |
| [`SHIPWICK_CLOUDFLARE_API_TOKEN`](#shipwick-cloudflare-api-token) | none | A Cloudflare API token. Certificates are then obtained through a DNS record, so hostnames can stay behind Cloudflare's proxy and can be wildcards. Requires `SHIPWICK_CADDY_ADMIN`. Since 0.5. |
| [`SHIPWICK_PROXY_TLS_ADDR`](#shipwick-proxy-tls-addr) | `caddy:443` | Where the agent reaches the proxy's TLS port, as `host:port`, to report each hostname's certificate. Since 0.5. |
| [`SHIPWICK_ALERT_MEMORY_PERCENT`](#shipwick-alert-memory-percent-and-shipwick-alert-disk-percent) | `90` | A replica at or above this share of its `resources.memory` raises an alert. A whole number from 50 to 100. Since 0.5. |
| [`SHIPWICK_ALERT_DISK_PERCENT`](#shipwick-alert-memory-percent-and-shipwick-alert-disk-percent) | `85` | The disk that holds the data directory raises an alert when it is this full. A whole number from 50 to 94. Since 0.5. |
| [`SHIPWICK_BACKUP_DIR`](#backups) | `<data dir>/backups` | Where the backups the agent takes are kept on the server. Since 0.5. |
| [`SHIPWICK_BACKUP_PASSPHRASE`](#backups) | none | Encrypts every backup, and is what allows the agent's own database and encryption key to be backed up at all. At least 12 characters. Since 0.5. |
| [`SHIPWICK_BACKUP_S3_ENDPOINT`](#backups) | none | An S3-compatible service the backups are also sent to, as a URL. Needs the next three as well. Since 0.5. |
| [`SHIPWICK_BACKUP_S3_BUCKET`](#backups) | none | The bucket. It must exist. |
| [`SHIPWICK_BACKUP_S3_ACCESS_KEY_ID`](#backups), [`SHIPWICK_BACKUP_S3_SECRET_ACCESS_KEY`](#backups) | none | Credentials that may put, get, list and delete objects in the bucket. |
| [`SHIPWICK_BACKUP_S3_REGION`](#backups) | `auto` | The region requests are signed for. |
| [`SHIPWICK_BACKUP_S3_PREFIX`](#backups) | none | Put in front of every object's key, so that one bucket serves several servers. |
| [`SHIPWICK_EXPORT_SCHEDULE`](#shipwick-export-schedule-and-shipwick-export-keep) | none | A five-field cron expression, UTC: when an export of the whole server is written to where backups go. Requires `SHIPWICK_BACKUP_PASSPHRASE`. Since 0.5. |
| [`SHIPWICK_EXPORT_KEEP`](#shipwick-export-schedule-and-shipwick-export-keep) | `3` | How many of those exports are kept. A number from 1 to 100. |
| [`SHIPWICK_STANDBY_SCHEDULE`](#shipwick-standby-schedule) | none | A five-field cron expression, UTC. Makes the server a standby: when it imports the newest export from the bucket, with every application stopped. Since 0.5. |
| `SHIPWICK_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `SHIPWICK_LOG_FORMAT` | `text` | `text` or `json`. Logs go to standard error. |
| `DOCKER_HOST`, `DOCKER_CONFIG` | Docker defaults | The standard Docker variables are honored. `DOCKER_CONFIG` is the directory that holds `config.json`, which the agent reads for the credentials of a registry it holds no stored credential for. |

The agent refuses to start with an invalid value: an unknown log level or format, a token shorter than 16 characters, a domain that is not a valid hostname, a domain without `SHIPWICK_CADDY_ADMIN`, identical agent and dashboard hostnames, a malformed dashboard upstream or proxy TLS address, an encryption key that is not 64 hexadecimal characters, a webhook URL that is not an absolute `https` URL (or `http` towards the server itself or a private address), a webhook secret without a webhook URL, a Cloudflare token of another form or without `SHIPWICK_CADDY_ADMIN`, an alert threshold out of its range, a backup passphrase shorter than 12 characters, a bucket with some of its four variables missing, a schedule that is not a cron expression, or a combination of schedules that the sections below rule out. Where the value is a credential, the error names the variable and the rule, never the value: a token, a key, a passphrase and a webhook URL are credentials.

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

The key the agent encrypts secret values with before it writes them to the database. Every `env` value and every basic-auth password of every deployment, every secret stored with `shipwick secret set`, every registry password stored with `shipwick registry login` and the key of every certificate supplied with `shipwick cert set` is stored as AES-256-GCM ciphertext; the variable names, and everything else in the record, stay readable. A copy of `shipwick.db` without the key reveals no secrets.

| | |
|---|---|
| Format | 64 hexadecimal characters: 32 random bytes. Generate one with `openssl rand -hex 32`. |
| Normalization | Leading and trailing whitespace is trimmed. |
| Invalid | The agent refuses to start: `SHIPWICK_ENCRYPTION_KEY: expected 64 hexadecimal characters (32 random bytes; generate one with: openssl rand -hex 32)`. The value itself is never repeated. |

The key is determined at startup, in this order:

1. **`SHIPWICK_ENCRYPTION_KEY`**, when set, always wins. Nothing is written to disk.
2. Otherwise, **the key file** in the data directory, `encryption.key`, written by a previous run.
3. Otherwise, **a key is generated** and written to `encryption.key`, mode `0600`, as 64 hexadecimal characters and a newline. The agent logs `created the key that encrypts env values in the database; back it up together with shipwick.db` with the file's path.

With the installer's setup the variable is unset and the key is the file in the `agent-data` volume. Setting it, in `/opt/shipwick/.env` or from wherever the agent's environment comes from, is for keeping the key somewhere other than next to the database, in a secrets manager for instance.

::: warning Back up the key together with the database
Without the key the database cannot be read. The agent proves the key against the stored values on every start and refuses to start with a key that does not match: `the encryption key does not match the database (deployment 12, variable DATABASE_URL): restore /var/lib/shipwick/encryption.key from your backup or set SHIPWICK_ENCRYPTION_KEY`. A key file that is not 64 hexadecimal characters is reported as corrupt, with the same two ways out. With `SHIPWICK_BACKUP_PASSPHRASE` set, the agent takes that backup itself, once a day and encrypted; see [Backups](#backups).
:::

**Rotation.** Since 0.5, `shipwick server rotate-key`, or **Rotate encryption key** on the dashboard's server page, has the running agent generate a new key and re-encrypt every stored value under it, in one transaction, without a deployment or a restart. It needs the `admin` role. What happens to the key afterwards depends on where it is kept:

| The key is | After a rotation |
|---|---|
| `encryption.key` in the data directory | The agent replaces the file. The new key is written next to it as `encryption.key.new` before the database is touched and moved into place afterwards, so a crash or a power cut at any point leaves a database and a key that fit; the next start finishes or discards what was interrupted. |
| `SHIPWICK_ENCRYPTION_KEY` | The agent cannot change its own environment. The command prints the new key once, for you to put where the variable is set, which the command takes to be `/opt/shipwick/.env`, before the agent restarts. Until it has been started with the new key, the agent keeps a copy in `encryption.key.new` in the data directory and refuses a second rotation; started with the old key, it refuses to start and says where the new one is; started with the new one, it removes the copy. |

Backups of the database made before a rotation still need the old key. See [Rotate the encryption key](/docs/tasks/rotate-the-encryption-key) for the procedure.

A database written by a release before 0.3.0 is migrated on the first start after upgrading: its environment values are encrypted in place, once, and the agent logs `encrypted the environment values of deployments written before encryption existed` with the number of deployments.

What this does and does not protect: a copy of the database file that left the server, a backup, a snapshot, is unreadable without the key. Root on the server can read the key file and the agent's memory, and the values inside a running container are shown by `docker inspect` to anyone with the Docker socket. See [Security](/docs/security).

### SHIPWICK_WEBHOOK_URL

Where the agent posts notifications: every deployment's outcome, every application that goes down or recovers, a failed job or scheduled backup, a certificate that is running out, and the alerts. Unset, nothing is sent. See [Get notified](/docs/tasks/notifications).

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
| `backup.failed` | A scheduled backup of an application failed, or the daily backup of the agent's own state did. A backup taken by hand tells the person who asked. Since 0.5. |
| `certificate.expiring` | A hostname's certificate has 14 days left, and again at 3: the proxy has not renewed it. Since 0.5. |
| `alert.raised` | A condition that lasts became true: a replica near its memory limit, the server's disk filling up, a replica restarted three times within ten minutes, an application that has not been healthy for five minutes. Sent once, and once more when a warning turns critical. Since 0.5. |
| `alert.cleared` | That condition no longer holds. Sent once. |

The alerts and their thresholds are described in [Alerts and metrics](/docs/tasks/alerts-and-metrics).

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

`message` is the same complete sentence the chat formats get. `deployment_id` is `null` for an event that is not about one deployment, such as `application.down`. `at` is UTC, in whole seconds. `server` is the hostname of the server the agent runs on, as Docker reports it. An `alert.raised` or `alert.cleared` event carries one more field, which the other events leave out: `"alert": {"kind": "memory", "severity": "warning", "replica": 1}`, where `kind` is `memory`, `disk`, `restarts` or `unhealthy`, `severity` is `warning` or `critical`, and `replica` is `0` when the condition is not about one replica.

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

### SHIPWICK_CLOUDFLARE_API_TOKEN

A Cloudflare API token with two permissions on the zones your hostnames are in: *Zone → Zone → Read* and *Zone → DNS → Edit*. Not the Global API Key. With it, Caddy obtains every certificate through a DNS record (the ACME DNS-01 challenge) instead of from the server itself, so a hostname's record can stay proxied by Cloudflare, and `domain` and `aliases` may be wildcards. A hostname that resolves to Cloudflare's addresses is then served instead of held back, and Cloudflare's address ranges become trusted proxies of Caddy, so applications find the visitor's address in `X-Forwarded-For`. See [Put Cloudflare in front](/docs/tasks/cloudflare).

| | |
|---|---|
| Format | Letters, digits, `-` and `_`, at least 35 characters. |
| Normalization | Leading and trailing whitespace is trimmed. |
| Invalid | The agent refuses to start: `SHIPWICK_CLOUDFLARE_API_TOKEN: not a Cloudflare API token (letters, digits, - and _, at least 35 characters); create one at dash.cloudflare.com → My Profile → API Tokens, not a Global API Key`. The value itself is never repeated. |
| Requires | `SHIPWICK_CADDY_ADMIN`: `SHIPWICK_CLOUDFLARE_API_TOKEN needs a reverse proxy to obtain certificates with it: set SHIPWICK_CADDY_ADMIN as well`. |

At startup the agent logs `certificates are obtained through Cloudflare DNS; hostnames may be proxied by Cloudflare, and may be wildcards`, and `GET /server` reports `proxy.dns_challenge: true`, which `shipwick doctor` reads.

The token can edit the DNS of your zones. The agent keeps it in memory, hands it to Caddy inside the configuration it loads, and removes it from Caddy's errors before they are logged or shown. It is never logged and never returned by the API. Caddy's autosaved copy of the configuration, on the `caddy-config` volume, contains it. See [Security](/docs/security).

Without the variable nothing changes: records must point straight at the server, and a deployment that names a wildcard is refused unless a certificate of your own covers it.

### SHIPWICK_PROXY_TLS_ADDR

Where the agent reaches the proxy's TLS port, as `host:port`. The agent opens a TLS handshake there with each hostname as the server name and reads the certificate a visitor would be handed: its issuer and its expiry. That is what `shipwick status` and the dashboard show for a hostname, and what `certificate.expiring` is decided from. Nothing is sent over the connection, and the chain is not verified: the agent reports what is served.

The default, `caddy:443`, is the Caddy service of the production compose file as the agent sees it on the `shipwick` network. Set the variable when the proxy's TLS port is somewhere else for the agent, as it is for an agent that runs as a plain binary next to a Caddy on the host; the production compose file does not pass it. A value that is not `host:port` is an error: `SHIPWICK_PROXY_TLS_ADDR: invalid value "caddy" (expected host:port)`. See [Certificates](/docs/tasks/certificates).

### SHIPWICK_ALERT_MEMORY_PERCENT and SHIPWICK_ALERT_DISK_PERCENT

The two thresholds of the [alerts](/docs/tasks/alerts-and-metrics) that have one.

| Variable | Default | Range | |
|---|---|---|---|
| `SHIPWICK_ALERT_MEMORY_PERCENT` | `90` | 50 to 100 | A replica at or above this share of its `resources.memory` for three samples in a row raises the `memory` alert. It is cleared ten points below the threshold. |
| `SHIPWICK_ALERT_DISK_PERCENT` | `85` | 50 to 94 | The disk that holds the data directory raises the `disk` alert, as a warning, when it is this full. It is cleared five points below the threshold. At 95% the alert turns critical, whatever is set here. |

The value is a whole number, with or without a trailing `%`. Anything else, or a number out of range, is an error that names the range: `SHIPWICK_ALERT_DISK_PERCENT: invalid value "99" (expected a whole number from 50 to 94)`.

The production compose file passes both from `/opt/shipwick/.env`.

### Backups

Since 0.5 the agent takes backups itself: of an application's volumes, on the schedule its [`backups`](/docs/reference/deploy-yaml#backups) block gives, and of its own state, daily. These variables say where the backups are kept and whether they are encrypted. See [Back up and restore volumes](/docs/tasks/backups).

| Variable | Default | |
|---|---|---|
| `SHIPWICK_BACKUP_DIR` | `<data dir>/backups` | The directory on the server. Every backup is written there, as `<application>/<id>/<volume>.tar`. Whitespace is trimmed. |
| `SHIPWICK_BACKUP_PASSPHRASE` | none | Encrypts every backup before it is written, in the directory and in the bucket; the files are then named `<volume>.tar.enc`. At least 12 characters; the variable is not trimmed. |
| `SHIPWICK_BACKUP_S3_ENDPOINT` | none | The URL of an S3-compatible service, such as `https://s3.eu-central-1.amazonaws.com` or `https://<account>.r2.cloudflarestorage.com`. A plain URL, without credentials or a query. |
| `SHIPWICK_BACKUP_S3_BUCKET` | none | The bucket's name. It must exist; the agent does not create it. |
| `SHIPWICK_BACKUP_S3_ACCESS_KEY_ID` | none | With the next one: credentials that may put, get, list and delete objects in the bucket. |
| `SHIPWICK_BACKUP_S3_SECRET_ACCESS_KEY` | none | |
| `SHIPWICK_BACKUP_S3_REGION` | `auto` | The region requests are signed for. AWS wants the bucket's own. |
| `SHIPWICK_BACKUP_S3_PREFIX` | none | Put in front of every object's key: one bucket for several servers, each under its own prefix. Leading and trailing slashes are dropped. |

**The directory.** With the installer's setup the default is inside the `agent-data` volume. A backup on the same disk protects against a bad deployment, a dropped table, a mistake; it does not protect against losing the server. To move the directory, to a mount of another disk for instance, add the mount to the agent in `/opt/shipwick/compose.override.yml` and set `SHIPWICK_BACKUP_DIR` in `/opt/shipwick/.env` to where it is mounted.

**The bucket.** The endpoint, the bucket and the two keys belong together. With all four set, every backup goes to the directory and to the bucket, under `<prefix>/<application>/<id>/`, and one that did not reach both has failed. With only some of them set, the agent refuses to start and names what is missing: `SHIPWICK_BACKUP_S3_ENDPOINT is set but SHIPWICK_BACKUP_S3_BUCKET, SHIPWICK_BACKUP_S3_ACCESS_KEY_ID, SHIPWICK_BACKUP_S3_SECRET_ACCESS_KEY is not: a bucket needs all four`. The endpoint and the bucket's name are checked at startup as well, so that a mistake stops the agent then rather than failing the first backup; the errors never repeat a value. The values of all six `S3` variables are trimmed.

A bucket belongs to one server. The agent marks the bucket, under its prefix, the first time it writes there, and refuses a bucket marked by another installation. Two servers share a bucket by giving each a `SHIPWICK_BACKUP_S3_PREFIX`. An archive larger than 5 GB does not fit one upload and fails; such a volume is backed up to the server only.

**The passphrase.** With `SHIPWICK_BACKUP_PASSPHRASE` set, everything is encrypted before it is written anywhere: AES-256-GCM with a key derived from the passphrase. Backups written before the passphrase was set stay readable; if the passphrase changes, the ones written with the old one are not. Keep a copy somewhere that is not this server: without it the backups cannot be read. A passphrase shorter than 12 characters is an error: `SHIPWICK_BACKUP_PASSPHRASE must be at least 12 characters long`.

The passphrase is also what allows the agent's own state to be backed up at all. `shipwick.db` and `encryption.key` are backed up once a day, kept seven deep under `_agent/` where application backups go, and only ever written encrypted: without a passphrase the key is written nowhere. The agent then warns at startup, `the agent's own state is not backed up: the encryption key exists only on this server, and losing it loses every secret`, and `shipwick doctor` and `GET /server` say so.

**What is logged.** At startup, either `backups go to a bucket as well as to the server` with the directory, the endpoint's host and the bucket's name, or `backups stay on the server: they survive a bad deployment, not the loss of the server` with the directory. The passphrase and the bucket's two keys are never logged and never returned by the API.

The installer writes the passphrase and the six `S3` variables to `/opt/shipwick/.env` when they are set in the environment of the first run. To add them later, edit that file and run `cd /opt/shipwick && docker compose up -d`.

### SHIPWICK_EXPORT_SCHEDULE and SHIPWICK_EXPORT_KEEP

`SHIPWICK_EXPORT_SCHEDULE` has the server write an export of itself, the file `shipwick export` produces, to where its backups go: to the backup directory and, when one is configured, to the bucket, as `<prefix>/_export/<id>/export.tar.enc`. It is encrypted with `SHIPWICK_BACKUP_PASSPHRASE`. This is the first half of [a second server kept ready](/docs/tasks/move-to-a-new-server).

| Variable | Default | |
|---|---|---|
| `SHIPWICK_EXPORT_SCHEDULE` | none | A cron expression of five fields, in UTC, such as `0 * * * *`. Unset: an export is written only on request, with `shipwick export --to-backups`. |
| `SHIPWICK_EXPORT_KEEP` | `3` | How many exports are kept. A number from 1 to 100; anything else is an error, `SHIPWICK_EXPORT_KEEP must be a number from 1 to 100`. |

An export holds every secret of the server, so it is only ever written encrypted. Without a passphrase the agent refuses to start: `SHIPWICK_EXPORT_SCHEDULE needs SHIPWICK_BACKUP_PASSPHRASE: an export is only ever written encrypted`. A schedule that does not parse is an error that ends with `(five fields, UTC, for example "0 4 * * *")`.

Like every backup an export is one upload, so with a bucket configured an export larger than 5 GB fails. At startup the agent logs `an export of the server is written on a schedule, to where backups go` with the schedule and the number kept.

### SHIPWICK_STANDBY_SCHEDULE

Makes the server a standby for another one. At the times the cron expression names, five fields in UTC, the agent fetches the newest export from the bucket and imports it with every application deployed and not started: images pulled or loaded, volumes filled, containers created, nothing running and nothing routed. `shipwick standby promote` starts them. See [Move to a new server](/docs/tasks/move-to-a-new-server).

The standby needs the bucket and the passphrase of the server it stands by for: the `SHIPWICK_BACKUP_S3_*` variables and `SHIPWICK_BACKUP_PASSPHRASE`, set to the values that server has. Without them the agent refuses to start and says so. It also refuses both schedules at once: `SHIPWICK_EXPORT_SCHEDULE and SHIPWICK_STANDBY_SCHEDULE are both set: a server writes exports or stands by for one that does`.

A standby only reads the bucket. For as long as the variable is set, its own backups stay on its disk, so that the two servers never write to the same place. The agent logs `this server is a standby: it imports the newest export from the bucket on a schedule, with every application stopped, and keeps its own backups on its disk` with the schedule, the endpoint's host and the bucket's name. After a promotion, remove the variable, and give the server's backups a bucket prefix of their own before you point `SHIPWICK_BACKUP_S3_*` at a bucket again.

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
| `shipwick.db` | The SQLite database: applications, deployments with their full configuration, replicas, events, job runs, metrics and traffic samples, the secrets stored with `shipwick secret set`, the registry credentials stored with `shipwick registry login`, the certificates supplied with `shipwick cert set`, the record of every backup, and the hashes of the tokens created with `shipwick token create`. Environment values, basic-auth passwords, secrets, registry passwords and certificate keys are encrypted. It runs in WAL mode, so SQLite keeps its `-wal` and `-shm` files next to it. |
| `encryption.key` | The key those values are encrypted with: 64 hexadecimal characters. Mode `0600`. Created on the first start, unless `SHIPWICK_ENCRYPTION_KEY` is set, and replaced by a rotation. See [`SHIPWICK_ENCRYPTION_KEY`](#shipwick-encryption-key). |
| `encryption.key.new` | The new key of a rotation. With the key in the file it exists only for the moment the rotation takes; with the key in `SHIPWICK_ENCRYPTION_KEY` it stays until the agent has been started with the new key. |
| `agent-token.sha256` | The hex-encoded SHA-256 hash of a token the agent generated itself. Mode `0600`. Present only if the agent ever generated its token. |
| `backups/` | The backups the agent takes, unless `SHIPWICK_BACKUP_DIR` names another directory: `<application>/<id>/<volume>.tar` for an application's volumes, `_agent/` for the agent's own state, `_export/` for exports written to where backups go. With `SHIPWICK_BACKUP_PASSPHRASE` the files end in `.enc`. See [Backups](#backups). |
| `uploads/` | The folders of static applications uploaded with `shipwick deploy`, kept until they are deployed. Nothing here needs a backup: the next `shipwick deploy` uploads the folder again. |

::: warning Protect this directory, and back it up as a whole
`shipwick.db` and `encryption.key` belong together: the database is only readable with the key, and the key is only useful with the database. Anyone who can read both can read every application's secrets, so the directory stays `0700`. A backup of one without the other is worthless. The agent backs up both itself, encrypted, once `SHIPWICK_BACKUP_PASSPHRASE` is set; a copy that stays in `backups/` on the same disk does not survive the loss of the server, which is what the bucket is for.
:::

The database schema is migrated automatically at startup. An agent refuses to open a database whose schema is newer than it supports, and asks to be upgraded.

## API token

The agent authenticates every API request, except `GET /api/v1/health`, against the SHA-256 hash of a token. Every token has a **role**, and every endpoint requires one; a role includes the ones below it:

| Role | May |
|---|---|
| `read` | See everything: the server, the applications, deployments, logs, events, metrics, traffic, the backups taken, the names of the secrets, the registries a credential is stored for, the supplied certificates without their keys, the volumes. `GET /metrics` for a Prometheus scraper needs no more. |
| `deploy` | And change what runs: deploy, redeploy, roll back, stop, start, run commands, upload images and static folders, take a backup and verify one. |
| `admin` | And everything else: delete applications, manage tokens, secrets, registry credentials and certificates, rotate the encryption key, download, restore and remove backups and volumes, back up the agent's state, export and import, pull and promote on a standby. |

There are two kinds of token. The **root token** is the one this section is about: the token the agent is configured with, through `SHIPWICK_AGENT_TOKEN` or generated on the first start. It has the `admin` role and the name `root`, it is not stored in the database, and it cannot be revoked through the API. It is the one the installer prints, and the one to keep for yourself.

Every other token is created with `shipwick token create <name> --role read|deploy|admin`, is shown exactly once, and is stored as a hash in `shipwick.db` with its name and role. `shipwick token ls` shows when each was last used; `shipwick token revoke <name>` ends it. Give CI a `deploy` token and people `admin` ones. A wrong or revoked token is `401 UNAUTHORIZED`; a valid token whose role does not cover the request is `403 FORBIDDEN`, and the answer says which role it has and which it needs. After 20 failed authentications within a minute from one client address, the agent answers wrong tokens from that address with `429 RATE_LIMITED` and a `Retry-After` header for the next minute; a valid token is never refused, and `GET /api/v1/health` is not limited. Deployments record which token made them. See [Create tokens for CI and teammates](/docs/tasks/tokens).

The root token's hash is determined at startup, in this order:

1. **`SHIPWICK_AGENT_TOKEN`**, when set, always wins. Its hash is kept in memory. Nothing is written to disk.
2. Otherwise, **the hash persisted in the data directory** by a previous run (`agent-token.sha256`).
3. Otherwise, **a token is generated**: `swk_` followed by 64 hexadecimal characters, from 32 random bytes. Only its hash is persisted. The token itself is printed once to standard output.

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

At startup the agent resolves the root token and the encryption key, opens the database and encrypts any values an earlier release left in plain text, connects to Docker, ensures the two application networks exist and joins the first if the agent runs in a container, resumes the deployments it finds mid-flight and removes leftover containers, syncs the proxy, starts the supervisor, the webhook sender, the backup scheduler and the scheduled export or standby import, and then serves the API. Opening the database also settles a key rotation that was interrupted: the pending key is promoted or discarded, whichever fits the data. Startup work is bounded by 30 seconds. If Docker is unreachable, the agent exits with an error. If Caddy is unreachable, it logs the error and keeps retrying in the background. If the backup scheduler cannot be started, the agent logs `could not start the backup scheduler; no backups are taken until the agent is restarted` and carries on.

On `SIGINT` or `SIGTERM` the agent shuts down gracefully within 30 seconds; a deployment that is running is left as it is and resumed at the next start, and queued notifications get 5 more seconds to be delivered. A second signal kills it immediately. See [Architecture](/docs/concepts/overview#agent-restarts-and-crashes).

## The production compose file

[`configs/compose.production.yml`](https://github.com/shipwick/shipwick/blob/main/configs/compose.production.yml) runs the agent, Caddy and the dashboard as one Compose project named `shipwick`. The installer writes it to `/opt/shipwick/compose.yml`. It reads these variables from a `.env` file next to it:

| Variable | Default | |
|---|---|---|
| `SHIPWICK_AGENT_TOKEN` | required | Passed to the agent. Compose refuses to start without it. |
| `SHIPWICK_AGENT_DOMAIN` | empty | Passed to the agent. Leave empty to not expose the API through Caddy. |
| `SHIPWICK_DASHBOARD_DOMAIN` | empty | Passed to the agent. Leave empty to not expose the dashboard. |
| `SHIPWICK_WEBHOOK_URL` | empty | Passed to the agent. Leave empty for no notifications. |
| `SHIPWICK_WEBHOOK_SECRET` | empty | Passed to the agent. |
| `SHIPWICK_CLOUDFLARE_API_TOKEN` | empty | Passed to the agent. Leave empty to obtain certificates from the server itself. |
| `SHIPWICK_ALERT_MEMORY_PERCENT`, `SHIPWICK_ALERT_DISK_PERCENT` | empty | Passed to the agent. Empty means the defaults, 90 and 85. |
| `SHIPWICK_BACKUP_PASSPHRASE` | empty | Passed to the agent. Leave empty for backups that are not encrypted, and no backup of the agent's own state. |
| `SHIPWICK_BACKUP_S3_ENDPOINT`, `SHIPWICK_BACKUP_S3_BUCKET`, `SHIPWICK_BACKUP_S3_ACCESS_KEY_ID`, `SHIPWICK_BACKUP_S3_SECRET_ACCESS_KEY`, `SHIPWICK_BACKUP_S3_REGION`, `SHIPWICK_BACKUP_S3_PREFIX` | empty | Passed to the agent. Leave empty for backups that stay on the server. |
| `SHIPWICK_EXPORT_SCHEDULE`, `SHIPWICK_EXPORT_KEEP`, `SHIPWICK_STANDBY_SCHEDULE` | empty | Passed to the agent. |
| `SHIPWICK_HTTP_PORT` | `80` | Host port published for Caddy's port 80. |
| `SHIPWICK_HTTPS_PORT` | `443` | Host port published for Caddy's port 443, TCP and UDP. |
| `SHIPWICK_AGENT_IMAGE` | `ghcr.io/shipwick/agent:latest` | Agent image. |
| `SHIPWICK_DASHBOARD_IMAGE` | `ghcr.io/shipwick/dashboard:latest` | Dashboard image. |
| [`SHIPWICK_CADDY_IMAGE`](#shipwick-caddy-image) | `ghcr.io/shipwick/caddy:latest` | Proxy image. Since 0.5. |

The image defaults above are those of the file in the repository. In the copy that belongs to a release, which is what the installer fetches, the three images are pinned to that release's version.

The installer writes `.env` once, on the first install, with the token and the two hostnames. A port, an image, a webhook variable, the Cloudflare token, the backup passphrase, an `S3` variable or one of the three schedule variables that is set in the environment of that first run is written too, and so are the two alert thresholds. An existing `.env` is never rewritten, so to add or change any of them later, edit `/opt/shipwick/.env` and run `cd /opt/shipwick && docker compose up -d`. `SHIPWICK_PROXY_TLS_ADDR` is not among the file's variables: the agent finds the proxy at `caddy:443`. To set it, give it to the agent under `environment` in `compose.override.yml`.

Override the ports only if something else owns 80 and 443. Automatic HTTPS needs the real ones to be reachable from the internet.

### SHIPWICK_CADDY_IMAGE

Since 0.5 the proxy is Shipwick's own build of Caddy, `ghcr.io/shipwick/caddy`: Caddy 2.11.6 with the Cloudflare DNS module and nothing else added. The official image has no DNS providers, and a certificate for a hostname behind Cloudflare's proxy, or for a wildcard, can only be obtained through a DNS record. Every installation runs this image, whether or not `SHIPWICK_CLOUDFLARE_API_TOKEN` is set, and it is pinned to the release like the agent and the dashboard: the agent generates this Caddy's configuration, so a newer Caddy arrives with a release of Shipwick, not on its own.

`SHIPWICK_CADDY_IMAGE` in `.env` names another image, one you built from [`Dockerfile.caddy`](https://github.com/shipwick/shipwick/blob/main/Dockerfile.caddy) for instance. The installer removes the images of earlier releases from the `ghcr.io/shipwick/caddy` repository, as it does for the agent and the dashboard, and keeps the one the compose file names.

The file fixes the rest of the agent's configuration:

| Setting | Value |
|---|---|
| `SHIPWICK_CADDY_ADMIN` | `unix//run/caddy/admin.sock`, a socket in the `caddy-admin` volume that only the agent and Caddy mount |
| `SHIPWICK_LOG_FORMAT` | `json` |
| Dashboard's `SHIPWICK_AGENT_URL` | `http://agent:9000` |
| Agent port | Not published. The only ways in are Caddy and the server itself. |
| Caddy | [`ghcr.io/shipwick/caddy`](#shipwick-caddy-image), started with a bootstrap configuration that contains only the admin socket. The agent loads the real configuration, which also compresses responses with zstd or gzip when the client asks for it. |
| Networks | `shipwick`, shared by all three services and by application containers, and `shipwick-services`, joined by Caddy and by application containers, where Caddy finds an application's replicas by its name |
| Logs | Each of the three containers keeps at most 3 files of 10 MB, like application replicas |
| Restart policy | `unless-stopped` for all three services |

Volumes:

| Volume | Mounted in | Content |
|---|---|---|
| `agent-data` | agent, at `/var/lib/shipwick` | The data directory: the database, the encryption key and the backups the agent takes. Back this volume up, or let the agent do it: see [Backups](#backups). |
| `caddy-data` | Caddy, at `/data` | Certificates. Back this volume up, and do not delete it casually. |
| `caddy-config` | Caddy, at `/config` | The configuration the agent loaded last; Caddy is started with `--resume`. With `SHIPWICK_CLOUDFLARE_API_TOKEN` set it contains that token, and it contains the keys of supplied certificates. Mounted by Caddy alone. |
| `caddy-static` | Caddy, at `/srv/shipwick` | The folders of static applications: the agent puts them there and Caddy serves them itself, with no container in between. Nothing here needs a backup. |
| `caddy-admin` | agent and Caddy, at `/run/caddy` | The admin socket |

The agent also mounts `/var/run/docker.sock`, which is root-equivalent access to the server.

The installer replaces `/opt/shipwick/compose.yml` on every upgrade, and removes the agent, dashboard and proxy images of earlier releases once the upgraded agent is healthy. Your own changes belong in `/opt/shipwick/compose.override.yml`, which Compose merges with it and the installer never touches. The most common ones:

- **Private images, with `docker login`.** Since 0.5 the agent keeps registry credentials itself, stored with `shipwick registry login`, and needs no mount for them. A mount of the server's `docker login` credentials into the agent, `/root/.docker/config.json:/root/.docker/config.json:ro`, keeps working for registries without a stored credential. See [Pull from private registries](/docs/tasks/private-registries).
- **Backups on another disk.** Mount the disk into the agent and set `SHIPWICK_BACKUP_DIR` to the mount point. See [Backups](#backups).
- **No hostname for the API.** Leave `SHIPWICK_AGENT_DOMAIN` empty and publish the API on the server's loopback only, with `ports: ["127.0.0.1:9000:9000"]` on the agent, then reach it through an SSH tunnel. See [Reach the API without a hostname](/docs/tasks/access-without-a-hostname).

## Running the agent as a plain binary

The agent also runs as a plain binary on Linux, next to a Caddy installed on the host:

```bash
SHIPWICK_AGENT_TOKEN=… SHIPWICK_CADDY_ADMIN=http://127.0.0.1:2019 shipwick-agent
```

As a host process on Linux the agent reaches container addresses directly. With Docker Desktop on macOS or Windows it cannot, and warns at startup: applications with a `health` block cannot be deployed by a host-process agent there.
