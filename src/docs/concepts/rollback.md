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
| `ROLLED_BACK` | The restored replicas are ready. Traffic returns to the previous version, and the remaining new containers are removed. So is the image the failed deployment named, unless it is the running version's or the rollback target's. |

Traffic leaves the new replicas only after the restored ones are verified, so capacity does not dip a second time.

A rollback changes no deployment pointers. The database never stops calling the previous deployment active until a new one commits, and a rolled-back deployment never committed. Once the rollout gives up its hold on routing, routing follows the database back to the previous deployment's replicas.

The events of the restore are recorded with the failed deployment. The previous deployment's record is immutable and is not touched.

`shipwick` reports the outcome and what is running now:

```text
✗ Deployment failed and was rolled back

  replica 2 did not become healthy within 30s: GET /health on port 8080: connection refused

my-api is running 1.4.1 again: the previous version was restored.
```

Through the API, `ROLLED_BACK` means that part of the previous version had already been replaced and was restored. `FAILED` means nothing of it was lost. In both cases `error` says why the deployment failed.

## Rolling back a recreate deployment

A [`recreate` deployment](/docs/concepts/deployments#recreate) stops the old version before the new one starts, and keeps its containers, stopped. A failure of the new version is undone in the reverse order:

1. The new containers are removed first. They must be gone before the old version touches the volumes again.
2. The stopped containers of the old version are started again, without their names, and verified against the previous deployment's own health check. They earn the names back once they are ready. The events say `Rolling back: starting 1.4.1 again`.
3. The deployment ends as `ROLLED_BACK`: `Rolled back: my-api is running 1.4.1 again`.

If the old containers had already been removed, which happens once the new version was ready and had taken over, new containers of the old version are created from the previous deployment's stored configuration instead. The volumes are still there; the old version finds its data in them.

The application is down from the moment the old version was stopped until the restored one is ready. A recreate rollback that fails ends as `FAILED` with both causes in `error`, like an automatic rollback of a rolling deployment.

## Rollback on request

```bash
shipwick rollback            # to the most recent earlier successful deployment
shipwick rollback --to 3     # to deployment #3, as numbered by `shipwick status`
```

A rollback is not a special mechanism. It is a deployment whose configuration comes from the history instead of from a file, and it goes through the same engine as any other deployment: rolled out replica by replica, health-checked, without downtime. An application with `deploy.strategy: recreate` is rolled back the way it is deployed: the running version is stopped first, then the earlier one is started, and the application is down in between. Its volumes are the same ones; a rollback does not touch the data.

```text
Rolling back my-api to 1.4.1  (deployment #3)...

✓ Replica 1/2 is serving 1.4.1; its 1.4.2 predecessor is retired
✓ Replica 2/2 is serving 1.4.1; its 1.4.2 predecessor is retired
✓ Deployment successful
```

**The whole configuration returns, not only the image.** Environment values, replica count, limits, hostnames, published ports, jobs and health check come back as they were stored with that deployment. Secrets are included, and they never leave the server to do so; a value the agent filled in from a stored secret is restored as that deployment used it, whatever the secret says now. This is also why rollback exists as a server-side operation at all: the API only ever returns configurations with environment values masked, so no client could re-submit one.

**What the target needs to still be there.** The image of the version before the one running is always kept, so a rollback to it never waits for a pull. Further back, an image from a registry is pulled again, with the credential the agent keeps for that registry if there is one ([Pull from private registries](/docs/tasks/private-registries)); an image that was built on a developer's machine cannot be, and a rollback to a version whose image was pruned, or that this server was never sent, fails with `… is not on this server; it was built on a developer's machine — run shipwick deploy from the project again`. A static application is rolled back to the folder the proxy kept for that version, with no upload; the folder of the serving version and of the one before it are kept, and a rollback further back fails with `the files of <version> are no longer on the server: deploy the folder again`. An application that was a folder and is now deployed as a container keeps its last folder for as long as a plain `shipwick rollback` would return to it, which is until its second container version.

**A `pre_deploy` command runs on a rollback too.** A rollback is a deployment, and the stored configuration is deployed whole: if it has a `pre_deploy` command, that command runs from the older image, before any replica of it starts, and a failure fails the rollback with nothing touched. A migration that cannot run backwards will stop a rollback here; see [Deployments](/docs/concepts/deployments#before-the-replicas-start-the-pre-deploy-command).

**The configuration is resolved under the application's lock.** "The active deployment" is still the active deployment when the new record is created. Its hostnames and published ports are checked again, since another application may have taken them since; a conflict refuses the rollback as a configuration error before anything is recorded.

`shipwick redeploy` is the same idea applied to the running configuration: deploy it again, optionally with another image, without needing the `deploy.yaml` at hand. See [Roll back and redeploy](/docs/tasks/roll-back).

## Which deployments can be targets

Only deployments that once served successfully are targets. In terms of the state machine, a target must have the status `SUPERSEDED` and belong to the same application.

- A `FAILED` or `ROLLED_BACK` deployment is not a target. By the evidence, its configuration is not one to return to.
- The `ACTIVE` deployment is not a target. It is what is running now. Use `redeploy` to deploy it again.
- Without an explicit target, the agent picks the most recent `SUPERSEDED` deployment of the application.

If there is no valid target, the API answers `409 NO_ROLLBACK_TARGET`. If the requested deployment does not exist, it answers `404 NOT_FOUND`. An application with no active deployment answers `409 NOT_DEPLOYED`.

## History is only appended to

A rollback creates a new deployment record with the next sequence number. Its `kind` is `rollback`, its `source_deployment_id` points at the deployment whose configuration it re-used, and `by` names the token that asked for it. The target's own record does not change, and nothing in the history is rewritten.

With a webhook configured on the agent, a rollback that succeeds is reported as `deployment.rolled_back`, the same event an automatic rollback produces. See [Get notified](/docs/tasks/notifications).

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

An agent that stops while a deployment is being rolled back leaves it where it is, and since 0.5 the next start finishes the rollback: missing replicas of the previous version are created, all of them verified, and what is left of the failed version removed. See [Agent restarts during a deployment](/docs/concepts/deployments#agent-restarts-during-a-deployment).
