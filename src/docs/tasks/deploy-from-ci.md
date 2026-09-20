---
title: Deploy from CI
description: Run deployctl in a CI pipeline, pass the image you just built, and use the exit code as a gate.
---

# Deploy from CI

This page shows how to deploy from a pipeline: keep `deploy.yaml` in the repository, pass the image the pipeline built, and let the exit code of `deployctl deploy` decide whether the job passes.

## Before you begin

- The agent's API must be reachable from the CI runner. The usual way is to serve it over HTTPS by giving the agent a hostname (`SHIPWICK_AGENT_DOMAIN`), as described in [Install Shipwick on a server](/docs/getting-started/install).
- The pipeline must have pushed the image to a registry the server can pull from. For private registries, see [Pull from private registries](/docs/tasks/private-registries).
- Store the agent URL and the API token as secrets in your CI system. The token is equivalent to root SSH access to the server; give it the same care as a deploy key.

## Connect without logging in

A CI job needs no `deployctl login`. Set two environment variables:

| Variable | |
|---|---|
| `SHIPWICK_AGENT_URL` | The agent's URL, for example `https://agent.example.com` |
| `SHIPWICK_AGENT_TOKEN` | The API token |

`deployctl` never accepts the token as a flag, because arguments show up in `ps` and in logs. If the URL is plain HTTP and not the local machine, `deployctl` prints a warning on standard error before it sends the token.

## Deploy the image you just built

`--image` overrides the image in `deploy.yaml` for this deployment:

```bash
deployctl deploy --image ghcr.io/company/my-api:$GIT_SHA
```

The override is applied to the YAML document in memory. The agent still receives one plain `deploy.yaml`, and the file on disk is untouched. The image's tag becomes the deployment's version, so tagging images with the commit SHA makes every entry in the history traceable to a commit.

## A generic pipeline step

```bash
#!/bin/sh
set -eu

# Install deployctl. Pin the version so the pipeline does not change under you.
curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v0.1.0 sh -s -- --cli

# SHIPWICK_AGENT_URL and SHIPWICK_AGENT_TOKEN come from the CI system's
# secret store, as environment variables.

# Run from the directory that holds deploy.yaml.
deployctl deploy --image "ghcr.io/company/my-api:$GIT_SHA"
```

The installer puts `deployctl` in `/usr/local/bin` and uses `sudo` if that directory is not writable. To install elsewhere, set `SHIPWICK_BIN_DIR` to a directory on the `PATH`.

## A GitHub Actions job

This job assumes an earlier step or job has built and pushed `ghcr.io/company/my-api:<commit SHA>`, and that the repository has two secrets, `SHIPWICK_AGENT_URL` and `SHIPWICK_AGENT_TOKEN`.

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      SHIPWICK_AGENT_URL: ${{ secrets.SHIPWICK_AGENT_URL }}
      SHIPWICK_AGENT_TOKEN: ${{ secrets.SHIPWICK_AGENT_TOKEN }}
    steps:
      - uses: actions/checkout@v4

      - name: Install deployctl
        run: curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v0.1.0 sh -s -- --cli

      - name: Deploy
        run: deployctl deploy --image "ghcr.io/company/my-api:${{ github.sha }}"
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Anything else — including a deployment that the agent accepted but that then failed |

This makes `deployctl deploy` safe to use as a pipeline gate. When a deployment fails, the output says why, includes the last log lines of the replica that failed, and says whether the running version was affected:

```text
✗ Deployment failed

  replica 1 exited with code 1 shortly after start

  Last output of replica 1:
  panic: DATABASE_URL is not set

my-api is still running 1.4.1; the failed deployment did not affect it.
```

A failed deployment is undone by the agent. The job fails; the application keeps serving the previous version.

## Behavior in a pipeline

- **Output is plain when piped.** No colors and no progress line. `NO_COLOR` is honored too. Warnings go to standard error, so standard output stays parseable.
- **`deploy` returns when the deployment is complete**, not at the first sign of success. When it returns, the next `deploy` for the same application will not be refused with "operation in progress".
- **One deployment per application at a time.** A second one is refused, not queued, and `deployctl` exits 1 with `Another operation is already in progress for this application.` If two pipeline runs can overlap, serialize the deploy job.
- **Cancelling the job does not cancel the deployment.** Interrupting `deployctl deploy` stops the waiting; the deployment continues on the server.
- **Short agent outages are tolerated.** While waiting, `deployctl` rides out connection failures for a limited number of polls before it gives up.

## Return immediately with --no-wait

```bash
deployctl deploy --image ghcr.io/company/my-api:$GIT_SHA --no-wait
```

```text
✓ Deployment #8 started

Follow it with: deployctl status my-api
```

With `--no-wait`, the command returns as soon as the agent has accepted the deployment and exits 0. It says nothing about whether the deployment succeeds, so it is not a gate. Check the outcome later with `deployctl status`.

## Deploy without deploy.yaml

`redeploy` deploys the configuration the agent stored with the active deployment, `env` values included, and optionally changes the image. It needs no `deploy.yaml`:

```bash
deployctl redeploy my-api --image ghcr.io/company/my-api:$GIT_SHA
```

The application must already have a successful deployment. Exit codes and `--no-wait` work as they do for `deploy`. See [Roll back and redeploy](/docs/tasks/roll-back).

## What's next

- [Roll back](/docs/tasks/roll-back) when a version that deployed successfully turns out to be wrong.
- The [deployctl reference](/docs/reference/deployctl).
