---
title: Deploy from Azure Pipelines
description: Deploy from an azure-pipelines.yml with the shipwick CLI - a script step, the agent's URL and a deploy token as secret variables mapped into the step's environment, the image built and pushed with the Docker task, a credential for the server to pull from ACR or Docker Hub, and an environment with an approval as the production gate.
---

# Deploy from Azure Pipelines

An Azure Pipelines job deploys with the same three lines any pipeline uses: install the `shipwick` CLI, set `SHIPWICK_AGENT_URL` and `SHIPWICK_AGENT_TOKEN`, run `shipwick deploy`. This page puts them in an `azure-pipelines.yml`: the two values as secret variables, which Azure does not hand to a script unless the step maps them, the image built and pushed with the `Docker@2` task, a credential so that the server may pull from Azure Container Registry or Docker Hub, and an environment with an approval as the gate in front of production. What `shipwick deploy` does, how it exits and what it prints when piped is the same everywhere and is under [Deploy from CI](/docs/tasks/deploy-from-ci); this page says what is Azure's.

## Before you begin

- The agent's API is reachable from Microsoft's hosted agents, over HTTPS with a hostname (`SHIPWICK_AGENT_DOMAIN`); see [Install Shipwick on a server](/docs/getting-started/install).
- `deploy.yaml` is in the repository, with the image the pipeline will replace with `--image`. Hosted agents have Docker, so `build: .` and building on the agent works too; see [Build on the runner instead](/docs/tasks/deploy-from-ci#build-on-the-runner-instead). The examples here build in the pipeline and push to a registry.
- A token for the pipeline with the `deploy` role, limited to the application, from a machine where you are logged in as an admin:

```bash
shipwick token create azure --role deploy --app my-api --expires 90d
```

The value is shown once. Never the root token: it is equivalent to root SSH access to the server and cannot be revoked. See [Create tokens for CI and teammates](/docs/tasks/tokens).

## The two variables, as secrets

Put `SHIPWICK_AGENT_URL` and `SHIPWICK_AGENT_TOKEN` in a variable group, under **Pipelines > Library > + Variable group**, and select the lock icon on the token to store it encrypted; or in the pipeline itself, under **Edit > Variables**, with **Keep this value secret**. A variable group is referenced from the YAML by name, and the pipeline must be authorized to use it. A group can also take its secrets from an Azure Key Vault instead of holding them.

Azure's documentation is explicit about what a secret is not: "Unlike a normal variable, they are not automatically decrypted into environment variables for scripts. You need to explicitly map secret variables." A plain variable becomes an environment variable of the step on its own, uppercased, dots turned into underscores; a secret does not. So the step maps the token with `env:`, under the name `shipwick` reads:

```yaml
env:
  SHIPWICK_AGENT_TOKEN: $(SHIPWICK_AGENT_TOKEN)
```

In the log the value is `***`. Azure masks the whole secret, never a part of it, and says not to echo secrets and not to pass them as command-line arguments; `shipwick` takes the token from the environment and never as a flag, so the step does neither.

## The step

```yaml
trigger:
  branches:
    include: [main]

pool:
  vmImage: ubuntu-latest

variables:
  - group: shipwick-production      # SHIPWICK_AGENT_URL, and SHIPWICK_AGENT_TOKEN as a secret

steps:
  - checkout: self
  - script: |
      curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v1.1.0 sh -s -- --cli
      shipwick deploy --image "$IMAGE"
    displayName: Deploy with Shipwick
    env:
      SHIPWICK_AGENT_URL: $(SHIPWICK_AGENT_URL)
      SHIPWICK_AGENT_TOKEN: $(SHIPWICK_AGENT_TOKEN)
      IMAGE: myregistry.azurecr.io/my-api:$(Build.SourceVersion)
```

A `script` step runs in Bash on a Linux agent, from `$(Build.SourcesDirectory)`, which is the checkout and holds `deploy.yaml`; it fails when a command exits non-zero, and `shipwick deploy` exits `1` when the deployment failed, so the step is the gate. `ubuntu-latest` is Ubuntu 24.04, a fresh virtual machine for every job, with `curl` and Docker in its image, so there is nothing to install but the CLI.

The installer downloads the CLI for the agent's architecture from the [release](https://github.com/shipwick/shipwick/releases) named in `SHIPWICK_VERSION`, checks it against the release's checksums and puts it in `/usr/local/bin`, with `sudo` where it needs it; a hosted Linux agent has passwordless sudo. Without `SHIPWICK_VERSION` each run takes the latest release. `$(Build.SourceVersion)` is the commit, and the tag becomes the deployment's version, so every entry in the application's history names the commit it came from; `$(Build.BuildId)`, the `Docker@2` task's default tag, works the same way and is shorter.

## What the step's log shows

```text
$ curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v1.1.0 sh -s -- --cli
Shipwick installer (shipwick/shipwick@v1.1.0)

  The release's signature was not checked: cosign is not installed. Every file is checked against the release's checksums.
✓ Installed the shipwick CLI to /usr/local/bin/shipwick

  Next:   shipwick login
$ shipwick deploy --image "$IMAGE"
Deploying my-api...

✓ Validated deploy.yaml
✓ Pulled image 127.0.0.1:5000/company/my-api:7b6848926185d6919c5089ca93698f3ab10034b8
✓ Started 1 container
✓ Replica 1 passed health checks
✓ Replica 1/1 is serving 7b6848926185d6919c5089ca93698f3ab10034b8; its 7b684892 predecessor is retired
✓ Routed https://my-api.localhost to 1 replica
✓ Deployment successful

my-api 7b6848926185d6919c5089ca93698f3ab10034b8  deployed in 3.5s
1/1 replicas healthy
https://my-api.localhost
✓ https://my-api.localhost/ answers HTTP 200 through the proxy
```

These two commands were run with Bash in an Ubuntu 24.04 container with `curl`, exactly as the step runs them, against a Shipwick server that already ran the application, with a registry and a hostname of the lab's own, which is why the log says `127.0.0.1:5000` and `my-api.localhost` where yours will say your registry and your domain; an Azure agent adds nothing to them but the variables. The output is plain because it is not a terminal: no colors, no progress line, and the `$` lines are the commands as the shell ran them.

## Build and push with the Docker task

`Docker@2` builds and pushes in one step, logged in through a **Docker Registry** service connection; `buildAndPush` is its default command. The connection is made among the project's service connections and is one of three kinds: **Azure Container Registry**, chosen from your subscription and authenticated with a service principal, a managed identity or workload identity federation; **Docker Hub**, with a Docker ID and, as the documentation notes, a personal access token rather than the password; or **Others**, for any registry, with its URL, a username and a password.

```yaml
stages:
  - stage: Build
    jobs:
      - job: Image
        pool:
          vmImage: ubuntu-latest
        steps:
          - task: Docker@2
            displayName: Build and push
            inputs:
              command: buildAndPush
              containerRegistry: acr-company        # a Docker Registry service connection
              repository: my-api
              tags: |
                $(Build.SourceVersion)
```

`repository` is the path inside the registry, so the image is `myregistry.azurecr.io/my-api:<commit>` with an ACR connection and `company/my-api:<commit>` on Docker Hub; the `Dockerfile` input defaults to the first Dockerfile the task finds. The deploy stage below passes the same reference to `shipwick deploy --image`.

## Let the server pull from the registry

The pipeline pushes with the service connection's identity; the server pulls with a credential of its own, stored once with `shipwick registry login`, from a machine where you are logged in as an admin. What the credential is depends on the registry, and each registry's documentation for `docker login` says what to put where; `shipwick registry login` takes the same username and the same password, on standard input, with the registry named without `https://`:

- **Azure Container Registry.** Microsoft's documentation offers a service principal with the `acrpull` role, which logs in with its application (client) ID as the username and its client secret as the password, and notes that the secret expires after a year by default; or a repository-scoped token with `content/read` on the repository, which logs in with the token's name and password. The admin account is described as designed for a single user and mainly for testing, and is not what a server should hold.

  ```bash
  printf '%s' "$TOKEN_PASSWORD" | shipwick registry login myregistry.azurecr.io --username my-api-pull
  ```

- **Docker Hub.** A personal access token with read access, under the Docker ID that owns the repository:

  ```bash
  shipwick registry login docker.io --username company     # asks for the token without echo
  ```

```text
✓ Logged in to myregistry.azurecr.io as my-api-pull
  The server pulls images from myregistry.azurecr.io with this credential from now on.
```

The agent checks the credential against the registry before it stores it, keeps it encrypted, and sends it with every pull from that registry: deployments, rollbacks, jobs, a replica whose image was removed. Storing it needs the `admin` role, which the pipeline's token must not have, so this is a step done once by a person, and done again before a credential expires. See [Pull from private registries](/docs/tasks/private-registries).

## The gate in front of production: an environment with an approval

Shipwick has no approval step of its own: the pipeline decides when `shipwick deploy` may run. In Azure Pipelines that is an **environment** with an **Approvals** check. Create the environment under **Pipelines > Environments > Create environment**; on it, open **Approvals and checks**, add **Approvals** and name the users or groups who may approve, with a timeout after which the stage is skipped. Checks live on the environment, not in the YAML. A `deployment` job that targets the environment then waits, before its stage runs, until an approver has approved, and the environment keeps the history of what was deployed to it:

```yaml
trigger:
  branches:
    include: [main]

variables:
  - group: shipwick-production
  - name: image
    value: myregistry.azurecr.io/my-api:$(Build.SourceVersion)

stages:
  - stage: Build
    jobs:
      - job: Image
        pool:
          vmImage: ubuntu-latest
        steps:
          - task: Docker@2
            inputs:
              command: buildAndPush
              containerRegistry: acr-company
              repository: my-api
              tags: |
                $(Build.SourceVersion)

  - stage: Deploy
    dependsOn: Build
    jobs:
      - deployment: Production
        pool:
          vmImage: ubuntu-latest
        environment: production            # waits for the environment's approval
        strategy:
          runOnce:
            deploy:
              steps:
                - checkout: self
                - script: |
                    curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v1.1.0 sh -s -- --cli
                    shipwick deploy --image "$(image)"
                  displayName: Deploy with Shipwick
                  env:
                    SHIPWICK_AGENT_URL: $(SHIPWICK_AGENT_URL)
                    SHIPWICK_AGENT_TOKEN: $(SHIPWICK_AGENT_TOKEN)
```

`checkout: self` fetches the repository into the job before the step, as the documentation's deployment jobs do: `deploy.yaml` has to be there. Other checks go on the same environment, among them **Branch control**, which lets only builds of named branches through, and **Business hours**. With two servers, a `staging` environment without an approval and a `production` one with it, each with its own variable group, make the promotion; the shape is the one under [Staging and production](/docs/tasks/staging-and-production), with the environment's approval in place of GitHub's required reviewers.

## Secrets

A value that must not be in the repository is `${NAME}` in `deploy.yaml`, and the simplest place to fill it in is the server, once, with `shipwick secret set DATABASE_PASSWORD --app my-api`; nothing in Azure holds it then. Or the pipeline holds it, as a secret variable mapped into the step like the token, under the placeholder's name:

```yaml
env:
  SHIPWICK_AGENT_URL: $(SHIPWICK_AGENT_URL)
  SHIPWICK_AGENT_TOKEN: $(SHIPWICK_AGENT_TOKEN)
  DATABASE_PASSWORD: $(DATABASE_PASSWORD)
```

`shipwick deploy` fills `${DATABASE_PASSWORD}` in from the environment before the file is sent and prints `(1 variable substituted)`, never the value. Only `env` values may be left to the server; a `${NAME}` anywhere else must be set in the step. The rules are under [Supply secrets with ${NAME}](/docs/tasks/deploy-from-ci#supply-secrets-with).

## What's next

- [Deploy from CI](/docs/tasks/deploy-from-ci): what `shipwick deploy` does in any pipeline, its exit codes, `--no-wait`, migrations with `pre_deploy`.
- [Staging and production](/docs/tasks/staging-and-production): two servers, one file, the approval between them.
- [Pull from private registries](/docs/tasks/private-registries): what the agent does with the credential, and when a pull is refused.
- [Create tokens for CI and teammates](/docs/tasks/tokens): limits, ends, revocation.
- [Deploy from GitLab CI](/docs/tasks/deploy-from-gitlab): the same three lines in a `.gitlab-ci.yml`.
