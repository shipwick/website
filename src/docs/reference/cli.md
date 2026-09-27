---
title: shipwick CLI
description: Complete reference of the shipwick command-line client, covering how it finds the agent, contexts and the configuration file, environment variables, exit codes, and every command with its flags.
---

# shipwick CLI

`shipwick` is the command-line client of a Shipwick agent. This page describes how it finds the agent and its token, saved servers (contexts) and the configuration file, environment variables and exit codes, and then every command with its flags.

```text
shipwick [command] [flags]
```

| Command | |
|---|---|
| [`init`](#init) | Create a `deploy.yaml` in the current directory |
| [`validate`](#validate) | Check `deploy.yaml` without deploying, placeholders filled in |
| [`deploy`](#deploy) | Deploy the application described by `deploy.yaml`, or several applications in order |
| [`redeploy`](#redeploy) | Deploy the running configuration again, optionally with another image |
| [`rollback`](#rollback) | Go back to an earlier successful deployment |
| [`status`](#status) | Show the state of an application |
| [`ps`](#ps) | List the applications on the server |
| [`logs`](#logs) | Show the logs of an application |
| [`run`](#run) | Run a one-off command in a container of the application |
| [`jobs`](#jobs) | List the scheduled jobs of an application; `jobs run` starts one, `jobs logs` shows a run's output |
| [`stop`](#stop) | Stop an application |
| [`start`](#start) | Start a stopped application |
| [`delete`](#delete) | Remove an application, its containers and its deployment history |
| [`backup`](#backup) | Download the volumes of an application as tar archives |
| [`restore`](#restore) | Replace the data of a volume with a backup |
| [`server status`](#server-status) | Show whether the agent is reachable, what it runs on, and which token you are using |
| [`login`](#login) | Save the agent URL and API token for later commands |
| [`context`](#context) | Switch between saved servers: `ls`, `use`, `rm`, `current` |
| [`token`](#token) | Manage API tokens and their roles: `create`, `ls`, `revoke` |
| [`upgrade`](#upgrade) | Replace this `shipwick` with the latest release, and report whether the server is behind |

## Global behavior

### Global flags

| Flag | |
|---|---|
| `--url <url>` | Agent URL. Overrides `SHIPWICK_AGENT_URL` and the saved configuration. |
| `--context <name>` | Saved server to use. Overrides `SHIPWICK_CONTEXT` and the current context. |
| `--version` | Print the version of `shipwick`. |
| `-h`, `--help` | Help for any command. |

### How the agent is found

Saved servers are *contexts*: each `shipwick login` saves a URL and a token under a name. Which context a command means is decided first, then the URL and the token are resolved separately, highest precedence first:

| | Context | URL | Token |
|---|---|---|---|
| 1. Flag | `--context` | `--url` | Never a flag |
| 2. Environment | `SHIPWICK_CONTEXT` | `SHIPWICK_AGENT_URL` | `SHIPWICK_AGENT_TOKEN` |
| 3. Saved by `shipwick login` | the current context | the context's URL | the context's token |
| 4. Default | | `http://127.0.0.1:9000` | |

There is deliberately no `--token` flag. Command-line arguments are visible to every user on the machine through `ps`, and are kept in shell history.

**The saved token belongs to the saved URL.** If `--url` or `SHIPWICK_AGENT_URL` points `shipwick` at a different agent than the selected context's, the saved token is not sent there. A token from `SHIPWICK_AGENT_TOKEN` is always used.

A `--context` or `SHIPWICK_CONTEXT` that names no saved server is an error: `unknown context "ghost"`, followed by `See the saved ones with: shipwick context ls`.

The URL must be an `http://` or `https://` URL with a host. The default, `http://127.0.0.1:9000`, suits both an agent on the same machine and one reached through an SSH tunnel:

```bash
ssh -N -L 9000:127.0.0.1:9000 user@server &
shipwick login
```

A second server gets a name of its own and becomes the current one:

```bash
shipwick login --context staging --url https://staging.example.com
shipwick deploy --context prod
shipwick context use prod
```

In CI, no login is needed:

```bash
export SHIPWICK_AGENT_URL=https://agent.example.com
export SHIPWICK_AGENT_TOKEN=…
shipwick deploy --image ghcr.io/company/my-api:$GIT_SHA
```

`shipwick` warns on standard error whenever a token is about to travel over plain HTTP to anything other than the local machine (`localhost` or a loopback address). When the configuration file holds more than one server, messages that name the server add the context: `https://agent.example.com (context prod)`.

### Configuration file

`shipwick login`, `shipwick context use` and `shipwick context rm` write the file; nothing else does.

| | |
|---|---|
| Location | `<user config dir>/shipwick/config.yaml`. The user config directory is the operating system's: `$XDG_CONFIG_HOME` or `~/.config` on Linux, `~/Library/Application Support` on macOS, `%AppData%` on Windows. |
| Override | `SHIPWICK_CONFIG` sets the full path of the file. |
| Permissions | The file is written with mode `0600`, its directory is created with mode `0700`. The file is written to a temporary name and renamed into place, so the permissions apply even if the file already existed. |
| Content | `current`, the name of the current context, and `contexts`, one entry per saved server with its `url` and `token`. |

```yaml
current: prod
contexts:
  prod:
    url: https://agent.example.com
    token: swk_…
  staging:
    url: http://127.0.0.1:9000
    token: swk_…
```

A missing file is an empty configuration, not an error. A file from before contexts existed, with `url` and `token` at the top level, still loads: it becomes the context `default`, and the next write stores it in the format above. A first `shipwick login` without `--context` also saves under the name `default`.

### Environment variables

| Variable | |
|---|---|
| `SHIPWICK_AGENT_URL` | Agent URL. |
| `SHIPWICK_AGENT_TOKEN` | API token. |
| `SHIPWICK_CONTEXT` | Name of the saved server to use, like `--context`. |
| `SHIPWICK_CONFIG` | Path of the configuration file. |
| `NO_COLOR` | When set to any value, output is not colored. |
| `TERM` | `dumb` disables colors. |

### Which application a command targets

Commands that take `[app]` use the application named in `./deploy.yaml` when no argument is given. `-f` / `--file` selects another file. `delete` is the deliberate exception: it always wants the name spelled out, and so do `jobs run` and `jobs logs`, which take the application and the job as two arguments. For `logs`, `-f` means `--follow`, and the file is selected with `--file` only. For `deploy` and `validate`, `-f` can be repeated to name several files.

### Placeholders

A `deploy.yaml` may refer to values it must not contain, such as passwords and API keys, as `${NAME}`. `deploy` and `validate` fill them in before the file is validated or sent, so that the agent receives a complete document and secrets stay out of the file and the repository.

| Rule | |
|---|---|
| Form | Only `${NAME}` is recognized, where `NAME` is letters, digits and underscores, not starting with a digit. A bare `$NAME` is left alone. |
| Literal | `$${NAME}` yields a literal `${NAME}`. |
| Where | Placeholders are replaced in values only. A `${NAME}` in a comment or in a key is not a reference. |
| Sources | The process environment first, then the files given with `--env-file`, later files overriding earlier ones. A variable set in the environment wins over the same name in a file, so a CI secret can override what a checked-in file says. |
| Unset | A name that is set nowhere is an error, never an empty value: `deploy.yaml: refers to ${DATABASE_PASSWORD}, which is not set`, followed by `Set it in the environment, or in a file given with --env-file.` Nothing is sent. |
| Types | The value stays the string you wrote: a number or a boolean written through a placeholder is not reinterpreted by YAML. |

An `--env-file` is a `NAME=value` file:

```text
# Comments and blank lines are ignored.
DATABASE_PASSWORD=s3cret
export API_KEY="quoted values lose their quotes"
```

One `NAME=value` per line; a leading `export ` and surrounding single or double quotes around the value are stripped. A line that is not `NAME=value` is an error: `.env.production:3: expected NAME=value`.

`deploy` and `validate` report how many placeholders were filled in, never the values: `✓ Validated deploy.yaml (2 variables substituted)`. The agent stores the filled-in document; see [Security](/docs/security).

### Output

- Results go to standard output; warnings and errors go to standard error, so standard output stays parseable.
- When standard output is not a terminal, output is plain: no colors and no progress line.
- Validation errors are printed field by field. See the [deploy.yaml reference](/docs/reference/deploy-yaml#validation-errors).

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Anything else, including a deployment that was accepted but failed or was rolled back. |
| The command's own | `shipwick run` and `shipwick jobs run` exit with the exit code of the command that ran on the server. A command that could not be started, timed out or was interrupted exits with `1`. |

This makes `deploy`, `redeploy`, `rollback` and `run` usable as a CI gate.

### Timeouts

Regular requests time out after 90 seconds. The limit is sized for the slowest regular call: stopping an application waits for every replica's graceful shutdown. Log streams, backup downloads and restore uploads have no timeout. While waiting for a deployment or a run, `shipwick` polls the agent every 500 milliseconds and rides out up to 20 consecutive connection failures, such as an agent restart or a network blip, before it gives up.

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

# ${NAME} is filled in from the environment or --env-file when you deploy,
# so that secrets never have to be in this file.
# env:
#   DATABASE_URL: postgres://app:${DATABASE_PASSWORD}@postgres:5432/app

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

# Data that must outlive deployments (a database): named volumes, which
# need replicas: 1 and the recreate strategy.
# volumes:
#   - name: data
#     path: /var/lib/postgresql/data
# deploy:
#   strategy: recreate # rolling (default) | recreate

restart:
  policy: always # always | on-failure | never
```

`init` refuses to overwrite an existing file without `--force`. It does not contact the agent.

## validate

Check `deploy.yaml` without deploying. The file is read, its `${NAME}` placeholders are filled in from the environment and `--env-file`, and it is validated exactly as the agent would validate it. Runs offline, and prints the configuration as it will be applied, defaults included.

```text
shipwick validate [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Path to a deployment config; repeat for several applications |
| `--env-file <path>` | | `NAME=value` file for `${NAME}` placeholders; repeat for several |

```text
✓ deploy.yaml is valid (1 variable substituted)

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

The first line is `<file> is valid`, with `(N variables substituted)` when placeholders were filled in. Environment values are not printed, only their count. `Name`, `Image`, `Version`, `Replicas`, `Resources` and `Restart` always appear; `Resources` reads `unlimited CPU, unlimited memory` without limits. The other lines appear when the file sets them, in this order:

| Line | Example | |
|---|---|---|
| `Port` | `8080` | |
| `Domain` | `example.com` | |
| `Aliases` | `api.example.com, app.example.com` | The `aliases` list, comma-separated |
| `Redirects` | `www.example.com → https://example.com` | The `redirects` list, then the target every one of them redirects to |
| `Health check` | `GET /health every 10s (timeout 3s, 3 retries)` | `GET <path>` for an HTTP check, `TCP :5432` for `health.tcp`, `command pg_isready -U postgres` for `health.command` |
| `Volume` | `data at /var/lib/postgresql/data` | One line per volume |
| `Publish` | `5432/tcp → server port 15432 on 10.0.0.5` | One line per published port; `on <address>` only when `address` is set |
| `Strategy` | `recreate` | Omitted for the default, `rolling` |
| `Environment` | `2 variables` | |
| `Entrypoint` | `/app/entrypoint.sh` | The arguments, space-separated; an argument containing spaces or quotes is quoted |
| `Command` | `node worker.js` | Same form |
| `User` | `1000:1000` | |
| `Logging` | `gelf (2 options)` | The driver, and the number of options when there are any: `(1 option)`, `(2 options)` |
| `Pre-deploy` | `dotnet Migrate.dll` | The `pre_deploy` command |
| `Job` | `nightly-report at 0 3 * * * UTC: node report.js` | One line per job: its name, schedule and command |

With several files, each is validated and described in turn. An invalid file, or an unset placeholder, prints the report and exits with `1`. See [Placeholders](#placeholders).

## deploy

Deploy the application described by `deploy.yaml` and wait for the result. With several `-f`, deploy several applications in order.

```text
shipwick deploy [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Path to a deployment config; repeat for several applications |
| `--env-file <path>` | | `NAME=value` file for `${NAME}` placeholders; repeat for several |
| `--image <ref>` | | Deploy this image instead of the one in the configuration. One application only. |
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

- The file is read, its `${NAME}` placeholders are filled in from the environment and `--env-file`, and it is validated locally before anything is sent. The agent validates it again. See [Placeholders](#placeholders).
- **`deploy` waits for `completed_at`**, not for the first `ACTIVE`. When it returns, the next operation on the application is guaranteed not to be rejected as busy.
- `--image` edits the YAML document in memory. The agent still receives one plain `deploy.yaml`, and the file on disk is untouched. This is the form for CI: keep `deploy.yaml` in the repository and pass the image that was just built.
- **Ctrl+C stops the waiting, not the deployment.** The deployment continues on the server; follow it with `shipwick status`.
- With `--no-wait`, the command prints `Deployment #N started` and exits with `0` without knowing the outcome.
- In a terminal, a transient progress line shows what the agent is busy with: pulling the image, starting containers, checking health, switching over, retiring the previous version.
- With a `pre_deploy` command, two more lines follow the pull: `✓ Running pre-deploy command` and `✓ Pre-deploy command finished (12s)`. If the command fails, the deployment fails before any replica of the new version was started, and its last output lines are printed under the error.

If the deployment fails, the command prints the cause, the saved output of the failed replica or pre-deploy command if there is any, and what is running now, then exits with `1`:

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
| `ROLLED_BACK` | Headline `Deployment failed and was rolled back`, then `my-api is running 1.4.1 again: the previous version was restored.` |
| The previous version is not fully healthy afterwards | `my-api is running 1.4.1, but it is DEGRADED right now (1/2 replicas healthy). Shipwick keeps trying to restore it:` |
| Nothing was deployed before | `my-api has no running version.` |

### Several applications

`-f` repeated deploys several applications, in the order given, one after the other:

```bash
shipwick deploy -f api/deploy.yaml -f worker/deploy.yaml --env-file .env.production
```

- Every file is read and validated before the first deployment starts, so that a mistake in the third does not leave the first two half done.
- Each application is deployed and waited for like a single one, with its own `Deploying <name>...` block.
- The command stops at the first failure: what comes later usually depends on what came before. It then prints `Stopped at worker: 1 of 3 applications deployed.` and exits with `1`. The applications already deployed stay deployed.
- When every deployment succeeds, the last line is `3 of 3 applications deployed.`
- `--image` applies to one application. With several files it is refused: `--image applies to one application; deploy several with one deploy.yaml each and no --image`.

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
| `--to` names a number that does not exist | `there is no deployment #9`, then `See the history with: shipwick status` |
| No earlier successful deployment | `there is no earlier successful deployment to go back to` |

See [Rollback](/docs/concepts/rollback) and [Roll back and redeploy](/docs/tasks/roll-back).

## status

Show the state of an application: its version, resource usage, replicas, recent deployments and recent events.

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
4. **Events.** The 8 most recent application events: what the supervisor has been doing, stops and starts (`Application stopped by ci` when a token other than root did it), restored backups, and scheduled jobs or one-off commands that failed or timed out.

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
- With a `logging` driver in `deploy.yaml`, the lines come from the local copy Docker keeps next to the remote driver.

## run

Run a one-off command in a fresh container from the application's image, with its environment, limits and network, and exit with the command's exit code.

```text
shipwick run [app] -- <command> [args...]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted |

```text
$ shipwick run my-api -- rails db:migrate
== 20260301 AddIndexToOrders: migrating ===
== 20260301 AddIndexToOrders: migrated (0.0412s) ===
```

- The command comes after `--`, as a list of arguments. It is handed to the container as it is, never through a shell: `shipwick run my-api -- sh -c 'echo $HOME'` is how to get one. Without `--`, or with nothing after it: `no command given`, followed by `Put it after --, e.g.: shipwick run my-api -- rails db:migrate`. More than one word before `--` is refused: `expected one application before --, got 2: my-api extra`.
- The command is validated before it is sent, like a `command` in `deploy.yaml`: at most 256 arguments, each at most 4096 bytes.
- The container gets none of the application's volumes: those belong to the running replica. It reaches other applications by name, like a replica does.
- The command runs on the server, for at most an hour. In a terminal, a progress line reads `Running rails db:migrate` meanwhile. Its output is printed when it finishes: the last 200 lines it wrote, at most 64 KB.
- **Exit code.** `shipwick` exits with the command's exit code. When the command failed it prints `✗ failed (exit 1)` first. `✗ The command could not be started`, `✗ timed out` and `✗ interrupted by an agent restart` exit with `1`.
- **Ctrl+C stops the waiting, not the command.** It continues on the server; the output says how to read its result later: `shipwick jobs logs my-api run --run 42`.
- Several commands may run at once; they are independent of one another. A one-off command is recorded as a run of the job named `run`.

The application must have an active deployment. Needs a token with the `deploy` role. See [Run scheduled jobs and one-off commands](/docs/tasks/jobs).

## jobs

List the scheduled jobs of an application: schedule, last run, next run. Schedules and times are in UTC.

```text
shipwick jobs [app] [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted |

```text
$ shipwick jobs my-api
NAME            SCHEDULE     LAST RUN  STATUS           NEXT (UTC)
nightly-report  0 3 * * *    21h ago   succeeded        2026-03-02 03:00
cleanup         */15 * * * * 4m ago    failed (exit 1)  2026-03-01 12:15
```

- `LAST RUN` is `never` until a job has run. `STATUS` is `running`, `succeeded`, `failed (exit N)`, `failed to start`, `timed out` or `interrupted by an agent restart`.
- `NEXT (UTC)` is `-` while the application is stopped: a stopped application runs no jobs.
- Without jobs in `deploy.yaml`: `my-api has no scheduled jobs. Add some under `jobs` in deploy.yaml.`

The application must have an active deployment.

### jobs run

Start a scheduled job now and wait for it.

```text
shipwick jobs run <app> <job>
```

The run is followed and reported exactly like [`run`](#run): its output is printed when it finishes, and `shipwick` exits with the job's exit code. A job runs one at a time: while an earlier run of it is still going, the agent refuses with `JOB_ALREADY_RUNNING` (see [Error messages](#error-messages)). An unknown job name is `The server does not know that application.`, the agent's `NOT_FOUND`.

### jobs logs

Show the output of a job's last run, or of the run given with `--run`.

```text
shipwick jobs logs <app> <job> [flags]
```

| Flag | Default | |
|---|---|---|
| `--run <id>` | the last run | Show this run instead. The id is the run's `id` in the API; `run` and `jobs run` print it when interrupted |

```text
$ shipwick jobs logs my-api cleanup
Run #42 of cleanup: failed (exit 1), started 4m ago
rm: cannot remove '/tmp/cache': Permission denied
```

The first line names the run, how it ended and when it started; the output follows. Two job names are always valid: `pre-deploy` shows the last pre-deploy command of a deployment, `run` the last one-off command started with `shipwick run`. Without runs: `my-api has no runs of cleanup yet.` The agent keeps the last 50 runs of each job.

## stop

Stop an application. It stays stopped until it is started or deployed again.

```text
shipwick stop [app] [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted |

The application is taken out of the proxy's rotation first, then every replica is stopped gracefully. Its domain and aliases answer `503` and keep their certificates; its redirects keep working. Scheduled jobs do not run while it is stopped. The containers are kept. Prints `✓ Stopped my-api`.

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

Deletion cannot be undone. The history goes with the application, and with it every stored configuration that a rollback could have used. Volumes are kept. Needs a token with the `admin` role.

## backup

Download the volumes of an application, one tar archive each.

```text
shipwick backup [app] [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted |
| `--volume <name>` | every volume | Back up only this volume |
| `-o`, `--output <dir>` | `.` | Directory to write the archives to |

```text
$ shipwick backup postgres
✓ postgres-data-20260927-153000.tar (12.5 MB)
```

- Each archive is named `<app>-<volume>-<UTC timestamp>.tar`, the timestamp in the form `yyyymmdd-hhmmss`, and is created with mode `0600`. An existing file is never overwritten: the command fails instead. A download that breaks off is deleted, so that half a backup never looks like one.
- The archive holds the volume's contents relative to its mount point, as a plain tar. It is streamed to disk, so a backup can be larger than memory, and the download has no timeout. In a terminal, a progress line reads `Backing up volume data of postgres` meanwhile.
- The copy is taken while the application runs, unless it is stopped. When it is running, a warning on standard error says so: `postgres is running; for a consistent copy of a database, stop it first or use its own dump tool: shipwick run postgres -- pg_dump ...`. The copy of a database that is being written to is not guaranteed consistent.
- The application is locked while an archive streams; a deployment asked for meanwhile is refused as busy.
- `--volume` naming a volume the application does not have: `postgres has no volume "x"; it has: data`. An application without volumes: `postgres has no volumes; there is nothing to back up or restore`.

The application must have an active deployment. Needs a token with the `admin` role: a backup carries the application's data. See [Back up and restore volumes](/docs/tasks/backups).

## restore

Replace everything in a volume with the contents of a tar archive, as written by `shipwick backup`.

```text
shipwick restore [app] <archive.tar> [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted |
| `--volume <name>` | the application's only volume | The volume to restore. Required when the application has several: `postgres has 2 volumes; name one with --volume: data, config` |
| `-y`, `--yes` | | Do not ask for confirmation |

```text
$ shipwick stop postgres
✓ Stopped postgres
$ shipwick restore postgres postgres-data-20260927-153000.tar
This replaces the data of volume data of postgres with postgres-data-20260927-153000.tar. The application must be stopped and is not started afterwards.
Continue? [y/N] y
✓ Restored volume data of postgres from postgres-data-20260927-153000.tar
Start it with: shipwick start postgres
```

- The archive is the last argument. It is checked locally before anything is sent: a file that does not start like a tar archive, such as a `.tar.gz` or a SQL dump, is refused with `<file> is not a tar archive; restore takes the .tar written by shipwick backup`. The agent checks again before it touches the volume.
- **The application must be stopped**, and stays stopped afterwards. A running application is refused by the agent with `APPLICATION_RUNNING` (see [Error messages](#error-messages)).
- The volume is removed and created again before the archive is extracted into it: what the archive does not name is gone.
- In a terminal, the confirmation is `y` or `yes`; anything else prints `cancelled`. Outside a terminal, `--yes` is required. A progress line shows the upload as a percentage. The upload has no timeout; the agent accepts up to 10 GB.

Needs a token with the `admin` role. See [Back up and restore volumes](/docs/tasks/backups).

## server status

Show whether the agent is reachable, what it runs on, and which token you are using.

```text
shipwick server status
```

```text
https://agent.example.com  ● reachable

Agent           v0.3.0
CLI             v0.3.0
Host            vps-1
OS              linux (amd64, kernel 6.8.0)
Docker          29.8.0
CPUs            4
Memory          8 GB
Applications    3
Containers      5 running
Proxy           ok  serving 4 domains
Notifications   webhook configured
Token           ci (deploy)
```

The command first calls the health endpoint, which needs no token. This separates "cannot reach the agent" from "reached it, but the token is wrong". The first line is the agent's URL and `● reachable`, with `context <name>` after the URL when the configuration file holds several servers. Then:

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
| `Notifications` | `webhook configured`, or `none  (set SHIPWICK_WEBHOOK_URL on the agent)` |
| `Token` | The name and role of the token this command used: `ci (deploy)`, or `root (admin)` for the token the agent is configured with. Omitted with an agent from before tokens had names |

If the token is rejected, the agent's version is still shown before the error.

## login

Save the agent URL and API token for later commands.

```text
shipwick login [flags]
```

| Flag | |
|---|---|
| `--token-stdin` | Read the token from standard input |
| `--context <name>` | Save the server under this name and make it the current context. Global flag; without it, the selected context is overwritten, or `default` is created |

```text
$ shipwick login --url https://agent.example.com
API token:
✓ Logged in to https://agent.example.com (my-server, agent v0.3.0)
  saved as context default in /home/me/.config/shipwick/config.yaml
```

- In a terminal without `--url`, `login` asks for the agent URL, offering the currently resolved URL as the default: the context's saved URL if it exists, `SHIPWICK_AGENT_URL` if set, otherwise `http://127.0.0.1:9000`.
- The token is asked for without echo. It is never taken from `SHIPWICK_AGENT_TOKEN` or from the saved configuration: giving it afresh is the point of logging in.
- The token is verified against the agent before anything is saved. If the agent rejects it, `the agent rejected this token; nothing was saved`.
- Outside a terminal, `--token-stdin` is required. At most 4096 bytes are read, and surrounding whitespace is trimmed.
- The context the login saves to is `--context`, then `SHIPWICK_CONTEXT`, then the current context, then `default`. Whatever it is, it becomes the current context.

```bash
printf %s "$TOKEN" | shipwick login --url https://agent.example.com --token-stdin
shipwick login --context staging --url https://staging.example.com
```

CI jobs usually need no login at all: set `SHIPWICK_AGENT_URL` and `SHIPWICK_AGENT_TOKEN` instead.

## context

Switch between saved servers. Each `shipwick login` saves a server under a name, a context. Commands talk to the current one; `--context` or `SHIPWICK_CONTEXT` picks another for one command. See [How the agent is found](#how-the-agent-is-found).

```text
shipwick context ls
shipwick context use <name>
shipwick context rm <name> [flags]
shipwick context current
```

### context ls

List the saved servers, sorted by name; `*` marks the current one.

```text
$ shipwick context ls
  NAME     URL
* prod     https://agent.example.com
  staging  https://staging.example.com
```

Without any: `No saved servers.`, then `Save one with: shipwick login`.

### context use

Make a saved server the current one. Prints `✓ Switched to prod (https://agent.example.com)`. An unknown name: `unknown context "ghost"`, then `See the saved ones with: shipwick context ls`.

### context rm

Forget a saved server and its token.

| Flag | |
|---|---|
| `-y`, `--yes` | Do not ask for confirmation |

In a terminal, `rm` asks `Forget staging (https://staging.example.com) and its token? [y/N]`; outside one it refuses without `--yes`. Prints `✓ Removed context staging`. Removing the current context leaves none current, deliberately: the command then adds `no server is current now; pick one with: shipwick context use <name>`, and until you do, commands without `--context` use the default URL, `http://127.0.0.1:9000`, without a token.

### context current

Print the name of the current context, and nothing else, for scripts. Errors: `no saved servers` and `no server is current`, each with the command to fix it.

## token

Manage API tokens and their roles. A token has one of three roles: `read` sees everything (status, logs, history, metrics); `deploy` also changes what runs (deploy, redeploy, roll back, stop, start, run commands); `admin` also does the rest (delete applications, back up and restore volumes, manage tokens). Give CI a `deploy` token and keep `admin` tokens for people.

The token the agent is configured with, `SHIPWICK_AGENT_TOKEN` or the one it generated on first start, is `root`: it has the `admin` role, is not listed here and cannot be revoked here. Change it on the agent. Every `token` command needs the `admin` role.

```text
shipwick token create <name> --role read|deploy|admin
shipwick token ls
shipwick token revoke <name> [flags]
```

### token create

Create a token. Its value is shown once.

| Flag | |
|---|---|
| `--role <role>` | What the token may do: `read`, `deploy` or `admin`. Required: without it, `choose what the token may do: --role read, deploy or admin` |

```text
$ shipwick token create ci --role deploy
✓ Created token ci with the deploy role

    swk_Xk3nM9…

Store it now: it will not be shown again.
In CI, set SHIPWICK_AGENT_TOKEN to it. On a machine you work from, save it with: shipwick login
```

Names are lowercase letters, digits and dashes, at most 40 characters, starting and ending with a letter or digit; `root` is taken. A name that exists is refused by the agent with `TOKEN_EXISTS`. The value starts with `swk_`; the prefix is not part of the secret and only makes a token recognizable where it must not appear.

### token ls

List the tokens, oldest first, without their values. `list` is an alias.

```text
$ shipwick token ls
NAME  ROLE    CREATED  LAST USED
ci    deploy  3d ago   12m ago
anna  admin   1d ago   never
```

`LAST USED` is kept to the minute by the agent and reads `never` until the token is first used. The root token is not listed. Without stored tokens: `No tokens besides the one the agent is configured with. Create one with: shipwick token create ci --role deploy`.

### token revoke

Revoke a token; whatever uses it is refused from then on.

| Flag | |
|---|---|
| `-y`, `--yes` | Do not ask for confirmation |

In a terminal, `revoke` asks for the token name to be typed as confirmation; outside one it refuses without `--yes`. Prints `✓ Revoked token ci`. Revoking `root`: `the root token is the one the agent is configured with; change SHIPWICK_AGENT_TOKEN on the agent instead`. An unknown name: `there is no token named ci`, then `List the tokens with: shipwick token ls`. A token may revoke itself.

See [Create tokens for CI and teammates](/docs/tasks/tokens).

## upgrade

Replace this `shipwick` with the latest release, and report whether the server is behind.

```text
shipwick upgrade [flags]
```

| Flag | |
|---|---|
| `--check` | Report what is available and change nothing |

```text
$ shipwick upgrade
✓ Upgraded shipwick v0.2.0 → v0.3.0
  /usr/local/bin/shipwick

The server runs v0.2.0; v0.3.0 is available. On the server run:
  curl -fsSL https://get.shipwick.com | sh
```

How the binary is replaced:

- The latest release, never a pre-release, is looked up on GitHub. The release's `checksums.txt` is downloaded, then the binary for this operating system and architecture (`shipwick_linux_amd64`, `shipwick_windows_amd64.exe`, and so on) is written next to the running one as `.shipwick-new`, its SHA-256 is compared with the published checksum, and only then is it renamed over the old binary, with the old binary's permissions. A mismatch is refused, `<asset> does not match the checksum published with release <tag>; nothing was changed`, and so is a release without a binary for this platform. On Windows, where a running executable cannot be deleted, the old binary is moved aside as `shipwick.old.exe` and removed the next time `shipwick` runs.
- **Homebrew and winget.** A binary under Homebrew's Cellar or winget's Packages directory is recognized by its path and left to the package manager. The command prints `shipwick v0.2.0 was installed with Homebrew; v0.3.0 is available.` followed by `Upgrade with: brew upgrade shipwick`, or the same with `winget upgrade Shipwick.Shipwick`, and changes nothing.
- **Already current:** `shipwick v0.3.0 is up to date.` A build without a release version: `This shipwick is a development build (dev); the latest release is v0.3.0.` Neither changes anything.
- **`--check`** prints `shipwick v0.2.0 is installed; v0.3.0 is available.` and `Upgrade with: shipwick upgrade`, and changes nothing.
- **Where it refuses.** A directory it cannot write to: `cannot write to /usr/local/bin: permission denied`, then `Run it as root: sudo shipwick upgrade` or the installer line `curl -fsSL https://get.shipwick.com | sh -s -- --cli`; on Windows, the advice is an administrator prompt or downloading the `.exe` from the releases page. Nothing is downloaded before the staging file could be created.

The server is not upgraded by this command: the installer does that, on the server, with access to Docker. After the binary step, `upgrade` asks the configured agent's health endpoint, which needs no token, and prints one of:

| Situation | Line |
|---|---|
| The server is behind | `The server runs v0.2.0; v0.3.0 is available. On the server run:` and the installer command |
| The server is current | `The server runs v0.3.0, the latest release.` |
| The server runs a development build | `The server runs a development build (dev).` |
| The server cannot be reached | `The server at http://127.0.0.1:9000 could not be reached; its version was not checked.` |
| The URL does not answer as an agent | `The server at <url> did not answer as a Shipwick agent; its version was not checked.` |
| No server could be resolved | `The server was not checked: ` and the reason, such as an unknown context |

None of these fail the command. See [Upgrade Shipwick](/docs/tasks/upgrade).

## Error messages

`shipwick` translates the agent's error codes into messages with a next step:

| Situation | Message |
|---|---|
| The agent cannot be reached | `cannot reach the Shipwick agent at <url>`, the cause, and a hint to open an SSH tunnel, to set `--url` / `SHIPWICK_AGENT_URL`, or to pick another saved server with `--context` |
| `UNAUTHORIZED` | `The agent rejected the API token.` Set `SHIPWICK_AGENT_TOKEN`, or run `shipwick login` |
| `FORBIDDEN` | `This token may not do that: it has the read role.` Then `Use a token with the deploy role, or create one with: shipwick token create <name> --role deploy`. The roles come from the agent's answer; an agent that sends none is quoted: `This token may not do that: <message>` |
| `DEPLOYMENT_IN_PROGRESS` | `Another operation is already in progress for this application.` Watch it with `shipwick status` |
| `NOT_FOUND` | `The server does not know that application.` List what it runs with `shipwick ps` |
| `NOT_DEPLOYED` | `This application has no successful deployment yet.` Deploy it with `shipwick deploy` |
| `NO_ROLLBACK_TARGET` | `There is no earlier successful deployment to go back to.` See the history with `shipwick status` |
| `APPLICATION_RUNNING` | `The application is running, and a restore replaces the files under it.` Stop it first with `shipwick stop` |
| `JOB_ALREADY_RUNNING` | `This job is still running from an earlier start.` See it with `shipwick jobs <app>` |
| `ENDPOINT_NOT_FOUND` | `The agent does not know this operation — it is probably older than this shipwick.` Compare versions with `shipwick server status` |
| `INVALID_CONFIG` | The field-by-field validation report. A hostname or a published port that another application holds is reported the same way, under the line that claims it: `aliases[1]`, `publish[0].host` |
| Any other API error | `Error: <message>` |

The error codes are described in the [REST API reference](/docs/reference/api#error-codes).
