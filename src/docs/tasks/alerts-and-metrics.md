---
title: Get alerts and scrape metrics
description: The four alerts the agent raises for a replica close to its memory limit, a disk that is filling up, a replica that keeps restarting and an application that stays unhealthy, where they show and how to change their thresholds, how full the server's disk is, and the Prometheus endpoint with every series it exposes.
---

# Get alerts and scrape metrics

A notification says that something happened. An alert says that something is the case and, left alone, ends badly. This page shows the four alerts the agent raises and when each is raised and cleared, where they show, how to change the two thresholds, how to see how full the server's disk is, and how to scrape the agent with Prometheus: the token, the scrape configuration and every series.

## Before you begin

- Alerts, the disk and `GET /metrics` exist since 0.5. An older agent reports neither `disk` nor `alerts`, and `shipwick server status` then prints neither.
- Alerts need no configuration. They are raised on every server and shown by `shipwick server status`, `shipwick doctor` and the dashboard. To be told about them when you are not looking, configure a webhook; see [Get notified](/docs/tasks/notifications).
- The `memory` alert needs a limit to measure against: an application without `resources.memory` has no such alert. See [Resource limits and metrics](/docs/concepts/resources).
- Scraping needs a token with the `read` role and an agent that Prometheus can reach, which usually means an agent with a hostname (`SHIPWICK_AGENT_DOMAIN`); see [Install Shipwick on a server](/docs/getting-started/install).

## The four alerts

| Alert | Raised when | Cleared when |
|---|---|---|
| `memory` | A replica is at or above 90% of its `resources.memory` for three samples in a row, a minute and a half | It is below 80% |
| `disk` | The disk that holds the agent's data directory, in the standard installation the disk Docker keeps images and volumes on, is 85% full: a warning. At 95%: critical | It is below 80% |
| `restarts` | The supervisor has restarted the same replica three times within ten minutes. Held back while the application is down or the replica crash-looping | Fewer than three restarts in the last ten minutes |
| `unhealthy` | An application has had fewer healthy replicas than it should for five minutes: a warning. After an hour: critical | Every replica is healthy and has stayed up for a minute |

Each alert comes with a sentence that says what is the case and where to look:

```text
my-api replica 1 is at 93% of its memory limit (240 MB of 256 MB). At the limit it is killed and restarted; raise resources.memory in deploy.yaml, or watch it with: shipwick status my-api
The server's disk is 87% full (5 GB of 40 GB free). See what takes the space with: docker system df
my-api replica 2 was restarted 3 times in the last 10 minutes. See why it keeps stopping with: shipwick logs my-api
my-api has not been healthy for 5 minutes: 1/2 replicas ready. See why with: shipwick status my-api
```

A critical disk adds `Deployments, databases and logs fail when it runs out`, and an application that stays unhealthy reads `has not been healthy for an hour` once it is critical.

### Raised once, cleared once

An alert is raised once and cleared once, however long it lasts. A warning that turns critical is told a second time; stepping back down a level tells nobody.

- **Each level is left below where it is entered.** `memory` is cleared ten points below its threshold and `disk` five below, and a critical disk steps back to a warning only under 90%. A value that hovers at the threshold is therefore one alert, not one per sample.
- **`memory` and `disk` are read every 30 seconds**, after each round of [metric samples](/docs/concepts/resources#history). Three samples in a row means three consecutive ones: readings with an outage between them do not count.
- **`restarts` and `unhealthy` are what the supervisor sees** in its tick. Healthy means every replica ready and none with a restart still held against it, so a crash-looping replica, up for a moment between crashes, neither ends the unhealthy period nor restarts its five minutes. See [Health checks and supervision](/docs/concepts/health-and-supervision#alerts).
- **`application.down` and `application.recovered` are sent at once, as before.** `unhealthy` is what follows when the outage lasts, and it also covers an application that is only degraded, which nothing else reports. The `restarts` alert is held while the application is down or the replica crash-looping: the outage has been reported, and three restarts are how every outage begins.
- **Active alerts are kept in the agent's memory.** After the agent restarts, one whose condition still holds is raised again. Stopping or deleting an application drops its alerts without a message.

## Where alerts show

| Place | What it shows |
|---|---|
| The webhook | `alert.raised` and `alert.cleared`, with the sentence, and in the JSON form `"alert": {"kind": "memory", "severity": "warning", "replica": 1}` beside it. See [Get notified](/docs/tasks/notifications#alerts) |
| The application's events | An alert about an application adds an event of type `alert`, in `shipwick status` and the dashboard: level `warn` or `error` when raised, `info` when cleared. A `disk` alert is about the server and is in no application's events |
| `GET /server` | `alerts`: the ones that are active right now, oldest first |
| `shipwick server status` | The active alerts under the disk's usage |
| `shipwick doctor` | The active alerts among its checks; a critical one counts as a problem |
| The dashboard | The server's Status tab and the Overview list them, the Status entry in the navigation carries their number while one holds, the applications list marks an application that has one, and an application's page opens with the ones about it. See [Use the dashboard](/docs/tasks/dashboard) |

From the terminal:

```bash
shipwick server status
```

```text
Token           laptop (admin)
Dashboard       https://dashboard.example.com
Disk            35 GB of 40 GB used (87%)

! The server's disk is 87% full (5 GB of 40 GB free). See what takes the space with: docker system df
```

A warning is marked `!`, a critical alert `✗`. Without alerts nothing follows the fields. `shipwick doctor` prints the same sentences among its other lines, and exits non-zero when one of them is critical.

From the API, `GET /server` carries what holds right now:

```json
{
  "data": {
    "…": "…",
    "disk": { "total_bytes": 42949672960, "used_bytes": 37580963840 },
    "alerts": [
      { "kind": "disk", "severity": "warning", "application": "", "replica": 0,
        "message": "The server's disk is 87% full (5 GB of 40 GB free). See what takes the space with: docker system df",
        "since": "2026-03-01T09:41:30Z" },
      { "kind": "memory", "severity": "warning", "application": "my-api", "replica": 1,
        "message": "my-api replica 1 is at 93% of its memory limit (240 MB of 256 MB). At the limit it is killed and restarted; raise resources.memory in deploy.yaml, or watch it with: shipwick status my-api",
        "since": "2026-03-01T09:58:00Z" }
    ]
  }
}
```

| Field | |
|---|---|
| `kind` | `memory`, `disk`, `restarts` or `unhealthy` |
| `severity` | `warning` or `critical`. Only `disk` and `unhealthy` become critical |
| `application`, `replica` | `memory` and `restarts` name an application and a replica; `unhealthy` an application, with `replica` 0; `disk` neither |
| `message` | The sentence |
| `since` | When the alert was raised. It stays when a warning turns critical |

Only active alerts are listed; the list is `[]` when there are none. See [`GET /server`](/docs/reference/api#get-server).

## Change the thresholds

Two of the alerts have a threshold you can set, on the agent:

| Variable | Default | Range | |
|---|---|---|---|
| `SHIPWICK_ALERT_MEMORY_PERCENT` | `90` | 50 to 100 | The share of its `resources.memory` at which a replica raises `memory` |
| `SHIPWICK_ALERT_DISK_PERCENT` | `85` | 50 to 94 | How full the disk is when it raises `disk` as a warning. At 95% the alert turns critical, whatever is set here |

Add them to the agent's environment file on the server and apply it:

```bash
# /opt/shipwick/.env
SHIPWICK_ALERT_MEMORY_PERCENT=85
SHIPWICK_ALERT_DISK_PERCENT=80
```

```bash
cd /opt/shipwick && docker compose up -d
```

Compose recreates the agent with the new environment; running applications are not affected by an agent restart. The clear levels move with the thresholds: ten points below for memory, five for the disk. A value out of range stops the agent at startup and names the range: `SHIPWICK_ALERT_DISK_PERCENT: invalid value "99" (expected a whole number from 50 to 94)`. The ten minutes of `restarts` and the five minutes and the hour of `unhealthy` are not configurable. See [the agent configuration reference](/docs/reference/agent-configuration#shipwick-alert-memory-percent-and-shipwick-alert-disk-percent).

## The server's disk

`shipwick server status` shows how full the server's disk is, and `GET /server` reports it as `disk`:

```text
Disk            35 GB of 40 GB used (87%)
```

It is the filesystem that holds the agent's data directory, which in the standard installation is the disk Docker keeps images and volumes on. The percentage is the one `df` shows: `total_bytes` leaves out the blocks reserved for root, because those do not help an application that runs as somebody else. `disk` is `null`, and the line is omitted, where the agent cannot measure it: a development build off Linux. There is then no `disk` alert either.

When the alert is raised, `docker system df` on the server says what takes the space. Shipwick removes the images of versions nobody can return to after every successful deployment, and since 0.5 the image of a deployment that failed; see [Old images are removed](/docs/concepts/deployments#old-images-are-removed).

## Scrape the agent with Prometheus

The agent serves what it knows at `GET /metrics`, in the Prometheus text format: each application's status and replica counts, each replica's CPU, memory, memory limit and restarts, deployments by outcome and the duration of the last one, the disk, and the active alerts. The path is `/metrics` on the agent, not under `/api/v1`, since that is where a scraper looks. It is authenticated like the rest of the API, and a token of the `read` role is enough:

```bash
shipwick token create prometheus --role read
```

```yaml
scrape_configs:
  - job_name: shipwick
    scheme: https
    static_configs:
      - targets: ["agent.example.com"]   # SHIPWICK_AGENT_DOMAIN
    authorization:
      credentials: swk_…                 # or credentials_file
```

```text
shipwick_application_status{application="my-api",status="healthy"} 1
shipwick_application_replicas{application="my-api",state="desired"} 2
shipwick_application_replicas{application="my-api",state="healthy"} 2
shipwick_application_replicas{application="my-api",state="running"} 2
shipwick_replica_cpu_ratio{application="my-api",replica="1"} 0.21
shipwick_replica_memory_bytes{application="my-api",replica="1"} 2.16006656e+08
shipwick_replica_memory_limit_bytes{application="my-api",replica="1"} 1.073741824e+09
shipwick_replica_restarts_total{application="my-api",replica="1"} 0
shipwick_deployments_total{application="my-api",status="succeeded"} 12
shipwick_deployment_last_duration_seconds{application="my-api"} 14.2
shipwick_disk_bytes{state="used"} 3.758096384e+10
shipwick_alerts{kind="disk",severity="warning"} 1
```

The answer is `text/plain; version=0.0.4`. Errors — `401`, `403`, `429` — are the JSON envelope, as everywhere else in the API.

### What it exposes

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
| `shipwick_disk_bytes{state}` | gauge | `state` is `total` or `used`, as `disk` in `GET /server`; absent where it cannot be measured |
| `shipwick_alerts{kind, severity}` | gauge | Number of active alerts; every combination is present, 0 when none |

- **A scrape costs the server next to nothing.** It reads the agent's database in one transaction and what the supervisor and the sampler last saw, and never asks Docker. A scraper comes every few seconds for ever, and an endpoint that listed containers each time would put that load on the daemon and fail whenever the daemon is slow, which is when the numbers matter.
- **The numbers are as fresh as their source.** Status and the running and healthy counts are as the supervisor saw them at its last pass, a second ago at most; during a deployment they are those from before it began. CPU and memory are the last 30-second sample of each replica. A replica without a sample in the last 75 seconds, stopped or started less than a minute ago, has no CPU and memory series.
- **In the first second after the agent starts**, an application the supervisor has not looked at yet has only its `desired` replicas and no status.
- **Two scrapes of the same state are the same bytes.** Every family has its `# HELP` and `# TYPE` lines, families come in the order above, and series are sorted by application and label.
- **The counters behave as counters.** The three outcomes of `shipwick_deployments_total` only ever grow and are present from an application's first deployment, so `rate(shipwick_deployments_total{status="failed"}[1d])` works. Deployments are counted by outcome, not by status, because a status moves (`ACTIVE` becomes `SUPERSEDED`) and a counter must not go down. Deleting an application removes its series.

The units are those Prometheus expects, not those of the JSON endpoints: CPU is in cores here and in percent of one core in [`GET /applications/:name/metrics`](/docs/concepts/resources#metrics).

## What's next

- [Get notified](/docs/tasks/notifications): the webhook that carries `alert.raised` and `alert.cleared`.
- [Resource limits and metrics](/docs/concepts/resources): how CPU and memory are measured, and the week of history the samples come from.
- [Health checks and supervision](/docs/concepts/health-and-supervision): restarts, backoff and what makes an application healthy.
- [`GET /server`](/docs/reference/api#get-server) and [`GET /metrics`](/docs/reference/api#get-metrics) in the API reference; [`shipwick server status`](/docs/reference/cli#server-status) and [`shipwick doctor`](/docs/reference/cli#doctor) in the CLI reference.
