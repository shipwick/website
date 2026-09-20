---
title: Health checks and supervision
description: How the HTTP health check works during and after a deployment, how the supervisor restarts replicas with backoff, what CRASH_LOOP means, and how missing containers are reconciled.
---

# Health checks and supervision

Shipwick checks replicas over HTTP while they are deployed and for as long as they run, and restarts those that exit or stop answering. This page describes the health check, the supervisor's restart and backoff rules, reconciliation of missing containers, and the application statuses that result.

## The health check

```yaml
port: 8080
health:
  path: /health    # must answer 2xx; redirects do not count
  interval: 10s
  timeout: 3s
  retries: 3
```

One probe is one request: `GET http://<container ip>:<port><path>`, sent by the agent over the application network with the header `User-Agent: shipwick-health-check`.

- **A status from 200 to 299 is healthy.** Anything else is a failed probe, reported as `HTTP <status>`.
- **No answer within `timeout` is a failed probe.** So is a refused or closed connection.
- **Redirects are not followed.** A redirect is an answer, not a 2xx, and following it could walk the probe off the container network.
- **Every probe opens a fresh connection.** A kept-alive connection can outlive a wedged listener and report a dead application as healthy.
- **The probe goes direct.** An HTTP proxy configured in the agent's environment is never used.

Defaults and limits of the four fields are in the [deploy.yaml reference](/docs/reference/deploy-yaml#health).

The same probe is used in two places with different patience.

### During a deployment: the startup budget

Every new replica must answer its check once before it may take traffic. It has `interval × retries` to do so, 30 seconds with the defaults. This is the replica's startup budget.

During that time the replica is probed every second, not every `interval`. A connection refused by an application that is still booting is "not yet", not a strike, and a fast application is confirmed in about a second instead of waiting ten to be told it was ready after one. A slow starter gets its time: raise `retries` for a JVM, or for an application that migrates its database on boot.

A replica that never answers within the budget fails the deployment, and the error says why:

```text
✗ Deployment failed

  replica 1 did not become healthy within 30s: GET /health on port 8080: connection refused
```

A replica that exits during the budget fails the deployment at once, without waiting for the budget to run out.

### Without a health check

Without a `health` block, a deployment only verifies that replicas start and stay up: each new replica must still be running after a stabilization window of 3 seconds. A replica that exits within the window fails the deployment.

After deployment, such a replica is healthy for as long as it runs. The supervisor restarts it when it exits, but cannot notice a process that runs and no longer serves.

### After deployment: continuous checking

The supervisor probes every running replica every `interval`. A single failed probe changes nothing. After `retries` consecutive failures the replica is marked `unhealthy`, leaves the proxy's rotation, and is restarted. This is the classic cure for a deadlocked process. One passing probe resets the failure count.

A replica that the supervisor has just restarted, or that was started with `deployctl start`, is `starting`. It gets its startup budget again before failures count, is probed every second meanwhile, and receives no traffic until its first passing check. If the budget runs out, it becomes `unhealthy`.

Each replica has one of these health values, shown by `deployctl status` and in the API's container list:

| `health` | Meaning |
|---|---|
| `""` (empty) | The application defines no health check. |
| `unknown` | Not probed yet, for example right after an agent restart. Counts as healthy. `deployctl status` shows it as `checking`. |
| `starting` | Started or restarted, still within its startup budget. Not routed to. |
| `healthy` | The last probe passed. |
| `unhealthy` | Failed `retries` consecutive probes, never came up within its budget, or is not running. Not routed to. |

`unknown` counts as fine on purpose: an application must not flap to `DOWN` because its supervisor was restarted.

::: info The agent must be able to reach container addresses
Probes go to container IP addresses. An agent running in a container, the recommended setup, finds itself through the Docker API and joins the application network on its own. An agent running as a host process reaches bridge networks directly on Linux. With Docker Desktop on macOS or Windows it cannot, and the agent warns at startup: applications with a `health` block will fail to deploy there.
:::

## The supervisor

The supervisor is one loop in the agent, ticking every second. For each application that has an active deployment and is meant to be running, it compares the replicas of the active deployment with what Docker reports. It acts on an application only while holding that application's lock, so it never interleaves with a deployment, a stop or a delete. If the lock is taken, the application is looked at again on the next tick.

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
- `deployctl stop` followed by `deployctl start`. An explicit start resets the restart history of every replica.

### The stable-run rule

A replica's restart count returns to zero, and its crash-loop flag is cleared, once it has been running for 60 seconds since its last restart and is proven.

Proven means more than running. A replica with a health check is proven only once it has actually passed it. Otherwise an application that runs but never answers would be forgiven every minute and never reach `CRASH_LOOP`. A replica without a health check is proven by running.

### Reconciliation of missing containers

A replica whose container no longer exists (removed with `docker rm`, by `docker system prune`, by anything that is not Shipwick) is recreated from the active deployment's stored configuration within about a second: desired 3, present 2, create 1.

- Before a replica is declared gone, Docker is asked once more, by container ID. The container list alone is not trusted.
- A recreated replica with a health check is `starting`: it receives no traffic until it has passed its check.
- If recreation fails, for example because the image is gone and cannot be pulled again, the attempts back off on the same schedule as restarts.
- If the image was pruned from the server, it is pulled again before the container is created.
- Containers of the application that belong to any other deployment are leftovers, of an interrupted cleanup for instance, and are removed in the same pass.

Reconciliation is also what completes an application after an interrupted deployment or a failed rollback: the active deployment in the database says how many replicas there should be, and the supervisor makes it so.

### What the supervisor remembers

Health, backoff position and crash-loop flags live in the agent's memory. After an agent restart every replica starts with a clean slate and its health is `unknown` until probed. Only the restart counter is persisted, for display.

Applications keep running while the agent is down or being upgraded, but nothing restarts them during that time. After a server reboot, the agent brings every application back up according to its restart policy.

### Events

What the supervisor sees and does is recorded as application events, shown by `deployctl status` and served by `GET /api/v1/applications/:name/events`:

```text
Replica 2 exited with code 137; restarting in 2s
Replica 2 restarted (attempt 2)
Replica 2 failed 3 health checks in a row: no response within 3s
Replica 2 is healthy
Replica 1 was killed for exceeding its memory limit; restarting in 1s
Replica 3's container shipwick_my-api_7_3 has disappeared
Recreated replica 3
```

Only the newest 500 events per application are kept.

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
