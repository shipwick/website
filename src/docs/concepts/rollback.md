---
title: Rollback
description: How a failed rollout is rolled back automatically, how a rollback on request works as a new deployment of a stored configuration, and what happens if a rollback fails.
---

# Rollback

Shipwick rolls back in two situations: on its own, when a rollout fails after it has already replaced part of the running version, and on request. This page describes both, which deployments can be rollback targets, and what happens when a rollback itself fails.

## Automatic rollback of a failed rollout

A [rolling deployment](/docs/concepts/deployments) retires old replicas before the commit. That is the price of never running more than N+1 containers. A failure half-way therefore leaves the previous version incomplete, and the agent completes it again.

Whether a rollback is needed depends on when the failure happens:

- **No old replica had been retired yet.** Nothing was lost. The new containers are removed and the deployment ends as `FAILED`. This is the common case, because a bad image usually fails at the first replica.
- **At least one old replica had been retired.** The deployment continues from `FAILED` through the rollback path:

```text
FAILED → ROLLBACK → RESTORING → ROLLED_BACK
```

| State | What happens |
|---|---|
| `FAILED` | The cause is recorded in the deployment's `error`. It stays there through the rest of the path. |
| `ROLLBACK` | The new replicas that never made it into rotation are removed. They are the failure, and they hold the one slot of headroom the restore needs. New replicas that are already serving keep serving. |
| `RESTORING` | The replicas of the previous deployment that had been retired are recreated from that deployment's stored configuration. They are verified like any new replica, against the previous version's own health check and port. |
| `ROLLED_BACK` | The restored replicas are ready. Traffic returns to the previous version, and the remaining new containers are removed. |

Traffic leaves the new replicas only after the restored ones are verified, so capacity does not dip a second time.

A rollback changes no deployment pointers. The database never stops calling the previous deployment active until a new one commits, and a rolled-back deployment never committed. Once the rollout gives up its hold on routing, routing follows the database back to the previous deployment's replicas.

The events of the restore are recorded with the failed deployment. The previous deployment's record is immutable and is not touched.

`shipwick` reports the outcome and what is running now:

```text
✗ Deployment failed and was rolled back

  replica 2 did not become healthy within 30s: GET /health on port 8080: connection refused

my-api is running 1.4.1 again: the replicas that had already been replaced were restored.
```

Through the API, `ROLLED_BACK` means that part of the previous version had already been replaced and was restored. `FAILED` means nothing of it was lost. In both cases `error` says why the deployment failed.

## Rollback on request

```bash
shipwick rollback            # to the most recent earlier successful deployment
shipwick rollback --to 3     # to deployment #3, as numbered by `shipwick status`
```

A rollback is not a special mechanism. It is a deployment whose configuration comes from the history instead of from a file, and it goes through the same engine as any other deployment: rolled out replica by replica, health-checked, without downtime.

```text
Rolling back my-api to 1.4.1  (deployment #3)...

✓ Replica 1/2 is serving 1.4.1; its 1.4.2 predecessor is retired
✓ Replica 2/2 is serving 1.4.1; its 1.4.2 predecessor is retired
✓ Deployment successful
```

**The whole configuration returns, not only the image.** Environment values, replica count, limits, domain and health check come back as they were stored with that deployment. Secrets are included, and they never leave the server to do so. This is also why rollback exists as a server-side operation at all: the API only ever returns configurations with environment values masked, so no client could re-submit one.

**The configuration is resolved under the application's lock.** "The active deployment" is still the active deployment when the new record is created.

`shipwick redeploy` is the same idea applied to the running configuration: deploy it again, optionally with another image, without needing the `deploy.yaml` at hand. See [Roll back and redeploy](/docs/tasks/roll-back).

## Which deployments can be targets

Only deployments that once served successfully are targets. In terms of the state machine, a target must have the status `SUPERSEDED` and belong to the same application.

- A `FAILED` or `ROLLED_BACK` deployment is not a target. By the evidence, its configuration is not one to return to.
- The `ACTIVE` deployment is not a target. It is what is running now. Use `redeploy` to deploy it again.
- Without an explicit target, the agent picks the most recent `SUPERSEDED` deployment of the application.

If there is no valid target, the API answers `409 NO_ROLLBACK_TARGET`. If the requested deployment does not exist, it answers `404 NOT_FOUND`. An application with no active deployment answers `409 NOT_DEPLOYED`.

## History is only appended to

A rollback creates a new deployment record with the next sequence number. Its `kind` is `rollback`, and its `source_deployment_id` points at the deployment whose configuration it re-used. The target's own record does not change, and nothing in the history is rewritten.

Rolling back from #5 to the configuration of #3 produces deployment #6. Deployment #5 becomes `SUPERSEDED` and is itself a valid target from then on.

`shipwick status` shows the origin of each entry in the `VIA` column.

## When a rollback fails

**A rollback on request that fails** is handled like any other failed deployment. If the old version no longer comes up today, for example because a dependency it needs is gone, the rollback deployment fails at its first replica and ends as `FAILED` with nothing touched. If it fails after some replicas were replaced, it is itself rolled back automatically, and the version that was running before the request is restored.

**An automatic rollback that fails** means the previous version could not be completed either. The deployment returns to `FAILED`, and `error` records both causes: the original failure, and why the restore failed. The agent then:

- removes the containers it created for the restore;
- removes the new replicas, including those that were still serving;
- hands routing back to the database, which still names the previous deployment as the active one.

From there the supervisor's reconciliation keeps trying to recreate the missing replicas of the previous deployment, on the same backoff schedule as restarts. The application may be `DEGRADED` or `DOWN` in the meantime. `shipwick` says what is true at that moment instead of assuming the usual outcome:

```text
my-api is running 1.4.1, but it is DEGRADED right now (1/2 replicas healthy). Shipwick keeps trying to restore it:
  shipwick status my-api
```

If the image of the previous version has been pruned from the server since it was deployed, recreating a replica pulls it again first.

If the agent is shutting down when a rollout fails, it does not start a restore it could not finish. The next start reaches the same end state: the interrupted deployment is `FAILED`, and reconciliation completes the previous version. See [Health checks and supervision](/docs/concepts/health-and-supervision).
