---
title: Inspect applications and read logs
description: List applications, read an application's status with its certificates and backups, follow its logs, check the server, its disk and its alerts, open an application or the dashboard, and stop, start or delete an application with shipwick.
---

# Inspect applications and read logs

This page covers the `shipwick` commands that show what is running on a server — `ps`, `status`, `logs`, `server status` and `open` — and the ones that stop, start and delete an application. What the proxy served, as opposed to what the application printed, is on a page of its own: [See what the proxy served](/docs/tasks/traffic).

Commands that take `[app]` default to the application named in `./deploy.yaml`. Outside that directory, name the application, or select another file with `--file`. In a directory with a `shipwick.yaml` and no `deploy.yaml`, `status`, `logs`, `stop`, `start`, `rollback`, `redeploy`, `run`, `jobs`, `open`, `backup` and `restore` take the name from that file when it describes one application. When it describes several, the command lists them and shows itself with a name:

```text
shipwick.yaml describes 2 applications: api, web

Say which one, e.g.: shipwick status api
```

## List applications

```bash
shipwick ps
```

```text
NAME     STATUS    VERSION   REPLICAS   DOMAIN            UPDATED
my-api   HEALTHY   1.4.2     2/2        api.example.com   2h ago
```

| Column | |
|---|---|
| `STATUS` | The application's status, see below. `(deploying)` is appended while a deployment is in flight |
| `VERSION` | The tag of the active deployment's image; the build's timestamp for an image built by `shipwick deploy`; the folder's digest for a static application |
| `REPLICAS` | Healthy replicas / desired replicas; `static` for a folder the proxy serves itself |
| `DOMAIN` | The public hostname, with the application's `path` when it serves only one part of it (`example.com/api`), or `-` if the application has none |

Since 0.6 an application that runs but wants a look says so at the end of its line: one with a hostname whose certificate is not in order, and one with active alerts.

```text
NAME     STATUS    VERSION   REPLICAS   DOMAIN            UPDATED
my-api   HEALTHY   1.4.2     2/2        api.example.com   5m ago    certificate waiting for DNS, 2 alerts
blog     HEALTHY   2.0.1     1/1        blog.example.com  3d ago
```

`shipwick status my-api` then says which hostname and which alerts.

## Application status

| Status | Meaning |
|---|---|
| `HEALTHY` | All desired replicas of the active deployment are healthy |
| `DEGRADED` | Some are |
| `DOWN` | None are: not running, or running but failing their health check |
| `CRASH_LOOP` | A replica keeps dying or never turns healthy, and its restarts are now limited to one every 5 minutes. Outranks `DEGRADED` and `DOWN`: it says that restarting is not helping |
| `STOPPED` | Stopped on request, with `shipwick stop` or from the dashboard |
| `DEPLOYING` | The first deployment is in flight; nothing is active yet |
| `FAILED` | No deployment has ever succeeded |

A replica is healthy when it runs and is not failing its health check. Without a `health` block in `deploy.yaml`, healthy means running.

An application that is being upgraded reads `HEALTHY`, not `DEGRADED`: during a rollout the numbers describe the replicas that are serving right now, a mix of the old and the new version.

## Read an application's status

```bash
shipwick status            # the application in ./deploy.yaml
shipwick status my-api
shipwick status my-api --verbose   # also the certificates that are in order
```

The output has five parts.

**Summary.** The status, the active version with its deployment number, the image, the URL, healthy replicas, live CPU and memory, the health check, the limits and, for an application with volumes, its backups. An excerpt:

```text
my-api  ● HEALTHY

URL        https://api.example.com
Replicas   2/2 healthy
CPU        42% / 400%
Memory     412 MB / 2 GB
```

The URL is the domain with the application's `path` when it has one, `https://example.com/api`. CPU is in percent of one core, as in `docker stats`: two replicas limited to `cpu: 2` each may use up to 400%. Memory is the working set, which is what the limit is enforced against. Without limits, only the usage is shown. See [Resources](/docs/concepts/resources). A static application has no containers: its summary reads `Files  42 files, 3.1 MB, served by the proxy` instead, and the replicas are left out.

An application with volumes has a `Backups` line: the schedule from `backups` in `deploy.yaml`, when the last backup was taken, its size and how many are kept, such as `daily at 03:00 UTC, last 2h ago (412 MB), 7 kept`. When the last one failed, the line says so with the reason and names the last good one; without a schedule and without a backup it reads `none`, with the command that takes one. See [Back up and restore volumes](/docs/tasks/backups).

**Certificates.** One line for every hostname whose certificate is not in order, and why:

```text
HOSTNAME            CERTIFICATE
www.example.com     waiting for DNS: does not resolve yet; add an A record: www.example.com → 62.238.109.115 (DNS only, not proxied)
new.example.com     being obtained: the proxy has no certificate for it yet; HTTPS connections to it fail until it does
old.example.com     expires in 9 days, on 2026-03-10 (Let's Encrypt E7)
```

When every certificate is in order there is no such table. `--verbose` (`-v`) lists those too, as `valid until 2026-06-01 (Let's Encrypt E7)`. What the three states mean, and what to do about each, is in [Use a certificate of your own](/docs/tasks/certificates#certificate-status).

**Replicas.** One row per container.

| Column | Values |
|---|---|
| `STATE` | `running`, `out of memory`, `exited (0)` after a clean stop, `exited (N)` after a crash, or Docker's own state name |
| `HEALTH` | `healthy`, `unhealthy`, `starting` (restarted, still within its startup time), `checking` (not probed yet, for example right after an agent restart), or `-` when no health check is configured |
| `RESTARTS` | Restarts performed by the supervisor; `(crash loop)` when restarts of this replica are being rate-limited |
| `STARTED` | When the container last started, for running containers |

A container that a deployment replaced and that is still on its way out — it was sent `SIGTERM` and has its `deploy.stop_timeout` to exit — is listed below the replicas with the state `stopping`, since 0.6. It is not a replica any more and is not counted as one.

**Recent deployments.** The last five attempts, newest first.

```text
DEPLOY   VERSION   STATUS       VIA      WHEN
#5       1.4.3     FAILED       deploy   5m ago   replica 1 exited with code 1 shortly after start
#4       1.4.2     ACTIVE       deploy   2h ago
#3       1.4.1     SUPERSEDED   deploy   3d ago
```

`VIA` says how the deployment came to be: `deploy`, `redeploy` or `rollback`. `ACTIVE` is the deployment that is running. `SUPERSEDED` deployments ran successfully and were replaced; they are the valid [rollback](/docs/tasks/roll-back) targets. `FAILED` attempts never touched the running version. `ROLLED_BACK` attempts failed part-way, and the previous version was restored. The last column holds the reason a deployment failed. The API and the [dashboard](/docs/tasks/dashboard) also record which token made each deployment, as `by`.

**Events.** What the supervisor did recently, and why. This is the difference between "it is healthy" and "it is healthy now, after restarting four times tonight". The feed also holds what happened to the application by other hands: `Application stopped by ci` when a token other than the root token stops or starts it, `Volume data restored from a backup (412 MB)` after a [restore](/docs/tasks/backups), a certificate that was obtained or is running out, an [alert](/docs/tasks/alerts-and-metrics) raised or cleared, and the runs of [scheduled jobs](/docs/tasks/jobs) that went wrong — `Job nightly-report failed (exit 1)`, `Job cleanup timed out after 15m`, `Command rails could not run: …`. Runs that succeed record no event, since jobs run often; they are in `shipwick jobs`.

```text
my-api  ● CRASH_LOOP

REPLICA   CONTAINER            STATE     HEALTH      RESTARTS         STARTED
1         shipwick_my-api_3_1   running   healthy     0                2h ago
2         shipwick_my-api_3_2   running   unhealthy   5 (crash loop)   34s ago

WHEN      EVENT
28s ago   Replica 2 did not become healthy within 30s of starting: HTTP 503
34s ago   Replica 2 is crash-looping: 5 restarts without staying up. Retrying every 5m
```

**The command that says why.** Since 0.7, when the page shows a replica that died or a deployment that failed, and the agent kept what it printed, the output ends with the exact command that shows it:

```text
Replica 1's last output before it exited with code 3, just now:   shipwick logs my-api --id 4
What deployment #13 printed before it failed:                     shipwick logs my-api --deployment 13
```

See [Find out why it died](/docs/tasks/find-out-why-it-died).

A crash-looping application recovers on its own if the cause goes away. Deploying is always the way out as well: a deployment replaces the containers, and new containers start with a clean slate. See [Health and supervision](/docs/concepts/health-and-supervision).

## Read logs

```bash
shipwick logs              # the last 100 lines
shipwick logs -n 500       # the last 500
shipwick logs -f           # follow
shipwick logs -f -t        # follow, with timestamps
```

| Flag | Default | |
|---|---|---|
| `-n`, `--tail` | `100` | Lines to show from the end of the logs, 1 to 5000. `0` is allowed with `--follow` and means only what is logged from now on |
| `-f`, `--follow` | | Keep streaming new lines |
| `-t`, `--timestamps` | | Prefix each line with its timestamp, in local time |
| `--file` | `deploy.yaml` | The file to read the application name from. Long form only: for `logs`, `-f` means follow |

Logs are merged across replicas. When an application has more than one replica, each line is prefixed with its replica number, such as `[2]`. When following, each replica starts with its last `--tail` lines.

An application that has printed nothing leaves the screen empty, which reads as a hang. In a terminal, `logs -f` therefore says once, after two seconds without a line, that it is following:

```text
Following my-api; nothing printed yet. Ctrl-C stops.
```

The note goes to standard error, so it does not end up in a file the logs are redirected to.

`logs -f` ends by itself when the containers it follows are stopped or replaced, which is what a new deployment does:

```text
! log stream ended: the containers were stopped or replaced. Run the command again to follow the new ones.
```

### Logs of containers that are gone

These commands read the containers that run. What a container printed before it crashed, was restarted or was replaced by a deployment is kept by the agent since 0.7, in its log archive:

```bash
shipwick logs my-api --previous                  # the last container that ended; -p for short
shipwick logs my-api --list                      # what is kept
shipwick logs my-api --id 4                      # one entry of it
shipwick logs my-api --run 14                    # the output of a run of a job or a command
shipwick logs my-api --search "connection refused" --since 2h
```

```text
#12 replica 1 (1.4.2), shipwick_my-api_12_1: crashed (exit 3) just now; 3 lines
starting up
connecting to the database
FATAL: could not connect to db:5432
```

| Flag | |
|---|---|
| `-p`, `--previous` | The output of the last container that ended: the one that crashed, or was replaced |
| `--list` | What is kept of ended containers and runs |
| `--id <n>` | One entry of `--list` |
| `--run <id>` | The output of a run of a job or a command |
| `--search TEXT` | Lines that contain the text, whatever its case, in the kept output and in the running containers |
| `--since`, `--until` | Only lines from then on, or up to then: `30m`, `2h`, `7d`, a date, or a time in RFC 3339 |
| `--deployment <#>`, `--replica <n>` | Only the output of that deployment or replica, kept or current |

None of them goes with `--follow`. How much is kept, for how long, and where, is in [Find out why it died](/docs/tasks/find-out-why-it-died).

### What the server keeps of the logs

Container logs are size-capped on the server, at 3 × 10 MB per container, so very old output is not kept. A static application has no logs: `This application is a folder served by the proxy: it has no containers, so there are no logs, metrics or commands to run.`

An application whose `deploy.yaml` ships its logs elsewhere with `logging` — `gelf`, `syslog`, `fluentd`, `awslogs`, `splunk` — is read the same way: Docker keeps a local copy next to what it ships (its dual logging, on by default since Docker 20.10), and `shipwick logs` shows that copy. If dual logging was turned off daemon-wide, `shipwick logs` shows nothing for that application, and your collector is the only place to read it. With `journald` or `local` the logs stay on the server and are read from there. The log archive reads the same copy: what `shipwick logs` can show of a container, the archive can keep of it when it ends, and no more. The output of jobs and one-off commands is separate: `shipwick jobs logs`, see [Run scheduled jobs and one-off commands](/docs/tasks/jobs).

## Check the server

```bash
shipwick server status
```

The command first checks that the agent is reachable. That check needs no token, so a wrong URL and a wrong token produce different errors. When more than one server is saved, the first line names the context the command used. It then prints the agent and CLI versions, the server's hostname, operating system, kernel and architecture, the Docker version, CPUs and memory, the number of applications and running containers, the state of the reverse proxy, whether notifications are configured, which token you are using, the dashboard's address, how full the server's disk is, what the log archive holds, and the alerts that are active:

```text
Proxy           ok  serving 3 routes
Notifications   webhook configured
Token           ci (deploy)
Dashboard       https://dashboard.example.com
Disk            35 GB of 40 GB used (87%)
Log archive     1.1 KB of 1 GB, 1 entry, kept 14 days

! The server's disk is 87% full (5 GB of 40 GB free). See what takes the space with: docker system df
```

| `Proxy` | Meaning |
|---|---|
| `ok  serving N domains` | The agent reaches Caddy and has configured N domains |
| `unreachable`, with an error | The agent cannot reach Caddy's admin endpoint |
| `not configured` | `SHIPWICK_CADDY_ADMIN` is not set on the agent. Domains are recorded but not served |

`Notifications` is `webhook configured` when `SHIPWICK_WEBHOOK_URL` is set on the agent and `none` otherwise; see [Get notified](/docs/tasks/notifications). `Token` is the name and role of the token the command was made with — `root (admin)` for the token the installer printed. It is the line to read when a command is refused for lack of a role; see [Create tokens for CI and teammates](/docs/tasks/tokens).

`Dashboard` is the address the dashboard is served at, or `no hostname` when `SHIPWICK_DASHBOARD_DOMAIN` is not set on the agent. `Disk` is the server's disk as the agent measures it; the line is absent where it cannot. Below the fields, every active alert has a line of its own, `!` for a warning and `✗` for a critical one, in the agent's words: a replica close to its memory limit, a disk filling up, a replica that keeps restarting, an application that has not been healthy for a while. See [Alerts and metrics](/docs/tasks/alerts-and-metrics).

`Log archive`, since 0.7, is what the agent keeps of the output of containers that ended: how much of how much, how many entries, and for how long; `off` when `SHIPWICK_LOG_RETENTION_SIZE` is `0` on the agent. See [Find out why it died](/docs/tasks/find-out-why-it-died#how-much-and-for-how-long).

Since 0.7 the `Agent` line also says when a newer release exists. The agent asks GitHub itself, once a day, so the line needs no connection of the CLI's own:

```text
Agent           v0.7.0  v0.7.1 is available  (on the server, run the installer again: curl -fsSL https://get.shipwick.com | sh)
```

See [Upgrade Shipwick](/docs/tasks/upgrade#a-notice-when-a-newer-release-exists).

If a command fails with "The agent does not know this operation", the agent is probably older than your `shipwick`. Compare the two versions here, or run `shipwick upgrade --check`, which compares them for you.

`shipwick doctor` goes further: the versions against the latest release, the token, Docker on the server, the proxy, the active alerts, certificates you supplied that have expired or will within 30 days, whether the agent's own state is backed up, ports 80 and 443, and for every application's domain whether DNS points at the server and `https://` answers, one line each with what to do about it. A critical alert and an expired certificate count as problems. See [Your first deployment](/docs/getting-started/first-deployment#when-the-domain-is-not-ready).

## Open it in the browser

```bash
shipwick open my-api
shipwick open --dashboard
```

`shipwick open my-api` prints `Opening https://api.example.com` and hands the address to your default browser; an application with a `path` is opened at it, `https://example.com/api`. An application without a domain is told where it can be reached instead: by name, from the other applications on the server. One whose domain is a wildcard has no address of its own to open, and the command says so.

`--dashboard` opens the dashboard, at the address `shipwick server status` shows. So does `shipwick open` without a name in a directory that has neither a `deploy.yaml` nor a `shipwick.yaml`. A server without a dashboard hostname answers:

```text
This server has no dashboard hostname. Set SHIPWICK_DASHBOARD_DOMAIN in /opt/shipwick/.env and run the installer again
```

## Stop and start an application

```bash
shipwick stop my-api
shipwick start my-api
```

```text
✓ Stopped my-api
✓ Started my-api (2/2 replicas running)
```

A stopped application stays stopped until you start it or deploy it again; the supervisor does not restart it, and none of its scheduled jobs run. While it is stopped, its domain answers `503` rather than timing out, and keeps its certificate; hostnames under `redirects` keep redirecting. `start` reports how many replicas are running; whether they are healthy is not known yet, so check with `shipwick status`.

Both need the `deploy` role. When the token is not the root token, the application's events say who did it: `Application stopped by ci`.

## Delete an application

```bash
shipwick delete my-api
```

`delete` removes the application, its containers, its deployment history and, since 0.7, its archived output from the server. There is nothing to roll back to afterwards. Its volumes stay; `shipwick volumes` lists them and `shipwick volumes rm` removes one, see [Back up and restore volumes](/docs/tasks/backups#volumes-of-deleted-applications). Deleting needs the `admin` role.

It always wants the name spelled out and never reads it from `deploy.yaml`, so that running it from the wrong directory cannot delete the wrong application. In a terminal it asks you to type the application name to confirm. In a script, pass `--yes` (`-y`); without it, `delete` refuses to run when there is no terminal.

## What's next

- The same information is in the [dashboard](/docs/tasks/dashboard), with CPU and memory updating live and a week of history behind them.
- [Find out why it died](/docs/tasks/find-out-why-it-died): the output of containers that crashed, were restarted or were replaced.
- [See what the proxy served](/docs/tasks/traffic): `shipwick traffic`, for request rates, errors and durations.
- [Use a certificate of your own](/docs/tasks/certificates): what the certificate lines of `shipwick status` mean.
- [Run scheduled jobs and one-off commands](/docs/tasks/jobs): `shipwick jobs`, `shipwick run`, and where their output goes.
- All flags are in the [shipwick reference](/docs/reference/cli).
