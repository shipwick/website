---
title: Documentation
description: What Shipwick is, who it is for, and how this documentation is organized.
---

# Documentation

Shipwick runs Docker applications on a single server: health checks, zero-downtime deployments, rollbacks, resource limits and HTTPS, from one small `deploy.yaml`. This page says what it is, what it is not, and where to find things.

## What Shipwick is

Shipwick is a single agent that runs on your server and turns a `deploy.yaml` into running, supervised containers.

```yaml
# deploy.yaml
name: my-api
image: ghcr.io/company/my-api:1.4.2
port: 8080
domain: api.example.com
replicas: 2
```

```bash
deployctl deploy
```

It is for developers and small teams running 1–20 applications on a VPS — Hetzner, DigitalOcean, OVH, EC2 or similar — who want Docker in production without writing their own deploy scripts, restart logic, health checks, rollbacks and reverse-proxy configuration.

- **One binary, one SQLite file.** No cluster, no control plane, no external database.
- **Docker is the runtime.** Anything that runs with `docker run` runs on Shipwick.
- **A failed deployment never takes down the version that works.**

The parts:

| Part | Role |
|---|---|
| Agent | Runs on the server. Owns the deployment lifecycle, supervises containers, configures Caddy. Keeps its state in SQLite. |
| `deployctl` | The command-line client, for your laptop and for CI. |
| Dashboard | The same information and everyday actions in a browser. |
| Caddy | Serves application domains over HTTPS. The agent tells it what to route where. |

## What Shipwick is not

Shipwick is not a smaller Kubernetes. It does not do multi-node scheduling, service meshes or custom resources, by design. It does not build images, and it needs no external database or queue.

Shipwick is for one server. If you need to schedule workloads across a fleet of machines, you need Kubernetes.

::: info Status: 0.x
The current version is 0.1.0. Before 1.0, a minor version may change the API, `deploy.yaml` or the on-disk format. The [changelog](https://github.com/shipwick/shipwick/blob/main/CHANGELOG.md) says so when it happens, and how to upgrade.
:::

## How the documentation is organized

### Getting started

Install the server and the CLI, then deploy an application.

- [Install Shipwick on a server](/docs/getting-started/install)
- [Install deployctl](/docs/getting-started/install-cli)
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
- [Upgrade Shipwick](/docs/tasks/upgrade)
- [Reach the API without a hostname](/docs/tasks/access-without-a-hostname)

### Reference

Every field, command, variable and endpoint.

- [deploy.yaml](/docs/reference/deploy-yaml)
- [deployctl](/docs/reference/deployctl)
- [Agent configuration](/docs/reference/agent-configuration)
- [HTTP API](/docs/reference/api)

### Security

The API token is equivalent to root SSH access to the server. Read [Security](/docs/security) before you put Shipwick on a machine that matters.

## Source and license

Shipwick is open source under the Apache License 2.0. The source, the issue tracker and the releases are at [github.com/shipwick/shipwick](https://github.com/shipwick/shipwick).
