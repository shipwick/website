---
title: When things break
description: What you see, what Shipwick does by itself and what is left for you when the server's disk is full, the Docker daemon does not answer, an image pull stalls or is cut, the agent is killed in the middle of a deployment, the proxy cannot be reached, or the server reboots.
---

# When things break

Shipwick stands on a disk, a Docker daemon, a proxy and a server, and each of them fails sooner or later. This page says, for each, what you see when it does, what Shipwick does by itself, and what is left for you.

Every entry was produced — with the agent's tests, and on a server with a Docker daemon that was frozen, cut off from its registry, filled up or switched off — and the messages are the ones that came out. One rule holds throughout: **applications that are running keep running.** None of these failures stops a container that Shipwick did not already mean to stop.

## The disk is full

The disk that holds the agent's data directory is, in the standard installation, the one Docker keeps images, volumes and container logs on; whichever fills it, both are out of room. The [`disk` alert](/docs/tasks/alerts-and-metrics#the-five-alerts) comes first, at 85% and again at 95%:

```text
The server's disk is 100% full (0 B of 12 MB free). Deployments, databases and logs fail when it runs out. See what takes the space with: docker system df
```

| What is tried | What you see | What Shipwick does |
|---|---|---|
| `shipwick deploy`, `redeploy`, `rollback` | Refused at once, nothing changed: `Error: The server's disk is full (create deployment: database or disk is full (13)). Nothing was changed. Free space on the server — docker system df shows what takes it, docker image prune -a removes images nothing uses — and try again.` | Nothing: the running version is untouched. The same command works once there is room; the agent does not have to be restarted |
| A deployment that is under way when the disk fills | It fails at its next step — `record replica: database or disk is full (13)` — but `shipwick deploy` goes on waiting: the failure cannot be written down either. It reports the failure within a second of there being room | Removes what the deployment had started, lets the application go, and keeps the deployment's end in memory until the database takes it. If old replicas had already been replaced, the application is short of them until there is room: `web is running 2, but it is DEGRADED right now (2/3 replicas healthy)` |
| A replica crashes | It is restarted as always. `shipwick status` does not show the restart in its events or its count: neither could be recorded | Restarts it. Only the record is lost |
| A replica's container is gone | The application stays short of it; the agent's log says `supervisor: mark replica removed: database or disk is full (13)` every second | Tries again with its usual backoff — at the latest five minutes after there is room — and says `Recreated replica 1` |
| A static folder is uploaded | `507 DISK_FULL`, `write upload: … no space left on device`. The part that was written is removed; the folder deployed before is still there | — |
| A backup is written to `SHIPWICK_BACKUP_DIR` | The backup is `failed`, with `no space left on device` in its error; a scheduled one is posted to the webhook as `backup.failed` | Removes the partial file. Earlier backups are untouched, and the application is started again if `backups.stop` had stopped it |
| An image is pulled, or sent with `build:` | The deployment fails with the daemon's words, which end in `no space left on device`; an image that is sent is refused with `507 DISK_FULL` | — |
| The agent restarts | It starts: reading the database needs no room | Supervises as before |

**What is yours: make room.** `docker system df` shows what takes it; `docker image prune -a` removes the images no container uses, which on a server that is deployed to often is most of it. Then run the command again. Nothing has to be repaired: a database that could not be written was not half written. A deployment that ended while the disk was full shows its real outcome in `shipwick status` as soon as there is room.

Measured on a filesystem of 12 MB filled by another file: every write to the database failed, changes of a status as much as new records, and all of them worked again the moment the file was removed.

## Docker does not answer

The daemon is not running, or — the case that says nothing by itself — it is running and stuck: out of memory, waiting for a disk, stopped by a signal.

```text
$ shipwick status web
Error: Docker does not answer on the server. Applications that are running keep running; look at the daemon there with: systemctl status docker. The cause: no answer within 15s
```

| When | What you see | What Shipwick does |
|---|---|---|
| While it lasts | Every command that needs Docker is answered like the one above (`503 RUNTIME_UNAVAILABLE`), after 15 seconds at most. `shipwick server status` too; the agent itself reports healthy, because it is. The agent's log says `Docker does not answer; applications are not supervised until it does`, once. After 30 seconds the `docker` alert goes to the webhook and to `shipwick_alerts{kind="docker"}`: `Docker does not answer. Applications that are running keep running, but nothing is restarted, deployed or routed until it does. On the server: systemctl status docker` | Asks the daemon one question a second, 15 seconds each when it is stuck, and does nothing else: no restarts, no changes of routes, no application held. It never concludes that a container is gone from a daemon that did not answer |
| A deployment that is under way | It fails with the daemon's words, for instance `replica 2: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?`, and where old replicas had been replaced: `…; the rollback to 1.0 then failed too: …` | Leaves every replica that serves where it is. When Docker answers, the supervisor removes what is left of the failed version and completes the old one: `Removed leftover container shipwick_web_2_1`, `Recreated replica 1` |
| When it answers again | `Docker answers again after 38s; applications are supervised again`, in the log and as `alert.cleared` | The next pass sees what happened meanwhile: replicas that exited are restarted, missing ones recreated |
| The agent starts and Docker is not there | The agent's container exits and is started again by Docker's restart policy, until the daemon answers: `docker daemon unreachable: … Is Docker running, and may this user access its socket?` | A deployment that was interrupted is left as it is, and resumed by the start that finds Docker answering |

**What is yours: the daemon.** `systemctl status docker` and `journalctl -u docker` on the server say why it stopped or what it waits for; Shipwick goes on by itself when it answers. Restarting Docker stops every container unless `live-restore` is set in `/etc/docker/daemon.json`; the supervisor starts the replicas again as it does [after a reboot](#the-server-reboots).

Measured with the daemon's process stopped by `SIGSTOP` on a server with one application: commands were answered after 15 seconds, the alert was raised 30 seconds after the daemon stopped answering, and supervision resumed with its first answer. A daemon that restarts within 30 seconds raises no alert.

## An image pull stalls or is cut

The Docker daemon pulls images, not the agent; what the registry or the network does to a pull is reported in the daemon's words.

| What happens | What you see | What Shipwick does |
|---|---|---|
| The connection is refused or reset | The deployment fails within seconds: `pull python:3.12: failed to do request: Get "https://registry-1.docker.io/v2/…": dial tcp 54.156.94.132:443: connect: connection refused. The Docker daemon could not reach docker.io. …` | Nothing was started; the running version is untouched |
| The connection goes silent: packets are dropped | `shipwick deploy` waits. The daemon gave up by itself after 3 minutes 46 seconds and after 4 minutes 47 seconds in two runs (Docker 29.8), with `…: i/o timeout`. A pull the daemon never gives up on ends with the deployment's own limit: `deployment timed out after 15m` | The same |
| The registry cannot be reached and the image is already on the server | A warning, and the deployment goes on: `Could not pull my-api:1.4.2, using the local copy (…)` | Uses the image it has |
| The agent restarts during the pull | `Resumed after the agent restarted` | Pulls again |

**What is yours: deploy again when the registry is reachable.** If the server has no route to it at all, the error says what to set up; see [Run behind a corporate proxy or without internet](/docs/tasks/corporate-network).

## The agent is killed

By the kernel when memory runs out, by an upgrade of Shipwick, by a reboot. Docker starts the agent's container again, and the agent goes on with what it finds: see [Agent restarts and crashes](/docs/concepts/overview#agent-restarts-and-crashes). `shipwick deploy` waits through it.

| Killed in the middle of | What you see | What Shipwick does |
|---|---|---|
| A rolling deployment | `Resumed after the agent restarted`, then the remaining steps | Replicas that were serving keep serving; containers it had created are adopted; the rest is done |
| A `recreate` deployment | The same. If the old version had been stopped and the new one not yet started, the application is down until the agent is back | Goes on with the new version; the old one is not started a second time next to it |
| A `pre_deploy` command | `the pre-deploy command was interrupted when the agent restarted, and is not run a second time: check what it left behind, then deploy again`, and `my-api is still running 1.4.1; the failed deployment did not affect it.` | Stops and removes the command's container. Nothing of the running version was touched |
| A rollback after a failed deployment | `Rolled back: web is running 1.0 again` | Finishes the rollback: missing replicas of the old version are created, all of them checked, the failed version removed |
| A rollback you asked for (`shipwick rollback`) | `Resumed after the agent restarted` | It is a deployment like any other, and resumes like one |
| A deployment the agent cannot make sense of | `agent restarted during deployment, and it could not be resumed: …` | Marks it failed, removes its containers, and completes the version that is active |

**What is yours:** after an interrupted `pre_deploy`, look at what the command left behind — a migration that ran half-way — before you deploy again. Everything else needs nothing from you.

Produced by killing the agent's container with `SIGKILL` during each of the first three, and starting it again a few seconds later.

## The proxy cannot be reached

Caddy is stopped, or its admin socket does not answer.

```text
$ shipwick server status
…
Proxy           unreachable  cannot reach Caddy's admin endpoint: dial unix /run/caddy/admin.sock: connect: connection refused
```

| What is tried | What you see | What Shipwick does |
|---|---|---|
| A deployment | It fails when routes must change: `could not route site.example.com to the new version: cannot reach Caddy's admin endpoint: dial unix /run/caddy/admin.sock: connect: connection refused`. An application without a domain is not deployed either: one configuration holds every application's routes | Removes the new replicas; the old version keeps serving as far as the proxy does |
| Running applications | A proxy that runs and cannot be configured goes on serving what it was last told, and finds restarted replicas by itself: it looks them up by name. A proxy that is stopped serves nothing | Supervises as before, and tries the proxy again every second. Its log says `reverse proxy is out of sync; retrying every tick` once, and `reverse proxy is in sync again` |

**What is yours: Caddy.** `docker compose ps` and `docker compose logs caddy` in `/opt/shipwick`; Docker restarts its container when it exits. No alert is raised for this: a proxy that is down is noticed from outside sooner than from the agent. Deploy again when `shipwick server status` says `Proxy  ok`.

## The server reboots

Docker starts the agent and the proxy again; the agent starts the applications. Docker itself restarts none of them: their restarts are the supervisor's, so that one mechanism knows about backoff and crash loops.

```text
WHEN       EVENT
just now   Replica 1 restarted (attempt 1)
just now   Replica 1 exited with code 255; restarting in 1s
```

| What happened | What you see | What Shipwick does |
|---|---|---|
| The server lost power, or Docker was killed | Every replica `exited with code 255` and is restarted. On a server with three applications and five replicas, all of them ran again four seconds after the agent had started | Starts the same containers again — not new ones — one second after it first sees them, application by application |
| The server was shut down properly | Docker stopped every container with `SIGTERM`, and each ended with the code its process chose. `restart.policy: always` (the default) starts them all | The same |
| …with `restart.policy: on-failure` and a process that exits with 0 on `SIGTERM` | The application is `DOWN`: `Replica 1 exited with code 0; restart policy "on-failure" leaves it stopped`. `application.down` goes to the webhook | Leaves it stopped: an exit with 0 is what the policy calls finished, and the agent cannot tell who sent the signal |
| …with `restart.policy: never` | The same, whatever the exit code | The same |
| A deployment was under way | `Resumed after the agent restarted` | Starts the containers the deployment had and goes on with it |

**What is yours:** `shipwick start <app>` for an application whose policy left it stopped, or `restart.policy: always` for one that should come back by itself. `shipwick ps` after a reboot shows which are not `HEALTHY`. The webhook gets `application.down` for every application the agent finds stopped when it starts, also for those it starts again a second later.

## What's next

- [Get alerts and scrape metrics](/docs/tasks/alerts-and-metrics): the `disk` and `docker` alerts, and where they show.
- [Health checks and supervision](/docs/concepts/health-and-supervision): restarts, backoff and restart policies.
- [Architecture](/docs/concepts/overview#agent-restarts-and-crashes): what the agent does when it starts.
- [Find out why it died](/docs/tasks/find-out-why-it-died): what a container printed before it ended.
- [Error codes](/docs/reference/api#error-codes) in the API reference: `DISK_FULL` and `RUNTIME_UNAVAILABLE`.
