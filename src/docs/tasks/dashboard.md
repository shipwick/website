---
title: Use the dashboard
description: Enable the Shipwick dashboard on a hostname, sign in with an API token, and see what it shows and what each role can do.
---

# Use the dashboard

The dashboard shows in a browser what `shipwick` shows in a terminal, and offers the everyday actions: deploy another image, roll back, stop, start, delete, run a job or a command, take, verify and restore a backup, store a secret, log the server in to a registry, supply a certificate, remove a deleted application's volume, manage tokens, rotate the encryption key, and promote a standby. This page covers enabling it, signing in, what each page shows, what each role can do, and how it handles the API token.

The dashboard is a client of the agent's HTTP API and nothing more. It has no database and keeps no state of its own. Anything it does, `shipwick` and `curl` can do too.

## Enable the dashboard

The installer sets up the dashboard container on every server. It becomes reachable once it has a hostname.

If you gave the installer a dashboard hostname, open `https://<that hostname>`. The installer printed the address when it finished.

If you skipped the question, add the hostname afterwards. On the server, set it in `/opt/shipwick/.env`:

```bash
SHIPWICK_DASHBOARD_DOMAIN=dashboard.example.com
```

Then apply the change:

```bash
cd /opt/shipwick && docker compose up -d
```

Point the hostname's DNS at the server. Caddy obtains the certificate and serves the dashboard over HTTPS; the agent configures the route. The hostname must be a bare name such as `dashboard.example.com`, and different from the API hostname.

The dashboard container publishes no port. It is reached only through Caddy.

## Sign in

Sign in with an API token: the root token the installer printed, also in `/opt/shipwick/.env` as `SHIPWICK_AGENT_TOKEN`, or one created with `shipwick token create`. There are no accounts of the dashboard's own; the accounts are the agent's named tokens with their roles, and whoever signs in brings one. The dashboard has no credentials of its own.

What you see and may do follows the token's role, which the dashboard learns from the agent when you sign in and shows in the sidebar next to the token's name:

| Role | In the dashboard |
|---|---|
| `read` | Sees everything: applications, replicas, metrics and their history, traffic, deployments, events, logs, jobs and their runs, volumes, backups, the names of the secrets, the registries and supplied certificates without their passwords and keys, the server with its disk and alerts, and what a standby holds. Every action is disabled, with the reason |
| `deploy` | Also deploys another image, rolls back, stops, starts, runs a job, runs a command, takes a backup and verifies one |
| `admin` | Also deletes applications, downloads, restores and removes backups, stores and removes secrets, logs the server in to a registry and out of it, adds and removes certificates, removes the volumes of deleted applications, backs up the agent's state, writes an export to the backups, imports the newest export on a standby and promotes it, rotates the encryption key, and gets the Tokens page |

A session lasts 7 days. If the agent rejects the token at any point — it was revoked, or the agent's token changed — the session ends and the dashboard returns to the sign-in page. See [Create tokens for CI and teammates](/docs/tasks/tokens).

## What the pages show

| Page | |
|---|---|
| Overview | All applications with their status, the ones that need attention, the alerts that hold right now, recent deployments, and the state of the reverse proxy |
| Applications | Every application. An application's page shows its status, its hostnames with the certificate of each when it is not in order, the alerts about it, live CPU and memory against its limits with their history, the traffic the proxy saw, each replica with its state, health, restart count and usage, the configuration as deployed, its `proxy` block, its volumes and the backups the server took of them, its scheduled jobs and their runs, the deployment history, the supervisor's event feed, and its logs. A static application shows what it serves instead (`42 files, 3.1 MB, served by the proxy`); an application with `build` says its image is built by `shipwick deploy` |
| Deployments | The deployment history across applications, or of one. A deployment's page shows its progress step by step, its outcome, where it came from and which token made it |
| Servers | The server the agent runs on, how full its disk is, whether the agent reaches Caddy, whether a notification webhook is configured, the token you are signed in with and the dashboard's address; the active alerts; where backups are kept and whether the agent's own state is backed up; the exports kept with the backups; on a standby, what waits to be started; and the encryption key's rotation |
| Logs | Followed logs of one application. Replicas are tailed together and merged by time. Static applications have no logs and are not offered |
| Secrets | The secrets kept on the server for `${NAME}` in `env`: names and dates, never values. An admin stores, replaces or removes one here |
| Registries | The registries the server holds a credential for: name, username and dates, never passwords. An admin logs the server in to a registry, replaces a credential or logs out here |
| Certificates | The certificates you supplied: the name each is stored under, the hostnames it covers, its issuer and its expiry, marked in its last 30 days. Never the key. An admin adds, replaces or removes one here |
| Volumes | Every volume on the server with its application and size, `in use` or `application deleted`. An admin removes the volume of a deleted application here |
| Tokens | Admin only. The tokens with their roles and when each was last used; create and revoke them here |

A few things to know when reading it:

- **A deployment has three possible outcomes.** `ACTIVE` is the only success. `FAILED` means the previous version was never touched. `ROLLED_BACK` means the deployment failed part-way and the previous version was restored; it is shown as a handled failure, never as a success.
- **Every history entry shows its origin**, such as "rollback to #3 1.4.0" or "redeploy of #6", linked to the deployment it came from, and the name of the token that made it. Deployments made before tokens had names show none. A deployment made by `shipwick import` reads "imported", and one a standby holds until it is promoted "imported, stopped".
- **An application's address is its domain and its `path`**, wherever it is shown: `example.com/api` for an application that serves only that part of the hostname.
- **The configuration is shown by kind.** A health check reads `GET /health`, `TCP :5432` or `command pg_isready -U postgres`, `after a 2m start period` when `start_period` is set; hostnames as the domain, its aliases and `www.example.com → example.com` redirects; published ports as `5432/tcp → server port 15432 on 10.0.0.5`; `entrypoint` and `command` joined with spaces; `logging` as its driver with the options collapsed; an image built by the CLI as `built by shipwick deploy from . (Dockerfile)`; `deploy.stop_timeout` next to the strategy; the `backups` schedule as `shipwick validate` words it.
- **The Proxy panel is the `proxy` block of `deploy.yaml`**, read-only: the path and whether it is removed before a request reaches the application, the response headers, the redirects from one path to another, and under Password protection which path asks for the password of which account. Accounts are shown by name; passwords are stored encrypted and never returned.
- **Certificates are shown when they are not in order.** A hostname whose certificate is still being obtained, waits for DNS, is about to expire or has expired carries a badge — "Obtaining certificate", "Waiting for DNS", "Certificate expiring", "Certificate expired" — and the agent's own sentence about it.
- **Traffic is what the proxy saw.** The Traffic panel shows, for the last 1h, 24h or 7d, the totals — requests, 5xx, 4xx, the 50th, 95th and 99th percentile of their durations, bytes sent — and two charts: requests per step with the 5xx among them, and the 95th percentile. Recent requests opens the last 200 one by one, newest first, as the proxy logged them: paths without their query string, no headers. The agent keeps those in memory, so the list starts empty when the agent starts. A static application has traffic like any other; an application without a domain has none.
- **Alerts are marked on every page.** While an alert holds, the Servers entry in the navigation carries their number. They are listed on the Overview and the Servers page, worst first, each with the agent's sentence and since when, and the page of an application shows the ones about it.
- **Static applications** are folders the proxy serves itself. The list shows `static` in place of the replica count, the version is the folder's digest, and the application's page has no replicas, logs, jobs or metrics; it says what is served instead, with the fallback page when `static.fallback` is set. Stop, start, rollback, redeploy and delete work; the deploy dialog offers no image field, nor for an application with `build`, whose image is built and sent by `shipwick deploy`.
- **A replaced replica that is still stopping reads "Stopping".** After a deployment, a container that was sent `SIGTERM` and still has its `deploy.stop_timeout` to exit is listed as such, and no longer counts as a replica.
- **CPU is in percent of one core**, with the application's limit as the ceiling. An application without a CPU limit has no ceiling.
- **Two kinds of metrics.** The sparklines next to the live numbers are built in your browser while the page is open. The History charts below them come from the agent, which records every running replica's CPU and memory every 30 seconds and keeps 7 days: one line per replica for the last hour, day or week, a dashed line at the per-replica limit, and a gap wherever nothing was sampled — while the agent was down, for instance. Nothing is interpolated. The charts refresh every 30 seconds.
- **Jobs are in UTC.** The Jobs section lists each job's schedule, its last run with outcome and exit code, and its next run relative to now; a stopped application reads "Not while stopped". The run history covers scheduled runs, one-off commands and pre-deploy commands alike, and a run opens to show its output.
- **Shipped logs.** When an application's `logging` driver sends logs elsewhere, the log viewer says so and shows the local copy Docker keeps.
- **A deployment started elsewhere** — from `shipwick` or from CI — can be followed live from the application's page.

## What you can do

From an application's page:

| Action | Equivalent | Needs |
|---|---|---|
| Deploy another image | `shipwick redeploy --image …` | `deploy` |
| Roll back, to one of the listed targets | `shipwick rollback --to N` | `deploy` |
| Stop, start | `shipwick stop`, `shipwick start` | `deploy` |
| Run a job now | `shipwick jobs run <app> <job>` | `deploy` |
| Run a command | `shipwick run <app> -- <command>` | `deploy` |
| Back up now | `shipwick backups run` | `deploy` |
| Verify a backup | `shipwick backups verify` | `deploy` |
| Download a volume of a backup | `shipwick backups download` | `admin` |
| Restore a backup | `shipwick backups restore` | `admin` |
| Remove a backup | `shipwick backups rm` | `admin` |
| Download a volume as a tar archive | `shipwick backup` | `admin` |
| Restore a volume from an archive | `shipwick restore` | `admin` |
| Delete | `shipwick delete` | `admin` |

From the Servers page:

| Action | Equivalent | Needs |
|---|---|---|
| Back up state now | `shipwick server backup` | `admin` |
| Export to backups | `shipwick export --to-backups` | `admin` |
| Import newest now, on a standby | `shipwick standby pull` | `admin` |
| Promote, on a standby | `shipwick standby promote` | `admin` |
| Rotate encryption key | `shipwick server rotate-key` | `admin` |

From the Secrets page: store or replace a secret from a password field, whose value is cleared from the page as soon as the request is sent, and remove one — `shipwick secret set`, `shipwick secret rm`; both `admin`. From the Registries page: log the server in to a registry with a username and a password or token, which the agent checks against the registry before it stores anything, and log out — `shipwick registry login`, `shipwick registry logout`; both `admin`. From the Certificates page: add or replace a certificate by pasting its chain and its private key, which is cleared from the page as soon as it is sent, and remove one — `shipwick cert set`, `shipwick cert rm`; both `admin`. From the Volumes page: remove the volume of a deleted application — `shipwick volumes rm`, `admin`. And from the Tokens page, for admins: create a token, whose value is shown once, in the page, and never stored; and revoke one — `shipwick token create`, `shipwick token revoke`.

The rollback dialog lists exactly the deployments that are valid targets: the ones that once served successfully and were replaced. "Run command" takes the command one argument per field, because the agent takes a list and never a shell string; the run is followed until it finishes and its output shown. A restore from a file is offered only while the application is stopped, checks that the file is a tar archive before uploading, and offers Start when the agent reports the volume restored.

The Backups panel of an application with volumes lists the backups the server took, with the schedule and how the last one went. Verify restores a backup into scratch volumes and starts one container on them, beside the application; opening the backup shows the verdict and the container's output. From there an admin downloads a volume of it, removes it, or restores it, which is offered only while the application is stopped and is confirmed by typing the application's name. See [Back up and restore volumes](/docs/tasks/backups).

On the Servers page, the Backups panel says where backups are kept, whether they are encrypted, and how the agent's own state is backed up; without `SHIPWICK_BACKUP_PASSPHRASE` it reads "Not backed up", and Back up state now is disabled. Export to backups writes an export of every application to where backups are kept and lists the ones kept there. A server that holds stopped applications from an export, or fetches exports on a schedule, has a Standby panel: the applications that wait, the scheduled fetch and how its last attempt went, Import newest now, and Promote, which asks you to type `promote` and answers with what was started and the DNS records to change. An import that is running is shown while it runs, with each application's outcome afterwards. See [Move to a new server](/docs/tasks/move-to-a-new-server).

Rotate encryption key has the agent generate a new key and re-encrypt everything stored under it; nothing is deployed and nothing restarts. Where the key is set in the agent's environment, the new key is shown once, with the line to put into `/opt/shipwick/.env`. See [Rotate the encryption key](/docs/tasks/rotate-the-encryption-key).

A deployment refused because a secret is not stored links to the Secrets page with the name filled in, and one whose image a registry refused links to the Registries page with the registry filled in.

Controls the role does not cover are disabled with the reason. The roles are enforced by the agent, not by the page: a request the role does not cover is answered `403` whatever the browser sends, and the dashboard shows the agent's own explanation, such as "This token has the read role; deploying needs deploy or admin".

Stopping or deleting an application waits as long as the agent does, which with a long `deploy.stop_timeout` can be minutes.

The dashboard never submits a `deploy.yaml`, and uploads neither images nor static folders. An application's first deployment, and any change to its configuration other than the image, goes through `shipwick deploy`. What needs a file or a passphrase of your own stays with the CLI as well: `shipwick export` to a file, and `shipwick import`.

## How the dashboard handles the token

An admin token is equivalent to root SSH access to the server, so the dashboard keeps every token out of the browser's reach.

```text
browser ── same origin ──▶ dashboard server ── Bearer token ──▶ Shipwick agent
           cookie session
           no token in JS
```

- The browser never talks to the agent. The dashboard's own server relays requests to it and adds the token.
- When you sign in, the dashboard server verifies the token against the agent and stores it in an `httpOnly` cookie with `SameSite=Strict`, and `Secure` over HTTPS. JavaScript cannot read it, so a cross-site scripting bug or a malicious browser extension cannot steal it. The application only knows whether a session exists and, from the agent's `GET /server`, the token's name and role.
- Nothing is kept in `localStorage` except the theme. A token created on the Tokens page is shown once and never stored.
- The token is never logged, by the relay or by the session routes.
- Every state-changing request must carry a custom header that a cross-origin page cannot add, and the server never grants the CORS preflight that would allow it.
- The relay is not an open proxy. Its target comes only from the dashboard's configuration, and only paths under the agent's `/api/v1/` are accepted. A volume archive is streamed through it both ways — a download to the browser, an upload to the agent — never buffered, and so is a secret's value; the agent's own limits apply.
- The dashboard makes no request to any third party: no CDN, no analytics, fonts bundled. In production it sends a Content-Security-Policy of `default-src 'self'`.

Because the browser talks only to the dashboard, the agent needs no CORS support and can stay off the public internet. You can run the dashboard on a hostname and still [keep the API private](/docs/tasks/access-without-a-hostname).

::: warning Serve the dashboard over HTTPS only
Signing in sends the API token to the dashboard server. Over plain HTTP on anything but loopback, that is a credential in clear text — with an admin token, a root credential. The installer's setup always serves the dashboard through Caddy with a certificate.
:::

Failed sign-ins are slowed down by the agent: after 20 failed authentications within a minute from the dashboard server's address, which every browser shares, wrong tokens are answered `429` for a minute, and the sign-in page reads "Too many failed attempts from this address; try again in a minute". A valid token is never refused. Not included: roles per application rather than per server.

## Run the dashboard yourself

The installer's setup needs none of this. If you run the dashboard some other way, it is configured with environment variables:

| Variable | Default | |
|---|---|---|
| `SHIPWICK_AGENT_URL` | `http://127.0.0.1:9000` | Base URL of the agent, as seen from the dashboard server |
| `SHIPWICK_COOKIE_SECURE` | auto | `true` or `false` to force the cookie's `Secure` flag. Auto: on when the request is HTTPS, directly or according to `X-Forwarded-Proto` |
| `HOST`, `PORT` | `0.0.0.0`, `3000` | Listen address |

There is no token variable, on purpose: the dashboard does not know the token until someone signs in with it.

Behind your own reverse proxy, make sure it forwards `X-Forwarded-Proto`, so the cookie gets its `Secure` flag, and that it does not buffer responses, or followed logs arrive in bursts. Caddy forwards the header.

## What's next

- [Create tokens for CI and teammates](/docs/tasks/tokens): a `read` token for whoever only needs to look.
- [Security](/docs/security) explains what a token is worth and how to protect it.
- [Inspect applications and read logs](/docs/tasks/inspect-and-logs) covers the same ground from the terminal.
- [Back up and restore volumes](/docs/tasks/backups), from the dashboard or with `shipwick backups` and `shipwick backup`.
- [See what the proxy saw](/docs/tasks/traffic), [alerts and metrics](/docs/tasks/alerts-and-metrics), [certificates](/docs/tasks/certificates) and [private registries](/docs/tasks/private-registries): the same from the terminal.
