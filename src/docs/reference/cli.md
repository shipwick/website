---
title: shipwick CLI
description: Complete reference of the shipwick command-line client, covering how it finds the agent, its configuration file and environment variables, exit codes, and every command with its flags.
---

# shipwick CLI

`shipwick` is the command-line client of a Shipwick agent. This page describes how it finds the agent and its token, its configuration file, environment variables and exit codes, and then every command with its flags.

```text
shipwick [command] [flags]
```

| Command | |
|---|---|
| [`init`](#init) | Create a `deploy.yaml` in the current directory |
| [`validate`](#validate) | Check `deploy.yaml` without deploying |
| [`deploy`](#deploy) | Deploy the application described by `deploy.yaml` |
| [`redeploy`](#redeploy) | Deploy the running configuration again, optionally with another image |
| [`rollback`](#rollback) | Go back to an earlier successful deployment |
| [`status`](#status) | Show the state of an application |
| [`ps`](#ps) | List the applications on the server |
| [`logs`](#logs) | Show the logs of an application |
| [`stop`](#stop) | Stop an application |
| [`start`](#start) | Start a stopped application |
| [`delete`](#delete) | Remove an application, its containers and its deployment history |
| [`server status`](#server-status) | Show whether the agent is reachable, and what it runs on |
| [`login`](#login) | Save the agent URL and API token for later commands |

## Global behavior

### Global flags

| Flag | |
|---|---|
| `--url <url>` | Agent URL. Overrides `SHIPWICK_AGENT_URL` and the saved configuration. |
| `--version` | Print the version of `shipwick`. |
| `-h`, `--help` | Help for any command. |

### How the agent is found

The URL and the token are resolved separately, highest precedence first:

| | URL | Token |
|---|---|---|
| 1. Flag | `--url` | Never a flag |
| 2. Environment | `SHIPWICK_AGENT_URL` | `SHIPWICK_AGENT_TOKEN` |
| 3. Saved by `shipwick login` | yes | yes |
| 4. Default | `http://127.0.0.1:9000` | |

There is deliberately no `--token` flag. Command-line arguments are visible to every user on the machine through `ps`, and are kept in shell history.

**The saved token belongs to the saved URL.** If `--url` or `SHIPWICK_AGENT_URL` points `shipwick` at a different agent than the saved one, the saved token is not sent there. A token from `SHIPWICK_AGENT_TOKEN` is always used.

The URL must be an `http://` or `https://` URL with a host. The default, `http://127.0.0.1:9000`, suits both an agent on the same machine and one reached through an SSH tunnel:

```bash
ssh -N -L 9000:127.0.0.1:9000 user@server &
shipwick login
```

In CI, no login is needed:

```bash
export SHIPWICK_AGENT_URL=https://agent.example.com
export SHIPWICK_AGENT_TOKEN=…
shipwick deploy --image ghcr.io/company/my-api:$GIT_SHA
```

`shipwick` warns on standard error whenever a token is about to travel over plain HTTP to anything other than the local machine (`localhost` or a loopback address).

### Configuration file

`shipwick login` writes the file; nothing else does.

| | |
|---|---|
| Location | `<user config dir>/shipwick/config.yaml`. The user config directory is the operating system's: `$XDG_CONFIG_HOME` or `~/.config` on Linux, `~/Library/Application Support` on macOS, `%AppData%` on Windows. |
| Override | `SHIPWICK_CONFIG` sets the full path of the file. |
| Permissions | The file is written with mode `0600`, its directory is created with mode `0700`. The file is written to a temporary name and renamed into place, so the permissions apply even if the file already existed. |
| Content | Two keys: `url` and `token`. |

A missing file is an empty configuration, not an error.

### Environment variables

| Variable | |
|---|---|
| `SHIPWICK_AGENT_URL` | Agent URL. |
| `SHIPWICK_AGENT_TOKEN` | API token. |
| `SHIPWICK_CONFIG` | Path of the configuration file. |
| `NO_COLOR` | When set to any value, output is not colored. |
| `TERM` | `dumb` disables colors. |

### Which application a command targets

Commands that take `[app]` use the application named in `./deploy.yaml` when no argument is given. `-f` / `--file` selects another file. `delete` is the deliberate exception: it always wants the name spelled out. For `logs`, `-f` means `--follow`, and the file is selected with `--file` only.

### Output

- Results go to standard output; warnings and errors go to standard error, so standard output stays parseable.
- When standard output is not a terminal, output is plain: no colors and no progress line.
- Validation errors are printed field by field. See the [deploy.yaml reference](/docs/reference/deploy-yaml#validation-errors).

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Anything else, including a deployment that was accepted but failed or was rolled back. |

This makes `deploy`, `redeploy` and `rollback` usable as a CI gate.

### Timeouts

Regular requests time out after 90 seconds. The limit is sized for the slowest regular call: stopping an application waits for every replica's graceful shutdown. Log streams have no timeout. While waiting for a deployment, `shipwick` polls the agent every 500 milliseconds and rides out up to 20 consecutive connection failures, such as an agent restart or a network blip, before it gives up.

## init

Create a `deploy.yaml` in the current directory.

```text
shipwick init [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Path of the file to write |
| `--force` | | Overwrite an existing file |
| `--name <name>` | the directory name | Application name |
| `--image <ref>` | | Container image, for example `ghcr.io/company/my-api:1.0.0` |
| `--port <n>` | | Port the application listens on |
| `--domain <host>` | | Public domain, for example `api.example.com` |

Run in a terminal without `--image`, `init` asks for the name, the image, the port and, if a port was given, the domain. With `--image` it never prompts, which suits scripts. Outside a terminal, `--image` is required.

The default name is derived from the current directory's name: lowercased, with other characters replaced by dashes. If that does not give a valid name, `my-app` is used.

The answers become live settings. Everything else is written as commented-out examples:

```bash
shipwick init --name my-api --image ghcr.io/company/my-api:1.0.0 --port 8080
```

```yaml
name: my-api

# Pin a version tag: deployments are recorded (and rolled back) by it.
image: ghcr.io/company/my-api:1.0.0

# The port your application listens on inside the container.
port: 8080

# Public hostname, served over HTTPS automatically.
# domain: my-api.example.com

replicas: 1

# env:
#   DATABASE_URL: postgres://user:password@host:5432/db

# A replica receives traffic only once this endpoint answers 2xx.
# health:
#   path: /health
#   interval: 10s
#   timeout: 3s
#   retries: 3

# Per-replica limits. Unlimited when omitted.
# resources:
#   cpu: 1
#   memory: 512mb

restart:
  policy: always # always | on-failure | never
```

`init` refuses to overwrite an existing file without `--force`. It does not contact the agent.

## validate

Check `deploy.yaml` without deploying. Runs offline, and prints the configuration as it will be applied, defaults included.

```text
shipwick validate [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Path of the deployment configuration |

```text
✓ deploy.yaml is valid

Name           my-api
Image          ghcr.io/company/my-api:1.4.2
Version        1.4.2
Replicas       2
Port           8080
Domain         api.example.com
Health check   GET /health every 10s (timeout 3s, 3 retries)
Resources      2 CPU, 1 GB
Restart        always
Environment    2 variables
```

Environment values are not printed, only their count. An invalid file prints the validation report and exits with `1`.

## deploy

Deploy the application described by `deploy.yaml` and wait for the result.

```text
shipwick deploy [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Path of the deployment configuration |
| `--image <ref>` | | Deploy this image instead of the one in the configuration |
| `--no-wait` | | Start the deployment and return immediately |

```text
Deploying my-api...

✓ Validated deploy.yaml
✓ Pulled image ghcr.io/company/my-api:1.4.2
✓ Started 1 container
✓ Replica 1 passed health checks
✓ Replica 1/2 is serving 1.4.2; its 1.4.1 predecessor is retired
✓ Replica 2 passed health checks
✓ Replica 2/2 is serving 1.4.2; its 1.4.1 predecessor is retired
✓ Routed https://api.example.com to 2 replicas
✓ Deployment successful

my-api 1.4.2  deployed in 6.1s
2/2 replicas healthy
https://api.example.com
```

Behavior:

- The file is validated locally before anything is sent. The agent validates it again.
- **`deploy` waits for `completed_at`**, not for the first `ACTIVE`. When it returns, the next operation on the application is guaranteed not to be rejected as busy.
- `--image` edits the YAML document in memory. The agent still receives one plain `deploy.yaml`, and the file on disk is untouched. This is the form for CI: keep `deploy.yaml` in the repository and pass the image that was just built.
- **Ctrl+C stops the waiting, not the deployment.** The deployment continues on the server; follow it with `shipwick status`.
- With `--no-wait`, the command prints `Deployment #N started` and exits with `0` without knowing the outcome.
- In a terminal, a transient progress line shows what the agent is busy with: pulling the image, starting containers, checking health, switching over, retiring the previous version.

If the deployment fails, the command prints the cause, the saved output of the failed replica if there is any, and what is running now, then exits with `1`:

```text
✗ Deployment failed

  replica 1 exited with code 1 shortly after start

  Last output of replica 1:
  panic: DATABASE_URL is not set

my-api is still running 1.4.1; the failed deployment did not affect it.
```

The last line depends on the outcome:

| Outcome | Message |
|---|---|
| `FAILED`, previous version untouched | `my-api is still running 1.4.1; the failed deployment did not affect it.` |
| `ROLLED_BACK` | Headline `Deployment failed and was rolled back`, then `my-api is running 1.4.1 again: the replicas that had already been replaced were restored.` |
| The previous version is not fully healthy afterwards | `my-api is running 1.4.1, but it is DEGRADED right now (1/2 replicas healthy). Shipwick keeps trying to restore it:` |
| Nothing was deployed before | `my-api has no running version.` |

See [Deployments](/docs/concepts/deployments) and [Deploy from CI](/docs/tasks/deploy-from-ci).

## redeploy

Deploy the running configuration again, optionally with another image.

```text
shipwick redeploy [app] [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted |
| `--image <ref>` | the image already running | Image to deploy |
| `--no-wait` | | Start the deployment and return immediately |

Unlike `deploy`, this needs no `deploy.yaml`. The agent re-uses the configuration it stored with the active deployment, environment values included. It is useful to move an application to a new image from anywhere, or to replace all its containers.

The result is an ordinary deployment, followed and reported like `deploy`. The application must have an active deployment.

## rollback

Go back to an earlier successful deployment.

```text
shipwick rollback [app] [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted |
| `--to <n>` | the previous successful deployment | Deployment number to go back to, as shown by `shipwick status` |
| `--no-wait` | | Start the rollback and return immediately |

```text
Rolling back my-api to 1.4.1  (deployment #3)...

✓ Replica 1/2 is serving 1.4.1; its 1.4.2 predecessor is retired
✓ Replica 2/2 is serving 1.4.1; its 1.4.2 predecessor is retired
✓ Deployment successful
```

A rollback is an ordinary deployment of the configuration that was stored with the earlier deployment: image, environment, replicas, everything. It is rolled out replica by replica, health-checked, and recorded as a new entry in the history. Nothing is rewritten.

`shipwick` resolves the target itself from the application's history (the newest 500 deployments), so that what it announces is exactly what it requests. Only deployments with the status `SUPERSEDED` qualify:

| Situation | Message |
|---|---|
| `--to` names the active deployment | `deployment #4 is the one running right now` |
| `--to` names a deployment that never succeeded | `deployment #2 never ran successfully (FAILED), so there is nothing to go back to` |
| `--to` names a number that does not exist | `there is no deployment #9` |
| No earlier successful deployment | `there is no earlier successful deployment to go back to` |

See [Rollback](/docs/concepts/rollback) and [Roll back and redeploy](/docs/tasks/roll-back).

## status

Show the state of an application: its version, resource usage, replicas, recent deployments and recent supervisor events.

```text
shipwick status [app] [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted |

```text
my-api  ● HEALTHY

Replicas   2/2 healthy
CPU        42% / 400%
Memory     412 MB / 2 GB
```

The output has up to four parts:

1. **Summary.** Status, with `(deployment in progress)` while one is in flight. Then `Version` (with the deployment number and when it was deployed), `Image`, `URL` if there is a domain, `Replicas`, `CPU` and `Memory` if anything is running, `Health` if a health check is configured, and `Limits`. CPU is in percent of one core; with a limit it is shown as `used / limit`.
2. **Containers.** Columns `REPLICA`, `CONTAINER`, `STATE`, `HEALTH`, `RESTARTS`, `STARTED`. `STATE` is `running`, `exited (<code>)`, `out of memory`, or another Docker state. `HEALTH` is `healthy`, `unhealthy`, `starting`, `checking` (not probed yet), or `-` without a health check. `RESTARTS` shows `N (crash loop)` while restarts are rate-limited.
3. **Deployments.** The 5 most recent, with columns `DEPLOY` (the `#number`), `VERSION`, `STATUS`, `VIA` (`deploy`, `redeploy` or `rollback`), `WHEN`, and the error of a failed deployment, truncated to 90 characters.
4. **Events.** The 8 most recent application events: what the supervisor has been doing, and stops and starts.

```text
my-api  ● CRASH_LOOP

REPLICA   CONTAINER            STATE     HEALTH      RESTARTS         STARTED
1         shipwick_my-api_3_1   running   healthy     0                2h ago
2         shipwick_my-api_3_2   running   unhealthy   5 (crash loop)   34s ago

WHEN      EVENT
28s ago   Replica 2 did not become healthy within 30s of starting: HTTP 503
34s ago   Replica 2 is crash-looping: 5 restarts without staying up. Retrying every 5m
```

See [See what is running](/docs/tasks/inspect-and-logs).

## ps

List the applications on the server.

```text
shipwick ps
```

Columns: `NAME`, `STATUS`, `VERSION`, `REPLICAS` (healthy/desired), `DOMAIN`, `UPDATED`. `(deploying)` is appended to the status while a deployment is in flight. With no applications, the command prints `No applications yet. Deploy one with: shipwick deploy`.

## logs

Show the logs of an application, merged across its replicas.

```text
shipwick logs [app] [flags]
```

| Flag | Default | |
|---|---|---|
| `-n`, `--tail <n>` | `100` | Number of lines to show from the end of the logs. 1 to 5000; `0` is allowed with `--follow` |
| `-f`, `--follow` | | Keep streaming new log lines |
| `-t`, `--timestamps` | | Prefix each line with its timestamp, in local time |
| `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted. Long form only: here `-f` means `--follow`, as in `docker` and `kubectl` |

- Logs come from the replicas of the active deployment.
- When the application has more than one replica, each line is prefixed with the replica number: `[1]`, `[2]`.
- Without `--follow`, `--tail` is the merged total: the last N lines across all replicas. With `--follow` it applies per replica: each replica's stream starts with its own last N lines. `--tail 0` with `--follow` shows only what is logged from now on.
- **`logs -f` ends by itself** when the containers are stopped or replaced by a new deployment, with a warning saying so. Run it again to follow the new ones. Ctrl+C is the normal way out and prints nothing.

## stop

Stop an application. It stays stopped until it is started or deployed again.

```text
shipwick stop [app] [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted |

The application is taken out of the proxy's rotation first, then every replica is stopped gracefully. Its domain answers `503` and keeps its certificate. The containers are kept. Prints `✓ Stopped my-api`.

## start

Start a stopped application.

```text
shipwick start [app] [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted |

Prints `✓ Started my-api (2/2 replicas running)`. The count is of running replicas; health is not known yet at that moment. Replicas with a health check receive traffic once they pass it. An explicit start clears the restart history of every replica.

If a container of the application no longer exists, `start` fails and says to deploy the application again.

## delete

Remove an application, its containers and its deployment history from the server.

```text
shipwick delete <app> [flags]
```

| Flag | |
|---|---|
| `-y`, `--yes` | Do not ask for confirmation |

The name is always explicit. Deleting "whatever `deploy.yaml` says" from the wrong directory is a mistake that is made too quickly. In a terminal, `delete` asks for the application name to be typed as confirmation. Outside a terminal it refuses to run without `--yes`.

Deletion cannot be undone. The history goes with the application, and with it every stored configuration that a rollback could have used.

## server status

Show whether the agent is reachable, and what it runs on.

```text
shipwick server status
```

The command first calls the health endpoint, which needs no token. This separates "cannot reach the agent" from "reached it, but the token is wrong". It then prints:

| Line | |
|---|---|
| `Agent` | The agent's version |
| `CLI` | The version of `shipwick` |
| `Host` | The server's hostname |
| `OS` | Operating system, architecture and kernel |
| `Docker` | Docker version |
| `CPUs`, `Memory` | Of the server |
| `Applications` | Number of applications |
| `Containers` | Number of running Shipwick-managed containers |
| `Proxy` | `ok  serving N domains`, `unreachable` with the error, or `not configured` when `SHIPWICK_CADDY_ADMIN` is not set on the agent |

If the token is rejected, the agent's version is still shown before the error.

## login

Save the agent URL and API token for later commands.

```text
shipwick login [flags]
```

| Flag | |
|---|---|
| `--token-stdin` | Read the token from standard input |

```text
$ shipwick login --url https://agent.example.com
API token:
✓ Logged in to https://agent.example.com (my-server, agent v0.1.0)
  saved to /home/me/.config/shipwick/config.yaml
```

- In a terminal without `--url`, `login` asks for the agent URL, offering the currently resolved URL as the default.
- The token is asked for without echo. It is never taken from `SHIPWICK_AGENT_TOKEN` or from the saved configuration: giving it afresh is the point of logging in.
- The token is verified against the agent before anything is saved. If the agent rejects it, nothing is written.
- Outside a terminal, `--token-stdin` is required. At most 4096 bytes are read, and surrounding whitespace is trimmed.

```bash
printf %s "$TOKEN" | shipwick login --url https://agent.example.com --token-stdin
```

CI jobs usually need no login at all: set `SHIPWICK_AGENT_URL` and `SHIPWICK_AGENT_TOKEN` instead.

## Error messages

`shipwick` translates the agent's error codes into messages with a next step:

| Situation | Message |
|---|---|
| The agent cannot be reached | `cannot reach the Shipwick agent at <url>`, the cause, and a hint to open an SSH tunnel or to set `--url` / `SHIPWICK_AGENT_URL` |
| `UNAUTHORIZED` | `The agent rejected the API token.` Set `SHIPWICK_AGENT_TOKEN`, or run `shipwick login` |
| `DEPLOYMENT_IN_PROGRESS` | `Another operation is already in progress for this application.` Watch it with `shipwick status` |
| `NOT_FOUND` | `The server does not know that application.` List what it runs with `shipwick ps` |
| `NOT_DEPLOYED` | `This application has no successful deployment yet.` Deploy it with `shipwick deploy` |
| `NO_ROLLBACK_TARGET` | `There is no earlier successful deployment to go back to.` |
| `ENDPOINT_NOT_FOUND` | `The agent does not know this operation — it is probably older than this shipwick.` Compare versions with `shipwick server status` |
| `INVALID_CONFIG` | The field-by-field validation report |
| Any other API error | `Error: <message>` |

The error codes are described in the [REST API reference](/docs/reference/api#error-codes).
