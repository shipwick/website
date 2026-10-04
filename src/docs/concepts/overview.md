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
| Agent (`shipwick-agent`) | The only stateful part of Shipwick. Runs deployments, supervises replicas, keeps the proxy configuration in line with what is running, runs scheduled jobs, takes backups, samples metrics, reads the proxy's access log, raises alerts, posts notifications, keeps the secrets, registry credentials and supplied certificates, and serves the REST API. |
| `shipwick` | Command-line client. Validates `deploy.yaml` locally, builds the image on your machine with `build:` or uploads a static folder, submits the document, waits for the result. Installs the server over SSH, checks the setup with `doctor`. Keeps several servers as contexts. |
| Dashboard | Web client. Its own server holds the session and relays requests to the agent. It has no database and no state of its own. |
| Caddy | Reverse proxy in front of the applications. Terminates TLS, obtains and renews certificates, balances across replicas, compresses responses, answers redirects, sets headers and asks for passwords where an application's `proxy` block says so, and serves static applications from disk. Since 0.5 it is Shipwick's own build, `ghcr.io/shipwick/caddy`: Caddy with the Cloudflare DNS module and, since 0.8, Shipwick's own way of finding replicas, and nothing else added, pinned to the release like the agent and the dashboard. |
| Docker | The container runtime. The agent uses the Docker daemon that is already on the server; images are pulled from a registry, with a credential the agent keeps when the registry is private, or loaded from an archive the CLI built and sent. |
| SQLite | One file in the agent's data directory. Holds applications, deployments, replicas, events, tokens, secrets, registry credentials, supplied certificates, job runs, backup runs, and metric and traffic samples. |

There is no control plane, no cluster and no external database. The installer sets up three containers on the server: the agent, Caddy and the dashboard. See [Install on a server](/docs/getting-started/install).

## How the components talk

**Clients to agent.** `shipwick` and the dashboard use the same REST API under `/api/v1`. Every endpoint except `GET /api/v1/health` requires `Authorization: Bearer <token>`, and every endpoint is registered with the role it needs: `read`, `deploy` or `admin`, each including the ones before it. The token the agent is configured with is the root token, `admin`; more tokens, each with a name and a role, are created through the API. The API is plain HTTP and listens on `127.0.0.1:9000` by default; it is meant to be reached through Caddy over HTTPS, through an SSH tunnel, or over a private network. In a container the agent listens on the `shipwick-control` network, which Caddy and the dashboard are on and no application is, and on loopback; a request from an application's container is refused. See [Who can reach the API](/docs/security#who-can-reach-the-api), the [REST API reference](/docs/reference/api) and [Security](/docs/security).

**Browser to dashboard to agent.** The browser talks only to the dashboard's own server. That server keeps the token in an `httpOnly` cookie and relays requests to the agent with the `Authorization` header added. The browser never holds the token and never contacts the agent, so the agent needs no CORS support. Anything the dashboard does, `shipwick` and `curl` can do too.

**Agent to Docker.** The agent talks to the Docker Engine API directly through the Docker socket. It never runs the `docker` command line or any shell. The standard `DOCKER_HOST` and `DOCKER_CONFIG` variables are honored. It pulls images and loads the archives the CLI sends; it builds nothing. A pull from a private registry carries the credential stored with `shipwick registry login`; the daemon holds none. See [Pull from private registries](/docs/tasks/private-registries).

**CLI to Docker, on your machine.** With `build:` in `deploy.yaml`, `shipwick deploy` runs `docker build` where it runs, for the server's architecture, and sends the image to the agent as an archive. The build happens on the developer's machine, never on the server. See [Deployments](/docs/concepts/deployments#images-built-where-you-are).

**Agent to Caddy.** The agent renders Caddy's complete JSON configuration and loads it through Caddy's admin API. In the standard installation the admin API is a unix socket in a volume that only the agent and Caddy share. The configuration says which name stands behind which domain; which replicas carry that name is decided on the services network, and Caddy asks Docker's DNS for it. When the agent stops a replica, it tells the proxy to forget it, so that the replica's address can go to another application's container. See [Routing and HTTPS](/docs/concepts/routing-and-https#replicas-are-found-by-name).

Two things come back from Caddy. It writes its access log to standard output, without headers and without query strings, and the agent follows it through the Docker Engine API, the way it reads a replica's log: that is where [`shipwick traffic`](/docs/tasks/traffic) gets its numbers. And the agent asks the proxy for each hostname's certificate the way a visitor would, with a TLS handshake, to report its issuer and expiry. See [Certificates](/docs/tasks/certificates).

**Caddy to Cloudflare.** Only with `SHIPWICK_CLOUDFLARE_API_TOKEN` set on the agent: Caddy then obtains certificates through a DNS record it creates with Cloudflare's API, so a hostname can stay behind Cloudflare's proxy and can be a wildcard. See [Put Cloudflare in front](/docs/tasks/cloudflare).

**Application to application.** Every application with a `port` is `http://<name>:<port>` for the other applications on the server, over the services network. No domain and no trip through the proxy. See [Call one application from another](/docs/tasks/call-another-application).

**Agent to SQLite.** The agent opens the database file with a single connection, in WAL mode, with foreign keys on. The agent's write volume is small, and one connection rules out `SQLITE_BUSY` errors and lock-upgrade deadlocks by construction.

**Agent to bucket.** Only with the `SHIPWICK_BACKUP_S3_*` variables set: the agent sends every backup it takes to a bucket on an S3-compatible service as well as to the server's disk, encrypted first when `SHIPWICK_BACKUP_PASSPHRASE` is set, and reads it back to restore. See [Back up and restore volumes](/docs/tasks/backups).

**Agent to webhook.** With `SHIPWICK_WEBHOOK_URL` set, the agent posts the outcome of every deployment, every application that goes down or recovers, every failed job and failed scheduled backup, a certificate that is running out, and every alert that is raised or cleared to that URL: a plain message to Slack or Discord, JSON to anything else. Delivery is a queue with one sender, so a webhook that is down never holds up a deployment. Where to be told is a property of the server, not of an application, which is why it is configured on the agent and not in `deploy.yaml`. See [Get notified](/docs/tasks/notifications).

## Configuration as the API

`POST /api/v1/applications/:name/deploy` takes the `deploy.yaml` document itself as the request body. JSON works too, since YAML subsumes it.

One parser and one validator serve both `shipwick` and the agent, so error messages are identical on both sides. The agent validates again regardless of what the client did: client-side validation is a convenience, not a trust boundary.

## What the agent owns

- **The deployment lifecycle.** Every deployment is an immutable record that moves through a state machine. See [Deployments](/docs/concepts/deployments).
- **Restarts.** Docker's own restart policy is set to `no` on every container. Restarts belong to the agent's supervisor, which adds backoff, health awareness and crash-loop detection. Two restart mechanisms would fight. See [Health checks and supervision](/docs/concepts/health-and-supervision).
- **The replica count.** A replica whose container has disappeared is recreated from the stored configuration.
- **Caddy's configuration, entirely.** The agent regenerates and reloads the full configuration whenever a hostname, a path or a port changes, or a `proxy` block, a supplied certificate or a static application's folder does. A rollout, a crash or a restart does not touch it. Manual edits are overwritten.
- **The folders of static applications.** The agent copies an uploaded folder into Caddy's container and keeps the one serving and the one before it. See [Deployments](/docs/concepts/deployments#a-folder-instead-of-a-container).
- **The secrets.** Values stored with `shipwick secret set`, encrypted like environment values, filled into `${NAME}` in `env` values when a deployment is recorded.
- **Registry credentials.** Stored with `shipwick registry login`, encrypted like a secret, and sent with every pull from that registry: deployments, rollbacks, jobs.
- **Supplied certificates.** A certificate of your own, stored with `shipwick cert set`, is served for the hostnames it covers instead of one Caddy obtains. Its key is encrypted in the database and never returned.
- **The encryption key.** One key encrypts all of the above. `shipwick server rotate-key` has the running agent replace it and re-encrypt every stored value, without a deployment or a restart. See [Rotate the encryption key](/docs/tasks/rotate-the-encryption-key).
- **Backups.** With a `backups` block in `deploy.yaml`, the agent archives an application's volumes on a schedule, keeps the archives under `backups/` in its data directory, sends them to a bucket when one is configured, and removes the oldest beyond `keep`. It backs up its own state, the database and the key, the same way, daily and only ever encrypted. See [Back up and restore volumes](/docs/tasks/backups).
- **The names on the services network.** A replica carries its application's names while it is ready, and the agent gives and takes them.
- **One-off containers.** The `pre_deploy` command, scheduled `jobs` and `shipwick run` are one thing at three moments: a container from the application's image, with its environment, limits and networks, that runs one command and is removed. One code path creates, starts, waits for, reads out and removes it. See [Run scheduled jobs and one-off commands](/docs/tasks/jobs).
- **Old images.** After a successful deployment, and after `delete`, the images that only retired deployments of the application refer to are removed. The running version's image and the rollback target's are always kept. A deployment that fails or is rolled back removes the image it named right then, under the same rule. See [Deployments](/docs/concepts/deployments#when-a-deployment-is-done).
- **The metrics history.** A sampler records the CPU and memory of every running replica every 30 seconds and keeps seven days. See [Resource limits and metrics](/docs/concepts/resources#history).
- **The traffic counts.** From the proxy's access log the agent keeps, per application and minute, the requests, their status classes, the bytes and a latency histogram, for seven days, and the last 200 requests of each application in memory. See [Traffic](/docs/tasks/traffic).
- **The last output of containers that ended.** Since 0.7 the agent copies what a container printed into its log archive when the container's run ends — a crash, a restart, a replaced replica, a finished job — and keeps it for 14 days within 1 GB. See [Find out why it died](/docs/tasks/find-out-why-it-died).
- **The alerts.** A replica near its memory limit, the server's disk filling up, a replica restarted three times within ten minutes, an application that has not been healthy for five minutes: each is raised once and cleared once. See [Alerts and metrics](/docs/tasks/alerts-and-metrics).
- **The state.** The SQLite file is the record of what should be running.

## Containers

| Aspect | Behavior |
|---|---|
| Name | `shipwick_<app>_<deployment sequence>_<replica>`, for example `shipwick_my-api_7_1`. Names are for people reading `docker ps`. Application names cannot contain `_`, so the name parses unambiguously. |
| Identity | Labels `com.shipwick.managed`, `com.shipwick.app`, `com.shipwick.deployment` and `com.shipwick.replica`. The agent finds its containers by label, never by name. |
| Networks | Three bridge networks. `shipwick`: every replica, the agent, for health probes — it does not listen there — and whatever you run beside Shipwick. `shipwick-services`: every replica and Caddy. A replica carries its application's names on the second one while it is ready: `<app>` and `<app>_<port>`. `shipwick-control`, since 0.8: the agent, Caddy and the dashboard, and never a replica; the API is reached there. |
| Ports | No host ports are published, unless `deploy.yaml` has `publish`; then exactly the listed container ports are bound on the server, for services the proxy cannot serve because they are not HTTP. Only for `recreate` applications with one replica: a server port has one holder. A port the agent or the proxy listens on, or one another application publishes, is refused before anything is recorded. See [Routing and HTTPS](/docs/concepts/routing-and-https#ports-that-are-not-http). |
| Volumes | `volumes` in `deploy.yaml` become named Docker volumes `shipwick_<app>_<volume>`, created with labels and mounted at the given path. They belong to the application: every deployment mounts the same ones, and nothing removes them, not a rollback, not `delete`. Never a host path. Backups and restores go through the replica's container and Docker's archive endpoints, which read and write a container's filesystem whether or not it runs; a restore is the one operation that removes a volume, and it creates it again, empty, before extracting the archive. See [Back up and restore volumes](/docs/tasks/backups). |
| Process | `entrypoint`, `command` and `user` go to Docker as `Entrypoint`, `Cmd` and `User`: argv as written, nothing split, joined or passed through a shell. Unset means the image's own. |
| Restart policy | Docker's is `no`. The supervisor restarts replicas. |
| Limits | `resources.cpu` becomes `NanoCPUs`. `resources.memory` becomes `Memory`, with `MemorySwap` set to the same value. A daemon without the cgroup controllers applies neither, and the agent says so. See [Resource limits and metrics](/docs/concepts/resources). |
| Hardening | Never privileged, `no-new-privileges`, no host mounts. Nothing from `deploy.yaml` runs on the server itself; a command runs inside the container, as the image's own would. |
| `security` | What an application gives up on top of that, by its own choice, since 0.8: a read-only root filesystem, directories in memory, fewer capabilities, no container that runs as root. It holds for every container made from the application, a job's and a one-off command's included. See [Containers locked down further](/docs/security#containers-locked-down-further). |
| Logs | The `json-file` driver, capped at 3 files of 10 MB per container, so a chatty application cannot fill the disk. `logging` selects another Docker driver, whose options reach the daemon as written; the caps stay for `json-file` and `local` unless the application sets its own. A collector address must be `scheme://host:port`, never a socket or a certificate file on the server. |
| Job containers | `shipwick_<app>_job_<job>_<run id>`, for example `shipwick_my-api_job_nightly-report_42`, with labels `com.shipwick.job` and `com.shipwick.run` instead of a replica index. Same image, environment, limits, networks and hardening as a replica; no volumes, no published ports. Removed when the run ends. |

The proxy configuration names no container and no address. It names `<app>_<port>`, and Caddy resolves that through Docker's DNS, again every second. A replica takes the name when it is ready and loses it when it stops, so a replica can be replaced, crash or restart without the configuration changing. See [Routing and HTTPS](/docs/concepts/routing-and-https).

## What is stored

The database has nineteen tables: `applications`, `deployments`, `deployment_replicas`, `events`, `tokens`, `metric_samples`, `job_runs`, `secrets`, `registries`, `certificates`, `traffic_samples`, `backup_runs`, `backup_installation`, since 0.6 `audit_log`, `access_rules`, `sessions` and `transfer_state`, and since 0.7 `log_archives` and `deployment_references`. Migrations are an append-only list tracked in `PRAGMA user_version`. Timestamps are fixed-width UTC text, so they sort lexicographically.

- **The full configuration of every deployment** is stored with it, as JSON. This is what makes a rollback "deploy the configuration of an older record again" rather than a separate code path.
- **Environment values are encrypted in that JSON**, and the basic-auth passwords of the `proxy` block with them; so are the stored secrets, the registry passwords and the keys of supplied certificates. Nothing else is. Names, images, domains, the variable names and a certificate's chain stay readable, so the file remains debuggable; only the values are ciphertext (AES-256-GCM). The key is `encryption.key` in the data directory, or `SHIPWICK_ENCRYPTION_KEY`. It lives next to the database rather than in it, so a copy of the database alone reveals no secrets, and it must be backed up with the database, which the agent does itself once a backup passphrase is set. The key can be rotated while the agent runs. The API masks the values in every response regardless. See [Security](/docs/security#secrets-at-rest).
- **A static deployment** records the digest, file count and size of the folder it serves instead of an image.
- **Deployment events** narrate one deployment and never change afterwards. Each deployment also records `by`, the name of the token that started it.
- **Application events**, the supervisor's running commentary, are capped at the newest 500 per application. A crash loop would otherwise grow the table without bound.
- **Tokens** are stored as name, role and the SHA-256 of the value. The root token is the exception: it is not in the database at all. Only its hash is kept, in memory and in `agent-token.sha256` next to the database, so a lost or corrupt database can never lock the operator out. See [Agent configuration](/docs/reference/agent-configuration).
- **Job runs**: one row per run of a pre-deploy hook, scheduled job or one-off command, with the last 200 lines (64 KB) of its output. The last 50 runs of each job are kept.
- **The log archive's index**, since 0.7: one row for each ended run of a container whose output was kept, with what it was the output of and how it ended. The lines themselves are gzip files under `logs/` in the data directory, not in the database. See [Find out why it died](/docs/tasks/find-out-why-it-died).
- **The references of a deployment**, since 0.7: which of its secret values the server filled in from its secrets, as the document wrote them, with `${NAME}` in place. Encrypted like a secret. It is what lets [the document be given back](/docs/tasks/get-the-configuration-back).
- **Metric samples**: one row per running replica every 30 seconds, raw, pruned once an hour to seven days. Aggregation happens on read.
- **Traffic samples**: one row per application and minute with requests, holding the counts and a latency histogram, pruned after seven days like the metric samples. A quiet application writes nothing. The histogram is stored, not the percentiles, because percentiles of minutes cannot be combined into the percentile of an hour.
- **Backup runs**: one row per backup, of an application's volumes or of the agent's own state, with what was done with it since: verified, restored. Backups are recorded by application name, so they outlive the application's deletion, like its volumes. One more row holds the name this installation marks its bucket with.

Next to the database, the data directory holds the backups themselves, under `backups/`, unless `SHIPWICK_BACKUP_DIR` names another directory. See [Agent configuration](/docs/reference/agent-configuration#data-directory).

Deliberately not stored:

- **Supervisor state.** Health, backoff position and crash-loop flags live in the agent's memory. After an agent restart every replica starts with a clean slate. Only the restart counter is persisted, for display.
- **Alerts.** The set of active alerts lives in the agent's memory. After an agent restart, one whose condition still holds is raised again.
- **Single requests.** The last 200 requests of each application are kept in memory for `shipwick traffic --requests`. The access log itself stays in Docker's log files of the Caddy container.
- **Certificate status.** What the agent last saw of each hostname's certificate is in memory, so an agent that restarts forgets that it has warned about one, and warns again.

## Agent restarts and crashes

Running applications do not depend on the agent being up. Restarting or upgrading the agent does not restart any container. While the agent is down, applications keep serving, but nothing restarts a replica that crashes during that time.

At startup, before serving requests, the agent reconciles what it finds:

1. Deployments found mid-flight are resumed. Since 0.5 a deployment that is running when the agent stops — an upgrade of Shipwick restarts it — is no longer marked `FAILED`: the new agent goes on with it, as described below.
2. Job runs still marked `running` become `interrupted`, and their containers are removed with the other leftovers. A scheduled job runs again at its next firing; a firing that fell while the agent was down is not caught up.
3. Containers that belong to a known application but neither to its active deployment nor to one that resumes are removed, in the background.
4. Containers of applications the database does not know are never touched. If the database is lost, the agent must not tear down what is running.

**A resumed deployment** needs nothing written down beyond what a deployment records anyway. Where it was is its status, and what it had done is on the server: containers the agent had created are adopted instead of created again, replicas that were already serving keep serving, and only what was left to do is done. Its events say `Resumed after the agent restarted`, it gets a fresh deployment timeout, and `shipwick deploy` waits through the restart: it reports that the agent is not responding, and goes on when it is back. A crash is the same thing without the warning.

| Interrupted while | On resume |
|---|---|
| pulling the image | The pull is repeated. |
| the `pre_deploy` command ran | The deployment fails: the command is not run a second time, since whether a migration that was cut off can run again is for its author to say. Nothing of the running version has been touched. A command that had finished is not repeated either, and the deployment goes on. |
| starting replicas | Created containers are adopted and started, missing ones created. |
| health checking | The replica is adopted and checked again; its health budget starts over. |
| between two replicas | Replicas already serving keep serving; the rollout continues with the next. |
| healthy, before it became active | It becomes active. |
| rolling back | The rollback is finished: missing replicas of the previous version are created and verified, and what is left of the failed version is removed. |

What cannot be resumed fails as every interrupted deployment used to, `FAILED` with "agent restarted during deployment": a record the agent cannot have left, or a state that cannot be read back from Docker. See [Deployments](/docs/concepts/deployments).

Before any of that, opening the database proves the encryption key against every stored value. A key that does not match is caught at start, not at the first deployment, and the agent refuses to start with a message that says so. A [key rotation](/docs/security#key-rotation) that was interrupted is settled at the same moment: the agent tries which key opens the data, and finishes or discards the rotation accordingly.

After a server reboot, the agent brings every application back up according to its restart policy. An agent that starts while Docker does not answer stops, and the start that finds Docker answering resumes what was interrupted. What each kind of deployment does when the agent is killed under it, and what a full disk, a silent Docker daemon or a reboot do, is in [When things break](/docs/tasks/when-things-break).

On `SIGINT` or `SIGTERM` the agent shuts down in order: it ends log streams, stops accepting HTTP requests, stops the supervisor and interrupts in-flight deployments (each stays as it is, and is resumed at the next start), waits up to 30 seconds, then closes the Docker client and the database. A second signal kills the process immediately.

## Why one server

Shipwick is built for one server on purpose. A single machine runs the 1 to 20 applications of most products with room to spare; what it lacks is the platform around them: deployments without downtime, supervision, rollback, HTTPS, secrets, jobs, backups. Shipwick is that platform, and being for one server is where its guarantees come from: one lock per application, one way replicas come to exist, a proxy that is never reloaded during a rollout, a failed deployment that never takes down the version that works. There is one process to run and one SQLite file to back up.

Anything that runs with `docker run` runs on Shipwick. It schedules nothing across machines; when one server is no longer enough, you have outgrown it.

## What Shipwick does not do

Out of scope, and likely to stay there:

- Multi-node scheduling, service meshes, custom resources.
- Building images on the server. The `BUILDING` state of a deployment covers obtaining an image, not building one. `build: .` does not cross this line: the build runs on the developer's machine, and the agent only loads the result.
- Anything that requires an external database or queue.
- Registry credential helpers (`credsStore`). A helper is a program on the server that the agent would have to execute, and the agent executes nothing. Registries whose credentials expire, such as Amazon ECR and Google Artifact Registry, are served by piping the cloud CLI's token into `shipwick registry login`. See [Pull from private registries](/docs/tasks/private-registries#registries-with-tokens-that-expire).
- Failing over. A [second server can be kept ready](/docs/tasks/standby), holding a recent copy of everything the first one runs, deployed and stopped; a person decides when to start it, and the data is as old as the last export. Nothing watches the first server and nothing decides.

Not yet:

- Host mounts. `volumes` are named Docker volumes; a path on the host cannot be mounted.
- The DNS challenge with a provider other than Cloudflare. The proxy carries the Cloudflare DNS module and nothing else, so a wildcard hostname in a zone hosted elsewhere needs a [certificate of your own](/docs/tasks/certificates).
- Roles per application. A `deploy` token can be [limited to some applications](/docs/tasks/tokens#limit-a-token-to-some-applications), which narrows what it changes; it still reads everything, and that is not tenancy.

Shipwick is for one server. An installation that outgrows one server has outgrown Shipwick.
