---
title: Coming from Dokku
description: What each Dokku concept becomes in Shipwick - apps and git push, buildpacks, config:set, domains and the letsencrypt plugin, ps:scale, the postgres plugin, storage:mount, checks, ports and cron - and how to move a running application and its database from a Dokku server to a Shipwick one.
---

# Coming from Dokku

Dokku runs applications on one server from a `git push`: it builds the code with buildpacks or a Dockerfile, keeps the configuration in `config:set`, and adds databases, certificates and the rest through plugins. Shipwick runs applications on one server from a file: `deploy.yaml` names an image, or a Dockerfile to build one from, and says what the application needs, and `shipwick deploy` makes the server match it. Most of what a Dokku application has is a key of that file. This page goes through Dokku's concepts and commands and says what each becomes, which have no counterpart and why, and how to move a running application and its Postgres database across. It does not say which is better; they are different tools, and this page is for the day you have decided.

Every Dokku command named here is in Dokku's [documentation](https://dokku.com/docs/); the ones that moved recently are marked.

## Before you begin

- A new server with Shipwick installed and the CLI on your machine; see [Install on a server](/docs/getting-started/install). Shipwick's proxy takes ports 80 and 443, which Dokku's nginx holds, so the two do not share a server. The move below runs both for a while and switches DNS at the end.
- A registry, or Docker on your machine: with `build: .` in `deploy.yaml`, `shipwick deploy` builds the image where it runs and sends it to the server. Nothing is built on the server.

## What each Dokku concept becomes

| Dokku | Shipwick | |
|---|---|---|
| `dokku apps:create my-app` | `name: my-app` in `deploy.yaml` | An application exists once it has been deployed; there is no create step. `dokku apps:destroy` is `shipwick delete`, which leaves the volumes |
| `git push dokku main` | `shipwick deploy` | Nothing watches a repository. You, or your pipeline, run the command; see [Deploy from CI](/docs/tasks/deploy-from-ci) |
| Herokuish buildpacks, `.buildpacks`, `BUILDPACK_URL`, Cloud Native Buildpacks | — | No counterpart. The image comes from a Dockerfile, built by `shipwick deploy` with `build: .`; `shipwick init` writes one for the common stacks |
| `builder:set my-app selected dockerfile`, `builder-dockerfile:set my-app dockerfile-path` | `build: .`, or `build: {context, dockerfile}` | The only builder there is |
| `dokku git:from-image my-app image:tag` | `image: image:tag` | An image from a registry; a private one needs `shipwick registry login` |
| `dokku config:set my-app KEY=value` | `env:` | The same map, in the file. A password is `${NAME}`, stored on the server with `shipwick secret set` |
| `dokku config:export my-app` | the file itself | `shipwick config my-app` writes back the `deploy.yaml` the server runs, secrets as `${NAME}` |
| `dokku domains:add my-app app.example.com` | `domain`, `aliases`, `redirects` | One hostname, up to 20 more served the same, up to 20 redirected to the first |
| `dokku letsencrypt:enable my-app`, `certs:add` | nothing | Caddy obtains and renews certificates for every `domain` and alias by itself; `shipwick cert set` for one of your own |
| `dokku ps:scale my-app web=2` | `replicas: 2` | For the one process an application is. A `worker` is a second application from the same image with its own `command` |
| `dokku postgres:create db`, `postgres:link db my-app` (plugin) | a `postgres` entry in `shipwick.yaml`, `after: [postgres]` | A database is an application with a volume; `DATABASE_URL` is written by you, from a secret |
| `dokku storage:mount my-app /var/lib/dokku/data/storage/my-app:/app/storage` | `volumes[].name` / `path` | Named Docker volumes only; the agent mounts no path of the server. See below |
| `CHECKS` file, `healthchecks` in `app.json`, `checks:*` | `health` | `path`, `tcp` or `command`, with `interval`, `timeout`, `retries`, `start_period` |
| `dokku ps:rebuild my-app`, `ps:restart` | `shipwick redeploy my-app` | The running configuration deployed again, replica by replica; `--image` changes the image. `ps:stop` and `ps:start` are `shipwick stop` and `start` |
| `dokku logs my-app -t` | `shipwick logs my-app -f` | `-n 100`, `-t` for timestamps; `logs --previous` for a container that ended, where Dokku has `logs:failed` |
| `dokku ports:add my-app http:80:5000` (`proxy:ports-add` before 0.31) | `port: 5000` with `domain` | The proxy serves the hostname over HTTPS and sends it to `port`; no host port is opened for HTTP |
| `dokku postgres:expose db 5432` (plugin) | `publish` | A port of the server itself, for what is not HTTP, with `deploy.strategy: recreate` and one replica |
| `dokku resource:limit --memory 512m --cpu 1 my-app` | `resources.memory: 512mb`, `resources.cpu: 1` | Per replica. `resource:reserve` has no counterpart |
| `cron` in `app.json`, `cron:list`, `cron:run` | `jobs` | Five cron fields, read in UTC, each run in a fresh container from the image |
| `dokku run my-app <command>` | `shipwick run my-app -- <command>` | A one-off container with the application's image, env and limits; exits with the command's code |
| `dokku enter my-app` | — | No shell into a running container. `shipwick run` for a command, `shipwick logs` for what the process says |
| `dokku proxy:set my-app type caddy` | — | The proxy is Caddy, configured by the agent; `proxy.headers`, `basic_auth` and path `redirects` are keys of `deploy.yaml` |
| `dokku network:set my-app attach-post-deploy <network>` | nothing | Every application is on one network and reachable by its name at `http://<name>:<port>` |
| `dokku apps:clone`, `dokku git:sync` | — | No counterpart. One `deploy.yaml` is deployed to any number of servers, each a context of the CLI |

The rules of every key are in the [deploy.yaml reference](/docs/reference/deploy-yaml). The parts that change meaning, not only name, follow.

## Building: git push and buildpacks become a Dockerfile

Dokku receives the source and builds it on the server, with Herokuish buildpacks by default and with a Dockerfile when the repository has one and nothing names a buildpack. Shipwick receives an image and builds nothing on the server. With `build: .` in `deploy.yaml`, `shipwick deploy` runs `docker build` on your machine, or on the CI runner, and sends the result to the agent; with `image:` it names an image in a registry. Buildpacks, Herokuish and `pack` have no counterpart: an application that has no Dockerfile needs one.

`shipwick init` writes it. It recognises a Nuxt, Next, SvelteKit, Remix or Astro application, a Node server, a .NET project, a Go program and a Python application, and writes a multi-stage `Dockerfile` on a small runtime image with a non-root user, a `.dockerignore` and a `deploy.yaml` with `build: .`; a project that builds to static files gets `static: <dir>` and no container at all. An existing Dockerfile is kept. Review what it wrote, then deploy; see [Your first deployment](/docs/getting-started/first-deployment). An application Dokku already builds with its `dockerfile` builder has its Dockerfile, and only the `deploy.yaml` is new.

Two things a Dockerfile-based Dokku deployment did are now yours to say. Dokku read the ports from `EXPOSE`, or mapped `http:80:5000` when there was none; here `port` says what the container listens on, and `domain` says what it is served at. And Dokku passed config variables into a Dockerfile build only with `docker-options:add my-app build '--build-arg …'`; Shipwick's build takes the Dockerfile as it is, with no arguments, and `env` reaches the application at run time only. A value the build needs is written in the Dockerfile.

## Configuration: config:set becomes env, and secrets become ${NAME}

`dokku config:set my-app APP_ENV=prod` becomes a line under `env`, in the file, in the repository. A password does not belong there, and is written as a placeholder and stored on the server once:

```yaml
env:
  APP_ENV: prod
  DATABASE_URL: postgres://app:${POSTGRES_PASSWORD}@postgres:5432/app
  STRIPE_KEY: ${STRIPE_KEY}
```

```bash
shipwick secret set STRIPE_KEY --app my-app      # asks for the value without echo; or pipe it in
```

The agent fills the placeholder in when it records the deployment; the value never leaves the server and is never shown by the API. Or `shipwick deploy --env-file production.env` fills it in where `shipwick` runs. A name that is set nowhere is an error before anything is deployed, never an empty value. There is no `--no-restart`: `env` is part of the deployment, a change to it is a `shipwick deploy`, rolled out replica by replica. See [Keep secrets on the server](/docs/tasks/secrets).

Dokku set some variables for you. `postgres:link` wrote `DATABASE_URL`; here you write it, as above, with the database application's name as the host. Nothing else is set either: an application that read a variable Dokku provided gets it from `env` now.

## Domains and certificates

`dokku domains:add my-app app.example.com` is `domain: app.example.com`, and the certificate the letsencrypt plugin obtained is obtained by Caddy, for the domain and every alias, and renewed, with nothing to enable and no cron job to add. `www`, an old domain and other names are either served the same or redirected:

```yaml
domain: app.example.com
aliases: [app.example.net]
redirects: [www.app.example.com]
```

A hostname is served once its DNS record points at the server; until then `shipwick status` says it is waiting, and for what. See [Serve several hostnames and redirect www](/docs/tasks/several-hostnames) and [Routing and HTTPS](/docs/concepts/routing-and-https). The hostname Dokku generated from the app name and the global domain is not generated here: an application without `domain` is reachable by other applications and by nothing else.

## Processes and scaling

A Dokku app is a `Procfile` of process types, and `ps:scale my-app web=2 worker=1` scales each. A Shipwick application is one process, and `replicas: 2` is how many of it run; `shipwick deploy` replaces them one at a time, each new one only after it passed its health check, which is what Dokku's zero-downtime checks did for `web`. A `worker` is a second application from the same image, with its `command` and no `domain`, in the same `shipwick.yaml`:

```yaml
apps:
  - name: my-app
    image: ghcr.io/company/my-app:1.4.2
    port: 8080
    domain: app.example.com
    health:
      path: /health

  - name: my-app-worker
    image: ghcr.io/company/my-app:1.4.2
    command: ["node", "worker.js"]
```

`command` is a list of arguments, passed as written, without a shell; see [`command`](/docs/reference/deploy-yaml#command). A `release` entry of the Procfile is `pre_deploy`: a command run from the new image, on the application's network, before any replica of the new version exists, and a failure stops the deployment; see [Run migrations before the new version starts](/docs/tasks/deploy-from-ci#run-migrations-before-the-new-version-starts).

## Databases: the postgres plugin becomes an application

`dokku postgres:create db` created a container with a volume, and `postgres:link db my-app` set `DATABASE_URL` and put the two on a network. Here the database is an application of the same `shipwick.yaml`, with a volume, `recreate` as its strategy, a health check and a backup schedule, and `my-app` names it in `after` so that it deploys first:

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

  - name: my-app
    image: ghcr.io/company/my-app:1.4.2
    port: 8080
    domain: app.example.com
    env:
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/app
    health:
      path: /health
    after: [postgres]
```

`my-app` reaches the database at `postgres:5432`, by the application's name, as it reached `dokku-postgres-db` on Dokku. `${POSTGRES_PASSWORD}` is stored once for the server, without `--app`, since both applications refer to it. The `backups` block is what `postgres:backup-schedule` did, taken by the agent: a `pg_dump` into the volume first, then an archive of the volume, kept on the server and, with a bucket configured, off it. Redis, MySQL and the other datastore plugins become applications the same way, with their image and their volume. See [Run a stateful application](/docs/tasks/stateful-applications) and [Back up and restore volumes](/docs/tasks/backups).

## Storage: storage:mount becomes volumes

`dokku storage:mount my-app /var/lib/dokku/data/storage/my-app:/app/storage` mounted a directory of the server into the container, after `storage:ensure-directory`, now `storage:create`, made it. Here the same data lives in a named Docker volume, and the file names it:

```yaml
volumes:
  - name: storage
    path: /app/storage
deploy:
  strategy: recreate
```

The volume is `shipwick_my-app_storage` on the server, belongs to the application rather than to a deployment, and survives redeploys, rollbacks and `shipwick delete`. An application with volumes has one replica and `recreate`, because two versions must not write the same files at once. A path of the server where a name goes is refused, and there is no key that would accept one: whoever may deploy may run containers on the server, and a mount of a host path would let them read any file on it. See [volumes: named only](/docs/tasks/from-docker-compose#volumes-named-only) and [Security](/docs/security#unprivileged-containers). Files Dokku kept under `/var/lib/dokku/data/storage/my-app` are brought over as an archive, under [Move the data](#_4-move-the-data) below.

## Checks become health

Dokku's zero-downtime checks came from a `CHECKS` file and, since 0.31, from `healthchecks` in `app.json`, where the `CHECKS` file is deprecated. Both become `health`:

```yaml
health:
  path: /health/ready     # must answer 2xx
  interval: 10s
  timeout: 3s
  retries: 3
  start_period: 30s       # what app.json's wait and attempts bought
```

The agent asks the replica itself; nothing in the image is needed. `tcp: 5432` for a port that must accept a connection, `command: ["pg_isready", "-U", "postgres"]` for a command inside the replica. The check does more here than deciding a deployment: a replica carries the application's name on the network only while it passes, and one that fails is restarted by the supervisor. `checks:disable`, which Dokku warns causes downtime, has a counterpart in leaving `health` out, with the same effect on a rollout: a replica without a check is taken for ready as soon as it runs. See [Health checks and supervision](/docs/concepts/health-and-supervision).

## Ports: ports:add becomes port and domain, or publish

`dokku ports:add my-app http:80:5000` — `proxy:ports-add` before Dokku 0.31, which replaced the `proxy:ports*` commands with the `ports` plugin — said that nginx should send the hostname's traffic to port 5000. Here that is two keys, `port: 5000` and `domain`, and the proxy serves the hostname over HTTPS; no port of the server is opened for an HTTP application, 80 and 443 are the proxy's.

A port mapping for something that is not HTTP, a database a laptop connects to, is `publish`:

```yaml
publish:
  - port: 5432
    host: 15432          # on the server; default: the same as port
    address: 10.0.0.5    # default: every address of the server
deploy:
  strategy: recreate
```

A published port bypasses the host firewall as Docker's `-p` does; bind it to a private address where one exists. See [Expose a service that is not HTTP](/docs/tasks/non-http-services).

## Operations: rebuild, restart, logs, run, cron

- **`ps:rebuild`, `ps:restart`** are `shipwick redeploy my-app`: the configuration the server runs, deployed again, replica by replica; `--image` changes the image on the way. Where Dokku's rebuild built the source again, there is nothing to build on the server; a new build is `shipwick deploy` from the project.
- **`logs -t`** is `shipwick logs my-app -f`, which reconnects when the connection drops and ends by itself when a deployment replaces the containers. `logs:failed` is `shipwick logs my-app --previous`: the output of the last container that ended, kept by the agent.
- **`run`** is `shipwick run my-app -- rails db:migrate`: a one-off container from the image, with the application's `env`, limits and network and without its volumes; the output is printed when it ends and `shipwick` exits with the command's code. `run:detached` has no counterpart beyond `jobs`.
- **`cron` in `app.json`** is `jobs` in `deploy.yaml`, each a command run on a cron schedule in a fresh container, one run at a time, with a timeout:

  ```yaml
  jobs:
    - name: send-email
      schedule: "0 0 * * *"     # five fields, read in UTC
      command: ["npm", "run", "send-email"]
  ```

  Dokku's schedules run in the server's time zone; these run in UTC whatever the server's clock says. `shipwick jobs my-app` lists them with their last and next run, `shipwick jobs run my-app send-email` starts one now, as `cron:run` did. See [Run scheduled jobs and one-off commands](/docs/tasks/jobs).
- **`resource:limit --memory 512m --cpu 1 my-app`** is `resources: {memory: 512mb, cpu: 1}`, per replica; under Dokku's `docker-local` scheduler `--cpu` is a count of CPUs and `--memory` is in megabytes unless a suffix says otherwise, so the numbers carry over. Reservations have no counterpart.
- **`ps:stop`, `ps:start`** are `shipwick stop my-app` and `shipwick start my-app`; a stopped application runs no jobs.

## Plugins with no counterpart

Dokku's letsencrypt, postgres, redis and the other datastore plugins have their counterparts above. Of the rest:

- **redirect** is `redirects` for a hostname and `proxy.redirects` for a path: up to 100 paths answered with a 301, 302, 307 or 308 to a path or an `https://` URL.
- **http-auth** is `proxy.basic_auth`: up to 20 accounts, asked for by the proxy before a request reaches the application, the password a secret like an `env` value.
- **registry**, which pushed Dokku's built images to a registry, is not needed: an image built by `shipwick deploy` is sent to the server and nowhere else, and an image the pipeline pushed is named with `image:` or `--image`.
- **maintenance** has no counterpart. A page shown while the application is down is the application's own, or a redirect you deploy in its place.
- **monit** and the other health plugins are the supervisor: a failing replica is restarted with backoff, a crash loop is detected, an application whose replicas have all stopped serving is reported, and `shipwick status` shows it; see [Health checks and supervision](/docs/concepts/health-and-supervision).
- **Dokku's nginx configuration** has `proxy.headers`, `proxy.basic_auth`, `proxy.redirects` and `path` as its counterpart, and nothing beyond them: proxy configuration is built by the agent from the file, not written by hand. See [Share a hostname by path and configure the proxy](/docs/tasks/paths-and-proxy).

## Moving a running application across

Dokku keeps serving on the old server until the last step. The order: read the configuration out, write the file and validate it, deploy to the new server, move the data, switch DNS.

### 1. Read the configuration out of Dokku

```bash
dokku config:export my-app          # export KEY='value', one per line
dokku domains:report my-app
dokku ps:scale my-app
dokku storage:list my-app
dokku ports:report my-app
dokku resource:report my-app
```

`config:export` prints the variables as `export` lines, which `eval` would take; read them. Each one becomes an `env` entry, and each password becomes `${NAME}`. Leave out what Dokku set for its own use, and `DATABASE_URL`, which is written anew with the new database's name as its host.

### 2. Write the file

A `shipwick.yaml` with the database and the application, as under [Databases](#databases-the-postgres-plugin-becomes-an-application) above, with the hostnames of `domains:report`, the `web` count of `ps:scale` as `replicas` (or 1, with volumes), the limits of `resource:report` under `resources`, and each mount of `storage:list` as a named volume. For the move the database publishes its port on the server's own loopback address, for the restore in step 4 and nothing else:

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
    deploy:
      strategy: recreate

  - name: my-app
    image: ghcr.io/company/my-app:1.4.2
    port: 8080
    domain: app.example.com
    replicas: 2
    env:
      APP_ENV: prod
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/app
      STRIPE_KEY: ${STRIPE_KEY}
    health:
      path: /health
    resources:
      memory: 512mb
      cpu: 1
    after: [postgres]
```

```bash
shipwick secret set POSTGRES_PASSWORD           # for the server: both applications refer to it
shipwick secret set STRIPE_KEY --app my-app
shipwick validate
```

```text
✓ shipwick.yaml is valid (2 variables left to the server)

postgres
my-app    after postgres

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

Name           my-app
Image          ghcr.io/company/my-app:1.4.2
Version        1.4.2
Replicas       2
Port           8080
Domain         app.example.com
Health check   GET /health every 10s (timeout 3s, 3 retries)
Resources      1 CPU, 512 MB
Restart        always
Environment    3 variables
```

### 3. Deploy to the new server

```bash
shipwick deploy
```

Both applications come up on the new server, `postgres` first. `app.example.com` still points at the Dokku server, so the proxy waits for DNS and `shipwick status my-app` says so; the application is running, and `shipwick logs my-app` shows it talking to an empty database. If the image is built from the project, `build: .` in place of `image:` builds it on your machine and sends it; if Dokku built it with buildpacks, the Dockerfile from [Building](#building-git-push-and-buildpacks-become-a-dockerfile) comes first.

### 4. Move the data

The database first. Dokku's postgres plugin writes a dump to standard output and takes one back on standard input; the dump is restored into the new database through the published loopback port, over an SSH tunnel to the new server:

```bash
dokku postgres:export db > db.dump                       # on the Dokku server, or over ssh
ssh -N -L 15432:127.0.0.1:15432 user@new-server &        # the new server's loopback, here
pg_restore -h 127.0.0.1 -p 15432 -U postgres -d app --no-owner db.dump
```

`pg_restore` takes a dump in PostgreSQL's custom or tar format; a plain SQL dump goes through `psql` with the same connection arguments instead. The password is the one stored as `POSTGRES_PASSWORD`. Writes that reach the Dokku server after the export are not in the dump; for a database that is written to all the time, stop the Dokku app for the export (`dokku ps:stop my-app`), or export once more at the switch.

Files under a `storage:mount` are brought over as an archive and put into the new volume with `shipwick restore`, which needs the application stopped. The application's entry then has the volume, one replica and `recreate`, as under [Storage](#storage-storage-mount-becomes-volumes) above:

```bash
tar -C /var/lib/dokku/data/storage/my-app -cf storage.tar .     # on the Dokku server
shipwick stop my-app
shipwick restore my-app storage.tar --volume storage
shipwick start my-app
```

A restore replaces everything in the volume; see [Restore an archive from your machine](/docs/tasks/backups#restore-an-archive-from-your-machine).

### 5. Switch DNS

Lower the records' TTL a day ahead. Then point `app.example.com` at the new server. Caddy obtains the certificate the moment the name resolves to it, and `shipwick status my-app` goes from waiting to the URL; `shipwick doctor` checks the whole path, DNS, ports and the certificate, in one screen. Once the Dokku server sees no more requests, remove `publish` from the `postgres` entry and `shipwick deploy postgres`, and let the first scheduled backup run before you turn the old server off.

### The way back

Until DNS has moved, the way back is to do nothing: Dokku is still serving. After it, the way back is DNS pointed at the Dokku server again, and the data written on the new server in the meantime brought back with `pg_dump` and `dokku postgres:import db < db.dump`. On the new server itself, a version that turns out to be wrong is `shipwick rollback my-app`, a deployment of the previous configuration from the history, which does not touch the data; see [Roll back and redeploy](/docs/tasks/roll-back).

## What's next

- [From Docker Compose](/docs/tasks/from-docker-compose): the same mapping for a `docker-compose.yml`, and a worked three-service example.
- [Your first deployment](/docs/getting-started/first-deployment): `shipwick init`, the Dockerfile it writes, and the first `deploy`.
- [Run a stateful application](/docs/tasks/stateful-applications): the database, its backups, and reaching it from the other applications.
- [Deploy from CI](/docs/tasks/deploy-from-ci): the pipeline that takes the place of `git push dokku`.
- [Coming from Coolify](/docs/tasks/coming-from-coolify): the same page for Coolify.
