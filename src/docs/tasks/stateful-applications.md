---
title: Run a database or other stateful application
description: Run PostgreSQL or another application that keeps data on a Shipwick server, with a named volume and the recreate strategy, and what happens to the data on redeploy, rollback and delete.
---

# Run a database or other stateful application

An application that keeps data, a database above all, needs two things that a stateless one does not: a volume that outlives its containers, and a deployment that never runs two versions on that volume at once. This page shows how to run PostgreSQL under Shipwick, where its data lives, what survives which operation, and how other applications reach it.

## Before you begin

- The data lives in a named Docker volume on the server. Shipwick does not back volumes up.
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
| `${POSTGRES_PASSWORD}` | Filled in by `shipwick` when you deploy, from its environment or an `--env-file`, so that the password is not in the file. See [Placeholders](/docs/reference/cli#placeholders). |
| `volumes` | A named Docker volume, mounted at the path where PostgreSQL keeps its data. Up to 10 per application. |
| `deploy.strategy: recreate` | Required with `volumes`. Two versions writing the same files at once is how data gets lost. |

There is no `health` block: the check is an HTTP request, and PostgreSQL does not speak HTTP. Without one, a deployment verifies that the new replica is still running after 3 seconds, and the supervisor restarts it when it exits.

Validation refuses volumes without `recreate` and with more than one replica; the messages are in the [deploy.yaml reference](/docs/reference/deploy-yaml#volumes).

## Deploy

Put the password in a `NAME=value` file that stays out of the repository, and pass it with `--env-file`:

```text
# .env.production
POSTGRES_PASSWORD=s3cret
```

```bash
shipwick validate --env-file .env.production
```

```text
✓ deploy.yaml is valid (1 variable substituted)

Name           postgres
Image          postgres:17
Version        17
Replicas       1
Port           5432
Resources      unlimited CPU, unlimited memory
Volume         data at /var/lib/postgresql/data
Restart        always
Strategy       recreate
Environment    1 variables
```

```bash
shipwick deploy --env-file .env.production
```

On the first deployment there is nothing to stop. The volume is created and the replica starts:

```text
Deploying postgres...

✓ Validated deploy.yaml (1 variable substituted)
✓ Pulled image postgres:17
✓ Started 1 container
✓ Replica 1 running and stable
✓ Deployment successful
```

The password is never printed. `deploy` says only how many placeholders it filled in.

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

## What survives what

| Operation | The volume |
|---|---|
| `shipwick deploy` of a new version | Kept. The new container mounts it. |
| `shipwick redeploy` | Kept. |
| `shipwick rollback` | Kept. The earlier version finds the data the later one left behind; make sure it can read it. |
| A failed deployment | Kept. The new containers are removed before the old ones are started again. |
| `shipwick stop`, `shipwick start` | Kept. |
| `shipwick delete postgres` | Kept. The containers and the history go; the volume stays. |
| `docker volume rm shipwick_postgres_data` on the server | Removed. This is the only way, and it is yours to run. |

Shipwick does not back volumes up. Whatever you do for backups today, you keep doing on the volume.

## Deploying a new version

`recreate` stops the running version before it starts the new one, because two PostgreSQL processes on one data directory would corrupt it. Change the image tag and deploy:

```text
Deploying postgres...

✓ Validated deploy.yaml (1 variable substituted)
✓ Pulled image postgres:17.1
✓ Stopped 17: 17.1 cannot run next to it
✓ Started 1 container
✓ Replica 1 running and stable
✓ Replica 1/1 is serving 17.1; its 17 predecessor is retired
✓ Deployment successful
```

The database is down from `Stopped` to `running and stable`: the time the new version takes to start, plus the 3 second stabilization window. Applications that use it see connection failures during that time, and should reconnect; a connection pool does.

If the new version fails to start, the new container is removed and the old one, kept stopped, is started again: the deployment ends as `ROLLED_BACK`, and the data is as the old version left it. See [Rolling back a recreate deployment](/docs/concepts/rollback#rolling-back-a-recreate-deployment).

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

The name is carried by the replica while it is ready, which for an application without a health check means while it runs. During a recreate deployment nobody carries it, and lookups fail until the new version is up. See [Call one application from another](/docs/tasks/call-another-application).

Deploy the database before the applications that need it; several files deploy in order:

```bash
shipwick deploy -f postgres/deploy.yaml -f api/deploy.yaml --env-file .env.production
```

## What's next

- [Recreate](/docs/concepts/deployments#recreate) and [Rolling back a recreate deployment](/docs/concepts/rollback#rolling-back-a-recreate-deployment).
- The [`volumes`](/docs/reference/deploy-yaml#volumes) and [`deploy`](/docs/reference/deploy-yaml#deploy) fields in the deploy.yaml reference.
