---
title: deploy.yaml
description: Complete reference of the deploy.yaml file, with every field, its type, default and validation rules, the units it accepts, and the format of validation errors.
---

# deploy.yaml

`deploy.yaml` describes one application: its image and how to run it. This page lists every field with its type, default and validation rules, the units used for sizes and durations, and the error format that `deployctl` and the API produce.

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
- `deployctl` looks for `deploy.yaml` in the current directory; `-f` / `--file` selects another file. `deployctl init` writes a starter file, and `deployctl validate` checks a file offline and prints it as it will be applied, defaults included.

The same parser and validator run in `deployctl` and in the agent. The agent validates every submitted document again, whatever the client did.

## Fields

| Field | Type | Required | Default |
|---|---|---|---|
| [`name`](#name) | string | yes | |
| [`image`](#image) | string | yes | |
| [`port`](#port) | integer | with `domain` or `health` | none |
| [`domain`](#domain) | string | no | none |
| [`replicas`](#replicas) | integer | no | `1` |
| [`env`](#env) | map of string to string | no | none |
| [`health.path`](#health) | string | with `health` | |
| [`health.interval`](#health) | duration | no | `10s` |
| [`health.timeout`](#health) | duration | no | `3s` |
| [`health.retries`](#health) | integer | no | `3` |
| [`resources.cpu`](#resources) | number | no | unlimited |
| [`resources.memory`](#resources) | size | no | unlimited |
| [`restart.policy`](#restart) | string | no | `always` |
| [`deploy.strategy`](#deploy) | string | no | `rolling` |

### name

Identifies the application on the server. It appears in container names, Docker labels, API URLs and the proxy configuration, so the alphabet is deliberately strict.

| | |
|---|---|
| Type | string |
| Required | yes |
| Rule | A DNS label: lowercase letters, digits and dashes; must start and end with a letter or digit; 1 to 63 characters. Pattern: `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` |

```yaml
name: my-api
```

Underscores are not allowed. Container names have the form `shipwick_<name>_<deployment>_<replica>` and rely on that.

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

`deployctl deploy --image <ref>` replaces this field for one deployment without changing the file. For private registries, see [Pull from private registries](/docs/tasks/private-registries).

### port

The port the application listens on inside the container. It is never published on the host; the reverse proxy and the health check reach it over the private network.

| | |
|---|---|
| Type | integer |
| Required | when `domain` or `health` is set |
| Rule | 1 to 65535 |

```yaml
port: 8080
```

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

A domain can belong to one application only. A deployment that claims a domain already served by another application, by the agent's API or by the dashboard is refused with a `domain` error before anything is started.

### replicas

The number of identical containers to run.

| | |
|---|---|
| Type | integer |
| Default | `1` |
| Rule | 1 to 50 |

```yaml
replicas: 2
```

### env

Environment variables passed to every replica.

| | |
|---|---|
| Type | map of string to string |
| Default | none |
| Key rule | Letters, digits and underscores, not starting with a digit. Pattern: `^[A-Za-z_][A-Za-z0-9_]*$` |
| Value rule | Must not contain NUL bytes. |

```yaml
env:
  DATABASE_URL: postgres://user:password@db.internal:5432/app
  LOG_LEVEL: info
```

Values are stored on the server with the deployment. They are never logged and never echoed in validation errors. In every API response they are masked as `********`; the names are kept.

::: warning Values are not encrypted at rest
Environment values are stored in plain text in the agent's SQLite file. Protect the agent's data directory. See [Security](/docs/security).
:::

### health

The HTTP health check. A replica is healthy when `GET <path>` on `port` answers with a 2xx status. Redirects are not followed and do not count. See [Health checks and supervision](/docs/concepts/health-and-supervision).

| Field | Type | Default | Rule |
|---|---|---|---|
| `health.path` | string | required when `health` is present | Starts with `/`; at most 2048 characters; no whitespace or control characters; a valid URL path without scheme or host. |
| `health.interval` | duration | `10s` | `1s` to `5m` |
| `health.timeout` | duration | `3s` | `100ms` to `1m` |
| `health.retries` | integer | `3` | 1 to 100 |

`health` requires `port`.

```yaml
port: 8080
health:
  path: /health
  interval: 10s
  timeout: 3s
  retries: 3
```

The fields are used twice:

- **Deploying.** A new replica has `interval × retries` (30 seconds with the defaults) to answer once, and is probed every second meanwhile. If it never does, the deployment fails. For a slow starter, raise `retries`.
- **Running.** Every replica is probed every `interval`. A replica that fails `retries` probes in a row is marked unhealthy, taken out of rotation and restarted, unless `restart.policy` is `never`.

Without a `health` block, a deployment only verifies that new replicas are still running after 3 seconds.

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

Memory is a hard cap: swap does not extend it, and a container exceeding it is killed.

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
| `deploy.strategy` | string | `rolling` | `rolling` is the only accepted value. |

```yaml
deploy:
  strategy: rolling
```

Replicas are replaced one at a time. See [Deployments](/docs/concepts/deployments).

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

Used by `health.interval` and `health.timeout`. A number with a unit, in Go's duration syntax: `500ms`, `3s`, `1m`, `1m30s`. Valid units are `ns`, `us`, `ms`, `s`, `m` and `h`. A number without a unit is not valid.

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

Each entry names the field by its dotted path (`resources.memory`, `env.MY_VAR`), says what is wrong, and where possible lists what is expected.

Other forms the report takes:

| Problem | Reported as |
|---|---|
| A required field is missing | `name:` / `is required` |
| `port` missing while `domain` or `health` is set | `port:` / `is required when domain is set` |
| An unknown field | `line 7:` / `unknown field "replica"` |
| A value of the wrong YAML type | `line 3:` / `cannot unmarshal … into a number` |
| A duration out of range | `health.interval:` / `invalid value "10m": out of range` |
| An invalid environment variable name | `env.my-var:` / `invalid variable name` |
| An empty file | `deploy.yaml:` / `file is empty` |
| Several YAML documents in one file | `deploy.yaml:` / `multiple YAML documents are not supported; describe one application per file` |
| A file over 64 KB | `deploy.yaml:` / `file is too large (max 64 KB)` |
| A domain in use | `domain:` / `already served by application "web"` |

Unknown fields do not hide other mistakes: when they are the only syntax problem, the rest of the file is still validated and everything is reported together.

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

`deployctl` renders an agent-side rejection exactly like a local one.

## Full example

```yaml
# deploy.yaml: everything Shipwick needs to run your application.
# Only `name` and `image` are required.

# Lowercase letters, digits and dashes. Identifies the application on the server.
name: my-api

# Any image reference Docker understands. For private registries, run
# `docker login <registry>` once on the server; Shipwick uses those credentials.
# Pin a version tag: deployments are recorded by it (1.4.2 here).
image: ghcr.io/company/my-api:1.4.2

# The port your application listens on inside the container. It is never
# published on the host; the reverse proxy reaches it over a private network.
# Required when `domain` or `health` is set.
port: 8080

# Public hostname. Shipwick configures Caddy to serve it over HTTPS.
domain: api.example.com

# Number of identical containers to run. Default: 1.
replicas: 2

# Environment variables. Values are stored on the server, never logged, and
# masked in API responses.
env:
  DATABASE_URL: postgres://user:password@db.internal:5432/app
  LOG_LEVEL: info

# HTTP health check. A replica is healthy when `path` answers 2xx.
#
# Deploying: new replicas get interval × retries (30s here) to answer once;
# if they never do, the deployment fails and the old version keeps running.
# For a slow starter, raise retries.
#
# Running: a replica that fails `retries` checks in a row is restarted.
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
```
