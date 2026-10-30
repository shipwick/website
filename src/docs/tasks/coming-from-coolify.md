---
title: Coming from Coolify
description: What each Coolify concept becomes in Shipwick - projects, environments and resources, the server and its proxy, build packs, services, environment variables, domains, persistent storage, health checks, scheduled tasks, backups and rollbacks - and how to move a running application and its database from a Coolify server to a Shipwick one.
---

# Coming from Coolify

Coolify is a web application that manages servers over SSH: in it you create projects, environments and resources, connect a Git repository, pick a build pack, and it builds and runs the containers on a server it installed Docker and a proxy on. Shipwick is an agent on the server and a file: `deploy.yaml` names an image, or a Dockerfile to build one from, and says what the application needs, and `shipwick deploy` makes the server match it. Most of what a Coolify resource is configured with is a key of that file. This page goes through Coolify's concepts and says what each becomes, which have no counterpart and why, and how to move a running application and its database across. It does not say which is better; this page is for the day you have decided.

The Coolify terms used here are the ones in Coolify's [documentation](https://coolify.io/docs).

## Before you begin

- A new server with Shipwick installed and the CLI on your machine; see [Install on a server](/docs/getting-started/install). Shipwick's proxy takes ports 80 and 443, which Coolify's proxy holds on a server it manages, so the two do not share one. The move below runs both for a while and switches DNS at the end.
- A registry, or Docker on your machine: with `build: .` in `deploy.yaml`, `shipwick deploy` builds the image where it runs and sends it to the server. Nothing is built on the server.

## What each Coolify concept becomes

| Coolify | Shipwick | |
|---|---|---|
| Server | the agent | Coolify reaches a server over SSH and installs Docker and the proxy on it; Shipwick's agent runs on the server, installed once, and the CLI talks to its API |
| Proxy: Traefik, or Caddy | Caddy | Configured by the agent from `deploy.yaml`; no choice of proxy and nothing to edit |
| Project, Environment | contexts, and the applications' names | A server has a flat list of applications. An environment is a server of its own, a context of the CLI, with the same `deploy.yaml` deployed to each |
| Resource: Application | an application: `deploy.yaml` | |
| Resource: Database | an application with a volume | `postgres:17`, a `volumes` entry, `recreate`, a `backups` block |
| Resource: Service, the one-click catalog | — | No catalog. A service is one or more applications in a `shipwick.yaml`; see below |
| Build pack: Dockerfile | `build: .`, or `build: {context, dockerfile}` | Built by `shipwick deploy` where it runs, sent to the server |
| Build pack: Nixpacks, Railpack | — | No counterpart. `shipwick init` writes a Dockerfile for the common stacks |
| Build pack: Static | `static: <dir>` | The built files, served by Caddy with no container |
| Build pack: Docker Compose | `shipwick.yaml` | One entry per service; see [From Docker Compose](/docs/tasks/from-docker-compose) |
| Docker Image | `image:` | A private registry needs `shipwick registry login` |
| Deploy on push, the Git webhook, Deploy and Redeploy | `shipwick deploy`, `shipwick redeploy` | Nothing watches a repository: you, or your pipeline, run the command; see [Deploy from CI](/docs/tasks/deploy-from-ci) |
| Environment Variables, Runtime | `env` | Secrets as `${NAME}`, stored on the server |
| Environment Variables, Build time | — | A build takes the Dockerfile as it is; a value the build needs is written in it |
| Shared variables, <code v-pre>{{team.NAME}}</code> and the rest | a secret for the whole server | `shipwick secret set NAME` without `--app`: every application's `${NAME}` resolves to it |
| Domains: Protocol, Domain, Port, Path; www redirect | `domain`, `port`, `path`, `aliases`, `redirects` | HTTPS always; the certificate is Caddy's doing |
| Wildcard Domain, the generated hostname | — | A hostname is yours to give; `domain` may itself be a wildcard |
| Persistent Storage: Volume Mount | `volumes[].name` / `path` | A named Docker volume |
| Persistent Storage: Directory Mount, File Mount, Host File Mount | — | Nothing of the server is mounted into a container; see below |
| Health Checks | `health` | `path`, `tcp` or `command`; no `curl` or `wget` in the image needed |
| Scheduled Tasks | `jobs` | Five cron fields, read in UTC; each run a fresh container from the image |
| Database Backups, to local disk and S3 | `backups`, and the agent's `SHIPWICK_BACKUP_S3_*` settings | A dump into the volume, then an archive of it, kept on the server and in the bucket |
| Instance backup, the Coolify database | `shipwick export`, and the agent's daily backup of its own state | Everything the server runs in one encrypted file, imported on a new server |
| Rollback, to a retained image | `shipwick rollback` | A deployment of an earlier configuration from the history, image and settings alike |
| Rolling Updates | `deploy.strategy: rolling` | The default. `recreate` where two versions must not run at once |
| Resource Limits: CPU limit, Memory limit | `resources.cpu`, `resources.memory` | Per replica; the other fields have no counterpart |
| Stop Grace Period, Max Restart Count | `deploy.stop_timeout`, `restart.policy` | Restarts are the supervisor's, with backoff |
| Registries, a `docker login` on the server | `shipwick registry login` | The credential is kept by the agent, encrypted, and checked against the registry first |
| Preview Deployments | — | No counterpart |
| Terminal into a container | — | `shipwick run` for a command, `shipwick logs` for what the process says |
| The API, `POST /deploy` | the REST API | [`POST /applications/:name/deploy`](/docs/reference/api#post-applications-name-deploy), which is what the CLI calls |

The rules of every key are in the [deploy.yaml reference](/docs/reference/deploy-yaml). The parts that change meaning, not only name, follow.

## The server and the proxy

Coolify is a program with a database that connects to each server over SSH, runs Docker there, and starts a proxy — Traefik by default, Caddy as the other option — that routes domains and obtains certificates. Shipwick has no central program: the agent on the server owns the applications, keeps its state in one SQLite file there, and configures the Caddy next to it; `shipwick` on your machine and the dashboard talk to the agent's API. One server is one installation, and several servers are several contexts of the CLI, or one dashboard that shows them side by side. The proxy is Caddy, always; what Coolify's Traefik labels or Caddy configuration said is `domain`, `path`, `proxy.headers`, `proxy.basic_auth` and `proxy.redirects` in the file, and nothing is written in a proxy's own language. See [Architecture](/docs/concepts/overview) and [Routing and HTTPS](/docs/concepts/routing-and-https).

## Projects, environments and resources

A Coolify project groups environments, and each environment holds resources: applications, databases, services. Shipwick's agent knows applications and nothing above them: `shipwick ps` lists every application on the server. What was one environment is one server here, since two copies of an application that must not share a database should not share a server either, and the same `deploy.yaml` is deployed to each with its own hostname and secrets; see [Staging and production](/docs/tasks/staging-and-production). What was one project is the applications that belong together, which a `shipwick.yaml` describes in one file, with `after` for the order they come up in.

## Build packs become a Dockerfile, or an image

Coolify builds on the server, or on a build server, with the build pack you chose. Shipwick builds nothing on the server: with `build: .` in `deploy.yaml`, `shipwick deploy` runs `docker build` on your machine, or on the CI runner, and sends the image to the agent; with `image:` it names an image in a registry, which is what Coolify's Docker Image resource did.

- **Dockerfile** is the straight case: the build pack's **Base Directory** is `build.context`, its **Dockerfile Location** is `build.dockerfile`, and `shipwick deploy` builds it.
- **Nixpacks**, which Coolify's documentation notes is in maintenance mode, and **Railpack** detect the language and write the Dockerfile for you. There is no counterpart: an application without a Dockerfile needs one, and `shipwick init` writes it for a Nuxt, Next, SvelteKit, Remix or Astro application, a Node server, a .NET project, a Go program or a Python application: a multi-stage build on a small runtime image, a non-root user, a `.dockerignore`, and a `deploy.yaml` with `build: .`. Review it, then deploy. See [Your first deployment](/docs/getting-started/first-deployment).
- **Static** is `static: <dir>`: the folder your build wrote, uploaded by `shipwick deploy` and served by Caddy with no container. `shipwick init` picks it for a project whose build writes an `index.html`.
- **Docker Compose** is a `shipwick.yaml` with an entry per service; [From Docker Compose](/docs/tasks/from-docker-compose) takes a Compose file apart key by key.

The image's process must listen on `0.0.0.0`, as under Coolify, on the port `port` names.

## Services and databases

A Coolify **Service** is a Docker Compose template from the catalog, and a **Database** is a resource with backups, resource limits and an import page of its own. Shipwick has neither as a kind: a database is an application whose image is the database's, with a volume and a backup schedule, and a service is however many such applications in one `shipwick.yaml`. A Postgres with the application that uses it:

```yaml
apps:
  - name: postgres
    image: postgres:17
    port: 5432
    env:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: app
    volumes:
      - name: data
        path: /var/lib/postgresql/data
    health:
      command: ["pg_isready", "-U", "postgres"]
    backups:
      schedule: "0 3 * * *"
      before: ["pg_dump", "-U", "postgres", "-Fc", "-f", "/var/lib/postgresql/data/backup.dump", "app"]
    deploy:
      strategy: recreate

  - name: redis
    image: redis:7
    port: 6379
    volumes:
      - name: data
        path: /data
    health:
      tcp: 6379
    deploy:
      strategy: recreate

  - name: api
    image: ghcr.io/company/api:1.4.2
    port: 8080
    domain: api.example.com
    env:
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/app
      REDIS_URL: redis://redis:6379
    health:
      path: /health
    after: [postgres, redis]
```

`api` reaches the others by their names, `postgres:5432` and `redis:6379`, as Coolify's Compose services reached one another by service name; there is one network for every application on the server, and nothing to connect. The catalog's templates are Compose files, and a Compose file becomes a `shipwick.yaml` the way the Compose page shows. See [Run a stateful application](/docs/tasks/stateful-applications).

## Environment variables and secrets

Coolify's variables have a build-time and a runtime scope, a **Developer view** that shows them as text, and shared variables referenced as <code v-pre>{{team.NAME}}</code>, <code v-pre>{{project.NAME}}</code> or <code v-pre>{{environment.NAME}}</code>. Here `env` is the runtime scope, in the file, in the repository:

```yaml
env:
  NODE_ENV: production
  DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/app
  STRIPE_KEY: ${STRIPE_KEY}
```

```bash
shipwick secret set STRIPE_KEY --app api      # asks for the value without echo; or pipe it in
shipwick secret set POSTGRES_PASSWORD         # for the whole server: every application's ${POSTGRES_PASSWORD}
```

A value that must not be in the file is `${NAME}`, stored on the server once, encrypted, and filled in by the agent when it records the deployment; the API never shows it. A secret stored with `--app` is that application's; one stored without is the server's, which is what a shared variable was. Or `shipwick deploy --env-file production.env` fills placeholders in where `shipwick` runs. A name that is set nowhere is an error before anything is deployed. See [Keep secrets on the server](/docs/tasks/secrets).

The build-time scope has no counterpart: a build takes the Dockerfile as it is, with no build arguments, and a value the build needs is written in the Dockerfile. The variables Coolify injected, `COOLIFY_FQDN`, `COOLIFY_URL`, `SOURCE_COMMIT`, `PORT` and the rest, are not set; an application that read them gets them from `env`, where you write them.

## Domains and certificates

A Coolify domain is written with its protocol, `https://app.example.com`, optionally with a port and a path, several of them one at a time or comma-separated, with a **www redirect** setting. Here the protocol is always HTTPS, the port is `port`, and the names are three keys:

```yaml
port: 3000
domain: app.example.com
aliases: [app.example.net]           # served exactly like domain
redirects: [www.app.example.com]     # 308 to https://app.example.com, path and query kept
path: /api                           # optional: only this path of the domain, with proxy.strip_prefix to drop it
```

Caddy obtains the certificate for `domain` and every alias and renews it, once the DNS record points at the server; until then `shipwick status` says the hostname is waiting. Coolify's **Wildcard Domain** on the server, which generated a hostname for every resource, has no counterpart: an application has the hostname you give it, or none, in which case other applications reach it and nobody else does. `domain` may be a wildcard itself, `"*.example.com"`, for an application that serves every name under one. See [Serve several hostnames and redirect www](/docs/tasks/several-hostnames) and [Share a hostname by path](/docs/tasks/paths-and-proxy).

## Persistent storage becomes volumes, named only

Coolify's **Volume Mount** is a named Docker volume on the server, and maps directly:

```yaml
volumes:
  - name: uploads
    path: /app/uploads
deploy:
  strategy: recreate
```

The volume is `shipwick_<application>_uploads` on the server, belongs to the application rather than to a deployment, and survives redeploys, rollbacks and `shipwick delete`. An application with volumes has one replica and `recreate`, because two versions must not write the same files at once.

**Directory Mount**, **File Mount** and **Host File Mount** have no counterpart. They mount a path of the server into the container, and the agent does that for no application, with no key to ask for it: whoever may deploy may run containers on the server, and a mount of a host path would let them read any file on it. A configuration file the application reads is `COPY`ed into the image or handed over as `env`; data that must survive is a named volume; scratch space is a `tmpfs` entry under `security`. See [volumes: named only](/docs/tasks/from-docker-compose#volumes-named-only) and [Security](/docs/security#unprivileged-containers).

## Health checks

Coolify's health check is HTTP or CMD, with method, scheme, host, port and path, interval, timeout, retries and start period, and its documentation says the image must contain `curl` or `wget`, because the check runs inside the container. Here the agent asks the replica itself, and nothing in the image is needed:

```yaml
health:
  path: /health            # must answer 2xx
  interval: 10s
  timeout: 3s
  retries: 3
  start_period: 30s
```

`tcp: 5432` for a port that must accept a connection, `command: ["pg_isready", "-U", "postgres"]` for a command inside the replica, the `CMD` kind. A rolling deployment replaces a replica only once the new one has passed the check, a replica carries the application's name on the network only while it passes, and a failing one is restarted by the supervisor. See [Health checks and supervision](/docs/concepts/health-and-supervision).

## Scheduled tasks become jobs

A Coolify **Scheduled Task** has a name, a command, a frequency, a timeout and the container it runs in; the command runs through `sh` inside the running container, on the server's time zone. A job here runs in a fresh container from the application's image, with its `env`, limits and network and without its volumes, as a list of arguments and without a shell, on a schedule read in UTC:

```yaml
jobs:
  - name: nightly-report
    schedule: "0 3 * * *"     # five fields, UTC
    command: ["node", "report.js"]
    timeout: 1h
```

Named frequencies, `daily` and `hourly`, are written as their cron fields. One run of a job at a time; a firing while one is running is skipped. `shipwick jobs api` lists the jobs with their last and next run, `shipwick jobs run api nightly-report` starts one now, `shipwick jobs logs api nightly-report` shows the last run's output. A command you type is `shipwick run api -- node report.js`. See [Run scheduled jobs and one-off commands](/docs/tasks/jobs).

## Backups: of a database, and of the server

A Coolify database has **Database backups**: a schedule, a cron expression or a named frequency, retention by count, days and size, a local copy under `/data/coolify/backups` and, with an **S3 storage** added and validated, a copy in the bucket. Here the schedule is in the database's `deploy.yaml`, and the bucket is the agent's:

```yaml
backups:
  schedule: "0 3 * * *"     # five fields, UTC
  keep: 7
  before: ["pg_dump", "-U", "postgres", "-Fc", "-f", "/var/lib/postgresql/data/backup.dump", "app"]
```

`before` runs inside the replica first, so that the archive holds a consistent dump; then every volume of the application is archived, kept on the server and, with `SHIPWICK_BACKUP_S3_*` set on the agent, encrypted and sent to the bucket. `keep` is how many are kept. `shipwick backups postgres` lists them, `shipwick backups run postgres` takes one now, `shipwick backups verify postgres` proves that one restores, `shipwick backups restore postgres <id>` puts one back. Redis, which Coolify's backups do not cover, is backed up the same way, its volume archived. See [Back up and restore volumes](/docs/tasks/backups).

Coolify's **instance backup** saves Coolify's own database, with the projects and settings and not the data in your databases, to restore the instance on a new server. The agent backs its own state up daily the same way, and `shipwick server backup` does it now; a lost server comes back from it as under [Bring a lost server back](/docs/tasks/restore-the-agent-state). The thing Coolify has no counterpart for is `shipwick export`: one encrypted file with every application's configuration, secrets, registry credentials, certificates, the images built by `deploy`, and an archive of every volume, which `shipwick import` deploys on another server, data included; see [Move to a new server](/docs/tasks/move-to-a-new-server).

## Deployments, rolling updates and rollbacks

Coolify's **Rolling Updates** start a replacement container while the current one runs, for every build pack but Docker Compose, and are off when the application publishes a host port or keeps a consistent container name. That is Shipwick's default, `deploy.strategy: rolling`, for any application: replicas are replaced one at a time, each new one only after it passed its health check, the proxy's configuration is not reloaded for it, and a version that fails is undone with the previous one still serving. `recreate` stops the old version first, and is required for an application with volumes or a published port, for the same reason Coolify turns rolling updates off there.

Coolify's **Rollback** redeploys an older image the server retained, among the **Images to keep**, and its documentation notes that it does not reverse migrations or restore storage. `shipwick rollback api` deploys the previous successful deployment's whole configuration from the history — image, `env`, replicas, limits, domain — through the same engine as a deployment, replica by replica; `--to <n>` picks any earlier one. It does not touch the data either, and the history is appended to, never rewritten. See [Roll back and redeploy](/docs/tasks/roll-back).

**Redeploy** and **Restart** are `shipwick redeploy api`, the running configuration deployed again, `--image` to change the image on the way; `shipwick stop api` and `start` stop and start it. A deployment started through the API, `POST /deploy` in Coolify, is [`POST /applications/:name/deploy`](/docs/reference/api#post-applications-name-deploy) here, which is what the CLI calls.

## Limits, grace period and restarts

Coolify's **Resource Limits** are Docker's: CPU limit, CPU set, CPU weight, memory limit, memory reservation, swap, swappiness. Two of them have a counterpart, per replica, and the hard memory cap is one swap does not extend:

```yaml
resources:
  cpu: 1
  memory: 512mb
```

**Stop Grace Period** is `deploy.stop_timeout`, between `SIGTERM` and `SIGKILL`, `10s` unless set. **Max Restart Count** has `restart.policy` in its place, `always`, `on-failure` or `never`: restarts are the supervisor's, with backoff and crash-loop detection, and an alert when a replica is restarted three times in ten minutes. See [Resource limits and metrics](/docs/concepts/resources) and [Restart policy](/docs/concepts/health-and-supervision#restart-policy).

## Moving a running application across

Coolify keeps serving on the old server until the last step. The order: read the configuration out, write the file and validate it, deploy to the new server, move the data, switch DNS.

### 1. Read the configuration out of Coolify

Open the application in Coolify and copy, from **Environment Variables** in the **Developer view**, the variables as text; from **Domains**, the hostnames; from **Persistent Storage**, the mounts; from **Health Checks**, **Scheduled Tasks** and **Resource Limits**, what is set there. For a database resource, its image and version, and the **Backups** schedule.

### 2. Write the file

A `shipwick.yaml` with the database and the application, as under [Services and databases](#services-and-databases) above. Each variable becomes an `env` entry, each secret a `${NAME}`; each Volume Mount a named volume; the health check and the scheduled tasks their keys. For the move the database publishes its port on the server's own loopback address, for the restore in step 4 and nothing else:

```yaml
apps:
  - name: postgres
    image: postgres:17
    port: 5432
    env:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: app
    volumes:
      - name: data
        path: /var/lib/postgresql/data
    publish:
      - port: 5432
        host: 15432
        address: 127.0.0.1      # the server itself only; reached through an SSH tunnel
    health:
      command: ["pg_isready", "-U", "postgres"]
    backups:
      schedule: "0 3 * * *"
      before: ["pg_dump", "-U", "postgres", "-Fc", "-f", "/var/lib/postgresql/data/backup.dump", "app"]
    deploy:
      strategy: recreate

  - name: api
    build: .
    port: 8080
    domain: api.example.com
    redirects: [www.api.example.com]
    env:
      NODE_ENV: production
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/app
      STRIPE_KEY: ${STRIPE_KEY}
    health:
      path: /health
      start_period: 30s
    jobs:
      - name: nightly-report
        schedule: "0 3 * * *"
        command: ["node", "report.js"]
    resources:
      memory: 512mb
    after: [postgres]
```

```bash
shipwick secret set POSTGRES_PASSWORD           # for the server: both applications refer to it
shipwick secret set STRIPE_KEY --app api
shipwick validate
```

```text
✓ shipwick.yaml is valid (2 variables left to the server)

postgres
api       after postgres

Name           postgres
Image          postgres:17
Version        17
Replicas       1
Port           5432
Health check   command pg_isready -U postgres every 10s (timeout 3s, 3 retries)
Resources      unlimited CPU, unlimited memory
Volume         data at /var/lib/postgresql/data
Publish        5432/tcp → server port 15432 on 127.0.0.1
Restart        always
Strategy       recreate
Environment    2 variables
Backups        daily at 03:00 UTC, 7 kept, after pg_dump -U postgres -Fc -f /var/lib/postgresql/data/backup.dump app

Name           api
Build          ./ (Dockerfile)
Replicas       1
Port           8080
Domain         api.example.com
Redirects      www.api.example.com → https://api.example.com
Health check   GET /health every 10s (timeout 3s, 3 retries), after a 30s start period
Resources      unlimited CPU, 512 MB
Restart        always
Environment    3 variables
Job            nightly-report at 0 3 * * * UTC: node report.js
```

An application Coolify built with Nixpacks has `build: .` and a Dockerfile from `shipwick init` next to the file; one it built from a Dockerfile has that Dockerfile; one it pulled as a Docker Image has `image:` in place of `build:`.

### 3. Deploy to the new server

```bash
shipwick deploy
```

`postgres` comes up first, then `api` is built on your machine, sent to the server and started. `api.example.com` still points at the Coolify server, so the proxy waits for DNS and `shipwick status api` says so; the application is running against an empty database.

### 4. Move the data

Take a backup of the database in Coolify with **Back up now**, which writes a `pg_dump` custom-format file under `/data/coolify/backups` on the Coolify server, and copy it to your machine. The dump is restored into the new database through the published loopback port, over an SSH tunnel to the new server:

```bash
ssh -N -L 15432:127.0.0.1:15432 user@new-server &
pg_restore -h 127.0.0.1 -p 15432 -U postgres -d app --no-owner backup.dump
```

The password is the one stored as `POSTGRES_PASSWORD`. Writes that reach the Coolify server after the backup are not in the dump; for a database that is written to all the time, stop the application in Coolify for the backup, or back up once more at the switch.

Files in a Volume Mount are brought over as an archive and put into the new volume with `shipwick restore`, which needs the application stopped: `docker run --rm -v <volume>:/data -v "$PWD:/out" alpine tar -C /data -cf /out/uploads.tar .` on the Coolify server writes the archive, and on your machine:

```bash
shipwick stop api
shipwick restore api uploads.tar --volume uploads
shipwick start api
```

A restore replaces everything in the volume; see [Restore an archive from your machine](/docs/tasks/backups#restore-an-archive-from-your-machine).

### 5. Switch DNS

Lower the records' TTL a day ahead. Then point `api.example.com` at the new server. Caddy obtains the certificate the moment the name resolves to it, and `shipwick status api` goes from waiting to the URL; `shipwick doctor` checks DNS, the ports and the certificate in one screen. Once the Coolify server sees no more requests, remove `publish` from the `postgres` entry and `shipwick deploy postgres`, and let the first scheduled backup run before you turn the old server off.

### The way back

Until DNS has moved, the way back is to do nothing: Coolify is still serving. After it, the way back is DNS pointed at the Coolify server again, and the data written on the new server in the meantime brought back with `pg_dump` and Coolify's **Import Backup** page, which takes a dump from your computer. On the new server itself, a version that turns out to be wrong is `shipwick rollback api`, which does not touch the data; see [Roll back and redeploy](/docs/tasks/roll-back).

## What's next

- [From Docker Compose](/docs/tasks/from-docker-compose): the Compose keys of a service template, one by one.
- [Your first deployment](/docs/getting-started/first-deployment): `shipwick init`, the Dockerfile it writes, and the first `deploy`.
- [Use the dashboard](/docs/tasks/dashboard): the same information and everyday actions in a browser.
- [Deploy from CI](/docs/tasks/deploy-from-ci): the pipeline that takes the place of the Git webhook.
- [Coming from Dokku](/docs/tasks/coming-from-dokku): the same page for Dokku.
