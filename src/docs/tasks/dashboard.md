---
title: Use the dashboard
description: Enable the Shipwick dashboard on a hostname, sign in with an API token, and see what it shows and what each role can do.
---

# Use the dashboard

The dashboard shows in a browser what `shipwick` shows in a terminal, and offers the everyday actions: deploy another image, roll back, stop, start, delete, run a job or a command, restore a backup, manage tokens. This page covers enabling it, signing in, what each page shows, what each role can do, and how it handles the API token.

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
| `read` | Sees everything: applications, replicas, metrics and their history, deployments, events, logs, jobs and their runs, volumes. Every action is disabled, with the reason |
| `deploy` | Also deploys another image, rolls back, stops, starts, runs a job and runs a command |
| `admin` | Also deletes applications, downloads and restores backups, and gets the Tokens page |

A session lasts 7 days. If the agent rejects the token at any point — it was revoked, or the agent's token changed — the session ends and the dashboard returns to the sign-in page. See [Create tokens for CI and teammates](/docs/tasks/tokens).

## What the pages show

| Page | |
|---|---|
| Overview | All applications with their status, the ones that need attention, recent deployments, and the state of the reverse proxy |
| Applications | Every application. An application's page shows its status, live CPU and memory against its limits with their history, each replica with its state, health, restart count and usage, the configuration as deployed, its volumes, its scheduled jobs and their runs, the deployment history, the supervisor's event feed, and its logs |
| Deployments | The deployment history across applications, or of one. A deployment's page shows its progress step by step, its outcome, where it came from and which token made it |
| Servers | The server the agent runs on, whether the agent reaches Caddy, whether a notification webhook is configured, and the token you are signed in with |
| Logs | Followed logs of one application. Replicas are tailed together and merged by time |
| Tokens | Admin only. The tokens with their roles and when each was last used; create and revoke them here |

A few things to know when reading it:

- **A deployment has three possible outcomes.** `ACTIVE` is the only success. `FAILED` means the previous version was never touched. `ROLLED_BACK` means the deployment failed part-way and the previous version was restored; it is shown as a handled failure, never as a success.
- **Every history entry shows its origin**, such as "rollback to #3 1.4.0" or "redeploy of #6", linked to the deployment it came from, and the name of the token that made it. Deployments made before tokens had names show none.
- **The configuration is shown by kind.** A health check reads `GET /health`, `TCP :5432` or `command pg_isready -U postgres`; hostnames as the domain, its aliases and `www.example.com → example.com` redirects; published ports as `5432/tcp → server port 15432 on 10.0.0.5`; `entrypoint` and `command` joined with spaces; `logging` as its driver with the options collapsed.
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
| Download a volume as a tar archive | `shipwick backup` | `admin` |
| Restore a volume from an archive | `shipwick restore` | `admin` |
| Delete | `shipwick delete` | `admin` |

And from the Tokens page, for admins: create a token, whose value is shown once, in the page, and never stored; and revoke one — `shipwick token create`, `shipwick token revoke`.

The rollback dialog lists exactly the deployments that are valid targets: the ones that once served successfully and were replaced. "Run command" takes the command one argument per field, because the agent takes a list and never a shell string; the run is followed until it finishes and its output shown. A restore is offered only while the application is stopped, checks that the file is a tar archive before uploading, and offers Start when the agent reports the volume restored.

Controls the role does not cover are disabled with the reason. The roles are enforced by the agent, not by the page: a request the role does not cover is answered `403` whatever the browser sends, and the dashboard shows the agent's own explanation, such as "This token has the read role; deploying needs deploy or admin".

The dashboard never submits a `deploy.yaml`. An application's first deployment, and any change to its configuration other than the image, goes through `shipwick deploy`.

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
- The relay is not an open proxy. Its target comes only from the dashboard's configuration, and only paths under the agent's `/api/v1/` are accepted. A volume archive is streamed through it both ways — a download to the browser, an upload to the agent — never buffered; the agent's 10 GB limit on an upload applies.
- The dashboard makes no request to any third party: no CDN, no analytics, fonts bundled. In production it sends a Content-Security-Policy of `default-src 'self'`.

Because the browser talks only to the dashboard, the agent needs no CORS support and can stay off the public internet. You can run the dashboard on a hostname and still [keep the API private](/docs/tasks/access-without-a-hostname).

::: warning Serve the dashboard over HTTPS only
Signing in sends the API token to the dashboard server. Over plain HTTP on anything but loopback, that is a credential in clear text — with an admin token, a root credential. The installer's setup always serves the dashboard through Caddy with a certificate.
:::

Not included: rate limiting of sign-in attempts, and roles per application rather than per server.

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
- [Back up and restore volumes](/docs/tasks/backups), from the dashboard or with `shipwick backup`.
