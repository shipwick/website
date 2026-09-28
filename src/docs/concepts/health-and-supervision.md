---
title: Health checks and supervision
description: How the HTTP, TCP and command health checks work during and after a deployment, how the supervisor restarts replicas with backoff, what CRASH_LOOP means, how missing containers are reconciled, and when an application is reported down.
---

# Health checks and supervision

Shipwick checks replicas while they are deployed and for as long as they run, over HTTP, over TCP or with a command inside the container, and restarts those that exit or stop answering. This page describes the three kinds of health check, the supervisor's restart and backoff rules, reconciliation of missing containers, the notifications an outage produces, and the application statuses that result.

## The health check

A check is one of three kinds, decided by which `health` key is set. `interval`, `timeout` and `retries` mean the same for each.

```yaml
health:
  path: /health          # HTTP GET, 2xx is healthy
  interval: 10s
  timeout: 3s
  retries: 3
```

```yaml
health:
  tcp: 5432              # a TCP connection to this container port is accepted
```

```yaml
health:
  command: ["pg_isready", "-U", "postgres"]   # exit 0 inside the replica
```

| Kind | One probe is | For |
|---|---|---|
| `path` | `GET http://<container ip>:<port><path>` | Anything that speaks HTTP. Needs `port`. |
| `tcp` | A TCP connection to `<container ip>:<tcp>`, closed once accepted; nothing is sent | Databases and queues that would log a protocol error on a stray HTTP request. It says the process is listening, which for a queue or a cache is usually all there is to know. `port` is not needed; the checked port and the proxied port need not be the same. |
| `command` | The argv run inside the replica through the Docker Engine API's exec, no TTY, no shell; exit 0 is healthy | A tool that knows the application can tell "listening" from "ready": a database can be listening and still refuse connections while it recovers. The tool must exist in the image; `pg_isready`, `mysqladmin ping` and `redis-cli ping` ship with theirs. |

Exactly one of the three is set; a `health` block with none, or with two, is refused by validation. The engine dispatches on the kind in one place, for the deployment and the supervisor alike.

### HTTP

The request is sent by the agent over the application network with the header `User-Agent: shipwick-health-check`.

- **A status from 200 to 299 is healthy.** Anything else is a failed probe, reported as `HTTP <status>`.
- **No answer within `timeout` is a failed probe**, reported as `no response within 3s`. So is a refused connection (`connection refused`) or one closed without an answer (`connection closed before a response`).
- **Redirects are not followed.** A redirect is an answer, not a 2xx, and following it could walk the probe off the container network.
- **Every probe opens a fresh connection.** A kept-alive connection can outlive a wedged listener and report a dead application as healthy.
- **The probe goes direct.** An HTTP proxy configured in the agent's environment is never used.

### TCP

The agent opens a connection to the container's address and closes it as soon as it is accepted, without sending a byte. The errors are the connection errors of the HTTP probe, prefixed with what was tried: `TCP connect to port 5432: connection refused`.

### Command

The command is run inside the running replica as an argv, exactly as written, without a shell. Only the last 4 KB of what it prints are read, and only its last line is reported, so a chatty check cannot grow an event: `command exited 2: pg_isready: no response`. A command that does not finish within `timeout` is reported as `command did not finish within 3s`; the connection to the daemon is closed, which ends the read, but the process itself keeps running inside the container, since Docker has no way to kill an exec. Checks are meant to be tools that finish. A command that cannot be started at all, because the container is not running for instance, is `command could not run: …`.

Defaults and limits of `interval`, `timeout` and `retries` are in the [deploy.yaml reference](/docs/reference/deploy-yaml#health).

The same probe is used in two places with different patience.

### During a deployment: the startup budget

Every new replica must answer its check once before it may take traffic. It has `start_period + interval × retries` to do so, 30 seconds with the defaults. This is the replica's startup budget.

During that time the replica is probed every second, not every `interval`. A connection refused by an application that is still booting is "not yet", not a strike, and a fast application is confirmed in about a second instead of waiting ten to be told it was ready after one. A slow starter gets its time: set `health.start_period`, up to 30 minutes, for a JVM or for an application that migrates its database on boot. Raising `retries` would also work, but would make a running replica's failures take longer to notice; `start_period` only stretches the budget.

```yaml
health:
  path: /health
  start_period: 1m
```

A replica that never answers within the budget fails the deployment, and the error says why, naming the check that was tried:

```text
✗ Deployment failed

  replica 1 did not become healthy within 30s: GET /health on port 8080: connection refused
```

```text
  replica 1 did not become healthy within 30s: TCP connect to port 5432: connection refused
```

```text
  replica 1 did not become healthy within 30s: command exited 2: pg_isready: no response
```

A replica that exits during the budget fails the deployment at once, without waiting for the budget to run out.

### Without a health check

Without a `health` block, a deployment only verifies that replicas start and stay up: each new replica must still be running after a stabilization window of 3 seconds. A replica that exits within the window fails the deployment.

After deployment, such a replica is healthy for as long as it runs. The supervisor restarts it when it exits, but cannot notice a process that runs and no longer serves.

### After deployment: continuous checking

The supervisor probes every running replica every `interval`. A single failed probe changes nothing. After `retries` consecutive failures the replica is marked `unhealthy`, leaves the proxy's rotation, and is restarted. This is the classic cure for a deadlocked process. One passing probe resets the failure count.

A replica that the supervisor has just restarted, or that was started with `shipwick start`, is `starting`. It gets its startup budget again, `start_period` included, before failures count, is probed every second meanwhile, and receives no traffic until its first passing check; a passed check counts at once. If the budget runs out, it becomes `unhealthy`.

Each replica has one of these health values, shown by `shipwick status` and in the API's container list:

| `health` | Meaning |
|---|---|
| `""` (empty) | The application defines no health check. |
| `unknown` | Not probed yet, for example right after an agent restart. Counts as healthy. `shipwick status` shows it as `checking`. |
| `starting` | Started or restarted, still within its startup budget. Not routed to. |
| `healthy` | The last probe passed. |
| `unhealthy` | Failed `retries` consecutive probes, never came up within its budget, or is not running. Not routed to. |

`unknown` counts as fine on purpose: an application must not flap to `DOWN` because its supervisor was restarted.

::: info The agent must be able to reach container addresses
HTTP and TCP probes go to container IP addresses. An agent running in a container, the recommended setup, finds itself through the Docker API and joins the application network on its own. An agent running as a host process reaches bridge networks directly on Linux. With Docker Desktop on macOS or Windows it cannot, and the agent warns at startup: applications with a `path` or `tcp` check will fail to deploy there. A `command` check goes through the Docker API and needs no address.
:::

## The supervisor

The supervisor is one loop in the agent, ticking every second. For each application that has an active deployment and is meant to be running, it compares the replicas of the active deployment with what Docker reports. A static application, served by the proxy from a folder, has no replicas and nothing for the supervisor to do. It acts on an application only while holding that application's lock, so it never interleaves with a deployment, a stop or a delete. If the lock is taken, the application is looked at again on the next tick. The same ticker starts scheduled jobs once a minute; see [Run scheduled jobs and one-off commands](/docs/tasks/jobs).

```text
exited  ──policy allows?──no──▶ leave stopped, say so once
   │yes
   ▼
wait backoff[restarts] ──▶ start ──▶ restarts++ ──restarts ≥ 5──▶ CRASH_LOOP (retry every 5m)

running + unhealthy ──policy ≠ never──▶ same backoff ──▶ restart
running + proven for 60s ──▶ restarts = 0, crash loop cleared
```

| What happens | What Shipwick does |
|---|---|
| A replica exits | Restarts it, as `restart.policy` allows. |
| A replica runs but fails `retries` checks in a row | Marks it `unhealthy` and restarts it, unless the policy is `never`. |
| A replica keeps dying | Backs off: 1s, 2s, 5s, 10s, 30s. After five restarts that did not hold, the application is `CRASH_LOOP` and the replica is retried every 5 minutes. |
| A replica stays up and proven for a minute | Its restart history is forgiven. The next crash starts again at 1s. |
| A replica's container is gone | Recreates it from the deployment's stored configuration. |

Health probes run outside the tick, at most one in flight per replica. A probe that takes its full timeout does not delay the restart of some other application's replica.

Docker's own restart policy is set to `no` on every container. Two restart mechanisms would fight, and only the supervisor knows about backoff, health and crash loops.

### Restart policy

`restart.policy` in `deploy.yaml` decides what the supervisor does with a replica that is down.

| Policy | A replica that exited | A running replica that turned `unhealthy` |
|---|---|---|
| `always` (default) | Restarted, whatever the exit code. | Restarted. |
| `on-failure` | Restarted only after a non-zero exit code or an out-of-memory kill. A clean exit (code 0) leaves it stopped. | Restarted. |
| `never` | Left stopped. | Left running, marked `unhealthy`, out of rotation. |

When the policy leaves a replica stopped, the supervisor records that once as an event and does not look at the exit again.

### Backoff

The delay before a restart depends on how many restarts the replica has had without a stable run in between:

| Restart | Delay before it |
|---|---|
| 1st | 1s |
| 2nd | 2s |
| 3rd | 5s |
| 4th | 10s |
| 5th | 30s |
| 6th and later | 5m |

The same schedule paces restarts of a replica that runs but never turns healthy.

### CRASH_LOOP

After the fifth restart without a stable run, the replica is crash-looping. The application's status becomes `CRASH_LOOP`, an event says so, and the replica is retried every 5 minutes, indefinitely.

"Do not restart in a hot loop" and "give up" are different things. Most crash loops are caused by a dependency being down. The slow retry makes the application come back by itself when the dependency does.

```text
my-api  ● CRASH_LOOP

REPLICA   CONTAINER            STATE     HEALTH      RESTARTS         STARTED
1         shipwick_my-api_3_1   running   healthy     0                2h ago
2         shipwick_my-api_3_2   running   unhealthy   5 (crash loop)   34s ago

WHEN      EVENT
28s ago   Replica 2 did not become healthy within 30s of starting: HTTP 503
34s ago   Replica 2 is crash-looping: 5 restarts without staying up. Retrying every 5m
```

There are three ways out of a crash loop:

- The cause goes away and the replica has a stable run. The supervisor records "no longer crash-looping".
- A new deployment. It replaces the containers, and new containers start with a clean slate.
- `shipwick stop` followed by `shipwick start`. An explicit start resets the restart history of every replica.

### The stable-run rule

A replica's restart count returns to zero, and its crash-loop flag is cleared, once it has been running for 60 seconds since its last restart and is proven.

Proven means more than running. A replica with a health check is proven only once it has actually passed it. Otherwise an application that runs but never answers would be forgiven every minute and never reach `CRASH_LOOP`. A replica without a health check is proven by running.

### Reconciliation of missing containers

A replica whose container no longer exists (removed with `docker rm`, by `docker system prune`, by anything that is not Shipwick) is recreated from the active deployment's stored configuration within about a second: desired 3, present 2, create 1.

- Before a replica is declared gone, Docker is asked once more, by container ID. The container list alone is not trusted.
- A recreated replica with a health check is `starting`: it receives no traffic until it has passed its check.
- If recreation fails, for example because the image is gone and cannot be pulled again, the attempts back off on the same schedule as restarts.
- If the image was pruned from the server, it is pulled again before the container is created.
- Containers of the application that belong to any other deployment are leftovers, of an interrupted cleanup for instance, and are removed in the same pass. Job containers are not replicas and are left alone; they are removed when their run ends.

Reconciliation is also what completes an application after an interrupted deployment or a failed rollback: the active deployment in the database says how many replicas there should be, and the supervisor makes it so.

### What the supervisor remembers

Health, backoff position and crash-loop flags live in the agent's memory. After an agent restart every replica starts with a clean slate and its health is `unknown` until probed. Only the restart counter is persisted, for display.

Applications keep running while the agent is down or being upgraded, but nothing restarts them during that time. After a server reboot, the agent brings every application back up according to its restart policy.

### Events

What the supervisor sees and does is recorded as application events, shown by `shipwick status` and served by `GET /api/v1/applications/:name/events`:

```text
Replica 2 exited with code 137; restarting in 2s
Replica 2 restarted (attempt 2)
Replica 2 failed 3 health checks in a row: no response within 3s
Replica 2 is healthy
Replica 1 was killed for exceeding its memory limit; restarting in 1s
Replica 3's container shipwick_my-api_7_3 has disappeared
Recreated replica 3
```

Only the newest 500 events per application are kept. A stop or start made with a token other than root names it: `Application stopped by ci`. A scheduled job or one-off command that failed or timed out adds an event of type `job`; successful runs record nothing, since jobs run often.

### Notifications

With `SHIPWICK_WEBHOOK_URL` set on the agent, the supervisor reports two things about an application, and nothing else:

| Event | When |
|---|---|
| `application.down` | Not one replica is ready: none is running, or those running are failing their health check. The message says which: `my-api is down: 1 replica running but failing its health check. Shipwick restarts it as restart.policy allows; see why with: shipwick logs my-api`. |
| `application.recovered` | Every desired replica is ready and none has a restart still held against it. The message reads `my-api is healthy again: 2/2 replicas running 1.4.2`. |

*Recovered* is stricter than *not down* on purpose. A crash-looping replica runs for a moment between crashes; if that counted as a recovery, every restart would produce one outage and one recovery. The restarts are forgiven after the stable run of 60 seconds described above, and that is when the recovery is reported: one outage and one recovery per incident. A single replica restarting is in the event feed, not in the webhook. Failed jobs are reported as `job.failed`. See [Get notified](/docs/tasks/notifications).

## Application status

An application's status is derived from its deployment history, its desired state and the live state of its replicas.

| Status | Meaning |
|---|---|
| `HEALTHY` | All desired replicas of the active deployment are healthy. |
| `DEGRADED` | Some are. |
| `DOWN` | None are: not running, or running but failing their health check. |
| `CRASH_LOOP` | A replica keeps dying or never turns healthy, and its restarts are now limited to one every 5 minutes. Outranks `DEGRADED` and `DOWN`: it says that restarting is not helping. |
| `STOPPED` | Stopped on request. The supervisor leaves a stopped application alone. |
| `DEPLOYING` | The first deployment is in flight and nothing is active yet. |
| `FAILED` | No deployment has ever succeeded. |

A replica counts as healthy when it runs and its health is `healthy`, `unknown` or empty. Without a `health` block, the healthy count equals the running count.

During a rollout, the replica counts describe the replicas that are serving at that moment, a mix of the old and the new version, and the desired count is the capacity the rollout maintains: the smaller of the two replica counts. An application being upgraded therefore reads `HEALTHY`, not `DEGRADED`. The separate `deploying` flag says that a deployment is in flight.
