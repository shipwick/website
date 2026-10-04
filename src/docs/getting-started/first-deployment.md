---
title: Your first deployment
description: Let shipwick init write a Dockerfile and a deploy.yaml, deploy with the image built on your machine, watch a rolling update that sends only the layers that changed, and see what a failed deployment looks like.
---

# Your first deployment

This page takes one application from nothing to running on your server, then updates it, then breaks it on purpose. The whole of it is two commands, in your project's directory:

```bash
shipwick init      # writes a Dockerfile and a deploy.yaml
shipwick deploy    # builds the image here, sends it to the server, runs it
```

## Before you begin

- `shipwick` is [installed on your laptop](/docs/getting-started/install-cli), and the server is [installed](/docs/getting-started/install). After `shipwick server install` you are logged in already; `shipwick doctor` confirms it.
- Docker runs on your laptop: the image is built there and sent to the server, with no registry in between.
- Your project is one `shipwick init` can write a Dockerfile for, or has a Dockerfile of its own.
- A hostname for the application, with a DNS record that points at the server. It can follow: a deployment made before the record exists succeeds and names the record to create.

Already have an image in a registry? Name it instead of building: `image: ghcr.io/company/my-api:1.4.2`. A [private registry](/docs/tasks/private-registries) needs `shipwick registry login` once.

The examples use an application that listens on port 8080 and answers `GET /health`.

## Create deploy.yaml

In your application's repository:

```bash
shipwick init
```

`init` looks at the directory first. A Nuxt or Next application, a SvelteKit application with `adapter-node`, a Remix application, an Astro application with the Node adapter, a Node server (Express, Fastify, Koa, Hono, or a `start` script), a .NET project, a Go program or a Python application gets a multi-stage `Dockerfile` on a small runtime image with a non-root user and the port exposed, a `.dockerignore`, and a `deploy.yaml` with `build: .`:

```text
✓ Recognised a Node.js application
✓ Wrote Dockerfile, .dockerignore and deploy.yaml

Review them, then run: shipwick deploy
```

The Dockerfile installs from the lock file it finds: npm, pnpm or yarn for a Node project, `uv sync --frozen` for a Python project with a `uv.lock`. A Node project without a lock file gets `npm install` and a warning:

```text
! no lock file: the Dockerfile installs with npm install, and the build is not reproducible until package-lock.json is committed
```

A `Dockerfile` or `.dockerignore` you already have is kept and said so: `Kept the existing Dockerfile; build: . will use it`. A folder of static files — an `index.html` at the root or in `dist/`, `build/`, `out/` or `public/` — and a project whose build writes one — Vite, Astro without an adapter, SvelteKit with `adapter-static`, Next with `output: "export"` — gets `static` and no Dockerfile, since the proxy serves the files itself; see [A folder instead of a container](#a-folder-instead-of-a-container). A static site needs `--domain`, because the folder is served at that hostname and nothing else describes it. A SvelteKit project with neither adapter is refused, with the two adapters to choose from. Nothing recognised: `init` asks for a name (the default is the directory name), an image, a port and a domain.

SvelteKit, Remix, Astro with the Node adapter, the exported Next site and uv are recognised since 0.5.

Two flags skip the detection. `--image` writes a `deploy.yaml` for an image that exists already and never prompts, which suits scripts; `--static <dir>` names the folder to serve:

```bash
shipwick init --name my-api --image ghcr.io/company/my-api:1.4.1 --port 8080 --domain api.example.com
shipwick init --static dist --domain example.com
```

`init` refuses to overwrite an existing `deploy.yaml` unless you pass `--force`; a Dockerfile is never overwritten. In a directory without a `deploy.yaml`, `shipwick deploy` runs `init` first when a terminal is attached, so the first deployment is one command. In a directory that has a `shipwick.yaml` instead, `init` adds an entry to that file; see [`shipwick init`](/docs/reference/cli#init).

## Review deploy.yaml

The file contains what `init` knew as live settings and everything else as commented-out examples:

```yaml
name: my-api

# The image is built on your machine by `shipwick deploy`, from the
# Dockerfile next to this file, and sent to the server. No registry needed.
build: .

# Run something other than the image's default. A string is one argument;
# use a list for several: nothing is split on spaces.
# entrypoint: ["dotnet"]
# command: ["App.dll", "--urls", "http://0.0.0.0:8080"]
# user: "1000:1000"

# Node as a container's first process ignores SIGTERM unless the application
# handles it, and is killed when its grace period ends. An init process in
# front of it passes the signal on: a replaced replica stops at once.
init: true

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
# Add a route that answers 200 on /health, then uncomment.
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

Only `name` and `image`, or `build` in its place, are required. With `build: .`, every deployment builds the image afresh and its version is the build's timestamp; with `image:`, the tag is the version, so pin a version tag rather than `latest`. A value that must not be in the file, such as a password, is written as `${NAME}` and filled in when you deploy: by `shipwick` from its environment or an `--env-file`, or by the server from a secret stored once with `shipwick secret set NAME`.

For this walk-through, set `domain: api.example.com`, `replicas: 2`, and uncomment the `health` block with `path: /health`. Two replicas make the rolling update visible, and a health check is what lets Shipwick tell a working version from a broken one. Without a `health` block, a deployment only verifies that replicas start and stay up for a few seconds. For a Nuxt, Next, SvelteKit, Remix or Astro application `init` writes `health` with `path: /` live, since those answer their root. Leave the rest commented out; migrations, scheduled jobs and the other options have pages of their own. `init: true` is written, since 0.6, for a Node project whose Dockerfile `init` writes; see [An init process](/docs/concepts/deployments#an-init-process).

The DNS record for `domain` should point at the server: an `A` record with the server's address, DNS only, not proxied, unless the agent has a Cloudflare API token; see [Put Cloudflare in front of the server](/docs/tasks/cloudflare). If it does not yet, the deployment still succeeds and tells you which record to create, as shown below. Every field is described in the [deploy.yaml reference](/docs/reference/deploy-yaml).

## Validate

`validate` checks the file offline and shows how it will be applied, defaults included. Only what the file sets gets a line, so a file with more in it — hostnames, volumes, published ports, a pre-deploy command, jobs — shows more:

```bash
shipwick validate
```

```text
✓ deploy.yaml is valid

Name           my-api
Build          ./ (Dockerfile)
Replicas       2
Port           8080
Domain         api.example.com
Health check   GET /health every 10s (timeout 3s, 3 retries)
Resources      unlimited CPU, unlimited memory
Restart        always
```

`validate` describes the build and does not run it. With `image:` the lines read `Image` and `Version` instead. Mistakes are reported all at once, by field:

```text
invalid deploy.yaml

port:
  invalid value 99999
  expected: a number between 1 and 65535

resources.memory:
  invalid value "abc"
  expected: 128mb, 512mb, 1gb, ...
```

`deploy` runs the same validation, and the agent validates again on its side.

## Deploy

```bash
shipwick deploy
```

With `build: .`, `deploy` runs `docker build` on your machine, for the server's architecture, tags the result `shipwick.local/<name>:<timestamp>`, sends it to the agent and deploys it. Docker must be installed where you run the command; the server never builds.

Before it builds, `deploy` has the agent validate the file, so that what only the server can know — a domain another application serves, a port already published, a secret that is not stored — is said before the build and the upload, not after them.

In a terminal the build is one line that moves, with the time and the last line `docker build` printed:

```text
… Building the image (12s) — #9 [build 4/6] RUN npm ci
```

Its whole output appears only when the build fails. `shipwick deploy --verbose` shows the command and every line as it is printed, dimmed, and so does a run whose output is not a terminal, such as a pipeline.

On a first deployment there is nothing to replace, so all replicas start together:

```text
Deploying my-api...

✓ Validated deploy.yaml
✓ Built shipwick.local/my-api:20260927-153000-a1b2 for linux/amd64
✓ Sent image to the server (57.9 MB)
✓ Using image shipwick.local/my-api:20260927-153000-a1b2, sent from a developer's machine
✓ Started 2 containers
✓ 2 replicas passed health checks
✓ Routed https://api.example.com to 2 replicas
✓ Deployment successful

my-api 20260927-153000-a1b2  deployed in 8.2s
2/2 replicas healthy
https://api.example.com

Next:
  shipwick logs -f my-api          follow the logs
  shipwick status my-api           replicas, health, history
  https://dashboard.example.com    the dashboard
```

<div class="wick-note">
<img src="/img/wick-check.svg" alt="Wick, the Shipwick flame, with a green check: the deployment succeeded" width="64" height="64">

<p>With <code>image:</code> the build lines are one <code>✓ Pulled image ghcr.io/company/my-api:1.4.1</code>. Either way a summary follows: the version, how long the deployment took, how many replicas are healthy, and the URL; a first deployment ends with the two commands to run next, and with the dashboard's address when the server has one. Caddy obtains the certificate for the domain on the first request.</p>

</div>

Pressing Ctrl+C while `deploy` waits stops the waiting, not the deployment.

`shipwick.local` is a host that does not exist, on purpose: nothing can pull such an image, so it is either on the server or it is not. The first deployment sends the whole image; later ones send only the layers the server does not have, as shown under [Deploy a new version](#deploy-a-new-version).

## When the domain is not ready

Deploying before the DNS record exists is fine. The deployment succeeds, and instead of `Routed https://…` it prints the record to create:

```text
! Routing https://api.example.com is waiting for DNS: does not resolve yet; add an A record: api.example.com → 203.0.113.10 (DNS only, not proxied). It is served, and its certificate obtained, once the record points at this server
```

When the server has an IPv6 address, an `AAAA` record is named too. A record that points at another server is told to change; one that points at Cloudflare's proxy is told to turn the proxy off for the record (`DNS only`) or to set `SHIPWICK_CLOUDFLARE_API_TOKEN` on the agent to keep it on. With that token Caddy obtains certificates through a DNS record, and a proxied hostname is served instead of held back; see [Put Cloudflare in front of the server](/docs/tasks/cloudflare). The agent checks again every 10 seconds and starts serving the hostname as soon as the record is right. See [DNS first](/docs/concepts/routing-and-https#dns-first) for why.

When something is not right — no certificate arrives, a domain shows someone else's page — `shipwick doctor` checks the whole path in one screen, each line with what to do about it, and exits non-zero when something is broken:

```bash
shipwick doctor
```

```text
✓ shipwick v0.7.0, the latest release
✓ Agent https://agent.example.com runs v0.7.0, the latest release
✓ Token laptop (admin)
✓ Docker 29.8.0 on the server
✓ Proxy serving 2 routes
✓ agent.example.com → 203.0.113.10
✓ Port 80 open on 203.0.113.10
✗ Port 443 is not reachable on 203.0.113.10: open it in the server's firewall; certificates are issued and renewed through ports 80 and 443
✗ api.example.com resolves to Cloudflare's proxy (104.16.0.1), not to the server: turn the proxy off for this record (DNS only), or set SHIPWICK_CLOUDFLARE_API_TOKEN on the agent to keep it on
✓ https://api.example.com/ answers HTTP 200

2 problems found.
```

Hostnames are resolved through public resolvers, as the agent does; the server's address is the one the agent's own hostname resolves to, so through an SSH tunnel the ports and the records' targets are not checked. `doctor` also prints the server's active [alerts](/docs/tasks/alerts-and-metrics), a disk that is filling up for one; a critical alert counts as a problem.

## Look at what is running

```bash
shipwick status     # version, CPU and memory, replicas, recent deployments, supervisor events
shipwick ps         # every application on the server
shipwick logs -f    # follow the logs of all replicas
shipwick open       # open https://api.example.com in the browser
```

Run in the directory that holds `deploy.yaml`, these commands act on the application named in it. Elsewhere, name the application: `shipwick status my-api`. More in [Inspect applications and read logs](/docs/tasks/inspect-and-logs).

The same is in the [dashboard](/docs/tasks/dashboard), if the server has one; `shipwick open --dashboard` opens it, and `shipwick server status` shows its address. Sign in with the API token: after `shipwick server install` it is `SHIPWICK_AGENT_TOKEN` in `/opt/shipwick/.env` on the server. The application's page opens with what is wrong, if anything is, and follows a deployment live, whether it was started from `shipwick`, from CI or from the dashboard itself; its history shows who made each deployment. An application with `build:` says there that its image is built by `shipwick deploy`.

## Deploy a new version

Change the code and deploy again. With `build: .` every deployment is a new build, tagged with the time it was built; with `image:` you change the tag in `deploy.yaml` first:

```bash
shipwick deploy
```

```text
Deploying my-api...

✓ Validated deploy.yaml
✓ Built shipwick.local/my-api:20260927-160512-c3d4 for linux/amd64
✓ Sent image to the server (22 KB; the server had the rest of 57.9 MB)
✓ Using image shipwick.local/my-api:20260927-160512-c3d4, sent from a developer's machine
✓ Started 1 container
✓ Replica 1 passed health checks
✓ Replica 1/2 is serving 20260927-160512-c3d4; its 20260927-153000-a1b2 predecessor is retired
✓ Replica 2 passed health checks
✓ Replica 2/2 is serving 20260927-160512-c3d4; its 20260927-153000-a1b2 predecessor is retired
✓ Routed https://api.example.com to 2 replicas
✓ Deployment successful

my-api 20260927-160512-c3d4  deployed in 15.0s
2/2 replicas healthy
https://api.example.com
```

Only the layers the server does not have were sent: the CLI asks the agent which of the image's layers it lacks and leaves the others out, so a change to your code costs the size of the layer that holds it, not of the base image beneath it. If that cannot be done, with an agent older than 0.5 for instance, the whole image is sent as before.

This is a rolling update. Replicas are replaced one at a time. Each new replica must pass its health check before it joins the rotation, and the old replica it replaces is sent `SIGTERM` only after that and gets a grace period to finish its requests. There is never more than one container above the desired count, and serving capacity never drops below it. The deployment is done when every new replica serves; it does not wait for the last replaced container to exit.

For a moment both versions serve side by side, so the two must be able to coexist. Database migrations, above all, must be backward compatible. [Deployments](/docs/concepts/deployments) explains the mechanism in full.

If `logs -f` was running, it ends when the old containers are replaced. Run it again to follow the new ones. The server keeps the image that runs and the one before it, the rollback target; older ones are removed.

## When a deployment fails

Suppose the next version cannot start, because it needs an environment variable nobody set. `deploy` tells you why it failed, and whether users were affected:

```text
✗ Deployment failed

  replica 1 exited with code 1 shortly after start

  Last output of replica 1:
  panic: DATABASE_URL is not set

my-api is still running 20260927-160512-c3d4; the failed deployment did not affect it.
```

`shipwick deploy` exits with status 1. The failed replica's last log lines are saved with the deployment, the new containers are removed, and the old version keeps serving.

What happens next depends on how far the rollout got:

- If the first new replica failed — the usual case — nothing of the old version was touched. The deployment is `FAILED`.
- If some old replicas had already been replaced, they are recreated from the previous deployment's stored configuration, verified, and given traffic again. The deployment is `ROLLED_BACK`, and the command reports `Deployment failed and was rolled back`.

A replica that never answers its health check fails the deployment the same way:

```text
✗ Deployment failed

  replica 1 did not become healthy within 30s: GET /health on port 8080: connection refused
```

A new replica has `start_period + interval × retries` to answer — 30 seconds by default. For an application that starts slowly, a JVM or one that migrates its database on boot, set `health.start_period`, up to 30 minutes: failed checks do not count during that time, and a running replica's failures are still noticed as quickly as before.

Every attempt, failed or not, is kept in the history that `shipwick status` shows, together with the name of the token that made it (`by` in the API and the dashboard). Only one deployment per application runs at a time; a second is refused rather than queued.

## A folder instead of a container

A built frontend — the `dist/` of a Vite or Nuxt site, the `out/` of a Next export, any folder of HTML, CSS and JavaScript — needs no container. `shipwick init --domain example.com` in a project built by Vite writes:

```yaml
name: web

# A folder served by the proxy as it is: no image, no container, no port.
# It is what `npm run build` produces; run that before `shipwick deploy`.
# A single-page application: a path that names no file gets index.html.
static: {dir: dist/, fallback: index.html}

# Served over HTTPS automatically.
domain: example.com
```

Vite alone builds one page and routes in the browser, so `init` writes the `fallback`: every path that names no file is answered with that page and status 200. A project that builds a file for every page, such as Astro, gets the plain `static: dist/`, and a path that names no file is a `404`.

`shipwick deploy` uploads the folder as it is, after the agent has validated the file, and the proxy serves it:

```text
✓ Validated deploy.yaml
✓ Uploaded dist/: 42 files, 3.1 MB
✓ Received 42 files (3.1 MB)
✓ Copied 42 files into the proxy
✓ Found index.html
✓ Routed https://example.com to the uploaded files
✓ Deployment successful
```

The folder must hold an `index.html`, and the `fallback` page when one is named. A first deployment of a folder ends with `shipwick open web` in place of the logs command, since a static application has no logs. The version of a static deployment is the first twelve characters of the folder's digest, so the same files make the same version on any machine, and a rollback re-uses the kept folder without an upload. See [`static`](/docs/reference/deploy-yaml#static) in the reference.

## What's next

- [Use the dashboard](/docs/tasks/dashboard): the same application in a browser.
- [Deploy from CI](/docs/tasks/deploy-from-ci) with the GitHub Action or `shipwick deploy --image`, and a `deploy` token [limited to this application](/docs/tasks/tokens).
- [Roll back](/docs/tasks/roll-back) to an earlier version.
- [Run scheduled jobs and one-off commands](/docs/tasks/jobs), and migrations before a deployment.
- [Run a database](/docs/tasks/stateful-applications) next to it, and describe both in one `shipwick.yaml`; see [Several applications](/docs/reference/deploy-yaml#several-applications-shipwick-yaml).
- Concepts: [Deployments](/docs/concepts/deployments), [Health and supervision](/docs/concepts/health-and-supervision), [Routing and HTTPS](/docs/concepts/routing-and-https).
- Reference: [deploy.yaml](/docs/reference/deploy-yaml), [shipwick](/docs/reference/cli).
