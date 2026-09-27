---
title: Documentation
description: What Shipwick is, who it is for, and how this documentation is organized.
---

# Documentation

Shipwick runs Docker applications on a single server: health checks, zero-downtime deployments, rollbacks, resource limits and HTTPS, from one small `deploy.yaml`. This page says what it is, what it is not, and where to find things.

<div class="paths">
<div class="path">
<header>
<h3>I just want to deploy</h3>
<img src="/img/wick-check.svg" alt="" width="56" height="56">
</header>
<ol>
<li><a href="/docs/getting-started/how-it-fits">How it fits together</a>: the picture in one page</li>
<li><a href="/docs/getting-started/install">Install on a server</a>, one command</li>
<li><a href="/docs/getting-started/first-deployment">Your first deployment</a>, from <code>init</code> to a URL</li>
</ol>
<p>You need a Dockerfile or an image of your application, nothing else; <code>shipwick init</code> writes the Dockerfile for a Node, Nuxt, Next, .NET, Go or Python project, and a folder of static files needs no container at all.</p>
</div>
<div class="path">
<header>
<h3>I run servers for a living</h3>
<img src="/img/wick-watch.svg" alt="" width="56" height="56">
</header>
<ol>
<li><a href="/docs/concepts/overview">Architecture</a>: what runs where, what is stored, how the parts talk</li>
<li><a href="/docs/security">Security</a>: the trust model, and how to expose the API</li>
<li>Reference: <a href="/docs/reference/deploy-yaml">deploy.yaml</a>, <a href="/docs/reference/cli">CLI</a>, <a href="/docs/reference/api">API</a>, <a href="/docs/reference/agent-configuration">Agent configuration</a></li>
</ol>
<p>Every field, command, variable and endpoint is documented; every number in the reference was measured.</p>
</div>
</div>

## What Shipwick is

Shipwick is a single agent that runs on your server and turns a `deploy.yaml` into running, supervised containers.

```yaml
# deploy.yaml
name: my-api
build: .
port: 8080
domain: api.example.com
replicas: 2
```

```bash
shipwick deploy
```

It is for developers and small teams running 1–20 applications on a VPS — Hetzner, DigitalOcean, OVH, EC2 or similar — who want Docker in production without writing their own deploy scripts, restart logic, health checks, rollbacks and reverse-proxy configuration.

- **One binary, one SQLite file.** No cluster, no control plane, no external database.
- **Docker is the runtime.** Anything that runs with `docker run` runs on Shipwick. The image is pulled from a registry, or built on your machine by `shipwick deploy` and sent to the server; no registry is needed for that.
- **A failed deployment never takes down the version that works.**

The parts:

| Part | Role |
|---|---|
| Agent | Runs on the server. Owns the deployment lifecycle, supervises containers, configures Caddy. Keeps its state in SQLite. |
| `shipwick` | The command-line client, for your laptop and for CI. Builds images with `build: .`, uploads static folders, and installs the server over SSH. |
| Dashboard | The same information and everyday actions in a browser. |
| Caddy | Serves application domains over HTTPS, and static sites straight from disk. The agent tells it what to route where. |

## What Shipwick is not

Shipwick is for one server, by design. It schedules nothing across machines, runs no service mesh and has no extension model. The agent builds no images: with `build: .` the build runs on your machine, and the server only loads the result. It needs no external database or queue.

When one server is no longer enough, you have outgrown Shipwick. Until then, it is the whole platform.

::: info Status: 0.x
The current version is 0.4.0. Before 1.0, a minor version may change the API, `deploy.yaml` or the on-disk format. The [changelog](https://github.com/shipwick/shipwick/blob/main/CHANGELOG.md) says so when it happens, and how to upgrade.
:::

## How the documentation is organized

### Getting started

Install the server and the CLI, then deploy an application.

- [How it fits together](/docs/getting-started/how-it-fits) — what runs where, which parts you need, the order to set up a fresh server in, and the problems people meet on the way
- [Install Shipwick on a server](/docs/getting-started/install)
- [Install the CLI](/docs/getting-started/install-cli)
- [Your first deployment](/docs/getting-started/first-deployment)

### Concepts

How Shipwick works and why it behaves the way it does.

- [Overview](/docs/concepts/overview)
- [Deployments](/docs/concepts/deployments)
- [Rollback](/docs/concepts/rollback)
- [Health and supervision](/docs/concepts/health-and-supervision)
- [Routing and HTTPS](/docs/concepts/routing-and-https)
- [Resources](/docs/concepts/resources)

### Tasks

How to do one specific thing.

- [Deploy from CI](/docs/tasks/deploy-from-ci)
- [Roll back and redeploy](/docs/tasks/roll-back)
- [Inspect applications and read logs](/docs/tasks/inspect-and-logs)
- [Use the dashboard](/docs/tasks/dashboard)
- [Pull from private registries](/docs/tasks/private-registries)
- [Call one application from another](/docs/tasks/call-another-application)
- [Run a database or other stateful application](/docs/tasks/stateful-applications)
- [Expose a service that is not HTTP](/docs/tasks/non-http-services)
- [Serve several hostnames and redirect www](/docs/tasks/several-hostnames)
- [Run scheduled jobs and one-off commands](/docs/tasks/jobs)
- [Back up and restore volumes](/docs/tasks/backups)
- [Create tokens for CI and teammates](/docs/tasks/tokens)
- [Get notified](/docs/tasks/notifications)
- [Upgrade Shipwick](/docs/tasks/upgrade)
- [Reach the API without a hostname](/docs/tasks/access-without-a-hostname)

### Reference

Every field, command, variable and endpoint.

- [deploy.yaml](/docs/reference/deploy-yaml), and `shipwick.yaml` for several applications
- [shipwick](/docs/reference/cli)
- [Agent configuration](/docs/reference/agent-configuration)
- [HTTP API](/docs/reference/api)

### Security

An admin token is equivalent to root SSH access to the server. Read [Security](/docs/security) before you put Shipwick on a machine that matters.

## Source and license

Shipwick is open source under the Apache License 2.0. The source, the issue tracker and the releases are at [github.com/shipwick/shipwick](https://github.com/shipwick/shipwick).
