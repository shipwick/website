---
title: Your first deployment
description: Write a deploy.yaml, deploy it with deployctl, watch a rolling update, and see what a failed deployment looks like.
---

# Your first deployment

This page takes one application from nothing to running on your server, then updates it, then breaks it on purpose. It assumes a server with [Shipwick installed](/docs/getting-started/install) and `deployctl` [installed and logged in](/docs/getting-started/install-cli).

You need a Docker image the server can pull. The examples use `ghcr.io/company/my-api`, which listens on port 8080 and answers `GET /health`. For an image in a private registry, see [Pull from private registries](/docs/tasks/private-registries) first.

## Create deploy.yaml

In your application's repository:

```bash
deployctl init
```

`init` asks for the application name (the default is the directory name), the image, the port the application listens on, and a public domain. Port and domain are optional. With `--image` it never prompts, which suits scripts:

```bash
deployctl init --name my-api --image ghcr.io/company/my-api:1.4.1 --port 8080 --domain api.example.com
```

```text
✓ Created deploy.yaml

Review it, then run: deployctl deploy
```

`init` refuses to overwrite an existing `deploy.yaml` unless you pass `--force`.

## Review deploy.yaml

The file contains your answers as live settings and everything else as commented-out examples:

```yaml
name: my-api

# Pin a version tag: deployments are recorded (and rolled back) by it.
image: ghcr.io/company/my-api:1.4.1

# The port your application listens on inside the container.
port: 8080

# Served over HTTPS automatically.
domain: api.example.com

replicas: 1

# env:
#   DATABASE_URL: postgres://user:password@host:5432/db

# A replica receives traffic only once this endpoint answers 2xx.
# health:
#   path: /health
#   interval: 10s
#   timeout: 3s
#   retries: 3

# Per-replica limits. Unlimited when omitted.
# resources:
#   cpu: 1
#   memory: 512mb

restart:
  policy: always # always | on-failure | never
```

Only `name` and `image` are required. The image's tag becomes the deployment's version, so pin a version tag rather than `latest`.

For this walk-through, set `replicas: 2` and uncomment the `health` block. Two replicas make the rolling update visible, and a health check is what lets Shipwick tell a working version from a broken one. Without a `health` block, a deployment only verifies that replicas start and stay up for a few seconds.

The DNS record for `domain` must point at the server. Every field is described in the [deploy.yaml reference](/docs/reference/deploy-yaml).

## Validate

`validate` checks the file offline and shows how it will be applied, defaults included:

```bash
deployctl validate
```

```text
✓ deploy.yaml is valid

Name           my-api
Image          ghcr.io/company/my-api:1.4.1
Version        1.4.1
Replicas       2
Port           8080
Domain         api.example.com
Health check   GET /health every 10s (timeout 3s, 3 retries)
Resources      unlimited CPU, unlimited memory
Restart        always
```

Mistakes are reported all at once, by field:

```text
invalid deploy.yaml

port:
  invalid value 99999
  expected: a number between 1 and 65535

resources.memory:
  invalid value "abc"
  expected: 128mb, 512mb, 1gb, ...
```

`deploy` runs the same validation, and the agent validates again on its side.

## Deploy

```bash
deployctl deploy
```

`deploy` sends the file to the agent and waits for the result. On a first deployment there is nothing to replace, so all replicas start together:

```text
Deploying my-api...

✓ Validated deploy.yaml
✓ Pulled image ghcr.io/company/my-api:1.4.1
✓ Started 2 containers
✓ 2 replicas passed health checks
✓ Routed https://api.example.com to 2 replicas
✓ Deployment successful
```

A summary follows: the version, how long the deployment took, how many replicas are healthy, and the URL. Caddy obtains the certificate for the domain on its own.

Pressing Ctrl+C while `deploy` waits stops the waiting, not the deployment.

## Look at what is running

```bash
deployctl status     # version, CPU and memory, replicas, recent deployments, supervisor events
deployctl ps         # every application on the server
deployctl logs -f    # follow the logs of all replicas
```

Run in the directory that holds `deploy.yaml`, these commands act on the application named in it. Elsewhere, name the application: `deployctl status my-api`. More in [Inspect applications and read logs](/docs/tasks/inspect-and-logs).

## Deploy a new version

Change the image tag in `deploy.yaml` to `1.4.2` and deploy again:

```bash
deployctl deploy
```

```text
Deploying my-api...

✓ Validated deploy.yaml
✓ Pulled image ghcr.io/company/my-api:1.4.2
✓ Started 1 container
✓ Replica 1 passed health checks
✓ Replica 1/2 is serving 1.4.2; its 1.4.1 predecessor is retired
✓ Replica 2 passed health checks
✓ Replica 2/2 is serving 1.4.2; its 1.4.1 predecessor is retired
✓ Routed https://api.example.com to 2 replicas
✓ Deployment successful

my-api 1.4.2  deployed in 6.1s
2/2 replicas healthy
https://api.example.com
```

This is a rolling update. Replicas are replaced one at a time. Each new replica must pass its health check before it joins the rotation, and the old replica it replaces leaves the rotation before it is stopped. There is never more than one container above the desired count, and serving capacity never drops below it.

For a moment both versions serve side by side, so the two must be able to coexist. Database migrations, above all, must be backward compatible. [Deployments](/docs/concepts/deployments) explains the mechanism in full.

If `logs -f` was running, it ends when the old containers are replaced. Run it again to follow the new ones.

## When a deployment fails

Suppose the next version cannot start, because it needs an environment variable nobody set. `deploy` tells you why it failed, and whether users were affected:

```text
✗ Deployment failed

  replica 1 exited with code 1 shortly after start

  Last output of replica 1:
  panic: DATABASE_URL is not set

my-api is still running 1.4.2; the failed deployment did not affect it.
```

`deployctl deploy` exits with status 1. The failed replica's last log lines are saved with the deployment, the new containers are removed, and the old version keeps serving.

What happens next depends on how far the rollout got:

- If the first new replica failed — the usual case — nothing of the old version was touched. The deployment is `FAILED`.
- If some old replicas had already been replaced, they are recreated from the previous deployment's stored configuration, verified, and given traffic again. The deployment is `ROLLED_BACK`, and the command reports `Deployment failed and was rolled back`.

A replica that never answers its health check fails the deployment the same way:

```text
✗ Deployment failed

  replica 1 did not become healthy within 30s: GET /health on port 8080: connection refused
```

A new replica has `interval × retries` to answer — 30 seconds by default. Raise `retries` for an application that starts slowly.

Every attempt, failed or not, is kept in the history that `deployctl status` shows. Only one deployment per application runs at a time; a second is refused rather than queued.

## What's next

- [Deploy from CI](/docs/tasks/deploy-from-ci) with `deployctl deploy --image`.
- [Roll back](/docs/tasks/roll-back) to an earlier version.
- Concepts: [Deployments](/docs/concepts/deployments), [Health and supervision](/docs/concepts/health-and-supervision), [Routing and HTTPS](/docs/concepts/routing-and-https).
- Reference: [deploy.yaml](/docs/reference/deploy-yaml), [deployctl](/docs/reference/deployctl).
