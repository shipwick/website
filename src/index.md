---
layout: home
title: Shipwick
titleTemplate: ':title · Production deployments on your own server'

hero:
  name: Shipwick
  text: Production deployments on your own server.
  tagline: One file describes the application, one command ships it. Rolling deployments with health checks and automatic rollback, HTTPS, scheduled jobs, backups, encrypted secrets, tokens with roles and a dashboard, on the Linux server you already have.
  actions:
    - theme: brand
      text: Get started
      link: /docs/getting-started/install
    - theme: alt
      text: Documentation
      link: /docs/
    - theme: alt
      text: GitHub
      link: https://github.com/shipwick/shipwick
---

<div class="home">

<section>

## One file, one command

<p class="lead">Describe the application. Shipwick pulls the image, starts the replicas, waits until each one is healthy, moves traffic over and retires the old version. If the new version does not come up, the one that works keeps serving.</p>

<div class="columns">
<div>

```yaml
# deploy.yaml
name: my-api
image: ghcr.io/company/my-api:1.4.2
port: 8080
domain: api.example.com
replicas: 2

health:
  path: /health

resources:
  cpu: 0.5
  memory: 256mb
```

</div>
<div>

```text
$ shipwick deploy
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
```

</div>
</div>

</section>

<section>

## What it takes care of

<div class="points">
<div>

### Rolling deployments

Replicas are replaced one at a time, each only after its successor passed its health checks. At most one container above the desired count, so it fits on a small server.

</div>
<div>

### Rollback

A rollout that fails half-way is undone on its own. Any earlier successful deployment can be brought back with `shipwick rollback`, with the configuration it had.

</div>
<div>

### Supervision

Crashed and unhealthy replicas are restarted with backoff, then reported as `CRASH_LOOP`. A container that disappears is recreated within about a second. Health checks over HTTP, over TCP, or with a command inside the container.

</div>
<div>

### HTTPS and routing

Caddy sits in front. Every application's domain and aliases get a certificate and are load-balanced across its healthy replicas; `www` and old domains redirect. There is no proxy configuration to write.

</div>
<div>

### Resource limits

CPU and memory limits per replica, current usage against them in `shipwick status` and the dashboard, and a week of history charted per replica.

</div>
<div>

### CLI, API and dashboard

`shipwick` for terminals and CI pipelines, a REST API with named tokens and roles, and a web dashboard with deployments, live logs, metrics and jobs.

</div>
<div>

### Jobs and migrations

A `pre_deploy` command runs from the new image before any replica of it starts; if it fails, nothing was touched. Scheduled `jobs` run on a cron schedule, and `shipwick run` runs a command by hand, each in a one-off container from the application's image.

</div>
<div>

### Backups and notifications

`shipwick backup` downloads an application's volumes as tar archives, `shipwick restore` puts one back. A webhook, Slack or Discord included, is told when a deployment succeeds, fails or is rolled back, and when an application goes down or recovers.

</div>
<div>

### Tokens with roles

`read` sees everything, `deploy` changes what runs, `admin` does everything. Create a token per CI pipeline and per person, see when each was last used, revoke it when it is done; every deployment records who made it.

</div>
</div>

</section>

<section>

## Why one server

A single server is a lot of computer. A few cores, a few gigabytes of memory and a good network run a company's whole product for the price of a lunch a month, and most products never need more than that. What such a server lacks is not power but the platform around it: deploying without downtime, restarting what crashes, knowing what is healthy, rolling back a bad release, serving HTTPS, keeping secrets out of files, running the nightly job, taking the backup. Teams build that platform themselves, in deploy scripts and cron entries, and every one is different.

Shipwick is that platform, built for one server on purpose. One process, one SQLite file, one YAML file per application. Nothing to keep alive besides the server itself, nothing else to buy. The focus is where its guarantees come from: one lock per application, one way replicas come to exist, a proxy that is never reloaded during a rollout, a failed deployment that never takes down the version that works.

| | |
|---|---|
| Unit of thought | An application: one `deploy.yaml` |
| To run it | One process on the server, one SQLite file |
| To operate it | `shipwick` in a terminal or a pipeline, a dashboard in a browser, an HTTP API |
| Scope | One server, by design |

Where it stops: Shipwick schedules nothing across machines. When one server is no longer enough, you have outgrown Shipwick, and the `deploy.yaml` you wrote says everything about the application that the next platform will ask.


</section>

<section>

## Install

On a Linux server with Docker, as root:

```bash
curl -fsSL https://get.shipwick.com | sh
```

This sets up the agent, Caddy and the dashboard, and prints the API token once. On your laptop or in CI, install only the CLI:

```bash
curl -fsSL https://get.shipwick.com | sh -s -- --cli
```

Or with Homebrew: `brew install shipwick/tap/shipwick`.

Everything the installer downloads comes from one release and is verified against its checksums. The agent holds the Docker socket, so its token is as valuable as root SSH access to the server: read [Security](/docs/security) before you put it on the internet.

<div class="next">

[Install on a server](/docs/getting-started/install)
[Your first deployment](/docs/getting-started/first-deployment)
[deploy.yaml reference](/docs/reference/deploy-yaml)

</div>

</section>

</div>
