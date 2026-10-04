---
title: shipwick CLI
description: Complete reference of the shipwick command-line client, covering how it finds the agent, contexts and the configuration file, environment variables, exit codes, and every command with its flags, from deploy and status to traffic, backups, certificates, registry credentials, tokens, the audit trail, access rules, export and import.
---

# shipwick CLI

`shipwick` is the command-line client of a Shipwick agent. This page describes how it finds the agent and its token, saved servers (contexts) and the configuration file, environment variables and exit codes, and then every command with its flags and output: deploying and inspecting applications, traffic, backups, registry credentials and certificates, tokens, the audit trail and the rules for people who sign in to the dashboard, moving a server with `export` and `import`, and the messages the agent's error codes are turned into.

```text
shipwick [command] [flags]
```

| Command | |
|---|---|
| [`init`](#init) | Recognise the project and write a `Dockerfile`, a `.dockerignore` and a `deploy.yaml`, or add an entry to a `shipwick.yaml` |
| [`validate`](#validate) | Check `deploy.yaml` or `shipwick.yaml` without deploying, placeholders filled in |
| [`deploy`](#deploy) | Deploy the application described by `deploy.yaml`, building the image here with `build:`, or the applications of a `shipwick.yaml`: all of them, or the ones named |
| [`redeploy`](#redeploy) | Deploy the running configuration again, optionally with another image |
| [`config`](#config) | Print the `deploy.yaml` of what an application runs |
| [`rollback`](#rollback) | Go back to an earlier successful deployment |
| [`status`](#status) | Show the state of an application |
| [`ps`](#ps) | List the applications on the server |
| [`logs`](#logs) | Show the logs of an application, and the kept output of containers that ended |
| [`traffic`](#traffic) | Show the requests the proxy served: rates, errors, latency |
| [`run`](#run) | Run a one-off command in a container of the application |
| [`jobs`](#jobs) | List the scheduled jobs of an application; `jobs run` starts one, `jobs logs` shows a run's output |
| [`stop`](#stop) | Stop an application |
| [`start`](#start) | Start a stopped application |
| [`delete`](#delete) | Remove an application, its containers and its deployment history |
| [`backup`](#backup) | Download the volumes of an application as tar archives |
| [`restore`](#restore) | Replace the data of a volume with an archive from this machine |
| [`backups`](#backups) | List the backups the server keeps of an application; `run`, `verify`, `restore`, `download`, `rm`, `decrypt`, `adopt` |
| [`volumes`](#volumes) | List every volume on the server; `volumes rm` removes one of a deleted application |
| [`export`](#export) | Write everything the server runs into one encrypted file |
| [`import`](#import) | Deploy what an export holds on this server, and restore its data |
| [`standby`](#standby) | A second server kept ready: what it holds; `pull` imports the newest export, `promote` takes over |
| [`server status`](#server-status) | Show whether the agent is reachable, what it runs on, how full its disk is, which token you are using, the active alerts, and whether a newer release exists |
| [`server install`](#server-install) | Install or upgrade the server over SSH, from here |
| [`server bundle`](#server-bundle) | Make one file that installs or upgrades a server with no connection |
| [`server rotate-key`](#server-rotate-key) | Replace the key the server encrypts stored secrets with |
| [`server backup`](#server-backup) | Back up the agent's own state now: its database and encryption key |
| [`doctor`](#doctor) | Check the setup end to end and say what to fix |
| [`open`](#open) | Open the application, or the dashboard, in the browser |
| [`login`](#login) | Save the agent URL and API token for later commands |
| [`context`](#context) | Switch between saved servers: `ls`, `use`, `rm`, `current` |
| [`token`](#token) | Manage API tokens and their roles: `create`, `ls`, `update`, `revoke` |
| [`audit`](#audit) | Show who changed what on the server, and when, or export it |
| [`access`](#access) | Say who may sign in to the dashboard, and as what: `grant`, `ls`, `revoke`, `sessions`, `signout` |
| [`secret`](#secret) | Manage the secrets kept on the server for `${NAME}`: `set`, `ls`, `rm` |
| [`registry`](#registry) | Store the credentials the server pulls private images with: `login`, `ls`, `logout` |
| [`cert`](#cert) | Serve a hostname with a certificate of your own: `set`, `ls`, `rm` |
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
| `SHIPWICK_EXPORT_PASSPHRASE` | Passphrase of an export file, for [`export`](#export) and [`import`](#import). Without it, the passphrase is asked for without echo. |
| `SHIPWICK_BACKUP_PASSPHRASE` | Passphrase for [`backups decrypt`](#backups-decrypt): the value the variable has on the agent. Without it, the passphrase is asked for without echo. |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | The proxy the requests of `shipwick` go through, to the agent and to GitHub (`upgrade`, `doctor`, `server bundle`). Since 0.6. |
| `SHIPWICK_CA_FILE` | A PEM file of certificate authorities trusted in addition to the system's, for an agent whose certificate a company's own authority issued. Since 0.6. |
| `NO_COLOR` | When set to any value, output is not colored. |
| `TERM` | `dumb` disables colors. |

Behind a proxy, a host that `NO_PROXY` covers is reached directly, and so is a name without a dot. A user name and a password go into the proxy's URL, `http://user:password@proxy.example.com:3128`.

`SHIPWICK_CA_FILE` is read before every command, and a file that cannot be used stops the command with what is wrong with it: the file does not exist, is a directory, holds a private key and no certificate, holds a server's certificate where the authority's is expected, or holds only certificates that have expired.

```text
Error: SHIPWICK_CA_FILE: /etc/shipwick/ca.pem holds no certificate; expected PEM, one or more blocks that begin with -----BEGIN CERTIFICATE-----
```

See [Run behind a corporate proxy or without internet](/docs/tasks/corporate-network).

### Which application a command targets

Commands that take `[app]` use the application named in `./deploy.yaml` when no argument is given. `-f` / `--file` selects another file. For `logs`, `-f` means `--follow`, and the file is selected with `--file` only. For `deploy` and `validate`, `-f` can be repeated to name several files, and both look for `shipwick.yaml`, several applications in one file, when there is no `deploy.yaml`. Since 0.8 the two take names as arguments, which choose among the applications of a `shipwick.yaml`; see [Some applications of a shipwick.yaml](#some-applications-of-a-shipwick-yaml).

Since 0.5, the other commands that take `[app]` (`status`, `logs`, `stop`, `start`, `rollback`, `redeploy`, `run`, `jobs`, `open`, `backup`, `restore` and `backups`) also look at a `shipwick.yaml` when there is no `deploy.yaml` in the directory. One that describes a single application names it. One that describes several is an error that lists them and shows the command with a name:

```text
Error: shipwick.yaml describes 3 applications: postgres, api, web

Say which one, e.g.: shipwick status postgres
```

With neither file: `no application given, and deploy.yaml was not found here`, followed by the command with an example name. Only the name is read from the file; a `${NAME}` placeholder that is not set in the environment does not get in the way.

Some commands always want the name spelled out: `delete`, deliberately; `jobs run` and `jobs logs`, which take the application and the job as two arguments; and the subcommands of `backups` (`run`, `verify`, `restore`, `download`, `rm`). `backups adopt` without a name looks at the whole server, not at the application of `deploy.yaml`. `traffic` is the exception the other way round: without a name it lists every application. In a directory with neither file, `open` opens the dashboard.

### Placeholders

A `deploy.yaml` may refer to values it must not contain, such as passwords and API keys, as `${NAME}`. `deploy` and `validate` fill them in before the file is validated or sent, from the environment and `--env-file`, so that secrets stay out of the file and the repository. An `env` value, or a `proxy.basic_auth` password, whose name is set nowhere here is left to the server, which fills it in from the secrets stored with [`shipwick secret set`](#secret).

| Rule | |
|---|---|
| Form | Only `${NAME}` is recognized, where `NAME` is letters, digits and underscores, not starting with a digit. A bare `$NAME` is left alone. |
| Literal | `$${NAME}` yields a literal `${NAME}`, on the server too. |
| Where | Placeholders are replaced in values only. A `${NAME}` in a comment or in a key is not a reference. |
| Sources | The process environment first, then the files given with `--env-file`, later files overriding earlier ones. A variable set in the environment wins over the same name in a file, so a CI secret can override what a checked-in file says. What neither has, in an `env` value, is filled in by the agent from the server's secrets when the deployment is recorded. |
| Unset | A name outside `env` that is set nowhere is an error, never an empty value: `deploy.yaml: refers to ${DATABASE_PASSWORD}, which is not set`. Nothing is sent. An `env` value whose name is set neither here nor on the server is refused by the agent before anything is recorded, naming the variable and the command to run: `shipwick secret set DATABASE_PASSWORD`. |
| Types | The value stays the string you wrote: a number or a boolean written through a placeholder is not reinterpreted by YAML. |

An `--env-file` is a `NAME=value` file:

```text
# Comments and blank lines are ignored.
DATABASE_PASSWORD=s3cret
export API_KEY="quoted values lose their quotes"
```

One `NAME=value` per line; a leading `export ` and surrounding single or double quotes around the value are stripped. A line that is not `NAME=value` is an error: `.env.production:3: expected NAME=value`.

`deploy` and `validate` report how many placeholders were filled in, never the values: `✓ Validated deploy.yaml (2 variables substituted)`; `validate` lists the names it left to the server. The agent stores the filled-in document, with the server's secrets filled in too; see [Security](/docs/security).

### Output

- Results go to standard output; warnings and errors go to standard error, so standard output stays parseable.
- When standard output is not a terminal, output is plain: no colors and no progress line.
- Validation errors are printed field by field. See the [deploy.yaml reference](/docs/reference/deploy-yaml#validation-errors).

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Anything else, including a deployment that was accepted but failed or was rolled back, a `shipwick.yaml` of which an application failed or was skipped, a backup that failed or did not verify, an `import` or a `standby promote` of which an application failed, and a `doctor` that found a problem. |
| The command's own | `shipwick run` and `shipwick jobs run` exit with the exit code of the command that ran on the server. A command that could not be started, timed out or was interrupted exits with `1`. |

This makes `deploy`, `redeploy`, `rollback`, `run` and `doctor` usable as a CI gate.

### Timeouts

Regular requests time out after 90 seconds. Stopping and deleting an application are not regular: they wait for every replica's graceful shutdown, which [`deploy.stop_timeout`](/docs/reference/deploy-yaml#deploy) may set to minutes, and have no timeout. Neither have log streams, image and folder uploads, backup downloads and restore uploads, `export`, `import`, and `standby promote` against an agent older than 0.6. While waiting for a deployment, a run, a backup or a promotion, `shipwick` polls the agent every 500 milliseconds and rides out up to 20 consecutive connection failures, such as an agent restart or a network blip, before it gives up. A deployment that is running when the agent restarts is resumed by the agent, and `deploy` waits through the restart.

## init

Recognise the project in the current directory and write a `Dockerfile`, a `.dockerignore` and a `deploy.yaml` for it. In a directory with a `shipwick.yaml` and no `deploy.yaml`, add an entry to that file instead; see [init next to a shipwick.yaml](#init-next-to-a-shipwick-yaml).

```text
shipwick init [dir] [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Path of the file to write |
| `--force` | | Overwrite an existing `deploy.yaml`. A Dockerfile is never overwritten |
| `--name <name>` | the directory name | Application name |
| `--image <ref>` | | Container image, for example `ghcr.io/company/my-api:1.0.0`. Skips project detection and writes no Dockerfile |
| `--static <dir>` | | Serve this folder of files as it is, for example `dist/`. Skips project detection |
| `--port <n>` | | Port the application listens on |
| `--domain <host>` | | Public domain, for example `api.example.com`. Required for a static site |

`init` looks at the directory first:

| Found | Written |
|---|---|
| A Nuxt or Next.js application; a SvelteKit application with `@sveltejs/adapter-node`; a Remix application; an Astro application with the Node adapter (`@astrojs/node`); a Node server (Express, Fastify, Koa, Hono, or a `start` script); a .NET project (`*.csproj`); a Go program (`go.mod` with a `main` package at the root or under `cmd/`); a Python application (`pyproject.toml` or `requirements.txt`; uvicorn or gunicorn when they are listed; `uv sync --frozen` when the project is locked with uv, a `uv.lock` next to `pyproject.toml`) | A multi-stage `Dockerfile` on a small runtime image with a non-root user and the port exposed, a `.dockerignore`, and a `deploy.yaml` with `build: .`. Lock files decide between npm, pnpm and yarn |
| An `index.html` at the root or in `dist/`, `build/`, `out/` or `public/`; a Vite or Astro project that builds one (`dist/`); a SvelteKit project with `@sveltejs/adapter-static` (`build/`); a Next.js project with `output: "export"` in its `next.config` file (`out/`) | A `deploy.yaml` with `static: <dir>` and no Dockerfile: the proxy serves the files, there is no container. A project built by Vite alone gets `static: {dir: dist/, fallback: index.html}`, as a single-page application needs |
| Nothing recognised | In a terminal, `init` asks for the name, the image, the port and, if a port was given, the domain, and writes a `deploy.yaml` with `image:`. Outside a terminal, `--image` is required |

```text
✓ Recognised a Nuxt application
✓ Wrote Dockerfile, .dockerignore and deploy.yaml

Review them, then run: shipwick deploy
```

The first line names what was found: `a Next.js application`, `a SvelteKit application`, `a Remix application`, `an Astro application`, `a Node.js application`, `a Go program`, `a Python application`, `a static site (dist/)`, or, for a project whose build writes the folder, `a site built by npm run build`, `a SvelteKit site built by npm run build`, `a Next.js site exported by npm run build`, with the project's package manager in place of `npm run`.

An existing `Dockerfile` or `.dockerignore` is kept: `Kept the existing Dockerfile; build: . will use it`. A health check at `/` is written live for a Nuxt, Next.js, SvelteKit, Remix or Astro application, which answers its root; for the other kinds it is left commented at the path the framework's community uses, with a hint on adding it. A .NET project gets a commented `start_period: 60s`.

A Node project without a lock file gets a Dockerfile that installs with `npm install`, and a warning:

```text
! no lock file: the Dockerfile installs with npm install, and the build is not reproducible until package-lock.json is committed
```

A SvelteKit project with neither adapter is not guessed at: `this SvelteKit project has no adapter that Shipwick can deploy`, followed by which to install, `@sveltejs/adapter-node` for a server or `@sveltejs/adapter-static` for files the proxy serves.

The default name is derived from the current directory's name: lowercased, with other characters replaced by dashes. If that does not give a valid name, `my-app` is used.

What `init` knew becomes live settings. Everything else is written as commented-out examples:

```bash
shipwick init --name my-api --image ghcr.io/company/my-api:1.0.0 --port 8080
```

```yaml
name: my-api

# Pin a version tag: deployments are recorded (and rolled back) by it.
image: ghcr.io/company/my-api:1.0.0

# Run something other than the image's default. A string is one argument;
# use a list for several: nothing is split on spaces.
# entrypoint: ["dotnet"]
# command: ["App.dll", "--urls", "http://0.0.0.0:8080"]
# user: "1000:1000"

# Put an init process in front of the image's own, for a process that does
# not handle SIGTERM (Node started as `node server.js`). Not for an image
# that brings its own (tini, s6-overlay).
# init: true

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
# Not an HTTP application? Instead of path, check that a port accepts
# connections, or run a command inside the replica (exit 0 is healthy):
#   tcp: 5432
#   command: ["pg_isready", "-U", "postgres"]

# Per-replica limits. Unlimited when omitted.
# resources:
#   cpu: 1
#   memory: 512mb

# Take away what the application does not need. Each key is independent;
# tmpfs is scratch space in memory, for what must be written under a
# read-only root.
# security:
#   read_only: true
#   tmpfs: [/tmp]
#   capabilities: none # or the ones to keep: [CHOWN, SETGID, SETUID]
#   non_root: true     # needs a numeric user, here or in the image

# Data that must outlive deployments (a database): named volumes, which
# need replicas: 1 and the recreate strategy.
# volumes:
#   - name: data
#     path: /var/lib/postgresql/data
# deploy:
#   strategy: recreate # rolling (default) | recreate

# Run from the new image before its replicas start: database migrations.
# It runs next to the version still serving, so it must be compatible with it.
# pre_deploy:
#   command: ["dotnet", "Migrate.dll"]
#   timeout: 10m

# Scheduled jobs: a one-off container from this image, on a cron schedule (UTC).
# jobs:
#   - name: nightly-report
#     schedule: "0 3 * * *"
#     command: ["node", "report.js"]
#     timeout: 1h

restart:
  policy: always # always | on-failure | never
```

For a recognised project the `image` lines read `build: .` with a comment saying the image is built by `shipwick deploy`. Since 0.6, a Node project whose Dockerfile `init` writes (Nuxt, Next.js, SvelteKit, Remix, Astro with the Node adapter, or a Node server) gets [`init: true`](/docs/reference/deploy-yaml#init) as a live setting, in place of the commented example:

```yaml
# Node as a container's first process ignores SIGTERM unless the application
# handles it, and is killed when its grace period ends. An init process in
# front of it passes the signal on: a replaced replica stops at once.
init: true
```

Where a `Dockerfile` already exists and is kept, the line stays commented out: that image may bring an init process of its own. Since 0.8 the file carries the [`security`](/docs/reference/deploy-yaml#security) block as a commented example, for every kind of project with a container; uncommented as it stands, it is a block the agent accepts, given a numeric `user`. A static site's file is three lines: `name`, `static` and `domain`, with a comment naming the build command to run first; with a fallback page, `static` is written as `static: {dir: dist/, fallback: index.html}`.

`init` refuses to overwrite an existing `deploy.yaml` without `--force`. It does not contact the agent. `shipwick deploy` in a directory with neither a `deploy.yaml` nor a `shipwick.yaml` runs `init` first when a terminal is attached (`No deploy.yaml here. Let's write one.`), then deploys: `Deploying now. Change them later and deploy again.`

### init next to a shipwick.yaml

Since 0.5, where there is a `shipwick.yaml` and no `deploy.yaml`, `init` adds an entry to the file's `apps` list instead of writing a `deploy.yaml` that would take its place. The entry is for the project in the current directory, or in the directory given:

```bash
shipwick init web
```

```text
✓ Recognised a Nuxt application
✓ Wrote web/Dockerfile and web/.dockerignore
✓ Added web to shipwick.yaml

Review them, then run: shipwick deploy
```

- The Dockerfile and the `.dockerignore` are written into `dir`; the entry gets `build: ./<dir>`, or `static: <dir>/dist/` for a folder the proxy serves, and the name of the directory unless `--name` gives another. It carries `port`, `domain` and a live health check where `init` knows them, `init: true` for a Node project whose Dockerfile was written, and no commented-out examples.
- The entry is appended as text at the end of the `apps` list, indented like the entry before it. Nothing else in the file changes: its comments, its order and its line endings stay.
- Where the entry cannot be placed with certainty, because `apps` is not the last key of the file or the list is not written one entry per dash, the file is left alone, the entry is printed to add by hand, and the command exits with `1`: `✗ Left shipwick.yaml as it is: apps is not its last key, so the end of the file is not the end of the list`.
- A name the file already has is refused: `shipwick.yaml already has an application named web`, with `shipwick init --name <name>` as the way to add it under another.
- `dir` must be a directory under the current one, since `build` and `static` paths may not leave it. It cannot be combined with `--image` or `--static`, and without a `shipwick.yaml` it is an error that says to run `shipwick init` inside the directory instead.

## validate

Check `deploy.yaml` without deploying. The file is read, its `${NAME}` placeholders are filled in from the environment and `--env-file`, and it is validated exactly as the agent would validate it. Runs offline, and prints the configuration as it will be applied, defaults included. A `shipwick.yaml` is checked entry by entry, and the order the applications deploy in is printed.

```text
shipwick validate [name...] [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml`, else `shipwick.yaml` | Path to a deployment config; repeat for several applications |
| `--env-file <path>` | | `NAME=value` file for `${NAME}` placeholders; repeat for several. Optional: `env` values may also come from the server's secrets |

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

The first line is `<file> is valid`, with `(N variables substituted)` when placeholders were filled in; the `env` names left to the server's secrets are listed after the summary. Environment values are not printed, only their count. `Name`, `Image`, `Version`, `Replicas`, `Resources` and `Restart` always appear; `Resources` reads `unlimited CPU, unlimited memory` without limits. With `build:`, a `Build` line (`./ (Dockerfile)`) replaces `Image` and `Version`, and a note says that `validate` does not run the build. For a static application the second line is `Folder` (`dist/ — served by the proxy, no container`), followed by `Fallback` (`index.html for paths that name no file`) when `static.fallback` is set, and `Replicas`, `Resources` and `Restart` are left out. The other lines appear when the file sets them, in this order:

| Line | Example | |
|---|---|---|
| `Port` | `8080` | |
| `Domain` | `example.com` | |
| `Path` | `/api` | The [`path`](/docs/reference/deploy-yaml#path) of the domain the application serves |
| `Aliases` | `api.example.com, app.example.com` | The `aliases` list, comma-separated |
| `Redirects` | `www.example.com → https://example.com` | The `redirects` list, then the target every one of them redirects to |
| `Proxy` | `strips /api; 2 response headers; a password for /admin; 1 redirect` | What the [`proxy`](/docs/reference/deploy-yaml#proxy) block asks for, never its values: `a password for everything` when basic authentication covers the whole application |
| `Health check` | `GET /health every 10s (timeout 3s, 3 retries)` | `GET <path>` for an HTTP check, `TCP :5432` for `health.tcp`, `command pg_isready -U postgres` for `health.command`; `, after a 1m start period` when `start_period` is set |
| `Volume` | `data at /var/lib/postgresql/data` | One line per volume |
| `Publish` | `5432/tcp → server port 15432 on 10.0.0.5` | One line per published port; `on <address>` only when `address` is set |
| `Strategy` | `recreate` | Omitted for the default, `rolling` |
| `Environment` | `2 variables` | |
| `Entrypoint` | `/app/entrypoint.sh` | The arguments, space-separated; an argument containing spaces or quotes is quoted |
| `Command` | `node worker.js` | Same form |
| `User` | `1000:1000` | |
| `Security` | `read-only root filesystem; tmpfs at /tmp (64 MB), /var/cache/api (200 MB); no capabilities; refuses to run as root` | What the [`security`](/docs/reference/deploy-yaml#security) block takes away, the parts that are set separated by `; `: `read_only`, each `tmpfs` directory with its size, `capabilities` (`no capabilities` for `none`, `capabilities CHOWN, SETUID only` for a list), `non_root`. `user: root`, or a user given by name, next to `non_root: true` is a validation error. Since 0.8 |
| `Logging` | `gelf (2 options)` | The driver, and the number of options when there are any: `(1 option)`, `(2 options)` |
| `Pre-deploy` | `dotnet Migrate.dll` | The `pre_deploy` command |
| `Job` | `nightly-report at 0 3 * * * UTC: node report.js` | One line per job: its name, schedule and command |
| `Backups` | `daily at 03:00 UTC, 7 kept, after pg_dump -f /data/dump.sql, with the application stopped` | The [`backups`](/docs/reference/deploy-yaml#backups) block: the schedule (`daily at …`, `hourly at :15`, or `on <expression> (UTC)`), how many are kept, the `before` command and `stop: true` when they are set. Since 0.6, a `before_timeout` other than the default follows the command: `after pg_dump -f /data/dump.sql (2h at most)` |

With several files, each is validated and described in turn. An invalid file, or an unset placeholder, prints the report and exits with `1`. See [Placeholders](#placeholders).

Since 0.8, names choose among the applications of a `shipwick.yaml`, as they do for [`deploy`](#some-applications-of-a-shipwick-yaml). The whole file is still checked; the order and the summaries shown are those of the named applications, and a line says what a deployment of them would leave out:

```text
$ shipwick validate api
✓ shipwick.yaml is valid

shipwick deploy api leaves out postgres and assumes it running.
```

The summary of `api` follows. With several left out the line ends `and assumes them running.` A name the file does not have, and a name next to a `deploy.yaml`, are the errors `deploy` gives.

## deploy

Deploy the application described by `deploy.yaml` and wait for the result. With `build:` in the file, build the image here and send it to the server first; with `static:`, upload the folder first. A `shipwick.yaml` deploys several applications at the same time, all of them or, since 0.8, the ones named; several `-f` deploy several `deploy.yaml` in order.

```text
shipwick deploy [name...] [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml`, else `shipwick.yaml` | Path to a deployment config; repeat for several applications |
| `--env-file <path>` | | `NAME=value` file for `${NAME}` placeholders; repeat for several. Optional: `env` values may also come from the server's secrets |
| `--image <ref>` | | Deploy this image instead of the one in the configuration. One application only: a `deploy.yaml`, or exactly one named application of a `shipwick.yaml`. Not with `build:` |
| `--parallel <n>` | `4` | How many applications of a `shipwick.yaml` deploy at the same time |
| `--no-wait` | | Start the deployment and return immediately |
| `--verbose` | | Show everything `docker build` prints, instead of one progress line |

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

- The file is read, its `${NAME}` placeholders are filled in from the environment and `--env-file`, and it is validated locally before anything is sent. The agent validates it again, and fills in the `env` values that were left to it from the server's secrets. See [Placeholders](#placeholders).
- **The agent is asked before anything is built or uploaded.** Since 0.5, with `build:` or `static:`, `deploy` has the agent validate the file first, so that what only the server knows (a hostname another application serves, a port already published, a secret that is not stored) stops the command before the build and the upload, with the message a refused deployment has. An older agent is asked about the domain only: `api.example.com is already served by application "web"; nothing was built`, or `nothing was uploaded`. The agent checks again when the deployment starts.
- **With `build:`**, `docker build` runs on this machine, as an argv, in the directory of the `deploy.yaml`, for the architecture the agent reports (`--platform`). The image is tagged `shipwick.local/<app>:<UTC stamp>-<4 hex>`, saved through the Docker API and streamed to the agent, which loads it; the deployment then names that image. Then come `✓ Built shipwick.local/my-api:20260927-153000-a1b2 for linux/amd64` and `✓ Sent image to the server (267 MB)`. `docker` must be installed here; the server never builds. Without it: `docker is not installed on this machine, and build: needs it here (the server never builds); install Docker Desktop or set image: instead`.
- **The build is one progress line in a terminal**: `Building the image (12s) — #9 [build 4/6] RUN npm ci`, the time it has been running and the last line `docker build` printed. Its whole output is shown, dimmed under the `docker build` command line, only when it fails. `--verbose` shows every line as it is printed, and so does any run whose output is not a terminal, such as a pipeline's log. Several applications of a `shipwick.yaml` building at once in a terminal are silent until each build ends.
- **Only the layers the server does not have are sent.** The first deployment sends the whole image. After that `deploy` asks the agent which of the image's layers the server lacks and leaves the others out of the archive, so a change to the application costs its own layer: `✓ Sent image to the server (22 KB; the server had the rest of 57.9 MB)`. With an agent older than 0.5, or whenever the reduced archive cannot be built or is refused, the whole image is sent as before.
- **With `static:`**, the folder is sent as it is, up to 512 MB, as a tar archive with fixed metadata, so the same files make the same digest and the same version everywhere: `✓ Uploaded dist/: 42 files, 3.1 MB`. Run the build first; a folder without an `index.html` is refused before anything is sent. A symbolic link that leads out of the folder is skipped, with a warning. `deploy.yaml`, `shipwick.yaml`, `.git` and `.env` files are never sent: everything in the archive is served. The progress line then reads `Checking the uploaded files`, `Copying the files to the proxy`, `Looking for index.html`, `Switching over`.
- **`deploy` waits for `completed_at`**, not for the first `ACTIVE`. When it returns, the next operation on the application is guaranteed not to be rejected as busy.
- `--image` edits the YAML document in memory. The agent still receives one plain `deploy.yaml`, and the file on disk is untouched. This is the form for CI: keep `deploy.yaml` in the repository and pass the image that was just built. It is refused for an application with `build:`. Since 0.8 it also applies to one named application of a `shipwick.yaml`; see [Some applications of a shipwick.yaml](#some-applications-of-a-shipwick-yaml).
- The last line is the application's address, with its `path` when it has one: `https://example.com/api`.
- A first deployment ends with the two commands to run next, `shipwick logs -f <app>` and `shipwick status <app>`, and with the dashboard's address when the server has one:

  ```text
  Next:
    shipwick logs -f my-api          follow the logs
    shipwick status my-api           replicas, health, history
    https://dashboard.example.com    the dashboard
  ```
- **Ctrl+C stops the waiting, not the deployment.** The deployment continues on the server; follow it with `shipwick status`.
- With `--no-wait`, the command prints `Deployment #N started` and exits with `0` without knowing the outcome.
- In a terminal, a transient progress line shows what the agent is busy with: pulling the image, starting containers, checking health, switching over, retiring the previous version.
- With a `pre_deploy` command, two more lines follow the pull: `✓ Running pre-deploy command` and `✓ Pre-deploy command finished (12s)`. If the command fails, the deployment fails before any replica of the new version was started, and its last output lines are printed under the error.
- **The agent is told which `env` values stood in the file in plain sight** (since 0.8). `deploy` knows which values it filled in from the environment or `--env-file` and which it found written, and names the written ones with the deployment (`?plain=`). The agent keeps that, and [`config`](#config) gives those values back as they are; a value with anything filled in here is never among them. A static application has none. An agent older than 0.8 ignores the statement.
- **Limits that Docker does not enforce are said** (since 0.8). On a server whose Docker daemon accepts `resources` and applies nothing, as rootless Docker does without the cgroup controllers, a deployment that asks for a limit gets a warning among its steps: `! Docker on this server does not enforce resources.memory and resources.cpu: the replicas run without a limit. shipwick doctor says what the server lacks`. It names the limits the file sets and the daemon does not apply. See [Limits that are not enforced](/docs/concepts/resources#limits-that-are-not-enforced).

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

**A server older than the file** (since 0.8). An agent refuses a key it does not know, so an agent older than 0.8 refuses a `deploy.yaml` with [`security`](/docs/reference/deploy-yaml#security), and the application is never deployed without what the key asks for. `unknown field` alone reads like a typo; where this `shipwick` accepted the file and the agent did not know a key, the report is followed by what that means:

```text
invalid deploy.yaml

line 5:
  unknown field "security"

The agent is version v0.7.0 and does not know "security", which this shipwick (v0.8.0) does: the server is older than deploy.yaml.
Nothing was deployed. Upgrade the server, then deploy again:
  curl -fsSL https://get.shipwick.com | sh (on the server)
```

When the agent's version cannot be asked for, the sentence begins `The agent does not know "security"`. See [Upgrade Shipwick](/docs/tasks/upgrade).

### Several applications

A `shipwick.yaml` holds an `apps` list in which every entry is a complete `deploy.yaml`, and `after: [postgres]` names the entries one must wait for; see [Several applications](/docs/reference/deploy-yaml#several-applications-shipwick-yaml). `deploy` uses it when there is no `deploy.yaml` in the directory, or when `-f` names it; it cannot be combined with other `-f` files.

```bash
shipwick deploy                    # shipwick.yaml
shipwick deploy --parallel 2
```

- The file is validated as a whole before anything starts. The command then prints `Deploying 3 applications...` and runs the applications whose dependencies are done at the same time, up to `--parallel` at once, four by default.
- Every line of output carries the name of the application it belongs to.
- An application starts when every name in its `after` has completed a successful deployment in this run. One that waits for an application that failed, or was itself skipped, is skipped: `Skipped api: postgres did not deploy`. The others finish.
- The last line is `3 of 3 applications deployed.`, or the count with what happened to the rest: `Stopped: 1 of 3 applications deployed, 1 failed, 1 skipped.` The command exits with `1` if any failed or was skipped. With `--no-wait` it reads `3 of 3 applications started.`
- `--image` without a name does not apply: `--image applies to one application, and shipwick.yaml describes several`, then `Name the one it is for: shipwick deploy <name> --image <ref>` with the image that was given.

`-f` repeated deploys several `deploy.yaml` files, in the order given, one after the other:

```bash
shipwick deploy -f api/deploy.yaml -f worker/deploy.yaml
```

- Every file is read and validated before the first deployment starts, so that a mistake in the third does not leave the first two half done.
- Each application is deployed and waited for like a single one, with its own `Deploying <name>...` block.
- The command stops at the first failure: what comes later usually depends on what came before. It then prints `Stopped at worker: 1 of 3 applications deployed.` and exits with `1`. The applications already deployed stay deployed.
- When every deployment succeeds, the last line is `3 of 3 applications deployed.`
- `--image` applies to one application. With several files it is refused: `--image applies to one application; deploy several with one deploy.yaml each and no --image`.

### Some applications of a shipwick.yaml

Since 0.8, names deploy those applications of the file and nothing else: what a pipeline wants after it built one image, and what keeps a change to one application from redeploying the database next to it.

```bash
shipwick deploy api web
shipwick deploy api --image ghcr.io/company/api:$GIT_SHA
```

```text
$ shipwick deploy api --image ghcr.io/company/api:2.3.1
Deploying api...

✓ Validated shipwick.yaml
Not deployed now and assumed to be running: postgres
```

- The whole file is read and validated either way, so a name is checked against everything the file describes.
- `after` still orders the named ones among themselves. An `after` that names an application left out is not waited for: that application is assumed to be running, and one line after the validation names every such application. Nothing checks that it runs.
- One name is deployed and reported like a single `deploy.yaml`; several are deployed like the whole file, with `Deploying 2 applications...`, `--parallel` and the last line counting the named ones.
- `--image` applies when exactly one application is named. With more: `--image applies to one application, and 2 are named`, then `Name the one it is for: shipwick deploy <name> --image <ref>`. For an application with `build:` it is refused: `api has build: and is built here, so --image does not apply; remove build: to deploy an image instead`.
- A name the file does not have is an error that lists the ones it has, and nothing is deployed:

  ```text
  Error: shipwick.yaml has no application named worker

  It describes: postgres, api, web
  ```
- A name next to a `deploy.yaml` is an error that says why:

  ```text
  Error: deploy.yaml describes one application and takes no name: a name chooses among the applications of a shipwick.yaml

  Leave the name out: shipwick deploy
  ```

  With `-f` the sentence names the file (`api/deploy.yaml describes one application and takes no name: …`, then `Leave the name out: shipwick deploy -f api/deploy.yaml`), or, with several, `the files given with -f describe one application each and take no name: …`. In a directory with neither file: `a name chooses among the applications of a shipwick.yaml, and there is none here`, then `Run it where the file is, or name the file with -f`.

[`validate`](#validate) takes the same names and gives the same errors, with `shipwick validate` in place of `shipwick deploy`.

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

The result is an ordinary deployment, followed and reported like `deploy`. The application must have an active deployment. An application with `build:` keeps the image it has; `--image` with an image from elsewhere is refused for it. A static application re-uses the folder the proxy already serves.

## config

Print the `deploy.yaml` that describes what an application runs: the way to get the file back when it was lost, or was never on this machine. Since 0.7; since 0.8 the values that were written in the file come back with it.

```text
shipwick config <app> [flags]
```

| Flag | |
|---|---|
| `-o`, `--output <file>` | Write the file here instead of printing it |
| `--force` | Overwrite an existing file |

```text
$ shipwick config my-api -o deploy.yaml
✓ Wrote deploy.yaml: my-api as deployment #7 (1.4.2) runs it
! 1 value is not handed out and stands as "********" in the file: env.API_KEY
  Write it again, or store it with shipwick secret set NAME and refer to it as ${NAME}.
  Until then shipwick deploy refuses the file.
```

- **The application is named**, always: the command does not read the name from a `deploy.yaml`, since it is the command for when there is none.
- **The file** is in the layout [`init`](#init) writes and describes the active deployment. Without `-o` it is printed to standard output, and nothing else is.
- **The server does not hand out secret values.** A value that was written as a reference to a secret stored on the server is that reference again, such as `postgres://app:${DB_PASSWORD}@db:5432/app`, and is filled in again when the file is deployed.
- **A value that stood in the deployed file as it was sent comes back as it is** (since 0.8): `LOG_LEVEL: debug` is `LOG_LEVEL: debug` again. The agent cannot tell such a value from a password; [`deploy`](#deploy) can, and says with the deployment which `env` values it found written. A redeploy and a rollback carry that on. What is written in `deploy.yaml` in plain sight is therefore readable by whoever may deploy the application: a password belongs in `${NAME}`, not in the file.
- **Everything else is masked**, shown as `"********"` with a comment on its line: an `env` value that `deploy` filled in from the environment or `--env-file`, even in part; a basic-auth password that was written out; a value typed in the dashboard's editor; and every value of an application that was last deployed by a `shipwick` or an agent older than 0.8, until it is deployed again with both at 0.8 or later. Nobody but the sender of a file can say that a value in it is plain, so a value nobody spoke for is masked.
- **The masked fields are listed** on standard error, by their names in the file: `env.API_KEY`, `proxy.basic_auth[0].password`. With several the sentence is in the plural: `2 values are not handed out and stand as "********" in the file: …`, then `Write them again, or store each with shipwick secret set NAME and refer to it as ${NAME}.`
- **A file that still has a mask is refused** by [`deploy`](#deploy) and [`validate`](#validate), with the fields that need a value: `"********"` is never accepted as an `env` value or a basic-auth password.
- **An application deployed before 0.7** has its references to stored secrets masked too, until it is deployed again from its file: the references were not kept then.
- **`-o` does not write over a file that exists**: `deploy.yaml already exists`, then `Overwrite it with: shipwick config my-api -o deploy.yaml --force`. The check is made before the agent is asked.
- An agent older than 0.7: `the agent is older than this shipwick and does not write an application's deploy.yaml`, then `Compare versions with: shipwick server status`.

Needs a token that may deploy the application: the `deploy` role, and for a token limited to applications, one of them. See [Get deploy.yaml back from the server](/docs/tasks/get-the-configuration-back).

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

A rollback is an ordinary deployment of the configuration that was stored with the earlier deployment: image, environment, replicas, everything. It is rolled out replica by replica, health-checked, and recorded as a new entry in the history. Nothing is rewritten. A static application is rolled back to the kept folder of that version, with no upload; an application with `build:` needs the image of that version to still be on the server, which it is for the version before the one running.

`shipwick` resolves the target itself from the application's history (the newest 500 deployments), so that what it announces is exactly what it requests. Only deployments with the status `SUPERSEDED` qualify:

| Situation | Message |
|---|---|
| `--to` names the active deployment | `deployment #4 is the one running right now` |
| `--to` names a deployment that never succeeded | `deployment #2 never ran successfully (FAILED), so there is nothing to go back to` |
| `--to` names a number that does not exist | `there is no deployment #9`, then `See the history with: shipwick status` |
| No earlier successful deployment | `there is no earlier successful deployment to go back to` |

See [Rollback](/docs/concepts/rollback) and [Roll back and redeploy](/docs/tasks/roll-back).

## status

Show the state of an application: its version, resource usage, replicas, backups, certificates, recent deployments and recent events.

```text
shipwick status [app] [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted |
| `-v`, `--verbose` | | Also list the certificates that are in order |

```text
my-api  ● HEALTHY

Replicas   2/2 healthy
CPU        42% / 400%
Memory     412 MB / 2 GB
```

The output has up to five parts:

1. **Summary.** Status, with `(deployment in progress)` while one is in flight. Then `Version` (with the deployment number and when it was deployed), `Image`, `URL` if there is a domain (with the application's `path`: `https://example.com/api`), `Replicas`, `CPU` and `Memory` if anything is running, `Health` if a health check is configured, `Limits`, and `Backups` for an application with volumes. CPU is in percent of one core; with a limit it is shown as `used / limit`. Since 0.8, `Limits` says when the server's Docker does not enforce them; see below. For a static application a `Files` line (`42 files, 3.1 MB, served by the proxy`) replaces the image, replicas and usage, and there are no containers to list.
2. **Certificates.** One line per hostname whose certificate is not in order, and why; nothing when all are. See below.
3. **Containers.** Columns `REPLICA`, `CONTAINER`, `STATE`, `HEALTH`, `RESTARTS`, `STARTED`. `STATE` is `running`, `exited (<code>)`, `out of memory`, or another Docker state. `HEALTH` is `healthy`, `unhealthy`, `starting`, `checking` (not probed yet), or `-` without a health check. `RESTARTS` shows `N (crash loop)` while restarts are rate-limited. Since 0.6, a container that a deployment replaced and that is still on its way out is listed below the replicas with the state `stopping`; see below.
4. **Deployments.** The 5 most recent, with columns `DEPLOY` (the `#number`), `VERSION`, `STATUS`, `VIA` (`deploy`, `redeploy`, `rollback`, or `import` and `standby` for a deployment made by [`import`](#import)), `WHEN`, and the error of a failed deployment, truncated to 90 characters.
5. **Events.** The 8 most recent application events: what the supervisor has been doing, stops and starts (`Application stopped by ci` when a token other than root did it), restored backups, scheduled jobs or one-off commands that failed or timed out, alerts raised and cleared, and certificates being obtained or running out.

```text
my-api  ● CRASH_LOOP

REPLICA   CONTAINER            STATE     HEALTH      RESTARTS         STARTED
1         shipwick_my-api_3_1   running   healthy     0                2h ago
2         shipwick_my-api_3_2   running   unhealthy   5 (crash loop)   34s ago

WHEN      EVENT
28s ago   Replica 2 did not become healthy within 30s of starting: HTTP 503
34s ago   Replica 2 is crash-looping: 5 restarts without staying up. Retrying every 5m
```

**A container on its way out** (since 0.6). After a deployment has replaced a replica, the old container is out of rotation and gets its grace period ([`deploy.stop_timeout`](/docs/reference/deploy-yaml#deploy)) to exit. Until it is gone it is listed after the replicas, by its name and the state `stopping`; it has no replica number, health or restart count of its own:

```text
REPLICA   CONTAINER             STATE      HEALTH    RESTARTS   STARTED
1         shipwick_my-api_7_1   running    healthy   0          12s ago
2         shipwick_my-api_7_2   running    healthy   0          4s ago
-         shipwick_my-api_6_2   stopping   -         -
```

**Limits that are not enforced** (since 0.8). A Docker daemon without the cgroup controllers, as rootless Docker is without delegation, accepts `resources.cpu` and `resources.memory` and applies neither. On such a server the `Limits` line says so about the limits the application has:

```text
Limits     0.5 CPU, 64 MB  (Docker on this server does not enforce the memory and CPU limits; see shipwick doctor)
```

With one of the two it reads `does not enforce the memory limit` or `the CPU limit`. The note needs the application's metrics, so it appears while a replica is running. An application without limits, and an agent older than 0.8, get no note. See [`doctor`](#doctor) and [Limits that are not enforced](/docs/concepts/resources#limits-that-are-not-enforced).

**The `Backups` line** (since 0.5) appears for an application with volumes and sums up the backups the server keeps of it; see [`backups`](#backups):

| Situation | Line |
|---|---|
| A schedule, and a backup that succeeded | `daily at 03:00 UTC, last 5h ago (2.1 GB), 7 kept` |
| A schedule, nothing taken yet | `daily at 03:00 UTC, none taken yet` |
| The last backup failed | `daily at 03:00 UTC, last one failed 2h ago: ` and the error, truncated to 80 characters, then `(last good one 1d ago)` when there is one |
| No `backups` block, but backups taken by hand | The same lines, starting with `none scheduled` |
| No `backups` block and no backup | ``none  (add `backups` to deploy.yaml, or take one with: shipwick backups run my-db)`` |

The schedule reads `daily at 03:00 UTC` or `hourly at :15` for those shapes, and `on <expression> (UTC)` for any other.

**Certificates** (since 0.5). A hostname whose certificate is still being obtained, is waiting for DNS, or has 14 days or less to go gets a line that says so, in the agent's words:

```text
HOSTNAME            CERTIFICATE
www.example.com     waiting for DNS: does not resolve yet; add an A record: www.example.com → 62.238.109.115 (DNS only, not proxied)
new.example.com     being obtained: the proxy has no certificate for it yet; HTTPS connections to it fail until it does
old.example.com     expires in 9 days, on 2026-03-10 (Let's Encrypt E7)
```

With `--verbose`, the hostnames whose certificate is in order are listed too: `valid until 2026-06-01 (Let's Encrypt E7)`, the certificate's last day and its issuer. See [Certificates](/docs/tasks/certificates).

**The command that says why** (since 0.7). A replica that died, or a deployment that failed, took its output with it; where the agent kept it, the output ends with the command that shows it:

```text
Replica 1's last output before it exited with code 3, just now:   shipwick logs my-api --id 4
What deployment #13 printed before it failed:                     shipwick logs my-api --deployment 13
```

A replica gets a line when it restarted, crash-loops, was killed for memory or exited with a code other than 0, and the archive holds a run of its container that crashed, ran out of memory or was restarted for its health check: `before it exited with code 3`, `before it ran out of memory`, `before it was restarted for its health check`. The second line appears when the most recent failed or rolled-back deployment in the history has kept output. An agent without an archive, or with nothing kept, adds nothing. See [`logs`](#logs).

See [See what is running](/docs/tasks/inspect-and-logs).

## ps

List the applications on the server.

```text
shipwick ps
```

Columns: `NAME`, `STATUS`, `VERSION`, `REPLICAS` (healthy/desired; `static` for a folder the proxy serves), `DOMAIN` (with the application's `path` when it has one: `example.com/api`), `UPDATED`. `(deploying)` is appended to the status while a deployment is in flight. With no applications, the command prints `No applications yet. Deploy one with: shipwick deploy`.

Since 0.6, an application with a hostname whose certificate is not in order, or with active alerts, says so in a few words at the end of its line:

```text
$ shipwick ps
NAME     STATUS    VERSION   REPLICAS   DOMAIN             UPDATED
my-api   HEALTHY   1.4.2     2/2        api.example.com    5m ago    certificate waiting for DNS, 2 alerts
blog     HEALTHY   2.0.1     1/1        blog.example.com   3d ago
```

The certificate is `waiting for DNS`, `being obtained` or `expiring`; the alerts are counted (`1 alert`, `2 alerts`). The words are yellow, and red when one of the alerts is critical. [`shipwick status <app>`](#status) has the details. An agent older than 0.6 reports neither, and the lines end after `UPDATED`.

## logs

Show the logs of an application, merged across its replicas, and since 0.7 the output the agent kept of containers that ended.

```text
shipwick logs [app] [flags]
```

| Flag | Default | |
|---|---|---|
| `-n`, `--tail <n>` | `100` | Number of lines to show from the end of the logs. 1 to 5000; `0` is allowed with `--follow` |
| `-f`, `--follow` | | Keep streaming new log lines |
| `-t`, `--timestamps` | | Prefix each line with its timestamp, in local time |
| `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted. Long form only: here `-f` means `--follow`, as in `docker` and `kubectl` |
| `-p`, `--previous` | | Show the output of the last container that ended: the one that crashed, or was replaced. Since 0.7 |
| `--list` | | List what is kept of ended containers and runs. Since 0.7 |
| `--id <n>` | | Show one entry of `--list`. Since 0.7 |
| `--run <id>` | | Show the output of this run of a job or a command. Since 0.7 |
| `--search <text>` | | Show the lines that contain this text, whatever its case, kept or current. Since 0.7 |
| `--since <when>` | | Only lines from then on, kept or current: `30m`, `2h`, `7d`, a date or a time in RFC 3339. Since 0.7 |
| `--until <when>` | | Only lines up to then; takes what `--since` takes. Since 0.7 |
| `--deployment <#>` | | Only the output of this deployment, by its `#number` in `shipwick status`, kept or current. Since 0.7 |
| `--replica <n>` | | Only the output of this replica. Since 0.7 |

- Logs come from the replicas of the active deployment.
- When the application has more than one replica, each line is prefixed with the replica number: `[1]`, `[2]`.
- Without `--follow`, `--tail` is the merged total: the last N lines across all replicas. With `--follow` it applies per replica: each replica's stream starts with its own last N lines. `--tail 0` with `--follow` shows only what is logged from now on.
- **`logs -f` says that it is following.** In a terminal, when no line has arrived after two seconds, it prints once, on standard error: `Following my-api; nothing printed yet. Ctrl-C stops.` An application that has printed nothing is then not taken for a hang.
- **`logs -f` ends by itself** when the containers are stopped or replaced by a new deployment, with a warning saying so. Run it again to follow the new ones. Ctrl+C is the normal way out and prints nothing.
- With a `logging` driver in `deploy.yaml`, the lines come from the local copy Docker keeps next to the remote driver.
- A static application has no containers and no logs; the command says so (see [Error messages](#error-messages), `STATIC_APPLICATION`). The same goes for `run`, `jobs` and the metrics in `status`.

### The log archive

Since 0.7 the agent keeps the last output of every container whose run ends: a replica that crashed, was killed for memory, was restarted for its health check, stopped or replaced by a deployment, the replicas of a deployment that failed, and the runs of jobs, pre-deploy commands and `shipwick run`. With any of the flags from `--previous` down, the command reads that archive instead of the tail of the running containers. What is kept, for how long and where is in [Find out why it died](/docs/tasks/find-out-why-it-died).

**`--previous`** shows the last run of a replica that ended, whatever ended it. `--deployment` and `--replica` narrow it.

```text
$ shipwick logs my-api -p
#12 replica 1 (1.4.2), shipwick_my-api_12_1: crashed (exit 3) just now; 3 lines
starting up
connecting to the database
FATAL: could not connect to db:5432
```

The first line says what the entry is the output of — the deployment's number, the replica, the version — the container, why it ended and when, and how many lines are kept: `3 lines`, `its last 2000 lines` when the run printed more than is kept, `it printed nothing` for a replica that died silently, and `, the last 50 shown` when `-n` cut it. Of one entry everything kept is shown unless `-n` is given. With nothing kept: `Nothing is kept of an earlier container of my-api: none has ended since the agent began to keep their output, or what was kept has aged out.`

**`--list`** lists the entries, newest first; `-n` says how many, 100 unless given and at most 500. `--deployment`, `--replica` and `--run` narrow it.

```text
$ shipwick logs my-api --list
ID   ENDED      OUTPUT OF       ENDED BECAUSE      LINES   SIZE
4    just now   #12 replica 1   crashed (exit 3)   3       72 B
3    20s ago    #12 replica 1   crashed (exit 3)   3       72 B
2    31s ago    #12 replica 1   crashed (exit 3)   3       72 B

Read one with: shipwick logs my-api --id <ID>
```

| Column | |
|---|---|
| `OUTPUT OF` | `#12 replica 1`, the deployment's number and the replica; `replica 1` once the deployment is gone; `run 14 of nightly-report` for a run |
| `ENDED BECAUSE` | `crashed (exit 3)`, `exited (exit 0)`, `out of memory`, `restarted: unhealthy`, `stopped`, `replaced`, `deployment failed` (with `(exit 1)` or `: out of memory` when the replica had died by itself), `removed`, `ended unseen` when the run ended while no agent was running. For a run, what [`jobs`](#jobs) shows: `succeeded`, `failed (exit 1)`, `timed out`, `interrupted by an agent restart` |
| `LINES` | The lines kept; `last 2000` when the run printed more |
| `SIZE` | The size of their text |

With nothing kept: `Nothing is kept for my-api. Output is archived when a container ends: a crash, a restart, a new deployment, a finished job.`

**`--id <n>`** shows one entry, as `--previous` does. It takes no other filter: `--id shows one entry; it takes no other filter`. An id that does not exist: `my-api has no archived output with id 9: it may have aged out`, then `See what is kept with: shipwick logs my-api --list`.

**`--run <id>`** shows the output of a run of a job, a pre-deploy command or a one-off command, by the run's id: what the archive kept of it, or, from an agent that keeps no archive or for a run that is still going, the tail in the run's own record, as [`jobs logs`](#jobs-logs) prints it. A run that does not exist: `my-api has no run 9: the history keeps the last 50 runs of each job`, then `See its jobs with: shipwick jobs my-api`.

**`--search`, `--since`, `--until`, `--deployment`, `--replica`** show lines of the kept output and of the running containers together: the newest `-n` that match, oldest first, under a line for each container they come from.

```text
$ shipwick logs my-api --search fatal
== #12 replica 1, shipwick_my-api_12_1, kept as 2 ==
2026-10-04 03:22:04.062 FATAL: could not connect to db:5432
== #12 replica 1, shipwick_my-api_12_1, kept as 3 ==
2026-10-04 03:22:15.126 FATAL: could not connect to db:5432
```

- The text is looked for inside lines, whatever its case; it is not a pattern. At most 256 bytes, one line.
- `kept as 2` names the archive's entry; a source line without it is a container that exists. A run's lines stand under `run 14 of nightly-report, <container>`.
- A search shows each line's time unless `--timestamps=false` says not to; the other filters show it with `-t`.
- `--since` and `--until` take how long ago (`30m`, `2h`, `7d`), a date (`2026-09-01`, from its start in UTC), or a time in RFC 3339.
- Each filter works without `--search`: `--since 2h` is everything the application printed in the last two hours, `--deployment 13` everything deployment #13 printed. A number that is not in the history: `my-api has no deployment #9`, then `See its history with: shipwick status my-api`.
- When older lines match than the ones shown, a note says so: `These are the newest 100 lines that match; there are older ones. Show more with -n, or go back with --until` and the time of the oldest line shown.
- Nothing found: `No lines match, in what is kept or in the running containers.`
- Of a container that exists its last 50,000 lines are looked at. The output of a job that is still running is found once the run has ended.

Which flags go together:

| Combination | The command says |
|---|---|
| `--follow` with any of them | `--follow streams the running containers; it does not go with --previous, --list, --id, --deployment, --replica, --run, --search, --since or --until` |
| `--list` with `--previous`, `--search`, `--since` or `--until` | `--list lists entries; narrow it with --deployment, --replica or --run` |
| `--previous` with `--search`, `--since`, `--until` or `--run` | `--previous shows the last ended container; narrow it with --deployment or --replica, or search with --search alone` |
| `--until` before `--since` | `--until is before --since` |

An agent older than 0.7: `the agent is older than this shipwick and keeps no log archive: it shows the output of running containers only`, then `Compare versions with: shipwick server status`. Needs the `read` role, like the logs.

## traffic

Show what the proxy saw: how many requests each application got, how many failed, how long they took and how much was sent. Since 0.5.

```text
shipwick traffic [app] [flags]
```

| Flag | Default | |
|---|---|---|
| `--since <window>` | `1h` | How far back to look: `1h`, `24h` or `7d` |
| `--requests` | | List the most recent requests instead of the totals. Needs an application |
| `-f`, `--follow` | | With `--requests`: keep printing new requests |
| `-n`, `--tail <n>` | `50` | With `--requests`: how many to show, 1 to 200 |

Without an application, every application is listed, one row each:

```text
$ shipwick traffic
Requests through the proxy over the last hour
APP      REQ/MIN   5XX          P95     BYTES
my-api   208       20 (0.2%)    48ms    118 MB
web      12.4      0            2.1ms   3.2 MB
```

`REQ/MIN` is the window's requests per minute, `5XX` the responses with a 5xx status and their share of all requests, `P95` the 95th percentile of the durations (`-` when there was no request), `BYTES` what was sent.

With an application, the command prints its totals for the window, then the slowest and the failing paths among the requests the agent still remembers:

```text
$ shipwick traffic my-api --since 24h
my-api  requests through the proxy over the last 24 hours

Requests   299520  (208/min)
Status     298100 2xx · 240 3xx · 580 4xx · 600 5xx (0.2%)
Latency    p50 12ms · p95 48ms · p99 210ms
Sent       118 MB

Slowest paths among the last 200 requests
PATH            REQUESTS   SLOWEST
/checkout       14         1.2s
/api/users      92         48ms

Failing paths among the last 200 requests
PATH            5XX   LAST STATUS
/checkout       3     502
```

Up to five paths are shown in each table; the second is left out when no recent request failed. A window without requests prints `No requests over the last 24 hours.`

`--requests` lists the most recent requests, one per line: the time (local), the status, the method and the path, the duration, the bytes sent and the client's address. `-f` asks the agent again every two seconds and prints the new ones until Ctrl+C:

```text
$ shipwick traffic my-api --requests -f
15:04:05  200  GET /api/users  12ms  2 KB  203.0.113.7
15:04:06  502  POST /checkout  1.2s  45 B  203.0.113.9
```

- Counts are kept per minute for seven days. The requests themselves, the last 200 of each application, are kept in the agent's memory only: after an agent restart, `--requests` prints `No requests yet since the agent started.`
- Neither holds a query string or a header: a path is all that is kept of a URL.
- A static application has traffic like any other; redirects and the `503` of a stopped application count for the application whose hostname was asked.
- `-f` without `--requests`, and `--requests` without an application, are errors that show the full command.
- On a server whose agent has no Caddy access log to read, the agent answers `TRAFFIC_UNAVAILABLE`; see [Error messages](#error-messages).

Needs a token with the `read` role. See [what the proxy saw](/docs/tasks/traffic).

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

Deletion cannot be undone. The history goes with the application, and with it every stored configuration that a rollback could have used. Volumes are kept; [`shipwick volumes`](#volumes) lists them and removes them when you mean it. Needs a token with the `admin` role.

## backup

Download the volumes of an application as they are right now, one tar archive each, to this machine. The server keeps nothing. The backups the server takes and keeps itself, on a schedule or by hand, are the other kind: [`backups`](#backups).

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

Replace everything in a volume with the contents of a tar archive on this machine, as written by `shipwick backup` or [`shipwick backups download`](#backups-download). To put back a backup the server keeps, without downloading it, use [`backups restore`](#backups-restore).

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

## backups

List the backups the server took of an application's volumes: on the schedule under [`backups`](/docs/reference/deploy-yaml#backups) in `deploy.yaml`, or by hand with `backups run`. Since 0.5.

```text
shipwick backups [app] [flags]
shipwick backups run <app>
shipwick backups verify <app> [id]
shipwick backups restore <app> <id> [flags]
shipwick backups download <app> <id> [flags]
shipwick backups rm <app> <id>
shipwick backups decrypt <file> [flags]
shipwick backups adopt [app]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted |

```text
$ shipwick backups postgres
ID   WHEN      TRIGGER    SIZE      WHERE                   STATUS      VERIFIED
5    25s ago   schedule   39 MB     local, s3 (encrypted)   succeeded   -
4    42s ago   manual     39 MB     local, s3 (encrypted)   succeeded   -
3    1m ago    schedule   39.1 MB   local, s3 (encrypted)   succeeded   1m ago
```

These backups are kept on the server and, when the agent has a bucket, in the bucket; the agent removes the oldest beyond `backups.keep`. This is how they differ from [`backup`](#backup) and [`restore`](#restore), which move an archive between the server and your machine and leave nothing on the server.

- `TRIGGER` is `schedule` or `manual`, or, since 0.6, `adopted` for a backup that [`backups adopt`](#backups-adopt) recorded from its files. `SIZE` is the total of the backup's volume archives. `WHERE` names the places it was written to, `local` for the server's disk and `s3` for the bucket, with `(encrypted)` when the agent has a passphrase. `STATUS` is `running`, `succeeded` or `failed`, and `verifying` or `restoring` while that happens. `VERIFIED` says when a verification last passed, or `failed`.
- When a backup in the list failed, the error of the most recent failure follows the table: `Backup #6 failed: …`.
- The newest 50 are listed. With none: `The server keeps no backups of postgres. Take one with: shipwick backups run postgres`, and a line on adding `backups` to `deploy.yaml`.
- The `id` the subcommands take is the first column; `#5` is accepted too. The subcommands always want the application's name.

Listing needs the `read` role. Where backups go, the bucket and the passphrase are set on the agent; see the [agent configuration](/docs/reference/agent-configuration#backups) and [Back up and restore volumes](/docs/tasks/backups).

### backups run

Take a backup now and wait for it, the way the schedule would: `backups.before` runs first, the application is stopped for the archive when `backups.stop` says so, and the result is kept on the server and in the bucket. An application without `backups` in its `deploy.yaml` is archived as it runs.

```text
$ shipwick backups run postgres
✓ Backup #6 of postgres: 39 MB to local, s3 (encrypted)
  prove that it restores with: shipwick backups verify postgres
```

A backup that fails prints `✗ Backup #6 of postgres failed: ` with the reason and exits with `1`. Ctrl+C stops the waiting, not the backup: `Stopped waiting. The backup continues on the server; see it with: shipwick backups postgres`. Needs the `deploy` role.

### backups verify

Prove that a backup restores into a working application: the latest successful one, unless an id is given.

The agent restores the backup into scratch volumes, starts one container of the application's current image on them, and holds it to the application's health check. The container gets no route and no name other applications could find it under; it and the volumes are removed afterwards, whatever happened. The application itself keeps running and is not touched.

```text
$ shipwick backups verify postgres
✓ Backup #5 of postgres restores: a container of the current version came up on its data
```

When it does not, the last output of the container is printed, then `✗ Backup #5 of postgres did not verify: ` with the reason, and the command exits with `1`. The verdict is kept with the backup and shown in the `VERIFIED` column.

The container runs with the application's environment: an application that writes somewhere other than its volumes when it starts, such as another database or a queue, does so here too. Needs the `deploy` role.

### backups restore

Replace everything in the application's volumes with what a backup holds.

| Flag | |
|---|---|
| `-y`, `--yes` | Do not ask for confirmation |

```text
$ shipwick stop postgres
✓ Stopped postgres
$ shipwick backups restore postgres 5
This replaces the data in the volumes of postgres with backup #5. What they hold now is lost.
Type the application name to confirm: postgres
✓ Restored backup #5 into postgres
Start it with: shipwick start postgres
```

The application must be stopped, and stays stopped afterwards: look at it, then `shipwick start`. In a terminal the confirmation is the application's name; outside one, `--yes` is required. A restore that fails prints `✗ Backup #5 was not restored into postgres: ` with the reason. When the server's copy is gone and the agent has a bucket, the backup is restored from there. Needs the `admin` role.

### backups download

Download a backup's archives to this machine, one tar archive per volume.

| Flag | Default | |
|---|---|---|
| `-o`, `--output <dir>` | `.` | Directory to write the archives to |

```text
$ shipwick backups download postgres 5
✓ postgres-data-backup-5.tar (39 MB)
```

The archives are named `<app>-<volume>-backup-<id>.tar` and created with mode `0600`. They arrive decrypted, as [`shipwick restore`](#restore) takes them. An existing file is never overwritten, and a download that breaks off is deleted. A backup that did not succeed has nothing to download. Needs the `admin` role.

### backups rm

Remove a backup from the server and the bucket. Prints `✓ Removed backup #5 of postgres`. There is no confirmation. Needs the `admin` role.

### backups decrypt

Decrypt a file the agent wrote with `SHIPWICK_BACKUP_PASSPHRASE` set, taken from the server's disk or from the bucket: an application's `<volume>.tar.enc`, or `shipwick.db.enc` and `encryption.key.enc` of the agent's own state. It runs on this machine and talks to no server.

| Flag | Default | |
|---|---|---|
| `-o`, `--output <file>` | the input without `.enc` | File to write |

```bash
SHIPWICK_BACKUP_PASSPHRASE=… shipwick backups decrypt data.tar.enc
```

```text
✓ data.tar (39 MB)
```

The passphrase is read from `SHIPWICK_BACKUP_PASSPHRASE`, the value it has on the server, or asked for without echo in a terminal. The result is written next to the file, without the `.enc` ending, with mode `0600`; a file that does not end in `.enc` needs `-o`. An existing file is never overwritten, and a file that fails its check is not kept. A file that is not encrypted is refused: `data.tar is not an encrypted Shipwick backup; if it is a tar archive already, restore it with: shipwick restore`.

### backups adopt

Record the backups that the server's backup directory and its bucket hold and the agent's database does not know. Since 0.6.

```text
shipwick backups adopt [app]
```

After the agent's state was restored from a backup of it, the database knows nothing of the backups taken since, while their files are still where they were written. This command has the agent look and record them. Without an argument everything is looked at: every application's backups, the agent's own state and the exports. With one, that application's.

```text
$ shipwick backups adopt
BACKUP OF           ID   WHEN     SIZE     WHERE
postgres            13   5h ago   39 MB    s3 (encrypted)
the agent's state   14   4h ago   212 KB   s3 (encrypted)

✓ Adopted 2 backups
  an application's are listed with: shipwick backups <app>; prove that one restores with: shipwick backups verify <app> <id>
```

- `BACKUP OF` is the application, `the agent's state` or `an export`. With an application given, the last line reads `✓ Adopted 1 backup of postgres`.
- An adopted backup is listed with the trigger `adopted`, and with the time, the volumes and the sizes its files have. From then on it is a backup like any other: it can be verified, restored, downloaded and removed, and counts towards `backups.keep`.
- What the files cannot say is whether the backup was finished. A backup of the agent's state or an export that is not whole is left alone and reported: `! Backup #15 of an export was left alone: ` with the reason. An application's is adopted with the volumes that are there, so run [`backups verify`](#backups-verify) on one before you rely on it.
- Nothing is changed in the directory or the bucket, and running the command again adopts nothing twice. With nothing to record: `Nothing to adopt: the server knows every backup that its directory and bucket hold.`
- A backup of an application the server does not know is recorded too, and listed once an application of that name is deployed.
- A bucket that another installation writes to is refused: the agent answers `FOREIGN_BUCKET` and adopts nothing from it; see [Error messages](#error-messages).

Needs the `admin` role. See [Bring a lost server back](/docs/tasks/restore-the-agent-state).

## volumes

List every volume on the server, including those of deleted applications.

```text
shipwick volumes
shipwick volumes rm <name> [flags]
```

```text
$ shipwick volumes
NAME                    APPLICATION   SIZE      STATUS
shipwick_postgres_data  postgres      2.5 GB    in use
shipwick_pgtest_data    pgtest        13.0 MB   application deleted
```

Volumes are listed by their Docker name, `shipwick_<application>_<volume>`, with the application they were created for, how much they hold (`unknown` when the daemon does not report it) and whether that application still exists. With none: `No volumes: no application on this server has any.` Needs the `read` role.

### volumes rm

Remove a volume of a deleted application, with everything in it.

| Flag | |
|---|---|
| `-y`, `--yes` | Do not ask for confirmation |

In a terminal, `rm` asks first; outside one it refuses without `--yes`. Prints `✓ Removed volume shipwick_pgtest_data (13.0 MB)`. A volume whose application still exists is refused by the agent with `VOLUME_IN_USE` (see [Error messages](#error-messages)): its data belongs to the application, and [`restore`](#restore) is the way to replace it. Needs the `admin` role.

## export

Write everything the server runs into one encrypted file, for [`import`](#import) on another server. Since 0.5.

```text
shipwick export [flags]
```

| Flag | Default | |
|---|---|---|
| `-o`, `--output <file>` | `shipwick-export-<time>.swexport` | File to write. The time is UTC, in the form `yyyymmdd-hhmmss` |
| `--app <name>` | every application | Export only this application; repeat for several |
| `--to-backups` | | Write the export on the server, to where its backups go, encrypted with the server's passphrase. Takes neither `-o` nor `--app` |
| `--list` | | List the exports the server keeps with its backups |

```text
$ shipwick export -o move.swexport
Passphrase:
Once more:
✓ move.swexport (2.4 GB)
3 applications (postgres, api, web), 4 secrets, 1 registry credential, 1 certificate

On the new server: shipwick import move.swexport
The file holds every secret of the server. Keep the passphrase: without it the file cannot be read.
```

- The file holds every application's configuration and secrets, the stored secrets, registry credentials and certificates, the images built by `shipwick deploy`, the folders of static applications and an archive of every volume. With `--app`, the secrets, credentials and certificates come along either way.
- **The passphrase** is read from `SHIPWICK_EXPORT_PASSPHRASE`, or asked for twice without echo; outside a terminal the variable is required. It must be at least 12 characters long. Without it the file cannot be read by anyone, including you.
- Each application is held while its volumes are read, as for a backup; an application with `backups.before` or `backups.stop` in its `deploy.yaml` gets the same treatment here. A running database without either is copied as it is. An application that is being deployed or backed up cannot be exported at the same time; run the export again when it is done.
- The file is created with mode `0600`, and an existing file is never overwritten. It is read back to its end before it is called an export; a file that did not arrive whole is deleted: `the file that arrived is not a whole export (…); nothing was kept. Run the export again`.

`--to-backups` has the agent write the export itself, as `SHIPWICK_EXPORT_SCHEDULE` does on a schedule, and waits for it: `✓ Export #3 written to local and s3 (2.4 GB)`. `--list` shows those exports:

```text
$ shipwick export --list
EXPORT   WHEN     TRIGGER    SIZE     WHERE       STATUS
#3       2m ago   manual     2.4 GB   local, s3   succeeded
#2       1h ago   schedule   2.4 GB   local, s3   succeeded
```

With none: `The server keeps no export. Write one with: shipwick export --to-backups, or on a schedule with SHIPWICK_EXPORT_SCHEDULE`.

The agent's own database and key are a different thing, for restoring this same server: [`server backup`](#server-backup). Needs a token with the `admin` role. See [Move to a new server](/docs/tasks/move-to-a-new-server).

## import

Take in a file written by [`export`](#export), on the server the current context points at: store its secrets, registry credentials and certificates, then deploy its applications one after the other and wait for each. An application's volumes are restored before it first starts. Since 0.5.

```text
shipwick import <file> [flags]
shipwick import --status
```

| Flag | |
|---|---|
| `--overwrite` | Replace what exists under the same name, volumes included |
| `--stopped` | Deploy the applications without starting them |
| `-y`, `--yes` | Do not ask before overwriting |
| `--status` | Show the import that is running, or ran last. Takes no file |

```text
$ shipwick --context new import move.swexport
Passphrase:
Export of 2026-10-03 14:05: 3 applications (postgres, api, web), 4 secrets, 1 registry credential, 1 certificate
✓ postgres 16.4 (1 volume restored: data)
✓ api 1.4.2
✓ web 2.0.1
✓ 4 secrets, 1 registry credential, 1 certificate stored

Point the DNS records of the applications' hostnames at this server: each is served once its record does. shipwick status <app> names the ones that wait.
```

- **The passphrase** is read from `SHIPWICK_EXPORT_PASSPHRASE`, or asked for without echo. The file is looked at on this machine first, so a wrong passphrase or a wrong file is found before a byte is sent: `the passphrase does not match this export, or the file is damaged`, `it is not a file shipwick export wrote`.
- **The order** is the export's: applications without a domain first (what others reach by name, such as a database), then the rest, each group oldest first. In a terminal, a progress line names the application the server is at: `Importing api (2 of 3)`.
- **What exists is left alone.** What exists on this server under the same name is left as it is, and said so (`! api was not imported: …`), unless `--overwrite` is given; then applications are replaced together with their volumes. In a terminal, `--overwrite` asks for the word `overwrite` to be typed; outside one it needs `--yes`.
- **Images** from a registry are pulled on the new server, with the credentials the export brought. Images built by `shipwick deploy` travel in the file.
- **`--stopped`** deploys everything without starting it, which is how a standby is kept; the lines then read `✓ api 1.4.2, stopped`, and the last one `Nothing was started. When this server is to take over: shipwick standby promote`. See [`standby`](#standby).
- An application that fails is reported (`✗ api: …`) and the others go on. The command then ends with `Not everything was imported. What succeeded is in place; fix the rest and import again with --overwrite, or deploy it by hand.` and exits with `1`.
- The import ends with the upload. If the connection breaks, see what it had finished with `shipwick import --status`, and run it again with `--overwrite`.
- The server takes one import at a time; see `IMPORT_IN_PROGRESS` under [Error messages](#error-messages). Since 0.6 an import is also refused while a standby's promotion runs: `PROMOTION_IN_PROGRESS`.

`--status` prints where the import came from and when (`Import from move.swexport, finished 2m ago`, or `started 2m ago` while it runs), then the same lines.

Since 0.6 the agent remembers its last import across a restart, and `--status` answers after one as before it. An import the agent was restarted under has failed and is shown as such. What it had finished is in place, the deployment it was at is resumed like any deployment (an application that was being deployed stopped stays stopped), and running the import again with `--overwrite` does the rest.

Needs a token with the `admin` role. See [Move to a new server](/docs/tasks/move-to-a-new-server).

## standby

Show what a second server holds for the day it has to take over: the applications that were imported stopped, and how its scheduled import from the bucket is doing. Since 0.5.

```text
shipwick standby
shipwick standby pull
shipwick standby promote [flags]
```

Shipwick does not fail over. The first server writes an export to its backup bucket on a schedule (`SHIPWICK_EXPORT_SCHEDULE`), the second imports the newest one on a schedule (`SHIPWICK_STANDBY_SCHEDULE`) with every application deployed and stopped, and when the first server is gone, a person runs `standby promote` on the second and changes the DNS records it prints. The data is as old as the last export.

```text
$ shipwick --context standby standby
Imports the newest export from the bucket on schedule 15 * * * * (UTC); export #12 imported 8m ago

APPLICATION   VERSION   IMPORTED   HOSTNAMES
postgres      16.4      8m ago
my-api        1.4.2     8m ago     api.example.com

Deployed and stopped. Start them, in this order, with: shipwick standby promote
```

The first line appears on a server with `SHIPWICK_STANDBY_SCHEDULE`; it ends in `none imported yet` before the first import, and is followed by `✗ The last import failed …` with the reason when it did. Since 0.6 the agent remembers what it imported across a restart, so an export it has already imported is not imported again. With nothing waiting: `No application is waiting for a promotion here.` Needs the `read` role.

Since 0.6, a server that was promoted says when, and names what did not come up:

```text
$ shipwick --context standby standby
Imports the newest export from the bucket on schedule 15 * * * * (UTC); export #12 imported 3h ago

Promoted 5m ago: 2 applications started.
  my-api: failed: …

No application is waiting for a promotion here.
```

An application is named when it could not be started (`failed`, with the agent's message) or was started and not ready within its startup budget (`started`). While a promotion runs, the line reads `A promotion is running, begun 1m ago. Follow it with: shipwick standby promote`, followed by every application and where it stands: `pending`, `starting`, `running`, `started` or `failed`.

### standby pull

Import the newest export from the bucket now, stopped: what the schedule does. The stopped applications that are there are replaced; applications that run on this server are never touched. The command waits and reports like [`import`](#import). On a server without a bucket the agent answers `STANDBY_NOT_CONFIGURED`; see [Error messages](#error-messages). Needs the `admin` role.

### standby promote

Start every application that was imported stopped, in the order they were imported, waiting for each to be ready, and print the DNS records that make their hostnames reach this server. Since 0.6 the command starts the promotion on the server and follows it.

| Flag | |
|---|---|
| `-y`, `--yes` | Do not ask for confirmation |

```text
$ shipwick --context standby standby promote
This starts 2 applications on https://deploy2.example.com: postgres, my-api.
The server they were exported from must no longer be serving.
Type promote to confirm: promote
✓ postgres is running
✓ my-api is running

Change these DNS records. Until they have changed, visitors still go to the old server:
HOSTNAME          TYPE   VALUE
api.example.com   A      203.0.113.77
```

- In a terminal the confirmation is the word `promote`; outside one, `--yes` is required.
- **The promotion runs on the server, not in the command** (since 0.6). `standby promote` asks for it and then follows it, printing each application as it comes up; in a terminal, a progress line names the one the server is at: `Starting my-api (2 of 2)`.
- **A lost connection or a restart of the agent does not end it.** The command shows `Waiting for the agent to respond` and carries on when the agent answers again; an agent that was restarted in the middle goes on with the promotion where it was. After 20 failed attempts in a row the command gives up with the error and `The promotion goes on without this command, across a restart of the agent as well. Follow it with: shipwick standby promote`. Ctrl+C stops the waiting, not the promotion, and prints the same advice.
- **Run again, it follows the promotion under way**, without asking: `A promotion is running on https://deploy2.example.com. Following it.` Afterwards, [`shipwick standby`](#standby) says when the server was promoted and what did not start.
- An application that was started but is not ready within its startup budget is a warning with the agent's message; one that could not be started is `✗ my-api could not be started: …`, the rest are started regardless, and the command exits with `1`.
- While a promotion runs, a second one and an import are refused, and a promotion is refused while an import runs; see `PROMOTION_IN_PROGRESS` and `IMPORT_IN_PROGRESS` under [Error messages](#error-messages).
- **Against an agent older than 0.6** the promotion is one request that is held until every application has started, as before. If the connection is lost, the answer is lost with it, and the command says so: `The agent is older than this shipwick and answers a promotion only when it has ended, on the connection that was lost. The promotion itself goes on`. See what was started with `shipwick ps`. A `shipwick` older than 0.6 promotes a 0.6 server the same way.
- The records carry the server's own addresses, which the agent knows when `SHIPWICK_AGENT_DOMAIN` or `SHIPWICK_DASHBOARD_DOMAIN` is set. Otherwise the value reads `<this server's address>`.
- Nothing checks that the first server is really gone: two servers running the same applications against the same outside services is yours to rule out.
- After a promotion this server is the service. Remove `SHIPWICK_STANDBY_SCHEDULE` from its configuration and give its backups a bucket prefix of their own.

Needs the `admin` role. See [Keep a second server ready](/docs/tasks/standby), [Move to a new server](/docs/tasks/move-to-a-new-server) and the [agent configuration](/docs/reference/agent-configuration#shipwick-standby-schedule).

## server status

Show whether the agent is reachable, what it runs on, how full its disk is, which token you are using, which alerts are active, and since 0.7 what the log archive holds and whether a newer release exists.

```text
shipwick server status
```

```text
https://agent.example.com  ● reachable

Agent           v0.8.0
CLI             v0.8.0
Host            vps-1
OS              linux (amd64, kernel 6.8.0)
Docker          29.8.0
CPUs            4
Memory          8 GB, 2 GB swap
Applications    3
Containers      5 running
Proxy           ok  serving 4 routes
Notifications   webhook configured
Token           ci (deploy)
Dashboard       https://dashboard.example.com
Disk            61 GB of 75 GB used (81%)
```

An agent of 0.7 or later adds a line, and says in the first when it knows of a newer release:

```text
Agent           v0.8.0  v0.8.1 is available  (on the server, run the installer again: curl -fsSL https://get.shipwick.com | sh)
Log archive     1.1 KB of 1 GB, 1 entry, kept 14 days
```

Since 0.8 the `Memory` line carries the server's swap, and the `Docker` line says what about the daemon changes what a deployment gets:

```text
Docker          29.8.2, rootless; memory and CPU limits are not enforced
Memory          4 GB, no swap
```

The command first calls the health endpoint, which needs no token. This separates "cannot reach the agent" from "reached it, but the token is wrong". The first line is the agent's URL and `● reachable`, with `context <name>` after the URL when the configuration file holds several servers. Then:

| Line | |
|---|---|
| `Agent` | The agent's version. Since 0.7, followed by `v0.8.1 is available` and the installer line when the agent knows of a release newer than itself. The agent asks GitHub itself, once a day; an agent from before 0.7, one told not to ask (`SHIPWICK_UPDATE_CHECK=off`) and one that cannot reach GitHub say nothing, and neither does this line |
| `CLI` | The version of `shipwick` |
| `Host` | The server's hostname |
| `OS` | Operating system, architecture and kernel |
| `Docker` | Docker version. Since 0.8, followed by `, rootless` when the daemon runs as an ordinary user of the server, and by the limits it accepts and does not apply: `; memory and CPU limits are not enforced`, or `memory` or `CPU` alone. See [Limits that are not enforced](/docs/concepts/resources#limits-that-are-not-enforced) and [Rootless Docker](/docs/tasks/less-than-the-docker-socket#rootless-docker) |
| `CPUs` | Of the server |
| `Memory` | Of the server. Since 0.8, followed by its swap: `8 GB, 2 GB swap`, or `8 GB, no swap`. Without swap a full memory is a killed process at once; see [Prepare a server](/docs/tasks/prepare-a-server). The memory alone with an agent older than 0.8, and where the agent cannot tell |
| `Applications` | Number of applications |
| `Containers` | Number of running Shipwick-managed containers |
| `Proxy` | `ok  serving N domains`, `unreachable` with the error, or `not configured` when `SHIPWICK_CADDY_ADMIN` is not set on the agent |
| `Notifications` | `webhook configured`, or `none  (set SHIPWICK_WEBHOOK_URL on the agent)` |
| `Token` | The name and role of the token this command used: `ci (deploy)`, or `root (admin)` for the token the agent is configured with. Since 0.6, what narrows the token follows the role: the applications a `deploy` token is limited to, and when it expires: `ci (deploy, limited to my-api, web, expires in 87 days)`. Omitted with an agent from before tokens had names |
| `Dashboard` | The dashboard's address, which [`open --dashboard`](#open) opens, or `no hostname  (set SHIPWICK_DASHBOARD_DOMAIN on the agent)`. Since 0.5 |
| `Sign-in` | The issuer URL of the OpenID Connect provider people sign in to the dashboard with: `https://accounts.example.com/realms/company`. Only on an agent with one configured; see [`access`](#access). Since 0.6. Where the agent names people by another claim than their address, the line says so: `https://accounts.example.com/realms/company (people are named by the preferred_username claim)`. Since 0.7 |
| `Disk` | How full the server's disk is: used, total and percent. Omitted with an older agent, and where the agent cannot measure it. Since 0.5 |
| `Network` | What stands between the server and the internet, on a server where something is set; see below. Since 0.6 |
| `Log archive` | What the agent keeps of the output of containers that ended: `61 MB of 1 GB, 297 entries, kept 14 days` — what the entries take on the disk, what they may take, how many there are and for how long each is kept. `off  (SHIPWICK_LOG_RETENTION_SIZE is 0 on the agent)` when nothing is kept. Omitted with an agent older than 0.7. See [`logs`](#the-log-archive) |

The `Network` line names what the agent is configured with, the parts separated by ` · `:

```text
Network         proxy proxy.example.com:3128 · certificate authorities of its own · DNS system
```

| Part | Set on the agent with |
|---|---|
| `proxy <host:port>` | `HTTPS_PROXY` or `HTTP_PROXY`. A user name and a password in the proxy's URL are never shown |
| `certificate authorities of its own` | `SHIPWICK_CA_FILE` |
| `DNS system`, `DNS 10.0.0.2:53, 10.0.0.3:53` | `SHIPWICK_DNS_RESOLVERS`: the server's own resolver, or the name servers given, each with its port |
| `certificates from <url>` | `SHIPWICK_ACME_DIRECTORY` |

A server that reaches the internet the plain way has no such line. See [Run behind a corporate proxy or without internet](/docs/tasks/corporate-network) and the [agent configuration](/docs/reference/agent-configuration).

The active alerts follow, one line each, in the agent's words: `!` for a warning, `✗` for a critical one. They are a replica close to its memory limit, a disk that is filling up, a replica that keeps restarting and an application that has not been healthy for a while; see [Alerts and metrics](/docs/tasks/alerts-and-metrics). Without alerts nothing is printed.

Since 0.8 there is a fifth alert, a Docker daemon that has not answered for 30 seconds, and the alert about memory is not raised about a limit Docker does not enforce. While the daemon does not answer, the agent is still `● reachable`, and this command ends, after 15 seconds at most, with the agent's version and the error of `RUNTIME_UNAVAILABLE`; see [Error messages](#error-messages). The alert itself goes to the webhook.

If the token is rejected, the agent's version is still shown before the error. Since 0.6 a token that has expired is told so, with its name and when it expired; see `TOKEN_EXPIRED` under [Error messages](#error-messages).

## server install

Install or upgrade the Shipwick server over SSH, from here.

```text
shipwick server install <user@host> [flags]
```

| Flag | Default | |
|---|---|---|
| `--agent-domain <host>` | | Hostname for the API, for example `agent.example.com` |
| `--dashboard-domain <host>` | | Hostname for the dashboard, for example `dashboard.example.com` |
| `--context <name>` | the hostname | Name to save the server under |
| `--version <tag>` | the latest release | Release to install, for example `v0.8.0` |

```text
$ shipwick server install root@203.0.113.10 --agent-domain agent.example.com --dashboard-domain dashboard.example.com
✓ Connected to root@203.0.113.10 (x86_64)
✓ Docker 29.8.0
Running the Shipwick installer...
  ✓ Installed /opt/shipwick/compose.yml
  ✓ Wrote /opt/shipwick/.env
  ✓ Started the Shipwick services
  ✓ The agent is healthy
  ...
✓ Shipwick is running on root@203.0.113.10
✓ Saved the API token as context 203.0.113.10 (https://agent.example.com), now current

Create these DNS records, DNS only (not proxied):
  A     agent.example.com  →  203.0.113.10
  A     dashboard.example.com  →  203.0.113.10

Next: in your project, run: shipwick init
      once the records exist, check the setup with: shipwick doctor
```

- The command runs your own `ssh` as a program with arguments, never through a shell, with `BatchMode=yes`, so it fails instead of asking for a password (use a key that logs in without one), and `StrictHostKeyChecking=accept-new`, so a fresh server's host key is accepted on first contact while a key that changed is refused with the advice to run `ssh-keygen -R <host>` if you reinstalled the server. The remote commands are fixed; the hostnames and the version are validated first and reach the installer as environment assignments.
- Docker is installed with `get.docker.com` when the server has none: `Docker is not installed. Installing it with get.docker.com; this takes a minute.`
- The token is read from the installer's summary and saved as a context, which becomes current. Run again, the command upgrades the server; the installer then prints no token, nothing is fetched from the server, and the context keeps the token it has: `Context 203.0.113.10 (https://agent.example.com) is current; its token is unchanged`. A context that never had a token is saved without one, and the command says how to log in.
- A hostname that already resolves to the server is reported as such instead of listed among the records to create. Without `--agent-domain` the API is not exposed, the context points at `http://127.0.0.1:9000` for an [SSH tunnel](/docs/tasks/access-without-a-hostname), and the command says so.

See [Install on a server](/docs/getting-started/install#run-the-installer-from-your-laptop).

## server bundle

Make one file that installs or upgrades a server with no connection to the internet. Since 0.6.

```text
shipwick server bundle [flags]
```

| Flag | Default | |
|---|---|---|
| `--arch <arch>` | `amd64` | The server's architecture: `amd64` or `arm64` |
| `--version <tag>` | the latest release | Release to bundle, for example `v0.8.0` |
| `-o`, `--output <file>` | `shipwick-<version>-linux-<arch>.tar.gz` in the current directory | File to write |
| `--no-pull` | | Save the images this machine has under the release's names instead of pulling them. Nothing proves them: they are not checked against the release's digests |

Run it on a machine that has a connection and Docker. It talks to no agent and needs no token.

```text
$ shipwick server bundle --arch amd64
✓ Release v0.8.0: compose.production.yml, install.sh and shipwick_linux_amd64 match its checksums
✓ Release v0.8.0 is signed by the release workflow of github.com/shipwick/shipwick (verified with cosign)
✓ The three images are the ones release v0.8.0 published for linux/amd64
✓ Wrote shipwick-v0.8.0-linux-amd64.tar.gz (113 MB)

Copy it to the server, and there, as root:
  tar -xzf shipwick-v0.8.0-linux-amd64.tar.gz
  sh shipwick-v0.8.0-linux-amd64/install.sh
The server needs Docker Engine and the Compose plugin; nothing is downloaded there.
checksums.txt of the release: sha256 646205a7…
```

This is the output for a release from 0.8.0 on, on a machine that has cosign. The second line says what became of the release's signature, and the third is a warning for a release before 0.7.0, which publishes no digests of its images; see below.

- **What is in it.** The release's compose file, installer and checksums, since 0.8 the signature of the checksums (`checksums.txt.sigstore.json`) when the release has one, the `shipwick` binary for the server, and the three Shipwick images as one archive, `images.tar`, with a checksum of its own. The file unpacks into one directory named like the bundle.
- **The release's signature is verified** (since 0.8). From 0.8.0 on, a release's `checksums.txt` is signed by the workflow that published it. With [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) 2.4 or later on this machine, the command runs `cosign verify-blob` on the checksums, as a program with arguments, with the release workflow at that tag as the identity the certificate must name, before it downloads anything else. The second line of the output is one of three:

  | Situation | Line |
  |---|---|
  | The signature verified | `✓ Release v0.8.0 is signed by the release workflow of github.com/shipwick/shipwick (verified with cosign)` |
  | No cosign on this machine | `The release's signature was not checked: cosign is not installed on this machine.` The bundle goes by the checksums, as before, and still carries the signature |
  | A release before 0.8.0 | `Release v0.7.0 has no signature: releases before 0.8.0 were not signed.` |

  A signature that is not the workflow's stops the command, and no bundle is written: `the signature of release v0.8.0's checksums did not verify as one made by the release workflow of github.com/shipwick/shipwick for v0.8.0; nothing was changed`, followed by cosign's last line and `cosign 2.4 or later reads this signature; an older one fails here whatever the file`. With cosign installed, a release from 0.8.0 on without a signature is refused as well: `release v0.8.0 has no signature (checksums.txt.sigstore.json), and every release since 0.8.0 has one; nothing was changed`. The installer on the server does not verify the signature by itself: cosign asks Sigstore for the keys it trusts, and that server reaches nothing. See [Verify a release](/docs/tasks/verify-a-release).
- **The release's files are verified** against its published `checksums.txt` as they are downloaded. A mismatch is refused and nothing is written: `install.sh does not match the checksum published with the release; no bundle was written`. The installer verifies them again on the server, and checks the image archive against its checksum before it changes anything, so a copy that arrived damaged is refused.
- **The images** are the ones the release's compose file names. They are pulled with `docker pull` for the server's architecture and written with `docker save`, both run as programs with arguments, never through a shell. In a terminal a progress line names the image being pulled. Without Docker here: `docker is not installed on this machine, and the images of a bundle are pulled and saved with it`. When a pull or the save fails, the last line `docker` printed is the reason.
- **The images are proven** (since 0.7). A release from 0.7.0 on publishes `image-digests.txt`, listed in its `checksums.txt`: the digests of its three images as the registry holds them, per platform. The archive `docker save` wrote is checked against it before the bundle is written: it must hold the configuration the release published for the server's platform and the layers that configuration lists, and name that image, and no other, by the release's tag. An archive that does not is refused, and no bundle is written: `<image> is not the image release v0.8.0 published for linux/amd64: …; no bundle was written`. The installer checks once more what Docker made of the archive before it replaces anything.
- **Two bundles are not proven**, and the command says so in place of the line about the images. With `--no-pull`: `The images are the ones this machine had under the release's names (--no-pull): they were not checked against the release's digests, and the installer will say so.` Of a release before 0.7.0: `Release v0.6.0 does not publish the digests of its images (0.7.0 and later do): the images are what the registry serves under its tags, unchecked, and the installer will say so.`
- **The last line** is the SHA-256 of the release's `checksums.txt`, from which everything in the bundle follows. The installer prints the same line on the server; compare the two.
- **`--version`** takes a release tag. A bundle can be made of 0.6.0 and later: `release v0.5.1 does not publish its installer: a bundle can be made of 0.6.0 and later`. Anything that is not a release version is refused: `releases look like v0.6.0`.
- The bundle is gathered in a temporary directory next to the output, written under another name and renamed, so a file with the bundle's name is always a whole bundle. The `Wrote` line ends with its size.
- **On the server**, unpack it and run the installer inside it, as root. It is the same installer and asks the same questions; it downloads nothing and pulls nothing. Upgrading is the same procedure with the bundle of a newer release. Docker is not in the bundle: the server needs Docker Engine and the Compose plugin before the installer runs.

See [Install on a server with no way out](/docs/tasks/corporate-network#install-on-a-server-with-no-way-out).

## server rotate-key

Replace the key the server encrypts stored secrets with. Since 0.5.

```text
shipwick server rotate-key
```

Environment values, secrets and registry passwords are encrypted in the agent's database with one key. This command has the running agent generate a new one and re-encrypt everything under it. Nothing is deployed and nothing restarts.

```text
$ shipwick server rotate-key
✓ Rotated the encryption key: 14 stored values and 9 deployments re-encrypted
  The new key is in /var/lib/shipwick/encryption.key on the server. Back it up: database backups made from now on need it, earlier ones the old key.
```

Where the agent keeps its key in the data directory (`encryption.key`, the default), it replaces the file; the path in the second line is the one the agent reports. Where the key is set as `SHIPWICK_ENCRYPTION_KEY`, the agent cannot change its own environment: the new key is shown once, with the line to put into `/opt/shipwick/.env` on the server before the agent restarts.

```text
The agent's key is set in its environment, which it cannot change. Put the new
key in /opt/shipwick/.env on the server before the agent restarts:

    SHIPWICK_ENCRYPTION_KEY=…
```

With the old key there the agent refuses to start. Until it has started with the new one it keeps a copy of the new key in a file the command names, and removes it then. Rotating again before that restart is refused with `KEY_ROTATION_PENDING`; see [Error messages](#error-messages).

Back the new key up: backups of the database made before the rotation still need the old key. Needs a token with the `admin` role. See [Rotate the encryption key](/docs/tasks/rotate-the-encryption-key) and [Security](/docs/security#key-rotation).

## server backup

Back up the agent's own state now: its database and the key that encrypts the secrets in it. Since 0.5.

```text
shipwick server backup
```

```text
$ shipwick server backup
✓ Agent state backed up: 1.2 MB to local, s3 (encrypted) (backup #4)
```

The agent does this once a day by itself. The backups go where application backups go, under `_agent/`, and are only ever written encrypted: `SHIPWICK_BACKUP_PASSPHRASE` must be set on the agent, or the agent answers `BACKUPS_NOT_ENCRYPTED` (see [Error messages](#error-messages)). The files are `shipwick.db.enc` and `encryption.key.enc`; [`backups decrypt`](#backups-decrypt) reads them on your machine. [`doctor`](#doctor) says whether and when the state was last backed up.

This is for restoring the same server. To take what a server runs to another one, use [`export`](#export). Needs a token with the `admin` role. See [Back up and restore volumes](/docs/tasks/backups) and the [agent configuration](/docs/reference/agent-configuration#backups).

## doctor

Check the setup end to end and say what to fix.

```text
shipwick doctor
```

```text
✓ shipwick v0.8.0, the latest release
✓ Agent https://agent.example.com runs v0.8.0, the latest release
✓ Token laptop (admin)
✓ Docker 29.8.0 on the server
✓ Proxy serving 2 routes
! 3 applications run without a memory limit: postgres, redis, web. One that leaks takes the server's memory from all the others; set resources.memory in deploy.yaml
! The server has no swap: once its 4 GB of memory is used, the kernel kills a process at once. Add a swap file on the server
✓ agent.example.com → 203.0.113.10
✓ Port 80 open on 203.0.113.10
✗ Port 443 is not reachable on 203.0.113.10: open it in the server's firewall; certificates are issued and renewed through ports 80 and 443
✗ api.example.com → 198.51.100.7, which is not the server (203.0.113.10). Point the record at the server
✓ https://api.example.com/ answers HTTP 200

2 problems found.
```

One line per check: the CLI's and the agent's versions against the latest release (`!` and the upgrade command when one is behind), the token and its role, Docker on the server, the proxy and how many domains it serves, the server's active alerts, since 0.8 the applications without a memory limit, the server's swap, whether application containers can reach the API and whether Docker enforces limits, the certificates you supplied, the backup of the agent's own state, whether the agent's hostname resolves to the server, whether ports 80 and 443 answer there, and for every application's domain, alias and redirect whether DNS points at the server, and whether `https://` answers at the application's address, its `path` included. The last line is `Everything checks out.`, `No problems; 1 thing worth a look.` or `2 problems found.`; the command exits non-zero when something is broken (`✗`), not for things merely worth a look (`!`).

Since 0.5, `doctor` also reports:

| Check | Lines |
|---|---|
| Alerts | Every active alert, in the agent's words: a critical one is a problem (`✗`), a warning something worth a look (`!`). See [Alerts and metrics](/docs/tasks/alerts-and-metrics) |
| Supplied certificates | `✗ The certificate you supplied for example.com expired on 2026-03-10, and browsers refuse it. Replace it with: shipwick cert set example.com --cert <file> --key <file>`; `!` and `expires on …` when it has less than 30 days to go. See [`cert`](#cert) |
| The agent's state | `✓ Agent state backed up 5h ago to s3`, or to `the server's own disk` with the variables that keep a copy elsewhere; `!` when the last backup failed, when none was taken yet, and when `SHIPWICK_BACKUP_PASSPHRASE` is not set: `The encryption key exists only on this server. …; losing it loses every secret`. See [`server backup`](#server-backup) |
| Cloudflare | A hostname that resolves to Cloudflare's proxy is named as such. Without `SHIPWICK_CLOUDFLARE_API_TOKEN` on the agent it is a problem: `✗ api.example.com resolves to Cloudflare's proxy (104.16.0.1), not to the server: turn the proxy off for this record (DNS only), or set SHIPWICK_CLOUDFLARE_API_TOKEN on the agent to keep it on`. With the token it is in order: `✓ api.example.com → Cloudflare's proxy (104.16.0.1)`, and the advice to create records "DNS only" is dropped. See [Put Cloudflare in front of the server](/docs/tasks/cloudflare) |
| Wildcards | `✓ *.example.com is a wildcard: it has no single record or address to check` |

Since 0.6, `doctor` also reports:

| Check | Lines |
|---|---|
| The token's limit and expiry | The token line names what narrows the token: `✓ Token ci (deploy, limited to my-api, expires in 87 days)`. Within 14 days of its expiry it is something worth a look: `! Token ci (deploy, expires in 9 days). From 2026-10-12 15:04 it is refused; create its replacement before then: shipwick token create <name> --role deploy --expires 90d`, the command carrying the token's role and its `--app` limits. A token that has expired is a problem, and the last line of the report: `✗ The token ci expired on 2026-10-01 at 15:04. An admin creates a new one with: shipwick token create Then set SHIPWICK_AGENT_TOKEN to it, or save it with: shipwick login` |
| The proxy and the Docker daemon | On a server whose agent goes through a proxy, whether the Docker daemon has one too. With both: `✓ The agent and the Docker daemon go through a proxy (proxy.example.com:3128)`. With the agent's alone: `! The agent goes through the proxy proxy.example.com:3128, and the Docker daemon on the server has none configured: images are pulled by the daemon, not by the agent. If pulls fail, add "proxies" to /etc/docker/daemon.json on the server and restart Docker`. See [Run behind a corporate proxy or without internet](/docs/tasks/corporate-network) |
| An ACME server of your own | `✓ Certificates are obtained from https://ca.example.internal/acme/acme/directory`, on an agent with `SHIPWICK_ACME_DIRECTORY` |

Since 0.8, `doctor` also reports the following, each as something worth a look (`!`): the first under the proxy's line, the others after the alerts, in this order. An agent older than 0.8 reports none of it, and nothing is read into its silence.

| Check | Lines |
|---|---|
| A proxy that is not Shipwick's image of this version | Under the proxy's line: `! The proxy is not Shipwick's image of this version: a name lookup Docker leaves unanswered holds every request for seconds, and applications deployed together wait for each other. On the server, run the installer again; an image of your own is built from Dockerfile.caddy`. The proxy of an older release, the official Caddy image or an image of your own without Shipwick's part still serves. See [A proxy image of your own](/docs/concepts/routing-and-https#a-proxy-image-of-your-own) |
| Applications without a memory limit | `! 3 applications run without a memory limit: postgres, redis, web. One that leaks takes the server's memory from all the others; set resources.memory in deploy.yaml`. The running applications are named, the first five of them, then `and 2 more`; with one the line begins `1 application runs`. Left out on a server whose Docker does not enforce memory limits, where setting one is no advice |
| A server without swap | `! The server has no swap: once its 4 GB of memory is used, the kernel kills a process at once. Add a swap file on the server`. See [Prepare a server](/docs/tasks/prepare-a-server) |
| An API open to applications | `! Application containers can reach the agent's API: it listens on a network they are on, and only the token keeps them out. On the server, run the installer again; if this stays, the agent's log says why, and "Who can reach the API" in the handbook (Security) what to change`. See [Who can reach the API](/docs/security#who-can-reach-the-api) |
| Limits Docker does not enforce | On rootless Docker: `! Docker on the server is rootless and does not enforce memory and CPU limits: no replica is held to resources.memory and resources.cpu of its deploy.yaml, and the usage shown for a replica is not its own. Delegate the cpu and memory cgroup controllers to the user who runs Docker, on a server with systemd (handbook: Rootless Docker)`. On any other daemon: `! Docker on the server does not enforce memory limits: no replica is held to resources.memory of its deploy.yaml. Its kernel offers Docker no cgroup controller for them; docker info on the server says which`. The line names the limits that are not applied: memory, CPU or both. See [Rootless Docker](/docs/tasks/less-than-the-docker-socket#rootless-docker) and [Limits that are not enforced](/docs/concepts/resources#limits-that-are-not-enforced) |

Shipwick reports the memory limits and the swap and changes neither: a limit is a line in `deploy.yaml`, swap is the server's.

On a network without a way to GitHub the latest release cannot be looked up; the version lines then say so, and the checks go on: `✓ shipwick v0.8.0 (could not check for a newer release)`.

Hostnames are resolved through public resolvers (Cloudflare's, Google's and Quad9's) before this machine's, the same view of DNS the agent takes. Since 0.6 each resolver is given two seconds, and when none of them can be reached, as behind a firewall that lets no DNS out, this machine's resolver is asked for the rest of the run. The server's address is learned by resolving the agent's own hostname, so through a tunnel (`127.0.0.1`) ports and record targets are not checked. An agent whose own hostname is behind Cloudflare's proxy hides the server's address in the same way, and ports 80 and 443 and the records' targets are not checked then either.

## open

Open the application, or the server's dashboard, in the browser.

```text
shipwick open [app] [flags]
```

| Flag | Default | |
|---|---|---|
| `-f`, `--file <path>` | `deploy.yaml` | Configuration file used to find the application name when `[app]` is omitted |
| `--dashboard` | | Open the server's dashboard. Takes no application |

Prints `Opening https://api.example.com` and hands the URL to the platform's default browser (`xdg-open`, `open` or `rundll32`), as one argument, never through a shell. The address is the application's domain with its `path`: `https://example.com/api`. An application without a domain is told where it can be reached instead: `my-api has no domain; it is reachable from other applications at http://my-api:8080`, followed by `To serve it publicly, add domain: to deploy.yaml and deploy again`. An application whose domain is a wildcard has no address of its own to open, and the command says so. When no browser can be started, the URL is printed to open yourself.

Since 0.5, `--dashboard` opens the dashboard at the address the agent reports, wherever you are, and so does `shipwick open` without an argument in a directory with neither a `deploy.yaml` nor a `shipwick.yaml`. On a server without a dashboard hostname, `--dashboard` answers `This server has no dashboard hostname. Set SHIPWICK_DASHBOARD_DOMAIN in /opt/shipwick/.env and run the installer again`.

## login

Save the agent URL and API token for later commands.

```text
shipwick login [flags]
```

| Flag | |
|---|---|
| `--token-stdin` | Read the token from standard input |
| `--no-check` | Save without asking the agent whether the token is right. Since 0.5 |
| `--context <name>` | Save the server under this name and make it the current context. Global flag; without it, the selected context is overwritten, or `default` is created |

```text
$ shipwick login --url https://agent.example.com
API token:
✓ Logged in to https://agent.example.com (my-server, agent v0.8.0)
  saved as context default in /home/me/.config/shipwick/config.yaml
```

- In a terminal without `--url`, `login` asks for the agent URL, offering the currently resolved URL as the default: the context's saved URL if it exists, `SHIPWICK_AGENT_URL` if set, otherwise `http://127.0.0.1:9000`.
- The token is asked for without echo. It is never taken from `SHIPWICK_AGENT_TOKEN` or from the saved configuration: giving it afresh is the point of logging in.
- The token is verified against the agent before anything is saved. If the agent rejects it, `the agent rejected this token; nothing was saved`.
- With `--no-check`, the URL and the token are saved as given, without a request to the agent: `✓ Saved https://agent.example.com as context default in /root/.config/shipwick/config.yaml`, then `not checked against the agent; try it with: shipwick server status`. It is for a hostname whose DNS record or certificate does not exist yet. The installer uses it on the server, where it saves the server's own URL and token as a context of the user who runs it; see [Install the CLI](/docs/getting-started/install-cli#on-the-server).
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

Manage API tokens and their roles. A token has one of three roles: `read` sees everything (status, logs, history, metrics, traffic, the list of backups, the names of secrets, volumes, registries and supplied certificates); `deploy` also changes what runs (deploy, redeploy, roll back, stop, start, run commands, take and verify a backup); `admin` also does the rest (delete applications, back up and restore volumes, download and remove backups, remove volumes, manage tokens, secrets, registry credentials and certificates, read the audit trail, manage who may sign in to the dashboard, adopt backups, rotate the encryption key, export, import and promote a standby). Give CI a `deploy` token and keep `admin` tokens for people.

Since 0.6 a `deploy` token can be limited to some applications, and any token can be given an end; see [`token create`](#token-create). Since 0.7 both can be changed later with [`token update`](#token-update); the role cannot.

The token the agent is configured with, `SHIPWICK_AGENT_TOKEN` or the one it generated on first start, is `root`: it has the `admin` role, is not listed here, cannot be revoked here and does not expire. Change it on the agent. Every `token` command needs the `admin` role.

```text
shipwick token create <name> --role read|deploy|admin [flags]
shipwick token ls
shipwick token update <name> [--app <application>... | --all-apps] [--expires <when> | --no-expiry]
shipwick token revoke <name> [flags]
```

### token create

Create a token. Its value is shown once.

| Flag | |
|---|---|
| `--role <role>` | What the token may do: `read`, `deploy` or `admin`. Required: without it, `choose what the token may do: --role read, deploy or admin` |
| `--app <name>` | Limit a `deploy` token to this application; repeat for several, at most 50. Since 0.6 |
| `--expires <when>` | When the token stops working: days or hours from now (`90d`, `12h`) or a date (`2027-01-31`). Since 0.6 |

```text
$ shipwick token create ci --role deploy
✓ Created token ci with the deploy role

    swk_Xk3nM9…

Store it now: it will not be shown again.
In CI, set SHIPWICK_AGENT_TOKEN to it. On a machine you work from, save it with: shipwick login
```

Names are lowercase letters, digits and dashes, at most 40 characters, starting and ending with a letter or digit; `root` is taken. A name that exists is refused by the agent with `TOKEN_EXISTS`. The value starts with `swk_`; the prefix is not part of the secret and only makes a token recognizable where it must not appear.

**A token for some applications** (since 0.6). `--app` limits a `deploy` token to the applications named:

```text
$ shipwick token create ci --role deploy --app my-api --app web --expires 90d
✓ Created token ci with the deploy role, limited to my-api, web
  It expires on 2027-01-01 at 15:04, in 90 days.

    swk_Xk3nM9…

Store it now: it will not be shown again.
In CI, set SHIPWICK_AGENT_TOKEN to it. On a machine you work from, save it with: shipwick login
```

- Such a token does to its applications what the `deploy` role allows: deploy (the first deployment included; the application need not exist yet), redeploy, roll back, stop, start, run commands and jobs, take and verify backups. It reads everything, as every token does.
- It changes nothing else. Another application is refused with a message that names the token's applications, and so is anything of the `deploy` role that is not about one application; see `TOKEN_LIMITED` under [Error messages](#error-messages). What takes `admin` stays refused, for its own applications too.
- Only `deploy` can be limited: `--app: only a deploy token can be limited to applications: a read token changes nothing, and admin is for the whole server`.
- The list can be changed later, with [`token update`](#token-update).
- A limit narrows what a token can be used for by mistake or after a leak. It is not a wall between tenants: a limited token still reads every application's logs and configuration, never the values of `env`.

**A token with an end** (since 0.6). `--expires` takes a whole number of days or hours from now, or a date; a token with a date works through that day, UTC. A time in RFC 3339 is accepted too.

```bash
shipwick token create ci --role deploy --expires 90d
shipwick token create contractor --role read --expires 2027-01-31
```

- The second line of the output says when, in local time, and how far off that is: `It expires on 2027-01-01 at 15:04, in 90 days.`
- From then on the token is refused, and whoever presents it is told that it expired and when; see `TOKEN_EXPIRED` under [Error messages](#error-messages). A wrong token is told nothing of the kind.
- An expired token stays in `token ls` until you revoke it. Its end can be moved with [`token update`](#token-update), and it then works again.
- An expiry that cannot be read, or lies in the past, is refused before anything is sent: `--expires: invalid expiry "soon": use days or hours from now, or a date, e.g. 90d, 12h or 2027-01-03`; `--expires: the expiry is in the past: a token that has expired already would be of no use`.

An agent older than 0.6 knows neither flag and creates nothing: `the agent is older than this shipwick: it knows neither --app nor --expires, and created nothing`, then `Compare versions with: shipwick server status`.

### token ls

List the tokens, oldest first, without their values. `list` is an alias.

```text
$ shipwick token ls
NAME         ROLE     APPLICATIONS   EXPIRES            CREATED   LAST USED
ci           deploy   my-api, web    in 87 days         3d ago    12m ago
contractor   read     all            in 9 days (soon)   2d ago    2h ago
anna         admin    all            never              1d ago    never

Expired, or expiring within 14 days: contractor. Move an end with: shipwick token update <name> --expires 90d
```

Since 0.6 the list has two more columns. `APPLICATIONS` is `all`, or the applications a `deploy` token is limited to. `EXPIRES` is `never`, `in 87 days` (or hours, or minutes), `in 9 days (soon)` in yellow within 14 days of the expiry, and `expired 2d ago` in red after it. When any token is expired or within those 14 days, the line under the table names them.

`LAST USED` is kept to the minute by the agent and reads `never` until the token is first used. The root token is not listed. Without stored tokens: `No tokens besides the one the agent is configured with. Create one with: shipwick token create ci --role deploy`.

### token update

Change the applications a token is limited to, or when it expires. The token's value stays the same: whatever holds it keeps working. Since 0.7.

| Flag | |
|---|---|
| `--app <name>` | Limit the token to this application instead of the ones it had; repeat for several |
| `--all-apps` | Lift the limit: the token may change every application |
| `--expires <when>` | When the token stops working: days or hours from now (`90d`, `12h`) or a date (`2027-01-31`) |
| `--no-expiry` | Take the token's end away |

```text
$ shipwick token update ci --app my-api --app web
✓ Changed token ci
  It is limited to my-api, web.
$ shipwick token update ci --all-apps --no-expiry
✓ Changed token ci
  It is not limited: it may change every application.
  It does not expire.
```

- **`--app` replaces the list**, it does not add to it, and is checked as at creation: valid names, at most 50, a `deploy` token.
- **`--expires` moves the end**, also of a token that has expired already, which then works again. The answer says when: `It expires on 2027-01-01 at 15:04, in 90 days.` An end is moved into the future only; to stop a token now, [revoke](#token-revoke) it.
- **The change holds from the token's next request.**
- **The role is not changed here.** A token that is to do more than it was created for is a new token.
- **Every change is recorded in the audit trail** as `token.update`, with what it was before: `applications my-api web -> all, expires 2026-11-03T00:23:04Z -> never`.
- **What is refused before anything is sent.** No flag: `say what to change: --app or --all-apps, --expires or --no-expiry`. Both of a pair: `--app limits the token and --all-apps lifts the limit: use one`; `--expires sets an end and --no-expiry takes it away: use one`. The root token: `the root token is the one the agent is configured with: it is not limited and does not expire; change SHIPWICK_AGENT_TOKEN on the agent instead`.
- An unknown name: `there is no token named ci`, then `List the tokens with: shipwick token ls`.
- An agent older than 0.7 changes nothing, and the command says that the agent is older than this `shipwick`. Until it is upgraded, create a new token and revoke the old one.

### token revoke

Revoke a token; whatever uses it is refused from then on.

| Flag | |
|---|---|
| `-y`, `--yes` | Do not ask for confirmation |

In a terminal, `revoke` asks for the token name to be typed as confirmation; outside one it refuses without `--yes`. Prints `✓ Revoked token ci`. Revoking `root`: `the root token is the one the agent is configured with; change SHIPWICK_AGENT_TOKEN on the agent instead`. An unknown name: `there is no token named ci`, then `List the tokens with: shipwick token ls`. A token may revoke itself.

See [Create tokens for CI and teammates](/docs/tasks/tokens).

## audit

Show who changed what on the server, and when, newest first. Since 0.6. Since 0.7 the trail is also filtered by action, by outcome and by kind of actor, and exported whole.

```text
shipwick audit [flags]
```

| Flag | Default | |
|---|---|---|
| `--app <name>` | | Only what was done to this application |
| `--actor <name>` | | Only what this token or this person did; a person by the name the trail shows |
| `--actor-kind <kind>` | | Only what tokens did, or only what people who signed in did: `token` or `person`. Since 0.7 |
| `--action <action>` | | Only this action, or with a dot at its end this family of actions (`token.`); repeat for several, or separate them by commas, at most 20. Since 0.7 |
| `--outcome <outcome>` | | Only what ended this way: `ok`, `refused` or `failed`; several separated by commas. Since 0.7 |
| `--since <when>` | | How far back: days or hours (`7d`, `24h`), or a date (`2026-09-01`, from the start of that day, UTC) |
| `-n`, `--lines <n>` | `50` | How many entries, 1 to 500 |
| `--before <id>` | | Continue with the entries older than the one with this id |
| `--format <format>` | | Write out everything that matches instead of a page: `csv` or `json` (one entry per line). Since 0.7 |
| `-o`, `--output <file>` | standard output | The file to write the export to. Since 0.7 |

```text
$ shipwick audit
WHEN                  WHO    ACTION         ON            RESULT    FROM           DETAIL
2026-10-03 20:20:44   root   secret.set     DB_PASSWORD   ok        203.0.113.9
2026-10-03 20:20:22   ci     deploy         web           refused   203.0.113.40
2026-10-03 20:20:17   ci     deploy         my-api        ok        203.0.113.40   deployment 2
2026-10-03 20:20:06   root   token.create   ci            ok        203.0.113.9    role deploy, limited to my-api, expires 2027-01-01T17:20:06Z
```

| Column | |
|---|---|
| `WHEN` | When the request was made, in local time |
| `WHO` | The token's name, or the name of a person who signed in to the dashboard: their address, or what the agent names people by |
| `ACTION` | What was asked for: `deploy`, `secret.set`, `token.create`, `signin` |
| `ON` | The application, and what else the request named, such as a secret or a token; `server` when it named neither |
| `RESULT` | `ok` when the request was accepted; `refused` when the role or the application limit did not allow it; `failed: <CODE>` for any other failure, with the error's code |
| `FROM` | The address the request came from: the client the proxy reported when there is one, else the address of the connection |
| `DETAIL` | What the agent noted: the deployment an entry made, the role of a token that was created |

- Every request that changes something is recorded: deployments, redeployments and rollbacks, stops and starts, deletions, commands and jobs started by hand, uploaded images and folders, secrets set and removed (the name, never the value), registry logins and logouts, certificates, tokens created, changed and revoked, key rotation, backups taken, verified, restored, removed and downloaded, volume downloads, restores and removals, exports, imports and promotions, sign-ins and changes to the access rules, and exports of the trail itself.
- `ok` means the request was accepted. How a deployment then went is in its own record, which the detail names.
- Reading is not recorded, and neither is what the agent does by itself: scheduled backups and jobs, restarts.
- When older entries match as well, a last line gives the command for the next page, with the filters repeated: `Older entries: shipwick audit --app my-api --before 1184`. An agent of 0.7 says whether there are more; with an older one a full page is taken for the sign.
- **Filters** (since 0.7). `--action` takes an action as the `ACTION` column shows it (`deploy`, `token.create`) or the start of a family with its dot: `token.` is every action on tokens, `backup.` every one on backups. An entry matches when one of the actions given does; filters of different kinds narrow each other. `--actor-kind` that is neither: `--actor-kind: "bot" is neither token nor person`. More than 20 actions: `--action: at most 20 at once; the start of a family covers all of it, e.g. --action backup.`

```text
$ shipwick audit --action token. -n 5
WHEN                  WHO    ACTION         ON    RESULT   FROM           DETAIL
2026-10-04 03:23:06   root   token.update   ci    ok       203.0.113.40   applications my-api web -> all, expires 2026-11-03T00:23:04Z -> never
2026-10-04 03:23:05   root   token.create   ci    ok       203.0.113.40   role deploy, limited to my-api, expires 2026-11-03T00:23:04Z
```

- **An export** (since 0.7). With `--format` or `--output` the command writes everything that matches instead of a page, newest first: `csv`, one row per entry under the header `id,at,actor_kind,actor,address,forwarded_for,action,application,target,outcome,status,code,detail`, times in UTC; or `json`, one JSON object per line, the object the API returns. Without `--output` it goes to standard output. `--output` takes the format from the file's name — `.csv`, or `.json`, `.ndjson` and `.jsonl` — and otherwise asks for it: `--output audit.txt does not say which format: add --format csv or --format json`. The file is created readable by its owner only, is never written over (`audit.csv exists already; choose another name, or remove it first`), and is removed again when the export was interrupted. It ends with `✓ Wrote the audit trail to audit.csv` and `The export is recorded in the trail, with who took it.`
- In CSV, a cell that a spreadsheet would run as a formula is written with an apostrophe in front, as text. The JSON export keeps the values as they were recorded.
- `-n` and `--before` do not go with an export: `an export is everything that matches, not a page: leave -n and --before out, and narrow it with --since, --app, --actor, --action or --outcome`.
- With nothing recorded: `Nothing recorded yet: the trail starts with the first change made through this agent.` With filters that match nothing: `Nothing recorded that matches.`
- An agent older than 0.6: `the agent is older than this shipwick and keeps no audit trail`, then `Compare versions with: shipwick server status`. An agent of 0.6 asked for what 0.7 added: `the agent is older than this shipwick: it filters the audit trail by application, actor and time only, and would have ignored --action, --outcome and --actor-kind`; `the agent is older than this shipwick and cannot export its audit trail`.

The agent keeps the trail for a year. Needs the `admin` role. See [See who changed what](/docs/tasks/audit).

## access

Say who may sign in to the dashboard, and as what. Since 0.6.

```text
shipwick access grant <address | *@domain | group:name | name:value> --role read|deploy|admin [flags]
shipwick access ls
shipwick access revoke <address | *@domain | group:name | name:value>
shipwick access sessions
shipwick access signout <address | name>
```

With an OpenID Connect provider configured on the agent (`SHIPWICK_OIDC_ISSUER` and the variables next to it; see the [agent configuration](/docs/reference/agent-configuration#sign-in)), people sign in to the dashboard with the company's accounts. These rules say what each of them may do. A rule gives a role, the same three a token has, to one of:

| Written as | Who |
|---|---|
| `ada@example.com` | One person, by their address |
| `group:platform` | Everyone the provider puts in that group, named as the provider sends it |
| `*@example.com` | Everyone with an address at that domain |
| `name:svc-deploy` | One person whose name is not an address, exactly as the provider's claim holds it, capitals included. Since 0.7 |

The most specific rule that matches a person decides: the one for their name, else the one for their address, else the ones for their groups, else the one for their domain. Of several groups the highest role counts. Nobody without a matching rule gets in.

People are named by the e-mail address the provider reports, unless the agent is told to read another claim with [`SHIPWICK_OIDC_NAME_CLAIM`](/docs/reference/agent-configuration#sign-in): a user name, or the provider's own identifier for the account. Rules by address and by domain then apply to names that are addresses; `name:` is for the others. [`server status`](#server-status) says which claim it is.

A session lasts ten hours. Tokens are not affected by any of this: the CLI and CI keep using them. Every `access` command needs the `admin` role. See [Sign in with your company's accounts](/docs/tasks/sign-in).

### access grant

Give a person, a group or a domain a role. Granting again to the same address, group or domain replaces the rule.

| Flag | |
|---|---|
| `--role <role>` | What they may do: `read`, `deploy` or `admin`. Required: without it, `choose what they may do: --role read, deploy or admin` |
| `--app <name>` | Limit the `deploy` role to this application; repeat for several |

```bash
shipwick access grant ada@example.com --role admin
shipwick access grant group:backend --role deploy --app my-api --app worker
shipwick access grant '*@example.com' --role read
shipwick access grant name:248289761001 --role deploy
```

```text
✓ group:backend has the deploy role, limited to my-api, worker
Whoever is signed in and gets something else by this is signed out with their next request, and signs in again.
```

- Quote a domain rule, or the shell expands the `*`.
- `--app` limits the role as it limits a token, and only `deploy` can be limited: `--app: only the deploy role can be limited to applications: read changes nothing, and admin is for the whole server`.
- An address and a domain are stored in lowercase; a group is kept as written. A name is kept as written too: at most 254 letters, digits and `. _ % + ' @ | : = # ~ -`, without spaces. What is none of the four is refused: `"backend" is neither an address, a domain, a group nor a name: use ada@example.com, *@example.com, group:platform or name:backend`.
- **A rule the claim in use cannot match gets a note** (since 0.7). A rule for an address or a domain on an agent that names people by another claim: `This agent names people by the sub claim: the rule applies to those whose sub is an address. For anyone else use name:<sub>.` A `name:` rule on an agent that names people by their address: `This agent names people by their e-mail address: a rule by name matches an address written exactly as the agent keeps it, in lowercase. A rule for the address itself says the same more plainly.`
- Rules are kept whether or not a provider is configured, so the table can be prepared first.

### access ls

List the rules: who gets which role. `list` is an alias.

```text
$ shipwick access ls
WHO               ROLE     APPLICATIONS     GRANTED   BY
ada@example.com   admin    all              3d ago    root
group:backend     deploy   my-api, worker   3d ago    root
*@example.com     read     all              1d ago    anna
```

`APPLICATIONS` is `all`, or the applications the `deploy` role is limited to. `BY` is the token, or the person, that granted the rule. Without rules: `No rules: nobody can sign in. Grant access with: shipwick access grant ada@example.com --role deploy`.

On an agent without a provider, a line under the list says that no rule applies yet: `Signing in is not configured on this agent, so no rule applies yet: set SHIPWICK_OIDC_ISSUER, SHIPWICK_OIDC_CLIENT_ID and SHIPWICK_OIDC_CLIENT_SECRET in /opt/shipwick/.env.`

### access revoke

Remove a rule. It is named as it was granted.

```text
$ shipwick access revoke group:backend
✓ Revoked the rule for group:backend
Whoever signed in through it is signed out with their next request, unless another rule gives them the same.
```

A session rests on what the rules gave the person when they signed in, and every request asks the rules again: revoke the rule, or change what it gives, and the sessions that rested on it end with their next request, not when they expire. There is no confirmation. An unknown rule: `there is no rule for group:backend`, then `List the rules with: shipwick access ls`.

### access sessions

List who is signed in right now, as what, and until when.

```text
$ shipwick access sessions
WHO               ROLE     APPLICATIONS   SIGNED IN   ENDS         LAST USED
ada@example.com   deploy   my-api         2h ago      in 8 hours   1m ago
```

`ENDS` is when the session's ten hours are over; a session is not extended by use. `LAST USED` reads `never` until the first request. With none: `Nobody is signed in.`

### access signout

End every session of a person.

```text
$ shipwick access signout ada@example.com
✓ Signed ada@example.com out of 2 sessions
```

This signs the person out; it does not keep them out. While a rule covers them and the provider lets them in, they can sign in again. To keep someone out, disable the account at the provider, or revoke the rule with [`access revoke`](#access-revoke). A person without a session: `ada@example.com was not signed in.` Something that is not one address: `"ada" is not an e-mail address; use one like ada@example.com`.

Since 0.7 the person is named as [`access sessions`](#access-sessions) lists them. An address is brought to lowercase, as the agent keeps it. Where the agent names people by another claim, the name is sent as it was typed, since capitals tell two people apart there; a leading `name:` is accepted and dropped. A group or a domain is refused: `group:backend is not a person: sessions are ended for one person at a time, as shipwick access sessions lists them`.

An agent older than 0.6 has no sign-in, and every `access` command says so: `the agent is older than this shipwick and has no sign-in: it accepts tokens only`, then `Compare versions with: shipwick server status`.

## secret

Manage the secrets kept on the server: values for `${NAME}` in the `env` values and the `proxy.basic_auth` passwords of a `deploy.yaml`, stored once so that no laptop or pipeline has to hold them. The agent fills them in when a deployment is recorded; see [Placeholders](#placeholders).

```text
shipwick secret set <NAME> [flags]
shipwick secret ls
shipwick secret rm <NAME> [flags]
```

### secret set

Store a value, creating or replacing it. The value is never an argument: arguments leak through `ps` and shell history.

| Flag | |
|---|---|
| `--from-file <path>` | Read the value from this file instead of standard input |

```bash
shipwick secret set DATABASE_PASSWORD                             # asked without echo
printf '%s' "$DATABASE_PASSWORD" | shipwick secret set DATABASE_PASSWORD
shipwick secret set TLS_KEY --from-file key.pem
```

In a terminal the value is asked for without echo; outside one it is read from standard input, and with nothing there the command says how to pipe it in. Prints `✓ Stored secret DATABASE_PASSWORD` and a line saying that `${DATABASE_PASSWORD}` is filled in from the next deployment on. Names are environment variable names, letters, digits and underscores not starting with a digit, at most 64 characters; a value is at most 64 KB and not empty. The value is stored encrypted, like `env` values, and is never returned by the API. Needs the `admin` role.

### secret ls

List the secrets on the server: names and dates, never values.

```text
$ shipwick secret ls
NAME               CREATED  UPDATED
DATABASE_PASSWORD  3d ago   2h ago
STRIPE_KEY         3d ago   3d ago
```

Without any: `No secrets on the server. Store one with: shipwick secret set DATABASE_PASSWORD`. Needs the `read` role.

### secret rm

Remove a secret.

| Flag | |
|---|---|
| `-y`, `--yes` | Do not ask for confirmation |

Prints `✓ Removed secret DATABASE_PASSWORD`. Deployments already made keep the value they were started with; the next `deploy` whose `env` refers to the name is refused with the command to store it again. Needs the `admin` role.

## registry

Store the credentials the server pulls private images with. Since 0.5.

```text
shipwick registry login <registry> --username <name> [flags]
shipwick registry ls
shipwick registry logout <registry>
```

An image in a private registry needs a credential on the server. `registry login` hands one to the agent, which checks it against the registry, keeps it encrypted like a secret and uses it for every image it pulls from there: deployments, rollbacks, jobs. Nobody reads the password back. Use a token that may only read: the server pulls, it never pushes. See [Pull from private registries](/docs/tasks/private-registries).

### registry login

Store the credential for a registry, creating or replacing it. The registry is named as image references name it: `ghcr.io`, `registry.example.com:5000`, `docker.io` for Docker Hub.

| Flag | |
|---|---|
| `-u`, `--username <name>` | The account, or what the registry wants in its place for a token. Required |
| `--password-stdin` | Read the password from standard input even in a terminal |

```bash
shipwick registry login ghcr.io --username octocat                               # asked without echo
printf '%s' "$GHCR_TOKEN" | shipwick registry login ghcr.io --username octocat
```

```text
Password or token for octocat at ghcr.io:
✓ Logged in to ghcr.io as octocat
  The server pulls images from ghcr.io with this credential from now on.
```

The password or token is never an argument: arguments leak through `ps` and shell history. In a terminal it is asked for without echo; otherwise it is read from standard input, and with nothing there the command says how to pipe it in. It is at most 16 KB. The agent checks the credential against the registry before it stores it, so a mistyped token is refused here and not by the next deployment; see `REGISTRY_LOGIN_FAILED` under [Error messages](#error-messages). Needs the `admin` role.

### registry ls

List the registries the server has a credential for: never passwords. `list` is an alias.

```text
$ shipwick registry ls
REGISTRY   USERNAME   UPDATED
ghcr.io    octocat    3d ago
```

Without any: `No registry credentials on the server. Store one with: shipwick registry login ghcr.io --username <name>`. Needs the `read` role.

### registry logout

Remove a registry's credential. Prints `✓ Logged out of ghcr.io`. Images already on the server stay and running applications are not affected; the server pulls from that registry without the credential from then on. A registry without a stored credential: `no credential is stored for ghcr.io`, then `List them with: shipwick registry ls`. Needs the `admin` role.

## cert

Serve a hostname with a certificate of your own. Since 0.5.

```text
shipwick cert set <hostname> --cert <file> --key <file>
shipwick cert ls
shipwick cert rm <hostname> [flags]
```

Certificates are obtained and renewed by the server on its own; nothing here is needed for that. These commands are for a hostname whose certificate comes from somewhere else: a corporate authority, a wildcard bought for the whole domain.

A certificate belongs to the server, not to one application. Every hostname it covers, of any application, is served with it; the server asks no authority for those hostnames and does not wait for their DNS. Its key is encrypted at rest like secrets are, and nobody reads it back. Shipwick does not renew it: `cert ls` shows when it expires, and `cert set` replaces it. See [Use a certificate of your own](/docs/tasks/certificates).

### cert set

Store a certificate and its key for a hostname, or replace the ones stored.

| Flag | |
|---|---|
| `--cert <file>` | The certificate chain in PEM: the hostname's certificate first, then the intermediates. Required |
| `--key <file>` | The private key in PEM, without a passphrase. Required |

```bash
shipwick cert set example.com --cert fullchain.pem --key privkey.pem
shipwick cert set '*.example.com' --cert wildcard.pem --key wildcard.key
```

```text
✓ Stored the certificate for example.com
Issuer    Let's Encrypt E7
Expires   2027-01-15
Covers    example.com, www.example.com
  The hostnames it covers are served with it from now on. It is not renewed for you: replace it before it expires with the same command.
```

- The two files are read and sent as they are; each is at most 64 KB. The server checks that they belong together, that the certificate covers the hostname and that it has not expired, and refuses them otherwise with a sentence that says why: `INVALID_CERTIFICATE` under [Error messages](#error-messages). The key is never printed.
- A wildcard certificate is stored under the wildcard. It covers every name one label below the domain, and lets `"*.example.com"` be used as a `domain` or an alias in `deploy.yaml`. Quote the wildcard, or the shell expands it.

Needs the `admin` role.

### cert ls

List the certificates you supplied: issuer, expiry and what they cover. Never a key. `list` is an alias.

```text
$ shipwick cert ls
HOSTNAME        ISSUER             EXPIRES                   COVERS
example.com     Let's Encrypt E7   2026-10-24 (in 21 days)   example.com, www.example.com
*.example.org   Example CA         2027-01-15                *.example.org
```

`EXPIRES` is the certificate's last day, with how far off it is once that is less than 30 days: `(in 21 days)`, `(today)`, `(expired)`. Without any: `No certificates of your own on the server; it obtains one for every hostname itself.`, with the command to supply one. Needs the `read` role.

### cert rm

Remove the certificate stored under a hostname. `remove` is an alias.

| Flag | |
|---|---|
| `-y`, `--yes` | Do not ask for confirmation |

In a terminal, `rm` asks `Remove the certificate for example.com? The server will obtain its own for the hostnames it covers. [y/N]`; outside one it refuses without `--yes`. Prints `✓ Removed the certificate for example.com`. The hostnames it covered go back to certificates the server obtains itself, which needs their DNS to point at the server. A wildcard hostname in a `deploy.yaml` is no longer served unless the agent has `SHIPWICK_CLOUDFLARE_API_TOKEN`. An unknown hostname: `there is no certificate stored under example.com`, then `List them with: shipwick cert ls`. Needs the `admin` role.

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
✓ Upgraded shipwick v0.3.1 → v0.8.0
  /usr/local/bin/shipwick
  Release v0.8.0 is signed by the release workflow of github.com/shipwick/shipwick (verified with cosign).

The server runs v0.3.1; v0.8.0 is available. On the server run:
  curl -fsSL https://get.shipwick.com | sh
```

How the binary is replaced:

- The latest release, never a pre-release, is looked up on GitHub. The release's `checksums.txt` is downloaded, then the binary for this operating system and architecture (`shipwick_linux_amd64`, `shipwick_windows_amd64.exe`, and so on; since 0.7 `shipwick_windows_arm64.exe` on Windows on Arm, picked by the machine's architecture also when the `shipwick` that runs is the x64 build) is written next to the running one as `.shipwick-new`, its SHA-256 is compared with the published checksum, and only then is it renamed over the old binary, with the old binary's permissions. A mismatch is refused, `<asset> does not match the checksum published with release <tag>; nothing was changed`, and so is a release without a binary for this platform. On Windows, where a running executable cannot be deleted, the old binary is moved aside as `shipwick.old.exe` and removed the next time `shipwick` runs.
- **The release's signature** (since 0.8). From 0.8.0 on, a release's `checksums.txt` is signed by the workflow that published it; the signature is a file of the release, `checksums.txt.sigstore.json`. With [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) 2.4 or later on this machine, the command verifies the checksums against it before it looks anything up in them: `cosign verify-blob`, run as a program with arguments, with the release workflow of `github.com/shipwick/shipwick` at that tag as the identity the certificate must name. The third line of the output says what became of it:

  | Situation | Line |
  |---|---|
  | The signature verified | `Release v0.8.0 is signed by the release workflow of github.com/shipwick/shipwick (verified with cosign).` |
  | No cosign on this machine | `The release's signature was not checked: cosign is not installed on this machine.` The upgrade goes by the checksums, as before |

  A signature that is not the workflow's stops the upgrade before the binary is downloaded: `the signature of release v0.8.0's checksums did not verify as one made by the release workflow of github.com/shipwick/shipwick for v0.8.0; nothing was changed`, followed by cosign's last line and `cosign 2.4 or later reads this signature; an older one fails here whatever the file`. With cosign installed, a release from 0.8.0 on that has no signature is refused: `release v0.8.0 has no signature (checksums.txt.sigstore.json), and every release since 0.8.0 has one; nothing was changed`. Nothing installs cosign for you, and nothing needs it. See [Verify a release](/docs/tasks/verify-a-release).
- **Homebrew and winget.** A binary under Homebrew's Cellar or winget's Packages directory is recognized by its path and left to the package manager. The command prints `shipwick v0.3.1 was installed with Homebrew; v0.8.0 is available.` followed by `Upgrade with: brew upgrade shipwick`, or the same with `winget upgrade Shipwick.Shipwick`, and changes nothing.
- **Already current:** `shipwick v0.8.0 is up to date.` A build without a release version: `This shipwick is a development build (dev); the latest release is v0.8.0.` Neither changes anything.
- **`--check`** prints `shipwick v0.3.1 is installed; v0.8.0 is available.` and `Upgrade with: shipwick upgrade`, and changes nothing.
- **Where it refuses.** A directory it cannot write to: `cannot write to /usr/local/bin: permission denied`, then `Run it as root: sudo shipwick upgrade` or the installer line `curl -fsSL https://get.shipwick.com | sh -s -- --cli`; on Windows, the advice is an administrator prompt or downloading the `.exe` from the releases page. Nothing is downloaded before the staging file could be created.

The server is not upgraded by this command: the installer does that, on the server, with access to Docker. After the binary step, `upgrade` asks the configured agent's health endpoint, which needs no token, and prints one of:

| Situation | Line |
|---|---|
| The server is behind | `The server runs v0.3.1; v0.8.0 is available. On the server run:` and the installer command |
| The server is current | `The server runs v0.8.0, the latest release.` |
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
| The agent cannot be reached at a loopback address, on the server itself | Instead of the tunnel, which leads nowhere there: `The agent on this server publishes no port. Give it a hostname (SHIPWICK_AGENT_DOMAIN in /opt/shipwick/.env, then run the installer again), or see "Reach the API without a hostname" in the handbook, Installation.` The server is recognized by the installer's `.env` file; see [Reach the API without a hostname](/docs/tasks/access-without-a-hostname) |
| `UNAUTHORIZED` | `The agent rejected the API token.` Set `SHIPWICK_AGENT_TOKEN`, or run `shipwick login` |
| `FORBIDDEN` | `This token may not do that: it has the read role.` Then `Use a token with the deploy role, or create one with: shipwick token create <name> --role deploy`. The roles come from the agent's answer; an agent that sends none is quoted: `This token may not do that: <message>` |
| `TOKEN_EXPIRED` | `The token ci expired on 2026-10-01 at 15:04.` Then, since 0.7, `An admin lets it work again with: shipwick token update ci --expires 90d`, `Or creates a new one with: shipwick token create` and `Then set SHIPWICK_AGENT_TOKEN to it, or save it with: shipwick login`. The name and the time, shown in local time, come from the agent's answer; without them the first sentence is `The API token has expired.`, followed by `An admin creates a new one with: shipwick token create`. Since 0.6 |
| `TOKEN_LIMITED` | `This token may not do that: it is limited to my-api, web.` For an operation on another application: `It can read blog, not change it. Use a token that covers it, or create one with: shipwick token create <name> --role deploy --app blog`. For one that is not about a single application: `This operation is not about one application. Use a deploy token without --app, or an admin token.` An answer that names no applications is quoted: `This token may not do that: <message>`. Since 0.6 |
| `SESSION_EXPIRED`, `SESSION_ENDED` | `The session this command ran with no longer works: <the agent's message>.` Then `The CLI and CI are meant to be given a token; an admin creates one with: shipwick token create`. A session is the dashboard's; this is seen only by a command that was handed one in place of a token. Since 0.6 |
| `DEPLOYMENT_IN_PROGRESS` | `Another operation is already in progress for this application.` Watch it with `shipwick status` |
| `NOT_FOUND` | `The server does not know that application.` List what it runs with `shipwick ps`. When the agent says what was not found, such as a volume or a backup, its message is printed instead: `Error: <the agent's message>` |
| `NOT_DEPLOYED` | `This application has no successful deployment yet.` Deploy it with `shipwick deploy` |
| `NO_ROLLBACK_TARGET` | `There is no earlier successful deployment to go back to.` See the history with `shipwick status` |
| `APPLICATION_RUNNING` | `The application is running, and a restore replaces the files under it.` Stop it first with `shipwick stop` |
| `JOB_ALREADY_RUNNING` | `This job is still running from an earlier start.` See it with `shipwick jobs <app>` |
| `STATIC_APPLICATION` | `This application is a folder served by the proxy: it has no containers, so there are no logs, metrics or commands to run.` See what it serves with `shipwick status` |
| `VOLUME_IN_USE` | `Error: <the agent's message>`, then `Delete it with: shipwick delete <app>` |
| `RATE_LIMITED` | `Too many failed attempts from this address; try again in a minute.` |
| `DISK_FULL` | `Error: <the agent's message>.`, then `See how full the disk is with: shipwick server status`. The agent answers `507` with this code when the server's disk has no room for a deployment, an uploaded folder or an image, and its message says what to free: `The server's disk is full (create deployment: database or disk is full (13)). Nothing was changed. Free space on the server — docker system df shows what takes it, docker image prune -a removes images nothing uses — and try again`. The same command works once there is room. See [The disk is full](/docs/tasks/when-things-break#the-disk-is-full). Since 0.8 |
| `RUNTIME_UNAVAILABLE` | `Error: <the agent's message>`: `Docker does not answer on the server. Applications that are running keep running; look at the daemon there with: systemctl status docker. The cause: no answer within 15s`. Since 0.8 the agent answers `503` with this code, after 15 seconds at most, for a Docker daemon that took a question and never answered it, and for one that is not running, which used to be a `500`. See [Docker does not answer](/docs/tasks/when-things-break#docker-does-not-answer) |
| `APPLICATION_CALLER` | `The agent does not answer the containers of applications: whatever runs in one could otherwise try tokens against it.` Then `Run the command outside the container, or reach the server at its hostname: shipwick login --url https://<SHIPWICK_AGENT_DOMAIN>`. The agent answers `403` with this code to a request that comes from an application's container, before its token is looked at. See [Who can reach the API](/docs/security#who-can-reach-the-api). Since 0.8 |
| `IMAGE_INCOMPLETE` | `The server no longer has the layers that were left out of the image.` Send it again with `shipwick deploy`. `deploy` itself answers this code by sending the whole image |
| `REGISTRY_LOGIN_FAILED` | `Error: <the agent's message>`, then `Nothing was stored. Check the username and the token, and that the token may read images; then log in again.` when the registry refused the credential, or `Nothing was stored. Check the registry's name, and that the server can reach it.` when it could not be asked |
| `KEY_ROTATION_PENDING` | `The key was already rotated, and the agent has not been restarted with the new one.` Put the key from the file the message names on the server into `/opt/shipwick/.env` as `SHIPWICK_ENCRYPTION_KEY`, restart the agent, then rotate again |
| `INVALID_CERTIFICATE` | `The server refused the certificate: <the agent's reason>.` Then `--cert is the chain in PEM, the hostname's own certificate first (fullchain.pem); --key is its private key (privkey.pem).` |
| `TRAFFIC_UNAVAILABLE` | `This server records no traffic: the agent reads the access log of the Caddy container in its own compose project, and there is none.` See how the proxy is doing with `shipwick server status` |
| `BACKUP_BUSY` | `That backup is in use: it is still being taken, verified or restored.` See where it stands with `shipwick backups <app>` |
| `BACKUP_NOT_USABLE` | `Error: <the agent's message>`, then `See which backups succeeded with: shipwick backups <app>` |
| `NO_VOLUMES` | `This application has no volumes, so there is nothing to back up.` Give it some under `volumes` in `deploy.yaml` |
| `BACKUPS_NOT_ENCRYPTED` | `Error: <the agent's message>`, then `Set SHIPWICK_BACKUP_PASSPHRASE in /opt/shipwick/.env on the server, then: cd /opt/shipwick && docker compose up -d` |
| `IMPORT_IN_PROGRESS` | `An import is already running on this server; it takes one at a time.` Follow it with `shipwick import --status` |
| `INVALID_EXPORT` | `Error: <the agent's message>`, then `What the import had finished before it stopped is in place: shipwick import --status. An export is written with: shipwick export` |
| `EXPORT_IN_PROGRESS` | `The server is writing an export already.` See it with `shipwick export --list` |
| `STANDBY_NOT_CONFIGURED` | `This server has no bucket to fetch exports from.` Set the `SHIPWICK_BACKUP_S3_*` variables and `SHIPWICK_BACKUP_PASSPHRASE` of the first server, and `SHIPWICK_STANDBY_SCHEDULE`, in `/opt/shipwick/.env` on this server; or import a file with `shipwick import <file> --stopped` |
| `PROMOTION_IN_PROGRESS` | `This server is being promoted; nothing is imported into it meanwhile.` Follow the promotion with `shipwick standby promote`. `standby promote` itself answers this code by following the promotion that is under way. Since 0.6 |
| `FOREIGN_BUCKET` | `Error: <the agent's message>`: the bucket holds the backups of another installation under the agent's prefix, and [`backups adopt`](#backups-adopt) records nothing from it. Since 0.6 |
| `ENDPOINT_NOT_FOUND` | `The agent does not know this operation — it is probably older than this shipwick.` Compare versions with `shipwick server status` |
| `INVALID_CONFIG` | The field-by-field validation report. A hostname or a published port that another application holds is reported the same way, under the line that claims it: `aliases[1]`, `publish[0].host`; so is an `env` value whose `${NAME}` is neither set here nor stored on the server: `env.DATABASE_URL`, with `shipwick secret set NAME` as what is expected. Since 0.5 a hostname is taken per `path`: two applications may serve one hostname under different paths, and the same path twice is refused. Since 0.7 an `env` value or a basic-auth password that is `"********"`, the mask [`config`](#config) writes, is reported the same way. Since 0.8, when [`deploy`](#deploy) accepted the file and the agent refuses a key it does not know, the report is followed by what that means: the server is older than `deploy.yaml`, and the installer command that upgrades it |
| Any other API error | `Error: <message>` |

The codes of the dashboard's sign-in (`SIGN_IN_NOT_CONFIGURED`, `SIGN_IN_FAILED`, `SIGN_IN_UNAVAILABLE` and `ACCESS_NOT_GRANTED`) answer requests that only the dashboard makes; no command of `shipwick` receives them.

The error codes are described in the [REST API reference](/docs/reference/api#error-codes).
