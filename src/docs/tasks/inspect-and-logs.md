---
title: Inspect applications and read logs
description: List applications, read an application's status, follow its logs, check the server, and stop, start or delete an application with deployctl.
---

# Inspect applications and read logs

This page covers the `deployctl` commands that show what is running on a server — `ps`, `status`, `logs` and `server status` — and the ones that stop, start and delete an application.

Commands that take `[app]` default to the application named in `./deploy.yaml`. Outside that directory, name the application, or select another file with `--file`.

## List applications

```bash
deployctl ps
```

```text
NAME     STATUS    VERSION   REPLICAS   DOMAIN            UPDATED
my-api   HEALTHY   1.4.2     2/2        api.example.com   2h ago
```

| Column | |
|---|---|
| `STATUS` | The application's status, see below. `(deploying)` is appended while a deployment is in flight |
| `VERSION` | The tag of the active deployment's image |
| `REPLICAS` | Healthy replicas / desired replicas |
| `DOMAIN` | The public hostname, or `-` if the application has none |

## Application status

| Status | Meaning |
|---|---|
| `HEALTHY` | All desired replicas of the active deployment are healthy |
| `DEGRADED` | Some are |
| `DOWN` | None are: not running, or running but failing their health check |
| `CRASH_LOOP` | A replica keeps dying or never turns healthy, and its restarts are now limited to one every 5 minutes. Outranks `DEGRADED` and `DOWN`: it says that restarting is not helping |
| `STOPPED` | Stopped on request, with `deployctl stop` or from the dashboard |
| `DEPLOYING` | The first deployment is in flight; nothing is active yet |
| `FAILED` | No deployment has ever succeeded |

A replica is healthy when it runs and is not failing its health check. Without a `health` block in `deploy.yaml`, healthy means running.

An application that is being upgraded reads `HEALTHY`, not `DEGRADED`: during a rollout the numbers describe the replicas that are serving right now, a mix of the old and the new version.

## Read an application's status

```bash
deployctl status            # the application in ./deploy.yaml
deployctl status my-api
```

The output has four parts.

**Summary.** The status, the active version with its deployment number, the image, the URL, healthy replicas, live CPU and memory, the health check and the limits. An excerpt:

```text
my-api  ● HEALTHY

Replicas   2/2 healthy
CPU        42% / 400%
Memory     412 MB / 2 GB
```

CPU is in percent of one core, as in `docker stats`: two replicas limited to `cpu: 2` each may use up to 400%. Memory is the working set, which is what the limit is enforced against. Without limits, only the usage is shown. The numbers are read from Docker when you ask; nothing is sampled in the background. See [Resources](/docs/concepts/resources).

**Replicas.** One row per container.

| Column | Values |
|---|---|
| `STATE` | `running`, `out of memory`, `exited (0)` after a clean stop, `exited (N)` after a crash, or Docker's own state name |
| `HEALTH` | `healthy`, `unhealthy`, `starting` (restarted, still within its startup time), `checking` (not probed yet, for example right after an agent restart), or `-` when no health check is configured |
| `RESTARTS` | Restarts performed by the supervisor; `(crash loop)` when restarts of this replica are being rate-limited |
| `STARTED` | When the container last started, for running containers |

**Recent deployments.** The last five attempts, newest first.

```text
DEPLOY   VERSION   STATUS       VIA      WHEN
#5       1.4.3     FAILED       deploy   5m ago   replica 1 exited with code 1 shortly after start
#4       1.4.2     ACTIVE       deploy   2h ago
#3       1.4.1     SUPERSEDED   deploy   3d ago
```

`VIA` says how the deployment came to be: `deploy`, `redeploy` or `rollback`. `ACTIVE` is the deployment that is running. `SUPERSEDED` deployments ran successfully and were replaced; they are the valid [rollback](/docs/tasks/roll-back) targets. `FAILED` attempts never touched the running version. `ROLLED_BACK` attempts failed part-way, and the previous version was restored. The last column holds the reason a deployment failed.

**Events.** What the supervisor did recently, and why. This is the difference between "it is healthy" and "it is healthy now, after restarting four times tonight".

```text
my-api  ● CRASH_LOOP

REPLICA   CONTAINER            STATE     HEALTH      RESTARTS         STARTED
1         shipwick_my-api_3_1   running   healthy     0                2h ago
2         shipwick_my-api_3_2   running   unhealthy   5 (crash loop)   34s ago

WHEN      EVENT
28s ago   Replica 2 did not become healthy within 30s of starting: HTTP 503
34s ago   Replica 2 is crash-looping: 5 restarts without staying up. Retrying every 5m
```

A crash-looping application recovers on its own if the cause goes away. Deploying is always the way out as well: a deployment replaces the containers, and new containers start with a clean slate. See [Health and supervision](/docs/concepts/health-and-supervision).

## Read logs

```bash
deployctl logs              # the last 100 lines
deployctl logs -n 500       # the last 500
deployctl logs -f           # follow
deployctl logs -f -t        # follow, with timestamps
```

| Flag | Default | |
|---|---|---|
| `-n`, `--tail` | `100` | Lines to show from the end of the logs, 1 to 5000. `0` is allowed with `--follow` and means only what is logged from now on |
| `-f`, `--follow` | | Keep streaming new lines |
| `-t`, `--timestamps` | | Prefix each line with its timestamp, in local time |
| `--file` | `deploy.yaml` | The file to read the application name from. Long form only: for `logs`, `-f` means follow |

Logs are merged across replicas. When an application has more than one replica, each line is prefixed with its replica number, such as `[2]`. When following, each replica starts with its last `--tail` lines.

`logs -f` ends by itself when the containers it follows are stopped or replaced, which is what a new deployment does:

```text
! log stream ended: the containers were stopped or replaced. Run the command again to follow the new ones.
```

Container logs are size-capped on the server, so very old output is not kept.

## Check the server

```bash
deployctl server status
```

The command first checks that the agent is reachable. That check needs no token, so a wrong URL and a wrong token produce different errors. It then prints the agent and CLI versions, the server's hostname, operating system, kernel and architecture, the Docker version, CPUs and memory, the number of applications and running containers, and the state of the reverse proxy:

| `Proxy` | Meaning |
|---|---|
| `ok  serving N domains` | The agent reaches Caddy and has configured N domains |
| `unreachable`, with an error | The agent cannot reach Caddy's admin endpoint |
| `not configured` | `SHIPWICK_CADDY_ADMIN` is not set on the agent. Domains are recorded but not served |

If a command fails with "The agent does not know this operation", the agent is probably older than your `deployctl`. Compare the two versions here.

## Stop and start an application

```bash
deployctl stop my-api
deployctl start my-api
```

```text
✓ Stopped my-api
✓ Started my-api (2/2 replicas running)
```

A stopped application stays stopped until you start it or deploy it again; the supervisor does not restart it. While it is stopped, its domain answers `503` rather than timing out, and keeps its certificate. `start` reports how many replicas are running; whether they are healthy is not known yet, so check with `deployctl status`.

## Delete an application

```bash
deployctl delete my-api
```

`delete` removes the application, its containers and its deployment history from the server. There is nothing to roll back to afterwards.

It always wants the name spelled out and never reads it from `deploy.yaml`, so that running it from the wrong directory cannot delete the wrong application. In a terminal it asks you to type the application name to confirm. In a script, pass `--yes` (`-y`); without it, `delete` refuses to run when there is no terminal.

## What's next

- The same information is in the [dashboard](/docs/tasks/dashboard), with CPU and memory updating live.
- All flags are in the [deployctl reference](/docs/reference/deployctl).
