---
title: Run a database or other stateful application
description: Run PostgreSQL or another application that keeps data on a Shipwick server, with a named volume, a TCP health check and the recreate strategy, back it up, and know what happens to the data on redeploy, rollback, restore and delete.
---

# Run a database or other stateful application

An application that keeps data, a database above all, needs two things that a stateless one does not: a volume that outlives its containers, and a deployment that never runs two versions on that volume at once. This page shows how to run PostgreSQL under Shipwick, where its data lives, how to back it up and restore it, what survives which operation, how other applications reach it, and how to reach it from outside the server.

## Before you begin

- The data lives in a named Docker volume on the server. `shipwick backup` downloads it as a tar archive and `shipwick restore` puts one back; see below.
- A stateful application is deployed with `deploy.strategy: recreate`, which stops the running version before it starts the new one. Every deployment of it is a short outage. See [Recreate](/docs/concepts/deployments#recreate).
- Volumes are named volumes only. A path on the host cannot be mounted.

## deploy.yaml

```yaml
name: postgres
image: postgres:17
port: 5432
replicas: 1
env:
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
health:
  tcp: 5432
volumes:
  - name: data
    path: /var/lib/postgresql/data
deploy:
  strategy: recreate
```

| Field | Why |
|---|---|
| `port: 5432` | Gives the application its name on the server, `postgres:5432`, which is how other applications reach it. |
| `replicas: 1` | Required with `volumes`. Replicas cannot share a volume. |
| `${POSTGRES_PASSWORD}` | Filled in when you deploy, so that the password is not in the file: by the server, from a secret stored once with `shipwick secret set`, or by `shipwick` from its environment or an `--env-file`. See [Placeholders](/docs/reference/cli#placeholders). |
| `health.tcp: 5432` | A replica is healthy when this container port accepts a connection. PostgreSQL does not speak HTTP, so `health.path` is not an option. |
| `volumes` | A named Docker volume, mounted at the path where PostgreSQL keeps its data. Up to 10 per application. |
| `deploy.strategy: recreate` | Required with `volumes`. Two versions writing the same files at once is how data gets lost. |

A health check is one of three kinds, and `interval`, `timeout` and `retries` (`10s`, `3s`, `3` by default) mean the same for each. `tcp` says the process is listening, which needs nothing from the image. A database can be listening and still refuse connections while it recovers; `command` asks the application itself, with a tool that must exist in the image — `pg_isready` ships with PostgreSQL, `mysqladmin ping` and `redis-cli ping` with theirs:

```yaml
health:
  command: ["pg_isready", "-U", "postgres"]
```

The command is a list, run inside the replica without a shell; exit 0 is healthy. Without any `health` block, a deployment only verifies that the new replica is still running after 3 seconds, and the supervisor restarts it when it exits, but nobody notices a database that runs and refuses connections. See [Checks that are not HTTP](/docs/reference/deploy-yaml#health).

Validation refuses volumes without `recreate` and with more than one replica; the messages are in the [deploy.yaml reference](/docs/reference/deploy-yaml#volumes).

## Deploy

Store the password on the server once. It is asked for without echo, kept encrypted, and filled into `${POSTGRES_PASSWORD}` by the agent on every deploy from every machine:

```bash
shipwick secret set POSTGRES_PASSWORD
```

```text
✓ Stored secret POSTGRES_PASSWORD
```

The other way is to keep the value where you deploy from: put it in a `NAME=value` file that stays out of the repository and pass it with `--env-file .env.production`, or set it in the environment; `shipwick` then fills it in before the file is sent, and reports `(1 variable substituted)`. Either way:

```bash
shipwick validate
```

```text
✓ deploy.yaml is valid

Name           postgres
Image          postgres:17
Version        17
Replicas       1
Port           5432
Health check   TCP :5432 every 10s (timeout 3s, 3 retries)
Resources      unlimited CPU, unlimited memory
Volume         data at /var/lib/postgresql/data
Restart        always
Strategy       recreate
Environment    1 variables
```

`validate` names `POSTGRES_PASSWORD` as a value left to the server. Then:

```bash
shipwick deploy
```

On the first deployment there is nothing to stop. The volume is created and the replica starts:

```text
Deploying postgres...

✓ Validated deploy.yaml
✓ Pulled image postgres:17
✓ Started 1 container
✓ Replica 1 passed health checks
✓ Deployment successful
```

The password is never printed. A `${NAME}` that is set neither on the server nor where `shipwick` runs is refused before anything is recorded, with the `shipwick secret set` line to run. On the server, the value is stored encrypted with the deployment; see [Security](/docs/security).

## Where the data lives

The volume is the Docker volume `shipwick_<application>_<volume>` on the server, `shipwick_postgres_data` here:

```bash
docker volume ls
```

```text
DRIVER    VOLUME NAME
local     shipwick_postgres_data
```

It belongs to the application, not to a deployment. Every deployment of `postgres` mounts the same volume.

## Back up and restore

`shipwick backup` downloads every volume of the application as a tar archive, named `<application>-<volume>-<UTC timestamp>.tar`, into the current directory or the one given with `-o`:

```bash
shipwick backup postgres
```

```text
! postgres is running; a copy taken now may be inconsistent. For a database, stop it first: shipwick stop postgres
✓ postgres-data-20260927-153000.tar (412 MB)
```

The copy is taken while the application runs, unless it is stopped, and the warning says why that matters: a database that is being written to may not be consistent in the copy. Stop the application first, or take a logical dump with the database's own tool through `shipwick run postgres -- pg_dump …`. Existing files are never overwritten.

A restore replaces *everything* in the volume with the archive's contents, so the application must be stopped, and it stays stopped afterwards:

```bash
shipwick stop postgres
shipwick restore postgres postgres-data-20260927-153000.tar
```

```text
This replaces the data of volume data of postgres with postgres-data-20260927-153000.tar. The application must be stopped and is not started afterwards.
Continue? [y/N] y
✓ Restored volume data of postgres from postgres-data-20260927-153000.tar
Start it with: shipwick start postgres
```

A restore of a running application is refused: `The application is running, and a restore replaces the files under it.` The archives are plain tar files holding the volume's contents relative to the mount point; anything that can write such a tar can be restored. Both commands need the `admin` role. The whole of it, including scheduling and what is and is not consistent, is in [Back up and restore volumes](/docs/tasks/backups).

## What survives what

| Operation | The volume |
|---|---|
| `shipwick deploy` of a new version | Kept. The new container mounts it. |
| `shipwick redeploy` | Kept. |
| `shipwick rollback` | Kept. The earlier version finds the data the later one left behind; make sure it can read it. |
| A failed deployment | Kept. The new containers are removed before the old ones are started again. |
| `shipwick stop`, `shipwick start` | Kept. |
| `shipwick backup` | Kept. It is read, not changed. |
| `shipwick restore` | **Replaced.** Everything in the volume is removed and the archive's contents put in its place. The one Shipwick operation that changes a volume's contents. |
| `shipwick delete postgres` | Kept. The containers and the history go; the volume stays, and `shipwick volumes` lists it as `application deleted`. |
| `shipwick volumes rm shipwick_postgres_data` | Removed, after `delete`. Refused while the application exists: its data belongs to it, and a restore is the way to replace it. `docker volume rm` on the server does the same by hand. |

## Deploying a new version

`recreate` stops the running version before it starts the new one, because two PostgreSQL processes on one data directory would corrupt it. Change the image tag and deploy:

```text
Deploying postgres...

✓ Validated deploy.yaml
✓ Pulled image postgres:17.1
✓ Stopped 17: 17.1 cannot run next to it
✓ Started 1 container
✓ Replica 1 passed health checks
✓ Replica 1/1 is serving 17.1; its 17 predecessor is retired
✓ Deployment successful
```

The database is down from `Stopped` to `passed health checks`: the time the new version takes to start and accept connections on port 5432. Applications that use it see connection failures during that time, and should reconnect; a connection pool does.

If the new version fails to start, the new container is removed and the old one, kept stopped, is started again: the deployment ends as `ROLLED_BACK`, and the data is as the old version left it. See [Rolling back a recreate deployment](/docs/concepts/rollback#rolling-back-a-recreate-deployment).

## Migrations belong to the applications that use it

The database itself has no migrations to run; the applications that use it do. Give each of them a `pre_deploy` command, and the migration runs from that application's new image, against `postgres:5432`, before any replica of the new version starts:

```yaml
# api/deploy.yaml
pre_deploy:
  command: ["dotnet", "Migrate.dll"]
  timeout: 10m
```

If it fails, that application's deployment fails before anything was touched. The command runs next to the version still serving, so a migration must be one the old code can live with: add a column, do not drop one. See [Run scheduled jobs and one-off commands](/docs/tasks/jobs). A migration by hand is `shipwick run api -- dotnet Migrate.dll`.

## Reach it from other applications

Every application on the server reaches the database at `postgres:5432`, the application's name and its `port`. No domain is needed; nothing outside the server can reach the name.

```yaml
# api/deploy.yaml
name: api
image: ghcr.io/company/api:1.4.2
port: 8080
domain: api.example.com
env:
  DATABASE_URL: postgres://app:${DATABASE_PASSWORD}@postgres:5432/app
```

The name is carried by the replica while it is ready, which with `health.tcp` means while port 5432 accepts connections. During a recreate deployment nobody carries it, and lookups fail until the new version is up. See [Call one application from another](/docs/tasks/call-another-application).

Deploy the database before the applications that need it. In one `shipwick.yaml`, `after: [postgres]` on the API makes it wait, and the two share the stored `POSTGRES_PASSWORD`:

```yaml
# shipwick.yaml
apps:
  - name: postgres
    image: postgres:17
    port: 5432
    env:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - name: data
        path: /var/lib/postgresql/data
    health:
      tcp: 5432
    deploy:
      strategy: recreate
  - name: api
    image: ghcr.io/company/api:1.4.2
    port: 8080
    domain: api.example.com
    env:
      DATABASE_URL: postgres://app:${POSTGRES_PASSWORD}@postgres:5432/app
    after: [postgres]
```

```bash
shipwick deploy
```

If `postgres` fails, `api` is skipped and the command exits non-zero. Several `deploy.yaml` files deploy in the order given as well: `shipwick deploy -f postgres/deploy.yaml -f api/deploy.yaml`. See [Several applications](/docs/reference/deploy-yaml#several-applications-shipwick-yaml).

## Reach it from outside the server

The proxy speaks HTTP, so a domain does not help a database. To connect from a laptop or a server elsewhere, publish the container port on the server itself with `publish`:

```yaml
publish:
  - port: 5432
    host: 15432       # on the server; default: the same as port
    address: 10.0.0.5 # optional; default: every address of the server
```

Nothing else changes: other applications still reach it at `postgres:5432`, and the port comes and goes with the replica. Publishing needs `recreate` and one replica, which a stateful application has anyway.

::: warning Docker's published ports bypass the host firewall
On most distributions Docker inserts its own iptables rules ahead of ufw's or firewalld's, so a port published on every address is reachable from the internet whatever the firewall says. Bind it to a private address where one exists — a VPN or private-network interface — and publish only what must be reachable from outside the server.
:::

The full picture, including which ports are refused, is in [Expose a service that is not HTTP](/docs/tasks/non-http-services).

## What's next

- [Back up and restore volumes](/docs/tasks/backups).
- [Expose a service that is not HTTP](/docs/tasks/non-http-services).
- [Recreate](/docs/concepts/deployments#recreate) and [Rolling back a recreate deployment](/docs/concepts/rollback#rolling-back-a-recreate-deployment).
- The [`volumes`](/docs/reference/deploy-yaml#volumes) and [`deploy`](/docs/reference/deploy-yaml#deploy) fields in the deploy.yaml reference.
