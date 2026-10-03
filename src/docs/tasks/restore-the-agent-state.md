---
title: Bring a lost server back
description: Restore the Shipwick agent's own state - its database and encryption key - from a backup onto a new server, bring each application's data back, and record the backups taken since with shipwick backups adopt.
---

# Bring a lost server back

The server is gone: the disk failed, the machine was deleted. If the agent backed up its own state to a bucket, a new server can *be* the old one: same database, same key, same applications, same history. This page shows what that state is and how it is backed up, how to restore it on a new server, how to bring each application's data back, and how to have the agent record the backups it has forgotten.

To have a new installation take over what the old one runs instead — a planned move, with the old server still there — see [Move to a new server](/docs/tasks/move-to-a-new-server).

## The agent's own state

`shipwick.db` and `encryption.key`, in the agent's [data directory](/docs/reference/agent-configuration#data-directory), are what the agent knows: every application's configuration and history, the tokens, the access rules and the audit trail, and the secrets, which are unreadable without the key. The agent backs both up once a day, as a consistent copy of the database rather than a copy of a file in use, and keeps seven, under `_agent/` where application backups go.

It only ever writes them encrypted. **Without `SHIPWICK_BACKUP_PASSPHRASE` the key is written nowhere**, and `shipwick doctor` says so:

```text
! The encryption key exists only on this server. Set SHIPWICK_BACKUP_PASSPHRASE (and an S3 bucket) in /opt/shipwick/.env to back it up; losing it loses every secret
```

With a passphrase and a bucket it reads:

```text
✓ Agent state backed up 3h ago to s3
```

`GET /server` reports the same as `backups`: `destination` (`s3`, `local` or `none`), `encrypted`, `state_last_at`, the last successful backup of the state or `null`, and `state_error`, which says why there is none or why the last attempt failed.

`shipwick server backup` takes one now. It needs the `admin` role, and is refused without a passphrase. Setting up the bucket and the passphrase is described in [Keep a copy off the server](/docs/tasks/backups#keep-a-copy-off-the-server).

## Before you begin

You need:

- The passphrase.
- The two files of the newest backup of the state: the highest number under `<prefix>/_agent/` in the bucket, or under `/var/lib/shipwick/backups/_agent/` if the old disk is what you have.
- A new server, [installed as usual](/docs/getting-started/install), with the same backup lines in `/opt/shipwick/.env` as the old one.

Until the state is restored, the new server refuses to write into the old one's bucket and `shipwick doctor` says why. That refusal is what keeps the backups you are about to need.

## 1. Restore the state

```bash
# On your machine: decrypt the two files.
export SHIPWICK_BACKUP_PASSPHRASE='…'
shipwick backups decrypt shipwick.db.enc
shipwick backups decrypt encryption.key.enc
scp shipwick.db encryption.key user@server:/tmp/state/

# On the server, installed as usual and with the same lines in .env:
cd /opt/shipwick
docker compose stop agent
docker run --rm -v shipwick_agent-data:/data -v /tmp/state:/restore:ro busybox sh -c '
  rm -f /data/shipwick.db-wal /data/shipwick.db-shm &&
  cp /restore/shipwick.db /restore/encryption.key /data/ &&
  chmod 600 /data/shipwick.db /data/encryption.key'
docker compose start agent
rm -r /tmp/state
```

If `SHIPWICK_ENCRYPTION_KEY` is set in `.env`, put the key file's content there instead of copying the file.

The agent starts as the installation it was: it knows the applications, pulls their images and starts their containers again, on empty volumes.

## 2. Record the backups taken since

What the restored state does not know is what happened after it was taken. The backups taken since are still in the bucket, at `<prefix>/<application>/<id>/<volume>.tar.enc`, and the database has no record of them. Since 0.6 the agent records them, before or after the data is restored:

```bash
shipwick backups adopt
```

```text
BACKUP OF           ID   WHEN     SIZE     WHERE
postgres            13   5h ago   39 MB    s3 (encrypted)
the agent's state   14   4h ago   212 KB   s3 (encrypted)

✓ Adopted 2 backups
  an application's are listed with: shipwick backups <app>; prove that one restores with: shipwick backups verify <app> <id>
```

An adopted backup is listed with the trigger `adopted` and with what its files say: the volumes, their sizes, when they were written, encrypted or not. From then on it is a backup like any other: `verify`, `restore`, `download`, `rm`, and `keep` counts it.

What the files cannot say is whether the backup was finished:

- For the agent's state and for exports, whose files are known, an unfinished one is left alone and reported: `Backup #15 of the agent's state was left alone: encryption.key.enc is missing: the backup was not finished`.
- An application's is adopted with the volumes that are there, so run `shipwick backups verify` on one before you rely on it.

The command changes nothing in the bucket or the directory, adopts nothing twice, and refuses a bucket that another installation writes to. `shipwick backups adopt <app>` looks at one application only. A backup of an application the restored state does not know is recorded too, and listed once an application of that name is deployed. It needs the `admin` role.

With nothing to adopt it says so: `Nothing to adopt: the server knows every backup that its directory and bucket hold.`

## 3. Bring the data back

Per application, restore the newest backup:

```bash
shipwick stop postgres
shipwick backups postgres               # the backups the server knows, the adopted ones included
shipwick backups restore postgres 13    # read from the bucket
shipwick start postgres
```

See [Restore a backup the server keeps](/docs/tasks/backups#restore-a-backup-the-server-keeps).

## What does not come back by itself

- **Static applications** are deployed again from their folders, with `shipwick deploy`.
- **Hostnames** point at the old server's address: change their DNS records to the new one. Certificates are obtained again once they do.
- API tokens other than the one in `.env` come back with the database, as do the access rules and the audit trail.

## In the dashboard

The server's **Backups** tab has **Adopt backups** for admins, and an application's Backups tab adopts that application's. Both list what was adopted and what was left alone. Restoring the state itself is done on the server, with the agent stopped, as above: there is no button and no endpoint for it.

## What's next

- [Back up and restore volumes](/docs/tasks/backups): the schedule, the bucket, the passphrase, and verifying that a backup restores.
- [Move to a new server](/docs/tasks/move-to-a-new-server) and [Keep a second server ready](/docs/tasks/standby): the planned ways to another server.
- [`shipwick backups adopt`](/docs/reference/cli#backups-adopt) and [`shipwick server backup`](/docs/reference/cli#server-backup) in the CLI reference.
- [Rotate the encryption key](/docs/tasks/rotate-the-encryption-key).
