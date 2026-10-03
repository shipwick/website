---
title: Back up and restore volumes
description: Have the server back up an application's volumes on a schedule with backups in deploy.yaml, keep a copy in an S3-compatible bucket, encrypt it, prove that a backup restores with shipwick backups verify, and move a single archive to or from your machine with shipwick backup and shipwick restore.
---

# Back up and restore volumes

An application with `volumes` keeps data that no redeploy, rollback or `delete` touches. Nothing copies that data anywhere until you ask for it, and there are two ways to ask. Since 0.5 the server takes backups itself: on a schedule under `backups` in `deploy.yaml`, kept on the server and, when you give the agent a bucket, off it, encrypted if you set a passphrase. And `shipwick backup` downloads the volumes as they are right now to your machine, as it always has.

This page covers both: the `backups` block and what makes a backup consistent, the `shipwick backups` commands, where backups are kept and how the oldest are removed, a bucket on any S3-compatible service, encryption, proving that a backup restores, restoring one, and then `shipwick backup` and `shipwick restore`, the volumes of deleted applications, and how a script or the dashboard does the same. The backup of the agent's own state, and bringing a lost server back from it, is in [Bring a lost server back](/docs/tasks/restore-the-agent-state).

## Before you begin

- The application has `volumes` in its active deployment. An application without volumes answers `postgres has no volumes; there is nothing to back up or restore`, and a `backups` block without `volumes` is refused by validation: `needs volumes: a backup is an archive of the application's volumes`.
- Listing backups and volumes needs the `read` role. Taking a backup and verifying one need `deploy`. Everything that hands data out or replaces it needs `admin`: restoring, downloading, removing a backup, `shipwick backup`, `shipwick restore`, and backing up the agent's state. See [Create tokens for CI and teammates](/docs/tasks/tokens).
- The agent reads and writes the volume through the application's own container, so nothing needs to be installed on the server.
- The bucket and the passphrase are set on the agent, in `/opt/shipwick/.env` on the server; see [Backups](/docs/reference/agent-configuration#backups) in the agent configuration reference.

## Two kinds of backup

| | Backups the server takes | `shipwick backup` |
|---|---|---|
| Started by | The schedule under `backups`, or `shipwick backups run` | You, each time |
| Kept | On the server and in the bucket; the oldest beyond `keep` are removed | In the directory you ran it in; the server keeps nothing |
| Consistent copy of a database | `before` runs a dump first, or `stop: true` stops the application for the archive | Stop the application first |
| Encrypted | With `SHIPWICK_BACKUP_PASSPHRASE` | No: a plain tar file |
| Put back with | `shipwick backups restore <app> <id>` | `shipwick restore <app> <file>` |

Both produce the same thing, one tar archive per volume. A backup the server keeps can be downloaded as such an archive with `shipwick backups download`, and anything downloaded goes back in with `shipwick restore`.

## Back up on a schedule

Add a `backups` block to the application's `deploy.yaml` and deploy:

```yaml
name: postgres
image: postgres:17
volumes:
  - name: data
    path: /var/lib/postgresql/data
deploy:
  strategy: recreate
backups:
  schedule: "0 3 * * *"     # five cron fields, UTC, like jobs
  keep: 7                   # successful backups kept; default 7
  before: ["pg_dump", "-U", "postgres", "-f", "/var/lib/postgresql/data/backup.sql", "app"]
  before_timeout: 1h        # how long `before` may run; default 1h, up to 24h
  stop: false               # stop the application for the archive; default false
```

| Field | Default | |
|---|---|---|
| `schedule` | required | Five cron fields, in UTC: minute, hour, day of month, month, day of week. |
| `keep` | `7` | How many successful backups are kept, from 1 to 365. |
| `before` | none | A command run inside the running replica before the archive is taken. |
| `before_timeout` | `1h` | How long `before` may run, from 1s to 24h. Since 0.6. Needs `before`. |
| `stop` | `false` | Stop the application while the archive is taken. |

Two things decide whether what is in a backup can be trusted:

- **`before`** runs inside the running replica first, as a list of arguments, never through a shell: a dump written into the volume, a checkpoint. If it exits non-zero the backup fails and nothing is archived, because an archive without the dump it was meant to hold is not the backup you asked for. It has an hour, or what `before_timeout` says, up to 24h; the application is held for as long as it runs. A command still running at the limit fails the backup the same way, with an error that names the key. Docker has no way to end a command once it was started in a container, so one that hangs stays there until it ends by itself or the application is deployed or restarted; the backup no longer waits for it.
- **`stop: true`** stops the application for as long as the archive takes and starts it again whatever happens, a failed backup included. This is the one way to a consistent copy of files a process keeps open and has no dump tool for. The application is down meanwhile, and its event feed says so.

Both may be given: the command runs, then the application stops. Without either, the archive is taken from under the running process, which is fine for uploads and not for a database.

`shipwick validate` shows what the block will have the server do, in a `Backups` line such as `daily at 03:00 UTC, 7 kept, after pg_dump -U postgres -f /var/lib/postgresql/data/backup.sql app`. Once deployed, `shipwick status` has a line for it:

```text
Backups   daily at 03:00 UTC, last 5h ago (2.1 GB), 7 kept
```

or the failure, with when the last good one was taken.

A stopped application is not backed up on schedule; `shipwick backups run` still works on it. A schedule that fires while the application is being deployed is not lost: the backup is taken when the deployment is over.

## See and take backups

```bash
shipwick backups postgres
```

```text
ID   WHEN      TRIGGER    SIZE      WHERE                   STATUS      VERIFIED
5    25s ago   schedule   39 MB     local, s3 (encrypted)   succeeded   -
4    42s ago   manual     39 MB     local, s3 (encrypted)   succeeded   -
3    1m ago    schedule   39.1 MB   local, s3 (encrypted)   succeeded   1m ago
```

Without an argument, the application described by `deploy.yaml` is shown. `WHERE` is `local` for the directory on the server and `s3` for the bucket. `TRIGGER` is `schedule`, `manual`, or `adopted` for a backup that was recorded from its files.

| | | Needs |
|---|---|---|
| `shipwick backups <app>` | The backups the server keeps | `read` |
| `shipwick backups run <app>` | Take one now, as the schedule would; works without a `backups` block too | `deploy` |
| `shipwick backups verify <app> [id]` | Prove that a backup restores; the latest unless an id is given | `deploy` |
| `shipwick backups restore <app> <id>` | Replace the volumes with a backup's contents. The application must be stopped and stays stopped; asks for its name | `admin` |
| `shipwick backups download <app> <id> [-o dir]` | Fetch a backup's archives, decrypted, as `<app>-<volume>-backup-<id>.tar` | `admin` |
| `shipwick backups rm <app> <id>` | Remove one, from the server and the bucket | `admin` |
| `shipwick backups decrypt <file>` | Decrypt a file taken from the server or the bucket, on your machine | none: it talks to no server |
| `shipwick backups adopt [app]` | Record the backups that the directory and the bucket hold and the agent's database does not know, as after [restoring the agent's state](/docs/tasks/restore-the-agent-state); everything, or one application's. Since 0.6 | `admin` |

`shipwick backups run` takes a backup the way the schedule would: `before` runs first, and the application is stopped for the archive when `stop` says so. An application without a `backups` block is archived as it runs.

```bash
shipwick backups run postgres
```

```text
✓ Backup #6 of postgres: 39 MB to local, s3 (encrypted)
  prove that it restores with: shipwick backups verify postgres
```

::: info A backup holds the application
While a backup runs the application is held, as during a deployment. A `deploy`, `stop` or `restore` asked for meanwhile waits up to 30 seconds for a scheduled backup to finish, and is refused at once with `Another operation is already in progress for this application.` during one taken by hand. The supervisor does not restart replicas of that application until the archive is written.
:::

## Where backups are kept

Always in a directory on the server: `<data dir>/backups/<application>/<id>/<volume>.tar`, which with the installer's setup is inside the agent's data volume. `SHIPWICK_BACKUP_DIR` moves it, for example to a mount of another disk added in `/opt/shipwick/compose.override.yml`.

After a backup succeeds, the oldest beyond `keep` are removed. Only successful backups count towards `keep`: a week of failures never pushes out the one backup that worked. A backup that fails keeps nothing at all.

Deleting an application keeps its backups, like its volumes: they are listed again when an application of that name is deployed.

::: warning A backup on the same disk is not a backup of the server
It protects against a bad deployment, a dropped table, a mistake. It does not protect against losing the server. For that, give the agent a bucket.
:::

## Keep a copy off the server

Give the agent a bucket on any S3-compatible service, in `/opt/shipwick/.env` on the server:

```bash
SHIPWICK_BACKUP_PASSPHRASE=<a long passphrase; keep a copy off the server>
SHIPWICK_BACKUP_S3_ENDPOINT=https://s3.example.com
SHIPWICK_BACKUP_S3_BUCKET=shipwick-backups
SHIPWICK_BACKUP_S3_ACCESS_KEY_ID=…
SHIPWICK_BACKUP_S3_SECRET_ACCESS_KEY=…
```

Then apply the change:

```bash
cd /opt/shipwick && docker compose up -d
```

The bucket needs all four `SHIPWICK_BACKUP_S3_*` variables; `SHIPWICK_BACKUP_S3_REGION` and `SHIPWICK_BACKUP_S3_PREFIX` are optional. A mistake in them stops the agent at startup rather than failing the first backup at night.

Every backup then goes to the directory *and* to the bucket, under `<prefix>/<application>/<id>/`, and one that did not reach both has failed: nothing is kept of it. `keep` applies in both places. When the server's copy is gone, a restore, a verification or a download reads the backup from the bucket.

- **A large archive goes up in parts.** Since 0.6 an archive of more than 64 MiB is a multipart upload: in parts of that size, read from the file on the server one after the other, so that its size costs no memory, and a part that fails is sent again, up to three times in all. The limit is the service's own for one object, 5 TiB on S3; the server's disk has to hold the archive first. Before 0.6 an archive larger than 5 GB failed.
- **No parts are left to be paid for.** An upload that fails or is interrupted is aborted. For the upload an agent did not live to abort — the server lost power in the middle of an archive — the agent leaves a note next to the file for as long as it is being sent, and the next agent aborts what the notes name before its own first upload. If the disk went with the agent, it asks the bucket for the unfinished uploads under its prefix and aborts those named like a backup's files. Not every service answers that question: MinIO lists unfinished uploads only under an exact key, and removes stale ones by itself. A lifecycle rule on the bucket that aborts incomplete multipart uploads after a few days costs nothing and is the last line.
- **A bucket belongs to one server.** The agent marks the bucket, under its prefix, the first time it writes there, and refuses a bucket marked by another installation: a server set up afresh counts its backups from 1 again and would write over the ones it is about to be restored from. Two servers share a bucket by giving each a `SHIPWICK_BACKUP_S3_PREFIX`.

## Encrypt backups

With `SHIPWICK_BACKUP_PASSPHRASE` set, at least 12 characters, everything is encrypted before it is written anywhere, in the directory and in the bucket alike: AES-256-GCM with a key derived from the passphrase. The files are then named `<volume>.tar.enc`.

The agent decrypts when it restores, verifies or serves a download, so `shipwick backups restore`, `verify` and `download` work as before. For a file you fetched from the bucket or the server yourself, `shipwick backups decrypt` does it on your machine, without talking to any server:

```bash
export SHIPWICK_BACKUP_PASSPHRASE='…'
shipwick backups decrypt data.tar.enc
```

```text
✓ data.tar (39 MB)
```

The passphrase is read from `SHIPWICK_BACKUP_PASSPHRASE`, or asked for without echo. The result is written next to the file, without the `.enc` ending, unless `-o` says otherwise; an existing file is never overwritten.

Backups written before the passphrase was set stay readable. If the passphrase changes, the ones written with the old one are not. Keep a copy of the passphrase off the server: without it, nothing the agent wrote can be read.

## Verify that a backup restores

A backup nobody has restored is a hope. `shipwick backups verify` restores one into scratch volumes, starts a single container of the application's current image on them, and holds it to the application's health check exactly as a deployment would, `start_period` included; without a health check, to staying up for the stabilization window.

```bash
shipwick backups verify postgres
```

```text
✓ Backup #5 of postgres restores: a container of the current version came up on its data
```

That container is not a replica: it has no route, no name another application could find it under, no published ports, and the supervisor ignores it. It and the scratch volumes are removed whatever happened, and the application keeps running untouched. The backup is marked verified, or not: the `VERIFIED` column shows when it last proved to restore, or `failed`. On failure you get the reason and the container's last output.

::: warning The container runs with the application's environment
An application that writes somewhere other than its volumes when it starts, such as migrations against another database or a queue, does that during a verification too.
:::

## Restore a backup the server keeps

A restore replaces everything in the application's volumes with what the backup holds. The application must be stopped, and stays stopped afterwards:

```bash
shipwick stop postgres
shipwick backups restore postgres 5
```

```text
This replaces the data in the volumes of postgres with backup #5. What they hold now is lost.
Type the application name to confirm: postgres
✓ Restored backup #5 into postgres
Start it with: shipwick start postgres
```

`--yes` skips the question; outside a terminal it is required. Look at the result, then `shipwick start postgres`.

To have the archives on your machine instead:

```bash
shipwick backups download postgres 5
```

```text
✓ postgres-data-backup-5.tar (39 MB)
```

The archives arrive decrypted, one per volume, in the current directory or the one given with `-o`, as `shipwick restore` takes them. Existing files are never overwritten.

`shipwick backups rm postgres 3` removes a backup from the server and the bucket. It does not ask first.

## When a backup fails

A failed backup is listed with `failed` in `shipwick backups`, with its reason under the table, and `shipwick status` shows `last one failed` with the reason and when the last good one was taken. A scheduled backup that fails adds an event to the application's feed and is posted to the webhook as `backup.failed`; so is a failed daily backup of the agent's own state. See [Get notified](/docs/tasks/notifications).

## The agent's own state

`shipwick.db` and `encryption.key` are what the agent knows: every application's configuration and history, the tokens, and the secrets, which are unreadable without the key. With `SHIPWICK_BACKUP_PASSPHRASE` set, the agent backs both up once a day, encrypted, and keeps seven, under `_agent/` where application backups go. **Without the passphrase the key is written nowhere**, and `shipwick doctor` says so. `shipwick server backup` takes one now; it needs the `admin` role.

When the server is lost, that backup makes a new server be the old one, and `shipwick backups adopt` then records the backups taken since. The procedure has a page of its own: [Bring a lost server back](/docs/tasks/restore-the-agent-state).

## Download a volume to your machine

`shipwick backup` is the other kind: it downloads the volumes as they are right now, and the server keeps nothing.

```bash
shipwick backup postgres
```

```text
! postgres is running; a copy taken now may be inconsistent. For a database, stop it first: shipwick stop postgres
✓ postgres-data-20260927-153000.tar (412.3 MB)
```

Every volume of the application is downloaded, one archive each, into the current directory. The file is `<application>-<volume>-<UTC timestamp>.tar`; an existing file is never overwritten, and a download that breaks off leaves no half-written file behind.

| Flag | |
|---|---|
| `--volume <name>` | Back up only this volume. Default: every volume. |
| `-o`, `--output <dir>` | Directory to write the archives to. Default: the current directory. |
| `-f <file>` | Read the application's name from another `deploy.yaml`. Without an argument, `backup` uses the one in the current directory, or the one application of a `shipwick.yaml`. |

The warning goes to standard error and is printed whenever a replica is running. The copy is taken while the application runs, and `before` and `stop` from the `backups` block do not apply here. A database that is being written to at that moment may not be consistent in the copy. Three ways around it:

- **Stop the application first.** `shipwick stop postgres`, back up, `shipwick start postgres`. The copy is exactly what is on disk, at the cost of a short outage.
- **Let the server take it.** `shipwick backups run postgres` honours `before` and `stop`, and `shipwick backups download` brings the result to your machine.
- **Use the database's own dump tool**, which produces a consistent snapshot while the database runs. `shipwick run` keeps only the last 200 lines and 64 KB of a command's output, so it cannot carry a dump of any size back to you; run `pg_dump` where it can write a file instead, for example on the server with `docker exec` into the replica container (`shipwick_postgres_7_1`, as `shipwick status` lists it), or from a machine that reaches the database through a [published port](/docs/tasks/non-http-services).

While an archive streams, the application refuses other operations: a deployment asked for meanwhile is refused with `Another operation is already in progress for this application.` The replicas keep serving.

## What an archive is

A plain tar file holding the volume's contents, relative to the mount point: for PostgreSQL's `/var/lib/postgresql/data`, the entries are `base/…`, `pg_wal/…` and so on, not `data/base/…`. Nothing is compressed, and nothing Shipwick-specific is inside. Anything that can read a tar can inspect it, and anything that writes such a tar can be restored, so a backup made another way, or the volume of another server, restores as well. The backups the server keeps hold the same archives, encrypted when a passphrase is set.

The archive grows with the volume. A restore accepts up to 10 GB.

## Restore an archive from your machine

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

- The file must start like a tar archive, or `shipwick` refuses it on your machine: `dump.sql is not a tar archive; restore takes the .tar written by shipwick backup`. The agent checks again. A file still encrypted is decrypted first with `shipwick backups decrypt`.
- The application must be stopped, and none of its replicas may still be running:

```text
The application is running, and a restore replaces the files under it.

Stop it first with: shipwick stop
```

In a terminal the upload shows its progress. A restore, of either kind, is not undone by a rollback: a rollback is a new deployment of an earlier configuration, and the volume belongs to the application, not to a deployment. Keep the archive you replaced, if you may want it back.

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

The backups the agent keeps are started and followed like deployments: a request answers `202` with the backup, and you poll it.

| Method | Path | Role | |
|---|---|---|---|
| `GET` | `/applications/:name/backups` | read | The backups the agent took, newest first |
| `GET` | `/applications/:name/backups/:id` | read | One backup, with the output of its last verification |
| `POST` | `/applications/:name/backups` | deploy | Take a backup now → `202`; poll until `completed_at` is set |
| `POST` | `/applications/:name/backups/:id/verify` | deploy | Prove that it restores; `:id` may be `latest` → `202`; poll until `activity` is empty, then read `verified_at` or `verify_error` |
| `POST` | `/applications/:name/backups/:id/restore` | admin | Replace the volumes of the stopped application → `202`; poll until `activity` is empty, then read `restored_at` or `restore_error` |
| `GET` | `/applications/:name/backups/:id/volumes/:volume/archive` | admin | One volume of the backup as a tar archive, decrypted |
| `DELETE` | `/applications/:name/backups/:id` | admin | Remove the backup from every destination → `204` |
| `GET` | `/server/backups` | admin | The backups of the agent's own state |
| `POST` | `/server/backups` | admin | Back up the agent's state now → `202`; `409 BACKUPS_NOT_ENCRYPTED` without a passphrase |
| `POST` | `/server/backups/adopt` | admin | Record the backups the destinations hold and the database does not know → `{adopted, skipped}`; `409 FOREIGN_BUCKET` for a bucket another installation writes to |

An application without volumes is `409 NO_VOLUMES`. A backup that failed cannot be verified, restored or downloaded: `409 BACKUP_NOT_USABLE`. One that is still running, or being verified or restored, is `409 BACKUP_BUSY`. There is no endpoint that restores the agent's state; that is done with the agent stopped; see [Bring a lost server back](/docs/tasks/restore-the-agent-state).

The two archive endpoints of a volume carry the tar file itself as the body, both ways, and need the `admin` role.

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

An application with volumes has a **Backups** tab: the schedule and how the last backup went, every backup with when it was taken, what started it, its size, where it is kept, its status and whether it was verified. **Back up now** and **Verify** need the `deploy` role. Opening a backup shows the output of its verification and, for an admin, a **Download** per volume, **Restore…**, offered only while the application is stopped and confirmed by typing the application's name, and **Remove**.

The server's page has a **Backups** tab of its own: where backups are kept, whether they are encrypted, when the agent's own state was last backed up or why it is not, and, for an admin, the list of state backups, **Back up state now** and **Adopt backups**.

The Volumes card on the application's Backups tab is `shipwick backup` and `shipwick restore`. **Download** saves the archive under the agent's file name. **Restore** is offered only while the application is stopped: it checks that the file starts with a tar header, uploads it with a progress bar, shows the agent's own event when it is done, and offers **Start**. Both need the `admin` role. The Volumes page lists every volume on the server with its application and size, and lets an admin remove the volume of a deleted application. See [Use the dashboard](/docs/tasks/dashboard).

## What's next

- [Run a database or other stateful application](/docs/tasks/stateful-applications): where the volume lives and what survives which operation.
- [Bring a lost server back](/docs/tasks/restore-the-agent-state): the agent's own state, and `shipwick backups adopt`.
- [Move to a new server](/docs/tasks/move-to-a-new-server) with `shipwick export` and `import`, and [Keep a second server ready](/docs/tasks/standby).
- [`shipwick backups`](/docs/reference/cli#backups), [`shipwick backup`](/docs/reference/cli#backup), [`shipwick restore`](/docs/reference/cli#restore), [`shipwick server backup`](/docs/reference/cli#server-backup) and [`shipwick volumes`](/docs/reference/cli#volumes) in the CLI reference.
- The [`backups`](/docs/reference/deploy-yaml#backups) and [`volumes`](/docs/reference/deploy-yaml#volumes) fields in the deploy.yaml reference, and the [`SHIPWICK_BACKUP_*` variables](/docs/reference/agent-configuration#backups) of the agent.
