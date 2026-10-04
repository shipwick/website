---
title: Resource limits and metrics
description: How cpu and memory limits are written, parsed and applied to containers, what happens at the limit and what is said before it, how CPU and memory usage are measured and reported, how a week of history is sampled and served, and what the agent exposes to Prometheus.
---

# Resource limits and metrics

`resources` in `deploy.yaml` sets CPU and memory limits per replica, and the agent reports usage against them, live and over the last week. This page describes the units and parsing rules, the Docker settings the limits become, what an application without a limit does to a small server, what happens at the limit and the alert that comes before it, what a Docker daemon that does not enforce limits means, how metrics are measured, how the history is sampled, stored and served, and the same numbers in the Prometheus format.

## Limits

```yaml
resources:
  cpu: 2
  memory: 1gb
```

Limits apply to each replica, not to the application as a whole. Two replicas with `memory: 1gb` may use 2 GB together. Both fields are optional and independent. Without a `resources` block a replica may use whatever the server has.

### cpu

`cpu` is a number of cores. Fractions are allowed.

| | |
|---|---|
| Accepted | A decimal number: `0.5`, `1`, `2`, `1.5` |
| Minimum | `0.01` |
| Maximum | `512` |
| Default | Unlimited |
| Docker setting | `NanoCPUs` = cores × 10⁹ |

`cpu: 0.5` lets a replica use half of one core's time. `cpu: 2` lets it keep two cores busy.

### memory

`memory` is a number followed by a unit.

| | |
|---|---|
| Accepted | A whole or decimal number and a unit: `128mb`, `512mb`, `1gb`, `1.5gb` |
| Units | `b`, `k` / `kb` / `kib`, `m` / `mb` / `mib`, `g` / `gb` / `gib`. No unit means bytes. |
| Unit base | Binary, matching Docker's own convention: `1gb` = 1024 `mb` = 1,073,741,824 bytes. `mb` and `mib` are the same. |
| Case and spacing | Case-insensitive. Whitespace between number and unit is allowed: `512 MB`. |
| Minimum | `6mb`, the smallest memory limit Docker accepts |
| Default | Unlimited |
| Docker settings | `Memory` = the value in bytes; `MemorySwap` = the same value |

A value that does not parse is reported by field, like any other validation error:

```text
invalid deploy.yaml

resources.memory:
  invalid value "abc"
  expected: 128mb, 512mb, 1gb, ...
```

### Swap

`MemorySwap` is set equal to `Memory`. In Docker's terms that is a limit on memory plus swap that equals the memory limit, so the container cannot use swap to go beyond it. The memory limit is a hard cap.

### An application without a limit

Without a limit a replica may use whatever the server has. That is how one application takes a small server down: it leaks, the server's memory fills, and the kernel kills a process — not necessarily the one that leaked.

Since 0.8 `shipwick doctor` names the running applications that have no memory limit, and says when the server has no swap, which is what turns a full memory into a killed process at once:

```text
! 3 applications run without a memory limit: postgres, redis, web. One that leaks takes the server's memory from all the others; set resources.memory in deploy.yaml
! The server has no swap: once its 4 GB of memory is used, the kernel kills a process at once. Add a swap file on the server
```

`shipwick server status` and the dashboard show the swap next to the memory, and `GET /server` has `swap_bytes` and `unlimited_memory`. Shipwick reports both and changes neither: a limit is a line in `deploy.yaml`, swap is the server's. See [Prepare a server](/docs/tasks/prepare-a-server#a-swap-file).

### Limits that are not enforced

Limits are Docker's to enforce, and a daemon without the cgroup controllers — rootless Docker that was delegated none — accepts them and applies nothing. Docker does not say so when the container is created. Since 0.8 Shipwick does, wherever a limit is shown: on the deployment, in `shipwick status`, in `shipwick server status` and in `shipwick doctor`.

```text
$ shipwick status
Limits     0.5 CPU, 64 MB  (Docker on this server does not enforce the memory and CPU limits; see shipwick doctor)
```

`GET /server` has `docker: {rootless, unenforced_limits}`, and an application's metrics `unenforced_limits`. On such a server the usage reported for one replica is that of everything the daemon runs, and the `memory` alert is not raised: there is no limit for a replica to come close to. See [Rootless Docker](/docs/tasks/less-than-the-docker-socket#limits).

## At the limit

**CPU.** A replica that wants more CPU time than its limit is throttled by the kernel. It runs slower; nothing is killed or restarted.

**Memory.** A container that exceeds its memory limit is killed by the kernel's out-of-memory killer. Shipwick reports it as such, not as an ordinary exit:

- During a deployment, the deployment fails with "replica 1 was killed for exceeding its memory limit shortly after start" (or "before it became healthy").
- Afterwards, the supervisor records "Replica 1 was killed for exceeding its memory limit" and restarts the replica as `restart.policy` allows. An out-of-memory kill counts as a failure, so `on-failure` restarts it too.
- `shipwick status` shows the container's state as `out of memory`, and the API reports `oom_killed: true` for it.

A replica that is killed repeatedly goes through the usual backoff and ends in `CRASH_LOOP`. See [Health checks and supervision](/docs/concepts/health-and-supervision).

### Before the limit is hit

Since 0.5 a replica that stays at or above 90% of its `resources.memory` for three samples in a row, a minute and a half, raises the `memory` alert, and clears it below 80%:

```text
my-api replica 1 is at 93% of its memory limit (240 MB of 256 MB). At the limit it is killed and restarted; raise resources.memory in deploy.yaml, or watch it with: shipwick status my-api
```

The alert goes to the webhook, into the application's events and into `shipwick server status`. It is decided from the samples of the [history](#history), not from a second reading, and an application without a memory limit has no such alert; nor has any application on a server where Docker [does not enforce the limit](#limits-that-are-not-enforced). The threshold is `SHIPWICK_ALERT_MEMORY_PERCENT` on the agent. The same samples watch the server's disk, which `GET /server` and `shipwick server status` report. See [Alerts and metrics](/docs/tasks/alerts-and-metrics).

## Metrics

Usage is one command away, and live in the dashboard, with a week of history next to it:

```text
$ shipwick status
my-api  ● HEALTHY

Replicas   2/2 healthy
CPU        42% / 400%
Memory     412 MB / 2 GB
```

The numbers come from Docker's stats API and agree with `docker stats`. They are served by `GET /api/v1/applications/:name/metrics`:

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

### CPU: percent of one core

CPU usage is in percent of one core, as in `docker stats`. A replica keeping two cores busy reads 200. The limit uses the same unit: `cpu: 2` is a `cpu_limit_percent` of 200, and two replicas limited to `cpu: 2` each may use up to 400% together.

### Memory: the working set

Memory is the working set: usage minus the page cache the kernel would give back under pressure. It is what `docker stats` shows and what the memory limit is enforced against.

### How limits are reported

Limits in the metrics come from the deployment's stored configuration, not from Docker, which reports the host's memory for an unlimited container. A limit of `0` means unlimited. `shipwick status` then shows the usage alone, without a ceiling.

Application-level numbers are sums over the replicas, for usage and for limits.

A replica that is not running reports zeros for usage and never fails the request. An application with no active deployment answers `409 NOT_DEPLOYED`; a static application, served by the proxy from a folder, has no containers to measure and answers `409 STATIC_APPLICATION`.

### Point-in-time sampling

A metrics response is a point-in-time sample; the history is described below. The dashboard's sparklines are built in the browser from these samples while the page is open.

CPU usage is a rate, so it takes two readings. Docker will take both itself, a second apart, which would make every request cost a second. Instead the agent remembers the last reading of each container and computes the rate against it:

- A client polling every few seconds is answered in milliseconds. Measured: 1.01 seconds for a first request, 5 milliseconds for the ones after.
- A first request, or one after a pause of more than a minute, falls back to Docker's blocking two-sample call and takes about a second.
- Readings less than 500 milliseconds apart are not compared either, because they make a noisy rate. That request also falls back to the two-sample call.

Replicas are measured in parallel, so a first request costs about a second in total, not a second per replica.

## History

The agent records the CPU and memory of every running replica every 30 seconds and keeps seven days of it, in its own database. The dashboard charts the last hour, day or week per replica, next to the limits; `GET /api/v1/applications/:name/metrics/history?since=1h|24h|7d` serves the same series.

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

### How it is sampled

A second loop in the agent, started with the supervisor, takes one cheap reading per running replica every 30 seconds and computes the rate against the previous one, through the same cache the live endpoint uses: a dashboard that is polling and the sampler feed each other's readings. The first reading of a container only primes the rate, so a replica appears in the history a minute after it starts, and an application that was just deployed answers with empty series until then. Rows are written in one transaction per tick and pruned once an hour to the retention of seven days. Replicas of a stopped application are not sampled.

### How it is served

The rows are raw and aggregation happens on read, in SQL. A week of 30-second samples of three replicas is 60,000 rows, a few megabytes, and storing them raw buys a step chosen per query instead of a resolution decided at write time:

| `since` | Window | `step` | Points per series |
|---|---|---|---|
| `1h` (default) | The last hour | `30s` | Up to 120 |
| `24h` | The last day | `5m` | Up to 288 |
| `7d` | The last week | `1h` | Up to 168 |

Each point aggregates the samples of one step: `cpu_percent` is their average, `memory_bytes` their peak, `at` is the start of the step. A step in which a replica has no sample, because it was not running or the agent was down, has no point: the series are sparse, never zero-filled or interpolated, so a gap in the chart is a gap in the record. Any other value of `since` is `400 INVALID_REQUEST`; an application with no active deployment answers `409 NOT_DEPLOYED`.

`limits` are the active deployment's per-replica limits as written in `deploy.yaml`, `cpu` in cores and `memory_bytes` in bytes, `0` when unlimited. The dashboard draws the CPU limit line at `cpu × 100`, in the same unit as the points, one line per replica, and refreshes every 30 seconds, the sampling interval. Replica *n* keeps series color *n*, as in the log viewer.

## Prometheus

Since 0.5 the agent serves what it knows at `GET /metrics`, in the Prometheus text format, to a token of the `read` role: each application's status and replica counts, each replica's CPU, memory, memory limit and restarts, deployments by outcome and the duration of the last one, the disk, and the active alerts.

```text
shipwick_replica_cpu_ratio{application="my-api",replica="1"} 0.21
shipwick_replica_memory_bytes{application="my-api",replica="1"} 2.16006656e+08
shipwick_replica_memory_limit_bytes{application="my-api",replica="1"} 1.073741824e+09
```

A scrape costs the server next to nothing: it reads the agent's database and what the supervisor and the sampler last saw, and never asks Docker. CPU and memory are therefore those of the last 30-second sample, not a live reading, and the units differ from the JSON endpoints above: `shipwick_replica_cpu_ratio` is in cores, where 1 is one core kept busy and `cpu_percent` would read 100. `shipwick_replica_memory_limit_bytes` is absent for a replica without a limit, and a replica without a sample in the last 75 seconds, stopped or started less than a minute ago, has no CPU and memory series. The scrape configuration and every series are in [Alerts and metrics](/docs/tasks/alerts-and-metrics#scrape-the-agent-with-prometheus) and under [`GET /metrics`](/docs/reference/api#get-metrics) in the API reference.
