---
title: Use the dashboard
description: Enable the Shipwick dashboard on a hostname, sign in with the API token, and see what it shows and what it can do.
---

# Use the dashboard

The dashboard shows in a browser what `deployctl` shows in a terminal, and offers the everyday actions: deploy another image, roll back, stop, start, delete. This page covers enabling it, signing in, what each page shows, and how it handles the API token.

The dashboard is a client of the agent's HTTP API and nothing more. It has no database and keeps no state of its own. Anything it does, `deployctl` and `curl` can do too.

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

Sign in with the API token — the one the installer printed, also in `/opt/shipwick/.env` as `SHIPWICK_AGENT_TOKEN`. There are no user accounts: the agent has a single token, and whoever signs in brings it. The dashboard has no credentials of its own.

A session lasts 7 days. If the agent rejects the token at any point, the session ends and the dashboard returns to the sign-in page.

## What the pages show

| Page | |
|---|---|
| Overview | All applications with their status, the ones that need attention, recent deployments, and the state of the reverse proxy |
| Applications | Every application. An application's page shows its status, live CPU and memory against its limits, each replica with its state, health, restart count and usage, the deployment history, the supervisor's event feed, and its logs |
| Deployments | The deployment history across applications, or of one. A deployment's page shows its progress step by step, its outcome, and where it came from |
| Servers | The server the agent runs on, and whether the agent reaches Caddy |
| Logs | Followed logs of one application. Replicas are tailed together and merged by time |

A few things to know when reading it:

- **A deployment has three possible outcomes.** `ACTIVE` is the only success. `FAILED` means the previous version was never touched. `ROLLED_BACK` means the deployment failed part-way and the previous version was restored; it is shown as a handled failure, never as a success.
- **Every history entry shows its origin**, such as "rollback to #3 1.4.0" or "redeploy of #6", linked to the deployment it came from.
- **CPU is in percent of one core**, with the application's limit as the ceiling. An application without a CPU limit has no ceiling.
- **Metrics are point-in-time samples.** The history in the charts is built in your browser while the page is open; the agent stores none.
- **A deployment started elsewhere** — from `deployctl` or from CI — can be followed live from the application's page.

## What you can do

From an application's page:

| Action | Equivalent |
|---|---|
| Deploy another image | `deployctl redeploy --image …` |
| Roll back, to one of the listed targets | `deployctl rollback --to N` |
| Stop, start | `deployctl stop`, `deployctl start` |
| Delete | `deployctl delete` |

The rollback dialog lists exactly the deployments that are valid targets: the ones that once served successfully and were replaced.

The dashboard never submits a `deploy.yaml`. An application's first deployment, and any change to its configuration other than the image, goes through `deployctl deploy`.

## How the dashboard handles the token

The API token is equivalent to root SSH access to the server, so the dashboard keeps it out of the browser's reach.

```text
browser ── same origin ──▶ dashboard server ── Bearer token ──▶ Shipwick agent
           cookie session
           no token in JS
```

- The browser never talks to the agent. The dashboard's own server relays requests to it and adds the token.
- When you sign in, the dashboard server verifies the token against the agent and stores it in an `httpOnly` cookie with `SameSite=Strict`, and `Secure` over HTTPS. JavaScript cannot read it, so a cross-site scripting bug or a malicious browser extension cannot steal it. The application only knows whether a session exists.
- Nothing is kept in `localStorage` except the theme.
- The token is never logged, by the relay or by the session routes.
- Every state-changing request must carry a custom header that a cross-origin page cannot add, and the server never grants the CORS preflight that would allow it.
- The relay is not an open proxy. Its target comes only from the dashboard's configuration, and only paths under the agent's `/api/v1/` are accepted.
- The dashboard makes no request to any third party: no CDN, no analytics, fonts bundled. In production it sends a Content-Security-Policy of `default-src 'self'`.

Because the browser talks only to the dashboard, the agent needs no CORS support and can stay off the public internet. You can run the dashboard on a hostname and still [keep the API private](/docs/tasks/access-without-a-hostname).

::: warning Serve the dashboard over HTTPS only
Signing in sends the API token to the dashboard server. Over plain HTTP on anything but loopback, that is a root credential in clear text. The installer's setup always serves the dashboard through Caddy with a certificate.
:::

Not included: rate limiting of sign-in attempts, and multi-user accounts.

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

- [Security](/docs/security) explains what the token is worth and how to protect it.
- [Inspect applications and read logs](/docs/tasks/inspect-and-logs) covers the same ground from the terminal.
