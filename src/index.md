---
layout: home
title: Production deployments, without Kubernetes
titleTemplate: Shipwick

hero:
  name: Shipwick
  text: Production deployments, without Kubernetes.
  tagline: Shipwick runs your Docker applications on your own server. Health checks, zero-downtime deploys, rollbacks, resource limits and HTTPS, from one small config file.
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
$ deployctl deploy
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

A rollout that fails half-way is undone on its own. Any earlier successful deployment can be brought back with `deployctl rollback`, with the configuration it had.

</div>
<div>

### Supervision

Crashed and unhealthy replicas are restarted with backoff, then reported as `CRASH_LOOP`. A container that disappears is recreated within about a second.

</div>
<div>

### HTTPS and routing

Caddy sits in front. Every application's domain gets a certificate and is load-balanced across its healthy replicas. There is no proxy configuration to write.

</div>
<div>

### Resource limits

CPU and memory limits per replica, and current usage against them in `deployctl status` and the dashboard.

</div>
<div>

### CLI, API and dashboard

`deployctl` for terminals and CI pipelines, a REST API with one token, and a web dashboard with deployments, live logs and metrics.

</div>
</div>

</section>

<section>

## Why not Kubernetes?

Kubernetes solves scheduling across fleets of machines. If you have one server, or three, you inherit all of its concepts and use almost none of its power. Shipwick is for developers and small teams running 1–20 applications on a VPS, who want Docker in production without hand-rolling deploy scripts, restart logic, health checks and reverse-proxy configuration.

| | Kubernetes | Shipwick |
|---|---|---|
| Unit of thought | Pod, Deployment, Service, Ingress, … | Application |
| To run it | A cluster | One process |
| State | etcd | A SQLite file |
| Configuration for one application | Several manifests | About 10 lines of YAML |
| Multi-node scheduling | Yes | No, by design |

Shipwick is not a smaller Kubernetes. It does not do multi-node scheduling, service meshes or custom resources. If you need those, you need Kubernetes.

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

Everything the installer downloads comes from one release and is verified against its checksums. The agent holds the Docker socket, so its token is as valuable as root SSH access to the server: read [Security](/docs/security) before you put it on the internet.

<div class="next">

[Install on a server](/docs/getting-started/install)
[Your first deployment](/docs/getting-started/first-deployment)
[deploy.yaml reference](/docs/reference/deploy-yaml)

</div>

</section>

</div>
