---
title: Resource limits and metrics
description: How cpu and memory limits are written, parsed and applied to containers, what happens at the limit, and how CPU and memory usage are measured and reported.
---

# Resource limits and metrics

`resources` in `deploy.yaml` sets CPU and memory limits per replica, and the agent reports usage against them. This page describes the units and parsing rules, the Docker settings the limits become, what happens at the limit, and how metrics are measured.

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

## At the limit

**CPU.** A replica that wants more CPU time than its limit is throttled by the kernel. It runs slower; nothing is killed or restarted.

**Memory.** A container that exceeds its memory limit is killed by the kernel's out-of-memory killer. Shipwick reports it as such, not as an ordinary exit:

- During a deployment, the deployment fails with "replica 1 was killed for exceeding its memory limit shortly after start" (or "before it became healthy").
- Afterwards, the supervisor records "Replica 1 was killed for exceeding its memory limit" and restarts the replica as `restart.policy` allows. An out-of-memory kill counts as a failure, so `on-failure` restarts it too.
- `deployctl status` shows the container's state as `out of memory`, and the API reports `oom_killed: true` for it.

A replica that is killed repeatedly goes through the usual backoff and ends in `CRASH_LOOP`. See [Health checks and supervision](/docs/concepts/health-and-supervision).

## Metrics

Usage is one command away, and live in the dashboard:

```text
$ deployctl status
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

Limits in the metrics come from the deployment's stored configuration, not from Docker, which reports the host's memory for an unlimited container. A limit of `0` means unlimited. `deployctl status` then shows the usage alone, without a ceiling.

Application-level numbers are sums over the replicas, for usage and for limits.

A replica that is not running reports zeros for usage and never fails the request. An application with no active deployment answers `409 NOT_DEPLOYED`.

### Point-in-time sampling

A metrics response is a point-in-time sample. There is no background sampler: with nobody watching, nothing is measured, and nothing is stored. History is the client's business. The dashboard builds its sparklines in the browser while the page is open; any other client builds history by polling.

CPU usage is a rate, so it takes two readings. Docker will take both itself, a second apart, which would make every request cost a second. Instead the agent remembers the last reading of each container and computes the rate against it:

- A client polling every few seconds is answered in milliseconds. Measured: 1.01 seconds for a first request, 5 milliseconds for the ones after.
- A first request, or one after a pause of more than a minute, falls back to Docker's blocking two-sample call and takes about a second.
- Readings less than 500 milliseconds apart are not compared either, because they make a noisy rate. That request also falls back to the two-sample call.

Replicas are measured in parallel, so a first request costs about a second in total, not a second per replica.
