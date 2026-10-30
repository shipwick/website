---
title: Deploy from GitLab CI
description: Deploy from a .gitlab-ci.yml job with the shipwick CLI - install it, pass the agent's URL and a deploy token as masked variables, deploy the image the pipeline pushed to the GitLab registry, let the server pull from that registry, and gate production with a manual job.
---

# Deploy from GitLab CI

A GitLab job deploys with the same three lines any pipeline uses: install the `shipwick` CLI, set `SHIPWICK_AGENT_URL` and `SHIPWICK_AGENT_TOKEN`, run `shipwick deploy`. This page puts them in a `.gitlab-ci.yml`: the two variables as masked CI/CD variables, the image built in the pipeline and pushed to the GitLab container registry, a deploy token so that the server may pull from it, and `when: manual` as the gate in front of production. What `shipwick deploy` does, how it exits and what it prints when piped is the same everywhere and is under [Deploy from CI](/docs/tasks/deploy-from-ci); this page says what is GitLab's.

## Before you begin

- The agent's API is reachable from GitLab's runners, over HTTPS with a hostname (`SHIPWICK_AGENT_DOMAIN`); see [Install Shipwick on a server](/docs/getting-started/install).
- `deploy.yaml` is in the repository, with the image the pipeline will replace with `--image`, or `build: .` if the runner is to build it; see [Build on the runner instead](/docs/tasks/deploy-from-ci#build-on-the-runner-instead). The examples here build in the pipeline and push to the project's registry, which is what `$CI_REGISTRY_IMAGE` names.
- A token for the pipeline with the `deploy` role, limited to the application, from a machine where you are logged in as an admin:

```bash
shipwick token create gitlab --role deploy --app my-api --expires 90d
```

The value is shown once. Never the root token: it is equivalent to root SSH access to the server and cannot be revoked. See [Create tokens for CI and teammates](/docs/tasks/tokens).

## The two variables

In the project, under **Settings > CI/CD > Variables**, add `SHIPWICK_AGENT_URL` with the agent's URL and `SHIPWICK_AGENT_TOKEN` with the token. GitLab makes a variable available to a job as an environment variable of the same name, which is where `shipwick` looks; the job file names neither. For the token, set its visibility to **Masked**, so that its value is replaced with `[MASKED]` if it ever appears in a job log, or **Masked and hidden**, which also keeps it from being revealed in the settings page again, and select **Protect variable**, so that only pipelines on protected branches and tags get it. A masked value must be a single line of at least 8 characters; a Shipwick token is. Masking is not a guarantee: a job that prints its environment still leaks the token, so do not.

A runner has no `shipwick login` and no config file. The environment wins over any saved context, so `--context` has no place in the job; a job that deploys to a second server sets the two variables to that server's values, with an environment scope on each, as under [Staging and production](/docs/tasks/staging-and-production#gitlab-ci-a-manual-job).

## The job

```yaml
deploy:
  image: alpine:3.21
  before_script:
    - apk add --no-cache curl
    - curl -fsSL https://get.shipwick.com | sh -s -- --cli
  script:
    - shipwick deploy --image "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"
```

The installer downloads the CLI for the runner's architecture from the latest [release](https://github.com/shipwick/shipwick/releases), checks it against the release's checksums and puts it in `/usr/local/bin`. `SHIPWICK_VERSION=v1.0.0 sh -s -- --cli` pins a release, so that the pipeline does not change under you; without it, each run takes the latest. The agent on your server is upgraded separately, and a CLI newer than the agent says so when it needs something the agent does not have.

`--image` replaces the image of `deploy.yaml` for this deployment, in memory; the file on disk is untouched. `$CI_REGISTRY_IMAGE` is the project's address in the GitLab container registry, `registry.gitlab.com/company/my-api` for one, and `$CI_COMMIT_SHORT_SHA` the first eight characters of the commit; the tag becomes the deployment's version, so every entry in the application's history names the commit it came from. `shipwick deploy` runs from the directory that holds `deploy.yaml`, which is the checkout's root unless the job changes directory.

## What the job's log shows

The job's log is the CLI's output, plain, with no colors and no progress line, each command printed with `$` in front as GitLab prints it:

```text
$ apk add --no-cache curl
fetch https://dl-cdn.alpinelinux.org/alpine/v3.21/main/x86_64/APKINDEX.tar.gz
fetch https://dl-cdn.alpinelinux.org/alpine/v3.21/community/x86_64/APKINDEX.tar.gz
(1/9) Installing brotli-libs (1.1.1-r0)
…
(9/9) Installing curl (8.14.1-r3)
OK: 12 MiB in 24 packages
$ curl -fsSL https://get.shipwick.com | sh -s -- --cli
Shipwick installer (shipwick/shipwick@latest)

  The latest release is v1.0.0
  The release's signature was not checked: cosign is not installed. Every file is checked against the release's checksums.
✓ Installed the shipwick CLI to /usr/local/bin/shipwick

  Next:   shipwick login
$ shipwick deploy --image "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"
Deploying my-api...

✓ Validated deploy.yaml
✓ Pulled image 127.0.0.1:5000/company/my-api:7b684892
✓ Started 1 container
✓ Replica 1 passed health checks
✓ Routed https://my-api.localhost to 1 replica
✓ Deployment successful

my-api 7b684892  deployed in 2.0s
1/1 replicas healthy
https://my-api.localhost

Next:
  shipwick logs -f my-api    follow the logs
  shipwick status my-api     replicas, health, history
✓ https://my-api.localhost/ answers HTTP 200 through the proxy
```

These commands were run in an `alpine:3.21` container exactly as the job runs them, against a Shipwick server with a registry and a hostname of its own, which is why the log says `127.0.0.1:5000` and `my-api.localhost` where yours will say `registry.gitlab.com` and your domain; a GitLab runner adds nothing to them but the variables. The job passes when the deployment succeeded and fails when it did not, with why under `✗ Deployment failed` and the sentence that says whether the running version was affected; a `Next:` block is printed only on the application's first deployment.

## Build the image in the pipeline

GitLab's own way to build an image in a job is Docker-in-Docker: the job runs in a `docker` image and a `dind` service beside it is the daemon, which needs a runner configured with `privileged = true`. GitLab's documentation says to pin the version of both images and not to use `latest`, and to log in with the password on standard input; the registry's credentials for the job are the predefined `$CI_REGISTRY_USER` and `$CI_REGISTRY_PASSWORD`, which are valid only while the job runs:

```yaml
stages: [build, deploy]

variables:
  IMAGE: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA
  DOCKER_TLS_CERTDIR: "/certs"

build:
  stage: build
  image: docker:28-cli
  services: [docker:28-dind]
  script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login "$CI_REGISTRY" -u "$CI_REGISTRY_USER" --password-stdin
    - docker build -t "$IMAGE" .
    - docker push "$IMAGE"

deploy:
  stage: deploy
  image: alpine:3.21
  before_script:
    - apk add --no-cache curl
    - curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v1.0.0 sh -s -- --cli
  script:
    - shipwick deploy --image "$IMAGE"
```

The image is pushed once and pulled by the server; the `deploy` job carries no image and needs no Docker. If your runners may not run privileged containers, GitLab's documentation names Buildah and BuildKit as the ways to build without it, and says that kaniko, once the usual alternative, is no longer maintained. Whatever builds the image, the `deploy` job stays as it is. With the variables above, the two `docker` lines of the `build` job were run against the same server as the deploy job's, and the deploy job's log above is the result.

## Let the server pull from the GitLab registry

The project's registry is private, so the server needs a credential to pull from it, and `$CI_REGISTRY_PASSWORD` is not it: GitLab says that password is valid only as long as the job runs, and a replica recreated next week, or a rollback to an image the server pruned, pulls without a job. Create a [deploy token](https://docs.gitlab.com/user/project/deploy_tokens/) instead, under **Settings > Repository > Deploy tokens**, with the `read_registry` scope and nothing else; GitLab shows its username and its value once. Then, from a machine where you are logged in as an admin, give the agent the pair:

```bash
shipwick registry login registry.gitlab.com --username gitlab+deploy-token-3
```

```text
✓ Logged in to registry.gitlab.com as gitlab+deploy-token-3
  The server pulls images from registry.gitlab.com with this credential from now on.
```

The token is asked for without echo, or piped in; it is never an argument. The agent checks it against the registry before it stores it, keeps it encrypted, and sends it with every pull from `registry.gitlab.com`: deployments, rollbacks, jobs, a replica whose image was removed. This is done once, not in the pipeline: storing a registry credential needs the `admin` role, which the pipeline's token must not have. A deploy token does not expire unless you give it a date; if you do, `shipwick registry login` again before it. See [Pull from private registries](/docs/tasks/private-registries).

## Deploy one application of a shipwick.yaml

With a `shipwick.yaml` that describes several applications, the job names the one the image is for:

```yaml
script:
  - shipwick deploy my-api --image "$IMAGE"
```

It deploys `my-api` and nothing else of the file; what `my-api` has `after` is assumed to be running, and the output says so. `shipwick validate my-api` shows the same offline, and is a reasonable first job to add:

```text
✓ shipwick.yaml is valid (1 variable left to the server)

shipwick deploy my-api leaves out postgres and assumes it running.

Name           my-api
Image          registry.gitlab.com/company/my-api:1.4.2
Version        1.4.2
Replicas       1
Port           8080
Domain         api.example.com
Health check   GET /health every 10s (timeout 3s, 3 retries)
Resources      unlimited CPU, unlimited memory
Restart        always
Environment    1 variables
```

See [Deploy several applications](/docs/tasks/deploy-from-ci#deploy-several-applications).

## The gate in front of production

Shipwick has no approval step of its own: the pipeline decides when `shipwick deploy` may run. In GitLab that is a manual job. With `when: manual` inside `rules`, the job waits for someone to press **Run**, and `allow_failure` is `false` by default there, so the pipeline is **blocked** at that stage instead of passing without it:

```yaml
deploy:
  stage: deploy
  image: alpine:3.21
  before_script:
    - apk add --no-cache curl
    - curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v1.0.0 sh -s -- --cli
  script:
    - shipwick deploy --image "$IMAGE"
  environment:
    name: production
    url: https://api.example.com
  resource_group: production
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
```

Three GitLab keywords do three things. `environment` records every run of the job under **Operate > Environments**, as a deployment of `production`, with a button to the URL. Protecting that environment under **Settings > CI/CD > Protected environments**, in GitLab Premium and Ultimate, limits who may deploy to it to the roles, users or groups you name, and only they can run the job; that is the approval, and the environment's deployment history records who gave it. `resource_group` makes the job mutually exclusive across pipelines of the project: two runs of `deploy` never overlap, which matters because the agent refuses a second deployment of an application while one is in progress rather than queueing it. With two servers, staging deploys automatically and production is the manual job, each with its own variables; the whole file is under [Staging and production](/docs/tasks/staging-and-production#gitlab-ci-a-manual-job).

## Secrets

A value that must not be in the repository is `${NAME}` in `deploy.yaml`, and the simplest place to fill it in is the server, once, with `shipwick secret set DATABASE_PASSWORD --app my-api`; nothing in GitLab holds it then. Or GitLab holds it: a CI/CD variable named like the placeholder, `DATABASE_PASSWORD`, is an environment variable of the job, and `shipwick deploy` fills `${DATABASE_PASSWORD}` in from it before the file is sent. A variable of type **File** is a path, which `--env-file` takes:

```yaml
script:
  - shipwick deploy --image "$IMAGE" --env-file "$PRODUCTION_ENV"
```

Only `env` values may be left to the server; a `${NAME}` anywhere else, in `domain` or in `image`, must be set in the job. The rules are under [Supply secrets with ${NAME}](/docs/tasks/deploy-from-ci#supply-secrets-with).

## What's next

- [Deploy from CI](/docs/tasks/deploy-from-ci): what `shipwick deploy` does in any pipeline, its exit codes, `--no-wait`, migrations with `pre_deploy`.
- [Staging and production](/docs/tasks/staging-and-production): two servers, one file, and the manual job between them.
- [Pull from private registries](/docs/tasks/private-registries): what the agent does with the deploy token, and when a pull is refused.
- [Create tokens for CI and teammates](/docs/tasks/tokens): limits, ends, revocation.
- [Deploy from Azure Pipelines](/docs/tasks/deploy-from-azure-pipelines): the same three lines in an `azure-pipelines.yml`.
