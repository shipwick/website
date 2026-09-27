---
title: deploy.yaml
description: Complete reference of the deploy.yaml file, with every field, its type, default and validation rules, the units it accepts, ${NAME} placeholders, and the format of validation errors.
---

# deploy.yaml

`deploy.yaml` describes one application: its image and how to run it. This page lists every field with its type, default and validation rules, the units used for sizes and durations, how `${NAME}` placeholders are filled in, and the error format that `shipwick` and the API produce.

## The file

```yaml
name: my-api
image: ghcr.io/company/my-api:1.4.2
port: 8080
domain: api.example.com
replicas: 2
```

- Only `name` and `image` are required.
- The file is YAML. JSON is accepted too, since it is a subset of YAML.
- One file describes one application. A file with several YAML documents is rejected.
- The maximum size is 64 KB.
- **Unknown fields are errors.** A misspelled key is reported, not ignored.
- `shipwick` looks for `deploy.yaml` in the current directory; `-f` / `--file` selects another file, and can be repeated to deploy several applications. `shipwick init` writes a starter file, and `shipwick validate` checks a file offline and prints it as it will be applied, defaults included.

The same parser and validator run in `shipwick` and in the agent. The agent validates every submitted document again, whatever the client did.

### Placeholders

A value may refer to something the file must not contain, such as a password, as `${NAME}`:

```yaml
env:
  DATABASE_URL: postgres://app:${DATABASE_PASSWORD}@postgres:5432/app
```

`shipwick` replaces every `${NAME}` before the file is validated or sent, from its own environment or from a file given with `--env-file`. A name that is set nowhere is an error, never an empty value. The agent receives a complete document with nothing left to resolve; through the API, a placeholder is stored literally. The rules are in the [CLI reference](/docs/reference/cli#placeholders).

## Fields

| Field | Type | Required | Default |
|---|---|---|---|
| [`name`](#name) | string | yes | |
| [`image`](#image) | string | yes | |
| [`entrypoint`](#entrypoint) | list of strings, or one string | no | the image's `ENTRYPOINT` |
| [`command`](#command) | list of strings, or one string | no | the image's `CMD` |
| [`user`](#user) | string | no | the image's `USER` |
| [`port`](#port) | integer | with `domain` or `health.path` | none |
| [`domain`](#domain) | string | no | none |
| [`aliases`](#aliases) | list of strings | no | none |
| [`redirects`](#redirects) | list of strings | no | none |
| [`replicas`](#replicas) | integer | no | `1` |
| [`env`](#env) | map of string to string | no | none |
| [`health.path`](#health) | string | one of `path`, `tcp`, `command` with `health` | |
| [`health.tcp`](#health) | integer | one of `path`, `tcp`, `command` with `health` | |
| [`health.command`](#health) | list of strings | one of `path`, `tcp`, `command` with `health` | |
| [`health.interval`](#health) | duration | no | `10s` |
| [`health.timeout`](#health) | duration | no | `3s` |
| [`health.retries`](#health) | integer | no | `3` |
| [`resources.cpu`](#resources) | number | no | unlimited |
| [`resources.memory`](#resources) | size | no | unlimited |
| [`volumes[].name`](#volumes) | string | with `volumes` | |
| [`volumes[].path`](#volumes) | string | with `volumes` | |
| [`publish[].port`](#publish) | integer | with `publish` | |
| [`publish[].host`](#publish) | integer | no | the same as `port` |
| [`publish[].address`](#publish) | string | no | every address of the server |
| [`publish[].protocol`](#publish) | string | no | `tcp` |
| [`logging.driver`](#logging) | string | with `logging` | |
| [`logging.options`](#logging) | map of string to string | no | none |
| [`pre_deploy.command`](#pre-deploy) | list of strings | with `pre_deploy` | |
| [`pre_deploy.timeout`](#pre-deploy) | duration | no | `10m` |
| [`jobs[].name`](#jobs) | string | with `jobs` | |
| [`jobs[].schedule`](#jobs) | string | with `jobs` | |
| [`jobs[].command`](#jobs) | list of strings | with `jobs` | |
| [`jobs[].timeout`](#jobs) | duration | no | `1h` |
| [`restart.policy`](#restart) | string | no | `always` |
| [`deploy.strategy`](#deploy) | string | no | `rolling` |

### name

Identifies the application on the server. It appears in container names, Docker labels, API URLs and the proxy configuration, and it is the hostname under which other applications on the server reach this one, so the alphabet is deliberately strict.

| | |
|---|---|
| Type | string |
| Required | yes |
| Rule | A DNS label: lowercase letters, digits and dashes; must start and end with a letter or digit; 1 to 63 characters. Pattern: `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` |
| Reserved | `agent`, `caddy`, `dashboard` and `localhost` cannot be application names. They belong to Shipwick's own containers on the network the applications share. |

```yaml
name: my-api
```

Underscores are not allowed. Container names have the form `shipwick_<name>_<deployment>_<replica>` and rely on that.

Other applications on the server reach this one at `http://<name>:<port>`, where `port` is the one in this file. See [Call one application from another](/docs/tasks/call-another-application).

When deploying through the API, the name in the document must match the name in the URL.

### image

The image to run. Any image reference Docker understands.

| | |
|---|---|
| Type | string |
| Required | yes |
| Rule | A well-formed image reference without whitespace. Leading and trailing whitespace is trimmed. |

```yaml
image: ghcr.io/company/my-api:1.4.2
```

The deployment's **version** is derived from the reference:

| Reference | Version |
|---|---|
| With a tag: `ghcr.io/company/my-api:1.4.2` | The tag: `1.4.2` |
| With a digest only: `my-api@sha256:4f2a…` | `sha256:` and the first 12 hex characters of the digest |
| With neither: `nginx` | `latest` |

Pin a version tag. Deployments are recorded, and rolled back, by it.

`shipwick deploy --image <ref>` replaces this field for one deployment without changing the file. For private registries, see [Pull from private registries](/docs/tasks/private-registries).

### entrypoint

Replaces the image's `ENTRYPOINT`, the way `docker run --entrypoint` does. Omit it to keep the image's own.

| | |
|---|---|
| Type | list of strings, or one string |
| Required | no |
| Default | the image's `ENTRYPOINT` |
| Rule | 1 to 64 arguments. No argument contains a newline, a carriage return or a NUL byte. An empty list is an error: omit the field instead. |

```yaml
entrypoint: ["dotnet"]
```

The arguments reach the container exactly as written. **A string is one argument**, spaces included: there is no shell in between, so `entrypoint: dotnet App.dll` starts a program called `dotnet App.dll`. Use a list for several arguments. A value that is neither a string nor a list of strings is a syntax error, reported with its line number.

Whatever runs, runs inside the container, as the image's own command would. Nothing in `deploy.yaml` runs on the server.

### command

Replaces the image's `CMD`, the way the arguments after the image do in `docker run`. Same type and rules as [`entrypoint`](#entrypoint).

| | |
|---|---|
| Type | list of strings, or one string |
| Required | no |
| Default | the image's `CMD` |
| Rule | 1 to 64 arguments. No argument contains a newline, a carriage return or a NUL byte. An empty list is an error: omit the field instead. |

```yaml
image: ghcr.io/company/my-api:1.4.2
command: ["node", "worker.js"]
```

The usual reason: a worker, or a second program, from the same image as the API. As a string, `command: node worker.js` would start a program called `node worker.js`.

### user

The user the process runs as, replacing the image's `USER`, like `docker run --user`.

| | |
|---|---|
| Type | string |
| Required | no |
| Default | the image's `USER` |
| Rule | A user name or a numeric id, alone or as `user:group`. A name is a lowercase letter or underscore followed by up to 31 lowercase letters, digits, underscores or dashes; an id is 1 to 10 digits. Pattern: `^([a-z_][a-z0-9_-]{0,31}\|[0-9]{1,10})(:([a-z_][a-z0-9_-]{0,31}\|[0-9]{1,10}))?$` |
| Normalization | Leading and trailing whitespace is trimmed. |

```yaml
user: "1000:1000"
```

`app`, `1000`, `1000:1000`, `1000:app` and `app:app` are all valid. A bare number, `user: 1000`, is read as the id `1000`. A name is resolved by the container's own `/etc/passwd`, so it has to exist in the image.

### port

The port the application listens on inside the container. The reverse proxy, an HTTP health check and the other applications on the server reach it over the private networks. It is not published on the server unless [`publish`](#publish) lists it.

| | |
|---|---|
| Type | integer |
| Required | when `domain` or `health.path` is set |
| Rule | 1 to 65535 |

```yaml
port: 8080
```

A `tcp` health check names its own port and a `command` check needs none, so neither requires this field.

An application without a `port` gets no name on the services network, so other applications cannot call it.

### domain

The public hostname of the application. Caddy serves it over HTTPS with an automatically obtained certificate. See [Routing and HTTPS](/docs/concepts/routing-and-https).

| | |
|---|---|
| Type | string |
| Required | no. Requires `port`. |
| Rule | A plain hostname: dot-separated labels of lowercase letters, digits and dashes, each 1 to 63 characters and starting and ending with a letter or digit; at most 253 characters in total. No scheme, port, path or wildcard. |
| Normalization | Trimmed and converted to lowercase. |

```yaml
domain: api.example.com
```

More hostnames are added with [`aliases`](#aliases), served exactly like the domain, and [`redirects`](#redirects), answered with a redirect to it.

A hostname belongs to one application, in any role. A deployment that claims a hostname already in use — as another application's domain, alias or redirect, or by the agent's API or the dashboard — is refused before anything is started. The error is shaped like a validation error, and its field names the line to change: `domain`, `aliases[0]`, `redirects[1]`. Its message names the owner: `already served by application "web"`, or `already served by Shipwick itself (the agent or the dashboard)`. A redeploy or a rollback is checked the same way, since a stored configuration's hostnames may have been taken since.

An application that is only called by other applications on the server needs no domain.

### aliases

More hostnames served exactly like `domain`: the same route, the same replicas. Each gets its own certificate; point each one's DNS at the server. See [Serve several hostnames and redirect www](/docs/tasks/several-hostnames).

| | |
|---|---|
| Type | list of strings |
| Required | no. Requires `domain`. |
| Rule | At most 20 entries. Each is a hostname by the same rule as `domain`, and is listed once across `domain`, `aliases` and `redirects`. |
| Normalization | Each entry is trimmed and converted to lowercase. The order is kept. |

```yaml
domain: example.com
aliases: [api.example.com]
```

Without a `domain`, `aliases` is an error: an alias is served like the domain, so there has to be one. A hostname that appears twice, in whichever lists, is reported on its second occurrence: `"example.com" is already listed under domain`, `"a.example.com" is already listed under aliases[0]`.

Like the domain, an alias in use by another application or by Shipwick itself is refused by the agent, with an error on `aliases[i]`.

### redirects

Hostnames answered with a `308` redirect to `https://<domain>`, with the same path and query; the method is kept. For `www.example.com` and old domains.

| | |
|---|---|
| Type | list of strings |
| Required | no. Requires `domain`. |
| Rule | At most 20 entries. Each is a hostname by the same rule as `domain`, and is listed once across `domain`, `aliases` and `redirects`. |
| Normalization | Each entry is trimmed and converted to lowercase. The order is kept. |

```yaml
domain: example.com
redirects: [www.example.com, example.net]
```

`https://www.example.com/docs?x=1` is answered with a `308` to `https://example.com/docs?x=1`. A redirect needs no replica: it is answered whether or not the application is running, including while it is stopped. Every redirected hostname gets its own certificate, so its DNS must point at the server.

Without a `domain`, `redirects` is an error: a redirect is sent to the domain. A hostname in use anywhere is refused like an alias, with an error on `redirects[i]`.

### replicas

The number of identical containers to run.

| | |
|---|---|
| Type | integer |
| Default | `1` |
| Rule | 1 to 50. Must be `1` when `volumes` or `publish` is set. |

```yaml
replicas: 2
```

Replicas cannot share a volume, and cannot share a server port. With both `volumes` and `publish` in the file, the volume rule is the one reported.

### env

Environment variables passed to every replica, and to the [`pre_deploy`](#pre-deploy) command, the [`jobs`](#jobs) and `shipwick run`.

| | |
|---|---|
| Type | map of string to string |
| Default | none |
| Key rule | Letters, digits and underscores, not starting with a digit. Pattern: `^[A-Za-z_][A-Za-z0-9_]*$` |
| Value rule | Must not contain NUL bytes. |

```yaml
env:
  DATABASE_URL: postgres://app:${DATABASE_PASSWORD}@postgres:5432/app
  LOG_LEVEL: info
```

Values are stored on the server with the deployment. They are never logged and never echoed in validation errors. In every API response they are masked as `********`; the names are kept.

A value that must not be in the file is written as a [placeholder](#placeholders), `${DATABASE_PASSWORD}` above, and filled in by `shipwick` when you deploy.

::: info Values are encrypted at rest
Environment values are encrypted with AES-256-GCM before they are written to the agent's database; the variable names, and everything else in the record, stay readable. The key is `encryption.key` in the agent's data directory, or `SHIPWICK_ENCRYPTION_KEY`. Back the key up together with the database: without it the database cannot be read. Encryption protects a copy of the database file, not the values inside a running container, which anyone with the Docker socket can read. See [Security](/docs/security) and [Agent configuration](/docs/reference/agent-configuration#shipwick-encryption-key).
:::

### health

The health check run against every replica. A check is one of three kinds, and exactly one of `path`, `tcp` and `command` is set; `interval`, `timeout` and `retries` mean the same for each. See [Health checks and supervision](/docs/concepts/health-and-supervision).

| Field | Type | Rule | Healthy when |
|---|---|---|---|
| `health.path` | string | Starts with `/`; at most 2048 characters; no whitespace or control characters; a valid URL path without scheme or host. Requires `port`. | `GET <path>` on `port` answers with a 2xx status. Redirects are not followed and do not count. |
| `health.tcp` | integer | A container port, 1 to 65535. `port` is not needed. | A TCP connection to that port is accepted. |
| `health.command` | list of strings | 1 to 64 arguments, none empty, none containing a NUL byte. A list, not a string. The program has to exist in the image. `port` is not needed. | The command, run inside the replica, exits with code 0. |

| Field | Type | Default | Rule |
|---|---|---|---|
| `health.interval` | duration | `10s` | `1s` to `5m` |
| `health.timeout` | duration | `3s` | `100ms` to `1m` |
| `health.retries` | integer | `3` | 1 to 100 |

```yaml
port: 8080
health:
  path: /health
  interval: 10s
  timeout: 3s
  retries: 3
```

```yaml
health:
  tcp: 5432
```

```yaml
health:
  command: ["pg_isready", "-U", "postgres"]
```

`path` is for anything that speaks HTTP. `tcp` says that the process is listening, which for a queue or a cache is usually all there is to know. `command` asks the application itself; a database can be listening and still refuse connections while it recovers. The command is run as given, without a shell.

The fields are used twice:

- **Deploying.** A new replica has `interval × retries` (30 seconds with the defaults) to pass once, and is probed every second meanwhile. If it never does, the deployment fails and says why: `GET /health on port 8080: connection refused`, or for a command, its exit code and the last line it printed: `command exited 2: pg_isready: no response`. For a slow starter, raise `retries`.
- **Running.** Every replica is probed every `interval`. A replica that fails `retries` probes in a row is marked unhealthy, taken out of rotation and restarted, unless `restart.policy` is `never`.

Without a `health` block, a deployment only verifies that new replicas are still running after 3 seconds.

A `health` block that names none of the three kinds, or more than one, is an error on `health`: `one of path, tcp or command is required`; `path and tcp are set; a health check is one of path, tcp or command`.

### resources

Limits per replica. Omit a field, or the whole block, for unlimited. See [Resource limits and metrics](/docs/concepts/resources).

| Field | Type | Default | Rule |
|---|---|---|---|
| `resources.cpu` | number | unlimited | Cores, as a decimal number. `0.01` to `512`. |
| `resources.memory` | size | unlimited | A number and a unit, see [Sizes](#sizes). Minimum `6mb`. |

```yaml
resources:
  cpu: 0.5
  memory: 512mb
```

Memory is a hard cap: swap does not extend it, and a container exceeding it is killed. The same limits apply to the `pre_deploy` command and to job containers.

### volumes

Named Docker volumes mounted into the replica, for data that must outlive deployments: a database, above all. See [Run a database or other stateful application](/docs/tasks/stateful-applications).

| Field | Type | Rule |
|---|---|---|
| `volumes[].name` | string | Required. Same rule as `name`: lowercase letters, digits and dashes, starting and ending with a letter or digit, 1 to 63 characters. Unique within the file. |
| `volumes[].path` | string | Required. An absolute, clean path inside the container: starts with `/`, is not `/` itself, contains no `.` or `..` segments, no doubled or trailing slashes, and no NUL, CR or LF. Leading and trailing whitespace is trimmed. Unique within the file. |

At most 10 volumes per application. `volumes` requires `deploy.strategy: recreate` and `replicas: 1`.

```yaml
name: postgres
image: postgres:17
port: 5432
replicas: 1
env:
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
volumes:
  - name: data
    path: /var/lib/postgresql/data
deploy:
  strategy: recreate
```

On the server the volume is the Docker volume `shipwick_<name>_<volume>`: `shipwick_postgres_data` here. It belongs to the application, not to a deployment: every deployment mounts the same volumes, and nothing removes them — not a redeploy, not a rollback, not `shipwick delete`. `docker volume rm` on the server removes one when you mean it. `shipwick backup` and `shipwick restore` copy a volume's contents out and back in; see [Back up and restore volumes](/docs/tasks/backups).

Volumes are named volumes only. A path on the host cannot be mounted. The `pre_deploy` command and job containers get no volumes: a replica may be writing them.

Two versions writing the same files at once is how data gets lost, which is why the strategy and the replica count are checked:

```text
invalid deploy.yaml

deploy.strategy:
  must be "recreate" for an application with volumes: two versions cannot write the same files at once
  expected: deploy:
    strategy: recreate

replicas:
  must be 1 for an application with volumes, got 2: replicas cannot share a volume
  expected: 1
```

### publish

Container ports published on ports of the server itself, for services the proxy cannot serve because they are not HTTP: a database a laptop connects to, a game server. See [Expose a service that is not HTTP](/docs/tasks/non-http-services).

| Field | Type | Default | Rule |
|---|---|---|---|
| `publish[].port` | integer | required | The port inside the container, 1 to 65535. |
| `publish[].host` | integer | the same as `port` | The port on the server, 1 to 65535. Not 80 or 443: the proxy listens there. |
| `publish[].address` | string | every address of the server | An IP address of the server, IPv4 or IPv6. Not a hostname. Stored in its canonical form: `::ffff:10.0.0.5` becomes `10.0.0.5`. |
| `publish[].protocol` | string | `tcp` | `tcp` or `udp`. Case-insensitive, trimmed. |

At most 20 entries. `publish` requires `deploy.strategy: recreate` and `replicas: 1`: a server port has one holder, so neither two replicas nor the old and the new version side by side can bind it.

```yaml
name: postgres
image: postgres:17
replicas: 1
publish:
  - port: 5432        # inside the container
    host: 15432       # on the server; default: the same as port
    address: 10.0.0.5 # default: every address of the server
    protocol: tcp     # or udp
deploy:
  strategy: recreate
```

Nothing else changes: the container is on the same networks, other applications still reach it at `postgres:5432`, and the published port comes and goes with the replica.

Within one file, a server port is one binding per protocol and address. `port: 5432` and `port: 5433, host: 5432` on the same address is an error on the second entry: `server port 5432/tcp is published twice`. The same port on two different addresses, or as `tcp` and `udp`, is two bindings and is allowed.

The agent checks the rest before anything is started, so that a taken port is refused up front rather than found by Docker after the old version has already been stopped:

- Ports **80, 443, 8080 and 8443**, and the port of the agent's own `SHIPWICK_LISTEN_ADDR` (9000 by default), are Shipwick's: `publish[0].host` / `already published by Shipwick itself (the agent or the proxy)`.
- A port that another application's active configuration publishes with the same protocol, on the same address or with either side on every address: `publish[0].host` / `already published by application "postgres"`.

Both come back as `400 INVALID_CONFIG`, like a validation error, from `deploy`, `redeploy` and `rollback` alike.

::: warning Published ports bypass the host firewall
On most distributions Docker inserts its own iptables rules ahead of ufw's or firewalld's, so a port published on every address is reachable from the internet whatever the firewall says. Publish only what must be reachable from outside the server, bind it to a private address where one exists (`address: 10.0.0.5`, a VPN or private-network interface), and leave what only other applications need unpublished: they reach it by name on the `shipwick` network.
:::

### logging

Hands replica logs to a Docker logging driver, for shipping them to a collector instead of the server's disk. Without this block, logs go to the server's disk with the `json-file` driver, capped at 3 × 10 MB per container.

| Field | Type | Default | Rule |
|---|---|---|---|
| `logging.driver` | string | required when `logging` is present | One of `json-file`, `local`, `syslog`, `journald`, `gelf`, `fluentd`, `awslogs`, `splunk`. Trimmed; case-sensitive. |
| `logging.options` | map of string to string | none | At most 20 options. A key is lowercase letters, digits and dashes, starting with a letter: `^[a-z][a-z0-9-]*$`. A value is at most 1024 characters and contains no newline, carriage return or NUL byte. |

```yaml
logging:
  driver: gelf
  options:
    gelf-address: udp://logs.example.com:12201
    tag: "{{.Name}}"
```

The options are the driver's own and reach Docker as written; a number such as `max-file: 5` is a fine value. Two kinds of option are checked further, because Shipwick never touches paths on the server:

- **Collector addresses** must be `scheme://host:port` and nothing else: no user, path, query or fragment, and a port from 1 to 65535. The schemes are the driver's: `syslog-address` takes `udp`, `tcp` or `tcp+tls`; `gelf-address` takes `udp` or `tcp`; `fluentd-address` takes `tcp` or `tls`. `unix://` and `unixgram://` are refused: a socket is a path on the server.
- **Options that name a file on the server** are refused: `syslog-tls-ca-cert`, `syslog-tls-cert`, `syslog-tls-key`, `splunk-cafile`, `splunk-capath`. Give the collector a certificate the server already trusts instead.

With `json-file` or `local`, the 3 × 10 MB caps stay unless you set `max-size` and `max-file` yourself. With a remote driver, `shipwick logs` keeps working through the local copy Docker keeps for `docker logs` (its dual logging, on by default since Docker 20.10); if that was turned off daemon-wide, `shipwick logs` shows nothing for the application. Job and `shipwick run` output always goes through Docker's default driver, whatever `logging` says.

### pre_deploy

A command run from the **new** image, with the application's environment and limits, after the image is pulled and before any replica of the new version exists. For database migrations. See [Deployments](/docs/concepts/deployments).

| Field | Type | Default | Rule |
|---|---|---|---|
| `pre_deploy.command` | list of strings | required when `pre_deploy` is present | 1 to 256 arguments; the first is not blank; no argument contains a NUL byte or is longer than 4096 bytes. A list, not a string. |
| `pre_deploy.timeout` | duration | `10m` | `1s` to `1h` |

```yaml
pre_deploy:
  command: ["dotnet", "Migrate.dll"]
  timeout: 10m
```

If the command exits non-zero or outlives its timeout, the deployment is `FAILED` before anything was started; the last lines of its output are kept in the deployment's events, and `shipwick deploy` prints them under the error. The version that is serving is not touched.

The command runs next to the running version, under `recreate` too, whose replicas stop only afterwards. What it does must therefore be safe next to the old code: add a column, do not drop one. The container gets no `volumes`.

### jobs

Commands run on a schedule, each in a fresh container from the application's image, with its environment, limits and network, and without its volumes. See [Run scheduled jobs and one-off commands](/docs/tasks/jobs).

| Field | Type | Default | Rule |
|---|---|---|---|
| `jobs[].name` | string | required | Lowercase letters, digits and dashes, starting and ending with a letter or digit, 1 to 40 characters: `^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$`. Unique within the file. `pre-deploy` and `run` are reserved: they name the runs of the `pre_deploy` command and of `shipwick run`. |
| `jobs[].schedule` | string | required | Five cron fields, read in UTC. Runs of whitespace between fields are collapsed to one space. |
| `jobs[].command` | list of strings | required | Same rule as `pre_deploy.command`: 1 to 256 arguments, the first not blank, none containing a NUL byte or longer than 4096 bytes. A list, not a string. |
| `jobs[].timeout` | duration | `1h` | `1s` to `24h` |

At most 20 jobs per application.

```yaml
jobs:
  - name: nightly-report
    schedule: "0 3 * * *"
    command: ["node", "report.js"]
    timeout: 1h
  - name: cleanup
    schedule: "*/15 * * * *"
    command: ["sh", "-c", "find /tmp/cache -mmin +60 -delete"]
```

The schedule is the classic five fields:

```text
┌───────────── minute (0–59)
│ ┌─────────── hour (0–23)
│ │ ┌───────── day of month (1–31)
│ │ │ ┌─────── month (1–12, or jan–dec)
│ │ │ │ ┌───── day of week (0–6, sun–sat; 7 is sunday too)
│ │ │ │ │
0 3 * * *
```

Every field takes `*`, a value, a range `a-b`, a list `a,b,c`, and a step `*/n`, `a-b/n` or `a/n` (from `a` on, every `n`). Month and weekday names are accepted in place of numbers, in any case. When both the day of month and the day of week are restricted, either matching is enough, as in every cron since Vixie's. Schedules are read in **UTC**, whatever the server's time zone. Quote them: an unquoted `*` at the start of a YAML value is an alias.

A job runs once per firing, at most one run at a time: a run still going when the schedule fires again is left alone and that firing is skipped. A run that outlives its timeout is stopped. A stopped application runs no jobs. A firing that fell while the agent was down is not caught up. The last 50 runs of each job are kept, with the last 200 lines (64 KB) of output; `shipwick jobs` lists jobs with their last and next run.

### restart

What the supervisor does when a replica exits or turns unhealthy.

| Field | Type | Default | Rule |
|---|---|---|---|
| `restart.policy` | string | `always` | One of `always`, `on-failure`, `never` |

| Value | Behavior |
|---|---|
| `always` | Restart a replica that exited, whatever its exit code, and a running replica that turned unhealthy. |
| `on-failure` | Restart a replica that exited with a non-zero code or was killed for exceeding its memory limit. Leave a replica that exited with code 0 stopped. A running replica that turned unhealthy is restarted. |
| `never` | Never restart. |

```yaml
restart:
  policy: on-failure
```

Restarts back off: 1s, 2s, 5s, 10s, 30s, then every 5 minutes.

### deploy

| Field | Type | Default | Rule |
|---|---|---|---|
| `deploy.strategy` | string | `rolling` | One of `rolling`, `recreate`. Must be `recreate` when `volumes` or `publish` is set. |

| Value | Behavior |
|---|---|
| `rolling` | Replicas are replaced one at a time, each new one only after it proved healthy. The application keeps serving throughout, and both versions serve side by side for a moment. |
| `recreate` | The running version is taken out of the proxy and stopped first, then the new one is started and verified. The application is down for as long as the new version takes to start. If the new version fails, the old containers, kept stopped, are started again. For applications whose two versions cannot run side by side: anything with a volume or a published port, or that holds a lock. |

```yaml
deploy:
  strategy: recreate
```

With `rolling` and `publish`, the error is `must be "recreate" for an application that publishes ports: two versions cannot listen on the same server port`. With `volumes` as well, only the volume message is shown.

See [Deployments](/docs/concepts/deployments).

## Units

### Sizes

Used by `resources.memory`. A whole or decimal number followed by an optional unit.

| Unit | Bytes |
|---|---|
| none, `b` | 1 |
| `k`, `kb`, `kib` | 1024 |
| `m`, `mb`, `mib` | 1024² |
| `g`, `gb`, `gib` | 1024³ |

Units are binary, matching Docker's convention: `1gb` is 1024 `mb`. Units are case-insensitive, and whitespace between the number and the unit is allowed. `1.5gb`, `512MB` and `512 mb` are all valid.

### Durations

Used by `health.interval`, `health.timeout`, `pre_deploy.timeout` and `jobs[].timeout`. A number with a unit, in Go's duration syntax: `500ms`, `3s`, `1m`, `1m30s`. Valid units are `ns`, `us`, `ms`, `s`, `m` and `h`. A number without a unit is not valid. Each field has its own range, listed with the field.

### CPU

`resources.cpu` is a plain number of cores without a unit: `0.5`, `1`, `2`.

## Validation errors

All problems are reported at once, by field, so that they can be fixed in one pass:

```text
invalid deploy.yaml

port:
  invalid value 99999
  expected: a number between 1 and 65535

resources.memory:
  invalid value "abc"
  expected: 128mb, 512mb, 1gb, ...
```

Each entry names the field by its dotted path (`resources.memory`, `env.MY_VAR`, `volumes[0].path`, `publish[1].host`, `logging.options.gelf-address`, `jobs[0].schedule`), says what is wrong, and where possible lists what is expected.

Other forms the report takes:

| Problem | Reported as |
|---|---|
| A required field is missing | `name:` / `is required` |
| A reserved application name | `name:` / `"caddy" is reserved for Shipwick's own services` |
| `port` missing while `domain` is set | `port:` / `is required when domain is set` |
| `port` missing while `health.path` is set | `port:` / `is required when health is set` |
| An unknown field | `line 7:` / `unknown field "replica"` |
| A value of the wrong YAML type | `line 3:` / `cannot unmarshal … into a number` |
| `entrypoint` or `command` that is neither a string nor a list | `line 3:` / `expected a string or a list of strings, not a map` |
| An empty `entrypoint` or `command` | `command:` / `must not be empty; omit it to keep the image's own` |
| Too many arguments in `entrypoint` or `command` | `command:` / `too many arguments (65)`, expected `at most 64` |
| A newline or NUL byte in an argument | `command[0]:` / `must not contain newlines or NUL bytes` |
| An invalid user | `user:` / `invalid value "App"`, expected `a user name or id, with or without a group: app, 1000, 1000:1000` |
| `aliases` or `redirects` without `domain` | `aliases:` / `requires domain: aliases are served like it`; `redirects:` / `requires domain: redirects are sent to it` |
| More than 20 aliases or redirects | `aliases:` / `too many (21)`, expected `at most 20` |
| An empty hostname | `redirects[0]:` / `is empty`, expected `a hostname, e.g. www.example.com` |
| A hostname with a scheme, port or path | `aliases[0]:` / `invalid value "api.example.com/v1": not a valid hostname` |
| A hostname listed twice | `aliases[0]:` / `"example.com" is already listed under domain`; `redirects[1]:` / `"a.example.com" is already listed under aliases[0]` |
| A duration out of range | `health.interval:` / `invalid value "10m": out of range` |
| An invalid environment variable name | `env.my-var:` / `invalid variable name` |
| A `health` block without a kind | `health:` / `one of path, tcp or command is required` |
| A `health` block with two kinds | `health:` / `path and tcp are set; a health check is one of path, tcp or command` |
| A `health.tcp` port out of range | `health.tcp:` / `invalid value 0`, expected `the port your application listens on, e.g. 5432` |
| An empty or oversized `health.command` | `health.command:` / `must not be empty`; `too many arguments (65)`, expected `at most 64` |
| An empty argument or a NUL byte in `health.command` | `health.command[1]:` / `must not be empty`; `must not contain NUL bytes` |
| An unknown deployment strategy | `deploy.strategy:` / `invalid value "blue-green"`, expected `rolling, recreate` |
| More than 10 volumes | `volumes:` / `too many (11)`, expected `at most 10` |
| A volume name used twice | `volumes[1].name:` / `"data" is used twice` |
| A volume path that is not absolute and clean | `volumes[0].path:` / `invalid value "data/"`, expected `an absolute path inside the container, e.g. /var/lib/postgresql/data` |
| A volume path used twice | `volumes[1].path:` / `"/data" is mounted twice` |
| Volumes without `recreate` | `deploy.strategy:` / `must be "recreate" for an application with volumes: two versions cannot write the same files at once` |
| Volumes with more than one replica | `replicas:` / `must be 1 for an application with volumes, got 2: replicas cannot share a volume` |
| Published ports without `recreate` | `deploy.strategy:` / `must be "recreate" for an application that publishes ports: two versions cannot listen on the same server port` |
| Published ports with more than one replica | `replicas:` / `must be 1 for an application that publishes ports, got 2: replicas cannot share a server port` |
| More than 20 published ports | `publish:` / `too many (21)`, expected `at most 20` |
| A publish entry without `port` | `publish[0].port:` / `is required`, expected `the port your application listens on, e.g. 5432` |
| A published port out of range | `publish[0].port:` / `invalid value 70000`; `publish[0].host:` / `invalid value 0`, expected `a number between 1 and 65535` |
| A server port the proxy listens on | `publish[0].host:` / `invalid value 80: the proxy listens there`, expected `another server port, e.g. 15432` |
| An unknown protocol | `publish[0].protocol:` / `invalid value "sctp"`, expected `tcp, udp` |
| An address that is not an IP address | `publish[0].address:` / `invalid value "db.internal"`, expected `an address of the server, e.g. 10.0.0.5` |
| A server port published twice | `publish[1].host:` / `server port 5432/tcp is published twice`, expected `a different server port for each entry` |
| `logging` without a driver | `logging.driver:` / `is required when logging is set`, expected `json-file, local, syslog, journald, gelf, fluentd, awslogs, splunk` |
| An unknown logging driver | `logging.driver:` / `invalid value "GELF"` |
| More than 20 logging options | `logging.options:` / `too many (21)`, expected `at most 20` |
| An invalid option name | `logging.options.Gelf-Address:` / `invalid option name`, expected `lowercase letters, digits and dashes, e.g. gelf-address` |
| An option that names a file on the server | `logging.options.syslog-tls-ca-cert:` / `names a file on the server, which Shipwick never reads` |
| An option value too long | `logging.options.tag:` / `value is too long (1025 characters)`, expected `at most 1024` |
| A newline or NUL byte in an option value | `logging.options.tag:` / `value must not contain newlines or NUL bytes` |
| A collector address without a scheme or port | `logging.options.gelf-address:` / `invalid value "logs.example.com:12201": must be scheme://host:port` |
| A collector address that is a socket | `logging.options.syslog-address:` / `invalid value "unix:///dev/log": a socket is a path on the server, which Shipwick never mounts; use a network address` |
| A scheme the driver does not speak | `logging.options.gelf-address:` / `invalid value "tcp+tls://logs.example.com:12201": unknown scheme "tcp+tls", use udp, tcp` |
| A collector address with a path or credentials | `logging.options.fluentd-address:` / `invalid value "tcp://logs.example.com:24224/x": must be scheme://host:port, nothing after the port` |
| A collector address with a bad port | `logging.options.gelf-address:` / `invalid value "udp://logs.example.com:99999": port must be a number between 1 and 65535` |
| A `pre_deploy` block without a command | `pre_deploy.command:` / `is required`, expected `["dotnet", "Migrate.dll"]` |
| A command with too many or oversized arguments | `pre_deploy.command:` / `too many arguments (257)`; `argument 2 is longer than 4096 bytes`; `argument 2 must not contain NUL bytes` |
| A `pre_deploy` timeout out of range | `pre_deploy.timeout:` / `invalid value "2h": out of range`, expected `30s, 10m, 1h, ... (1s to 1h)` |
| More than 20 jobs | `jobs:` / `too many (21)`, expected `at most 20` |
| A job without a name | `jobs[0].name:` / `is required`, expected `nightly-report` |
| An invalid job name | `jobs[0].name:` / `invalid value "Nightly"`, expected `lowercase letters, digits and dashes, e.g. nightly-report (max 40 characters)` |
| A reserved job name | `jobs[0].name:` / `"run" is reserved`, expected `another name, e.g. nightly-report` |
| A job name used twice | `jobs[1].name:` / `"cleanup" is used twice`, expected `a different name for each job` |
| A job without a schedule | `jobs[0].schedule:` / `is required`, expected `"0 3 * * *" (minute hour day-of-month month day-of-week, in UTC)` |
| An invalid schedule | `jobs[0].schedule:` / `invalid value "61 * * * *": minute: value 61 out of range 0-59`; `invalid value "* * * * * *": expected 5 fields (minute hour day-of-month month day-of-week), got 6` |
| A job without a command | `jobs[0].command:` / `is required`, expected `["node", "report.js"]` |
| A job timeout out of range | `jobs[0].timeout:` / `invalid value "25h": out of range`, expected `5m, 1h, 12h, ... (1s to 24h)` |
| An empty file | `deploy.yaml:` / `file is empty` |
| Several YAML documents in one file | `deploy.yaml:` / `multiple YAML documents are not supported; describe one application per file` |
| A file over 64 KB | `deploy.yaml:` / `file is too large (max 64 KB)` |
| A hostname in use, refused by the agent | `domain:` / `already served by application "web"`; `aliases[1]:` / `already served by Shipwick itself (the agent or the dashboard)` |
| A server port in use, refused by the agent | `publish[0].host:` / `already published by application "postgres"`; `already published by Shipwick itself (the agent or the proxy)` |

Unknown fields do not hide other mistakes: when they are the only syntax problem, the rest of the file is still validated and everything is reported together.

An unset `${NAME}` is reported by `shipwick` before validation, since the document cannot be validated without it: `deploy.yaml: refers to ${DATABASE_PASSWORD}, which is not set`.

The agent returns the same information in the API's error envelope, as `400 INVALID_CONFIG` with one object per problem in `details.fields`:

```json
{
  "error": {
    "code": "INVALID_CONFIG",
    "message": "invalid deploy.yaml",
    "details": {
      "fields": [
        { "field": "resources.memory", "message": "invalid value \"abc\"", "expected": "128mb, 512mb, 1gb, ..." }
      ]
    }
  }
}
```

The two checks only the agent can make, a hostname or a server port already in use, come back in the same shape with one entry, from `deploy`, `redeploy` and `rollback` alike. `shipwick` renders an agent-side rejection exactly like a local one.

## Full example

```yaml
# deploy.yaml — everything Shipwick needs to run your application.
# Only `name` and `image` are required.

# Lowercase letters, digits and dashes. Identifies the application on the server.
name: my-api

# Any image reference Docker understands. For private registries, run
# `docker login <registry>` once on the server; Shipwick uses those credentials.
# Pin a version tag: deployments are recorded by it (1.4.2 here).
image: ghcr.io/company/my-api:1.4.2

# Run something other than the image's default: these replace its ENTRYPOINT,
# CMD and USER. A string is one argument; use a list for several. Nothing is
# split on spaces or passed through a shell.
# entrypoint: ["dotnet"]
# command: ["App.dll", "--urls", "http://0.0.0.0:8080"]
# user: "1000:1000"

# The port your application listens on inside the container. It is never
# published on the host; the reverse proxy reaches it over a private network.
# Required when `domain` or `health` is set.
port: 8080

# Public hostname. Shipwick configures Caddy to serve it over HTTPS.
domain: api.example.com

# More hostnames served exactly like `domain`, and hostnames redirected to it
# (308, same path and query) — www, an old domain. Each gets a certificate.
# aliases: [api2.example.com]
# redirects: [www.api.example.com]

# Number of identical containers to run. Default: 1.
replicas: 2

# Environment variables. Values are stored on the server, never logged, and
# masked in API responses. ${NAME} is filled in by the CLI from its environment
# or --env-file when you deploy, so that secrets never have to be in this file.
# Other applications on the server are reached by name: postgres:5432.
env:
  DATABASE_URL: postgres://app:${DATABASE_PASSWORD}@postgres:5432/app
  LOG_LEVEL: info

# HTTP health check. A replica is healthy when `path` answers 2xx.
#
# Deploying: new replicas get interval × retries (30s here) to answer once;
# if they never do, the deployment fails and the old version keeps running.
# Slow starter? Raise retries.
#
# Running: a replica that fails `retries` checks in a row is restarted.
#
# Not HTTP? Use exactly one of path, tcp or command:
#   tcp: 5432                                  # the port accepts a connection
#   command: ["pg_isready", "-U", "postgres"]  # exit 0 inside the replica
health:
  path: /health
  interval: 10s # default 10s
  timeout: 3s   # default 3s
  retries: 3    # default 3

# Per-replica limits. Omit for unlimited.
resources:
  cpu: 2        # cores; fractions allowed: 0.5
  memory: 1gb   # 128mb, 512mb, 1gb, ...

# What to do when a replica exits or turns unhealthy:
#   always (default) | on-failure (non-zero exit / out of memory only) | never
# Restarts back off (1s, 2s, 5s, 10s, 30s, then every 5m): no hot crash loops.
restart:
  policy: always

deploy:
  strategy: rolling

# Data that must outlive deployments — a database. Named volumes belong to the
# application and are kept across redeployments, rollbacks and delete. They
# need replicas: 1 and the recreate strategy: two versions on one volume is
# how data gets lost.
# volumes:
#   - name: data
#     path: /var/lib/postgresql/data

# Ports that are not HTTP, published on the server itself: a database reached
# from outside the server, a game server. Needs replicas: 1 and the recreate
# strategy: a server port has one holder. Published ports bypass the host
# firewall on most distributions; bind to a private address where you can.
# publish:
#   - port: 5432        # inside the container
#     host: 15432       # on the server; default: the same as port
#     address: 10.0.0.5 # default: every address of the server
#     protocol: tcp     # or udp

# rolling (default): replicas are replaced one at a time, the application keeps
# serving. recreate: the running version is stopped before the new one starts;
# required with volumes and publish.
# deploy:
#   strategy: recreate

# Ship logs to a collector instead of the server's disk: json-file (default),
# local, syslog, journald, gelf, fluentd, awslogs or splunk, with the driver's
# own options. Addresses are scheme://host:port; no sockets or files on the
# server. `shipwick logs` keeps working through the copy Docker keeps locally.
# logging:
#   driver: gelf
#   options:
#     gelf-address: udp://logs.example.com:12201
#     tag: "{{.Name}}"

# Run from the new image, with the env above, after the pull and before any
# replica of the new version starts — database migrations. A non-zero exit
# fails the deployment before anything was touched. It runs next to the version
# still serving, so what it does must be compatible with that version.
# pre_deploy:
#   command: ["dotnet", "Migrate.dll"]
#   timeout: 10m # default 10m, up to 1h

# Commands on a schedule, each in a one-off container from this image with the
# env above (no volumes). Five cron fields, read in UTC. One run of a job at a
# time; `shipwick jobs` shows how they are doing.
# jobs:
#   - name: nightly-report
#     schedule: "0 3 * * *"
#     command: ["node", "report.js"]
#     timeout: 1h # default 1h, up to 24h
#   - name: cleanup
#     schedule: "*/15 * * * *"
#     command: ["sh", "-c", "find /tmp/cache -mmin +60 -delete"]
```
