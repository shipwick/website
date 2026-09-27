---
title: Your first deployment
description: Let shipwick init write a Dockerfile and a deploy.yaml, deploy with the image built on your machine, watch a rolling update, and see what a failed deployment looks like.
---

# Your first deployment

This page takes one application from nothing to running on your server, then updates it, then breaks it on purpose. It assumes a server with [Shipwick installed](/docs/getting-started/install) and `shipwick` [installed and logged in](/docs/getting-started/install-cli).

You need one of two things: a project that `shipwick init` can write a Dockerfile for, or a Dockerfile of your own, in which case the image is built on your machine and sent to the server, with no registry in between; or an image the server can pull, from a public registry or a [private one](/docs/tasks/private-registries). The examples use an application that listens on port 8080 and answers `GET /health`.

## Create deploy.yaml

In your application's repository:

```bash
shipwick init
```

`init` looks at the directory first. A Nuxt or Next application, a Node server (Express, Fastify, Koa, Hono, or a `start` script), a .NET project, a Go program or a Python application gets a multi-stage `Dockerfile` on a small runtime image with a non-root user and the port exposed, a `.dockerignore`, and a `deploy.yaml` with `build: .`:

```text
✓ Recognised a Node application
✓ Wrote Dockerfile, .dockerignore and deploy.yaml

Review them, then run: shipwick deploy
```

A `Dockerfile` or `.dockerignore` you already have is kept and said so: `Kept the existing Dockerfile; build: . will use it`. A folder of static files, or a Vite or Astro project that builds one, gets `static: dist/` and no Dockerfile, since the proxy serves the files itself; a static site needs `--domain`, because the folder is served at that hostname and nothing else describes it. Nothing recognised: `init` asks for a name (the default is the directory name), an image, a port and a domain.

Two flags skip the detection. `--image` writes a `deploy.yaml` for an image that exists already and never prompts, which suits scripts; `--static <dir>` names the folder to serve:

```bash
shipwick init --name my-api --image ghcr.io/company/my-api:1.4.1 --port 8080 --domain api.example.com
shipwick init --static dist --domain example.com
```

`init` refuses to overwrite an existing `deploy.yaml` unless you pass `--force`; a Dockerfile is never overwritten. In a directory without a `deploy.yaml`, `shipwick deploy` runs `init` first when a terminal is attached, so the first deployment is one command.

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

For this walk-through, set `domain: api.example.com`, `replicas: 2`, and uncomment the `health` block with `path: /health`. Two replicas make the rolling update visible, and a health check is what lets Shipwick tell a working version from a broken one. Without a `health` block, a deployment only verifies that replicas start and stay up for a few seconds. For a Nuxt or Next application `init` writes `health: {path: /}` live, since those answer their root. Leave the rest commented out; migrations, scheduled jobs and the other options have pages of their own.

The DNS record for `domain` should point at the server: an `A` record with the server's address, DNS only, not proxied. If it does not yet, the deployment still succeeds and tells you which record to create, as shown below. Every field is described in the [deploy.yaml reference](/docs/reference/deploy-yaml).

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

With `build: .`, `deploy` runs `docker build` on your machine, for the server's architecture, tags the result `shipwick.local/<name>:<timestamp>`, sends it to the agent and deploys it. Docker must be installed where you run the command; the server never builds. The build's own output is shown dimmed. On a first deployment there is nothing to replace, so all replicas start together:

```text
Deploying my-api...

✓ Validated deploy.yaml
$ docker build --platform linux/amd64 -f Dockerfile -t shipwick.local/my-api:20260927-153000-a1b2 .
✓ Built shipwick.local/my-api:20260927-153000-a1b2 for linux/amd64
✓ Sent image to the server (68.8 MB)
✓ Using image shipwick.local/my-api:20260927-153000-a1b2, sent from a developer's machine
✓ Started 2 containers
✓ 2 replicas passed health checks
✓ Routed https://api.example.com to 2 replicas
✓ Deployment successful

my-api 20260927-153000-a1b2  deployed in 8.2s
2/2 replicas healthy
https://api.example.com

Next:
  shipwick logs -f my-api      follow the logs
  shipwick status my-api       replicas, health, history
```

<div class="wick-note">
<img src="/img/wick-check.svg" alt="Wick, the Shipwick flame, with a green check: the deployment succeeded" width="64" height="64">

<p>With <code>image:</code> the build lines are one <code>✓ Pulled image ghcr.io/company/my-api:1.4.1</code>. Either way a summary follows: the version, how long the deployment took, how many replicas are healthy, and the URL; a first deployment ends with the two commands to run next. Caddy obtains the certificate for the domain on the first request.</p>

</div>

Pressing Ctrl+C while `deploy` waits stops the waiting, not the deployment.

`shipwick.local` is a host that does not exist, on purpose: nothing can pull such an image, so it is either on the server or it is not. The whole image is sent each time.

## When the domain is not ready

Deploying before the DNS record exists is fine. The deployment succeeds, and instead of `Routed https://…` it prints the record to create:

```text
! Routing https://api.example.com is waiting for DNS: does not resolve yet; add an A record: api.example.com → 203.0.113.10 (DNS only, not proxied). It is served, and its certificate obtained, once the record points at this server
```

When the server has an IPv6 address, an `AAAA` record is named too. A record that points at another server is told to change; one that points at Cloudflare's proxy is told to turn the proxy off for the record (`DNS only`), because the record itself is right and the orange cloud is what breaks the certificate. The agent checks again every 10 seconds and starts serving the hostname as soon as the record is right. See [DNS first](/docs/concepts/routing-and-https#dns-first) for why.

When something is not right — no certificate arrives, a domain shows someone else's page — `shipwick doctor` checks the whole path in one screen, each line with what to do about it, and exits non-zero when something is broken:

```bash
shipwick doctor
```

```text
✓ shipwick v0.4.0, the latest release
✓ Agent https://agent.example.com runs v0.4.0, the latest release
✓ Token laptop (admin)
✓ Docker 29.8.0 on the server
✓ Proxy serving 2 domains
✓ agent.example.com → 203.0.113.10
✓ Port 80 open on 203.0.113.10
✗ Port 443 is not reachable on 203.0.113.10: open it in the server's firewall; certificates are issued and renewed through ports 80 and 443
✗ api.example.com → 104.16.0.1, which is not the server (203.0.113.10). Point the record at the server; if it is proxied through a CDN, turn the proxy off (DNS only)
✓ https://api.example.com/ answers HTTP 200

2 problems found.
```

Hostnames are resolved through public resolvers, as the agent does; the server's address is the one the agent's own hostname resolves to, so through an SSH tunnel the ports and the records' targets are not checked.

## Look at what is running

```bash
shipwick status     # version, CPU and memory, replicas, recent deployments, supervisor events
shipwick ps         # every application on the server
shipwick logs -f    # follow the logs of all replicas
shipwick open       # open https://api.example.com in the browser
```

Run in the directory that holds `deploy.yaml`, these commands act on the application named in it. Elsewhere, name the application: `shipwick status my-api`. More in [Inspect applications and read logs](/docs/tasks/inspect-and-logs).

The same is in the [dashboard](/docs/tasks/dashboard), if the server has one: the application's page follows a deployment live, whether it was started from `shipwick`, from CI or from the dashboard itself, and its history shows which token made each deployment. An application with `build:` says there that its image is built by `shipwick deploy`.

## Deploy a new version

Change the code and deploy again. With `build: .` every deployment is a new build, tagged with the time it was built; with `image:` you change the tag in `deploy.yaml` first:

```bash
shipwick deploy
```

```text
Deploying my-api...

✓ Validated deploy.yaml
✓ Built shipwick.local/my-api:20260927-160512-c3d4 for linux/amd64
✓ Sent image to the server (68.8 MB)
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

This is a rolling update. Replicas are replaced one at a time. Each new replica must pass its health check before it joins the rotation, and the old replica it replaces leaves the rotation before it is stopped. There is never more than one container above the desired count, and serving capacity never drops below it.

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

A built frontend — the `dist/` of a Vite or Nuxt site, the `out/` of a Next export, any folder of HTML, CSS and JavaScript — needs no container. `shipwick init --domain example.com` in such a project writes:

```yaml
name: web
# A folder served by the proxy as it is: no image, no container, no port.
# It is what `npm run build` produces; run that before `shipwick deploy`.
static: dist/
domain: example.com
```

`shipwick deploy` uploads the folder as it is and the proxy serves it:

```text
✓ Validated deploy.yaml
✓ Uploaded dist/: 42 files, 3.1 MB
✓ Received 42 files (3.1 MB)
✓ Copied 42 files into the proxy
✓ Found index.html
✓ Routed https://example.com to the uploaded files
✓ Deployment successful
```

The folder must hold an `index.html`; a request for a path that names no file is a `404`. The version of a static deployment is the first twelve characters of the folder's digest, so the same files make the same version on any machine, and a rollback re-uses the kept folder without an upload. See [`static`](/docs/reference/deploy-yaml#static) in the reference.

## What's next

- [Deploy from CI](/docs/tasks/deploy-from-ci) with the GitHub Action or `shipwick deploy --image`, and a `deploy` token.
- [Roll back](/docs/tasks/roll-back) to an earlier version.
- [Run scheduled jobs and one-off commands](/docs/tasks/jobs), and migrations before a deployment.
- [Run a database](/docs/tasks/stateful-applications) next to it, and describe both in one `shipwick.yaml`; see [Several applications](/docs/reference/deploy-yaml#several-applications-shipwick-yaml).
- Concepts: [Deployments](/docs/concepts/deployments), [Health and supervision](/docs/concepts/health-and-supervision), [Routing and HTTPS](/docs/concepts/routing-and-https).
- Reference: [deploy.yaml](/docs/reference/deploy-yaml), [shipwick](/docs/reference/cli).
