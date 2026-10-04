---
title: REST API
description: Reference of the Shipwick agent's REST API, covering authentication and roles, tokens, signing in and the audit trail and its export, the log archive and its search, the document of what an application runs, the response and error envelopes, every error code and endpoint, the asynchronous deployment pattern, log streaming, volume archives and backups, traffic, certificates, registries, export and import, the Prometheus endpoint, jobs and runs, and the wire types.
---

# REST API

The agent serves a JSON REST API. `shipwick` and the dashboard are clients of it and have no private channel: anything they do can be done with `curl`. This page covers authentication and roles, the envelopes, error codes, every endpoint (applications and deployments, backups, traffic, certificates, registries, tokens, the audit trail, signing in and access rules, export, import and the standby, and the Prometheus endpoint), the asynchronous deployment pattern, log streaming, and the types.

## Basics

| | |
|---|---|
| Base path | `/api/v1`. The one endpoint outside it is [`GET /metrics`](#get-metrics), because that is where a scraper looks. |
| Default address | `http://127.0.0.1:9000`, or `https://<SHIPWICK_AGENT_DOMAIN>` when served through Caddy |
| Format | JSON in responses. Request bodies are JSON, except for `deploy` and `validate`, which take the `deploy.yaml` document, the volume restore, the static upload and the image upload, which take a tar archive, and the import, which takes an export. |
| Timestamps | RFC 3339, UTC |

Every response carries `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. JSON responses have `Content-Type: application/json; charset=utf-8`.

The API speaks plain HTTP. See [Security](/docs/security) for how to expose it.

## Authentication

Every endpoint except `GET /api/v1/health`, [`GET /api/v1/auth`](#get-auth) and [`POST /api/v1/auth/exchange`](#post-auth-exchange) requires an API token as a bearer token:

```http
Authorization: Bearer <token>
```

A missing, wrong or revoked token is answered with `401 UNAUTHORIZED` and the header `WWW-Authenticate: Bearer realm="shipwick"`.

Guessing is slowed down. After 20 failed authentications within a minute from one client address, its further wrong tokens are answered `429 RATE_LIMITED` for the next minute, with a `Retry-After` header in seconds. A valid token is never refused: behind the proxy every client shares one address, and a guesser must not be able to lock anyone else out. Only failures count, so a mistyped token does not reach the limit, and `GET /health` is not limited.

A token has a **role**, and every endpoint requires one. A role includes the ones below it:

| Role | May |
|---|---|
| `read` | See everything: `GET /server`, `/applications…`, `/deployments…`, logs, the log archive and its search, events, metrics, traffic and requests, volumes, the list of backups, jobs and runs, the names of the secrets, the registries that have a credential, the supplied certificates, the volumes on the server, what a standby holds (`/standby` and `/standby/promotion`), and `GET /metrics` |
| `deploy` | And change what runs: `deploy`, `validate`, `redeploy`, `rollback`, `stop`, `start`, run a job or a one-off command, upload an image or a static folder, take a backup and verify one; since 0.7 `POST /applications` and `POST /validate`, which take a document that names its application, and `GET /applications/:name/config`, the document of what runs |
| `admin` | And everything else: `DELETE /applications/:name`, the volume archives, restoring, downloading and removing a backup, removing a volume, the `/tokens` endpoints, setting and removing `/secrets`, `/registries` and `/certificates`, `POST /server/rotate-key`, the backups of the agent's own state, adopting backups, export, import, pulling and promoting a standby, `GET /audit`, `GET /audit/export`, and the `/access` endpoints |

A `deploy` token may be **limited to applications**. It then has the `deploy` row for the applications it names and the `read` row for everything. An endpoint of the `deploy` row is under `/applications/:name`, and `:name` is what is checked, also when a `deploy` would create the application; or, since 0.7, it takes a `deploy.yaml` as its body (`POST /applications`, `POST /validate`), and the `name` in that document is what is checked, before anything else of the document is read. For another application the answer is `403 TOKEN_LIMITED`:

```json
{
  "error": {
    "code": "TOKEN_LIMITED",
    "message": "this token is limited to my-api and web; it can read worker and not change it",
    "details": { "applications": ["my-api", "web"], "application": "worker" }
  }
}
```

An endpoint that takes `deploy` and is not about one application is refused to a limited token in the same way, without `application` in the details; there is none today. So is a document without a name that can be read — not YAML, no `name`, not a valid name — with a message that ends in `and the document does not name an application`; a token that is not limited gets the `400 INVALID_CONFIG` of the document instead. The role is judged first: what takes `admin` is `403 FORBIDDEN` for a limited token as for any other `deploy` token. `read` and `admin` tokens cannot be limited.

There are two kinds of token. The **root token** is the one the agent is configured with: `SHIPWICK_AGENT_TOKEN`, or the one generated on first start. It has the `admin` role and the name `root`, is not stored in the database and cannot be revoked through the API. Every other token is created with [`POST /tokens`](#post-tokens), named, given a role, optionally a list of applications and a time at which it expires, and shown exactly once. Since 0.7 its applications and its expiry can be changed with [`PUT /tokens/:name`](#put-tokens-name); its role and its value cannot.

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

For an endpoint that needs `admin`, the message ends in `this needs admin`.

A token past its `expires_at` is `401 TOKEN_EXPIRED`:

```json
{
  "error": {
    "code": "TOKEN_EXPIRED",
    "message": "token ci expired on 2026-10-02 at 12:00 UTC; an admin creates a new one with: shipwick token create",
    "details": { "name": "ci", "expired_at": "2026-10-02T12:00:00Z" }
  }
}
```

Only the token itself gets this answer, so it tells nothing to anyone who does not hold it; a wrong token is `401 UNAUTHORIZED` whatever else exists. An expired token does not count towards the rate limit and is never answered `429`. The root token does not expire.

`GET /server` tells a client who it is and what it may do:

```json
"token": { "name": "ci", "role": "deploy", "kind": "token",
           "applications": ["my-api"], "expires_at": "2027-01-01T00:00:00Z" }
```

`kind` is `"token"`, or `"user"` for a person who [signed in](#post-auth-exchange): `name` is then the person's name — the e-mail address, or what the agent names people by — and what follows is said of the session. `applications` is the list a token is limited to, and empty for one that is not limited; `expires_at` is `null` for one that does not expire. From these a client knows what to offer: what takes `deploy` on an application is allowed when `role` is `admin`, or when `role` is `deploy` and `applications` is empty or names that application. An agent before 0.6 sends `name` and `role` only.

Next to it, `"sign_in": {"configured": true, "issuer": "https://accounts.example.com", "name_claim": "email"}` says whether people can sign in at all; an agent before 0.6 leaves it out. `name_claim` is the ID token claim people are named by, `""` without a provider; an agent before 0.7 leaves it out, and names people by `email`. With an OpenID Connect provider configured on the agent, a person signs in at the provider and the agent issues a **session**: a credential that is presented exactly like a token, `Authorization: Bearer sws_…`, and is the same kind of caller, with a role, optionally a list of applications, and an `expires_at`. Everything in this section holds for it: the role table, the application limit, `GET /server` → `token`, the [audit trail](#get-audit). A session that is refused for its role or its limit gets the same codes as a token, `FORBIDDEN` and `TOKEN_LIMITED`, with "this session" in the message. Tokens are not affected by sign-in. See [`POST /auth/exchange`](#post-auth-exchange).

See [Agent configuration](/docs/reference/agent-configuration#api-token), [Create tokens for CI and teammates](/docs/tasks/tokens) and [Sign in with your company's accounts](/docs/tasks/sign-in).

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

Six kinds of response have no envelope: `204 No Content` from `DELETE`, from the volume restore and from setting a secret or a registry credential; the NDJSON stream of followed logs; a tar archive, which is the body of `GET` and `PUT …/volumes/:volume/archive` both ways and of a backup's archive; the export that `POST /export` streams; the CSV or NDJSON that `GET /audit/export` streams; and the Prometheus text of `GET /metrics`. Errors are the JSON envelope everywhere.

## Error codes

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed application name, volume name, job name, deployment or run id, or query parameter; the name in the document differs from the name in the URL; an invalid or oversized JSON body (the limit is 4096 bytes), or an unknown field in it; an invalid `image` in a redeploy or rollback request; a missing or invalid `command` in a run request, or a `name` or `role` in a token request, `applications` on a token that is not a `deploy` token, or an `expires_at` that has passed; an access rule whose `kind`, `subject`, `role` or `applications` breaks the rules, or a 201st rule; a sign-in request with a missing or malformed field, or a `redirect_uri` that is not the configured one; `DELETE /auth/session` sent with a token; an invalid `since`, `before`, `actor_kind`, `action` or `outcome` of the audit trail, more than 20 actions, an export of it without `format` or with `limit` or `before`; a token update that names nothing to change, names both `expires_at` and `never_expires`, or is asked of `root`; a search of the logs whose `q` is longer than 256 bytes or has a line break, whose times are not RFC 3339, whose `until` is before its `since`, or whose `cursor` no answer returned; a restore body that is not `Content-Type: application/x-tar` or does not start with a tar header; an image archive that is not sent as `application/x-tar`, or that does not carry exactly one image tagged `shipwick.local/<name>:<tag>`; a `deploy.yaml` with `build` but no `image`, or a redeploy of such an application with an image from elsewhere; a static upload that is not `application/x-tar`, holds no files, or holds anything but files and directories; a static `deploy` without `?static=`, or `?static=` on a container application; a secret's name or value that breaks the rules, or a 501st secret; a volume name that is not `shipwick_<application>_<volume>`; revoking `root`; a backup or export id that is not a positive number; a `layers` list that is empty, longer than 256 or holds anything but diff IDs; a registry name with a scheme or a path, a username or password that breaks the rules, or a 51st registry; a certificate's hostname that is not one, a missing or oversized `certificate` or `key`, or a 51st certificate; an export passphrase shorter than 12 characters; an import that is not sent as `application/octet-stream` or carries no passphrase header; a key rotation asked of an agent that has no encryption key. |
| 400 | `INVALID_CONFIG` | `deploy.yaml` failed validation. `details.fields` lists every problem as `{field, message, expected}`; `expected` is omitted when there is nothing to suggest. Also returned when a hostname is already served by another application (as its domain, an alias or a redirect), by the agent or by the dashboard: one entry whose `field` names the offending line, `domain`, `aliases[0]`, `redirects[1]`, and whose `message` names the owner. And with the field `publish[i].host` when a server port the configuration publishes is already published by another application, or is one the agent or the proxy listens on. Returned by `redeploy` and `rollback` too, since a stored configuration's hostnames and ports may have been taken since. Also when an `env` value refers to a `${NAME}` that is not among the stored [secrets](#get-secrets): one entry per reference, `field` `env.<VARIABLE>`, `expected` the command that stores it; the same for a password of `proxy.basic_auth`, under the field `proxy.basic_auth[i].password`. When two applications want the same path of a hostname, the field is `path`, or `domain` or `aliases[i]` for an application that names no path. And for a wildcard hostname (`*.example.com` as `domain` or an alias) that no certificate can be had for: the agent has no DNS challenge configured and no supplied [certificate](#put-certificates-hostname) covers it; `expected` says both ways out. Since 0.7 also for a document that holds `"********"`, the mask, as an `env` value or a basic-auth password: one entry per field, see [`GET /applications/:name/config`](#get-applications-name-config); and, from `POST /applications` and `POST /validate`, for a document whose name cannot be read, with the field `name`. |
| 400 | `REGISTRY_LOGIN_FAILED` | A registry did not accept the credential of a [`PUT /registries/:registry`](#put-registries-registry), or could not be asked; `details: {registry, refused}`. Nothing was stored. |
| 400 | `INVALID_CERTIFICATE` | The certificate or key in a [`PUT /certificates/:hostname`](#put-certificates-hostname) cannot serve that hostname; `message` is a sentence that says why. |
| 400 | `INVALID_EXPORT` | The body of an import is not an export, its passphrase does not match, or it breaks off. |
| 401 | `UNAUTHORIZED` | Missing, wrong or revoked token. |
| 401 | `TOKEN_EXPIRED` | The token is a real one, past its `expires_at`; `details: {name, expired_at}`. |
| 401 | `SESSION_EXPIRED` | The session of a person who signed in is past its ten hours; `details: {name, expired_at}`. |
| 401 | `SESSION_ENDED` | The session was ended before its time: its rule was removed or changed, an admin signed the person out, or, since 0.7, the agent names people by another claim or no longer accepts the tenant the session came from; `details: {name, reason}`. See [`POST /auth/exchange`](#post-auth-exchange). |
| 401 | `SIGN_IN_FAILED` | A sign-in the provider or the ID token did not carry; `details: {reason}`. |
| 403 | `FORBIDDEN` | The token's role does not cover this endpoint. `details` is `{role, required}`. |
| 403 | `TOKEN_LIMITED` | The role would do, and the token is limited to other applications; `details: {applications}`, and `application` when the request was about one. |
| 403 | `ACCESS_NOT_GRANTED` | A person signed in whom no [access rule](#get-access-rules) gives a role; `details: {name, email}`, both the person's name: `name` since 0.7, `email` kept for older clients. |
| 404 | `NOT_FOUND` | Unknown application, deployment, volume, job, run, token, secret, backup or export, or an entry of the log archive that does not exist, belongs to another application or has aged out, including a rollback's `deployment_id` that does not exist; a `deploy` whose `?static=` digest names no upload the agent has; a registry or a hostname nothing is stored for; `latest` when the application has no successful backup; `GET /import` when the server has run no import; `GET /standby/promotion` on a server that was never promoted; a standby pull when the bucket holds no export. |
| 404 | `ENDPOINT_NOT_FOUND` | The agent has no such operation: an older agent, a typo in the path, or a method the path does not support. There is no `405`. Answered without checking the token. |
| 409 | `DEPLOYMENT_IN_PROGRESS` | Another operation holds this application. |
| 409 | `NOT_DEPLOYED` | The application has no active deployment to act on. |
| 409 | `NO_ROLLBACK_TARGET` | There is no earlier successful deployment; or the requested one is the active one, never succeeded, or belongs to another application. |
| 409 | `TOKEN_EXISTS` | A token with that name exists. |
| 409 | `APPLICATION_RUNNING` | A volume restore was asked of an application that is not stopped. |
| 409 | `JOB_ALREADY_RUNNING` | A run of this job has not finished yet; a job runs one at a time. |
| 409 | `STATIC_APPLICATION` | Logs, metrics, jobs or a one-off command were asked of an application the proxy serves from a folder; it has no containers. |
| 409 | `IMAGE_INCOMPLETE` | An image archive left out layers the server does not have; nothing was loaded. Send the whole archive. |
| 409 | `VOLUME_IN_USE` | The volume belongs to an application that still exists; `details: {application}`. Delete the application first, or replace the data with a restore. |
| 409 | `KEY_ROTATION_PENDING` | The encryption key was already rotated since the agent started, and the agent's environment still holds the old one; `details: {key_file}`. |
| 409 | `TRAFFIC_UNAVAILABLE` | Traffic or requests were asked of an agent that has no access log to read: no proxy, or one that is not the `caddy` container of its compose project. |
| 409 | `BACKUP_BUSY` | The backup is still being taken, verified, restored or removed; or a backup of the agent's state is already running. |
| 409 | `BACKUP_NOT_USABLE` | A verification, a restore or a download was asked of a backup that failed, so nothing was kept of it; or of one whose files do not decrypt with the agent's passphrase. Also the answer of an agent that was started without anywhere to keep backups. |
| 409 | `NO_VOLUMES` | A backup was asked of an application without volumes. |
| 409 | `FOREIGN_BUCKET` | Backups were to be adopted from a bucket that, under the agent's prefix, another installation writes to. |
| 409 | `BACKUPS_NOT_ENCRYPTED` | A backup of the agent's state, or an export to where backups go, was asked for and `SHIPWICK_BACKUP_PASSPHRASE` is not set; or an encrypted backup was asked for and the agent no longer has a passphrase. |
| 409 | `IMPORT_IN_PROGRESS` | An import is running; a server takes one at a time. |
| 409 | `EXPORT_IN_PROGRESS` | An export to where backups go is being written already. |
| 409 | `STANDBY_NOT_CONFIGURED` | An import from the bucket was asked of an agent that has no bucket to read exports from. |
| 409 | `PROMOTION_IN_PROGRESS` | A promotion is running: a second one was asked for, or an import. [`GET /standby/promotion`](#get-standby-promotion) follows the one that runs. |
| 409 | `SIGN_IN_NOT_CONFIGURED` | A sign-in was asked of an agent without an OpenID Connect provider. |
| 429 | `RATE_LIMITED` | A wrong token, after 20 authentications from this address failed within a minute; `Retry-After` says in how many seconds wrong tokens are answered `401` again. A valid token is never refused. |
| 413 | `INVALID_REQUEST` | The body of a `deploy` request is larger than 64 KB; a volume archive is larger than 10 GB; an image archive is larger than 4 GB; a static folder is larger than 512 MB. |
| 502 | `SIGN_IN_UNAVAILABLE` | The sign-in provider could not be reached or used; `message` says what to change. |
| 503 | `RUNTIME_UNAVAILABLE` | The agent is shutting down. |
| 500 | `INTERNAL_ERROR` | Anything else. `message` carries the cause: callers are authenticated operators, and the cause is more useful to them than an opaque message. Error messages never contain environment values. |

`DEPLOYMENT_IN_PROGRESS` is returned at once when another user operation holds the application. When the supervisor holds it, which it does for moments at a time, or a backup that the schedule started, the request waits up to 30 seconds before giving the same answer.

## Endpoints

Paths are relative to `/api/v1`. The role is the least a token needs.

| Method | Path | Role | |
|---|---|---|---|
| `GET` | [`/health`](#get-health) | none | Liveness. No token. |
| `GET` | [`/server`](#get-server) | `read` | Facts about the host, the agent, the proxy, the disk, backups, notifications and the network, the active alerts, whether people can sign in, the caller's own token, and since 0.7 the log archive and whether a newer release exists |
| `POST` | [`/server/rotate-key`](#post-server-rotate-key) | `admin` | Replace the key stored secrets are encrypted with and re-encrypt them |
| `GET` | [`/server/backups`](#get-server-backups) | `admin` | The backups of the agent's own state |
| `GET` | [`/server/backups/:id`](#get-server-backups-id) | `admin` | One of them |
| `POST` | [`/server/backups`](#post-server-backups) | `admin` | Back up the agent's state now |
| `POST` | [`/server/backups/adopt`](#post-server-backups-adopt) | `admin` | Record the backups the destinations hold and the database does not know |
| `GET` | [`/applications`](#get-applications) | `read` | Summaries of all applications, each with whether a certificate or an alert wants a look |
| `GET` | [`/applications/:name`](#get-applications-name) | `read` | One application in detail, with the certificate of each hostname |
| `POST` | [`/applications/:name/deploy`](#post-applications-name-deploy) | `deploy` | Start a deployment from a `deploy.yaml`; `?static=<digest>` for a static application |
| `POST` | [`/applications/:name/validate`](#post-applications-name-validate) | `deploy` | Ask whether a deployment of a `deploy.yaml` would be accepted, without deploying it |
| `POST` | [`/applications`](#post-applications) | `deploy` | Start a deployment of the document in the body, for the application the document names. Since 0.7 |
| `POST` | [`/validate`](#post-validate) | `deploy` | `validate` for such a document. Since 0.7 |
| `GET` | [`/applications/:name/config`](#get-applications-name-config) | `deploy` | The `deploy.yaml` that describes what the application runs, with references to stored secrets kept and other secret values masked. Since 0.7 |
| `POST` | [`/applications/:name/images`](#post-applications-name-images) | `deploy` | Load an image archive built by the client |
| `POST` | [`/applications/:name/images/missing`](#post-applications-name-images-missing) | `deploy` | Which layers of an image about to be sent the server lacks |
| `PUT` | [`/applications/:name/static`](#put-applications-name-static) | `deploy` | Upload the folder of a static application |
| `POST` | [`/applications/:name/redeploy`](#post-applications-name-redeploy) | `deploy` | Deploy the active configuration again |
| `POST` | [`/applications/:name/rollback`](#post-applications-name-rollback) | `deploy` | Deploy the configuration of an earlier successful deployment |
| `POST` | [`/applications/:name/stop`](#post-applications-name-stop) | `deploy` | Stop all replicas |
| `POST` | [`/applications/:name/start`](#post-applications-name-start) | `deploy` | Start a stopped application |
| `DELETE` | [`/applications/:name`](#delete-applications-name) | `admin` | Remove containers and history |
| `GET` | [`/applications/:name/logs`](#get-applications-name-logs) | `read` | Last log lines, or a live stream |
| `GET` | [`/applications/:name/logs/archive`](#get-applications-name-logs-archive) | `read` | What is kept of the output of ended containers and runs, newest first, without the lines. Since 0.7 |
| `GET` | [`/applications/:name/logs/archive/:id`](#get-applications-name-logs-archive-id) | `read` | One entry with its lines. Since 0.7 |
| `GET` | [`/applications/:name/logs/search`](#get-applications-name-logs-search) | `read` | Lines that contain a text, in the archive and in the replicas that exist, a page at a time. Since 0.7 |
| `GET` | [`/applications/:name/events`](#get-applications-name-events) | `read` | The application's event feed |
| `GET` | [`/applications/:name/metrics`](#get-applications-name-metrics) | `read` | Point-in-time CPU and memory |
| `GET` | [`/applications/:name/metrics/history`](#get-applications-name-metrics-history) | `read` | CPU and memory of each replica over the last hour, day or week |
| `GET` | [`/applications/:name/traffic`](#get-applications-name-traffic) | `read` | Requests, status classes, bytes and latency percentiles over the last hour, day or week |
| `GET` | [`/applications/:name/requests`](#get-applications-name-requests) | `read` | The most recent requests as the proxy logged them |
| `GET` | [`/applications/:name/volumes`](#get-applications-name-volumes) | `read` | The volumes of the active deployment |
| `GET` | [`/applications/:name/volumes/:volume/archive`](#get-applications-name-volumes-volume-archive) | `admin` | The volume's contents as a tar archive |
| `PUT` | [`/applications/:name/volumes/:volume/archive`](#put-applications-name-volumes-volume-archive) | `admin` | Replace the volume's contents with a tar archive |
| `GET` | [`/applications/:name/backups`](#get-applications-name-backups) | `read` | The backups the agent took of the application |
| `GET` | [`/applications/:name/backups/:id`](#get-applications-name-backups-id) | `read` | One backup, with the output of its last verification |
| `POST` | [`/applications/:name/backups`](#post-applications-name-backups) | `deploy` | Take a backup now |
| `POST` | [`/applications/:name/backups/:id/verify`](#post-applications-name-backups-id-verify) | `deploy` | Prove that the backup restores; `:id` may be `latest` |
| `POST` | [`/applications/:name/backups/:id/restore`](#post-applications-name-backups-id-restore) | `admin` | Replace the application's volumes with the backup's |
| `GET` | [`/applications/:name/backups/:id/volumes/:volume/archive`](#get-applications-name-backups-id-volumes-volume-archive) | `admin` | One volume of the backup as a tar archive, decrypted |
| `DELETE` | [`/applications/:name/backups/:id`](#delete-applications-name-backups-id) | `admin` | Remove the backup from every destination |
| `GET` | [`/applications/:name/jobs`](#get-applications-name-jobs) | `read` | The scheduled jobs of the active deployment, with their last and next run |
| `GET` | [`/applications/:name/runs`](#get-applications-name-runs) | `read` | Runs of jobs, hooks and one-off commands, without output |
| `GET` | [`/applications/:name/runs/:id`](#get-applications-name-runs-id) | `read` | One run with its output |
| `POST` | [`/applications/:name/jobs/:job/run`](#post-applications-name-jobs-job-run) | `deploy` | Start a scheduled job now |
| `POST` | [`/applications/:name/run`](#post-applications-name-run) | `deploy` | Run a one-off command |
| `GET` | [`/deployments`](#get-deployments) | `read` | Deployment history |
| `GET` | [`/deployments/:id`](#get-deployments-id) | `read` | One deployment with configuration and events |
| `GET` | [`/tokens`](#get-tokens) | `admin` | The stored tokens, without their values |
| `POST` | [`/tokens`](#post-tokens) | `admin` | Create a token; the value is in this response and nowhere else |
| `PUT` | [`/tokens/:name`](#put-tokens-name) | `admin` | Change the applications a token is limited to, its expiry, or both; the role and the value stay. Since 0.7 |
| `DELETE` | [`/tokens/:name`](#delete-tokens-name) | `admin` | Revoke a token |
| `GET` | [`/audit`](#get-audit) | `admin` | Who changed what, newest first |
| `GET` | [`/audit/export`](#get-audit-export) | `admin` | Everything that matches the same filters, streamed as CSV or as one JSON object per line; itself recorded. Since 0.7 |
| `GET` | [`/auth`](#get-auth) | none | Whether people can sign in, and what an authorization request needs. No token. |
| `POST` | [`/auth/exchange`](#post-auth-exchange) | none | Turn the code the provider sent the browser back with into a session. No token. |
| `DELETE` | [`/auth/session`](#delete-auth-session) | `read` | Forget the session the request is made with |
| `GET` | [`/access/rules`](#get-access-rules) | `admin` | Who may sign in, and as what |
| `POST` | [`/access/rules`](#post-access-rules) | `admin` | Give an address, a group, a domain or a name a role, creating or replacing the rule |
| `DELETE` | [`/access/rules/:id`](#delete-access-rules-id) | `admin` | Remove a rule; sessions that rested on it end with their next request |
| `GET` | [`/access/sessions`](#get-access-sessions) | `admin` | Who is signed in right now |
| `DELETE` | [`/access/sessions/:email`](#delete-access-sessions-email) | `admin` | End every session of a person, named as the sessions list them |
| `GET` | [`/secrets`](#get-secrets) | `read` | The secrets stored on the server, names and dates only |
| `PUT` | [`/secrets/:name`](#put-secrets-name) | `admin` | Store a secret, creating or replacing it |
| `DELETE` | [`/secrets/:name`](#delete-secrets-name) | `admin` | Remove a secret |
| `GET` | [`/registries`](#get-registries) | `read` | The registries the agent holds a credential for, without passwords |
| `PUT` | [`/registries/:registry`](#put-registries-registry) | `admin` | Check a credential against its registry and store it, creating or replacing it |
| `DELETE` | [`/registries/:registry`](#delete-registries-registry) | `admin` | Remove a registry's credential |
| `GET` | [`/certificates`](#get-certificates) | `read` | The certificates you supplied: what each says about itself, never the key or the PEM |
| `PUT` | [`/certificates/:hostname`](#put-certificates-hostname) | `admin` | Store a certificate and its key under a hostname, creating or replacing it |
| `DELETE` | [`/certificates/:hostname`](#delete-certificates-hostname) | `admin` | Remove a certificate |
| `GET` | [`/volumes`](#get-volumes) | `read` | Every volume Shipwick created, with its application and size |
| `DELETE` | [`/volumes/:name`](#delete-volumes-name) | `admin` | Remove a volume whose application was deleted |
| `POST` | [`/export`](#post-export) | `admin` | Everything the server runs as one encrypted file |
| `POST` | [`/import`](#post-import) | `admin` | Take in an export sent as the body and deploy what it holds |
| `GET` | [`/import`](#get-import) | `admin` | The import that is running, or ran last |
| `GET` | [`/exports`](#get-exports) | `admin` | The exports written to where backups go |
| `GET` | [`/exports/:id`](#get-exports-id) | `admin` | One of them |
| `POST` | [`/exports`](#post-exports) | `admin` | Write one there now |
| `GET` | [`/standby`](#get-standby) | `read` | The applications that were imported stopped, the DNS records a promotion asks for, how the scheduled import is doing, and the promotion that runs or ran last |
| `POST` | [`/standby/pull`](#post-standby-pull) | `admin` | Import the newest export in the bucket now, stopped |
| `POST` | [`/standby/promote`](#post-standby-promote) | `admin` | Start the applications that were imported stopped, in order; `?wait=false` answers at once |
| `GET` | [`/standby/promotion`](#get-standby-promotion) | `read` | The promotion that is running, or ran last |
| `GET` | [`/metrics`](#get-metrics) | `read` | The Prometheus text format. Not under `/api/v1`. |

In every path, `:name` of an application must be a valid application name (lowercase letters, digits and dashes, at most 63 characters), and `:volume` follows the same rule. Anything else is `400 INVALID_REQUEST` before the request reaches the engine. Every authenticated endpoint can also answer `401`, `403`, `429` and `500`; these are not repeated below.

### GET /health

Liveness, for load balancers and `shipwick server status`. It takes no token and reveals nothing beyond the version.

| Status | Body |
|---|---|
| `200` | [`Health`](#health) |

```json
{ "data": { "status": "ok", "version": "v0.7.0" } }
```

### GET /server

| Status | Body |
|---|---|
| `200` | [`Server`](#server) |

```json
{
  "data": {
    "agent_version": "v0.7.0", "hostname": "vps-1",
    "os": "linux", "kernel": "6.8.0", "architecture": "amd64", "docker_version": "29.8.0",
    "cpus": 4, "memory_bytes": 8589934592, "applications": 3, "containers": 5,
    "proxy": { "enabled": true, "reachable": true, "error": "", "routes": 4, "dns_challenge": false },
    "token": { "name": "ci", "role": "deploy", "kind": "token",
               "applications": ["my-api"], "expires_at": "2027-01-01T00:00:00Z" },
    "sign_in": { "configured": true, "issuer": "https://accounts.example.com", "name_claim": "email" },
    "notifications": { "webhook": true },
    "dashboard_url": "https://dashboard.example.com",
    "disk": { "total_bytes": 42949672960, "used_bytes": 37580963840 },
    "alerts": [
      { "kind": "disk", "severity": "warning", "application": "", "replica": 0,
        "message": "The server's disk is 87% full (5 GB of 40 GB free). See what takes the space with: docker system df",
        "since": "2026-03-01T09:41:30Z" },
      { "kind": "memory", "severity": "warning", "application": "my-api", "replica": 1,
        "message": "my-api replica 1 is at 93% of its memory limit (240 MB of 256 MB). At the limit it is killed and restarted; raise resources.memory in deploy.yaml, or watch it with: shipwick status my-api",
        "since": "2026-03-01T09:58:00Z" }
    ],
    "backups": { "destination": "s3", "encrypted": true,
                 "state_last_at": "2026-03-01T03:17:04Z", "state_error": "" },
    "network": {
      "proxy": "proxy.example.com:3128",
      "docker_proxy": false,
      "ca_file": true,
      "dns_resolvers": ["system"],
      "acme_directory": "https://ca.example.internal/acme/acme/directory"
    }
  }
}
```

An agent of 0.7 adds two objects:

```json
"log_archive": { "enabled": true, "entries": 278, "bytes": 63974240, "max_bytes": 1073741824, "retention_days": 14 },
"update": { "enabled": true, "latest_version": "v0.7.1", "checked_at": "2026-10-04T09:00:00Z", "available": true }
```

`token` is the token, or the session, this request was made with, so that a client knows what it may do before it tries: its role, the applications it is limited to and when it expires, as [Authentication](#authentication) describes. `sign_in` says whether people can sign in with an OpenID Connect provider, and with which. `notifications.webhook` says whether `SHIPWICK_WEBHOOK_URL` is set on the agent. `architecture` is what a client building an image for this server passes to `docker build --platform`; see [Images built by the client](#post-applications-name-images).

- `proxy.dns_challenge` is `true` when certificates are obtained through a DNS record ([`SHIPWICK_CLOUDFLARE_API_TOKEN`](/docs/reference/agent-configuration#shipwick-cloudflare-api-token)), so hostnames may be proxied by Cloudflare and may be wildcards.
- `dashboard_url` is `https://<SHIPWICK_DASHBOARD_DOMAIN>`, or `""` when the dashboard has no hostname.
- `disk` is the filesystem that holds the agent's data directory. `used_bytes / total_bytes` is the percentage `df` shows: `total_bytes` leaves out the blocks reserved for root. It is `null` where the agent cannot measure it, a development build off Linux.
- `alerts` are the conditions that hold right now, oldest first; `[]` when there are none. `kind` is `memory`, `disk`, `restarts` or `unhealthy`; `severity` is `warning` or `critical`, and only `disk` and `unhealthy` become critical. `memory` and `restarts` name an `application` and a `replica`; `unhealthy` an application, with `replica` 0; `disk` neither. `since` is when the alert was raised, and stays when a warning turns critical. Alerts are kept in memory: an agent that restarts raises again what still holds. An alert about an application is also in [its events](#get-applications-name-events), with the type `alert`.
- `backups.destination` is `s3` when a bucket is configured, `local` when backups stay in the agent's directory, and `none` for an agent started without anywhere to keep them. `encrypted` says whether `SHIPWICK_BACKUP_PASSPHRASE` is set. `state_last_at` is the last successful [backup of the agent's state](#post-server-backups), `null` if there has been none. `state_error` is why there is none (no passphrase) or why the last attempt failed, and empty when the last attempt succeeded.
- `network` says how the server reaches what is outside it:
  - `proxy` is the proxy the agent's own requests go through (the webhook, the bucket, the sign-in provider) as `host:port`, from `HTTPS_PROXY` or `HTTP_PROXY`; `""` when there is none. The proxy's URL may hold a password, which is never part of it.
  - `docker_proxy` says whether the Docker daemon has a proxy configured. Images are pulled by the daemon: `proxy` set and `docker_proxy` false is the usual reason a pull fails behind a proxy.
  - `ca_file` is true when certificate authorities of your own are trusted in addition to the system's (`SHIPWICK_CA_FILE`).
  - `dns_resolvers` are the name servers asked whether a hostname points at the server: addresses with their port, or `["system"]`. `[]` means the public ones.
  - `acme_directory` is the ACME server certificates are obtained from; `""` is Let's Encrypt.
- `sign_in.name_claim`, since 0.7, is the ID token claim people are named by: `email` unless the agent is configured otherwise ([`SHIPWICK_OIDC_NAME_CLAIM`](/docs/reference/agent-configuration#sign-in)), `""` without a provider.
- `log_archive`, since 0.7, reports the [log archive](#get-applications-name-logs-archive) as a whole. `enabled` is `false` when `SHIPWICK_LOG_RETENTION_SIZE` is `0`; `entries` is how many are kept; `bytes` is what they take on the disk, `max_bytes` what they may take, `retention_days` how long each is kept.
- `update`, since 0.7, says whether a newer release than the agent exists. The agent asks GitHub itself, once a day; nothing can be asked of the agent to make it check now.
  - `enabled` is false when the agent was told not to ask ([`SHIPWICK_UPDATE_CHECK=off`](/docs/reference/agent-configuration#shipwick-update-check)); the other three are then `""`, `null` and `false`.
  - `latest_version` is the tag of the latest release that is not a pre-release, with its `v`; `""` until the agent has been able to ask — the first seconds after its first start, or for as long as it cannot reach GitHub.
  - `checked_at` is when GitHub last answered, `null` until then. An attempt that failed does not move it: a server that lost its way out keeps the last answer and the time it is from.
  - `available` is true when `latest_version` is newer than `agent_version` by semantic versioning. It is false for an agent that runs the latest release, a pre-release of a later one, or a development build.

A pull that fails before the registry answers (no route, a proxy that refuses, a certificate the daemon does not trust) fails the deployment with the daemon's message followed by what to change on the server; it has no error code of its own. See [Run behind a corporate proxy or without internet](/docs/tasks/corporate-network).

An agent before 0.5 sends none of `dashboard_url`, `disk`, `alerts`, `backups` and `proxy.dns_challenge`. An agent before 0.6 sends no `network` and no `sign_in`, and only `name` and `role` in `token`. An agent before 0.7 sends no `log_archive`, no `update` and no `sign_in.name_claim`. See [Alerts and metrics](/docs/tasks/alerts-and-metrics).

### POST /server/rotate-key

The agent generates a new encryption key, re-encrypts every stored `env` value, secret, registry password and certificate key under it in one transaction, and uses it from then on. No application is touched. No body.

```bash
curl -X POST …/server/rotate-key
```

| Status | Body |
|---|---|
| `200` | [`KeyRotation`](#keyrotation) |
| `400 INVALID_REQUEST` | The agent has no encryption key to rotate |
| `409 KEY_ROTATION_PENDING` | The key was already rotated since the agent started, and its environment still holds the old one; `details: {key_file}` |

```json
{ "data": { "values": 3, "deployments": 12,
            "key_source": "file", "key_file": "/var/lib/shipwick/encryption.key" } }
```

`values` counts the re-encrypted secrets, registry passwords, certificate keys and, since 0.7, the references kept for deployments — one for each deployment whose document referred to a secret, see [`GET /applications/:name/config`](#get-applications-name-config) — `deployments` the deployment records whose `env` was re-encrypted. `key_source` is `file` when the agent keeps the key in its data directory; it has then replaced `key_file`, and the key is not in the response.

With the key in [`SHIPWICK_ENCRYPTION_KEY`](/docs/reference/agent-configuration#shipwick-encryption-key), `key_source` is `environment`: the agent cannot change its own environment, so the response carries the new key, this once, for you to put there, and `key_file` is a copy the agent keeps in its data directory until it has been started with the new key:

```json
{ "data": { "values": 3, "deployments": 12, "key_source": "environment",
            "key": "5f0c…64 hexadecimal characters",
            "key_file": "/var/lib/shipwick/encryption.key.new" } }
```

The agent keeps working with the new key. Started again with the old one in its environment, it refuses to start and says where the new key is. Until it has been restarted with the new key, another rotation is `409 KEY_ROTATION_PENDING`.

The rotation is recorded in the agent's log with the name of the token that asked for it. It is not an application event, and the key is never logged. See [Rotate the encryption key](/docs/tasks/rotate-the-encryption-key).

### GET /server/backups

The backups of the agent's own state, newest first: its database and the key that encrypts the secrets in it. The agent takes one daily. They have the shape of an application's backup, with `volumes` naming the two files, `shipwick.db` and `encryption.key`.

| Parameter | Default | |
|---|---|---|
| `limit` | `50` | 1 to 500 |

| Status | Body |
|---|---|
| `200` | Array of [`BackupRun`](#backuprun) |
| `400 INVALID_REQUEST` | Invalid `limit` |

### GET /server/backups/:id

| Status | Body |
|---|---|
| `200` | [`BackupRun`](#backuprun) |
| `400 INVALID_REQUEST` | `:id` is not a positive number |
| `404 NOT_FOUND` | No such backup |

### POST /server/backups

Backs up the agent's state now. No body.

| Status | Body |
|---|---|
| `202` | [`BackupRun`](#backuprun) with `status: "running"`, and a `Location` header: `/api/v1/server/backups/<id>`. Poll it until `completed_at` is set. |
| `409 BACKUPS_NOT_ENCRYPTED` | `SHIPWICK_BACKUP_PASSPHRASE` is not set: the key is never written unencrypted |
| `409 BACKUP_BUSY` | A backup of the agent's state is already running |
| `409 BACKUP_NOT_USABLE` | The agent was started without anywhere to keep backups |

There is no endpoint that restores the state; that is done with the agent stopped. See [Back up and restore volumes](/docs/tasks/backups) and [Bring a lost server back](/docs/tasks/restore-the-agent-state).

### POST /server/backups/adopt

A database restored from a backup of the agent's state does not know the backups taken after it, whose files are still in the directory and in the bucket. This endpoint records them. The body is optional:

```json
{ "application": "postgres" }
```

| Field | Type | |
|---|---|---|
| `application` | string | Optional. Looks at one application's backups. Without it: every application's, the agent's state and the exports. |

| Status | Body |
|---|---|
| `200` | [`BackupAdoption`](#backupadoption), once the destinations have been listed |
| `400 INVALID_REQUEST` | A name that is not an application's; a body that is not JSON, or too large |
| `409 FOREIGN_BUCKET` | The bucket, under the agent's prefix, is marked by another installation |
| `409 BACKUP_NOT_USABLE` | The agent was started without anywhere to keep backups |
| `500 INTERNAL_ERROR` | The bucket cannot be listed; the message carries the service's answer |

```json
{ "data": { "adopted": [
    { "kind": "application", "application": "postgres",
      "backup": { "id": 13, "trigger": "adopted", "status": "succeeded",
        "started_at": "2026-03-02T03:00:41Z", "completed_at": "2026-03-02T03:00:41Z",
        "volumes": [{ "volume": "data", "size_bytes": 2254857830 }],
        "destinations": ["s3"], "encrypted": true, "error": "",
        "activity": "", "verified_at": null, "verify_error": "",
        "restored_at": null, "restore_error": "" } },
    { "kind": "state", "application": "", "backup": { "id": 14, "trigger": "adopted", "…": "…" } }
  ],
  "skipped": [
    { "kind": "state", "application": "", "id": 15,
      "reason": "encryption.key.enc is missing: the backup was not finished" }
  ] } }
```

- `kind` is `application`, `state` or `export`; `application` is empty for the last two, whose backups are then listed by [`GET /server/backups`](#get-server-backups) and [`GET /exports`](#get-exports).
- A backup is recorded under the id its files carry, with what they say: `volumes` from their names, `size_bytes` from their sizes (for an encrypted file the size of what it holds), `started_at` and `completed_at` both from when the newest of them was written, `destinations` from where all of them are, `encrypted` from their names. Its `trigger` is `adopted`.
- `skipped` lists the runs whose files are not a backup that can be recorded: one of the agent's state or an export that lacks a file, files that are partly encrypted, a file that has one size in the directory and another in the bucket. Nothing is changed for them.
- Both lists are empty when the database knows everything. Nothing is adopted twice, and no file is written, moved or removed.
- An adopted backup is verified, restored, downloaded, removed and counted towards `backups.keep` like any other.
- Whether an application's backup was finished cannot be told from its files: it is adopted with the volumes that are there.

An agent before 0.6 answers `404 ENDPOINT_NOT_FOUND`. See [Bring a lost server back](/docs/tasks/restore-the-agent-state).

### GET /applications

| Status | Body |
|---|---|
| `200` | Array of [`Application`](#application) |

Each carries its `domain` and, when it serves only a part of it, its `path`: the address of an application is `https://<domain><path>`.

Every application, in the list and [on its own](#get-applications-name), says whether it wants a look:

```json
{ "name": "my-api", "status": "HEALTHY", "…": "…",
  "certificate_problem": { "hostname": "www.example.com", "status": "waiting_for_dns",
    "message": "does not resolve yet; create an A record for it that points to 203.0.113.10" },
  "alert_count": 2, "alert_severity": "critical" }
```

- `certificate_problem` is `null` while no certificate of the application is known to be out of order. Otherwise it names one hostname (the domain, an alias or a redirect) with the `status` and `message` that [`certificates`](#get-applications-name) carries for it: the worst among them, `waiting_for_dns` before `expiring` before `obtaining`, and of two equally bad the first in the order of `certificates`. `unknown` (no proxy, not checked yet, the proxy does not answer) is not a problem.
- `alert_count` is how many [alerts](#get-server) about the application are active and `alert_severity` the highest severity among them: `warning`, `critical`, or `""` when there is none. The alerts themselves are in `GET /server`.

Both are read from what the agent has in memory; listing costs no more for them. An agent older than 0.6 sends neither field.

### GET /applications/:name

Status, the active configuration with environment values and basic-auth passwords masked, the active deployment, every container of the application, and the certificate of each hostname.

| Status | Body |
|---|---|
| `200` | [`ApplicationDetail`](#applicationdetail) |
| `404 NOT_FOUND` | Unknown application |

`certificates` is the certificate the proxy presents for each hostname the application answers to, its domain, aliases and redirects:

```json
"certificates": [
  { "hostname": "api.example.com", "status": "ok", "issuer": "Let's Encrypt E7",
    "not_after": "2026-05-20T08:00:00Z", "message": "" },
  { "hostname": "www.example.com", "status": "waiting_for_dns", "issuer": "", "not_after": null,
    "message": "does not resolve yet; add an A record: www.example.com → 203.0.113.10 (DNS only, not proxied)" }
]
```

| `status` | Meaning |
|---|---|
| `ok` | The proxy presents a certificate for this name with more than 14 days left |
| `expiring` | 14 days or less left, or already expired; `message` says how long (`expires in 9 days, on 2026-03-10`). The proxy renews with a third of the lifetime to go, so this means renewal is failing. |
| `obtaining` | The proxy serves the hostname but has no certificate for it yet: the handshake fails, or presents one for another name |
| `waiting_for_dns` | The hostname does not point at this server and is not handed to the proxy; `message` is the reason, with the record to create |
| `unknown` | Not looked at yet, the proxy did not answer, or the agent has no proxy; `message` says which |

`issuer` and `not_after` are set once a certificate has been seen, `message` for every status but `ok`. The agent looks once a minute per hostname, every ten seconds while it is `obtaining`, by connecting to the proxy with the hostname as the server name; it reports the certificate and does not verify its chain. A certificate that lives less than 56 days is `expiring` in the last quarter of its lifetime rather than the last 14 days. The list is empty for an application without a domain. See [Certificates](/docs/tasks/certificates).

`containers` also lists the containers the agent is retiring in the background, replaced by a deployment or left over, each with `stopping: true` until its process exits or its `deploy.stop_timeout` is over. Such a container is not a replica any more; see [`Container`](#container).

### POST /applications/:name/deploy

Starts a deployment. The body **is** the `deploy.yaml` document. JSON is accepted as well. The maximum size is 64 KB. `name` in the document must equal `:name`. An application is created by its first deployment.

`${NAME}` placeholders in `env` values, and in the passwords of `proxy.basic_auth`, are filled in by the agent from the [secrets](#get-secrets) stored on the server, before the deployment is recorded; the record holds the values, so a later change of a secret does not reach a redeploy or rollback of it. `$${NAME}` there is a literal `${NAME}`. A placeholder anywhere else is a convention of `shipwick`, which fills it in before sending, and is stored literally here.

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
| `400 INVALID_CONFIG` | Validation failed; a hostname, a path of it or a published port is taken; an `env` value or a basic-auth password refers to a `${NAME}` that is not stored; a wildcard hostname that no certificate can be had for |
| `400 INVALID_REQUEST` | The document names another application than the URL; unreadable body; a `build` document without an `image` (the client builds and [loads](#post-applications-name-images) the image first, then names it here); a `static` document without `?static=`, or `?static=` on a container application |
| `404 NOT_FOUND` | `?static=` names no upload the agent has |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |
| `413 INVALID_REQUEST` | Body larger than 64 KB |
| `503 RUNTIME_UNAVAILABLE` | The agent is shutting down |

#### Paths and the proxy block

[`path`](/docs/reference/deploy-yaml#path) and [`proxy`](/docs/reference/deploy-yaml#proxy) in the `deploy.yaml` are part of the stored configuration, and come back in every `spec`:

```json
{
  "domain": "example.com",
  "path": "/api",
  "proxy": {
    "strip_prefix": true,
    "headers": { "X-Frame-Options": "DENY" },
    "basic_auth": [
      { "path": "/api/admin", "username": "admin", "password": "********" }
    ],
    "redirects": [
      { "from": "/api/old", "to": "/api/new", "status": 308 }
    ]
  },
  "static": { "dir": "dist", "fallback": "index.html" }
}
```

Each of `path`, `proxy` and its four members is left out when it is not set, and so is `static.fallback`; `basic_auth[].path` is left out for an account of the whole application; `redirects[].status` is always present, `308` when the document named none. `path: /` is stored as no path.

[`init: true`](/docs/reference/deploy-yaml#init) in the `deploy.yaml` comes back as `"init": true` in the `spec`; the key is left out when it is not set or `false`. A redirect hostname of an application with a `path` is answered with `308` to `https://<domain><path>` plus the request's path and query.

A password is always `********` in a response, like an `env` value. In the request it is the password, or a `${NAME}` that the agent fills in from the stored secrets exactly as it does for `env`; `$${NAME}` is a literal `${NAME}`. The record holds the value, encrypted. A name that is not stored is refused with the field `proxy.basic_auth[i].password` and the same message and `expected` as for an `env` value. A stored value that cannot be a password, shorter than 8 characters or longer than 72 bytes, is refused under the same field, `with ${NAME} filled in from the server's secrets, the password is too short: at least 8 characters`, without repeating it.

Applications may share a hostname when their paths differ. It is `400 INVALID_CONFIG` when they do not: `field` is `path` when this application names one, `example.com/api is already served by application "api"; applications share a domain under different paths`, and `domain` or `aliases[i]` when it names none and another application has the rest of the hostname. A hostname in another application's `redirects`, and the agent's and the dashboard's own, cannot be shared under any path. Paths are compared without regard to case.

The step event of a deployment with a path reads `Routed https://example.com/api to 2 replicas`. See [Paths and the proxy block](/docs/tasks/paths-and-proxy).

### POST /applications/:name/validate

Takes the same body as [`deploy`](#post-applications-name-deploy) and answers what `deploy` would answer, without deploying: nothing is recorded, pulled or started, and the application is not locked. While a deployment runs, `validate` still answers, where `deploy` would answer `409 DEPLOYMENT_IN_PROGRESS`.

```bash
curl -X POST http://localhost:9000/api/v1/applications/my-api/validate \
  -H "Authorization: Bearer $SHIPWICK_AGENT_TOKEN" \
  --data-binary @deploy.yaml
```

| Status | Body |
|---|---|
| `200` | [`Validation`](#validation): `{"valid": true}` |
| `400 INVALID_CONFIG` | What `deploy` would give, status and body alike: a field that does not validate, a hostname or a published port that something else holds, a `${NAME}` that is not among the stored secrets |
| `400 INVALID_REQUEST` | The document names another application than the URL; unreadable body |
| `413 INVALID_REQUEST` | Body larger than 64 KB |

```json
{ "data": { "valid": true } }
```

It is meant to be asked before an image is built or a folder uploaded, so it does not ask for either: a document with `build` and no `image` is valid here, where `deploy` refuses it, and a static application needs no `?static=`. An agent that predates the endpoint answers `404 ENDPOINT_NOT_FOUND`; deploy without asking then.

### POST /applications

Since 0.7. [`POST /applications/:name/deploy`](#post-applications-name-deploy) for a caller that has a document and has not parsed it: the application is the one the document's `name` says. Body, query (`?static=<digest>` for a static application), answers and errors are those of the endpoint it stands for.

```bash
curl -X POST http://localhost:9000/api/v1/applications \
  -H "Authorization: Bearer $SHIPWICK_AGENT_TOKEN" \
  --data-binary @deploy.yaml
```

| Status | Body |
|---|---|
| `202` | As [`deploy`](#post-applications-name-deploy) |
| `400 INVALID_CONFIG` | As `deploy`; also a document whose name cannot be read, with the field `name` |
| `403 TOKEN_LIMITED` | The token is limited to other applications than the one the document names, or the document names none that can be read |

The name is read from the document before the request is authorized, and nothing else of the document is: a token [limited to applications](#authentication) is checked against it, and the [audit trail](#get-audit) records the deployment under it, as if it had been in the address. The audit entry of a document whose name cannot be read has no application. An agent before 0.7 answers `404 ENDPOINT_NOT_FOUND`; use the endpoint with the name then.

### POST /validate

Since 0.7. [`POST /applications/:name/validate`](#post-applications-name-validate) for a document that names its application, in the same way as [`POST /applications`](#post-applications): body, answers and errors are those of `validate`, and a limited token is checked against the document's `name`. An agent before 0.7 answers `404 ENDPOINT_NOT_FOUND`.

### GET /applications/:name/config

Since 0.7. Writes the configuration of the active deployment as the `deploy.yaml` that describes it, in the key order and style `shipwick init` uses.

| Parameter | Default | |
|---|---|---|
| `escape` | `false` | `true` writes the document for a file that `shipwick deploy` reads: the CLI fills in `${NAME}` everywhere, the agent only in the secret values, so a literal `${NAME}` elsewhere — in a `command`, say — is written `$${NAME}`. Without it the document is what the agent itself reads, and what goes back to `POST /applications`. The secret values are the same in both. |

| Status | Body |
|---|---|
| `200` | [`ApplicationConfig`](#applicationconfig) |
| `403 TOKEN_LIMITED` | The token is limited to other applications |
| `404 NOT_FOUND` | Unknown application |
| `409 NOT_DEPLOYED` | No active deployment |

```json
{
  "data": {
    "application": "my-api",
    "deployment_id": 12, "sequence": 7, "version": "1.4.2",
    "document": "# A value shown as \"********\" was given when …\n\nname: my-api\n\nimage: ghcr.io/company/my-api:1.4.2\n\n…",
    "masked": ["env.LOG_LEVEL", "proxy.basic_auth[0].password"]
  }
}
```

`document`, for an application deployed with one reference and one literal:

```yaml
# A value shown as "********" was given when the application was deployed and
# is not handed out. Write it again, or store it on the server with
# shipwick secret set NAME and refer to it as ${NAME}. A deployment of this
# file is refused until every such value has been replaced.

name: my-api

image: ghcr.io/company/my-api:1.4.2

port: 8080

replicas: 1

env:
  DATABASE_URL: postgres://app:${DB_PASSWORD}@db:5432/app
  LOG_LEVEL: "********" # not handed out: write the value again, or refer to a secret as ${NAME}

restart:
  policy: always
```

The secret values of a configuration, `env` values and the passwords of `proxy.basic_auth`, are never in it:

- **A value the deployed document wrote with a `${NAME}` that the agent filled in from its [secrets](#get-secrets)** is that text again, the placeholders in place. The agent keeps it next to the deployment, encrypted like a secret; a redeploy and a rollback carry it on, and so do a key rotation, an export and an import.
- **Every other value** — typed into the file, or filled in by the CLI from its environment or `--env-file`, which the agent cannot tell apart — is the mask, `"********"`, with a comment on its line. `masked` names those fields, in the order of the document; it is `[]` when there are none. The comment at the top is there only when there are some.

The text around a reference is given back as it arrived, which [`GET /applications/:name`](#get-applications-name) masks along with the rest. That is why the endpoint takes `deploy`, and a limited token gets the documents of its applications only: whoever may deploy an application can read its environment by running a command in it.

Deployed again unchanged — to [`POST /applications`](#post-applications) or to [`POST /applications/:name/deploy`](#post-applications-name-deploy) — a document without masks gives the same configuration, its references filled in from the secrets as they are then. A document that holds a mask is refused, by every endpoint that takes a document and whoever wrote it:

```json
{ "error": { "code": "INVALID_CONFIG", "message": "invalid deploy.yaml",
             "details": { "fields": [ {
               "field": "env.LOG_LEVEL",
               "message": "******** is what the server shows in the place of this value, not the value",
               "expected": "the value itself, or ${NAME} with the value stored by shipwick secret set NAME" } ] } } }
```

So `"********"` cannot be a value of `env` or a basic-auth password; a stored secret may hold it.

For a static application `static_digest` is the folder the active deployment serves (`"sha256:…"`); a deployment of the document names it in `?static=`. The field is absent otherwise. An application deployed by an agent before 0.7 has no references kept, and all its secret values are masked until it is deployed again. An agent before 0.7 answers `404 ENDPOINT_NOT_FOUND`. See [Get deploy.yaml back from the server](/docs/tasks/get-the-configuration-back).

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
| `409 IMAGE_INCOMPLETE` | The archive leaves out a layer the server's Docker cannot produce. Nothing stays loaded; send the whole archive. See [`…/images/missing`](#post-applications-name-images-missing). |
| `413 INVALID_REQUEST` | The archive is larger than 4 GB |

```json
{ "data": { "image": "shipwick.local/my-api:20260927-153000-a1b2", "size_bytes": 68800000 } }
```

Loading takes no application lock. A deployment that ends `FAILED` or `ROLLED_BACK` removes the image it named unless something else needs it, and says so in a step. `shipwick.local` is a host that does not exist: the agent never pulls such an image, and a deployment whose local image is not on the server — pruned, or a rollback to a version this server was never sent — fails with `… is not on this server; it was built on a developer's machine — run shipwick deploy from the project again`. Local images are pruned like any other: the one running and the rollback target stay. A redeploy of such an application with an `image` from elsewhere is `400 INVALID_REQUEST`; without one, it keeps the image it has. The deployment's event reads `Using image shipwick.local/my-api:…, sent from a developer's machine` in place of `Pulled image …`.

### POST /applications/:name/images/missing

Between building an image and [sending it](#post-applications-name-images), a client may ask what it need not send. The body lists the image's layers as diff IDs, base layer first (`RootFS.Layers` of `docker image inspect`), 1 to 256 of them, each `sha256:<64 hex characters>`:

```json
{"layers": ["sha256:74d9…f711", "sha256:ba32…b114", "sha256:2e1f…4057"]}
```

| Status | Body |
|---|---|
| `200` | [`MissingLayers`](#missinglayers): the layers the server's Docker does not have, in the same order; an empty list when it has them all |
| `400 INVALID_REQUEST` | Invalid JSON or an unknown field; `layers` is empty, longer than 256, or holds something that is not a diff ID |

```json
{"data": {"missing": ["sha256:2e1f…4057"]}}
```

The request reads the daemon and changes nothing. A layer is on the server when an image there starts with the same diff IDs up to and including it, so the answer is always the end of the list. The archive sent afterwards may then leave out the files of the other layers (`blobs/sha256/<digest>`, as `manifest.json` in the archive lists them, in the same order as the diff IDs) and nothing else: the manifests and the image's configuration always travel.

The answer is advice. If the archive leaves out a layer the daemon cannot produce, because the image that held it was pruned in the meantime or the client left out more than it was told, the upload is `409 IMAGE_INCOMPLETE`, nothing stays loaded, and the whole archive is to be sent. An agent before 0.5 answers the question with `404 ENDPOINT_NOT_FOUND`; send the whole archive.

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

The deployment then answers like any other. Its `Deployment` has no `image`; its `version` is the digest's first twelve hex characters, and it carries `static: {digest, size_bytes, files}`. Its events read `Received 42 files (3.1 MB)`, `Copied 42 files into the proxy`, `Found index.html`, `Routed https://example.com to the uploaded files`. A folder without an `index.html` fails the deployment: `FAILED: the folder has no index.html…`. With `static: {dir, fallback}` the agent looks for that file too, `Found 200.html, the fallback page` or `FAILED: the folder has no 200.html, which static.fallback names…`, and the proxy answers every path that names no file with it, status 200.

Redeploy and rollback need no upload: the proxy keeps the folder of the serving version and of the one before it, and both re-route to a kept folder. A deployment that runs containers, for an application that was a folder, keeps the folder it replaced, the default rollback target, and removes the others (`Removed 1 folder of older versions`); the container deployment after it removes that one too. A rollback to a version whose folder is gone fails with `the files of <version> are no longer on the server: deploy the folder again`.

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

Stops all replicas of the active deployment. The application stays stopped (`desired_state: "stopped"`) until it is started or deployed again. The route goes to a static `503` first, so the domain and its aliases answer `503` while redirects keep working, and the containers receive `SIGTERM` second, with `SIGKILL` after the application's [`deploy.stop_timeout`](/docs/reference/deploy-yaml#deploy) (10 seconds unless set); their names on the services network go with them. Scheduled jobs do not run while the application is stopped. The request returns when the replicas have stopped.

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

Removes every container of the application, then the application itself **together with its deployment history** and events. Volumes are kept. The containers are stopped gracefully, so the request may take as long as the application's `deploy.stop_timeout`.

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

### GET /applications/:name/logs/archive

Since 0.7. The agent keeps the last output of every container whose run ended — a replica that crashed, was restarted, stopped or replaced, the replicas of a deployment that failed, a run of a job or a command — for [`SHIPWICK_LOG_RETENTION_DAYS`](/docs/reference/agent-configuration#shipwick-log-retention-days-and-shipwick-log-retention-size) and within `SHIPWICK_LOG_RETENTION_SIZE`. This endpoint lists the entries, newest first and without their lines. See [Find out why it died](/docs/tasks/find-out-why-it-died).

| Parameter | Default | |
|---|---|---|
| `kind` | both | `replica` or `run` |
| `deployment` | all | Only the entries of this deployment, by its id |
| `replica` | all | Only the entries of this replica |
| `run` | all | Only the entry of this run, by its id |
| `limit` | `50` | 1 to 500 |
| `before` | none | The `id` of an entry: the list continues after it |

| Status | Body |
|---|---|
| `200` | Array of [`LogArchiveEntry`](#logarchiveentry) |
| `400 INVALID_REQUEST` | An invalid parameter |
| `404 NOT_FOUND` | Unknown application |

```json
{
  "data": [
    {
      "id": 41,
      "application": "my-api",
      "kind": "replica",
      "deployment_id": 12,
      "deployment": 3,
      "version": "1.4.2",
      "replica": 2,
      "job": "",
      "run_id": null,
      "container": "shipwick_my-api_3_2",
      "reason": "crashed",
      "exit_code": 1,
      "oom_killed": false,
      "ended_at": "2026-10-03T23:18:58.930797736Z",
      "first_line_at": "2026-10-03T23:18:53.929370317Z",
      "last_line_at": "2026-10-03T23:18:58.929928842Z",
      "lines": 153,
      "bytes": 20311,
      "stored_bytes": 3100,
      "truncated": false
    }
  ]
}
```

`reason` of a replica:

| `reason` | |
|---|---|
| `crashed` | The process exited by itself with a code other than 0 |
| `exited` | The process exited by itself with code 0 |
| `oom_killed` | Killed for exceeding its memory limit |
| `unhealthy` | Restarted by the agent after failing its health check |
| `stopped` | The application was stopped |
| `replaced` | A newer deployment took its place |
| `deployment_failed` | A replica of a deployment that failed, removed with it; `exit_code` and `oom_killed` say whether it had died by itself |
| `removed` | Removed for another reason: a leftover, a rollback that failed |
| `restarted` | The run ended while no agent was running, and the container was running again when one started; why it ended is not known |

For a run, `reason` is the run's `status`: `succeeded`, `failed`, `timed_out` or `interrupted`. An entry with `lines: 0` is a replica that died without printing anything.

Nothing of what the three log archive endpoints return is written to the agent's log, to events or to the audit trail; the request log holds the path, not the query. Deleting an application removes its entries and their files. An agent older than 0.7 answers all three `404 ENDPOINT_NOT_FOUND`.

### GET /applications/:name/logs/archive/:id

Since 0.7. One entry with its lines, oldest first.

| Parameter | Default | |
|---|---|---|
| `tail` | all | Keep the last `n` lines: 1 to 10000 |

| Status | Body |
|---|---|
| `200` | [`LogArchiveDetail`](#logarchivedetail) |
| `400 INVALID_REQUEST` | An invalid `:id` or `tail` |
| `404 NOT_FOUND` | Unknown application; an entry that does not exist, belongs to another application, or has aged out |

```json
{
  "data": {
    "id": 41,
    "application": "my-api",
    "kind": "replica",
    "…": "the entry's fields, as in the list",
    "output": [
      {"replica": 2, "container": "shipwick_my-api_3_2", "stream": "stderr", "time": "2026-10-03T23:18:58.929928842Z", "message": "panic: connection refused"}
    ]
  }
}
```

### GET /applications/:name/logs/search

Since 0.7. Looks through the archive and through the logs of the replicas that exist, from where their last archived run ended, so that no line is found twice.

| Parameter | Default | |
|---|---|---|
| `q` | every line | Text to look for inside lines, whatever its case; at most 256 bytes, one line |
| `since`, `until` | no limit | Only lines at or after, at or before, a time in RFC 3339 |
| `deployment`, `replica`, `run` | all | Only the output of that deployment (its id), replica or run. With `run`, and with a `deployment` that is not the active one, only the archive is read |
| `limit` | `200` | Lines in one answer, at most 1000 |
| `cursor` | none | The `next` of the answer this one continues |

| Status | Body |
|---|---|
| `200` | [`LogSearchResult`](#logsearchresult) |
| `400 INVALID_REQUEST` | A `q` that is too long or has a line break, a time that is not RFC 3339, `until` before `since`, a `cursor` no answer returned |
| `404 NOT_FOUND` | Unknown application; a `deployment` of another one |

```json
{
  "data": {
    "lines": [
      {
        "replica": 1,
        "container": "shipwick_my-api_4_1",
        "stream": "stdout",
        "time": "2026-10-03T23:19:03.850907531Z",
        "message": "dial tcp 10.0.0.5:5432: connect: connection refused",
        "archive_id": null,
        "deployment_id": 14,
        "deployment": 4,
        "job": "",
        "run_id": null
      },
      {
        "replica": 2,
        "container": "shipwick_my-api_3_2",
        "stream": "stderr",
        "time": "2026-10-03T23:18:58.929928842Z",
        "message": "panic: connection refused",
        "archive_id": 41,
        "deployment_id": 12,
        "deployment": 3,
        "job": "",
        "run_id": null
      }
    ],
    "next": "a41.151",
    "sources": 3,
    "bytes": 21544
  }
}
```

- A line is a [`LogLine`](#logline) with where it comes from: `archive_id` is the entry that holds it, `null` for a line read from a container that exists.
- The order is by source, newest first, and within a source by time, newest first: the replicas that exist, from the highest index down, then the archive's entries from the newest to the oldest. Read backwards, an answer is in the order things were printed in each container.
- `next` is `""` when everything the question admits has been looked at. Otherwise the search goes on with `cursor=<next>` and the same other parameters. An answer is bounded twice — by `limit`, and by how much it reads, about 128 MB of output — so a page can hold fewer lines than `limit`, none included, and still have a `next`: keep asking until it is empty.
- `sources` and `bytes` are how many containers' output this request read and how much of it.
- Of a container that exists, its last 50,000 lines are looked at. The container of a job that is still running is not searched; its output is in the archive when the run has ended.

### GET /applications/:name/events

The application's own feed, newest first: crashes, restarts, health changes, recreated replicas, stops and starts, restored volumes, replaced containers that had to be killed, certificates being obtained or running out, alerts, backups that failed and verifications, and scheduled jobs or one-off commands that failed or timed out. Only the newest 500 per application are kept.

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

`type` is `supervisor`, `app` (stops, starts and restored volumes: `Application stopped by ci`, `Volume data restored from a backup (12.5 MB)`) or `job` (a run that went wrong, with `level: "warn"`: `Job nightly-report failed (exit 1)`, `Job nightly-report timed out after 1h`, `Command pg_dump failed (exit 1)`). A run that succeeds records nothing. Two more types exist: `alert`, an [alert](#get-server) about the application, with level `warn` or `error` when it is raised and `info` when it is cleared; and `backup`, a [backup](#get-applications-name-backups) that failed (`Backup #12 failed: …`), a verification either way, and an application that was stopped for a backup and started again. Backups that succeed record nothing.

A replaced container that did not exit within its `deploy.stop_timeout` and was killed is an `app` event at level `warn`: `The replaced container shipwick_my-api_6_1 did not exit within 10s of SIGTERM and was killed. To let it finish its requests, handle SIGTERM in the application; to give it longer, set deploy.stop_timeout`.

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

### GET /applications/:name/traffic

What the proxy's access log says about the application's requests over a window.

| Parameter | Default | |
|---|---|---|
| `since` | `1h` | `1h`, `24h` or `7d` |

| Status | Body |
|---|---|
| `200` | [`Traffic`](#traffic) |
| `400 INVALID_REQUEST` | Invalid `since` |
| `404 NOT_FOUND` | Unknown application |
| `409 TRAFFIC_UNAVAILABLE` | There is no access log to read: the agent has no proxy, or the proxy is not the `caddy` container of the agent's compose project |

```json
{
  "data": {
    "application": "my-api", "since": "2026-03-01T09:00:00Z", "step_seconds": 60,
    "totals": {
      "requests": 12480, "status_2xx": 12300, "status_3xx": 40, "status_4xx": 120, "status_5xx": 20,
      "bytes": 123456789, "p50_ms": 12.4, "p95_ms": 48, "p99_ms": 210.5
    },
    "points": [
      { "t": "2026-03-01T09:00:00Z",
        "requests": 208, "status_2xx": 205, "status_3xx": 1, "status_4xx": 2, "status_5xx": 0,
        "bytes": 2057600, "p50_ms": 11.9, "p95_ms": 45.2, "p99_ms": 180 }
    ]
  }
}
```

- The agent picks the step for the window: `60` seconds for `1h`, `300` for `24h`, `3600` for `7d`, so a series is at most a few hundred points. The window starts on a step boundary, so `since` is up to one step earlier than asked.
- A request belongs to the application whose `domain`, alias or redirect it was sent to; where several applications share a hostname by `path`, to the one with the longest path the request is under. Requests the proxy answered by itself count too: a redirect's `308`, the `503` of a stopped application, the files of a static one. Requests for the agent's and the dashboard's own hostnames are not recorded.
- `bytes` are response bodies as sent, after compression. Statuses outside 200–599 are in `requests` only.
- The percentiles are estimated from a histogram of the proxy's durations, from the first byte of the request to the last of the response, with bounds at 1, 2.5, 5, 10, 25, 50, 100, 250, 500 ms and 1, 2.5, 5, 10, 30 s, and are as exact as a bucket is wide; a request slower than 30 s reads `30000`. They are `0` when there were no requests.
- `t` is the start of the step. A step without a request has no point: the series is sparse, and a missing point is zero. The current minute is included; minutes that have ended are kept for seven days.
- An application without a domain, or one nobody has asked anything of, answers zero totals and no points.

See [`shipwick traffic`](/docs/tasks/traffic).

### GET /applications/:name/requests

The application's most recent requests as the proxy logged them, oldest first.

| Parameter | Default | |
|---|---|---|
| `tail` | `50` | 1 to 200, which is all the agent keeps per application |

| Status | Body |
|---|---|
| `200` | Array of [`Request`](#request) |
| `400 INVALID_REQUEST` | Invalid `tail` |
| `404 NOT_FOUND` | Unknown application |
| `409 TRAFFIC_UNAVAILABLE` | As for [traffic](#get-applications-name-traffic) |

```json
{
  "data": [
    { "time": "2026-03-01T10:00:00.412365Z", "method": "GET", "path": "/api/users",
      "status": 200, "duration_ms": 12.431, "bytes": 2048, "client": "203.0.113.7" }
  ]
}
```

The requests are kept in memory, so the list starts empty after an agent restart. `path` carries no query string, and nothing of the request's or the response's headers is kept: the proxy does not write them to its log in the first place. `client` is the address the proxy saw. Requests are attributed to applications as for traffic.

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

### GET /applications/:name/backups

Where the two `archive` endpoints above hand an archive to the caller, this and the following endpoints are about the backups the agent takes and keeps itself: on the schedule under [`backups`](/docs/reference/deploy-yaml#backups) in `deploy.yaml`, or on request. A *backup* is one run. This endpoint lists them, newest first.

| Parameter | Default | |
|---|---|---|
| `limit` | `50` | 1 to 500 |

| Status | Body |
|---|---|
| `200` | Array of [`BackupRun`](#backuprun) |
| `400 INVALID_REQUEST` | Invalid `limit` |
| `404 NOT_FOUND` | Unknown application |

```json
{ "id": 12, "trigger": "schedule", "status": "succeeded",
  "started_at": "2026-03-01T03:00:00Z", "completed_at": "2026-03-01T03:00:41Z",
  "volumes": [{ "volume": "data", "size_bytes": 2254857830 }],
  "destinations": ["local", "s3"], "encrypted": true, "error": "",
  "activity": "", "verified_at": "2026-03-01T09:12:00Z", "verify_error": "",
  "restored_at": null, "restore_error": "" }
```

`trigger` is `schedule`, `manual`, or `adopted` for a backup that was [recorded from its files](#post-server-backups-adopt). `status` is `running`, `succeeded` or `failed`; a failed backup has `error` set, empty `volumes` and `destinations`, and no files anywhere. `size_bytes` is the tar archive's size, before encryption. `destinations` lists where it went, of `local` (the agent's backup directory) and `s3`; `encrypted` says whether it was written with the agent's passphrase. `activity` is `verify` or `restore` while one of them is in progress and `""` otherwise. `verified_at` is when the backup last proved to restore and `verify_error` why its last verification failed; one of them at most is set, and the same goes for `restored_at` and `restore_error`.

### GET /applications/:name/backups/:id

One backup. `:id` must be a positive integer.

| Status | Body |
|---|---|
| `200` | [`BackupRunDetail`](#backuprundetail): the backup and `verify_output`, the last 200 lines (64 KB) the verification's container wrote |
| `400 INVALID_REQUEST` | `:id` is not a positive number |
| `404 NOT_FOUND` | Unknown application, or no backup with that id belongs to it |

### POST /applications/:name/backups

Takes a backup now. No body. It works without a `backups` block in `deploy.yaml`; with one, its `before` command runs first, for at most `before_timeout` (`"1h0m0s"` in the stored configuration unless set; an older deployment has no such field, and an hour), and `stop` is honoured. Since 0.7 `before_in` says where the command runs: absent from the stored configuration, inside the replica, where the command is not ended at the limit (`error`: `backups.before did not finish within 1h; the backup was given up …`); `"container"`, in a container of its own beside the replica, which is stopped and removed at the limit (`… did not finish within 1h and was stopped; …`).

| Status | Body |
|---|---|
| `202` | [`BackupRun`](#backuprun) with `status: "running"`, and a `Location` header naming the backup: `/api/v1/applications/postgres/backups/13`. Poll it until `completed_at` is set. |
| `404 NOT_FOUND` | Unknown application |
| `409 NOT_DEPLOYED` | No active deployment |
| `409 NO_VOLUMES` | The application has no volumes |
| `409 DEPLOYMENT_IN_PROGRESS` | Another operation holds the application |
| `409 BACKUP_NOT_USABLE` | The agent was started without anywhere to keep backups |

The application is held until the archives are written: other operations get `409 DEPLOYMENT_IN_PROGRESS`, as during a deployment, and wait up to 30 seconds instead when the backup was started by the schedule. A failed backup adds an event of `type: "backup"` to the application's feed; a failed scheduled one is also sent to the webhook as `backup.failed`.

### POST /applications/:name/backups/:id/verify

Proves that a backup restores: the agent restores it into scratch volumes, starts one container of the application's current image on them and holds it to the application's health check, as a deployment holds a new replica; without a health check, to staying up for the stabilization window. The container and the volumes are removed either way, and the application is not touched. `:id` may be `latest`: the newest successful backup.

| Status | Body |
|---|---|
| `202` | [`BackupRun`](#backuprun) with `activity: "verify"`, and a `Location` header naming the backup. Poll it until `activity` is empty, then read `verified_at` or `verify_error`. |
| `400 INVALID_REQUEST` | `:id` is neither a positive number nor `latest` |
| `404 NOT_FOUND` | Unknown application or backup; `latest` when there is no successful backup |
| `409 BACKUP_NOT_USABLE` | The backup failed, so nothing was kept of it; or its files do not decrypt with the agent's passphrase |
| `409 BACKUP_BUSY` | The backup is still running, or being verified or restored |

A verification adds an event of `type: "backup"` to the application's feed whether it succeeds or not.

### POST /applications/:name/backups/:id/restore

Replaces the application's volumes with the backup's archives, one after the other. As with [`PUT …/archive`](#put-applications-name-volumes-volume-archive), the application must be stopped and stays stopped, and each restored volume adds the same application event.

| Status | Body |
|---|---|
| `202` | [`BackupRun`](#backuprun) with `activity: "restore"`, and a `Location` header naming the backup. Poll it until `activity` is empty, then read `restored_at` or `restore_error`. |
| `400 INVALID_REQUEST` | `:id` is not a positive number |
| `404 NOT_FOUND` | Unknown application or backup; the backup holds a volume the active deployment no longer mounts |
| `409 APPLICATION_RUNNING` | The application is not stopped |
| `409 BACKUP_NOT_USABLE` | The backup failed, or does not decrypt |
| `409 BACKUP_BUSY` | The backup is still running, or being verified or restored |

### GET /applications/:name/backups/:id/volumes/:volume/archive

One volume of a backup as a tar archive, decrypted. The body **is** the archive, streamed like [`GET …/volumes/:volume/archive`](#get-applications-name-volumes-volume-archive).

| Status | Body |
|---|---|
| `200` | The archive, `Content-Type: application/x-tar`, with `Content-Length` set to its size and `Content-Disposition: attachment; filename="<app>-<volume>-backup-<id>.tar"` |
| `400 INVALID_REQUEST` | `:id` is not a positive number; invalid volume name |
| `404 NOT_FOUND` | Unknown application, backup or volume |
| `409 BACKUP_NOT_USABLE` | The backup failed; or it does not decrypt, when that shows in its first chunk |
| `409 BACKUP_BUSY` | The backup is still running, or being verified or restored |

A backup that turns out not to decrypt later in the stream ends the connection short of `Content-Length`.

### DELETE /applications/:name/backups/:id

Removes the backup's files from the directory and the bucket, then its record.

| Status | Body |
|---|---|
| `204` | None |
| `400 INVALID_REQUEST` | `:id` is not a positive number |
| `404 NOT_FOUND` | Unknown application or backup |
| `409 BACKUP_BUSY` | The backup is still running, or being verified or restored |

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
    "last_used_at": "2026-03-01T10:42:00Z",
    "applications": ["my-api", "web"], "expires_at": "2027-01-01T00:00:00Z" }
] }
```

`last_used_at` is `null` until the token is first used, and is then kept to the minute: it says whether a token is still in use, not what it did last; a request refused because the token had expired is not a use. `applications` is empty for a token that is not limited, `expires_at` is `null` for one that does not expire. A token whose `expires_at` has passed stays listed until it is revoked.

### POST /tokens

Creates a token. The value is in this response and nowhere else: the agent stores its SHA-256 and nothing else.

```json
{ "name": "ci", "role": "deploy" }
```

Two optional fields narrow the token:

```json
{ "name": "ci", "role": "deploy",
  "applications": ["my-api", "web"], "expires_at": "2027-01-01T00:00:00Z" }
```

| Field | Type | |
|---|---|---|
| `name` | string | Required. Lowercase letters, digits and dashes, starting and ending with a letter or digit, at most 40 characters. Unique; `root` is taken. |
| `role` | string | Required. `read`, `deploy` or `admin`. |
| `applications` | array of strings | Optional. Limits a `deploy` token to those applications, see [Authentication](#authentication): one to 50 application names, which need not exist yet. With another role it is `400`. |
| `expires_at` | timestamp | Optional. An RFC 3339 time in the future, after which the token is `401 TOKEN_EXPIRED`. A time that has passed is `400`. |

The body is limited to 4096 bytes. Unknown fields are rejected. Since 0.7 `applications` and `expires_at` can be changed afterwards with [`PUT /tokens/:name`](#put-tokens-name). An agent before 0.6 answers a request with either field `400 INVALID_REQUEST`, `unknown field`, and creates nothing.

| Status | Body |
|---|---|
| `201` | [`CreatedToken`](#createdtoken) |
| `400 INVALID_REQUEST` | Missing or invalid `name` or `role`; `applications` with a role other than `deploy`, with a name that is not an application name, or with more than 50 of them; an `expires_at` that has passed; invalid JSON, unknown field, body too large |
| `409 TOKEN_EXISTS` | A token with that name exists |

```json
{
  "data": {
    "id": 3, "name": "ci", "role": "deploy", "created_at": "2026-03-01T10:00:00Z",
    "token": "swk_Xk3nM9…", "applications": [], "expires_at": null
  }
}
```

The answer carries `applications` sorted, each once. Values are 32 random bytes in unpadded base64url behind the prefix `swk_`, which is not part of the secret; it exists so that a token is recognizable where it must not be, such as a log or a repository.

### PUT /tokens/:name

Since 0.7. Changes what the body names and leaves the rest. The value and the role do not change.

```bash
curl -X PUT …/tokens/ci -d '{"applications": ["my-api", "web", "worker"]}'
curl -X PUT …/tokens/ci -d '{"applications": []}'                      # lifts the limit
curl -X PUT …/tokens/ci -d '{"expires_at": "2027-04-01T00:00:00Z"}'
curl -X PUT …/tokens/ci -d '{"never_expires": true}'
```

| Field | Type | |
|---|---|---|
| `applications` | array of strings | Replaces the list the token is limited to; `[]` lifts the limit. Checked as on [`POST /tokens`](#post-tokens): valid names, at most 50, and only for a `deploy` token |
| `expires_at` | timestamp | Moves the end; it must be in the future. A token that has expired works again from its next request |
| `never_expires` | boolean | `true` takes the end away. Not together with `expires_at` |

| Status | Body |
|---|---|
| `200` | [`Token`](#token), as `GET /tokens` lists it |
| `400 INVALID_REQUEST` | A body that names none of the three; `expires_at` together with `never_expires`; an `expires_at` that has passed; `applications` on a token that is not a `deploy` token, or names that are not application names, or more than 50; an unknown field, the role and the value among them; `:name` is `root` |
| `404 NOT_FOUND` | No token by that name |

The change holds from the token's next request. In the audit trail the action is `token.update`, the target the token, and the detail what changed, as it was and as it is: `applications my-api -> my-api web worker`, `applications my-api web -> all`, `expires 2026-10-02T12:00:00Z -> 2027-04-01T00:00:00Z`, `expires … -> never`, or `nothing changed`. An agent before 0.7 has no `PUT` on this path and changes nothing.

### DELETE /tokens/:name

Revokes a token. Requests with it are `401` from then on. A token may revoke itself.

| Status | Body |
|---|---|
| `204` | None |
| `400 INVALID_REQUEST` | `:name` is `root` (the root token is changed on the agent, not here), or not a valid token name |
| `404 NOT_FOUND` | No token by that name |

### GET /audit

Every request that changes something leaves an entry, whatever became of it. This endpoint lists them, newest first.

| Parameter | Default | |
|---|---|---|
| `application` | all applications | Matches exactly |
| `actor` | all callers | A token's name, or the name of a person who signed in. Matches exactly. |
| `actor_kind` | both | `token` or `user`. Since 0.7 |
| `action` | all actions | An action as listed below, or the start of a family with its dot: `token.` is `token.create`, `token.update` and `token.revoke`. Several are given by repeating the parameter or separated by commas, at most 20; an entry matches when one of them does. Since 0.7 |
| `outcome` | all outcomes | `ok`, `refused`, `failed`; several the same way. Since 0.7 |
| `since` | no limit | A number of days or hours back (`7d`, `24h`), a date (`2026-09-01`, from its start in UTC) or an RFC 3339 time |
| `limit` | `50` | 1 to 500 |
| `before` | none | The `id` of the last entry of the page before; the list continues after it. |

Each parameter narrows the others.

| Status | Body |
|---|---|
| `200` | Array of [`AuditEntry`](#auditentry), and since 0.7 `more` next to `data` |
| `400 INVALID_REQUEST` | Invalid `application`, `actor`, `actor_kind`, `action`, `outcome`, `since`, `limit` or `before` |

```json
{ "data": [
  { "id": 42, "at": "2026-10-03T17:20:17.276658220Z",
    "actor": { "kind": "token", "name": "ci" },
    "address": "172.18.0.3", "forwarded_for": "203.0.113.40",
    "action": "deploy", "application": "my-api", "target": "",
    "outcome": "ok", "status": 202, "code": "", "detail": "deployment 12" }
], "more": true }
```

`more`, since 0.7, says whether entries older than the last one match as well: `false` on the last page, also when that page is exactly full. An agent before 0.7 leaves it out, and there a page shorter than `limit` is the only sign of the end. Such an agent does not know `actor_kind`, `action` and `outcome` either, and ignores them: a client that sends one and finds no `more` in the answer has been given the unfiltered trail.

| Field | |
|---|---|
| `actor` | Who made the request: `kind` is `"token"` and `name` the token's name (`root` for the agent's own), or `kind` is `"user"` and `name` the name of a person who signed in: the e-mail address, or what `SHIPWICK_OIDC_NAME_CLAIM` names them by |
| `address` | Where the connection came from. Behind the proxy this is the proxy. |
| `forwarded_for` | The client address the proxy reported in `X-Forwarded-For`, `""` without one. On a connection that does not come through the proxy the header is the caller's own word, which is why both are kept. |
| `action` | What was asked for, see below |
| `application` | The application it was about, `""` for what is not about one |
| `target` | What else the request named: the job, the volume, the backup's id, the secret, the registry, the hostname of a certificate, the token |
| `outcome` | `ok`: answered 2xx; for what runs in the background, accepted. `refused`: `403`, the role or the application limit. `failed`: anything else. |
| `status`, `code` | The HTTP status of the answer, and the error code of one that was not 2xx |
| `detail` | What was started (`deployment 12`, `run 4`, `backup 7`, `export 3`), or what was asked for: a created token's role, applications and expiry; the volume of a backup download; `stopped` and `overwrite` of an import; the applications of an export |

Actions: `deploy`, `redeploy`, `rollback`, `stop`, `start`, `application.delete`, `run`, `job.run`, `image.upload`, `static.upload`, `backup.create`, `backup.verify`, `backup.restore`, `backup.download`, `backup.delete`, `server.backup`, `backup.adopt`, `volume.download`, `volume.restore`, `volume.delete`, `secret.set`, `secret.delete`, `registry.login`, `registry.logout`, `certificate.set`, `certificate.delete`, `token.create`, `token.update`, `token.revoke`, `key.rotate`, `export.download` (`POST /export`), `export.create` (`POST /exports`), `import`, `standby.pull`, `standby.promote`, `audit.export`, and `signin`, `signout`, `access.grant`, `access.revoke` and `access.signout`, which are described with [their endpoints](#post-auth-exchange). Every endpoint that is not a `GET` is recorded, except `validate` and `images/missing`, which change nothing; of the `GET`s, the three that hand data out whole — a volume's archive, a backup's, and the export of this trail — are.

Not recorded: reading; a request without a valid token, which has no actor (it is in the agent's log, and counted by the rate limit); what the agent does on its own, such as scheduled jobs, backups and exports, and restarts by the supervisor. Nothing from a request's body is kept except names: no `env`, no secret's value, no command, no passphrase.

Entries are kept for a year, and the newest 100,000 at most. An agent before 0.6 answers `404 ENDPOINT_NOT_FOUND`. See [See who changed what](/docs/tasks/audit).

### GET /audit/export

Since 0.7. Streams everything that matches, newest first, as it is read from the database, 500 entries at a time. It takes the filters of [`GET /audit`](#get-audit) — `application`, `actor`, `actor_kind`, `action`, `outcome`, `since` — without `limit` and `before`, which are `400` here.

| Parameter | Default | |
|---|---|---|
| `format` | required | `csv` or `json` |

| `format` | `Content-Type` | |
|---|---|---|
| `csv` | `text/csv; charset=utf-8` | A header row, then one row per entry with the columns below; `at` in UTC to the second. A cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage return gets an apostrophe in front, so that a spreadsheet shows it as text instead of running it as a formula |
| `json` | `application/x-ndjson` | One entry per line, the object `GET /audit` returns, values as recorded. Nothing matching is an empty body |

```text
id,at,actor_kind,actor,address,forwarded_for,action,application,target,outcome,status,code,detail
42,2026-10-03T17:20:17Z,token,ci,172.18.0.3,203.0.113.40,deploy,my-api,,ok,202,,deployment 12
41,2026-10-03T17:19:02Z,token,root,172.18.0.3,203.0.113.9,token.revoke,,'=HYPERLINK(…),failed,400,INVALID_REQUEST,
```

| Status | Body |
|---|---|
| `200` | The stream, not wrapped in `data`, with `Content-Disposition: attachment; filename="shipwick-audit-<time>.csv"` (`.ndjson`) |
| `400 INVALID_REQUEST` | No `format`, or one that is neither; `limit` or `before`; an invalid filter |

An export that breaks off after its first byte cannot change its status any more: it announces the trailer `X-Shipwick-Export-Error` and sets it, as [`POST /export`](#post-export) does, and a client must treat a body with that trailer as incomplete. Errors before the first byte are regular error responses.

The export is recorded as `audit.export` with the format, the filters and the number of entries in `detail` (`csv, action token., since 2026-01-01T00:00:00Z, 214 entries`); the entry is written when the export ends and is not part of it. An agent before 0.7 answers `404 ENDPOINT_NOT_FOUND`.

### GET /auth

Says whether people can sign in, and where to send a browser. It takes no token; all of it is public.

| Status | Body |
|---|---|
| `200` | [`SignInConfig`](#signinconfig) |
| `502 SIGN_IN_UNAVAILABLE` | The provider's discovery document cannot be read |

```json
{ "data": { "configured": true,
            "issuer": "https://accounts.example.com",
            "authorization_endpoint": "https://accounts.example.com/authorize",
            "client_id": "shipwick",
            "scopes": ["openid", "email", "profile"],
            "redirect_uri": "https://dashboard.example.com/auth/callback" } }
```

Without a provider it answers `{"configured": false, …}` with the other fields empty. A provider is configured on the agent with `SHIPWICK_OIDC_ISSUER`, `SHIPWICK_OIDC_CLIENT_ID` and `SHIPWICK_OIDC_CLIENT_SECRET`; see [Agent configuration](/docs/reference/agent-configuration). `redirect_uri` is `https://` + `SHIPWICK_DASHBOARD_DOMAIN` + `/auth/callback`, from the agent's configuration and never from a request.

The flow is the authorization-code flow with PKCE, and it is the dashboard's server that drives it; the client secret never leaves the agent. The caller generates three random values of 32 bytes each, base64url without padding: `state`, `nonce` and the PKCE `code_verifier`. It keeps them with the browser, and redirects it to `authorization_endpoint` with `response_type=code`, `client_id`, `redirect_uri`, `scope` (the scopes joined by spaces), `state`, `nonce`, `code_challenge` (the base64url SHA-256 of the verifier) and `code_challenge_method=S256`. When the provider sends the browser back with `code` and `state`, the caller compares `state` with what it kept and hands the rest to [`POST /auth/exchange`](#post-auth-exchange).

### POST /auth/exchange

Turns the code the provider sent the browser back with into a session. It takes no token.

```http
POST /api/v1/auth/exchange
Content-Type: application/json

{ "code": "…", "code_verifier": "…", "nonce": "…",
  "redirect_uri": "https://dashboard.example.com/auth/callback" }
```

| Field | Type | |
|---|---|---|
| `code` | string | Required. The one the provider appended to the callback. |
| `code_verifier` | string | Required. The PKCE verifier whose S256 challenge went to the provider, 43 to 128 characters. |
| `nonce` | string | Required. The one sent to the provider, at least 22 characters of base64url. |
| `redirect_uri` | string | Required. The `redirect_uri` of [`GET /auth`](#get-auth). |

| Status | Body |
|---|---|
| `200` | [`SignedIn`](#signedin) |
| `400 INVALID_REQUEST` | A field is missing or malformed, or `redirect_uri` is not the configured one (`details: {redirect_uri}`) |
| `401 SIGN_IN_FAILED` | The sign-in itself was refused; `details.reason` says why, see below |
| `403 ACCESS_NOT_GRANTED` | The person is who they say, and no rule gives them a role; `details: {name, email}`, both the person's name (`name` since 0.7; `email` is kept for clients from before). The message is written to be forwarded to an admin. |
| `409 SIGN_IN_NOT_CONFIGURED` | The agent has no provider |
| `429 RATE_LIMITED` | Failed sign-ins count like wrong tokens, see [Authentication](#authentication); a limited address is answered without the provider being asked |
| `502 SIGN_IN_UNAVAILABLE` | The provider could not be reached, did not answer like one, calls itself by another issuer, or refused the agent's client id or secret |

```json
{ "data": { "session": "sws_Zm9v…",
            "identity": { "kind": "user", "name": "ada@example.com", "role": "deploy",
                          "applications": ["my-api"], "expires_at": "2026-10-03T19:00:00Z" } } }
```

`session` is in this response and nowhere else; the agent keeps its SHA-256. It is presented like a token, `Authorization: Bearer sws_…`.

The agent redeems the code at the provider's token endpoint with the client secret and the verifier, and believes the ID token only if it is signed by one of the provider's keys (RS256 or ES256), was issued by the configured issuer for this client, is within its time and at most ten minutes old, and carries `nonce`. It accepts each nonce once. An `email_verified: false` is refused; a provider that does not send the claim is taken at its word. Then the [access rules](#get-access-rules) are asked what the person may do.

The person's name — `identity.name`, the actor in the audit trail, `by` on a deployment — is the `email` claim in lowercase, or, since 0.7, the value of the claim the agent is configured with (`SHIPWICK_OIDC_NAME_CLAIM`; `sign_in.name_claim` in [`GET /server`](#get-server)), which is kept as the provider wrote it: at most 254 characters of letters, digits and `. _ % + ' @ | : = # ~ -`. With another claim than `email`, `email_verified` is not looked at.

With Microsoft Entra's issuer for several tenants (`https://login.microsoftonline.com/organizations/v2.0`, or `common`), whose discovery document names `https://login.microsoftonline.com/{tenantid}/v2.0` as its issuer, "issued by the configured issuer" reads, since 0.7: the token's `iss` is that template with the token's own `tid` in the placeholder's place, `tid` is a tenant id, a key that names the issuer it signs for names that one, and `tid` is among `SHIPWICK_OIDC_TENANTS`. No other provider's discovery document may name an issuer other than the configured one.

| `details.reason` of `SIGN_IN_FAILED` | Meaning |
|---|---|
| `code_rejected` | The provider refused the code: used before, expired, issued to another client or for another verifier |
| `invalid_id_token` | Signature, issuer, audience or times |
| `nonce_mismatch` | The ID token answers another sign-in |
| `nonce_reused` | This sign-in was completed before |
| `email_missing` | The ID token names no usable address |
| `email_not_verified` | The provider says the address is not verified |
| `name_missing` | People are named by another claim than `email`, and the ID token lacks it or holds something that cannot be a name; `details.claim` says which claim. Since 0.7 |
| `tenant_not_allowed` | The account's tenant is not among `SHIPWICK_OIDC_TENANTS`. Since 0.7 |

A session lasts ten hours from the sign-in, whatever its use. It rests on what the rules gave the person then: every request asks the rules again, and a session whose answer has changed is ended with that request, not at its expiry. A session that no longer works says why, to its holder only, like an expired token, and like it not counted by the rate limit:

```json
{
  "error": {
    "code": "SESSION_ENDED",
    "message": "no rule on this server gives ada@example.com a role any more. An admin grants one with: shipwick access grant ada@example.com --role read",
    "details": { "name": "ada@example.com", "reason": "rule_removed" }
  }
}
```

`reason` is `rule_removed`, `access_changed` (the rules give the person something else now: sign in again to get it), `signed_out` (an admin ended it) or, since 0.7, `sign_in_changed` (the agent now names people by another claim than when the session began, or no longer accepts the tenant it came from). A session past its time is `401 SESSION_EXPIRED` with `details: {name, expired_at}`. A session nobody issued is a wrong token: `401 UNAUTHORIZED`, counted.

A sign-in is recorded in the [audit trail](#get-audit) as `signin`: the actor is the person, and the outcome is `ok` with what they got in `detail`, or `refused` with `ACCESS_NOT_GRANTED`. A `signin` from a provider with tenants has `tenant <id>` at the end of its detail. A sign-in the provider did not vouch for has no actor and is not recorded. See [Sign in with your company's accounts](/docs/tasks/sign-in).

### DELETE /auth/session

Forgets the session the request is made with. No body.

| Status | Body |
|---|---|
| `204` | None |
| `400 INVALID_REQUEST` | The request was made with a token: a token is revoked, not signed out |

Recorded in the audit trail as `signout`.

### GET /access/rules

Who may sign in, and as what.

| Status | Body |
|---|---|
| `200` | Array of [`AccessRule`](#accessrule) |

```json
{ "data": [
  { "id": 1, "kind": "email",  "subject": "ada@example.com", "role": "admin",  "applications": [],
    "created_at": "2026-10-03T09:00:00Z", "created_by": "root" },
  { "id": 2, "kind": "group",  "subject": "backend",         "role": "deploy", "applications": ["my-api", "worker"],
    "created_at": "2026-10-03T09:01:00Z", "created_by": "ada@example.com" },
  { "id": 3, "kind": "domain", "subject": "example.com",     "role": "read",   "applications": [],
    "created_at": "2026-10-03T09:02:00Z", "created_by": "root" }
] }
```

| `kind` | `subject` | Matches |
|---|---|---|
| `email` | An address, lowercase | The person whose name is that address, in any case |
| `group` | A group's name as the provider sends it, case and all | A person whose groups claim (`SHIPWICK_OIDC_GROUPS_CLAIM`, `groups` by default) lists it. Not read where every tenant may sign in (`SHIPWICK_OIDC_TENANTS=*`) |
| `domain` | The part after the `@` | Every name that is an address at exactly that domain; a subdomain is another domain |
| `name` | A name as the provider's claim holds it, case and all | The person whose name is exactly that: for names that are not addresses (`SHIPWICK_OIDC_NAME_CLAIM`). Since 0.7 |

The name is the `email` claim unless the agent is configured otherwise; a name that does not read as an address is matched by `name` and `group` rules only.

The most specific kind that matches decides, and the others are not looked at: the rule for the name, else the rule for the address, else the rules for the person's groups, else the rule for the domain. A rule for an address can therefore give one person less than their group has. Of several groups the highest role counts; where that is `deploy`, a group without `applications` lifts the limit, and the lists of the others add up. Nobody without a matching rule gets in.

### POST /access/rules

Gives an address, a group, a domain or a name a role: creates the rule, or replaces the one with the same kind and subject.

```json
{ "kind": "group", "subject": "backend", "role": "deploy", "applications": ["my-api", "worker"] }
```

| Field | Type | |
|---|---|---|
| `kind` | string | Required. `email`, `group`, `domain` or, since 0.7, `name`. |
| `subject` | string | Required. The address, the group's name, the domain or the name; see [`GET /access/rules`](#get-access-rules). |
| `role` | string | Required. `read`, `deploy` or `admin`. |
| `applications` | array of strings | Optional. For `deploy` only, as on a [token](#post-tokens). |

| Status | Body |
|---|---|
| `201` | [`AccessRule`](#accessrule), when the rule was created |
| `200` | [`AccessRule`](#accessrule), when it replaced the one with the same kind and subject |
| `400 INVALID_REQUEST` | A missing or invalid `kind`, `subject` or `role`; `applications` with a role other than `deploy`; invalid JSON; the 201st rule |

At most 200 rules are stored. Rules can be written before a provider is configured. Recorded in the audit trail as `access.grant`: the target is the subject as the CLI writes it (`ada@example.com`, `group:backend`, `*@example.com`, `name:svc-deploy`), the detail the role and applications.

### DELETE /access/rules/:id

Removes a rule. Sessions that rested on it end with their next request.

| Status | Body |
|---|---|
| `204` | None |
| `400 INVALID_REQUEST` | `:id` is not a positive number |
| `404 NOT_FOUND` | No rule with that id |

Recorded in the audit trail as `access.revoke`.

### GET /access/sessions

Who is signed in right now.

| Status | Body |
|---|---|
| `200` | Array of [`Session`](#session) |

```json
{ "data": [ { "id": 7, "email": "ada@example.com", "role": "deploy", "applications": ["my-api"],
              "created_at": "2026-10-03T09:00:00Z", "expires_at": "2026-10-03T19:00:00Z",
              "last_used_at": "2026-10-03T09:41:00Z" } ] }
```

`email` is the person's name: the address, or with another name claim what that claim holds. The field keeps its name from when there was only one.

### DELETE /access/sessions/:email

Ends every session of that person. The path takes the name as [`GET /access/sessions`](#get-access-sessions) shows it; an address is brought to lowercase where people are named by `email`, and any other name must match exactly. It signs out and does not keep out: while a rule covers the person, they can sign in again.

| Status | Body |
|---|---|
| `200` | [`SignedOut`](#signedout): the number of sessions ended |
| `400 INVALID_REQUEST` | `:email` is not an e-mail address, or, where people are named by another claim, not a name |

```json
{ "data": { "sessions": 2 } }
```

Recorded in the audit trail as `access.signout`, with the name as the target.

### GET /secrets

The secrets stored on the server, by name, without values. A secret is a value for `${NAME}` in the `env` values of a `deploy.yaml` and in the passwords of its `proxy.basic_auth`, kept on the server so that no client has to hold it; the agent fills it in when a deployment is recorded. See [Placeholders](/docs/reference/deploy-yaml#placeholders).

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

### GET /registries

The registries the agent holds a credential for, by name, without passwords. A credential is what the agent sends when it pulls an image from a private registry.

| Status | Body |
|---|---|
| `200` | Array of [`Registry`](#registry) |

```json
{ "data": [
  { "registry": "ghcr.io", "username": "octocat",
    "created_at": "2026-03-01T10:00:00Z", "updated_at": "2026-03-01T10:42:00Z" }
] }
```

Every pull (a deployment, a rollback, a job, a replica whose image is gone) looks the credential up by the image's registry. Without one, the Docker configuration file on the server is consulted, as before. A pull the registry refuses for authentication fails the deployment with an `error` that names the command: `pull access denied for ghcr.io/company/api: run shipwick registry login ghcr.io (or check the image name)`. See [Pull from private registries](/docs/tasks/private-registries).

### PUT /registries/:registry

Checks a credential against its registry and stores it, creating or replacing it.

```bash
curl -X PUT …/registries/ghcr.io -d '{"username": "octocat", "password": "ghp_…"}'
```

| Field | Type | |
|---|---|---|
| `username` | string | Required. At most 255 characters, without a colon or control characters. |
| `password` | string | Required. At most 16 KB, not empty, without NUL bytes. |

`:registry` is a hostname with an optional port, as image references name it (`ghcr.io`, `registry.example.com:5000`), compared in lower case; `index.docker.io` and `registry-1.docker.io` are `docker.io`. Unknown fields are rejected. At most 50 registries are stored.

| Status | Body |
|---|---|
| `204` | None, whether the credential was created or replaced |
| `400 INVALID_REQUEST` | A scheme or a path in `:registry`; invalid username or password, invalid JSON, unknown field, body too large, or the 51st registry |
| `400 REGISTRY_LOGIN_FAILED` | The registry refused the credential, or could not be asked. Nothing was stored. |

Before anything is stored the agent has the Docker daemon check the credential against the registry (the Engine API's login, which keeps nothing). A registry that says no, or that cannot be reached within 30 seconds, is `400`:

```json
{ "error": { "code": "REGISTRY_LOGIN_FAILED",
             "message": "ghcr.io refused the login: denied: denied",
             "details": { "registry": "ghcr.io", "refused": true } } }
```

`message` ends with the registry's own answer. `refused` is `false` when the registry could not be asked (a name that does not resolve, a registry that is down), and the message then says why.

The password is written encrypted (AES-256-GCM, bound to the registry's name) and is never returned, logged or repeated in an error.

### DELETE /registries/:registry

Removes a registry's credential.

| Status | Body |
|---|---|
| `204` | None |
| `400 INVALID_REQUEST` | `:registry` is not a registry name |
| `404 NOT_FOUND` | No credential is stored for it |

### GET /certificates

The certificates you supplied, in hostname order: what each says about itself, never the key or the PEM. Such a certificate is for hostnames whose certificate does not come from the proxy's authority. It belongs to the server: every hostname it covers, of any application, is served with it, is not asked of any authority and does not wait for DNS.

| Status | Body |
|---|---|
| `200` | Array of [`Certificate`](#certificate) |

An expired certificate stays listed, and served, until it is replaced or removed. The certificate the proxy actually presents for each hostname of an application is in [the application detail](#get-applications-name).

### PUT /certificates/:hostname

Stores a certificate and its key under a hostname, creating or replacing it.

```bash
curl -X PUT …/certificates/example.com \
  -d '{"certificate": "-----BEGIN CERTIFICATE-----\n…", "key": "-----BEGIN PRIVATE KEY-----\n…"}'
```

| Field | Type | |
|---|---|---|
| `certificate` | string | Required. The chain in PEM, the hostname's own certificate first. At most 64 KB. |
| `key` | string | Required. Its private key in PEM, without a passphrase. At most 64 KB. |

`:hostname` is a hostname as in `deploy.yaml`, lower-cased; a wildcard certificate is stored under the wildcard, `/certificates/*.example.com`. The body is at most 513 KB; unknown fields are rejected. At most 50 certificates are stored.

| Status | Body |
|---|---|
| `200` | [`Certificate`](#certificate), as stored |
| `400 INVALID_REQUEST` | `:hostname` is not a hostname; a missing or oversized `certificate` or `key`, invalid JSON, unknown field, body too large, or the 51st certificate |
| `400 INVALID_CERTIFICATE` | The certificate or key cannot serve the hostname; `message` says why |

```json
{ "data": {
  "hostname": "example.com",
  "subjects": ["example.com", "*.example.com"],
  "issuer": "Corp Issuing CA",
  "not_before": "2026-09-01T00:00:00Z",
  "not_after": "2027-09-01T00:00:00Z",
  "created_at": "2026-10-03T10:00:00Z",
  "updated_at": "2026-10-03T10:00:00Z"
} }
```

The agent checks before it stores, and answers `400 INVALID_CERTIFICATE` with the reason as `message`: the chain is not PEM or holds something other than certificates; a certificate in it cannot be read; the key is not PEM, is protected by a passphrase, or does not belong to the first certificate; the certificate has no DNS names, does not cover the hostname (`the certificate does not cover example.org: it is for example.com, *.example.com`), has expired (`the certificate expired on 2026-09-01`) or is not valid yet. A wildcard name covers exactly one label, and a wildcard hostname is covered only by the same wildcard. Whether the chain leads to an authority browsers trust is not checked: a private authority's certificate is a use of this.

`subjects` are the DNS names of the chain's first certificate, `issuer` its issuer's common name (the organization, when it has none). The key is written encrypted (AES-256-GCM, the hostname as additional data) and is never returned, logged or repeated in an error; the PEM is not returned either. The proxy is updated before the request is answered. See [Certificates](/docs/tasks/certificates).

### DELETE /certificates/:hostname

Removes a certificate. The hostnames it covered go back to certificates the proxy obtains, and to waiting for DNS.

| Status | Body |
|---|---|
| `204` | None |
| `400 INVALID_REQUEST` | `:hostname` is not a hostname |
| `404 NOT_FOUND` | Nothing is stored under that hostname |

A deployed wildcard hostname that loses its certificate this way is no longer served while the agent has no DNS challenge; a new deployment that names one is refused:

```json
{ "error": { "code": "INVALID_CONFIG", "message": "invalid deploy.yaml",
             "details": { "fields": [ {
               "field": "domain",
               "message": "a certificate for a wildcard is issued only through a DNS record, and the agent is not set up for that",
               "expected": "SHIPWICK_CLOUDFLARE_API_TOKEN on the agent, or a certificate of your own: shipwick cert set '*.example.com' --cert fullchain.pem --key privkey.pem" } ] } } }
```

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

### POST /export

Streams an export: everything the server would need to be built again elsewhere. That is every application's active configuration with its values in clear, the stored secrets, registry credentials and certificates, the images that exist only on the server, the folders of static applications and an archive of every volume. It exists only encrypted, in the format backups use.

```json
{ "passphrase": "at least twelve characters", "applications": ["db", "api"] }
```

| Field | Type | |
|---|---|---|
| `passphrase` | string | Required. At least 12 characters. It encrypts the file; the agent keeps nothing of it. |
| `applications` | array of strings | Optional. Limits the export to those applications. |

Unknown fields are rejected.

| Status | Body |
|---|---|
| `200` | The export, `Content-Type: application/octet-stream`, with `Content-Disposition: attachment; filename="shipwick-export-<UTC yyyymmdd-hhmmss>.swexport"`, sent chunked: the length is not known beforehand |
| `400 INVALID_REQUEST` | Invalid JSON or an unknown field; a passphrase shorter than 12 characters; an invalid application name |
| `404 NOT_FOUND` | `applications` names an unknown application |
| `409 DEPLOYMENT_IN_PROGRESS` | An application is being deployed when the export begins; the message names it |

What fails before the first byte is an ordinary error. What fails later ends the body without the file's last chunk, so that it does not decrypt, and says why in the trailer `X-Shipwick-Export-Error`. A client should read what it received to its end with the passphrase before calling it an export. Nothing is written on the server. See [Move to a new server](/docs/tasks/move-to-a-new-server).

### POST /import

Takes an export as the body, with `Content-Type: application/octet-stream`, and its passphrase in the header `X-Shipwick-Passphrase`, base64-encoded. The agent imports the file as it arrives, storing nothing of it, and answers when every application in it has been dealt with, which takes as long as their deployments; a client must not time the request out.

| Parameter | Default | |
|---|---|---|
| `stopped` | `false` | `true` deploys every application without starting it, and then replaces only applications that are stopped |
| `overwrite` | `false` | `true` replaces what exists under the same name, applications with their volumes |

| Status | Body |
|---|---|
| `200` | [`Import`](#import), also when applications in it failed |
| `400 INVALID_REQUEST` | The body is not sent as `application/octet-stream`; an invalid `stopped` or `overwrite`; no passphrase header, or one that is not base64 |
| `400 INVALID_EXPORT` | The body is not an export, the passphrase does not match, or the file breaks off. What had been imported until then stays, and `GET /import` shows it. |
| `409 IMPORT_IN_PROGRESS` | An import is running; a server takes one at a time |
| `409 PROMOTION_IN_PROGRESS` | Nothing is imported into a server while it is being promoted |
| `503 RUNTIME_UNAVAILABLE` | The agent is shutting down |

```json
{
  "status": "failed",
  "source": "upload",
  "stopped": false,
  "overwrite": false,
  "started_at": "2026-03-01T04:10:00Z",
  "completed_at": "2026-03-01T04:11:32Z",
  "exported_at": "2026-03-01T04:00:00Z",
  "secrets": 2,
  "registries": 1,
  "certificates": 0,
  "applications": [
    { "name": "postgres", "status": "imported", "version": "17", "deployment_id": 1,
      "volumes": ["data"], "message": "" },
    { "name": "my-api", "status": "skipped", "version": "1.4.2", "deployment_id": null,
      "volumes": [], "message": "it exists on this server and was left as it is; import with --overwrite to replace it and its volumes" }
  ],
  "warnings": ["DB_PASSWORD: a secret by that name exists on this server and was kept; --overwrite replaces it"],
  "error": ""
}
```

`status` is `running`, `succeeded` or `failed`: failed when an application failed or the import could not go on, which `error` then explains. An application's `status` is `pending`, `importing`, `imported`, `skipped` (it exists, or runs, and was left alone) or `failed`; `message` says why and what to do. `volumes` are the volumes that were filled before the application first started. A deployment made by an import has the `kind` `import`, or `standby` when it was deployed stopped for a standby.

The configuration of every application in an export is validated by the rules a `deploy.yaml` is held to, all of them, before anything of the application is touched; one that does not pass is `failed` with the fields and what is wrong with each in `message`, and the import goes on with the next.

### GET /import

The import that is running, or ran last, in the same shape: poll it from a second connection to follow an upload.

| Status | Body |
|---|---|
| `200` | [`Import`](#import) |
| `404 NOT_FOUND` | The server has run no import |

The record outlives the agent that wrote it. An import does not: it ends with the upload or the download that feeds it, so an import the agent was restarted under is `failed`, and says so. A deployment it had begun is resumed like any other, and an application that was being deployed stopped stays stopped.

### GET /exports

The exports written to where backups go, newest first. Each is a record shaped like a backup whose one "volume" is `export.tar`. With [`SHIPWICK_EXPORT_SCHEDULE`](/docs/reference/agent-configuration#shipwick-export-schedule-and-shipwick-export-keep) the agent writes one on a schedule, with the trigger `schedule`.

| Parameter | Default | |
|---|---|---|
| `limit` | `50` | 1 to 500 |

| Status | Body |
|---|---|
| `200` | Array of [`BackupRun`](#backuprun) |
| `400 INVALID_REQUEST` | Invalid `limit` |

### GET /exports/:id

| Status | Body |
|---|---|
| `200` | [`BackupRun`](#backuprun) |
| `400 INVALID_REQUEST` | `:id` is not a positive number |
| `404 NOT_FOUND` | No such export |

### POST /exports

Writes an export of the whole server to where backups go, encrypted with the agent's `SHIPWICK_BACKUP_PASSPHRASE`. No body.

| Status | Body |
|---|---|
| `202` | [`BackupRun`](#backuprun), and a `Location` header: `/api/v1/exports/<id>`. Poll it until `completed_at` is set. |
| `409 BACKUPS_NOT_ENCRYPTED` | `SHIPWICK_BACKUP_PASSPHRASE` is not set: an export is only ever written encrypted |
| `409 EXPORT_IN_PROGRESS` | An export is being written already |
| `409 BACKUP_NOT_USABLE` | The agent was started without anywhere to keep backups |

### GET /standby

What the server holds for the day it has to take over.

| Status | Body |
|---|---|
| `200` | [`Standby`](#standby) |

```json
{
  "applications": [
    { "name": "postgres", "version": "17", "hostnames": [], "imported_at": "2026-03-01T04:15:02Z" },
    { "name": "my-api", "version": "1.4.2", "hostnames": ["api.example.com"], "imported_at": "2026-03-01T04:15:09Z" }
  ],
  "records": [{ "hostname": "api.example.com", "type": "A", "value": "203.0.113.77" }],
  "pull": { "schedule": "15 * * * *", "last_at": "2026-03-01T04:15:11Z", "last_export": 42, "last_error": "" },
  "promotion": null
}
```

`applications` were imported stopped and are still stopped, in the order a promotion starts them. `records` are the DNS records a promotion will ask for; `value` is empty when the agent does not know its own address. `pull` is `null` unless [`SHIPWICK_STANDBY_SCHEDULE`](/docs/reference/agent-configuration#shipwick-standby-schedule) is set; `last_export` is the id of the export imported last, `0` if none; both survive a restart of the agent, so an export is imported once. `promotion` is the promotion that is running or ran last, as [`GET /standby/promotion`](#get-standby-promotion) returns it, and `null` on a server that was never promoted (an agent before 0.6 leaves the field out).

### POST /standby/pull

Imports the newest export in the bucket now, stopped and overwriting. No body.

| Status | Body |
|---|---|
| `202` | [`Import`](#import) as it begins, and `Location: /api/v1/import` to poll until `completed_at` is set |
| `404 NOT_FOUND` | The bucket holds no export |
| `409 STANDBY_NOT_CONFIGURED` | The agent has no bucket to read exports from |
| `409 IMPORT_IN_PROGRESS` | An import is running |

### POST /standby/promote

Begins a promotion: the applications that were imported stopped are started in order, each waited for until it is ready or has spent its startup budget. The promotion runs on the server, whatever becomes of the request, and has a record. No body.

| Parameter | Default | |
|---|---|---|
| `wait` | `true` | `false` answers as the promotion begins. Without it the request is held until the promotion has ended. |

| Status | Body |
|---|---|
| `202` | With `wait=false`: [`Promotion`](#promotion) as it begins, and `Location: /api/v1/standby/promotion` to poll until `completed_at` is set |
| `200` | Without `wait=false`: the completed [`Promotion`](#promotion). Either way, when there is nothing to promote: a record that has completed, with `"id": 0` and no applications |
| `400 INVALID_REQUEST` | `wait` is neither `true` nor `false` |
| `409 PROMOTION_IN_PROGRESS` | A promotion is running: there is one at a time, and the record of the one that runs is the one to follow |
| `409 IMPORT_IN_PROGRESS` | An import is running |
| `503 RUNTIME_UNAVAILABLE` | The agent is stopped while the request is held |

```json
{
  "id": 1,
  "status": "running",
  "started_at": "2026-03-01T09:30:00Z",
  "completed_at": null,
  "applications": [
    { "name": "postgres", "status": "pending", "message": "" },
    { "name": "my-api", "status": "pending", "message": "" }
  ],
  "records": [{ "hostname": "api.example.com", "type": "A", "value": "203.0.113.77" }]
}
```

With nothing to promote, no promotion begins, and the record of the last promotion stays.

A promotion outlives the agent. One that an agent was restarted under is resumed by the agent that starts next, from its record: applications it had finished with keep their outcome, the one it was at is started if it is not running and waited for again, the rest follow. While the agent is away the proxy answers `502`, `503` or `504` in its place, and an agent that is shutting down answers `503`; a client keeps polling.

Without `wait=false` the request is held until the promotion has ended and answered `200` with the completed record, as agents before 0.6 answered. Those have no record: no `id`, `status` or times in the answer, and `404 ENDPOINT_NOT_FOUND` for `GET /standby/promotion`. The promotion is the same one either way; a held request that loses its connection loses only the answer, which `GET /standby/promotion` still has. See [Keep a second server ready](/docs/tasks/standby).

### GET /standby/promotion

The promotion that is running, or ran last. It returns the record while the promotion runs and after it has ended; poll it until `completed_at` is set.

| Status | Body |
|---|---|
| `200` | [`Promotion`](#promotion) |
| `404 NOT_FOUND` | The server was never promoted |

- `status` is `running`, then `succeeded`, or `failed` when at least one application could not be started.
- An application's `status` is `pending` (not reached yet), `starting` (being started, or waited for), `running` (ready), `started` (not ready within its startup budget; the supervisor has it, and `message` says what it last answered) or `failed` (it could not be started; `message` says why). One application that fails does not stop the promotion.
- `records` are the DNS records to change, fixed when the promotion begins.
- `id` counts the promotions of the server. A client that lost the answer to its `POST` reads the record: an `id` it has not seen means the request arrived.

An agent before 0.6 answers `404 ENDPOINT_NOT_FOUND`.

### GET /metrics

The Prometheus text exposition format, for a scraper. The path is `/metrics`, not under `/api/v1`. It takes `Authorization: Bearer <token>` like every other endpoint, with the `read` role.

| Status | Body |
|---|---|
| `200` | `Content-Type: text/plain; version=0.0.4`, without the envelope |

Errors (`401`, `403`, `429`) are the JSON envelope as everywhere else.

| Series | Type | |
|---|---|---|
| `shipwick_agent_info{version}` | gauge | Always 1 |
| `shipwick_application_status{application, status}` | gauge | 1 for the current status, in lower case: `healthy`, `degraded`, `down`, `crash_loop`, `stopped`, `deploying`, `failed` |
| `shipwick_application_replicas{application, state}` | gauge | `state` is `desired`, `running` or `healthy` |
| `shipwick_replica_cpu_ratio{application, replica}` | gauge | CPU in cores, from the last sample: 1 is one core kept busy |
| `shipwick_replica_memory_bytes{application, replica}` | gauge | Working set, from the last sample |
| `shipwick_replica_memory_limit_bytes{application, replica}` | gauge | Absent for a replica without a limit |
| `shipwick_replica_restarts_total{application, replica}` | counter | Restarts by the supervisor; starts again at 0 with each deployment |
| `shipwick_deployments_total{application, status}` | counter | Finished deployments; `status` is `succeeded`, `failed` or `rolled_back` |
| `shipwick_deployment_last_duration_seconds{application}` | gauge | From start to completion of the most recently completed deployment |
| `shipwick_disk_bytes{state}` | gauge | `state` is `total` or `used`, as `disk` in [`GET /server`](#get-server); absent where it cannot be measured |
| `shipwick_alerts{kind, severity}` | gauge | Number of active alerts; every combination is present, 0 when none |

- Every family has its `# HELP` and `# TYPE` lines, families come in the order above and series sorted by application and label: two scrapes of the same state are the same bytes.
- A scrape reads the database in one transaction and never asks Docker. Status and the running and healthy counts are as the supervisor saw them at its last pass, a second ago at most; during a deployment they are those from before it began. CPU and memory are the last 30-second sample of each replica; a replica without a sample in the last 75 seconds, stopped or started less than a minute ago, has no CPU and memory series.
- In the first second after the agent starts, an application the supervisor has not looked at yet has only its `desired` replicas and no status.
- `rate(shipwick_deployments_total{status="failed"}[1d])` behaves: the three outcomes only ever grow, and are present from an application's first deployment. Deleting an application removes its series.

See [Alerts and metrics](/docs/tasks/alerts-and-metrics).

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

- After `ACTIVE`, the engine may still be cleaning up, and a new operation would get `409` until `completed_at` appears.
- `FAILED` may be followed by `ROLLBACK`, `RESTORING` and `ROLLED_BACK`.

`completed_at` is stamped after cleanup and after the application's lock is released. From that moment a new operation on the application is guaranteed not to be rejected as busy.

`completed_at` does not wait for the replicas that were replaced to exit. They are out of rotation and have been sent `SIGTERM`; each then has the application's [`deploy.stop_timeout`](/docs/reference/deploy-yaml#deploy) (10s unless set) before it is killed, and is removed after that. Until then it is listed among the application's `containers` with `stopping: true`. One that had to be killed is reported in the application's [events](#get-applications-name-events), at level `warn`. A deployment that starts while one is still stopping waits for it before it starts a replica, and says how long it waited: `Waited 8s for a replaced container to stop`.

A deployment that is in flight when the agent stops, as an upgrade of Shipwick makes it do, is neither failed nor completed: the agent resumes it when it starts, and its events then include the step `Resumed after the agent restarted`. To a client that polls, the agent is unreachable for a moment and the deployment then goes on; keep polling. One that cannot be resumed ends `FAILED` with an `error` that begins `agent restarted during deployment`, or that says its pre-deploy command was interrupted: a pre-deploy command is not run a second time.

The deployments an [import](#post-import) makes are ordinary deployments with the `kind` `import` or `standby`; the import request waits for them itself.

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

On failure there is a `state` event `FAILED: <reason>` with `level: "error"` and, if a replica crashed or never became healthy, a `log` event holding its last 20 lines of output. A pre-deploy command that exits non-zero or outlives its timeout fails the deployment before any replica of the new version was started, with the reason `pre-deploy command exited 1` or `pre-deploy command timed out after 10m`, and a `log` event `Last output of the pre-deploy command:` followed by its last 20 lines, at most 4096 bytes. A rollback adds the `state` events `ROLLBACK`, `RESTORING` and `ROLLED_BACK`, and steps narrating it. A deployment that ends `FAILED` or `ROLLED_BACK` removes the image it named unless something else needs it, and says so in a step. Deployment events never change afterwards.

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

When the API is served through Caddy at `SHIPWICK_AGENT_DOMAIN`, the route is configured without response buffering, so lines still arrive one by one. The proxy compresses the API's other responses; a followed log is not compressed, since the encoder would hold its response header back until the application printed something.

## Types

All types are defined in [`pkg/api/types.go`](https://github.com/shipwick/shipwick/blob/main/pkg/api/types.go); those of signing in and the access rules are in [`pkg/api/signin.go`](https://github.com/shipwick/shipwick/blob/main/pkg/api/signin.go).

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
| `proxy` | object | `enabled`: a proxy is configured; `false` means domains are not served. `reachable`: the last configuration sync succeeded. `error`: why it did not. `routes`: hostnames being served. `dns_challenge`: certificates are obtained through a DNS record, so hostnames may stand behind Cloudflare's proxy and may be wildcards. |
| `token` | [`TokenIdentity`](#tokenidentity) | The token, or the session, this request was made with |
| `sign_in` | [`SignInStatus`](#signinstatus) | Whether people can sign in with an OpenID Connect provider. Absent from agents before 0.6. |
| `notifications` | [`NotificationStatus`](#notificationstatus) | Where the agent reports outcomes |
| `dashboard_url` | string | Where the dashboard is served; `""` when it has no hostname |
| `alerts` | array of [`Alert`](#alert) | The conditions that hold right now, oldest first; `[]` when there are none |
| `disk` | [`DiskUsage`](#diskusage) or null | Null where the agent cannot measure it |
| `backups` | [`BackupStatus`](#backupstatus) | Where backups go, and how the agent's own state is backed up |
| `network` | [`NetworkStatus`](#networkstatus) | How the agent and the Docker daemon reach what is outside the server. Absent from agents before 0.6. |
| `log_archive` | [`LogArchiveStatus`](#logarchivestatus) | What the agent keeps of ended containers' output. Absent from agents before 0.7. |
| `update` | [`UpdateStatus`](#updatestatus) | What the agent knows about newer releases. Absent from agents before 0.7. |

### LogArchiveStatus

What the log archive holds and may hold. Since 0.7.

| Field | Type | |
|---|---|---|
| `enabled` | boolean | `false` when `SHIPWICK_LOG_RETENTION_SIZE` is `0`: nothing is kept |
| `entries` | integer | How many entries are kept |
| `bytes` | integer | What they take on the disk |
| `max_bytes` | integer | What they may take |
| `retention_days` | integer | How long an entry is kept after its container ended |

### UpdateStatus

What the agent knows about newer releases. Since 0.7.

| Field | Type | |
|---|---|---|
| `enabled` | boolean | `false` when the agent was told not to ask (`SHIPWICK_UPDATE_CHECK=off`) |
| `latest_version` | string | The latest release, `v0.7.1`; `""` until the agent has been able to ask |
| `checked_at` | timestamp or null | When GitHub last answered; null until then |
| `available` | boolean | `latest_version` is newer than the agent itself |

### Alert

A condition that holds right now and that somebody should look at. It is raised once, when the condition becomes true, and is gone once it stops being true.

| Field | Type | |
|---|---|---|
| `kind` | string | `memory` (a replica close to its memory limit), `disk` (the disk that holds the agent's data is filling up), `restarts` (a replica that keeps being restarted) or `unhealthy` (an application that has not been healthy for a while) |
| `severity` | string | `warning` or `critical` |
| `application` | string | Empty for `disk` |
| `replica` | integer | Set for `memory` and `restarts`; `0` otherwise |
| `message` | string | |
| `since` | timestamp | When the alert was raised |

### DiskUsage

The filesystem that holds the agent's data directory.

| Field | Type | |
|---|---|---|
| `total_bytes` | integer | Without the blocks the filesystem reserves for root |
| `used_bytes` | integer | |

### BackupStatus

| Field | Type | |
|---|---|---|
| `destination` | string | `none`, `local` or `s3` |
| `encrypted` | boolean | `SHIPWICK_BACKUP_PASSPHRASE` is set |
| `state_last_at` | timestamp or null | When the agent's state was last backed up; null if never |
| `state_error` | string | Why the state is not backed up, or why the last attempt failed; empty when the last attempt succeeded |

### KeyRotation

The answer to [`POST /server/rotate-key`](#post-server-rotate-key).

| Field | Type | |
|---|---|---|
| `values` | integer | The re-encrypted values outside deployments: secrets, registry passwords, the keys of supplied certificates and, since 0.7, the references kept for deployments |
| `deployments` | integer | The deployment records whose environment values were re-encrypted |
| `key_source` | string | `file` when the agent keeps its key in the data directory and has replaced it there; `environment` when the key is set in the agent's environment, which the agent cannot change |
| `key_file` | string | The file on the server that holds the new key: the key file, or, for `environment`, the file the agent keeps it in until it has been started with it |
| `key` | string | The new key. Present for `environment` only: this response is the one time the API shows it. |

### TokenIdentity

Who a request was made as. An agent before 0.6 sends `name` and `role` only.

| Field | Type | |
|---|---|---|
| `name` | string | The token's name; `root` for the token the agent is configured with; the name of a person who signed in: the e-mail address, or what the agent names people by |
| `role` | string | `read`, `deploy` or `admin` |
| `kind` | string | `token`, or `user` for a person who signed in |
| `applications` | array of strings | The applications a `deploy` token or session is limited to; empty when it is not limited |
| `expires_at` | timestamp or null | Null for a token that does not expire |

### SignInStatus

The `sign_in` object of [`GET /server`](#get-server).

| Field | Type | |
|---|---|---|
| `configured` | boolean | The agent has an OpenID Connect provider |
| `issuer` | string | The provider's issuer; empty when none is configured |
| `name_claim` | string | The ID token claim people are named by: `email` unless the operator chose another. `""` on an agent without sign-in, and absent from agents before 0.7, which knew only `email` |

### NetworkStatus

The `network` object of [`GET /server`](#get-server): how the agent and the Docker daemon reach what is outside the server.

| Field | Type | |
|---|---|---|
| `proxy` | string | The proxy the agent's own requests go through, as `host:port`; `""` when it has none |
| `docker_proxy` | boolean | The Docker daemon has a proxy configured. Images are pulled by the daemon: the agent's proxy does nothing for them. |
| `ca_file` | boolean | Certificate authorities of your own are trusted in addition to the system's (`SHIPWICK_CA_FILE`) |
| `dns_resolvers` | array of strings | The name servers asked whether a hostname points at the server: addresses, or `system`. Empty: the public ones. |
| `acme_directory` | string | The certificate authority the proxy obtains certificates from; `""` is Let's Encrypt |

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
| `path` | string | The part of `domain` and `aliases` the application serves. Omitted when it serves all of it. |
| `replicas` | object | `{desired, running, healthy}`. All zero for a static application. |
| `static` | boolean | The proxy serves this application from a folder; it has no containers |
| `deploying` | boolean | A deployment is in flight |
| `in_flight_deployment_id` | integer or null | The deployment to follow while `deploying` is true |
| `created_at`, `updated_at` | timestamp | |
| `certificate_problem` | [`CertificateProblem`](#certificateproblem) or null | Null while no certificate of the application is known to be out of order. Absent from agents before 0.6. |
| `alert_count` | integer | How many alerts about the application are active. Absent from agents before 0.6. |
| `alert_severity` | string | The highest severity among them: `warning`, `critical`, or `""` for none. Absent from agents before 0.6. |

A replica is **healthy** when it runs and is not failing its health check. Without a `health` block, `healthy` equals `running`. During a rollout the numbers describe the replicas that are serving right now, a mix of the old and the new version, and `desired` is the capacity the rollout maintains: the smaller of the two replica counts. For a static application all three are zero: the proxy serves it, and there is nothing to count.

### ApplicationDetail

All fields of [`Application`](#application), plus:

| Field | Type | |
|---|---|---|
| `spec` | [`Spec`](#spec) or null | The active configuration, environment values and basic-auth passwords masked |
| `active_deployment` | [`Deployment`](#deployment) or null | |
| `containers` | array of [`Container`](#container) | Every container of the application, of both versions during a rollout |
| `certificates` | array of [`HostnameCertificate`](#hostnamecertificate) | The certificate status of every hostname the application answers to; empty for an application without a domain |

### HostnameCertificate

The certificate the proxy presents for one of an application's hostnames.

| Field | Type | |
|---|---|---|
| `hostname` | string | |
| `status` | string | `ok`, `expiring`, `obtaining`, `waiting_for_dns` or `unknown`. See [`GET /applications/:name`](#get-applications-name). |
| `issuer` | string | Set when there is a certificate |
| `not_after` | timestamp or null | Set when there is a certificate |
| `message` | string | For every status but `ok`, what is going on |

### CertificateProblem

The hostname of an application whose certificate is furthest from in order; carried by [`Application`](#application) as `certificate_problem`.

| Field | Type | |
|---|---|---|
| `hostname` | string | The domain, an alias or a redirect |
| `status` | string | `waiting_for_dns`, `expiring` or `obtaining`, the worst first; `unknown` is not a problem |
| `message` | string | What [`HostnameCertificate`](#hostnamecertificate) carries for the hostname |

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
| `stopping` | boolean | `true` for a container the agent is retiring in the background: replaced by a deployment, or left over. It is out of rotation, has been sent `SIGTERM`, and is gone once its process exits or its `deploy.stop_timeout` is over. It is not a replica any more (`replicas` never counted it), and its `health` and `restarts` are not kept up. Absent from agents older than 0.6. |

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
| `kind` | string | `deploy`, `redeploy` or `rollback`; `import` for the configuration an export carried, deployed by an [import](#post-import), and `standby` for the same deployed stopped on a standby |
| `source_deployment_id` | integer or null | For a redeploy or rollback, the deployment whose configuration it re-used |
| `by` | string | The name of the token that started the deployment; `root` for the agent's own token; the e-mail address of a person who signed in. Omitted on deployments recorded before tokens had names. |

### DeploymentDetail

All fields of [`Deployment`](#deployment), plus:

| Field | Type | |
|---|---|---|
| `spec` | [`Spec`](#spec) | The deployment's configuration, environment values and basic-auth passwords masked |
| `events` | array of [`Event`](#event) | |

### Spec

The JSON form of a validated `deploy.yaml`, with defaults applied. It is what the agent stores with each deployment. Durations are strings in Go's form: `"10s"`, `"10m0s"`, `"1h0m0s"`.

| Field | Type | |
|---|---|---|
| `name`, `image` | string | `image` is the reference that was deployed; for a `build` application, the `shipwick.local/<name>:<tag>` the client loaded; empty for a static application |
| `build` | object | Omitted when not set. `{context, dockerfile}`, as written in `deploy.yaml`, relative to it. |
| `static` | object | Omitted when not set. `{dir, fallback}`: the folder, relative to `deploy.yaml`, on the machine that uploaded it, and the file of it that is answered for a path that names no file. `fallback` is omitted when not set. |
| `port` | integer | Omitted when not set |
| `domain` | string | Omitted when not set |
| `path` | string | Omitted when the application serves the whole domain. `path: /` is stored as no path. |
| `proxy` | object | Omitted when not set. `{strip_prefix, headers, basic_auth, redirects}`, each omitted when not set. `basic_auth` is `[{path, username, password}]`: `path` is omitted for an account of the whole application, and `password` is always `"********"`. `redirects` is `[{from, to, status}]`; `status` is `308` when the document named none. See [Paths and the proxy block](#paths-and-the-proxy-block). |
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
| `backups` | object | Omitted when not set. `{schedule, keep, before, before_timeout, before_in, stop}`: `schedule` is five cron fields, read in UTC; `keep` is how many successful backups are kept, `7` unless set; `before` (the command run first) and `stop` are omitted when not set; `before_timeout` is how long `before` may run, `"1h0m0s"` unless set, and absent from a deployment recorded before the field existed, which means an hour; `before_in`, since 0.7, is `"container"` when `before` runs in a container of its own beside the replica, and omitted when it runs inside the replica. |
| `restart` | object | `{policy}` |
| `deploy` | object | `{strategy, stop_timeout}`. `stop_timeout` is omitted when not set, which means 10 seconds. |
| `init` | boolean | `true` when `init: true` is set in `deploy.yaml`. Omitted when it is not set or `false`. |

### Event

| Field | Type | |
|---|---|---|
| `id` | integer | Increasing. Clients use it to tell new events from ones already seen. |
| `deployment_id` | integer or null | Null for application events |
| `level` | string | `info`, `warn` or `error` |
| `type` | string | Deployment events: `step`, `state`, `log`. Application events: `supervisor`, `app` (stop, start, restored volume, a replaced container that had to be killed, a certificate being obtained or running out), `job` (a scheduled job or one-off command that failed or timed out), `alert` (an alert about the application raised or cleared), `backup` (a backup that failed, a verification). |
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

### LogArchiveEntry

The kept output of one run of a container, as [`GET /applications/:name/logs/archive`](#get-applications-name-logs-archive) lists it. Since 0.7.

| Field | Type | |
|---|---|---|
| `id` | integer | |
| `application` | string | |
| `kind` | string | `replica`: one run of a replica's container, from a start to the stop after it. `run`: a run of a job, a pre-deploy command or a one-off command |
| `deployment_id` | integer or null | The deployment the container belonged to; null once the deployment is gone |
| `deployment` | integer | Its number in the application's history, the `sequence` of a deployment; `0` once it is gone |
| `version` | string | Its version; `""` once it is gone |
| `replica` | integer | The replica's index; `0` for a run |
| `job` | string | The job's name for a run, `pre-deploy` and `run` included; `""` for a replica |
| `run_id` | integer or null | The run, for a run; null for a replica |
| `container` | string | Container name |
| `reason` | string | Why the run ended, see [`GET /applications/:name/logs/archive`](#get-applications-name-logs-archive) |
| `exit_code` | integer or null | The process's exit code; null when it was still running as its container was removed, or when the agent did not see it exit |
| `oom_killed` | boolean | The process was killed for exceeding its memory limit |
| `ended_at` | timestamp | When the run ended |
| `first_line_at`, `last_line_at` | timestamp or null | The times of the first and the last line kept; null when `lines` is 0 |
| `lines` | integer | How many lines are kept |
| `bytes` | integer | The size of their text |
| `stored_bytes` | integer | What they take on the server's disk, compressed |
| `truncated` | boolean | The run printed more than is kept; these are its last lines. A replica's run keeps 2,000 lines and 1 MB, a job's 10,000 lines and 4 MB; a line longer than 16 KB is cut |

### LogArchiveDetail

A [`LogArchiveEntry`](#logarchiveentry) with its lines.

| Field | Type | |
|---|---|---|
| … | | Every field of [`LogArchiveEntry`](#logarchiveentry) |
| `output` | array of [`LogLine`](#logline) | The lines kept, oldest first |

### LogMatch

One line found by [`GET /applications/:name/logs/search`](#get-applications-name-logs-search): a [`LogLine`](#logline) with where it comes from. Since 0.7.

| Field | Type | |
|---|---|---|
| … | | Every field of [`LogLine`](#logline) |
| `archive_id` | integer or null | The entry the line is kept in; null for a line read from a container that exists |
| `deployment_id` | integer or null | The deployment the container belongs to |
| `deployment` | integer | Its number in the application's history |
| `job` | string | The job's name, for a line of a run; `""` otherwise |
| `run_id` | integer or null | The run, for a line of a run |

### LogSearchResult

One page of a search, newest source first and within a source the newest line first.

| Field | Type | |
|---|---|---|
| `lines` | array of [`LogMatch`](#logmatch) | May hold fewer lines than asked for, none included, and still have a `next`: a request reads a bounded amount |
| `next` | string | Continues the search as `cursor`; `""` when everything that matches the question has been looked at |
| `sources` | integer | How many containers' output this request read |
| `bytes` | integer | How much of it |

### ApplicationConfig

The answer to [`GET /applications/:name/config`](#get-applications-name-config): the `deploy.yaml` that describes the application's active deployment. Since 0.7.

| Field | Type | |
|---|---|---|
| `application` | string | |
| `deployment_id` | integer | The deployment the document describes: the active one |
| `sequence` | integer | Its number in the application's history |
| `version` | string | Its version |
| `document` | string | The `deploy.yaml`. A secret value that was written as a reference to a secret stored on the server is that reference again; any other secret value is the mask, `"********"` |
| `masked` | array of strings | The fields whose value is the mask: `env.API_KEY`, `proxy.basic_auth[0].password`. A deployment of the document is refused until each has a value or a reference. `[]`: it deploys as it is |
| `static_digest` | string | For a static application: the folder the active deployment serves, which a deployment of the document names in `?static=`. Omitted otherwise |

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

### Traffic

The answer to [`GET /applications/:name/traffic`](#get-applications-name-traffic).

| Field | Type | |
|---|---|---|
| `application` | string | |
| `since` | timestamp | Start of the window |
| `step_seconds` | integer | Width of one point: `60`, `300` or `3600` |
| `totals` | [`TrafficCounts`](#trafficcounts) | The whole window |
| `points` | array of [`TrafficPoint`](#trafficpoint) | In time order; steps without a request are left out |

### TrafficCounts

The requests of one stretch of time.

| Field | Type | |
|---|---|---|
| `requests` | integer | |
| `status_2xx`, `status_3xx`, `status_4xx`, `status_5xx` | integer | Requests by status class |
| `bytes` | integer | Response bodies, as sent |
| `p50_ms`, `p95_ms`, `p99_ms` | number | Estimated from a histogram of the proxy's durations; `0` when there were no requests |

### TrafficPoint

All fields of [`TrafficCounts`](#trafficcounts), plus:

| Field | Type | |
|---|---|---|
| `t` | timestamp | Start of the step |

### Request

One line of the proxy's access log.

| Field | Type | |
|---|---|---|
| `time` | timestamp | |
| `method` | string | |
| `path` | string | Without the query string |
| `status` | integer | |
| `duration_ms` | number | |
| `bytes` | integer | |
| `client` | string | The address the proxy saw |

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

### BackupRun

One backup of an application's volumes, of the agent's state, or one export written to where backups go. Poll it until `completed_at` is set; a verification or a restore of it until `activity` is empty again.

| Field | Type | |
|---|---|---|
| `id` | integer | |
| `trigger` | string | `schedule` (`backups.schedule` in `deploy.yaml`; daily for the agent's state), `manual`, or `adopted` for a backup that [`POST /server/backups/adopt`](#post-server-backups-adopt) recorded from its files |
| `status` | string | `running`, `succeeded` or `failed`; nothing is kept of a failed one |
| `started_at` | timestamp | |
| `completed_at` | timestamp or null | |
| `volumes` | array of [`BackupVolume`](#backupvolume) | |
| `destinations` | array of strings | Of `local` and `s3` |
| `encrypted` | boolean | Written with the agent's passphrase |
| `error` | string | Empty unless the backup failed |
| `activity` | string | `verify` or `restore` while one is in progress, else `""` |
| `verified_at` | timestamp or null | When the backup last proved to restore into a container that came up |
| `verify_error` | string | Why the last verification failed. At most one of `verified_at` and `verify_error` is set. |
| `restored_at` | timestamp or null | The same of the last restore |
| `restore_error` | string | |

### BackupRunDetail

All fields of [`BackupRun`](#backuprun), plus:

| Field | Type | |
|---|---|---|
| `verify_output` | string | The last output of the container its verification started |

### BackupVolume

One archive of a backup: a volume of the application, for the agent's state one of its two files, for an export `export.tar`.

| Field | Type | |
|---|---|---|
| `volume` | string | |
| `size_bytes` | integer | Of the archive, before encryption |

### BackupAdoption

The answer to [`POST /server/backups/adopt`](#post-server-backups-adopt): the backups that are recorded now and were not before, and the ones that were found and left alone.

| Field | Type | |
|---|---|---|
| `adopted` | array of [`AdoptedBackup`](#adoptedbackup) | |
| `skipped` | array of [`SkippedBackup`](#skippedbackup) | |

### AdoptedBackup

A backup the database knows from now on.

| Field | Type | |
|---|---|---|
| `kind` | string | `application`, `state` (the agent's database and encryption key) or `export` |
| `application` | string | Empty unless `kind` is `application` |
| `backup` | [`BackupRun`](#backuprun) | With the trigger `adopted` |

### SkippedBackup

A run whose files were found and are not a backup that can be recorded.

| Field | Type | |
|---|---|---|
| `kind` | string | `application`, `state` or `export` |
| `application` | string | Empty unless `kind` is `application` |
| `id` | integer | The id the files carry |
| `reason` | string | Why it was not recorded |

### LoadedImage

The answer to [`POST /applications/:name/images`](#post-applications-name-images).

| Field | Type | |
|---|---|---|
| `image` | string | The reference that was loaded, `shipwick.local/<name>:<tag>` |
| `size_bytes` | integer | The size of the archive |

### MissingLayers

The answer to [`POST /applications/:name/images/missing`](#post-applications-name-images-missing).

| Field | Type | |
|---|---|---|
| `missing` | array of strings | The layers of the request the server's Docker does not have, in the request's order. The others can be left out of the archive. |

### Validation

The answer to [`POST /applications/:name/validate`](#post-applications-name-validate) for a document that a deployment would accept. One that it would refuse is answered with the error the deployment would get.

| Field | Type | |
|---|---|---|
| `valid` | boolean | `true` |

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

### Registry

A stored registry credential. The password is never returned.

| Field | Type | |
|---|---|---|
| `registry` | string | A hostname with an optional port, as image references name it |
| `username` | string | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | When the credential was last replaced |

### Certificate

A certificate you supplied for a hostname: what the chain says about itself. Neither the key nor the PEM is ever returned.

| Field | Type | |
|---|---|---|
| `hostname` | string | The name it is stored under |
| `subjects` | array of strings | The DNS names of the certificate; the hostnames it covers are served with it, and no authority is asked for those |
| `issuer` | string | |
| `not_before` | timestamp | |
| `not_after` | timestamp | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

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
| `applications` | array of strings | The applications a `deploy` token is limited to; empty when it is not limited. Absent from agents before 0.6. |
| `expires_at` | timestamp or null | Null for a token that does not expire. A token whose time has passed stays listed until it is revoked. Absent from agents before 0.6. |

### UpdateTokenRequest

The body of [`PUT /tokens/:name`](#put-tokens-name). What it leaves out stays as it is. Since 0.7.

| Field | Type | |
|---|---|---|
| `applications` | array of strings | Replaces the applications a `deploy` token is limited to; an empty list lifts the limit |
| `expires_at` | timestamp | Moves the token's end. A token that has expired works again when its end is moved into the future |
| `never_expires` | boolean | Takes the end away. It cannot stand next to `expires_at` |

### CreatedToken

The answer to `POST /tokens`, the one time the token value itself is shown.

| Field | Type | |
|---|---|---|
| `id` | integer | |
| `name` | string | |
| `role` | string | |
| `created_at` | timestamp | |
| `token` | string | The value: `swk_` and 32 random bytes in unpadded base64url |
| `applications` | array of strings | As asked for, sorted, each once; empty for a token that is not limited |
| `expires_at` | timestamp or null | Null for a token that does not expire |

### AuditEntry

One action that changed something, or tried to, as [`GET /audit`](#get-audit) lists it. Nothing in it comes from a request body except names.

| Field | Type | |
|---|---|---|
| `id` | integer | |
| `at` | timestamp | |
| `actor` | [`Actor`](#actor) | Who made the request |
| `address` | string | Where the connection came from; behind the proxy that is the proxy |
| `forwarded_for` | string | The client address the proxy reported; `""` without one |
| `action` | string | See [`GET /audit`](#get-audit) |
| `application` | string | `""` for what is not about one application |
| `target` | string | What was acted on besides the application: a token, a secret, a registry, a hostname, a volume, a job, a backup's id |
| `outcome` | string | `ok`, `refused` or `failed` |
| `status` | integer | The HTTP status the request was answered with |
| `code` | string | The error code of a request that was not answered 2xx |
| `detail` | string | |

### Actor

Who did something: what kind of caller, and its name.

| Field | Type | |
|---|---|---|
| `kind` | string | `token` or `user` |
| `name` | string | The token's name, or the name of a person who signed in: the e-mail address, or what the claim of the operator's choice says |

### SignInConfig

The answer to [`GET /auth`](#get-auth): what it takes to send a browser to the provider. All of it is public; the client secret stays in the agent.

| Field | Type | |
|---|---|---|
| `configured` | boolean | The agent has a provider. When `false`, the other fields are empty. |
| `issuer` | string | |
| `authorization_endpoint` | string | |
| `client_id` | string | |
| `scopes` | array of strings | |
| `redirect_uri` | string | `https://<SHIPWICK_DASHBOARD_DOMAIN>/auth/callback` |

### SignInRequest

The body of [`POST /auth/exchange`](#post-auth-exchange).

| Field | Type | |
|---|---|---|
| `code` | string | Required |
| `code_verifier` | string | Required. 43 to 128 characters. |
| `nonce` | string | Required. At least 22 characters of base64url. |
| `redirect_uri` | string | Required. The configured one. |

### SignedIn

The answer to [`POST /auth/exchange`](#post-auth-exchange).

| Field | Type | |
|---|---|---|
| `session` | string | The session, presented like a token: `sws_…`. This is the only copy; the agent keeps its hash. |
| `identity` | [`TokenIdentity`](#tokenidentity) | With `kind: "user"` and the e-mail address as `name` |

### AccessRule

Gives a role to an address, a group, a domain or a name.

| Field | Type | |
|---|---|---|
| `id` | integer | |
| `kind` | string | `email`, `group`, `domain` or, since 0.7, `name` |
| `subject` | string | The address or the domain, in lowercase; a group as the provider sends it; a name as the provider's claim holds it |
| `role` | string | `read`, `deploy` or `admin` |
| `applications` | array of strings | Limits a `deploy` rule as it limits a `deploy` token; empty when not limited |
| `created_at` | timestamp | |
| `created_by` | string | The name of the token, or the address of the person, that wrote the rule |

### Session

A person signed in right now, as [`GET /access/sessions`](#get-access-sessions) lists it.

| Field | Type | |
|---|---|---|
| `id` | integer | |
| `email` | string | The person's name: the address, or with another name claim what that claim holds |
| `role` | string | |
| `applications` | array of strings | |
| `created_at` | timestamp | |
| `expires_at` | timestamp | Ten hours after the sign-in |
| `last_used_at` | timestamp or null | To the minute; null until first used |

### SignedOut

The answer to [`DELETE /access/sessions/:email`](#delete-access-sessions-email).

| Field | Type | |
|---|---|---|
| `sessions` | integer | How many sessions were ended |

### Import

The import a server is running, or ran last. An agent that restarts still knows it; an import it cut off by restarting has failed.

| Field | Type | |
|---|---|---|
| `status` | string | `running`, `succeeded` or `failed` |
| `source` | string | Where the export came from: `upload`, or the export in the bucket a standby fetched |
| `stopped`, `overwrite` | boolean | As the import was asked for |
| `started_at` | timestamp | |
| `completed_at` | timestamp or null | |
| `exported_at` | timestamp or null | When the export was written; null until it has been read |
| `secrets`, `registries`, `certificates` | integer | |
| `applications` | array of [`ImportedApplication`](#importedapplication) | In the order they are deployed |
| `warnings` | array of strings | What was kept as it was, or could not be taken over |
| `error` | string | |

### ImportedApplication

| Field | Type | |
|---|---|---|
| `name` | string | |
| `status` | string | `pending`, `importing`, `imported`, `skipped` or `failed` |
| `version` | string | |
| `deployment_id` | integer or null | |
| `volumes` | array of strings | The volumes restored before the application first started |
| `message` | string | Why it was skipped or failed, and what to do about it |

### Standby

What a server holds for the day it has to take over.

| Field | Type | |
|---|---|---|
| `applications` | array of [`StandbyApplication`](#standbyapplication) | Imported stopped, waiting for a promotion |
| `records` | array of [`DNSRecord`](#dnsrecord) | What a promotion will ask for |
| `pull` | [`StandbyPull`](#standbypull) or null | Null when the agent does not fetch exports on a schedule |
| `promotion` | [`Promotion`](#promotion) or null | The promotion that runs or ran last; null when the server was never promoted. Absent from agents before 0.6. |

### StandbyApplication

| Field | Type | |
|---|---|---|
| `name` | string | |
| `version` | string | |
| `hostnames` | array of strings | |
| `imported_at` | timestamp | |

### StandbyPull

How the scheduled import from the bucket is doing.

| Field | Type | |
|---|---|---|
| `schedule` | string | |
| `last_at` | timestamp or null | |
| `last_export` | integer | The export imported last; `0` when none yet |
| `last_error` | string | |

### DNSRecord

A record to create or change so that a hostname reaches this server.

| Field | Type | |
|---|---|---|
| `hostname` | string | |
| `type` | string | `A` or `AAAA` |
| `value` | string | Empty when the agent does not know its own address |

### Promotion

The promotion a standby is running, or ran last: the answer to [`POST /standby/promote`](#post-standby-promote) and to [`GET /standby/promotion`](#get-standby-promotion). It is done when `completed_at` is set. An agent before 0.6 sends `applications` and `records` only.

| Field | Type | |
|---|---|---|
| `id` | integer | Counts the promotions of the server; `0` in the answer to a promotion that had nothing to start |
| `status` | string | `running`, `succeeded` or `failed` (at least one application could not be started). One that started every application has succeeded, whether or not each was ready in time. |
| `started_at` | timestamp | |
| `completed_at` | timestamp or null | |
| `applications` | array of [`PromotedApplication`](#promotedapplication) | In the order they are started |
| `records` | array of [`DNSRecord`](#dnsrecord) | The DNS records to change, fixed when the promotion begins |

### PromotedApplication

| Field | Type | |
|---|---|---|
| `name` | string | |
| `status` | string | `pending` (not reached yet), `starting` (being started, or waited for), `running` (started and ready), `started` (not ready within its startup budget) or `failed` (could not be started) |
| `message` | string | |

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
