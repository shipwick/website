---
title: Move to a new server
description: Take everything a Shipwick server runs to another one with shipwick export and shipwick import, and keep a second server ready with a scheduled export, shipwick standby and shipwick standby promote.
---

# Move to a new server

Since 0.5, `shipwick export` writes everything a server runs into one encrypted file, and `shipwick import` on another server deploys what the file holds and restores its data. This page shows what an export contains, how to move with the two commands, what `import` does and in which order, what it leaves alone unless told otherwise, and then how to keep a second server ready with exports on a schedule: `shipwick standby`, `standby pull` and `standby promote`, and what that is not.

Moving is not the same as restoring. [Restoring the agent's state](/docs/tasks/backups#restore-the-agent-s-state-on-a-new-server) makes a new server *be* the old one: same database, same key, same history. Moving is a new installation that takes over what the old one runs.

## Before you begin

- The new server is installed as usual; see [Install Shipwick on a server](/docs/getting-started/install). It has its own API token and its own encryption key, and keeps them.
- Exporting and importing take a token with the `admin` role, on each server. See [Create tokens for CI and teammates](/docs/tasks/tokens).
- `shipwick` knows both servers. Save the new one as a context of its own: `shipwick login --context new --url https://agent.new.example.com`.
- You choose a passphrase of at least 12 characters for the file. It is asked for twice without echo, or read from `SHIPWICK_EXPORT_PASSPHRASE`. Without it the file cannot be read by anyone, including you.

## Move in two commands

```bash
# Against the old server:
shipwick export -o move.swexport

# Against the new one:
shipwick --context new import move.swexport
```

The export:

```text
Passphrase:
Once more:
✓ move.swexport (412.3 MB)
2 applications (postgres, my-api), 2 secrets, 1 registry credential

On the new server: shipwick import move.swexport
The file holds every secret of the server. Keep the passphrase: without it the file cannot be read.
```

Without `-o`, the file is `shipwick-export-<time>.swexport` in the current directory. `shipwick` reads the file back to its end before it calls it an export; one that was cut off is removed.

The import:

```text
Passphrase:
Export of 2026-10-03 14:02: 2 applications (postgres, my-api), 2 secrets, 1 registry credential
✓ postgres 17 (1 volume restored: data)
✓ my-api 1.4.2
✓ 2 secrets, 1 registry credential stored

Point the DNS records of the applications' hostnames at this server: each is served once its record does. shipwick status <app> names the ones that wait.
```

A wrong passphrase or a file that is not an export is found on your machine, before a byte is sent. The applications then run on the new server, and each hostname is served once its DNS record points there; `shipwick status <app>` names a hostname that is waiting, and the record it waits for. Certificates are obtained when the records point at the server, unless you supplied them: those came with the export.

## What an export holds

- Every application's active configuration, with its `env` values and basic-auth passwords.
- The stored secrets, registry credentials and certificates with their keys.
- The images that exist nowhere but on the server, which are the ones `shipwick deploy` built.
- The folders of static applications.
- A tar archive of every volume.

Deployment history, metrics, events, API tokens and backups stay behind: they describe the old server.

`--app <name>`, repeatable, limits the export to some applications; the secrets, credentials and certificates come along either way:

```bash
shipwick export -o move.swexport --app db --app api
```

**It is encrypted, always.** The file holds every secret the server has, in clear, inside the encryption backups use. The agent encrypts as it writes, so nothing leaves it unencrypted and nothing is kept on the server. The secrets in the database are sealed with the old server's key; they are opened for the export and sealed again on import with the new server's own key. The old key does not travel.

**A running application is held while its volumes are read**, the way a backup holds it: a `deploy` asked for meanwhile is told to wait, and an application that is being deployed fails the export, which names it. If its `deploy.yaml` has [`backups.before` or `backups.stop`](/docs/tasks/backups#back-up-on-a-schedule), the export does the same first. Without either, a database is copied while it writes, and what arrives is what a power cut would have left.

If the old server's Docker cannot write an image out, the export says so in the application's entry instead of failing, and the import skips that application with what to do: deploy it from its project, stop it, and bring its volumes over with `shipwick backup` and `shipwick restore`.

## What import does

In the order of the file:

1. It stores the secrets, registry credentials and certificates, under the new server's own key. A certificate that has expired since is refused and named.
2. For each application, one after the other: it loads the application's image if the file carries one; fills its volumes from the archives, through a container that is created for the purpose and never started; then deploys it like any deployment, pulled, health-checked and routed, and waits for it. The application's first process finds its data. Its deployment has the kind `import`.
3. Applications that were stopped on the old server are deployed stopped.

Images from a registry are pulled on the new server with the credentials the export brought. `pre_deploy` runs as in any deployment, except for an application that is deployed stopped.

**The order is the export's**: applications without a `domain` first, which are what the others reach by name, a database or a queue, then those with one, each group oldest first. An export knows no `after`; that belongs to a `shipwick.yaml`. If the order is wrong for an application, it fails its health check, the import says so and goes on, and `shipwick redeploy` brings it up once what it needs is there.

An application that fails does not stop the rest, and the command exits non-zero when anything failed. `shipwick import --status` shows the import that is running or ran last. A server takes one import at a time.

## Nothing is overwritten unless you say so

An application that exists on the new server is skipped and named; so is a secret, a credential or a certificate of the same name. A volume left behind by a deleted application of the same name fails that application's import, with the command that removes it.

`--overwrite` replaces all of these, an application together with its volumes, after asking:

```text
This replaces the applications of the same names on https://agent.new.example.com, and the data in their volumes. What they hold now is lost.
Type overwrite to confirm:
```

`--yes` skips the question; outside a terminal it is required.

| Flag | |
|---|---|
| `--overwrite` | Replace what exists under the same name, volumes included. |
| `--stopped` | Deploy the applications without starting them. This is how a standby is kept; see below. |
| `-y`, `--yes` | Do not ask before overwriting. |
| `--status` | Show the import that is running, or ran last. |

## Exports the server keeps

An export of the whole server can also be written on the server, to where its [backups](/docs/tasks/backups#where-backups-are-kept) go, encrypted with the agent's `SHIPWICK_BACKUP_PASSPHRASE`:

```bash
shipwick export --to-backups     # now
shipwick export --list           # the exports kept there
```

`SHIPWICK_EXPORT_SCHEDULE` on the agent does the same regularly, and `SHIPWICK_EXPORT_KEEP` says how many are kept: 3 unless you set it, from 1 to 100. Without a passphrase on the agent, `--to-backups` is refused and the agent does not start with the schedule set: an export is only ever written encrypted.

In the bucket the export is `<prefix>/_export/<id>/export.tar.enc`. Fetched and passed to `shipwick import` with that passphrase, it is the same file. Like every backup it is one upload, so an export larger than 5 GB fails when a bucket is configured.

## A second server kept ready

Shipwick does not fail over, and does not pretend to. What it can do is keep a second server honest: installed, holding a recent copy of everything the first one runs, deployed and stopped, with one command that starts it. A person decides when.

::: warning What a standby is not
Nothing watches the first server, nothing decides, and nothing prevents both servers from running at once. Expect minutes of downtime: the time to notice, to decide, and for DNS to follow. The data is as old as the last export.
:::

**On the first server**, an export on a schedule, next to its backups, in `/opt/shipwick/.env`:

```bash
SHIPWICK_BACKUP_PASSPHRASE=…          # and the SHIPWICK_BACKUP_S3_* variables
SHIPWICK_EXPORT_SCHEDULE=0 * * * *    # five fields, UTC
SHIPWICK_EXPORT_KEEP=3
```

**On the second server**, the same bucket variables and passphrase, and a schedule of its own:

```bash
SHIPWICK_STANDBY_SCHEDULE=15 * * * *
```

On each server, apply the change with `cd /opt/shipwick && docker compose up -d`. A server writes exports or stands by for one that does: the agent refuses to start with both schedules set, and with `SHIPWICK_STANDBY_SCHEDULE` but without the bucket and the passphrase of the first server.

At those minutes the standby fetches the newest export from the bucket and imports it with every application deployed and not started: images pulled or loaded, volumes filled, containers created, nothing running, nothing routed, no `pre_deploy`. The next import replaces them the same way. An export the schedule has already imported is not imported again.

A standby only reads the bucket: its own backups stay on its disk, so the two servers never write to the same place.

```bash
shipwick --context standby standby
```

```text
Imports the newest export from the bucket on schedule 15 * * * * (UTC); export #42 imported 12m ago

APPLICATION   VERSION   IMPORTED   HOSTNAMES
postgres      17        12m ago
my-api        1.4.2     12m ago    api.example.com

Deployed and stopped. Start them, in this order, with: shipwick standby promote
```

| | |
|---|---|
| `shipwick standby` | What is waiting, and when it arrived. Needs `read`. |
| `shipwick standby pull` | Import the newest export from the bucket now, stopped: what the schedule does. Needs `admin`. |
| `shipwick standby promote` | Start what is waiting and print the DNS records to change. Needs `admin`. |
| `shipwick import <file> --stopped --overwrite` | The same as `pull` from a file, for a standby without a bucket. |

Nobody has seen these applications run on the standby until the day they must. Promote it once on purpose, on a quiet day, before you rely on it.

## When the first server is gone

```bash
shipwick --context standby standby promote
```

```text
This starts 2 applications on https://deploy2.example.com: postgres, my-api.
The server they were exported from must no longer be serving.
Type promote to confirm: promote
✓ postgres is running
✓ my-api is running

Change these DNS records. Until they have changed, visitors still go to the old server:
HOSTNAME          TYPE   VALUE
api.example.com   A      203.0.113.77
```

The applications are started in the order they were imported, each waited for until it is ready or its startup budget is spent. One that does not come up is reported and left to the supervisor, and the rest are started regardless. `--yes` skips the confirmation; outside a terminal it is required.

The records are every hostname of the promoted applications with the server's own addresses, which the agent knows when `SHIPWICK_AGENT_DOMAIN` or `SHIPWICK_DASHBOARD_DOMAIN` is set; without them the value reads `<this server's address>`. Visitors arrive once the records have changed and their old values have expired. Certificates are obtained when the records point at the server, unless you supplied them: those came with the export.

::: warning Nothing checks that the first server is really gone
If it is not, two servers run the same applications against the same outside services, and whichever the DNS names gets the visitors. Stop the applications there first if you can reach it.
:::

After a promotion this server is the service. An import that leaves applications stopped never touches one that runs, and keeps the secrets the server has, so a late export from the old server does no harm. All the same:

- Remove `SHIPWICK_STANDBY_SCHEDULE` from `/opt/shipwick/.env`.
- Give the server's backups a bucket prefix of their own, with `SHIPWICK_BACKUP_S3_PREFIX`, before you point `SHIPWICK_BACKUP_S3_*` at a bucket again.

Going back is the same procedure in the other direction.

## The dashboard

The Servers page has, for an admin, an **Export** panel with **Export to backups** and the list of exports the server keeps. On a standby it has a **Standby** panel: what waits to be started, the scheduled fetch and how its last attempt went, **Import newest now** and **Promote…**, which is confirmed by typing `promote` and answers with the DNS records to change. A running import is shown while it runs, with each application's outcome afterwards.

An export to a file of your own, and `shipwick import`, stay with the CLI: the passphrase is typed where `shipwick` runs. See [Use the dashboard](/docs/tasks/dashboard).

## What's next

- [Back up and restore volumes](/docs/tasks/backups): the bucket and the passphrase exports share, and restoring a server as itself.
- [`shipwick export`](/docs/reference/cli#export), [`shipwick import`](/docs/reference/cli#import) and [`shipwick standby`](/docs/reference/cli#standby) in the CLI reference.
- [`SHIPWICK_EXPORT_SCHEDULE` and `SHIPWICK_EXPORT_KEEP`](/docs/reference/agent-configuration#shipwick-export-schedule-and-shipwick-export-keep) and [`SHIPWICK_STANDBY_SCHEDULE`](/docs/reference/agent-configuration#shipwick-standby-schedule) in the agent configuration reference.
- [A certificate of your own](/docs/tasks/certificates) and [Pull from private registries](/docs/tasks/private-registries): what an export carries along.
