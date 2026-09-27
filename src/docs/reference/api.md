---
title: REST API
description: Reference of the Shipwick agent's REST API, covering authentication and roles, the response and error envelopes, every error code and endpoint, the asynchronous deployment pattern, log streaming, volume archives, jobs and runs, and the wire types.
---

# REST API

The agent serves a JSON REST API. `shipwick` and the dashboard are clients of it and have no private channel: anything they do can be done with `curl`. This page covers authentication and roles, the envelopes, error codes, every endpoint, the asynchronous deployment pattern, log streaming, and the types.

## Basics

| | |
|---|---|
| Base path | `/api/v1` |
| Default address | `http://127.0.0.1:9000`, or `https://<SHIPWICK_AGENT_DOMAIN>` when served through Caddy |
| Format | JSON in responses. Request bodies are JSON, except for `deploy`, which takes the `deploy.yaml` document, and the volume restore, the static upload and the image upload, which take a tar archive. |
| Timestamps | RFC 3339, UTC |

Every response carries `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. JSON responses have `Content-Type: application/json; charset=utf-8`.

The API speaks plain HTTP. See [Security](/docs/security) for how to expose it.

## Authentication

Every endpoint except `GET /api/v1/health` requires an API token as a bearer token:

```http
Authorization: Bearer <token>
```

A missing, wrong or revoked token is answered with `401 UNAUTHORIZED` and the header `WWW-Authenticate: Bearer realm="shipwick"`.

Guessing is slowed down. After 20 failed authentications within a minute from one client address, its further wrong tokens are answered `429 RATE_LIMITED` for the next minute, with a `Retry-After` header in seconds. A valid token is never refused: behind the proxy every client shares one address, and a guesser must not be able to lock anyone else out. Only failures count, so a mistyped token does not reach the limit, and `GET /health` is not limited.

A token has a **role**, and every endpoint requires one. A role includes the ones below it:

| Role | May |
|---|---|
| `read` | See everything: `GET /server`, `/applications…`, `/deployments…`, logs, events, metrics, volumes, jobs and runs, the names of the secrets, the volumes on the server |
| `deploy` | And change what runs: `deploy`, `redeploy`, `rollback`, `stop`, `start`, run a job or a one-off command, upload an image or a static folder |
| `admin` | And everything else: `DELETE /applications/:name`, the volume archives, removing a volume, the `/tokens` endpoints, setting and removing `/secrets` |

There are two kinds of token. The **root token** is the one the agent is configured with: `SHIPWICK_AGENT_TOKEN`, or the one generated on first start. It has the `admin` role and the name `root`, is not stored in the database and cannot be revoked through the API. Every other token is created with [`POST /tokens`](#post-tokens), named, given a role, and shown exactly once.

The agent holds only the SHA-256 hash of each token. The presented token is hashed, the root token's hash is compared in constant time, and a stored token is found by its hash and compared in constant time as well, so neither a token's content nor its length leaks through timing. Each use of a stored token is recorded, to the minute, as its `last_used_at`.

A valid token whose role does not cover the endpoint is `403 FORBIDDEN`, and `details` says which role it has and which the endpoint wants:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "this token has the read role; deploying needs deploy or admin",
    "details": { "role": "read", "required": "deploy" }
  }
}
```

For an endpoint that needs `admin`, the message ends in `this needs admin`. `GET /server` tells a client who it is: `"token": {"name": "ci", "role": "deploy"}`. See [Agent configuration](/docs/reference/agent-configuration#api-token) and [Create tokens for CI and teammates](/docs/tasks/tokens).

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

Three kinds of response have no envelope: `204 No Content` from `DELETE`, from the volume restore and from setting a secret, the NDJSON stream of followed logs, and the volume archive, which is the body of `GET` and `PUT …/archive` both ways.

## Error codes

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed application name, volume name, job name, deployment or run id, or query parameter; the name in the document differs from the name in the URL; an invalid or oversized JSON body (the limit is 4096 bytes), or an unknown field in it; an invalid `image` in a redeploy or rollback request; a missing or invalid `command` in a run request, or a `name` or `role` in a token request; a restore body that is not `Content-Type: application/x-tar` or does not start with a tar header; an image archive that is not sent as `application/x-tar`, or that does not carry exactly one image tagged `shipwick.local/<name>:<tag>`; a `deploy.yaml` with `build` but no `image`, or a redeploy of such an application with an image from elsewhere; a static upload that is not `application/x-tar`, holds no files, or holds anything but files and directories; a static `deploy` without `?static=`, or `?static=` on a container application; a secret's name or value that breaks the rules, or a 501st secret; a volume name that is not `shipwick_<application>_<volume>`; revoking `root`. |
| 400 | `INVALID_CONFIG` | `deploy.yaml` failed validation. `details.fields` lists every problem as `{field, message, expected}`; `expected` is omitted when there is nothing to suggest. Also returned when a hostname is already served by another application (as its domain, an alias or a redirect), by the agent or by the dashboard: one entry whose `field` names the offending line, `domain`, `aliases[0]`, `redirects[1]`, and whose `message` names the owner. And with the field `publish[i].host` when a server port the configuration publishes is already published by another application, or is one the agent or the proxy listens on. Returned by `redeploy` and `rollback` too, since a stored configuration's hostnames and ports may have been taken since. Also when an `env` value refers to a `${NAME}` that is not among the stored [secrets](#secrets): one entry per reference, `field` `env.<VARIABLE>`, `expected` the command that stores it. |
| 401 | `UNAUTHORIZED` | Missing, wrong or revoked token. |
| 403 | `FORBIDDEN` | The token's role does not cover this endpoint. `details` is `{role, required}`. |
| 404 | `NOT_FOUND` | Unknown application, deployment, volume, job, run, token or secret, including a rollback's `deployment_id` that does not exist; a `deploy` whose `?static=` digest names no upload the agent has. |
| 404 | `ENDPOINT_NOT_FOUND` | The agent has no such operation: an older agent, a typo in the path, or a method the path does not support. There is no `405`. Answered without checking the token. |
| 409 | `DEPLOYMENT_IN_PROGRESS` | Another operation holds this application. |
| 409 | `NOT_DEPLOYED` | The application has no active deployment to act on. |
| 409 | `NO_ROLLBACK_TARGET` | There is no earlier successful deployment; or the requested one is the active one, never succeeded, or belongs to another application. |
| 409 | `TOKEN_EXISTS` | A token with that name exists. |
| 409 | `APPLICATION_RUNNING` | A volume restore was asked of an application that is not stopped. |
| 409 | `JOB_ALREADY_RUNNING` | A run of this job has not finished yet; a job runs one at a time. |
| 409 | `STATIC_APPLICATION` | Logs, metrics, jobs or a one-off command were asked of an application the proxy serves from a folder; it has no containers. |
| 409 | `VOLUME_IN_USE` | The volume belongs to an application that still exists; `details: {application}`. Delete the application first, or replace the data with a restore. |
| 429 | `RATE_LIMITED` | A wrong token, after 20 authentications from this address failed within a minute; `Retry-After` says in how many seconds wrong tokens are answered `401` again. A valid token is never refused. |
| 413 | `INVALID_REQUEST` | The body of a `deploy` request is larger than 64 KB; a volume archive is larger than 10 GB; an image archive is larger than 4 GB; a static folder is larger than 512 MB. |
| 503 | `RUNTIME_UNAVAILABLE` | The agent is shutting down. |
| 500 | `INTERNAL_ERROR` | Anything else. `message` carries the cause: callers are authenticated operators, and the cause is more useful to them than an opaque message. Error messages never contain environment values. |

`DEPLOYMENT_IN_PROGRESS` is returned at once when another user operation holds the application. When the supervisor holds it, which it does for moments at a time, the request waits up to 30 seconds before giving the same answer.

## Endpoints

Paths are relative to `/api/v1`. The role is the least a token needs.

| Method | Path | Role | |
|---|---|---|---|
| `GET` | [`/health`](#get-health) | none | Liveness. No token. |
| `GET` | [`/server`](#get-server) | `read` | Facts about the host, the agent, the proxy and notifications, and the caller's own token |
| `GET` | [`/applications`](#get-applications) | `read` | Summaries of all applications |
| `GET` | [`/applications/:name`](#get-applications-name) | `read` | One application in detail |
| `POST` | [`/applications/:name/deploy`](#post-applications-name-deploy) | `deploy` | Start a deployment from a `deploy.yaml`; `?static=<digest>` for a static application |
| `POST` | [`/applications/:name/images`](#post-applications-name-images) | `deploy` | Load an image archive built by the client |
| `PUT` | [`/applications/:name/static`](#put-applications-name-static) | `deploy` | Upload the folder of a static application |
| `POST` | [`/applications/:name/redeploy`](#post-applications-name-redeploy) | `deploy` | Deploy the active configuration again |
| `POST` | [`/applications/:name/rollback`](#post-applications-name-rollback) | `deploy` | Deploy the configuration of an earlier successful deployment |
| `POST` | [`/applications/:name/stop`](#post-applications-name-stop) | `deploy` | Stop all replicas |
| `POST` | [`/applications/:name/start`](#post-applications-name-start) | `deploy` | Start a stopped application |
| `DELETE` | [`/applications/:name`](#delete-applications-name) | `admin` | Remove containers and history |
| `GET` | [`/applications/:name/logs`](#get-applications-name-logs) | `read` | Last log lines, or a live stream |
| `GET` | [`/applications/:name/events`](#get-applications-name-events) | `read` | The application's event feed |
| `GET` | [`/applications/:name/metrics`](#get-applications-name-metrics) | `read` | Point-in-time CPU and memory |
| `GET` | [`/applications/:name/metrics/history`](#get-applications-name-metrics-history) | `read` | CPU and memory of each replica over the last hour, day or week |
| `GET` | [`/applications/:name/volumes`](#get-applications-name-volumes) | `read` | The volumes of the active deployment |
| `GET` | [`/applications/:name/volumes/:volume/archive`](#get-applications-name-volumes-volume-archive) | `admin` | The volume's contents as a tar archive |
| `PUT` | [`/applications/:name/volumes/:volume/archive`](#put-applications-name-volumes-volume-archive) | `admin` | Replace the volume's contents with a tar archive |
| `GET` | [`/applications/:name/jobs`](#get-applications-name-jobs) | `read` | The scheduled jobs of the active deployment, with their last and next run |
| `GET` | [`/applications/:name/runs`](#get-applications-name-runs) | `read` | Runs of jobs, hooks and one-off commands, without output |
| `GET` | [`/applications/:name/runs/:id`](#get-applications-name-runs-id) | `read` | One run with its output |
| `POST` | [`/applications/:name/jobs/:job/run`](#post-applications-name-jobs-job-run) | `deploy` | Start a scheduled job now |
| `POST` | [`/applications/:name/run`](#post-applications-name-run) | `deploy` | Run a one-off command |
| `GET` | [`/deployments`](#get-deployments) | `read` | Deployment history |
| `GET` | [`/deployments/:id`](#get-deployments-id) | `read` | One deployment with configuration and events |
| `GET` | [`/tokens`](#get-tokens) | `admin` | The stored tokens, without their values |
| `POST` | [`/tokens`](#post-tokens) | `admin` | Create a token; the value is in this response and nowhere else |
| `DELETE` | [`/tokens/:name`](#delete-tokens-name) | `admin` | Revoke a token |
| `GET` | [`/secrets`](#get-secrets) | `read` | The secrets stored on the server, names and dates only |
| `PUT` | [`/secrets/:name`](#put-secrets-name) | `admin` | Store a secret, creating or replacing it |
| `DELETE` | [`/secrets/:name`](#delete-secrets-name) | `admin` | Remove a secret |
| `GET` | [`/volumes`](#get-volumes) | `read` | Every volume Shipwick created, with its application and size |
| `DELETE` | [`/volumes/:name`](#delete-volumes-name) | `admin` | Remove a volume whose application was deleted |

In every path, `:name` of an application must be a valid application name (lowercase letters, digits and dashes, at most 63 characters), and `:volume` follows the same rule. Anything else is `400 INVALID_REQUEST` before the request reaches the engine. Every authenticated endpoint can also answer `401`, `403`, `429` and `500`; these are not repeated below.

### GET /health

Liveness, for load balancers and `shipwick server status`. The only unauthenticated endpoint. It reveals nothing beyond the version.

| Status | Body |
|---|---|
| `200` | [`Health`](#health) |

```json
{ "data": { "status": "ok", "version": "v0.4.0" } }
```

### GET /server

| Status | Body |
|---|---|
| `200` | [`Server`](#server) |

```json
{
  "data": {
    "agent_version": "v0.4.0", "hostname": "vps-1",
    "os": "linux", "kernel": "6.8.0", "architecture": "amd64", "docker_version": "29.8.0",
    "cpus": 4, "memory_bytes": 8589934592, "applications": 3, "containers": 5,
    "proxy": { "enabled": true, "reachable": true, "error": "", "routes": 4 },
    "token": { "name": "ci", "role": "deploy" },
    "notifications": { "webhook": true }
  }
}
```

`token` is the token this request was made with, so that a client knows what it may do before it tries. `notifications.webhook` says whether `SHIPWICK_WEBHOOK_URL` is set on the agent. `architecture` is what a client building an image for this server passes to `docker build --platform`; see [Images built by the client](#post-applications-name-images).

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

`${NAME}` placeholders in `env` values are filled in by the agent from the [secrets](#get-secrets) stored on the server, before the deployment is recorded; the record holds the values, so a later change of a secret does not reach a redeploy or rollback of it. `$${NAME}` there is a literal `${NAME}`. A placeholder anywhere else is a convention of `shipwick`, which fills it in before sending, and is stored literally here.

```bash
curl -X POST http://localhost:9000/api/v1/applications/my-api/deploy \
  -H "Authorization: Bearer $SHIPWICK_AGENT_TOKEN" \
  --data-binary @deploy.yaml
```

| Parameter | |
|---|---|
| `static` | For a static application only: the `digest` of a folder uploaded with [`PUT …/static`](#put-applications-name-static). Required with `static` in the document, refused without it. |

| Status | Body |
|---|---|
| `202` | [`Deployment`](#deployment) with status `PENDING`, and a `Location` header. See [Asynchronous deployments](#asynchronous-deployments). |
| `400 INVALID_CONFIG` | Validation failed; a hostname or a published port is taken; an `env` value refers to a `${NAME}` that is not stored |
| `400 INVALID_REQUEST` | The document names another application than the URL; unreadable body; a `build` document without an `image` (the client builds and [loads](#post-applications-name-images) the image first, then names it here); a `static` document without `?static=`, or `?static=` on a container application |
| `404 NOT_FOUND` | `?static=` names no upload the agent has |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |
| `413 INVALID_REQUEST` | Body larger than 64 KB |
| `503 RUNTIME_UNAVAILABLE` | The agent is shutting down |

### POST /applications/:name/images

Loads an image archive for an application whose `deploy.yaml` has `build:`. The image is built where `shipwick deploy` runs and sent here; the agent never builds. The CLI does three things, and any client may do the same:

1. `docker build --platform <the server's> -t shipwick.local/<name>:<tag> …`, where `<tag>` is `<UTC yyyymmdd-hhmmss>-<4 hex>` and the platform follows `architecture` from [`GET /server`](#get-server).
2. `POST /applications/:name/images` with the output of `docker save` as the body, `Content-Type: application/x-tar`, chunked or with a `Content-Length`.
3. [`POST /applications/:name/deploy`](#post-applications-name-deploy) with `image` set to the reference the answer named.

```bash
docker save shipwick.local/my-api:20260927-153000-a1b2 \
  | curl -X POST -H "Authorization: Bearer $SHIPWICK_AGENT_TOKEN" -H "Content-Type: application/x-tar" \
      --data-binary @- http://localhost:9000/api/v1/applications/my-api/images
```

| Status | Body |
|---|---|
| `201` | [`LoadedImage`](#loadedimage): the reference that was loaded, and its size |
| `400 INVALID_REQUEST` | The body is not `Content-Type: application/x-tar`; the archive does not carry exactly one image tagged `shipwick.local/<name>:<tag>` for this application. What was loaded is removed again. |
| `413 INVALID_REQUEST` | The archive is larger than 4 GB |

```json
{ "data": { "image": "shipwick.local/my-api:20260927-153000-a1b2", "size_bytes": 68800000 } }
```

Loading takes no application lock. `shipwick.local` is a host that does not exist: the agent never pulls such an image, and a deployment whose local image is not on the server — pruned, or a rollback to a version this server was never sent — fails with `… is not on this server; it was built on a developer's machine — run shipwick deploy from the project again`. Local images are pruned like any other: the one running and the rollback target stay. A redeploy of such an application with an `image` from elsewhere is `400 INVALID_REQUEST`; without one, it keeps the image it has. The deployment's event reads `Using image shipwick.local/my-api:…, sent from a developer's machine` in place of `Pulled image …`.

### PUT /applications/:name/static

Uploads the folder of a static application (`static: dist/` in `deploy.yaml`): a folder the proxy serves itself, for which the agent creates no container. Deploying one is two requests: this upload, then [`POST …/deploy?static=<digest>`](#post-applications-name-deploy).

The body is the folder as a tar archive with `Content-Type: application/x-tar`, up to 512 MB: files and directories only, paths relative to the folder, nothing outside it. A symbolic link is refused, since the proxy's file server would follow it. The agent keeps the archive under its digest, one per application; a new upload replaces the last.

```bash
tar -C dist -cf - . | curl -X PUT -H "Authorization: Bearer $SHIPWICK_AGENT_TOKEN" \
  -H "Content-Type: application/x-tar" --data-binary @- \
  http://localhost:9000/api/v1/applications/web/static
curl -X POST -H "Authorization: Bearer $SHIPWICK_AGENT_TOKEN" --data-binary @deploy.yaml \
  "http://localhost:9000/api/v1/applications/web/deploy?static=sha256:3f2a…"
```

| Status | Body |
|---|---|
| `200` | [`StaticUpload`](#staticupload): the digest, the files' sizes added up, and their count |
| `400 INVALID_REQUEST` | The body is not `Content-Type: application/x-tar`; the archive holds no files, or holds anything but files and directories |
| `413 INVALID_REQUEST` | The folder is larger than 512 MB |

```json
{ "data": { "digest": "sha256:3f2a…", "size_bytes": 3250000, "files": 42 } }
```

The deployment then answers like any other. Its `Deployment` has no `image`; its `version` is the digest's first twelve hex characters, and it carries `static: {digest, size_bytes, files}`. Its events read `Received 42 files (3.1 MB)`, `Copied 42 files into the proxy`, `Found index.html`, `Routed https://example.com to the uploaded files`. A folder without an `index.html` fails the deployment: `FAILED: the folder has no index.html…`. Redeploy and rollback need no upload: the proxy keeps the folder of the serving version and of the one before it, and both re-route to a kept folder. A rollback to a version whose folder is gone fails with `the files of <version> are no longer on the server: deploy the folder again`.

In the application views `static` is `true` and `replicas` is all zeros; the status is `HEALTHY` while the deployment is active and `STOPPED` after `stop`, which makes the domain answer `503` until `start`. Logs, metrics, the metrics history, jobs and `run` answer `409 STATIC_APPLICATION`; `volumes` is an empty list.

### POST /applications/:name/redeploy

Deploys the active configuration again, optionally with another image. The body is optional:

```json
{ "image": "ghcr.io/company/my-api:1.5.0" }
```

| Field | Type | |
|---|---|---|
| `image` | string | Optional. Replaces the image of the active configuration. Must be a valid image reference. For an application with `build:`, only an image under `shipwick.local/<name>` is accepted; without one, the image it has is kept. |

The body is limited to 4096 bytes. Unknown fields are rejected: a typo such as `"imgae"` must not quietly redeploy the old image. A static application re-uses the folder the proxy serves.

| Status | Body |
|---|---|
| `202` | [`Deployment`](#deployment) with `kind: "redeploy"`, and a `Location` header |
| `400 INVALID_REQUEST` | Invalid JSON, unknown field, body too large, or invalid `image`; an image from elsewhere for an application with `build:` |
| `400 INVALID_CONFIG` | A hostname or a published port of the stored configuration is now held by something else |
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
| `400 INVALID_CONFIG` | A hostname or a published port of the stored configuration is now held by something else |
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

Stops all replicas of the active deployment. The application stays stopped (`desired_state: "stopped"`) until it is started or deployed again. The route goes to a static `503` first, so the domain and its aliases answer `503` while redirects keep working, and the containers receive `SIGTERM` second, with `SIGKILL` after 10 seconds; their names on the services network go with them. Scheduled jobs do not run while the application is stopped. The request returns when the replicas have stopped.

| Status | Body |
|---|---|
| `200` | [`ApplicationDetail`](#applicationdetail), as after the stop |
| `404 NOT_FOUND` | Unknown application |
| `409 NOT_DEPLOYED` | No active deployment |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |

The application event reads `Application stopped`, or `Application stopped by ci` when the token was not the root token.

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

Removes every container of the application, then the application itself **together with its deployment history** and events. Volumes are kept.

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
| `409 STATIC_APPLICATION` | The proxy serves this application from a folder; it has no containers and no logs. The metrics, the metrics history, the jobs and `run` answer the same. |

Without `follow`, `tail=N` is the merged total: the last N lines across all replicas. With `follow=true` it applies per replica.

### GET /applications/:name/events

The application's own feed, newest first: crashes, restarts, health changes, recreated replicas, stops and starts, restored volumes, and scheduled jobs or one-off commands that failed or timed out. Only the newest 500 per application are kept.

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

`type` is `supervisor`, `app` (stops, starts and restored volumes: `Application stopped by ci`, `Volume data restored from a backup (12.5 MB)`) or `job` (a run that went wrong, with `level: "warn"`: `Job nightly-report failed (exit 1)`, `Job nightly-report timed out after 1h`, `Command pg_dump failed (exit 1)`). A run that succeeds records nothing.

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
- It is a point-in-time sample; the record over time is [the history](#get-applications-name-metrics-history). The agent keeps the previous sample of each container, so polling every few seconds is answered instantly. A first request, or one after a pause of a minute, takes about a second: CPU usage is a rate, and Docker needs two readings for it.

See [Resource limits and metrics](/docs/concepts/resources).

### GET /applications/:name/metrics/history

The sampled CPU and memory of each replica over a window, aggregated into steps.

| Parameter | Default | |
|---|---|---|
| `since` | `1h` | `1h`, `24h` or `7d`. Anything else is `400 INVALID_REQUEST`: `since must be 1h, 24h or 7d`. |

| Status | Body |
|---|---|
| `200` | [`MetricsHistory`](#metricshistory) |
| `400 INVALID_REQUEST` | Invalid `since` |
| `404 NOT_FOUND` | Unknown application |
| `409 NOT_DEPLOYED` | No active deployment |

```json
{
  "data": {
    "application": "my-api", "since": "2026-03-01T09:00:00Z", "step": "30s",
    "series": [
      { "replica": 1, "points": [
          { "at": "2026-03-01T09:00:00Z", "cpu_percent": 12.5, "memory_bytes": 216006656 },
          { "at": "2026-03-01T09:00:30Z", "cpu_percent": 14.0, "memory_bytes": 216268800 }
      ] },
      { "replica": 2, "points": [ … ] }
    ],
    "limits": { "cpu": 1, "memory_bytes": 1073741824 }
  }
}
```

- The agent picks the `step` for the window: `30s` for `1h`, `5m` for `24h`, `1h` for `7d`, so a series is at most a few hundred points.
- The agent samples every running replica every 30 seconds and keeps seven days. Each point aggregates the samples of one step: `cpu_percent` is their average, `memory_bytes` their peak. A step in which a replica has no sample, because it was not running or the agent was down, has no point: the series are sparse, not zero-filled. `at` is the start of the step, `since` the start of the window.
- `limits` are the active deployment's per-replica limits as written in `deploy.yaml`: `cpu` in cores, `memory_bytes` in bytes, `0` when unlimited. A limit line for a CPU chart is `cpu × 100`.
- Units are those of [`Metrics`](#metrics). An application that was just deployed answers with empty series until the first minute has passed.

### GET /applications/:name/volumes

The volumes of the active deployment, as it mounts them.

| Status | Body |
|---|---|
| `200` | Array of [`Volume`](#volume); empty when the configuration has no `volumes` |
| `404 NOT_FOUND` | Unknown application |
| `409 NOT_DEPLOYED` | No active deployment |

```json
{ "data": [ { "name": "data", "path": "/var/lib/postgresql/data" } ] }
```

### GET /applications/:name/volumes/:volume/archive

The volume's contents as a tar archive. The body **is** the archive, without the `data` envelope.

| Status | Body |
|---|---|
| `200` | The archive, `Content-Type: application/x-tar`, with `Content-Disposition: attachment; filename="<app>-<volume>-<UTC yyyymmdd-hhmmss>.tar"` |
| `400 INVALID_REQUEST` | Invalid volume name |
| `404 NOT_FOUND` | Unknown application, or the active deployment mounts no volume by that name |
| `409 NOT_DEPLOYED` | No active deployment |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |

```bash
curl -H "Authorization: Bearer $SHIPWICK_AGENT_TOKEN" -OJ \
  http://localhost:9000/api/v1/applications/postgres/volumes/data/archive
```

- The archive is streamed as it is read from the replica's container, running or stopped; the copy of a database that is being written to is not guaranteed consistent. The entries are the volume's contents relative to its mount point (`base/…`, not `data/base/…`).
- The application is locked while the archive streams, so a deployment asked for meanwhile is `409 DEPLOYMENT_IN_PROGRESS`.
- Problems found before the first byte (unknown application or volume, busy) are regular JSON errors. After that, a cut connection is the only signal left. A write that stalls for 60 seconds ends the response.

### PUT /applications/:name/volumes/:volume/archive

Replaces the volume's contents with the tar archive in the body. The application must be stopped.

```bash
curl -X PUT -H "Authorization: Bearer $SHIPWICK_AGENT_TOKEN" -H "Content-Type: application/x-tar" \
  --data-binary @postgres-data-20260927-153000.tar \
  http://localhost:9000/api/v1/applications/postgres/volumes/data/archive
```

| Status | Body |
|---|---|
| `204` | None. The application event `Volume data restored from a backup (12.5 MB)` is recorded. |
| `400 INVALID_REQUEST` | Invalid volume name; the body is not `Content-Type: application/x-tar`; the body does not start with a tar header |
| `404 NOT_FOUND` | Unknown application, or the active deployment mounts no volume by that name |
| `409 NOT_DEPLOYED` | No active deployment |
| `409 APPLICATION_RUNNING` | The application is not stopped, or a replica's container is still running |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |
| `413 INVALID_REQUEST` | The archive is larger than 10 GB. Refused before anything is touched when the request says its `Content-Length`; a chunked upload that grows past the limit fails mid-restore. |

- The body is checked for a tar header before anything is removed. Then the replica container is removed, the volume with it, and both are created again before the archive is extracted into the mount point: what the archive does not name is gone. What the archive contains is not checked.
- The application stays stopped; `POST …/start` brings it back.
- The upload has no overall timeout; a read that stalls for 60 seconds ends it.

Listing volumes needs the `read` role; both archive endpoints need `admin`: a backup carries the application's data, a restore replaces it. See [Back up and restore volumes](/docs/tasks/backups).

### GET /applications/:name/jobs

The scheduled jobs of the active deployment, each with its last run and the next time its schedule fires.

| Status | Body |
|---|---|
| `200` | Array of [`Job`](#job); empty when the configuration has no `jobs` |
| `404 NOT_FOUND` | Unknown application |
| `409 NOT_DEPLOYED` | No active deployment |

```json
{
  "data": [
    { "name": "nightly-report", "schedule": "0 3 * * *", "command": ["node", "report.js"], "timeout": "1h0m0s",
      "last_run": { "id": 42, "application": "my-api", "job": "nightly-report", "kind": "scheduled",
                    "command": ["node", "report.js"], "status": "failed", "exit_code": 1, "deployment_id": 7,
                    "started_at": "2026-03-01T03:00:00Z", "finished_at": "2026-03-01T03:00:12Z" },
      "next_run_at": "2026-03-02T03:00:00Z" }
  ]
}
```

Schedules are read in UTC and `next_run_at` is UTC. `last_run` is `null` until the job has run, `next_run_at` is `null` while the application is stopped, since a stopped application runs no jobs.

### GET /applications/:name/runs

Runs of the application, newest first, without their output. A *run* is one execution of a one-off container from the application's image, with its environment and limits and without its volumes: the pre-deploy hook of a deployment (`kind: "hook"`, job `pre-deploy`), a scheduled job (`kind: "scheduled"`) or a command started by hand (`kind: "manual"`: the job's name for `jobs/:job/run`, `run` for a one-off command).

| Parameter | Default | |
|---|---|---|
| `job` | all jobs | Limit the list to one job: a job's name, `pre-deploy` or `run`. Must be a valid job name. |
| `limit` | `50` | 1 to 500 |

| Status | Body |
|---|---|
| `200` | Array of [`Run`](#run) |
| `400 INVALID_REQUEST` | Invalid `job` or `limit` |
| `404 NOT_FOUND` | Unknown application |

The agent keeps the last 50 runs of each job.

### GET /applications/:name/runs/:id

One run with its output. `:id` must be a positive integer.

| Status | Body |
|---|---|
| `200` | [`RunDetail`](#rundetail) |
| `400 INVALID_REQUEST` | `:id` is not a positive number |
| `404 NOT_FOUND` | Unknown application, or no run with that id belongs to it |

`output` is the last 200 lines the container wrote, at most 64 KB, joined with newlines. Poll this endpoint until `finished_at` is set, then read `status` and `exit_code`.

### POST /applications/:name/jobs/:job/run

Starts a scheduled job now, as the schedule would. No body.

| Status | Body |
|---|---|
| `202` | [`RunDetail`](#rundetail) with `status: "running"` and an empty `output`, and a `Location` header naming the run: `/api/v1/applications/my-api/runs/43` |
| `400 INVALID_REQUEST` | Invalid job name |
| `404 NOT_FOUND` | Unknown application, or the active deployment has no job by that name |
| `409 NOT_DEPLOYED` | No active deployment |
| `409 JOB_ALREADY_RUNNING` | An earlier run of this job is still going. The schedule skips such firings too. |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |
| `503 RUNTIME_UNAVAILABLE` | The agent is shutting down |

The application's lock is taken only to record the run against the active deployment; it is released while the container runs, so the application stays deployable and stoppable meanwhile. Poll the `Location` until `finished_at` is set.

### POST /applications/:name/run

Runs a one-off command in a fresh container from the active deployment's image, with its environment, limits and network, and without its volumes.

```json
{ "command": ["rails", "db:migrate"] }
```

| Field | Type | |
|---|---|---|
| `command` | array of strings | Required. Validated like a `command` in `deploy.yaml`: non-empty, at most 256 strings, each at most 4096 bytes and without NUL bytes. Handed to the container as its argv, never to a shell. |

The body is limited to 4096 bytes. Unknown fields are rejected.

| Status | Body |
|---|---|
| `202` | [`RunDetail`](#rundetail) with `job: "run"`, `kind: "manual"`, `status: "running"`, and a `Location` header naming the run |
| `400 INVALID_REQUEST` | Missing or invalid `command`, invalid JSON, unknown field, body too large |
| `404 NOT_FOUND` | Unknown application |
| `409 NOT_DEPLOYED` | No active deployment |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |
| `503 RUNTIME_UNAVAILABLE` | The agent is shutting down |

Commands are independent of one another: two may run at the same time. A command is stopped after one hour. A failed or timed-out run adds an event of `type: "job"` to the application's feed; a successful one records nothing. See [Run scheduled jobs and one-off commands](/docs/tasks/jobs).

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

### GET /tokens

The stored tokens, oldest first, without their values or hashes. The root token is not listed: it is configured on the agent, not stored.

| Status | Body |
|---|---|
| `200` | Array of [`Token`](#token) |

```json
{ "data": [
  { "id": 3, "name": "ci", "role": "deploy", "created_at": "2026-03-01T10:00:00Z",
    "last_used_at": "2026-03-01T10:42:00Z" }
] }
```

`last_used_at` is `null` until the token is first used, and is then kept to the minute: it says whether a token is still in use, not what it did last.

### POST /tokens

Creates a token. The value is in this response and nowhere else: the agent stores its SHA-256 and nothing else.

```json
{ "name": "ci", "role": "deploy" }
```

| Field | Type | |
|---|---|---|
| `name` | string | Required. Lowercase letters, digits and dashes, starting and ending with a letter or digit, at most 40 characters. Unique; `root` is taken. |
| `role` | string | Required. `read`, `deploy` or `admin`. |

The body is limited to 4096 bytes. Unknown fields are rejected.

| Status | Body |
|---|---|
| `201` | [`CreatedToken`](#createdtoken) |
| `400 INVALID_REQUEST` | Missing or invalid `name` or `role`, invalid JSON, unknown field, body too large |
| `409 TOKEN_EXISTS` | A token with that name exists |

```json
{
  "data": {
    "id": 3, "name": "ci", "role": "deploy", "created_at": "2026-03-01T10:00:00Z",
    "token": "swk_Xk3nM9…"
  }
}
```

Values are 32 random bytes in unpadded base64url behind the prefix `swk_`, which is not part of the secret; it exists so that a token is recognizable where it must not be, such as a log or a repository.

### DELETE /tokens/:name

Revokes a token. Requests with it are `401` from then on. A token may revoke itself.

| Status | Body |
|---|---|
| `204` | None |
| `400 INVALID_REQUEST` | `:name` is `root` (the root token is changed on the agent, not here), or not a valid token name |
| `404 NOT_FOUND` | No token by that name |

### GET /secrets

The secrets stored on the server, by name, without values. A secret is a value for `${NAME}` in the `env` values of a `deploy.yaml`, kept on the server so that no client has to hold it; the agent fills it in when a deployment is recorded. See [Placeholders](/docs/reference/deploy-yaml#placeholders).

| Status | Body |
|---|---|
| `200` | Array of [`Secret`](#secret) |

```json
{ "data": [
  { "name": "DATABASE_PASSWORD", "created_at": "2026-03-01T10:00:00Z",
    "updated_at": "2026-03-01T10:42:00Z" }
] }
```

### PUT /secrets/:name

Stores a secret, creating or replacing it.

```bash
curl -X PUT …/secrets/DATABASE_PASSWORD -d '{"value": "hunter2"}'
```

| Field | Type | |
|---|---|---|
| `value` | string | Required. At most 64 KB, not empty, without NUL bytes. |

`:name` matches `^[A-Za-z_][A-Za-z0-9_]*$` and is at most 64 characters: names are environment variable names. The body is at most 260 KB; unknown fields are rejected. At most 500 secrets are stored.

| Status | Body |
|---|---|
| `204` | None, whether the secret was created or replaced |
| `400 INVALID_REQUEST` | Invalid name or value, invalid JSON, unknown field, body too large, or the 501st secret |

The value is written encrypted (AES-256-GCM, the name as additional data, like an `env` value) and is never returned, logged or repeated in an error.

### DELETE /secrets/:name

Removes a secret. Deployments already made keep the value they were started with; the next `deploy` whose `env` refers to the name is refused:

```json
{ "error": { "code": "INVALID_CONFIG", "message": "invalid deploy.yaml",
             "details": { "fields": [ {
               "field": "env.DATABASE_URL",
               "message": "refers to ${DATABASE_PASSWORD}, which is not set where shipwick runs and not stored on the server",
               "expected": "shipwick secret set DATABASE_PASSWORD" } ] } } }
```

| Status | Body |
|---|---|
| `204` | None |
| `404 NOT_FOUND` | No secret by that name |

### GET /volumes

Every volume Shipwick created on the server, by its Docker name, with the application it was created for and whether that application still exists. [`DELETE /applications/:name`](#delete-applications-name) keeps the application's volumes; this is where they turn up afterwards.

| Status | Body |
|---|---|
| `200` | Array of [`ServerVolume`](#servervolume) |

```json
{ "data": [
  { "name": "shipwick_pgtest_data", "application": "pgtest", "volume": "data",
    "size_bytes": 13631488, "orphan": true },
  { "name": "shipwick_postgres_data", "application": "postgres", "volume": "data",
    "size_bytes": 2684354560, "orphan": false }
] }
```

`size_bytes` is what the daemon's disk-usage report says, `-1` when it reports nothing for the volume.

### DELETE /volumes/:name

Removes a volume of a deleted application, with everything in it. `:name` is the Docker name, `shipwick_<application>_<volume>`.

| Status | Body |
|---|---|
| `204` | None |
| `400 INVALID_REQUEST` | `:name` is not of the form `shipwick_<application>_<volume>` |
| `404 NOT_FOUND` | No volume by that name |
| `409 VOLUME_IN_USE` | The application still exists; `details.application` names it. Its data belongs to it, and a [restore](#put-applications-name-volumes-volume-archive) is the way to replace it. |

## Asynchronous deployments

`deploy`, `redeploy` and `rollback` answer `202 Accepted` as soon as the `PENDING` record exists, with `Location: /api/v1/deployments/7`:

```json
{
  "data": {
    "id": 7, "application": "my-api", "sequence": 3,
    "version": "1.4.2", "image": "ghcr.io/company/my-api:1.4.2",
    "status": "PENDING", "error": "",
    "started_at": "2026-03-01T10:00:00Z", "completed_at": null,
    "kind": "deploy", "source_deployment_id": null, "by": "ci"
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
step   Pulled image ghcr.io/company/my-api:1.4.2     (or: "Using image shipwick.local/…, sent from a developer's machine")
step   Running pre-deploy command                    (only with pre_deploy)
step   Pre-deploy command finished (12s)             (only with pre_deploy)
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

A `step` event with `level: "warn"` is a warning, for example when the image could not be pulled and a local copy was used, when a domain is configured but no reverse proxy is, or when a hostname does not point at the server yet: the warning names the record to create, `add an A record: api.example.com → 203.0.113.10 (DNS only, not proxied)`. A static deployment's steps read `Received 42 files (3.1 MB)`, `Copied 42 files into the proxy`, `Found index.html` and `Routed https://example.com to the uploaded files` instead of the pull and the replicas.

On failure there is a `state` event `FAILED: <reason>` with `level: "error"` and, if a replica crashed or never became healthy, a `log` event holding its last 20 lines of output. A pre-deploy command that exits non-zero or outlives its timeout fails the deployment before any replica of the new version was started, with the reason `pre-deploy command exited 1` or `pre-deploy command timed out after 10m`, and a `log` event `Last output of the pre-deploy command:` followed by its last 20 lines, at most 4096 bytes. A rollback adds the `state` events `ROLLBACK`, `RESTORING` and `ROLLED_BACK`, and steps narrating it. Deployment events never change afterwards.

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
| `token` | [`TokenIdentity`](#tokenidentity) | The token this request was made with |
| `notifications` | [`NotificationStatus`](#notificationstatus) | Where the agent reports outcomes |

### TokenIdentity

| Field | Type | |
|---|---|---|
| `name` | string | The token's name; `root` for the token the agent is configured with |
| `role` | string | `read`, `deploy` or `admin` |

### NotificationStatus

| Field | Type | |
|---|---|---|
| `webhook` | boolean | `SHIPWICK_WEBHOOK_URL` is set on the agent |

### Application

| Field | Type | |
|---|---|---|
| `name` | string | |
| `status` | string | See [Application status](#application-status) |
| `desired_state` | string | `running` or `stopped` |
| `image`, `version`, `domain` | string | Of the active deployment. Empty until the first deployment succeeds. |
| `aliases` | array of strings | Hostnames served like `domain`. Omitted when there are none. |
| `redirects` | array of strings | Hostnames redirected to `domain`. Omitted when there are none. |
| `replicas` | object | `{desired, running, healthy}`. All zero for a static application. |
| `static` | boolean | The proxy serves this application from a folder; it has no containers |
| `deploying` | boolean | A deployment is in flight |
| `in_flight_deployment_id` | integer or null | The deployment to follow while `deploying` is true |
| `created_at`, `updated_at` | timestamp | |

A replica is **healthy** when it runs and is not failing its health check. Without a `health` block, `healthy` equals `running`. During a rollout the numbers describe the replicas that are serving right now, a mix of the old and the new version, and `desired` is the capacity the rollout maintains: the smaller of the two replica counts. For a static application all three are zero: the proxy serves it, and there is nothing to count.

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
| `version` | string | Derived from the image reference; for a static deployment, the first twelve hex characters of the folder's digest |
| `image` | string | Empty for a static deployment |
| `static` | [`StaticFiles`](#staticfiles) | The folder a static deployment serves. Absent for a container deployment. |
| `status` | string | `PENDING`, `BUILDING`, `STARTING`, `HEALTH_CHECKING`, `HEALTHY`, `ACTIVE`, `SUPERSEDED`, `FAILED`, `ROLLBACK`, `RESTORING`, `ROLLED_BACK`. See [Deployments](/docs/concepts/deployments#states). |
| `error` | string | Empty unless the deployment failed |
| `started_at` | timestamp | |
| `completed_at` | timestamp or null | Set when the agent is done with the deployment |
| `kind` | string | `deploy`, `redeploy` or `rollback` |
| `source_deployment_id` | integer or null | For a redeploy or rollback, the deployment whose configuration it re-used |
| `by` | string | The name of the token that started the deployment; `root` for the agent's own token. Omitted on deployments recorded before tokens had names. |

### DeploymentDetail

All fields of [`Deployment`](#deployment), plus:

| Field | Type | |
|---|---|---|
| `spec` | [`Spec`](#spec) | The deployment's configuration, environment values masked |
| `events` | array of [`Event`](#event) | |

### Spec

The JSON form of a validated `deploy.yaml`, with defaults applied. It is what the agent stores with each deployment. Durations are strings in Go's form: `"10s"`, `"10m0s"`, `"1h0m0s"`.

| Field | Type | |
|---|---|---|
| `name`, `image` | string | `image` is the reference that was deployed; for a `build` application, the `shipwick.local/<name>:<tag>` the client loaded; empty for a static application |
| `build` | object | Omitted when not set. `{context, dockerfile}`, as written in `deploy.yaml`, relative to it. |
| `static` | object | Omitted when not set. `{dir}`: the folder, relative to `deploy.yaml`, on the machine that uploaded it. |
| `port` | integer | Omitted when not set |
| `domain` | string | Omitted when not set |
| `aliases` | array of strings | Omitted when empty |
| `redirects` | array of strings | Omitted when empty |
| `replicas` | integer | |
| `env` | object | Omitted when empty. Names are kept; every value is `"********"`. |
| `health` | object | Omitted without a health check. Exactly one of `path` (string), `tcp` (integer) or `command` (array of strings) is present, then `interval`, `timeout` and `retries`, and `start_period` when it is set. |
| `resources` | object | `{cpu, memory_bytes}`. A field is omitted when unlimited. Memory is in bytes. |
| `volumes` | array | Omitted when empty. `[{name, path}]` |
| `publish` | array | Omitted when empty. `[{port, host, address, protocol}]`: the container port, the server port, the server address to bind (omitted when every address), and `tcp` or `udp`. |
| `entrypoint` | array of strings | Omitted when not set |
| `command` | array of strings | Omitted when not set |
| `user` | string | Omitted when not set |
| `pre_deploy` | object | Omitted when not set. `{command, timeout}`; the default timeout is `"10m0s"`. |
| `jobs` | array | Omitted when empty. `[{name, schedule, command, timeout}]`; `schedule` is five cron fields, read in UTC; the default timeout is `"1h0m0s"`. |
| `logging` | object | Omitted when not set. `{driver, options}`; `options` is omitted when empty. |
| `restart` | object | `{policy}` |
| `deploy` | object | `{strategy}` |

### Event

| Field | Type | |
|---|---|---|
| `id` | integer | Increasing. Clients use it to tell new events from ones already seen. |
| `deployment_id` | integer or null | Null for application events |
| `level` | string | `info`, `warn` or `error` |
| `type` | string | Deployment events: `step`, `state`, `log`. Application events: `supervisor`, `app` (stop, start, restored volume), `job` (a scheduled job or one-off command that failed or timed out). |
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

### MetricsHistory

| Field | Type | |
|---|---|---|
| `application` | string | |
| `since` | timestamp | Start of the window |
| `step` | string | Width of one point: `30s`, `5m` or `1h` |
| `series` | array of [`MetricsSeries`](#metricsseries) | One per replica that has samples in the window |
| `limits` | [`MetricsLimits`](#metricslimits) | The active deployment's per-replica limits |

### MetricsSeries

| Field | Type | |
|---|---|---|
| `replica` | integer | |
| `points` | array of [`MetricsPoint`](#metricspoint) | In time order; steps without a sample are absent |

### MetricsPoint

| Field | Type | |
|---|---|---|
| `at` | timestamp | Start of the step |
| `cpu_percent` | number | Average over the step, in percent of one core |
| `memory_bytes` | integer | Peak working set in the step |

### MetricsLimits

| Field | Type | |
|---|---|---|
| `cpu` | number | Cores, as in `deploy.yaml`. `0` means unlimited. |
| `memory_bytes` | integer | Bytes. `0` means unlimited. |

### Volume

| Field | Type | |
|---|---|---|
| `name` | string | The volume's name in `deploy.yaml`; on the server it is `shipwick_<app>_<name>` |
| `path` | string | Where it is mounted inside the container |

### ServerVolume

One entry of [`GET /volumes`](#get-volumes).

| Field | Type | |
|---|---|---|
| `name` | string | The Docker name, `shipwick_<application>_<volume>` |
| `application` | string | The application the volume was created for |
| `volume` | string | Its name in that application's `deploy.yaml` |
| `size_bytes` | integer | What the daemon's disk-usage report says; `-1` when it reports nothing |
| `orphan` | boolean | The application has been deleted; the volume can be removed |

### LoadedImage

The answer to [`POST /applications/:name/images`](#post-applications-name-images).

| Field | Type | |
|---|---|---|
| `image` | string | The reference that was loaded, `shipwick.local/<name>:<tag>` |
| `size_bytes` | integer | The size of the archive |

### StaticUpload

The answer to [`PUT /applications/:name/static`](#put-applications-name-static).

| Field | Type | |
|---|---|---|
| `digest` | string | `sha256:` and the digest of the archive; what `?static=` takes |
| `size_bytes` | integer | The files' sizes added up |
| `files` | integer | How many files the folder holds |

### StaticFiles

What a static deployment serves; carried by [`Deployment`](#deployment) as `static`, with the same numbers as its upload.

| Field | Type | |
|---|---|---|
| `digest` | string | |
| `size_bytes` | integer | |
| `files` | integer | |

### Secret

| Field | Type | |
|---|---|---|
| `name` | string | An environment variable name |
| `created_at` | timestamp | |
| `updated_at` | timestamp | When the value was last replaced |

The value is never part of any response.

### Job

| Field | Type | |
|---|---|---|
| `name` | string | |
| `schedule` | string | Five cron fields, UTC |
| `command` | array of strings | |
| `timeout` | string | A duration, such as `"1h0m0s"` |
| `last_run` | [`Run`](#run) or null | Null until the job has run |
| `next_run_at` | timestamp or null | The next time the schedule fires, UTC. Null while the application is stopped. |

### Run

| Field | Type | |
|---|---|---|
| `id` | integer | Unique on the server |
| `application` | string | |
| `job` | string | The job's name; `pre-deploy` for the hook, `run` for a one-off command |
| `kind` | string | `hook`, `scheduled` or `manual` |
| `command` | array of strings | |
| `status` | string | `running`; `succeeded` (exit code 0); `failed` (any other exit code, or the container could not be started); `timed_out` (stopped when its timeout ran out); `interrupted` (the agent was restarted while it ran) |
| `exit_code` | integer or null | Null until the process has exited, and when it could not be started |
| `deployment_id` | integer or null | The deployment whose image and environment the run used; null once that deployment is gone from the history |
| `started_at` | timestamp | |
| `finished_at` | timestamp or null | Set when the run is over |

### RunDetail

All fields of [`Run`](#run), plus:

| Field | Type | |
|---|---|---|
| `output` | string | The last 200 lines the container wrote, at most 64 KB, joined with newlines. Empty while the run has just started. |

### RunRequest

The body of `POST /applications/:name/run`.

| Field | Type | |
|---|---|---|
| `command` | array of strings | Required. See [POST /applications/:name/run](#post-applications-name-run). |

### Token

| Field | Type | |
|---|---|---|
| `id` | integer | |
| `name` | string | |
| `role` | string | `read`, `deploy` or `admin` |
| `created_at` | timestamp | |
| `last_used_at` | timestamp or null | To the minute; null until first used |

### CreatedToken

The answer to `POST /tokens`, the one time the token value itself is shown.

| Field | Type | |
|---|---|---|
| `id` | integer | |
| `name` | string | |
| `role` | string | |
| `created_at` | timestamp | |
| `token` | string | The value: `swk_` and 32 random bytes in unpadded base64url |

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

`deploying: true` is set whenever a deployment is in flight. An application can be `HEALTHY`, with the old version serving, and `deploying` at once. A static application is `HEALTHY` while its deployment is active and `STOPPED` after `stop`; it has no replicas to be degraded or crash-looping.
