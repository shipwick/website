---
title: Roll back and redeploy
description: Return an application to an earlier successful deployment with shipwick rollback, or deploy the running configuration again with shipwick redeploy.
---

# Roll back and redeploy

This page covers the two commands that deploy from the server's history instead of from a file: `shipwick rollback` returns to an earlier deployment, and `shipwick redeploy` deploys the running configuration again. Neither needs the `deploy.yaml` at hand.

A deployment that fails is undone by the agent without your help. This page is about going back on request: the new version deployed successfully and turned out to be wrong.

## Roll back to the previous version

```bash
shipwick rollback
```

```text
Rolling back my-api to 1.4.1  (deployment #3)...

✓ Replica 1/2 is serving 1.4.1; its 1.4.2 predecessor is retired
✓ Replica 2/2 is serving 1.4.1; its 1.4.2 predecessor is retired
✓ Deployment successful
```

Without `--to`, the target is the most recent deployment that once served successfully and has since been replaced — in practice, the version that ran before the current one.

Like other commands, `rollback` acts on the application named in `./deploy.yaml`. From anywhere else, name it:

```bash
shipwick rollback my-api
```

## Roll back to a specific deployment

Deployments are numbered per application. `shipwick status` lists the recent ones:

```text
DEPLOY   VERSION   STATUS       VIA      WHEN
#5       1.4.3     FAILED       deploy   5m ago   replica 1 exited with code 1 shortly after start
#4       1.4.2     ACTIVE       deploy   2h ago
#3       1.4.1     SUPERSEDED   deploy   3d ago
```

Pass the number, without the `#`, to `--to`:

```bash
shipwick rollback --to 3
```

## Which deployments are valid targets

Only deployments that once served successfully are targets. In the history they have the status `SUPERSEDED`: they were active, and a later deployment replaced them. A `FAILED` attempt is not a version to return to, and neither is one that was `ROLLED_BACK`.

`shipwick` resolves the target before it asks the agent for anything, so what it announces is exactly what it requests. When the target is not valid, it says so and exits 1:

| Situation | Message |
|---|---|
| `--to N` names the active deployment | `deployment #N is the one running right now` |
| `--to N` names a deployment that never succeeded | `deployment #N never ran successfully (FAILED), so there is nothing to go back to` |
| `--to N` names a number that does not exist | `there is no deployment #N` |
| No `--to`, and nothing earlier ever succeeded | `there is no earlier successful deployment to go back to` |

The agent applies the same rule. It also refuses a target that belongs to another application.

## What a rollback is

A rollback is not a special mechanism. It is an ordinary deployment whose configuration comes from the history instead of from a file, and it goes through the same engine: rolled out replica by replica, health-checked, zero-downtime. If the old version no longer comes up today, the rollback is undone like any other failed deployment.

- **The whole configuration returns**, not only the image: `env` values, replicas, limits, domain and health check, as they were stored with that deployment. Secrets are included, and they never leave the server to do so.
- **History is appended to, never rewritten.** A rollback is a new deployment record with a new number. It is marked `rollback` in the `VIA` column of `shipwick status` and points at the deployment it re-used.
- **Your `deploy.yaml` is not changed.** If the file in your repository still describes the version you rolled back from, the next `shipwick deploy` deploys that version again.

Because both versions serve side by side for a moment during any rollout, the old version must be able to run next to the new one — for example, against the database schema the new version left behind.

## Deploy the running configuration again

`redeploy` applies the same idea to the active deployment: the agent re-uses the configuration it stored with it, `env` values included.

```bash
shipwick redeploy
```

This replaces all containers of the application with fresh ones, one at a time. It is also a way out of a crash loop, since new containers start with a clean slate.

To move the application to another image without touching anything else:

```bash
shipwick redeploy --image ghcr.io/company/my-api:1.4.3
```

```text
Redeploying my-api with ghcr.io/company/my-api:1.4.3...
```

A redeploy is recorded as a new deployment, marked `redeploy` in the history. If the application has no successful deployment yet, there is nothing to redeploy:

```text
This application has no successful deployment yet.

Deploy it with: shipwick deploy
```

## Options

Both commands accept:

| Flag | |
|---|---|
| `--no-wait` | Start the operation and return immediately |
| `-f`, `--file` | Read the application name from another `deploy.yaml` |

`rollback` also accepts `--to N`; `redeploy` also accepts `--image`. Both exit 0 on success and 1 otherwise, as `deploy` does. Only one operation per application runs at a time; a second is refused.

## From the dashboard

The [dashboard](/docs/tasks/dashboard) offers both actions. Its rollback dialog lists exactly the deployments that are valid targets.

## What's next

- [Rollback](/docs/concepts/rollback) explains the design.
- [Deployments](/docs/concepts/deployments) explains what happens when a rollout fails half-way.
