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
| Agent (`shipwick-agent`) | The only stateful part of Shipwick. Runs deployments, supervises replicas, keeps the proxy configuration in line with what is running, runs scheduled jobs, samples metrics, posts notifications, and serves the REST API. |
| `shipwick` | Command-line client. Validates `deploy.yaml` locally, submits it, waits for the result. Keeps several servers as contexts. |
| Dashboard | Web client. Its own server holds the session and relays requests to the agent. It has no database and no state of its own. |
| Caddy | Reverse proxy in front of the applications. Terminates TLS, obtains and renews certificates, balances across replicas, answers redirects. |
| Docker | The container runtime. The agent uses the Docker daemon that is already on the server. |
| SQLite | One file in the agent's data directory. Holds applications, deployments, replicas, events, tokens, job runs and metric samples. |

There is no control plane, no cluster and no external database. The installer sets up three containers on the server: the agent, Caddy and the dashboard. See [Install on a server](/docs/getting-started/install).

## How the components talk

**Clients to agent.** `shipwick` and the dashboard use the same REST API under `/api/v1`. Every endpoint except `GET /api/v1/health` requires `Authorization: Bearer <token>`, and every endpoint is registered with the role it needs: `read`, `deploy` or `admin`, each including the ones before it. The token the agent is configured with is the root token, `admin`; more tokens, each with a name and a role, are created through the API. The API is plain HTTP and listens on `127.0.0.1:9000` by default; it is meant to be reached through Caddy over HTTPS, through an SSH tunnel, or over a private network. See the [REST API reference](/docs/reference/api) and [Security](/docs/security).

**Browser to dashboard to agent.** The browser talks only to the dashboard's own server. That server keeps the token in an `httpOnly` cookie and relays requests to the agent with the `Authorization` header added. The browser never holds the token and never contacts the agent, so the agent needs no CORS support. Anything the dashboard does, `shipwick` and `curl` can do too.

**Agent to Docker.** The agent talks to the Docker Engine API directly through the Docker socket. It never runs the `docker` command line or any shell. The standard `DOCKER_HOST` and `DOCKER_CONFIG` variables are honored.

**Agent to Caddy.** The agent renders Caddy's complete JSON configuration and loads it through Caddy's admin API. In the standard installation the admin API is a unix socket in a volume that only the agent and Caddy share. The configuration says which name stands behind which domain; which replicas carry that name is decided on the services network, and Caddy asks Docker's DNS for it. See [Routing and HTTPS](/docs/concepts/routing-and-https).

**Application to application.** Every application with a `port` is `http://<name>:<port>` for the other applications on the server, over the services network. No domain and no trip through the proxy. See [Call one application from another](/docs/tasks/call-another-application).

**Agent to SQLite.** The agent opens the database file with a single connection, in WAL mode, with foreign keys on. The agent's write volume is small, and one connection rules out `SQLITE_BUSY` errors and lock-upgrade deadlocks by construction.

**Agent to webhook.** With `SHIPWICK_WEBHOOK_URL` set, the agent posts the outcome of every deployment, every application that goes down or recovers, and every failed job to that URL: a plain message to Slack or Discord, JSON to anything else. Delivery is a queue with one sender, so a webhook that is down never holds up a deployment. Where to be told is a property of the server, not of an application, which is why it is configured on the agent and not in `deploy.yaml`. See [Get notified](/docs/tasks/notifications).

## Configuration as the API

`POST /api/v1/applications/:name/deploy` takes the `deploy.yaml` document itself as the request body. JSON works too, since YAML subsumes it.

One parser and one validator serve both `shipwick` and the agent, so error messages are identical on both sides. The agent validates again regardless of what the client did: client-side validation is a convenience, not a trust boundary.

## What the agent owns

- **The deployment lifecycle.** Every deployment is an immutable record that moves through a state machine. See [Deployments](/docs/concepts/deployments).
- **Restarts.** Docker's own restart policy is set to `no` on every container. Restarts belong to the agent's supervisor, which adds backoff, health awareness and crash-loop detection. Two restart mechanisms would fight. See [Health checks and supervision](/docs/concepts/health-and-supervision).
- **The replica count.** A replica whose container has disappeared is recreated from the stored configuration.
- **Caddy's configuration, entirely.** The agent regenerates and reloads the full configuration whenever a hostname or a port changes. A rollout, a crash or a restart does not touch it. Manual edits are overwritten.
- **The names on the services network.** A replica carries its application's names while it is ready, and the agent gives and takes them.
- **One-off containers.** The `pre_deploy` command, scheduled `jobs` and `shipwick run` are one thing at three moments: a container from the application's image, with its environment, limits and networks, that runs one command and is removed. One code path creates, starts, waits for, reads out and removes it. See [Run scheduled jobs and one-off commands](/docs/tasks/jobs).
- **Old images.** After a successful deployment, and after `delete`, the images that only retired deployments of the application refer to are removed. The running version's image and the rollback target's are always kept. See [Deployments](/docs/concepts/deployments#when-a-deployment-is-done).
- **The metrics history.** A sampler records the CPU and memory of every running replica every 30 seconds and keeps seven days. See [Resource limits and metrics](/docs/concepts/resources#history).
- **The state.** The SQLite file is the record of what should be running.

## Containers

| Aspect | Behavior |
|---|---|
| Name | `shipwick_<app>_<deployment sequence>_<replica>`, for example `shipwick_my-api_7_1`. Names are for people reading `docker ps`. Application names cannot contain `_`, so the name parses unambiguously. |
| Identity | Labels `com.shipwick.managed`, `com.shipwick.app`, `com.shipwick.deployment` and `com.shipwick.replica`. The agent finds its containers by label, never by name. |
| Networks | Two bridge networks. `shipwick`: every replica, the agent, for health probes, and whatever you run beside Shipwick. `shipwick-services`: every replica and Caddy. A replica carries its application's names on the second one while it is ready: `<app>` and `<app>_<port>`. |
| Ports | No host ports are published, unless `deploy.yaml` has `publish`; then exactly the listed container ports are bound on the server, for services the proxy cannot serve because they are not HTTP. Only for `recreate` applications with one replica: a server port has one holder. A port the agent or the proxy listens on, or one another application publishes, is refused before anything is recorded. See [Routing and HTTPS](/docs/concepts/routing-and-https#ports-that-are-not-http). |
| Volumes | `volumes` in `deploy.yaml` become named Docker volumes `shipwick_<app>_<volume>`, created with labels and mounted at the given path. They belong to the application: every deployment mounts the same ones, and nothing removes them, not a rollback, not `delete`. Never a host path. Backups and restores go through the replica's container and Docker's archive endpoints, which read and write a container's filesystem whether or not it runs; a restore is the one operation that removes a volume, and it creates it again, empty, before extracting the archive. See [Back up and restore volumes](/docs/tasks/backups). |
| Process | `entrypoint`, `command` and `user` go to Docker as `Entrypoint`, `Cmd` and `User`: argv as written, nothing split, joined or passed through a shell. Unset means the image's own. |
| Restart policy | Docker's is `no`. The supervisor restarts replicas. |
| Limits | `resources.cpu` becomes `NanoCPUs`. `resources.memory` becomes `Memory`, with `MemorySwap` set to the same value. See [Resource limits and metrics](/docs/concepts/resources). |
| Hardening | Never privileged, `no-new-privileges`, no host mounts. Nothing from `deploy.yaml` runs on the server itself; a command runs inside the container, as the image's own would. |
| Logs | The `json-file` driver, capped at 3 files of 10 MB per container, so a chatty application cannot fill the disk. `logging` selects another Docker driver, whose options reach the daemon as written; the caps stay for `json-file` and `local` unless the application sets its own. A collector address must be `scheme://host:port`, never a socket or a certificate file on the server. |
| Job containers | `shipwick_<app>_job_<job>_<run id>`, for example `shipwick_my-api_job_nightly-report_42`, with labels `com.shipwick.job` and `com.shipwick.run` instead of a replica index. Same image, environment, limits, networks and hardening as a replica; no volumes, no published ports. Removed when the run ends. |

The proxy configuration names no container and no address. It names `<app>_<port>`, and Caddy resolves that through Docker's DNS for every request. A replica takes the name when it is ready and loses it when it stops, so a replica can be replaced, crash or restart without the configuration changing. See [Routing and HTTPS](/docs/concepts/routing-and-https).

## What is stored

The database has seven tables: `applications`, `deployments`, `deployment_replicas`, `events`, `tokens`, `metric_samples` and `job_runs`. Migrations are an append-only list tracked in `PRAGMA user_version`. Timestamps are fixed-width UTC text, so they sort lexicographically.

- **The full configuration of every deployment** is stored with it, as JSON. This is what makes a rollback "deploy the configuration of an older record again" rather than a separate code path.
- **Environment values are encrypted in that JSON**, and nothing else is. Names, images, domains and the variable names stay readable, so the file remains debuggable; only the values are ciphertext (AES-256-GCM). The key is `encryption.key` in the data directory, or `SHIPWICK_ENCRYPTION_KEY`. It lives next to the database rather than in it, so a copy of the database alone reveals no secrets, and it must be backed up with the database. The API masks the values in every response regardless. See [Security](/docs/security#secrets-at-rest).
- **Deployment events** narrate one deployment and never change afterwards. Each deployment also records `by`, the name of the token that started it.
- **Application events**, the supervisor's running commentary, are capped at the newest 500 per application. A crash loop would otherwise grow the table without bound.
- **Tokens** are stored as name, role and the SHA-256 of the value. The root token is the exception: it is not in the database at all. Only its hash is kept, in memory and in `agent-token.sha256` next to the database, so a lost or corrupt database can never lock the operator out. See [Agent configuration](/docs/reference/agent-configuration).
- **Job runs**: one row per run of a pre-deploy hook, scheduled job or one-off command, with the last 200 lines (64 KB) of its output. The last 50 runs of each job are kept.
- **Metric samples**: one row per running replica every 30 seconds, raw, pruned once an hour to seven days. Aggregation happens on read.

Deliberately not stored:

- **Supervisor state.** Health, backoff position and crash-loop flags live in the agent's memory. After an agent restart every replica starts with a clean slate. Only the restart counter is persisted, for display.

## Agent restarts and crashes

Running applications do not depend on the agent being up. Restarting or upgrading the agent does not restart any container. While the agent is down, applications keep serving, but nothing restarts a replica that crashes during that time.

At startup, before serving requests, the agent reconciles what it finds:

1. Deployments found mid-flight are marked `FAILED` with the error "agent restarted during deployment". The work that was driving them ended with the old process.
2. Job runs still marked `running` become `interrupted`, and their containers are removed with the other leftovers. A scheduled job runs again at its next firing; a firing that fell while the agent was down is not caught up.
3. Containers that belong to a known application but not to its active deployment are removed.
4. Containers of applications the database does not know are never touched. If the database is lost, the agent must not tear down what is running.

Before any of that, opening the database proves the encryption key against every stored value. A key that does not match is caught at start, not at the first deployment, and the agent refuses to start with a message that says so.

After a server reboot, the agent brings every application back up according to its restart policy.

On `SIGINT` or `SIGTERM` the agent shuts down in order: it ends log streams, stops accepting HTTP requests, stops the supervisor and cancels in-flight deployments (each is marked `FAILED` and cleaned up), waits up to 30 seconds, then closes the Docker client and the database. A second signal kills the process immediately.

## Why one server

Shipwick is built for one server on purpose. A single machine runs the 1 to 20 applications of most products with room to spare; what it lacks is the platform around them: deployments without downtime, supervision, rollback, HTTPS, secrets, jobs, backups. Shipwick is that platform, and being for one server is where its guarantees come from: one lock per application, one way replicas come to exist, a proxy that is never reloaded during a rollout, a failed deployment that never takes down the version that works. There is one process to run and one SQLite file to back up.

Anything that runs with `docker run` runs on Shipwick. It schedules nothing across machines; when one server is no longer enough, you have outgrown it.

## What Shipwick does not do

Out of scope, and likely to stay there:

- Multi-node scheduling, service meshes, custom resources.
- Building images. The `BUILDING` state of a deployment covers obtaining an image, not building one.
- Anything that requires an external database or queue.

Not yet:

- Host mounts. `volumes` are named Docker volumes; a path on the host cannot be mounted.
- Registry credential helpers (`credsStore`). Only `auths` entries of the Docker configuration file are read. See [Pull from private registries](/docs/tasks/private-registries).
- Custom Caddy directives per application, such as headers or basic authentication. Redirecting a hostname to the domain is built in; see [Routing and HTTPS](/docs/concepts/routing-and-https#several-hostnames-aliases-and-redirects).
- Several servers in one dashboard. The CLI keeps several as contexts; the dashboard signs in to one agent at a time.
- Roles per application. A token's role applies to the whole server.
- Rotating the encryption key.

Shipwick is for one server. An installation that outgrows one server has outgrown Shipwick.
