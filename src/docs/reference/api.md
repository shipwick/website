---
title: REST API
description: Reference of the Shipwick agent's REST API, covering authentication, the response and error envelopes, every error code and endpoint, the asynchronous deployment pattern, log streaming, and the wire types.
---

# REST API

The agent serves a JSON REST API. `shipwick` and the dashboard are clients of it and have no private channel: anything they do can be done with `curl`. This page covers authentication, the envelopes, error codes, every endpoint, the asynchronous deployment pattern, log streaming, and the types.

## Basics

| | |
|---|---|
| Base path | `/api/v1` |
| Default address | `http://127.0.0.1:9000`, or `https://<SHIPWICK_AGENT_DOMAIN>` when served through Caddy |
| Format | JSON in responses. Request bodies are JSON, except for `deploy`, which takes the `deploy.yaml` document. |
| Timestamps | RFC 3339, UTC |

Every response carries `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. JSON responses have `Content-Type: application/json; charset=utf-8`.

The API speaks plain HTTP. See [Security](/docs/security) for how to expose it.

## Authentication

Every endpoint except `GET /api/v1/health` requires the API token as a bearer token:

```http
Authorization: Bearer <SHIPWICK_AGENT_TOKEN>
```

A missing or wrong token is answered with `401 UNAUTHORIZED` and the header `WWW-Authenticate: Bearer realm="shipwick"`.

The agent holds only the SHA-256 hash of the token. The presented token is hashed, and the two hashes are compared in constant time, so neither the token's content nor its length leaks through timing. There is one token per agent, and it grants everything. See [Agent configuration](/docs/reference/agent-configuration#api-token).

## Envelopes

Success:

```json
{ "data": … }
```

Failure. `details` is always an object, empty when there is nothing to add:

```json
{
  "error": {
    "code": "INVALID_CONFIG",
    "message": "invalid deploy.yaml",
    "details": {
      "fields": [
        { "field": "resources.memory", "message": "invalid value \"abc\"", "expected": "128mb, 512mb, 1gb, ..." }
      ]
    }
  }
}
```

Two responses have no envelope: `204 No Content` from `DELETE`, and the NDJSON stream of followed logs.

## Error codes

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed application name, deployment id or query parameter; the name in the document differs from the name in the URL; an invalid or oversized JSON body, or an unknown field in it; an invalid `image` in a redeploy request. |
| 400 | `INVALID_CONFIG` | `deploy.yaml` failed validation. `details.fields` lists every problem as `{field, message, expected}`; `expected` is omitted when there is nothing to suggest. Also returned, with the field `domain`, when the domain is already served by another application, by the agent or by the dashboard. |
| 401 | `UNAUTHORIZED` | Missing or wrong token. |
| 404 | `NOT_FOUND` | Unknown application or deployment. |
| 404 | `ENDPOINT_NOT_FOUND` | The agent has no such operation: an older agent, a typo in the path, or a method the path does not support. |
| 409 | `DEPLOYMENT_IN_PROGRESS` | Another operation holds this application. |
| 409 | `NOT_DEPLOYED` | The application has no active deployment to act on. |
| 409 | `NO_ROLLBACK_TARGET` | There is no earlier successful deployment; or the requested one is the active one, never succeeded, or belongs to another application. |
| 413 | `INVALID_REQUEST` | The body of a `deploy` request is larger than 64 KB. |
| 503 | `RUNTIME_UNAVAILABLE` | The agent is shutting down. |
| 500 | `INTERNAL_ERROR` | Anything else. `message` carries the cause: callers are authenticated operators, and the cause is more useful to them than an opaque message. Error messages never contain environment values. |

`DEPLOYMENT_IN_PROGRESS` is returned at once when another user operation holds the application. When the supervisor holds it, which it does for moments at a time, the request waits up to 30 seconds before giving the same answer.

## Endpoints

Paths are relative to `/api/v1`.

| Method | Path | |
|---|---|---|
| `GET` | [`/health`](#get-health) | Liveness. No token. |
| `GET` | [`/server`](#get-server) | Facts about the host, the agent and the proxy |
| `GET` | [`/applications`](#get-applications) | Summaries of all applications |
| `GET` | [`/applications/:name`](#get-applications-name) | One application in detail |
| `POST` | [`/applications/:name/deploy`](#post-applications-name-deploy) | Start a deployment from a `deploy.yaml` |
| `POST` | [`/applications/:name/redeploy`](#post-applications-name-redeploy) | Deploy the active configuration again |
| `POST` | [`/applications/:name/rollback`](#post-applications-name-rollback) | Deploy the configuration of an earlier successful deployment |
| `POST` | [`/applications/:name/stop`](#post-applications-name-stop) | Stop all replicas |
| `POST` | [`/applications/:name/start`](#post-applications-name-start) | Start a stopped application |
| `DELETE` | [`/applications/:name`](#delete-applications-name) | Remove containers and history |
| `GET` | [`/applications/:name/logs`](#get-applications-name-logs) | Last log lines, or a live stream |
| `GET` | [`/applications/:name/events`](#get-applications-name-events) | The application's event feed |
| `GET` | [`/applications/:name/metrics`](#get-applications-name-metrics) | Point-in-time CPU and memory |
| `GET` | [`/deployments`](#get-deployments) | Deployment history |
| `GET` | [`/deployments/:id`](#get-deployments-id) | One deployment with configuration and events |

In every path, `:name` must be a valid application name (lowercase letters, digits and dashes, at most 63 characters). Anything else is `400 INVALID_REQUEST` before the request reaches the engine. Every authenticated endpoint can also answer `401` and `500`; these are not repeated below.

### GET /health

Liveness, for load balancers and `shipwick server status`. The only unauthenticated endpoint. It reveals nothing beyond the version.

| Status | Body |
|---|---|
| `200` | [`Health`](#health) |

```json
{ "data": { "status": "ok", "version": "v0.1.0" } }
```

### GET /server

| Status | Body |
|---|---|
| `200` | [`Server`](#server) |

### GET /applications

| Status | Body |
|---|---|
| `200` | Array of [`Application`](#application) |

### GET /applications/:name

Status, the active configuration with environment values masked, the active deployment, and every container of the application.

| Status | Body |
|---|---|
| `200` | [`ApplicationDetail`](#applicationdetail) |
| `404 NOT_FOUND` | Unknown application |

### POST /applications/:name/deploy

Starts a deployment. The body **is** the `deploy.yaml` document. JSON is accepted as well. The maximum size is 64 KB. `name` in the document must equal `:name`. An application is created by its first deployment.

The agent expects a complete document. `${NAME}` placeholders are a convention of `shipwick`, which fills them in before sending; submitted here, they are stored literally.

```bash
curl -X POST http://localhost:9000/api/v1/applications/my-api/deploy \
  -H "Authorization: Bearer $SHIPWICK_AGENT_TOKEN" \
  --data-binary @deploy.yaml
```

| Status | Body |
|---|---|
| `202` | [`Deployment`](#deployment) with status `PENDING`, and a `Location` header. See [Asynchronous deployments](#asynchronous-deployments). |
| `400 INVALID_CONFIG` | Validation failed, or the domain is taken |
| `400 INVALID_REQUEST` | The document names another application than the URL; unreadable body |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |
| `413 INVALID_REQUEST` | Body larger than 64 KB |
| `503 RUNTIME_UNAVAILABLE` | The agent is shutting down |

### POST /applications/:name/redeploy

Deploys the active configuration again, optionally with another image. The body is optional:

```json
{ "image": "ghcr.io/company/my-api:1.5.0" }
```

| Field | Type | |
|---|---|---|
| `image` | string | Optional. Replaces the image of the active configuration. Must be a valid image reference. |

The body is limited to 4096 bytes. Unknown fields are rejected: a typo such as `"imgae"` must not quietly redeploy the old image.

| Status | Body |
|---|---|
| `202` | [`Deployment`](#deployment) with `kind: "redeploy"`, and a `Location` header |
| `400 INVALID_REQUEST` | Invalid JSON, unknown field, body too large, or invalid `image` |
| `400 INVALID_CONFIG` | The stored configuration's domain is now served by something else |
| `404 NOT_FOUND` | Unknown application |
| `409 NOT_DEPLOYED` | No active deployment |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |
| `503 RUNTIME_UNAVAILABLE` | The agent is shutting down |

### POST /applications/:name/rollback

Deploys the configuration of an earlier successful deployment. The body is optional:

```json
{ "deployment_id": 12 }
```

| Field | Type | |
|---|---|---|
| `deployment_id` | integer | Optional. The `id` (not the `sequence`) of the deployment to return to. It must belong to this application and have the status `SUPERSEDED`. Omitted or `0`: the most recent `SUPERSEDED` deployment. |

The body is limited to 4096 bytes. Unknown fields are rejected.

| Status | Body |
|---|---|
| `202` | [`Deployment`](#deployment) with `kind: "rollback"` and `source_deployment_id` set, and a `Location` header |
| `400 INVALID_REQUEST` | Invalid JSON, unknown field, body too large, or a negative `deployment_id` |
| `400 INVALID_CONFIG` | The stored configuration's domain is now served by something else |
| `404 NOT_FOUND` | Unknown application, or no deployment with that id |
| `409 NOT_DEPLOYED` | No active deployment |
| `409 NO_ROLLBACK_TARGET` | No earlier successful deployment; or the requested one is active, never succeeded, or belongs to another application |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |
| `503 RUNTIME_UNAVAILABLE` | The agent is shutting down |

```bash
curl -X POST …/applications/my-api/redeploy -d '{"image": "ghcr.io/company/my-api:1.5.0"}'
curl -X POST …/applications/my-api/rollback                      # most recent successful version
curl -X POST …/applications/my-api/rollback -d '{"deployment_id": 12}'
```

Redeploy and rollback answer exactly like `deploy` because both are deployments. They differ only in where the configuration comes from: the server's own record of an earlier deployment. That is also why they exist as endpoints at all. The API only ever returns configurations with environment values masked, so no client could re-submit one.

### POST /applications/:name/stop

Stops all replicas of the active deployment. The application stays stopped (`desired_state: "stopped"`) until it is started or deployed again. The route goes to a static `503` first, so the domain answers `503`, and the containers receive `SIGTERM` second, with `SIGKILL` after 10 seconds; their names on the services network go with them. The request returns when the replicas have stopped.

| Status | Body |
|---|---|
| `200` | [`ApplicationDetail`](#applicationdetail), as after the stop |
| `404 NOT_FOUND` | Unknown application |
| `409 NOT_DEPLOYED` | No active deployment |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |

### POST /applications/:name/start

Starts the replicas of a stopped application and clears their restart history.

| Status | Body |
|---|---|
| `200` | [`ApplicationDetail`](#applicationdetail), as after the start. Health is not known yet at that moment. |
| `404 NOT_FOUND` | Unknown application |
| `409 NOT_DEPLOYED` | No active deployment |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |
| `500 INTERNAL_ERROR` | A container no longer exists; the message says to deploy the application again |

### DELETE /applications/:name

Removes every container of the application, then the application itself **together with its deployment history** and events.

| Status | Body |
|---|---|
| `204` | None |
| `404 NOT_FOUND` | Unknown application |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |

### GET /applications/:name/logs

Logs of the replicas of the active deployment.

| Parameter | Default | |
|---|---|---|
| `tail` | `100` | Number of lines. 1 to 5000 without `follow`; 0 to 5000 with it. |
| `follow` | `false` | `true` answers with a live stream. See [Following logs](#following-logs). |

| Status | Body |
|---|---|
| `200` | Without `follow`: array of [`LogLine`](#logline), merged across replicas in chronological order. With `follow`: an NDJSON stream. |
| `400 INVALID_REQUEST` | Invalid `tail` or `follow` |
| `404 NOT_FOUND` | Unknown application |
| `409 NOT_DEPLOYED` | No active deployment |

Without `follow`, `tail=N` is the merged total: the last N lines across all replicas. With `follow=true` it applies per replica.

### GET /applications/:name/events

The application's own feed, newest first: crashes, restarts, health changes, recreated replicas, stops and starts. Only the newest 500 per application are kept.

| Parameter | Default | |
|---|---|---|
| `limit` | `50` | 1 to 500 |

| Status | Body |
|---|---|
| `200` | Array of [`Event`](#event) |
| `400 INVALID_REQUEST` | Invalid `limit` |
| `404 NOT_FOUND` | Unknown application |

```json
{ "id": 91, "deployment_id": null, "level": "warn", "type": "supervisor",
  "message": "Replica 2 exited with code 137; restarting in 2s", "created_at": "2026-03-01T10:00:00Z" }
```

Deployment events are not in this feed. They belong to their deployment and are returned by `GET /deployments/:id`.

### GET /applications/:name/metrics

A point-in-time sample of CPU and memory of the application and each replica of its active deployment.

| Status | Body |
|---|---|
| `200` | [`Metrics`](#metrics) |
| `404 NOT_FOUND` | Unknown application |
| `409 NOT_DEPLOYED` | No active deployment |

```json
{
  "data": {
    "application": "my-api", "collected_at": "2026-03-01T10:00:00Z",
    "cpu_percent": 42.1, "cpu_limit_percent": 400,
    "memory_bytes": 432013312, "memory_limit_bytes": 2147483648,
    "replicas": [
      { "replica": 1, "container": "shipwick_my-api_7_1",
        "cpu_percent": 21.0, "cpu_limit_percent": 200,
        "memory_bytes": 216006656, "memory_limit_bytes": 1073741824 }
    ]
  }
}
```

- **CPU is in percent of one core**, as in `docker stats`: a replica keeping two cores busy reads 200, and `cpu: 2` is a `cpu_limit_percent` of 200.
- **Memory is the working set**: usage minus the page cache the kernel would give back. It is what the limit is enforced against.
- Limits are `0` when unlimited. Application-level numbers are sums over the replicas.
- A replica that is not running reports zeros. It never fails the request.
- It is a point-in-time sample; build history by polling. The agent keeps the previous sample of each container, so polling every few seconds is answered instantly. A first request, or one after a pause of a minute, takes about a second: CPU usage is a rate, and Docker needs two readings for it.

See [Resource limits and metrics](/docs/concepts/resources).

### GET /deployments

Deployment history, newest first.

| Parameter | Default | |
|---|---|---|
| `application` | all applications | Limit the list to one application. Must be a valid application name. |
| `limit` | `50` | 1 to 500 |

| Status | Body |
|---|---|
| `200` | Array of [`Deployment`](#deployment) |
| `400 INVALID_REQUEST` | Invalid `application` or `limit` |
| `404 NOT_FOUND` | `application` names an unknown application |

### GET /deployments/:id

One deployment with its configuration (environment values masked) and its events. `:id` must be a positive integer.

| Status | Body |
|---|---|
| `200` | [`DeploymentDetail`](#deploymentdetail) |
| `400 INVALID_REQUEST` | `:id` is not a positive number |
| `404 NOT_FOUND` | Unknown deployment |

## Asynchronous deployments

`deploy`, `redeploy` and `rollback` answer `202 Accepted` as soon as the `PENDING` record exists, with `Location: /api/v1/deployments/7`:

```json
{
  "data": {
    "id": 7, "application": "my-api", "sequence": 3,
    "version": "1.4.2", "image": "ghcr.io/company/my-api:1.4.2",
    "status": "PENDING", "error": "",
    "started_at": "2026-03-01T10:00:00Z", "completed_at": null,
    "kind": "deploy", "source_deployment_id": null
  }
}
```

The deployment runs in the background. **Poll `GET /deployments/7` until `completed_at` is non-null**, then read `status` and `error`:

| Final `status` | Meaning |
|---|---|
| `ACTIVE` | The only success. |
| `FAILED` | The deployment failed and nothing of the previous version was lost. `error` says why. If an automatic rollback also failed, `error` holds both causes. |
| `ROLLED_BACK` | The deployment failed after part of the previous version had been replaced, and the previous version was restored. `error` says why the deployment failed. |

Do not stop at the first settled status:

- After `ACTIVE`, the engine may still be retiring the old version, and a new operation would get `409` until `completed_at` appears.
- `FAILED` may be followed by `ROLLBACK`, `RESTORING` and `ROLLED_BACK`.

`completed_at` is stamped after cleanup and after the application's lock is released. From that moment a new operation on the application is guaranteed not to be rejected as busy.

`shipwick` polls every 500 milliseconds. While a deployment is in flight, the application's `deploying` is `true` and `in_flight_deployment_id` names it, which lets a client follow a deployment that was started elsewhere.

### Deployment events

`events` in the deployment detail narrate progress. Entries with `type: "step"` are meant to be shown to users; entries with `type: "state"` carry the new status as their message:

```text
state  BUILDING
step   Pulled image ghcr.io/company/my-api:1.4.2
state  STARTING
step   Started 1 container
state  HEALTH_CHECKING
step   Replica 1 passed health checks        (or: "running and stable" without a health block)
step   Replica 1/2 is serving 1.4.2; its 1.4.1 predecessor is retired
step   Replica 2 passed health checks
step   Replica 2/2 is serving 1.4.2; its 1.4.1 predecessor is retired
state  HEALTHY
step   Routed https://api.example.com to 2 replicas   (only with a domain)
state  ACTIVE
step   Deployment successful
```

A `step` event with `level: "warn"` is a warning, for example when the image could not be pulled and a local copy was used, or when a domain is configured but no reverse proxy is.

On failure there is a `state` event `FAILED: <reason>` with `level: "error"` and, if a replica crashed or never became healthy, a `log` event holding its last 20 lines of output. A rollback adds the `state` events `ROLLBACK`, `RESTORING` and `ROLLED_BACK`, and steps narrating it. Deployment events never change afterwards.

## Following logs

`GET /applications/:name/logs?follow=true` answers with `Content-Type: application/x-ndjson`: one [`LogLine`](#logline) object per line, **without** the `data` envelope, flushed as lines arrive.

```json
{"replica":1,"container":"shipwick_my-api_7_1","stream":"stdout","time":"2026-03-01T10:00:00.12Z","message":"listening on :8080"}
{"replica":2,"container":"shipwick_my-api_7_2","stream":"stderr","time":"2026-03-01T10:00:00.31Z","message":"cache warm"}
```

- Each replica starts with its last `tail` lines, so two replicas and `tail=100` begin with up to 200 lines. `tail=0` means "only what is logged from now on" and is valid only when following.
- Lines of one replica arrive in order. Replicas interleave as output arrives.
- Problems found before streaming starts (unknown application, nothing deployed, bad parameters) are regular JSON errors with a non-200 status.
- The stream ends when the client disconnects, when the agent shuts down, or when every followed container is gone, which is what a new deployment does. Reconnect to follow the new containers.

When the API is served through Caddy at `SHIPWICK_AGENT_DOMAIN`, the route is configured without response buffering, so lines still arrive one by one.

## Types

All types are defined in [`pkg/api/types.go`](https://github.com/shipwick/shipwick/blob/main/pkg/api/types.go).

### Health

| Field | Type | |
|---|---|---|
| `status` | string | `ok` |
| `version` | string | The agent's version |

### Server

| Field | Type | |
|---|---|---|
| `agent_version` | string | |
| `hostname` | string | |
| `os` | string | Operating system, as Docker reports it |
| `kernel` | string | |
| `architecture` | string | |
| `docker_version` | string | |
| `cpus` | integer | |
| `memory_bytes` | integer | Memory of the host |
| `applications` | integer | Number of applications |
| `containers` | integer | Running Shipwick-managed containers |
| `proxy` | object | `enabled`: a proxy is configured; `false` means domains are not served. `reachable`: the last configuration sync succeeded. `error`: why it did not. `routes`: hostnames being served. |

### Application

| Field | Type | |
|---|---|---|
| `name` | string | |
| `status` | string | See [Application status](#application-status) |
| `desired_state` | string | `running` or `stopped` |
| `image`, `version`, `domain` | string | Of the active deployment. Empty until the first deployment succeeds. |
| `replicas` | object | `{desired, running, healthy}` |
| `deploying` | boolean | A deployment is in flight |
| `in_flight_deployment_id` | integer or null | The deployment to follow while `deploying` is true |
| `created_at`, `updated_at` | timestamp | |

A replica is **healthy** when it runs and is not failing its health check. Without a `health` block, `healthy` equals `running`. During a rollout the numbers describe the replicas that are serving right now, a mix of the old and the new version, and `desired` is the capacity the rollout maintains: the smaller of the two replica counts.

### ApplicationDetail

All fields of [`Application`](#application), plus:

| Field | Type | |
|---|---|---|
| `spec` | [`Spec`](#spec) or null | The active configuration, environment values masked |
| `active_deployment` | [`Deployment`](#deployment) or null | |
| `containers` | array of [`Container`](#container) | Every container of the application, of both versions during a rollout |

### Container

| Field | Type | |
|---|---|---|
| `id` | string | Docker container id |
| `name` | string | `shipwick_<app>_<deployment sequence>_<replica>` |
| `deployment_id` | integer | The deployment the container belongs to |
| `replica` | integer | Replica number, from 1 |
| `image` | string | |
| `state` | string | Docker state: `created`, `running`, `exited`, and so on |
| `exit_code` | integer | |
| `oom_killed` | boolean | Killed for exceeding its memory limit |
| `ip` | string | Address on the application network. Empty unless running. |
| `started_at` | timestamp or null | |
| `health` | string | `""` no health check configured; `unknown` not probed yet, for example right after an agent restart (counts as healthy); `starting` started or restarted, within its startup budget; `healthy`; `unhealthy` |
| `restarts` | integer | Restarts performed by the supervisor over the container's lifetime |
| `crash_loop` | boolean | Restarts of this replica are currently rate-limited |

### Deployment

| Field | Type | |
|---|---|---|
| `id` | integer | Unique on the server |
| `application` | string | |
| `sequence` | integer | Per-application counter: #1, #2, and so on |
| `version` | string | Derived from the image reference |
| `image` | string | |
| `status` | string | `PENDING`, `BUILDING`, `STARTING`, `HEALTH_CHECKING`, `HEALTHY`, `ACTIVE`, `SUPERSEDED`, `FAILED`, `ROLLBACK`, `RESTORING`, `ROLLED_BACK`. See [Deployments](/docs/concepts/deployments#states). |
| `error` | string | Empty unless the deployment failed |
| `started_at` | timestamp | |
| `completed_at` | timestamp or null | Set when the agent is done with the deployment |
| `kind` | string | `deploy`, `redeploy` or `rollback` |
| `source_deployment_id` | integer or null | For a redeploy or rollback, the deployment whose configuration it re-used |

### DeploymentDetail

All fields of [`Deployment`](#deployment), plus:

| Field | Type | |
|---|---|---|
| `spec` | [`Spec`](#spec) | The deployment's configuration, environment values masked |
| `events` | array of [`Event`](#event) | |

### Spec

The JSON form of a validated `deploy.yaml`, with defaults applied. It is what the agent stores with each deployment.

| Field | Type | |
|---|---|---|
| `name`, `image` | string | |
| `port` | integer | Omitted when not set |
| `domain` | string | Omitted when not set |
| `replicas` | integer | |
| `env` | object | Omitted when empty. Names are kept; every value is `"********"`. |
| `health` | object | Omitted without a health check. `{path, interval, timeout, retries}`; durations are strings such as `"10s"`. |
| `resources` | object | `{cpu, memory_bytes}`. A field is omitted when unlimited. Memory is in bytes. |
| `restart` | object | `{policy}` |
| `deploy` | object | `{strategy}` |

### Event

| Field | Type | |
|---|---|---|
| `id` | integer | Increasing. Clients use it to tell new events from ones already seen. |
| `deployment_id` | integer or null | Null for application events |
| `level` | string | `info`, `warn` or `error` |
| `type` | string | Deployment events: `step`, `state`, `log`. Application events: `supervisor`, `app` (stop and start). |
| `message` | string | |
| `created_at` | timestamp | |

### LogLine

| Field | Type | |
|---|---|---|
| `replica` | integer | |
| `container` | string | Container name |
| `stream` | string | `stdout` or `stderr` |
| `time` | timestamp | |
| `message` | string | |

### Metrics

| Field | Type | |
|---|---|---|
| `application` | string | |
| `collected_at` | timestamp | |
| `cpu_percent` | number | Percent of one core: two busy cores read 200. Sum over replicas. |
| `cpu_limit_percent` | number | Same unit. `0` means unlimited. |
| `memory_bytes` | integer | Working set. Sum over replicas. |
| `memory_limit_bytes` | integer | `0` means unlimited |
| `replicas` | array | One object per replica: `replica`, `container`, `cpu_percent`, `cpu_limit_percent`, `memory_bytes`, `memory_limit_bytes` |

## Application status

| `status` | Meaning |
|---|---|
| `HEALTHY` | All desired replicas of the active deployment are healthy |
| `DEGRADED` | Some are |
| `DOWN` | None are: not running, or running but failing their health check |
| `CRASH_LOOP` | A replica keeps dying or never turns healthy; its restarts are now rate-limited to one every 5 minutes. Outranks `DEGRADED` and `DOWN`: it says restarting is not helping. |
| `STOPPED` | Stopped on request (`desired_state: "stopped"`) |
| `DEPLOYING` | First deployment in flight, nothing active yet |
| `FAILED` | No deployment has ever succeeded |

`deploying: true` is set whenever a deployment is in flight. An application can be `HEALTHY`, with the old version serving, and `deploying` at once.
