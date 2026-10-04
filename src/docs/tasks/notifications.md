---
title: Get notified
description: Post the outcome of every deployment, an application that goes down or recovers, a job or a scheduled backup that fails, a certificate that is running out, and alerts raised and cleared to Slack, Discord or your own HTTPS endpoint, with a signed payload and retries that never hold up a deployment.
---

# Get notified

The agent can tell you when something happened that you would act on: a deployment succeeded, failed or was rolled back, an application stopped serving or came back, a job or a scheduled backup failed, a certificate is running out, an alert was raised or cleared. This page shows how to point the agent at a webhook, what Slack and Discord receive, what any other endpoint receives, when each of the ten events fires and what does not notify, how to verify the signature, and how delivery behaves when the endpoint is slow or down.

## Before you begin

- Notifications are configured on the agent, not per application: one webhook receives the events of every application on the server.
- The URL must be `https://`, unless it points at `localhost` or a private address, where plain `http://` is accepted. A Slack or Discord webhook URL is a credential: whoever has it can post to the channel.
- Setting or changing the variable restarts the agent container. Running applications are not affected by an agent restart.

## Set the webhook

Add the URL to the agent's environment file on the server and apply it:

```bash
# /opt/shipwick/.env
SHIPWICK_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/XXXX
SHIPWICK_WEBHOOK_SECRET=a-long-random-string   # optional, see Verify the signature
```

```bash
cd /opt/shipwick && docker compose up -d
```

Compose recreates the agent with the new environment. The agent's log records that notifications go to a webhook and names its host, `hooks.slack.com`, and nothing more of the URL. A URL that does not qualify stops the agent at startup with a message that names the rule and never repeats the URL: `SHIPWICK_WEBHOOK_URL: must use https; http is allowed only for localhost and private addresses`.

Then check from anywhere:

```bash
shipwick server status
```

```text
Notifications   webhook configured
```

Without a webhook the line reads `none  (set SHIPWICK_WEBHOOK_URL on the agent)`. The same fact is `notifications: {"webhook": true}` in `GET /server`, and a Notifications row on the Status tab of the dashboard's server page.

## Slack and Discord

Two destinations get a plain message, because that is all they render:

| Destination | Recognised by | Body |
|---|---|---|
| Slack | The host `hooks.slack.com` | `{"text": "<message>"}` |
| Discord | The host `discord.com` or `discordapp.com` with a path under `/api/webhooks/` | `{"content": "<message>"}` |

The message is one sentence that says what happened and, where there is one, what to do next:

```text
my-api deployment of 1.4.3 failed: replica 1 exited with code 1 shortly after start. my-api is still running 1.4.2; the failed deployment did not affect it
```

## Any other endpoint

Every other URL receives the same sentence with the facts beside it, as JSON:

```json
{
  "event": "deployment.succeeded",
  "application": "my-api",
  "deployment_id": 42,
  "version": "1.4.2",
  "message": "my-api is running 1.4.2, replacing 1.4.1",
  "at": "2026-03-01T10:00:00Z",
  "server": "vps-1"
}
```

| Field | |
|---|---|
| `event` | One of the ten kinds below |
| `application` | The application's name. Empty when the event is about the server: a `disk` alert, or a failed backup of the agent's own state |
| `deployment_id` | The deployment the event is about; `null` for the events that are not about one: `job.failed`, `backup.failed`, `certificate.expiring` and the two alert events |
| `version` | The version concerned: the one deployed, failed, restored, running, or whose job or backup failed. Empty for alerts and `certificate.expiring` |
| `message` | The sentence a chat destination would get |
| `at` | When it happened, UTC, to the second |
| `server` | The hostname of the server the agent runs on |
| `alert` | On `alert.raised` and `alert.cleared` only, absent from every other event: which condition it is about. See [Alerts](#alerts) |

The request is a `POST` with `Content-Type: application/json` and `User-Agent: shipwick-agent/<version>`. Any `2xx` counts as delivered.

## What is sent, and when

| Event | When | Message |
|---|---|---|
| `deployment.succeeded` | A deployment or redeploy became `ACTIVE` | `my-api is running 1.4.2, replacing 1.4.1`, or `my-api was redeployed and is running 1.4.2` |
| `deployment.failed` | A deployment ended `FAILED`: the running version was never touched | `my-api deployment of 1.4.3 failed: <why>. my-api is still running 1.4.2; the failed deployment did not affect it`. For an application with nothing running: `Nothing of my-api is running. Fix the cause and deploy again; the events say more: shipwick status my-api` |
| `deployment.rolled_back` | A deployment failed part-way and the previous version was restored, or `shipwick rollback` succeeded | `my-api deployment of 1.4.3 failed: <why>. Rolled back: my-api is running 1.4.2 again`, or `my-api rolled back to 1.4.1 from 1.4.2` |
| `application.down` | Not one replica of a running application is ready: none running, or all failing the health check | `my-api is down: none of its 2 replicas is running. Shipwick restarts it as restart.policy allows; see why with: shipwick logs my-api` |
| `application.recovered` | After `application.down`, every desired replica is ready again and none has a restart still held against it, which takes a minute of running | `my-api is healthy again: 2/2 replicas running 1.4.2` |
| `job.failed` | A scheduled job, a one-off command or a pre-deploy hook failed or timed out | `my-api: Job nightly-report failed (exit 1). Its output: shipwick jobs logs my-api nightly-report` |
| `backup.failed` | A scheduled backup did not succeed: one of an application's volumes, under [`backups`](/docs/reference/deploy-yaml#backups) in `deploy.yaml`, or the daily one of the agent's own state. A backup taken by hand that fails tells the person who asked, and nobody else | `postgres: the scheduled backup failed: <why>. See its backups with: shipwick backups postgres`, or `The backup of the agent's own state failed: <why>. The encryption key exists only on the server until one succeeds; see: shipwick doctor` |
| `certificate.expiring` | A hostname's certificate has 14 days left, and once more at 3. The proxy renews long before that, so this means renewal is failing, or the certificate is one you supplied | `my-api: the certificate for api.example.com expires in 13 days, on 2026-03-15. The proxy renews certificates by itself, so renewal is failing; its log says why: docker logs shipwick-caddy-1` |
| `alert.raised` | A condition that, left alone, ends badly has become true: a replica close to its memory limit, the server's disk filling up, a replica that keeps being restarted, an application that stays unhealthy. Sent once, and once more when a warning turns critical | `my-api replica 1 is at 93% of its memory limit (240 MB of 256 MB). At the limit it is killed and restarted; raise resources.memory in deploy.yaml, or watch it with: shipwick status my-api` |
| `alert.cleared` | The condition no longer holds. Sent once | `my-api replica 1 is back at 71% of its memory limit (182 MB of 256 MB)` |

The last four exist since 0.5. Nothing else is ever sent. A single replica restarting, one failed health check, a crash loop that has not taken the last replica down, `shipwick stop` and `start`, a successful job or backup: all of it is in the application's event feed and in `shipwick status`, not in your chat. An application stopped on request is not down; it is stopped, and the supervisor does not watch it until it is started again.

The recovery rule is strict on purpose. A replica that crash-loops runs for a moment between crashes; reporting that moment as a recovery would produce a recovery and a new outage at every restart. The recovery is reported once the replicas have run long enough for their restarts to be forgiven, as described in [Health checks and supervision](/docs/concepts/health-and-supervision#the-stable-run-rule).

`certificate.expiring` is told when the state is entered and once more at 3 days. For a certificate that lives less than 56 days the state is entered in the last quarter of its lifetime instead. A certificate supplied with `shipwick cert set` is not renewed by the proxy, and its message ends with the command that replaces it. The agent keeps what it has warned about in memory, so an agent restart warns again. See [Use a certificate of your own](/docs/tasks/certificates).

### Alerts

An alert is a condition with a beginning and an end, not an occurrence: it is told once when it becomes true and once when it stops, and never in between. There are five kinds, described with their thresholds in [Alerts and metrics](/docs/tasks/alerts-and-metrics). In the JSON form the two events carry one more field:

```json
{
  "event": "alert.raised",
  "application": "my-api",
  "deployment_id": null,
  "version": "",
  "message": "my-api replica 1 is at 93% of its memory limit (240 MB of 256 MB). …",
  "at": "2026-03-01T09:58:00Z",
  "server": "vps-1",
  "alert": { "kind": "memory", "severity": "warning", "replica": 1 }
}
```

| Field | |
|---|---|
| `alert.kind` | `memory`, `disk`, `restarts`, `unhealthy` or, since 0.8, `docker` |
| `alert.severity` | `warning` or `critical`; `disk` and `unhealthy` become critical, and `docker` always is. `alert.cleared` carries the severity the alert had |
| `alert.replica` | The replica a `memory` or `restarts` alert is about; `0` for `unhealthy`, `disk` and `docker` |

`application` is empty for a `disk` and a `docker` alert, which are about the server. The webhook is where a `docker` alert is read: while the Docker daemon does not answer, `shipwick server status` and the dashboard cannot show it. See [When things break](/docs/tasks/when-things-break#docker-does-not-answer). Three rules keep alerts from repeating what was already said:

- **A warning that turns critical is raised a second time; stepping back down a level tells nobody.** Only raising, turning critical and clearing are sent.
- **The `restarts` alert is held while the application is down or the replica crash-looping.** The outage has been reported as `application.down`, and three restarts are how every outage begins.
- **When an application that was reported down recovers, its `unhealthy` alert is cleared in the event feed only.** `application.recovered` is sent at the same moment and says the same thing.

Stopping or deleting an application drops its alerts without a message. Active alerts are kept in the agent's memory: after the agent restarts, one whose condition still holds is raised again.

## Verify the signature

With `SHIPWICK_WEBHOOK_SECRET` set, every request carries

```http
X-Shipwick-Signature: sha256=<hex>
```

where `<hex>` is the HMAC-SHA256 of the request body, keyed with the secret, in lowercase hexadecimal. To verify: read the raw body exactly as received, compute the HMAC-SHA256 of those bytes with the secret you configured, hex-encode it, prefix `sha256=`, and compare with the header using a constant-time comparison. A request without the header, or with one that does not match, was not sent by your agent. The header is only present when the secret is set; Slack and Discord ignore it.

## Delivery

- **A notification never holds up a deployment.** Events are queued and sent by one sender, in order; the engine and the supervisor hand an event over and carry on. A webhook that is slow or down costs nothing but the notification.
- **Each attempt has 10 seconds.** A connection failure, a `5xx` or a `429` is retried after 1, 5 and 25 seconds, then given up. Any other rejection, a `4xx`, is given up at once: a request the endpoint refused once it will refuse again.
- **The queue holds 256 events.** If it is full, the newest event is dropped and the drop is logged. When the agent shuts down, it spends up to 5 seconds delivering what is queued.
- **Only the host is logged.** A delivery that fails or is dropped appears in the agent's log with the event kind, the application and the webhook's hostname. The URL, its path and its token, and the secret are never written anywhere.

## What's next

- [`SHIPWICK_WEBHOOK_URL` and `SHIPWICK_WEBHOOK_SECRET`](/docs/reference/agent-configuration#environment-variables) in the agent configuration reference.
- [Health checks and supervision](/docs/concepts/health-and-supervision): what the supervisor does between `application.down` and `application.recovered`.
- [Alerts and metrics](/docs/tasks/alerts-and-metrics): the five alerts, their thresholds, and where else they show.
- [Run scheduled jobs and one-off commands](/docs/tasks/jobs): where `job.failed` comes from.
- [Back up and restore volumes](/docs/tasks/backups): where `backup.failed` comes from.
