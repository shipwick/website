---
title: Back up and restore volumes
description: Download the volumes of an application as tar archives with shipwick backup, put one back with shipwick restore, what a consistent copy of a database needs, and how to do the same from a script or the dashboard.
---

# Back up and restore volumes

An application with `volumes` keeps data that no redeploy, rollback or `delete` touches, and that nothing copies anywhere either. This page shows how to download those volumes with `shipwick backup`, what the archives are, how to put one back with `shipwick restore`, what a consistent copy of a database takes, how to see every volume on the server and remove what a deleted application left behind, and how a script or the dashboard does the same.

## Before you begin

- The application has `volumes` in its active deployment. An application without volumes answers `postgres has no volumes; there is nothing to back up or restore`.
- Downloading or uploading an archive needs a token with the `admin` role: a backup carries the application's data, a restore replaces it. Listing the volumes needs `read`. See [Create tokens for CI and teammates](/docs/tasks/tokens).
- The agent reads and writes the volume through the application's own container, so nothing needs to be installed on the server.
- This page is about application volumes. The agent's own data, the database `shipwick.db` and the key `encryption.key` in its data directory, is backed up separately; see [the data directory](/docs/reference/agent-configuration#data-directory).

## Back up

```bash
shipwick backup postgres
```

```text
! postgres is running; for a consistent copy of a database, stop it first or use its own dump tool: shipwick run postgres -- pg_dump ...
✓ postgres-data-20260927-153000.tar (412.3 MB)
```

Every volume of the application is downloaded, one archive each, into the current directory. The file is `<application>-<volume>-<UTC timestamp>.tar`; an existing file is never overwritten, and a download that breaks off leaves no half-written file behind.

| Flag | |
|---|---|
| `--volume <name>` | Back up only this volume. Default: every volume. |
| `-o`, `--output <dir>` | Directory to write the archives to. Default: the current directory. |
| `-f <file>` | Read the application's name from another `deploy.yaml`. Without an argument, `backup` uses the one in the current directory. |

The warning goes to standard error and is printed whenever a replica is running. A backup is taken while the application runs, and a database that is being written to at that moment may not be consistent in the copy. Two ways around it:

- **Stop the application first.** `shipwick stop postgres`, back up, `shipwick start postgres`. The copy is exactly what is on disk, at the cost of a short outage.
- **Use the database's own dump tool**, which produces a consistent snapshot while the database runs. `shipwick run` keeps only the last 200 lines and 64 KB of a command's output, so it cannot carry a dump of any size back to you; run `pg_dump` where it can write a file instead, for example on the server with `docker exec` into the replica container (`shipwick_postgres_7_1`, as `shipwick status` lists it), or from a machine that reaches the database through a [published port](/docs/tasks/non-http-services).

::: info A backup locks the application
While an archive streams, the application refuses other operations: a deployment asked for meanwhile is refused with `Another operation is already in progress for this application.` The replicas keep serving.
:::

## What an archive is

A plain tar file holding the volume's contents, relative to the mount point: for PostgreSQL's `/var/lib/postgresql/data`, the entries are `base/…`, `pg_wal/…` and so on, not `data/base/…`. Nothing is compressed, and nothing Shipwick-specific is inside. Anything that can read a tar can inspect it, and anything that writes such a tar can be restored, so a backup made another way, or the volume of another server, restores as well.

The archive grows with the volume. A restore accepts up to 10 GB.

## Restore

A restore replaces **everything** in the volume with the archive's contents. It requires the application to be stopped, and leaves it stopped:

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

```bash
shipwick start postgres
```

| Flag | |
|---|---|
| `--volume <name>` | The volume to restore. Required when the application has several: `postgres has 2 volumes; name one with --volume: data, config`. |
| `-y`, `--yes` | Do not ask for confirmation. Outside a terminal it is required: `refusing to restore without confirmation; pass --yes`. |

What happens on the server, in order: the replica container is removed, the volume with it, both are created again, and the archive is extracted into the mount point. What the archive does not name is gone. The application's event feed records `Volume data restored from a backup (412.3 MB)`.

Before anything is touched:

- The file must start like a tar archive, or `shipwick` refuses it on your machine: `dump.sql is not a tar archive; restore takes the .tar written by shipwick backup`. The agent checks again.
- The application must be stopped, and none of its replicas may still be running:

```text
The application is running, and a restore replaces the files under it.

Stop it first with: shipwick stop
```

In a terminal the upload shows its progress. A restore is not undone by a rollback: a rollback is a new deployment of an earlier configuration, and the volume belongs to the application, not to a deployment. Keep the archive you replaced, if you may want it back.

## Volumes of deleted applications

`shipwick delete` removes an application, its containers and its history, and leaves its volumes where they are, on purpose. `shipwick volumes` lists every volume Shipwick created on the server, by its Docker name, with the application it was created for, how much it holds, and whether that application still exists:

```bash
shipwick volumes
```

```text
NAME                    APPLICATION   SIZE      STATUS
shipwick_postgres_data  postgres      2.5 GB    in use
shipwick_pgtest_data    pgtest        13.0 MB   application deleted
```

A volume whose application was deleted is removed, with everything in it, with `shipwick volumes rm`:

```bash
shipwick volumes rm shipwick_pgtest_data
```

```text
✓ Removed volume shipwick_pgtest_data (13.0 MB)
```

It asks first; `--yes` skips the question. A volume whose application still exists is refused: its data belongs to the application, and a restore is the way to replace it. Listing needs the `read` role, removing `admin`. Nothing else removes a volume; `docker volume rm` on the server does the same by hand.

## From a script

The two archive endpoints carry the tar file itself as the body, both ways, and need the `admin` role.

```bash
# Download. -J takes the file name from the agent: postgres-data-<UTC timestamp>.tar
curl -H "Authorization: Bearer $SHIPWICK_AGENT_TOKEN" -OJ \
  https://agent.example.com/api/v1/applications/postgres/volumes/data/archive

# Restore into a stopped application.
curl -X PUT -H "Authorization: Bearer $SHIPWICK_AGENT_TOKEN" -H "Content-Type: application/x-tar" \
  --data-binary @postgres-data-20260927-153000.tar \
  https://agent.example.com/api/v1/applications/postgres/volumes/data/archive
```

| Method | Path | Role | |
|---|---|---|---|
| `GET` | `/applications/:name/volumes` | read | The volumes of the active deployment: `[{name, path}]` |
| `GET` | `/applications/:name/volumes/:volume/archive` | admin | The archive, `Content-Type: application/x-tar`, streamed as it is read |
| `PUT` | `/applications/:name/volumes/:volume/archive` | admin | Replace the volume with the archive in the body → `204` |
| `GET` | `/volumes` | read | Every volume on the server: `[{name, application, volume, size_bytes, orphan}]` |
| `DELETE` | `/volumes/:name` | admin | Remove a volume of a deleted application → `204`; `409 VOLUME_IN_USE` while the application exists |

A restore of an application that is not stopped is `409 APPLICATION_RUNNING`; a body that does not start with a tar header is `400 INVALID_REQUEST`, and nothing has been touched; a body over 10 GB is `413`. A download that fails after the first byte can only cut the connection, so check the exit code of `curl` and the size of the file. See [the API reference](/docs/reference/api#get-applications-name-volumes-volume-archive).

## The dashboard

An application with volumes has a Volumes card. **Download** saves the archive under the agent's file name. **Restore** is offered only while the application is stopped: it checks that the file starts with a tar header, uploads it with a progress bar, shows the agent's own event when it is done, and offers **Start**. Both need the `admin` role. The Volumes page lists every volume on the server with its application and size, and lets an admin remove the volume of a deleted application. See [Use the dashboard](/docs/tasks/dashboard).

## What's next

- [Run a database or other stateful application](/docs/tasks/stateful-applications): where the volume lives and what survives which operation.
- [`shipwick backup`](/docs/reference/cli#backup), [`shipwick restore`](/docs/reference/cli#restore) and [`shipwick volumes`](/docs/reference/cli#volumes) in the CLI reference.
- The [`volumes`](/docs/reference/deploy-yaml#volumes) field in the deploy.yaml reference.
