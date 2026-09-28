---
title: Deploy from CI
description: Deploy from a pipeline with the shipwick/deploy GitHub Action or the shipwick CLI, pass the image you just built, keep secrets on the server, and use the exit code as a gate.
---

# Deploy from CI

This page shows how to deploy from a pipeline: create a token for it, keep `deploy.yaml` in the repository, pass the image the pipeline built, supply secrets, run migrations before the new version starts, and let the outcome of the deployment decide whether the job passes. On GitHub, the `shipwick/deploy` action does it in one step; anywhere else, the CLI does the same in two lines.

## Before you begin

- The agent's API must be reachable from the CI runner. The usual way is to serve it over HTTPS by giving the agent a hostname (`SHIPWICK_AGENT_DOMAIN`), as described in [Install Shipwick on a server](/docs/getting-started/install).
- The image comes from a registry the server can pull from, which the pipeline pushed to; for private registries, see [Pull from private registries](/docs/tasks/private-registries). A registry stays the right tool for CI. Building on the runner instead also works: with `build: .` in `deploy.yaml`, `shipwick deploy` runs `docker build` on the runner and sends the image to the server, which needs Docker on the runner and nothing else.
- Store the agent URL and a token as secrets in your CI system. Give the pipeline a token of its own, with the `deploy` role, as described next.

## Create a token for the pipeline

Do not put the root token in CI. It has the `admin` role, which is equivalent to root SSH access to the server, and it cannot be revoked short of changing it on the agent. A pipeline needs less: the `deploy` role deploys, redeploys, rolls back, stops and starts, and cannot delete applications, manage tokens or secrets, or touch backups. From a machine where you are logged in with an admin token:

```bash
shipwick token create ci --role deploy
```

```text
✓ Created token ci with the deploy role

    swk_Xk3nM9…

Store it now: it will not be shown again.
In CI, set SHIPWICK_AGENT_TOKEN to it. On a machine you work from, save it with: shipwick login
```

The agent keeps only the SHA-256 of the token. `shipwick token ls` shows when the token was last used, and `shipwick token revoke ci` ends it the moment a runner or a secret store is compromised; deployments the pipeline made stay in the history, marked with the token's name. See [Create tokens for CI and teammates](/docs/tasks/tokens).

## GitHub Actions: the shipwick/deploy action

[`shipwick/deploy`](https://github.com/shipwick/deploy) downloads the `shipwick` CLI, verifies it against the release's checksums and runs `shipwick deploy` against your server:

```yaml
- uses: shipwick/deploy@v1
  with:
    url: https://agent.example.com
    token: ${{ secrets.SHIPWICK_TOKEN }}
    image: ghcr.io/company/my-api:${{ github.sha }}
```

Keep `deploy.yaml` in the repository and pass the image the workflow just built. The step fails when the deployment fails, and the version that worked keeps serving; nothing else in the workflow is needed for that.

A complete workflow, building the image on GitHub and deploying it:

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
      - uses: shipwick/deploy@v1
        with:
          url: https://agent.example.com
          token: ${{ secrets.SHIPWICK_TOKEN }}
          image: ghcr.io/${{ github.repository }}:${{ github.sha }}
```

### Inputs

| Input | | Default |
|---|---|---|
| `url` | The URL of your Shipwick agent | required |
| `token` | An API token with the `deploy` role, from a secret | required |
| `image` | Deploy this image instead of the one in `deploy.yaml` (`--image`) | |
| `file` | The `deploy.yaml` to deploy. One path per line deploys several applications in order, stopping at the first failure (`-f`, repeated); `--image` then does not apply | `deploy.yaml` |
| `env-file` | A `NAME=value` file that fills in `${NAME}` placeholders before the file is sent (`--env-file`). One path per line. Not needed for values stored on the server with `shipwick secret set` | |
| `version` | The release of the CLI to use, such as `v0.4.1` | the latest release |
| `no-wait` | Start the deployment and return at once (`--no-wait`) | `false` |
| `check-only` | For testing the action: download and verify the CLI, print its version, stop | `false` |

Several applications, with a secret filled in from the workflow:

```yaml
- run: echo "POSTGRES_PASSWORD=${{ secrets.POSTGRES_PASSWORD }}" > .env.production
- uses: shipwick/deploy@v1
  with:
    url: https://agent.example.com
    token: ${{ secrets.SHIPWICK_TOKEN }}
    file: |
      postgres/deploy.yaml
      api/deploy.yaml
    env-file: .env.production
```

A `shipwick.yaml` that describes several applications is given as the one `file`, and deploys them in dependency order; see [Several applications](/docs/reference/deploy-yaml#several-applications-shipwick-yaml).

### Outputs

| Output | |
|---|---|
| `version` | The version that was deployed, as the CLI reports it (`my-api 1.4.2  deployed in 6.1s`) |
| `url` | The `https://` URL the application is served at |

Both are empty when the application has no domain (`url`), with `no-wait`, or when the deployment failed. With several applications they describe the last one.

```yaml
- uses: shipwick/deploy@v1
  id: deploy
  with: { url: https://agent.example.com, token: "${{ secrets.SHIPWICK_TOKEN }}" }
- run: echo "Deployed ${{ steps.deploy.outputs.version }} at ${{ steps.deploy.outputs.url }}"
```

The CLI stays on the job's `PATH` after the step, so `shipwick status`, `shipwick logs` and the rest work in the steps that follow, given the same two variables:

```yaml
- run: shipwick status my-api
  env:
    SHIPWICK_AGENT_URL: https://agent.example.com
    SHIPWICK_AGENT_TOKEN: ${{ secrets.SHIPWICK_TOKEN }}
```

### The token, versions and verification

The token reaches the CLI as the `SHIPWICK_AGENT_TOKEN` environment variable, never as an argument, and is masked in the job log. Keep the agent's URL on HTTPS: the CLI warns when a token is about to travel over plain HTTP.

`version:` pins the CLI to a release tag; without it, each run downloads the latest release. Pin it when a reproducible pipeline matters more than fixes arriving on their own. The agent on your server is upgraded separately, by running the installer there again; a CLI newer than the agent tells you so when it needs something the agent does not have. Pin the action itself as you pin any other: `shipwick/deploy@v1` follows the latest `v1.x`, a full tag or a commit SHA stays put.

Everything the action downloads comes from the assets of a [shipwick/shipwick release](https://github.com/shipwick/shipwick/releases): the binary for the runner's operating system and architecture, and the release's `checksums.txt`. The binary is installed only if its SHA-256 matches the checksums file, the same check the installer and `shipwick upgrade` make. Both are fetched over HTTPS from `github.com`; the GitHub API is not used, so the action is not subject to its rate limits. Runners: `ubuntu-*` (x64 and arm64) and `macos-*`. Windows runners are not supported; the step fails and says so.

Problems with the CLI or the agent belong in [shipwick/shipwick](https://github.com/shipwick/shipwick/issues); problems with the action, in [its own repository](https://github.com/shipwick/deploy/issues).

## Any other CI: the CLI

A CI job needs no `shipwick login`. Set two environment variables:

| Variable | |
|---|---|
| `SHIPWICK_AGENT_URL` | The agent's URL, for example `https://agent.example.com` |
| `SHIPWICK_AGENT_TOKEN` | The token created above |

The environment wins over any saved context, so `--context` and `SHIPWICK_CONTEXT` have no place in a pipeline: a runner has no config file, and a job that deploys to a second server sets the two variables to that server's values instead.

`shipwick` never accepts the token as a flag, because arguments show up in `ps` and in logs. If the URL is plain HTTP and not the local machine, `shipwick` prints a warning on standard error before it sends the token.

If the token's role does not cover a command, the agent refuses it and the job fails:

```text
This token may not do that: it has the read role.

Use a token with the deploy role, or create one with: shipwick token create <name> --role deploy
```

### A generic pipeline step

```bash
#!/bin/sh
set -eu

# Install shipwick. Pin the version so the pipeline does not change under you.
curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v0.4.1 sh -s -- --cli

# SHIPWICK_AGENT_URL and SHIPWICK_AGENT_TOKEN (a deploy token) come from the
# CI system's secret store, as environment variables.

# Run from the directory that holds deploy.yaml.
shipwick deploy --image "ghcr.io/company/my-api:$GIT_SHA"
```

The installer puts `shipwick` in `/usr/local/bin` and uses `sudo` if that directory is not writable. To install elsewhere, set `SHIPWICK_BIN_DIR` to a directory on the `PATH`.

## Deploy the image you just built

`--image` overrides the image in `deploy.yaml` for this deployment:

```bash
shipwick deploy --image ghcr.io/company/my-api:$GIT_SHA
```

The override is applied to the YAML document in memory. The agent still receives one plain `deploy.yaml`, and the file on disk is untouched. The image's tag becomes the deployment's version, so tagging images with the commit SHA makes every entry in the history traceable to a commit. `--image` does not apply to an application with `build:`; such a `deploy.yaml` builds on the runner instead.

## Supply secrets with ${NAME}

A value that must not be in the repository, such as a database password, is written as `${NAME}` in `deploy.yaml`:

```yaml
env:
  DATABASE_URL: postgres://app:${DATABASE_PASSWORD}@postgres:5432/app
```

Two places can fill it in. The simplest is the server: store the value there once, from a machine where you are logged in as an admin, and every deploy from every pipeline and laptop gets it, with nothing in the CI secret store but the token:

```bash
shipwick secret set DATABASE_PASSWORD     # asked without echo; or pipe it in
```

The agent fills in `${DATABASE_PASSWORD}` in `env` values when it records the deployment. Or the pipeline fills it in: expose the secret as an environment variable named like the placeholder, `DATABASE_PASSWORD` here, the same way the token is exposed, or write a `NAME=value` file and pass it with `--env-file`:

```bash
shipwick deploy --image "ghcr.io/company/my-api:$GIT_SHA" --env-file .env.production
```

`shipwick` fills in what it can before the file is sent and leaves the rest of the `env` values to the agent. A variable set in the environment wins over the same name in an `--env-file`. A name that is set neither in the pipeline nor on the server fails the job before anything is recorded, with the command to run: `refers to ${DATABASE_PASSWORD}, which is not set where shipwick runs and not stored on the server`. The value is never printed; the output says only `(1 variable substituted)`. Only `env` values are filled in by the server; a `${TAG}` in `image` must be set where `shipwick` runs. The rules are in the [CLI reference](/docs/reference/cli#placeholders).

## Run migrations before the new version starts

A pipeline that runs database migrations as a separate step needs a connection to the database from the runner, which the server does not offer, and has to get the order right by itself. `pre_deploy` puts the migration inside the deployment instead:

```yaml
pre_deploy:
  command: ["dotnet", "Migrate.dll"]
  timeout: 10m
```

The command runs on the server, from the new image, with the application's environment and limits and on its network — it reaches `postgres:5432` like a replica does — once the image is pulled and before any replica of the new version exists. `shipwick deploy` shows it as two steps:

```text
✓ Pulled image ghcr.io/company/my-api:1.4.2
✓ Running pre-deploy command
✓ Pre-deploy command finished (12s)
✓ Started 1 container
```

If the command exits non-zero or outlives its timeout, the deployment fails before anything was started, the job fails with it, and the last lines of the command's output are under the error:

```text
✗ Deployment failed

  pre-deploy command exited 1

  Last output of the pre-deploy command:
  Npgsql.PostgresException: 42P07: relation "orders" already exists

my-api is still running 1.4.1; the failed deployment did not affect it.
```

The command runs next to the version that is still serving, so a migration must be compatible with the old code: add a column, do not drop one. That is the same backward compatibility a rolling update asks of migrations anyway. See [Run scheduled jobs and one-off commands](/docs/tasks/jobs).

## Deploy several applications

A `shipwick.yaml` describes several applications in one file, with `after` naming the ones each must wait for; `shipwick deploy` uses it when there is no `deploy.yaml`, deploys up to four applications at once in dependency order, prefixes every line of output with the application's name, skips what depends on a failed application, and exits non-zero if any failed or was skipped:

```bash
shipwick deploy                    # shipwick.yaml
shipwick deploy --parallel 2
```

`--image` does not apply to a `shipwick.yaml`: pin each image in the file. See [Several applications](/docs/reference/deploy-yaml#several-applications-shipwick-yaml).

Several `deploy.yaml` files given with `-f` deploy in the order given, one after the other, and stop at the first failure:

```bash
shipwick deploy -f api/deploy.yaml -f worker/deploy.yaml
```

Every file is validated before the first deployment starts. If one fails, the command prints `Stopped at worker: 1 of 2 applications deployed.` and exits with `1`; the applications already deployed stay deployed. On success the last line is `2 of 2 applications deployed.` `--image` applies to one application and is refused with several files; run one `deploy --image` per application instead:

```bash
shipwick deploy -f api/deploy.yaml --image "ghcr.io/company/api:$GIT_SHA"
shipwick deploy -f worker/deploy.yaml --image "ghcr.io/company/worker:$GIT_SHA"
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Anything else — including a deployment that the agent accepted but that then failed, and a `shipwick.yaml` of which an application failed or was skipped |

This makes `shipwick deploy`, and the action, safe to use as a pipeline gate. When a deployment fails, the output says why, includes the last log lines of the replica that failed, and says whether the running version was affected:

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
- **One deployment per application at a time.** A second one is refused, not queued, and `shipwick` exits 1 with `Another operation is already in progress for this application.` If two pipeline runs can overlap, serialize the deploy job.
- **Cancelling the job does not cancel the deployment.** Interrupting `shipwick deploy` stops the waiting; the deployment continues on the server.
- **Short agent outages are tolerated.** While waiting, `shipwick` rides out connection failures for a limited number of polls before it gives up.
- **Wrong tokens are slowed down.** After 20 failed authentications within a minute from one address, the agent answers wrong tokens from it with `429` for a minute. A valid token is never refused, so a correct secret is not affected.

## Return immediately with --no-wait

```bash
shipwick deploy --image ghcr.io/company/my-api:$GIT_SHA --no-wait
```

```text
✓ Deployment #8 started

Follow it with: shipwick status my-api
```

With `--no-wait`, the command returns as soon as the agent has accepted the deployment and exits 0. It says nothing about whether the deployment succeeds, so it is not a gate. Check the outcome later with `shipwick status`.

## Deploy without deploy.yaml

`redeploy` deploys the configuration the agent stored with the active deployment, `env` values included, and optionally changes the image. It needs no `deploy.yaml`:

```bash
shipwick redeploy my-api --image ghcr.io/company/my-api:$GIT_SHA
```

The application must already have a successful deployment. Exit codes and `--no-wait` work as they do for `deploy`. See [Roll back and redeploy](/docs/tasks/roll-back).

## Be told how it went

The pipeline's log is one place to look. With `SHIPWICK_WEBHOOK_URL` set on the agent, every deployment's outcome — succeeded, failed, rolled back — is also posted to a Slack or Discord channel or to an endpoint of yours, whoever started it. See [Get notified](/docs/tasks/notifications).

## What's next

- [Create tokens for CI and teammates](/docs/tasks/tokens): roles, revocation, what each token did.
- [Roll back](/docs/tasks/roll-back) when a version that deployed successfully turns out to be wrong.
- The [shipwick reference](/docs/reference/cli).
