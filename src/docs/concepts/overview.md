---
title: Architecture
description: The components of a Shipwick installation, how they communicate, what the agent owns and stores, and what Shipwick deliberately leaves out.
---

# Architecture

Shipwick is one long-running process per server, the agent, plus clients that talk to it over HTTP. This page describes the components, how they communicate, what the agent owns and stores, and what Shipwick does not do.

## Components

```text
                 shipwick / dashboard
                          │  HTTP + bearer token
                          ▼
                    Shipwick Agent
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   Docker Engine API    Caddy           SQLite
          │
          ▼
      Containers
```

| Component | Role |
|---|---|
| Agent (`shipwick-agent`) | The only stateful part of Shipwick. Runs deployments, supervises replicas, keeps the proxy configuration in line with what is running, and serves the REST API. |
| `shipwick` | Command-line client. Validates `deploy.yaml` locally, submits it, waits for the result. |
| Dashboard | Web client. Its own server holds the session and relays requests to the agent. It has no database and no state of its own. |
| Caddy | Reverse proxy in front of the applications. Terminates TLS, obtains and renews certificates, balances across replicas. |
| Docker | The container runtime. The agent uses the Docker daemon that is already on the server. |
| SQLite | One file in the agent's data directory. Holds applications, deployments, replicas and events. |

There is no control plane, no cluster and no external database. The installer sets up three containers on the server: the agent, Caddy and the dashboard. See [Install on a server](/docs/getting-started/install).

## How the components talk

**Clients to agent.** `shipwick` and the dashboard use the same REST API under `/api/v1`. Every endpoint except `GET /api/v1/health` requires `Authorization: Bearer <token>`. There is one token per agent. The API is plain HTTP and listens on `127.0.0.1:9000` by default; it is meant to be reached through Caddy over HTTPS, through an SSH tunnel, or over a private network. See the [REST API reference](/docs/reference/api) and [Security](/docs/security).

**Browser to dashboard to agent.** The browser talks only to the dashboard's own server. That server keeps the token in an `httpOnly` cookie and relays requests to the agent with the `Authorization` header added. The browser never holds the token and never contacts the agent, so the agent needs no CORS support. Anything the dashboard does, `shipwick` and `curl` can do too.

**Agent to Docker.** The agent talks to the Docker Engine API directly through the Docker socket. It never runs the `docker` command line or any shell. The standard `DOCKER_HOST` and `DOCKER_CONFIG` variables are honored.

**Agent to Caddy.** The agent renders Caddy's complete JSON configuration and loads it through Caddy's admin API. In the standard installation the admin API is a unix socket in a volume that only the agent and Caddy share. See [Routing and HTTPS](/docs/concepts/routing-and-https).

**Agent to SQLite.** The agent opens the database file with a single connection, in WAL mode, with foreign keys on. The agent's write volume is small, and one connection rules out `SQLITE_BUSY` errors and lock-upgrade deadlocks by construction.

## Configuration as the API

`POST /api/v1/applications/:name/deploy` takes the `deploy.yaml` document itself as the request body. JSON works too, since YAML subsumes it.

One parser and one validator serve both `shipwick` and the agent, so error messages are identical on both sides. The agent validates again regardless of what the client did: client-side validation is a convenience, not a trust boundary.

## What the agent owns

- **The deployment lifecycle.** Every deployment is an immutable record that moves through a state machine. See [Deployments](/docs/concepts/deployments).
- **Restarts.** Docker's own restart policy is set to `no` on every container. Restarts belong to the agent's supervisor, which adds backoff, health awareness and crash-loop detection. Two restart mechanisms would fight. See [Health checks and supervision](/docs/concepts/health-and-supervision).
- **The replica count.** A replica whose container has disappeared is recreated from the stored configuration.
- **Caddy's configuration, entirely.** The agent regenerates and reloads the full configuration whenever routing changes. Manual edits are overwritten.
- **The state.** The SQLite file is the record of what should be running.

## Containers

| Aspect | Behavior |
|---|---|
| Name | `shipwick_<app>_<deployment sequence>_<replica>`, for example `shipwick_my-api_7_1`. Names are for people reading `docker ps`. Application names cannot contain `_`, so the name parses unambiguously. |
| Identity | Labels `com.shipwick.managed`, `com.shipwick.app`, `com.shipwick.deployment` and `com.shipwick.replica`. The agent finds its containers by label, never by name. |
| Network | All application containers join one bridge network (`shipwick` by default), shared with the agent, for health probes, and with Caddy, for upstreams. |
| Ports | No host ports are published. There are no port conflicts between applications or replicas, and the proxy is the only way in. |
| Restart policy | Docker's is `no`. The supervisor restarts replicas. |
| Limits | `resources.cpu` becomes `NanoCPUs`. `resources.memory` becomes `Memory`, with `MemorySwap` set to the same value. See [Resource limits and metrics](/docs/concepts/resources). |
| Hardening | Never privileged, `no-new-privileges`, no host mounts, no user-controlled command execution. |
| Logs | The `json-file` driver, capped at 3 files of 10 MB per container, so a chatty application cannot fill the disk. |

Upstreams in the proxy configuration are container names, not IP addresses. A restarted container may get a new address, and Docker's DNS on the shared network always knows the current one.

## What is stored

The database has four tables: `applications`, `deployments`, `deployment_replicas` and `events`. Migrations are an append-only list tracked in `PRAGMA user_version`. Timestamps are fixed-width UTC text, so they sort lexicographically.

- **The full configuration of every deployment** is stored with it, as JSON. This is what makes a rollback "deploy the configuration of an older record again" rather than a separate code path.
- **Environment values are part of that configuration and are stored in plain text.** The API masks them in every response, but the file itself is not encrypted. The data directory is created with mode `0700`. See [Security](/docs/security).
- **Deployment events** narrate one deployment and never change afterwards.
- **Application events**, the supervisor's running commentary, are capped at the newest 500 per application. A crash loop would otherwise grow the table without bound.
- **The API token is not stored.** Only its SHA-256 hash is kept, in memory and, when the agent generated the token, in a file next to the database. See [Agent configuration](/docs/reference/agent-configuration).

Some things are deliberately not stored:

- **Metrics.** There is no background sampler. With nobody watching, nothing is measured. History is the client's business.
- **Supervisor state.** Health, backoff position and crash-loop flags live in the agent's memory. After an agent restart every replica starts with a clean slate. Only the restart counter is persisted, for display.

## Agent restarts and crashes

Running applications do not depend on the agent being up. Restarting or upgrading the agent does not restart any container. While the agent is down, applications keep serving, but nothing restarts a replica that crashes during that time.

At startup, before serving requests, the agent reconciles what it finds:

1. Deployments found mid-flight are marked `FAILED` with the error "agent restarted during deployment". The work that was driving them ended with the old process.
2. Containers that belong to a known application but not to its active deployment are removed.
3. Containers of applications the database does not know are never touched. If the database is lost, the agent must not tear down what is running.

After a server reboot, the agent brings every application back up according to its restart policy.

On `SIGINT` or `SIGTERM` the agent shuts down in order: it ends log streams, stops accepting HTTP requests, stops the supervisor and cancels in-flight deployments (each is marked `FAILED` and cleaned up), waits up to 30 seconds, then closes the Docker client and the database. A second signal kills the process immediately.

## Why there is no cluster

Kubernetes solves scheduling across fleets of machines. With one server, or three, its concepts come along (pods, services, ingresses, controllers, custom resources, a control plane to keep alive) and almost none of its power is used.

| | Kubernetes | Shipwick |
|---|---|---|
| Unit of thought | Pod, Deployment, Service, Ingress, and more | Application |
| To run it | A cluster | One process |
| State | etcd | A SQLite file |
| Configuration for one application | Several manifests | About 10 lines of YAML |
| Multi-node scheduling | Yes | No, by design |

Shipwick is for developers and small teams running 1 to 20 applications on a single server. Anything that runs with `docker run` runs on Shipwick. It is not a smaller Kubernetes.

## What Shipwick does not do

Out of scope, and likely to stay there:

- Multi-node scheduling, service meshes, custom resources.
- Building images. The `BUILDING` state of a deployment covers obtaining an image, not building one.
- Anything that requires an external database or queue.

Not in 0.1.0:

- Encrypted secrets. Environment values are stored in plain text in the SQLite file.
- Volumes. Containers get no host mounts, so stateful applications are not a fit yet.
- A `recreate` deployment strategy for applications that cannot run two versions side by side. `rolling` is the only strategy.
- Registry credential helpers (`credsStore`). Only `auths` entries of the Docker configuration file are read. See [Pull from private registries](/docs/tasks/private-registries).
- Internal service discovery between applications on the same server.
- Custom Caddy directives per application, such as headers, redirects or basic authentication.
- Several servers from one CLI configuration and one dashboard.
- Users and roles. There is a single API token.

Shipwick is for one server. An installation that outgrows one server has outgrown Shipwick.
