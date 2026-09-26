---
title: Deployments
description: How a deployment moves through its state machine, how replicas are replaced one at a time or recreated, when a deployment is done, and what happens when it fails.
---

# Deployments

A deployment is an immutable record of one attempt to run one configuration of an application. This page describes the states it moves through, how replicas are replaced, when a deployment is finished, and what a failure does to the version that was running.

## The deployment record

Every attempt is recorded, whether it succeeds or not. A record holds:

| Field | Meaning |
|---|---|
| `id` | Identifier, unique on the server. This is what the API uses. |
| `sequence` | Per-application counter: #1, #2, and so on. This is what `shipwick status` shows and what `shipwick rollback --to` takes. It is also part of the container names. |
| `version` | Derived from the image reference: its tag, or a shortened digest, or `latest` when the reference has neither. |
| `image` | The image reference. |
| `spec` | The complete configuration, as validated. Stored with the deployment and never changed afterwards. |
| `status` | The current state of the state machine. |
| `error` | Why the deployment failed, if it did. |
| `kind` | `deploy`, `redeploy` or `rollback`. |
| `source_deployment_id` | For a redeploy or rollback, the deployment whose configuration was re-used. |
| `started_at`, `completed_at` | When the record was created, and when the agent was done with it. |

A deployment begins in one of three ways. `deploy` submits a `deploy.yaml`. `redeploy` takes the configuration of the active deployment, optionally with another image. `rollback` takes the configuration of an earlier successful deployment. All three resolve a configuration and hand it to the same entry point, so everything below applies to each of them. See [Rollback](/docs/concepts/rollback).

Before a record is created, the agent checks the application's `domain`. If another application, the agent or the dashboard is already served on it, the request is refused as a configuration error. Nothing is recorded, pulled or started.

## States

```text
PENDING → BUILDING → STARTING → HEALTH_CHECKING → HEALTHY → ACTIVE → SUPERSEDED
    │         │          │              │             │
    └─────────┴──────────┴──────────────┴─────────────┴──→ FAILED
                                                              │
                                        ROLLED_BACK ← RESTORING ← ROLLBACK
```

| State | What happens |
|---|---|
| `PENDING` | The record exists and the application's lock is held. The API has answered `202 Accepted`. |
| `BUILDING` | The image is pulled. Shipwick does not build images; this state covers obtaining one. If the pull fails but the image exists locally, the local copy is used and a warning is recorded. |
| `STARTING` | The networks are ensured. The first new replica is created, recorded and started. On a first deployment, and under `recreate`, all replicas are. |
| `HEALTH_CHECKING` | Every new replica must prove it is ready before it takes traffic. With a `health` block it must answer its check once within `interval × retries`, probed every second. Without one it must stay running through a 3 second stabilization window. A replica that exits fails the deployment at once. Replicas are replaced one at a time during this state. |
| `HEALTHY` | Every replica has been replaced and serves. |
| `ACTIVE` | The commit point. One database transaction promotes the deployment, marks the previous one `SUPERSEDED` and repoints the application. A final sweep then removes any container of the application that does not belong to the new deployment. |
| `SUPERSEDED` | A later deployment became `ACTIVE`. Superseded deployments are the possible targets of a rollback. |
| `FAILED` | The deployment cannot succeed. If nothing of the old version had been retired, routing returns to it, the new containers are discarded, and this is the final state. Otherwise the rollback path follows. |
| `ROLLBACK`, `RESTORING`, `ROLLED_BACK` | The previous version is made whole again. See [Rollback](/docs/concepts/rollback). |

The final states are `ACTIVE` (later `SUPERSEDED`), `FAILED` and `ROLLED_BACK`. `ACTIVE` is the only success.

Illegal transitions are rejected by the engine, and every transition is a compare-and-swap in the database (`UPDATE … WHERE status = <expected>`), so a stale writer can never overwrite a newer state.

## Rolling replacement

Deployments are rolling by default (`deploy.strategy: rolling`). Replicas are replaced one at a time:

```text
for every replica i:
    start new i → wait until it is ready → route to new i instead of old i → retire old i
then: retire old replicas that have no successor (scaling down) → commit
```

```text
v1.4.1  ├── replica 1 ──▶ v1.4.2 replica 1 starts ─▶ healthy ─▶ takes traffic ─▶ old replica 1 retired
        ├── replica 2 ──▶ v1.4.2 replica 2 …
        └── replica 3 ──▶ v1.4.2 replica 3 …
```

**The peak is N+1 containers.** Starting the whole new version next to the old one would be simpler, because nothing of the old version would be touched before the commit. It would also need 2N containers for the duration, and Shipwick is for small servers: a 1 GB application with two replicas would need 4 GB to deploy. Rolling peaks at N+1 containers and never serves with fewer than N.

**Replicas with nothing to replace start together.** On a first deployment, or when scaling up, the additional replicas start as one batch, so that N replicas do not cost N waits. When scaling down, the surplus old replicas are retired last, after every new replica serves.

**Both versions serve side by side for a moment.** As with any rolling update, the two versions must be able to coexist. Database migrations, above all, must be backward compatible.

### When traffic moves

A new replica joins the rotation only after it is ready. At each swap the order is fixed:

1. The new replica is given the application's names on the services network. The proxy and the other applications find it at their next lookup.
2. The rollout waits 1.5 seconds, so that the proxy's next lookup has found the newcomer.
3. Only then is the predecessor stopped: `SIGTERM`, and `SIGKILL` after a 10 second grace period. It keeps its names until it stops; stopping is what takes it out of Docker's DNS.

The proxy's configuration is not loaded at a swap. It names the application, not its replicas, and changes only when a domain or a port does. If Docker or the proxy cannot be updated, the deployment fails at that swap, before the predecessor is touched.

During a rollout no single deployment record describes who serves ("new 1, old 2, old 3"), and the database still names the old deployment as active. The rollout therefore dictates the application's routing until it commits or fails. At the commit the database says the same thing the rollout did; on failure, routing follows the database back to the previous deployment. See [Routing and HTTPS](/docs/concepts/routing-and-https).

Deploying to a stopped application starts it: the commit sets the application's desired state back to running.

### Progress events

Each deployment carries a list of events. `state` events mark transitions; `step` events are meant to be shown to users, and `shipwick deploy` prints them as they appear:

```text
state  BUILDING
step   Pulled image ghcr.io/company/my-api:1.4.2
state  STARTING
step   Started 1 container
state  HEALTH_CHECKING
step   Replica 1 passed health checks        (or: "running and stable" without a health block)
step   Replica 1/2 is serving 1.4.2; its 1.4.1 predecessor is retired
step   Replica 2 passed health checks
step   Replica 2/2 is serving 1.4.2; its 1.4.1 predecessor is retired
state  HEALTHY
step   Routed https://api.example.com to 2 replicas   (only with a domain)
state  ACTIVE
step   Deployment successful
```

## Recreate

`deploy.strategy: recreate` is for the application that cannot run twice: anything with a volume, or that holds a lock or a port it cannot share. A database, above all. Applications with `volumes` must use it; an application without volumes may.

```yaml
deploy:
  strategy: recreate
```

The same rollout runs it with three differences:

1. **The old version is stopped first.** After the image is pulled, the running version is taken out of the proxy and stopped, one replica at a time, gracefully. The containers are kept, not removed. The events say why: `Stopped 1.4.1: 1.4.2 cannot run next to it`.
2. **All new replicas start as one batch**, since nothing runs that they could disturb. They are verified like any new replica, against the health check or the stabilization window, and then given the application's names. The stopped containers of the old version are removed at that point.
3. **A failure is undone by starting the old containers again.** See [Rollback](/docs/concepts/rollback#rolling-back-a-recreate-deployment).

The application is down from the stop to the moment the new version is ready: its domain answers `503`, its name on the services network is carried by nobody, and `shipwick status` reads `DOWN`. The downtime is the new version's start time, plus what it takes to verify it. With a `health` block that is until the first passing probe; without one, the 3 second stabilization window.

```text
Deploying postgres...

✓ Validated deploy.yaml (1 variable substituted)
✓ Pulled image postgres:17.1
✓ Stopped 17: 17.1 cannot run next to it
✓ Started 1 container
✓ Replica 1 running and stable
✓ Replica 1/1 is serving 17.1; its 17 predecessor is retired
✓ Deployment successful
```

Volumes without `recreate`, or with more than one replica, are refused by validation: two versions writing the same files at once is how data gets lost. See [Run a database or other stateful application](/docs/tasks/stateful-applications).

## When a deployment is done

A deployment's status settles (`ACTIVE`, `FAILED`) slightly before the agent is finished with it. Old containers still need their graceful shutdown, and failed ones still need to be removed. During that window the application is still locked.

`completed_at` is stamped only after cleanup and after the lock is released. It is the reliable signal:

> Poll `GET /api/v1/deployments/:id` until `completed_at` is set. From that moment a new operation on the application is guaranteed not to be rejected as busy.

`FAILED` in particular is not necessarily the end: a deployment that fails after some replicas were replaced continues through `ROLLBACK`, `RESTORING` and `ROLLED_BACK`. `shipwick deploy` waits for `completed_at`, not for the first settled status.

## One operation per application

Deploy, redeploy, rollback, stop, start, delete and the supervisor all contend for one in-memory lock per application. Different applications are fully independent.

There is no queue. A queue hides the conflict from the person who needs to know about it. What a client sees depends on who holds the lock:

| Held by | A user operation |
|---|---|
| Another user operation | Fails at once with `409 DEPLOYMENT_IN_PROGRESS`. `shipwick` prints "Another operation is already in progress for this application." |
| The supervisor | Waits, up to 30 seconds. The supervisor holds an application for moments, to restart a replica. |

The supervisor itself never waits. A busy application is looked at again on its next tick, one second later.

While a deployment is in flight, the application's `deploying` field is `true` and `in_flight_deployment_id` names the deployment to follow. An application can be `HEALTHY`, with the old version serving, and `deploying` at once.

## When a deployment fails

A new replica that crashes, is killed for exceeding its memory limit, or never becomes ready fails the deployment. So does an image that cannot be obtained, a proxy that cannot be updated, and a deployment that takes longer than 15 minutes in total, image pull included.

If a replica crashed or never became healthy, its last 20 lines of output are saved with the deployment as a `log` event. The container is about to be deleted, and with it the only clue.

What happens next depends on how far the rollout had come.

**Before the first replica was replaced.** This is the usual case: a bad image rarely survives its first health check. Nothing of the old version was touched. The new containers are removed and the deployment ends as `FAILED`.

```text
✗ Deployment failed

  replica 1 exited with code 1 shortly after start

  Last output of replica 1:
  panic: DATABASE_URL is not set

my-api is still running 1.4.1; the failed deployment did not affect it.
```

**After some replicas were replaced.** Old replicas are retired before the commit, so a failure half-way leaves the previous version incomplete. The retired replicas are recreated from the previous deployment's stored configuration and verified, traffic returns to them, and the deployment ends as `ROLLED_BACK`. The new replicas that were already serving keep serving until the restored ones are ready, so capacity does not dip twice. See [Rollback](/docs/concepts/rollback).

Measured under constant load: a rolling redeploy of 3 replicas answered 100 of 100 requests with `200`, with 3 to 4 containers throughout. A rollout sabotaged at its second replica was rolled back, and 76 of 76 requests were answered with `200`. A rollout does not reload the proxy, so this holds over a real network too: with a new connection per request, 12 clients and 50 ms of added latency, 18 consecutive rolling redeploys answered 15,774 of 15,774 requests. See [What a deployment costs](/docs/concepts/routing-and-https#what-a-deployment-costs).

**Under `recreate`.** The old version has been stopped by the time a new replica can fail, so the failure is always undone: the new containers are removed, the stopped containers are started again, and the deployment ends as `ROLLED_BACK`. See [Rollback](/docs/concepts/rollback#rolling-back-a-recreate-deployment).

### Agent restarts during a deployment

If the agent is shut down while a deployment runs, the deployment is cancelled, marked `FAILED` and cleaned up. A failing rollout does not start a restore it could not finish during shutdown. If the agent crashes instead, the deployment is marked `FAILED` on the next start and its leftover containers are removed. In both cases the previous deployment is still the active one in the database, and the supervisor's reconciliation completes it again. See [Health checks and supervision](/docs/concepts/health-and-supervision).

Pressing Ctrl+C in `shipwick deploy` stops the waiting, not the deployment.
