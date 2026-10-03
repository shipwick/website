---
title: Keep a second server ready
description: Keep a standby Shipwick server that imports the first server's exports on a schedule with every application stopped, and start it by hand with shipwick standby promote, a promotion that is followed and survives a lost connection or a restart.
---

# Keep a second server ready

Shipwick does not fail over, and does not pretend to. What it can do is keep a second server honest: installed, holding a recent copy of everything the first one runs, deployed and stopped, with one command that starts it. A person decides when.

This page shows how to set up the two servers, what the standby holds and remembers, how to promote it on the day the first server is gone, how the promotion is followed, and what to do afterwards.

::: warning What a standby is not
Nothing watches the first server, nothing decides, and nothing prevents both servers from running at once. Expect minutes of downtime: the time to notice, to decide, and for DNS to follow. The data is as old as the last export.
:::

## Before you begin

- Both servers are installed as usual; see [Install Shipwick on a server](/docs/getting-started/install). Each has its own API token and its own encryption key.
- The first server has a bucket and a passphrase for its backups; see [Keep a copy off the server](/docs/tasks/backups#keep-a-copy-off-the-server). Exports go where backups go.
- `shipwick` knows both servers. Save the second one as a context of its own: `shipwick login --context standby --url https://agent.standby.example.com`.
- Pulling and promoting need the `admin` role; looking at what waits needs `read`.

An export is what [Move to a new server](/docs/tasks/move-to-a-new-server) describes: every application's configuration, the secrets, the images built by `shipwick deploy`, the static folders and an archive of every volume, in one encrypted file. A standby is a server that imports the newest one regularly, without starting anything.

## Set up the two servers

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

At those minutes the standby fetches the newest export from the bucket and imports it with every application deployed and not started: images pulled or loaded, volumes filled, containers created, nothing running, nothing routed, no `pre_deploy`. The next import replaces them the same way.

A standby only reads the bucket: its own backups stay on its disk, so the two servers never write to the same place.

## What the standby holds

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

**A standby remembers what it imported**, since 0.6, across restarts of its agent. An export the schedule has already imported is not imported again, so a restart costs no restore of every volume; one whose import failed or was cut off is taken again at the next scheduled minute. `shipwick import --status` and `shipwick standby` answer after a restart as before it. An import the agent was restarted under is shown as failed.

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

The applications are started in the order they were imported, each waited for until it is ready or its startup budget is spent. One that does not come up is reported and left to the supervisor, and the rest are started regardless; the command then exits non-zero. `--yes` skips the confirmation; outside a terminal it is required.

The records are every hostname of the promoted applications with the server's own addresses, which the agent knows when `SHIPWICK_AGENT_DOMAIN` or `SHIPWICK_DASHBOARD_DOMAIN` is set; without them the value reads `<this server's address>`. Visitors arrive once the records have changed and their old values have expired. Certificates are obtained when the records point at the server, unless you supplied them: those came with the export.

::: warning Nothing checks that the first server is really gone
If it is not, two servers run the same applications against the same outside services, and whichever the DNS names gets the visitors. Stop the applications there first if you can reach it.
:::

## A promotion is followed

Since 0.6 the promotion runs on the server, not in the command. `shipwick standby promote` asks for it and then follows it, printing each application as it comes up. A promotion is run on the worst day, so it is built to survive that day:

- **The connection drops.** The command waits and carries on. The promotion was never in danger: it has a record on the server.
- **The agent is restarted in the middle.** The agent that starts goes on with the promotion where it was: applications it had finished with keep their outcome, the one it was at is started if it is not running and waited for again, the rest follow. The command carries on too.
- **You lose the terminal.** Run the command again. While a promotion is under way it follows that one, without asking:

```text
A promotion is running on https://deploy2.example.com. Following it.
✓ postgres is running
✓ my-api is running
```

Afterwards `shipwick standby` says when the server was promoted and names what did not start:

```text
Promoted 5m ago: 2 applications started.
```

An import is refused while a promotion runs, and a promotion while an import runs; the scheduled import skips its turn.

A `shipwick` older than 0.6 still promotes a 0.6 server, in one request that is held until the end: it prints the outcome if its connection lasts that long, and nothing if it does not, though the promotion goes on. A 0.6 `shipwick` promotes an older server the same way and says so when the connection is lost.

## After a promotion

After a promotion this server is the service. An import that leaves applications stopped never touches one that runs, and keeps the secrets the server has, so a late export from the old server does no harm. All the same:

- Remove `SHIPWICK_STANDBY_SCHEDULE` from `/opt/shipwick/.env`.
- Give the server's backups a bucket prefix of their own, with `SHIPWICK_BACKUP_S3_PREFIX`, before you point `SHIPWICK_BACKUP_S3_*` at a bucket again.

Going back is the same procedure in the other direction.

## The dashboard

On a standby, the server's **Export and standby** tab shows what waits to be started, the scheduled fetch and how its last attempt went, **Import newest now** and **Promote…**, which is confirmed by typing `promote`.

A promotion is started and then shown as it runs: a row per application, and the DNS records to change from the first moment. It goes on when the page is closed, and opening the page while one runs shows it. See [Use the dashboard](/docs/tasks/dashboard#the-server).

## From a script

`POST /standby/promote?wait=false` answers `202` with the promotion's record; poll `GET /standby/promotion` until `completed_at` is set. A second promotion, or an import, while one runs is `409 PROMOTION_IN_PROGRESS`. See [the API reference](/docs/reference/api#post-standby-promote).

## What's next

- [Move to a new server](/docs/tasks/move-to-a-new-server): what an export holds and what an import does with it.
- [Back up and restore volumes](/docs/tasks/backups): the bucket and the passphrase exports share.
- [`shipwick standby`](/docs/reference/cli#standby) in the CLI reference.
- [`SHIPWICK_EXPORT_SCHEDULE` and `SHIPWICK_EXPORT_KEEP`](/docs/reference/agent-configuration#shipwick-export-schedule-and-shipwick-export-keep) and [`SHIPWICK_STANDBY_SCHEDULE`](/docs/reference/agent-configuration#shipwick-standby-schedule) in the agent configuration reference.
