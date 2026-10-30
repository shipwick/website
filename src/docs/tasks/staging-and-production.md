---
title: Staging and production
description: Run two Shipwick servers as two contexts, deploy one deploy.yaml to both, promote the image staging runs to production with shipwick deploy --image, put the approval in the pipeline with a protected GitHub environment or a manual GitLab job, and keep tokens, secrets and keys apart.
---

# Staging and production

Two servers are two contexts of the CLI, and the same `deploy.yaml` is deployed to both. Promoting a version is deploying the image that staging runs to production: `shipwick --context production deploy --image <the one staging runs>`. Shipwick has no approval step of its own, by design; a second person's approval belongs to the pipeline that calls `shipwick deploy`, where the code review already happened, and this page shows where it goes in GitHub Actions and GitLab CI. It ends with what the two servers must not share.

## Before you begin

- Two servers, each installed as in [Install on a server](/docs/getting-started/install), each with an API hostname so that your machine and the pipeline reach it.
- Images in a registry both servers can pull from, tagged with something that identifies the build, the commit SHA for one. An image built by `shipwick deploy` from `build: .` exists on the server that received it and nowhere else, so production could not pull what staging runs; promotion needs a registry. The pipeline builds and pushes once, and both servers pull.
- One token per server for the pipeline, with the `deploy` role; see [Create tokens for CI and teammates](/docs/tasks/tokens).

## Two servers are two contexts

`shipwick login` saves a server under a name:

```bash
shipwick login --context staging --url https://agent.staging.example.com
shipwick login --context production --url https://agent.example.com
shipwick context ls
```

```text
  NAME        URL
* production  https://agent.example.com
  staging     https://agent.staging.example.com
```

Commands talk to the current context, marked with `*`, the one logged in to last; `--context <name>` picks another for one command, `SHIPWICK_CONTEXT` for a shell, and `shipwick context use` changes the current one. Each context has its own token, saved with mode `0600`, and a token saved for one server is never sent to another. On a single server nothing changes: it is the context `default`.

The pipeline uses no contexts. A runner has no configuration file; it sets `SHIPWICK_AGENT_URL` and `SHIPWICK_AGENT_TOKEN` per job, and the environment wins over any saved context. See [How the agent is found](/docs/reference/cli#how-the-agent-is-found).

## One file, two servers

Keep one `deploy.yaml` in the repository. What differs between the two servers is the hostname and the secrets, and neither has to be in the file:

```yaml
name: my-api
image: ghcr.io/company/my-api:1.4.2
port: 8080
domain: ${API_DOMAIN}
env:
  DATABASE_URL: postgres://app:${DATABASE_PASSWORD}@postgres:5432/app
health:
  path: /health
```

`shipwick` fills in every `${NAME}` it has a value for before the file is sent, from its environment or an `--env-file`, in any value of the file. The hostname comes from a file per server, checked into the repository since it is not a secret:

```bash
shipwick --context staging deploy --env-file staging.env         # API_DOMAIN=api.staging.example.com
shipwick --context production deploy --env-file production.env   # API_DOMAIN=api.example.com
```

```text
✓ Validated deploy.yaml (1 variable substituted, 1 left to the server)
```

The password is left to the server, each server filling in its own, stored once with `shipwick secret set`; see [Secrets per server](#secrets-per-server). A `${NAME}` outside `env` that is set nowhere is an error before anything is sent, so a `deploy` without the file does not reach the agent: `deploy.yaml: refers to ${API_DOMAIN}, which is not set`. The rules are under [Placeholders](/docs/reference/cli#placeholders).

## Read what staging runs

The tag of the active deployment's image is the `VERSION` column of `shipwick ps`; `shipwick status` has the whole reference:

```bash
shipwick --context staging status my-api
```

```text
my-api  ● HEALTHY

Version    1.4.2  (deployment #12, 2h ago)
Image      ghcr.io/company/my-api:1.4.2
URL        https://api.staging.example.com
Replicas   2/2 healthy
```

The `Image` line is what to deploy to production. A script reads the same from the API, as `active_deployment.image` of [`GET /applications/:name`](/docs/reference/api#get-applications-name):

```bash
curl -fsS -H "Authorization: Bearer $STAGING_TOKEN" \
  https://agent.staging.example.com/api/v1/applications/my-api \
  | jq -r .data.active_deployment.image
```

```text
ghcr.io/company/my-api:1.4.2
```

A tag is the deployment's version in every list and history, so tag images with something that does not move: `1.4.2`, or the commit SHA. A `latest` that is pushed again names a different image a week later, and "deploy what staging runs" would then deploy something staging never ran.

## Promote

```bash
shipwick --context production deploy --image ghcr.io/company/my-api:1.4.2 --env-file production.env
```

`--image` replaces the image of `deploy.yaml` for this deployment, in memory; the file is untouched, and the agent receives one plain document. The deployment is an ordinary one: validated by production's agent, rolled out replica by replica, the previous version restored if it fails, and `deploy` exits non-zero then. Production's agent fills in production's secrets. Without a checkout of the repository, `redeploy` does the same from the configuration production already runs:

```bash
shipwick --context production redeploy my-api --image ghcr.io/company/my-api:1.4.2
```

It needs no `deploy.yaml`, and takes the configuration of the active deployment, hostname and `env` included, with only the image changed; see [Deploy the running configuration again](/docs/tasks/roll-back#deploy-the-running-configuration-again). With a `shipwick.yaml`, name the application the image is for: `shipwick --context production deploy api --image …` deploys `api` and nothing else of the file.

## The approval belongs to the pipeline

Shipwick records who deployed and when, and refuses what a token's role does not cover; it does not hold a deployment for a second person to approve. That is the pipeline's job, in both systems a property of the *environment* a job deploys to. The job that deploys to production runs the same `shipwick deploy --image` with production's URL and token, and the pipeline decides when it may run.

### GitHub Actions: a protected environment

In the repository's settings, under *Environments*, create `staging` and `production`. Give each its own secrets, `SHIPWICK_URL` and `SHIPWICK_TOKEN`, and on `production` turn on *Required reviewers* and name who may approve. A job with `environment: production` then waits for one of them before its steps run, and the approval is recorded with the run.

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      image: ghcr.io/${{ github.repository }}:${{ github.sha }}
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

  staging:
    needs: build
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - uses: shipwick/deploy@v1
        with:
          url: ${{ secrets.SHIPWICK_URL }}
          token: ${{ secrets.SHIPWICK_TOKEN }}
          image: ${{ needs.build.outputs.image }}
          env-file: staging.env

  production:
    needs: staging
    runs-on: ubuntu-latest
    environment: production        # waits for a required reviewer
    steps:
      - uses: actions/checkout@v4
      - uses: shipwick/deploy@v1
        with:
          url: ${{ secrets.SHIPWICK_URL }}
          token: ${{ secrets.SHIPWICK_TOKEN }}
          image: ${{ needs.build.outputs.image }}
          env-file: production.env
```

Three things make this a promotion rather than two deployments. The image is built once, in `build`, and both jobs deploy the reference it produced. `production` has `needs: staging`, so it is offered for approval only after staging deployed successfully: `shipwick deploy` exits non-zero when a deployment fails, and the action with it. And `secrets.SHIPWICK_URL` and `secrets.SHIPWICK_TOKEN` resolve to the environment's own values, so the same two lines reach a different server in each job. The action's inputs are under [Deploy from CI](/docs/tasks/deploy-from-ci#inputs).

### GitLab CI: a manual job

In `.gitlab-ci.yml`, the production job is `when: manual`: the pipeline stops in front of it, and someone presses *Run*. Protect the `production` environment in the project's settings so that only the people you name may deploy to it, and GitLab records who did. The deploy step is the CLI, as on any runner without the GitHub action:

```yaml
stages: [build, staging, production]

variables:
  IMAGE: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA

build:
  stage: build
  image: docker:27
  services: [docker:27-dind]
  script:
    - docker login -u "$CI_REGISTRY_USER" -p "$CI_REGISTRY_PASSWORD" "$CI_REGISTRY"
    - docker build -t "$IMAGE" .
    - docker push "$IMAGE"

.deploy:
  image: alpine:3.21
  before_script:
    - apk add --no-cache curl
    - curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v1.1.0 sh -s -- --cli
  script:
    - shipwick deploy --image "$IMAGE" --env-file "$ENV_FILE"

staging:
  extends: .deploy
  stage: staging
  environment: { name: staging }
  variables: { ENV_FILE: staging.env }

production:
  extends: .deploy
  stage: production
  environment: { name: production }
  variables: { ENV_FILE: production.env }
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual                    # someone presses Run
      allow_failure: false            # the pipeline waits instead of passing without it
```

`SHIPWICK_AGENT_URL` and `SHIPWICK_AGENT_TOKEN` are CI/CD variables of the project, each defined twice with an *Environment scope*, `staging` and `production`, so that each job gets its server's values without a line in the file. Mark the tokens *Masked* and *Protected*. The `shipwick` step itself is the one under [A generic pipeline step](/docs/tasks/deploy-from-ci#a-generic-pipeline-step); what is around it is GitLab's, and GitLab's documentation is where its details are.

## Secrets per server

Each server has its own secrets, stored with `shipwick secret set` against its context, encrypted with its own key, filled in by its own agent when it records a deployment:

```bash
openssl rand -hex 24 | shipwick --context staging secret set DATABASE_PASSWORD --app my-api
openssl rand -hex 24 | shipwick --context production secret set DATABASE_PASSWORD --app my-api
```

The same `${DATABASE_PASSWORD}` in the file resolves to a different value on each server, and nothing in the pipeline or the repository holds either. A value that must come from the pipeline instead goes into the environment's secrets and from there into the job's environment under the placeholder's name, or into an `--env-file` the job writes; see [Supply secrets with ${NAME}](/docs/tasks/deploy-from-ci#supply-secrets-with).

## What the two servers must not share

- **Tokens.** One per server, with the `deploy` role, limited to the applications the pipeline deploys and given an end: `shipwick --context production token create ci --role deploy --app my-api --expires 90d`. A token belongs to the agent that created it and works nowhere else; a leaked staging token then costs nothing of production. Never the root token, on either.
- **The encryption key.** Each agent generates its own on its first start, and there is no reason to copy one to the other: the key protects a copy of that server's database, and two servers with one key are one leak away from both. The same holds for `SHIPWICK_ENCRYPTION_KEY` when the key is kept in the environment; see [Keep the encryption key off the server's disk](/docs/tasks/key-off-the-disk).
- **The backup passphrase and the bucket.** A passphrase per server. One bucket may hold both servers' backups, each under a prefix of its own (`SHIPWICK_BACKUP_S3_PREFIX`); an installation that finds another's backups where it would write refuses to write there, and `shipwick doctor` says why. See [Keep a copy off the server](/docs/tasks/backups#keep-a-copy-off-the-server).
- **The database.** Staging runs a `postgres` of its own, from the same `shipwick.yaml`; the applications on one server reach only the applications on that server.

What they may share: the repository, the `deploy.yaml`, the registry and the images in it, and one dashboard, which shows several servers side by side when `SHIPWICK_AGENTS` names them; see [`SHIPWICK_AGENTS`](/docs/reference/agent-configuration#shipwick-agents).

## What's next

- [Deploy from CI](/docs/tasks/deploy-from-ci): the action's inputs and outputs, exit codes, `--no-wait`, and what the CLI does when piped.
- [Scan an image before it is deployed](/docs/tasks/scan-images): the other step that belongs in the pipeline before `shipwick deploy`.
- [Roll back and redeploy](/docs/tasks/roll-back) when the promoted version turns out to be wrong.
- [Create tokens for CI and teammates](/docs/tasks/tokens): limits, ends, and what each token did.
