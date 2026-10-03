---
title: See what the proxy served
description: Read request rates, errors, latency percentiles and bytes with shipwick traffic, for every application or for one over the last hour, day or week, list and follow the most recent requests, and what is kept, for how long, and what the access log never carries.
---

# See what the proxy served

What an application writes is in `shipwick logs`. What was asked of it — how often, how it answered, how long it took — is in `shipwick traffic`, which reads what the proxy saw. This page shows the overview of every application, the totals of one over the last hour, day or week, the list of its most recent requests and how to follow it, what is kept and for how long, what is never recorded, the dashboard's Traffic panel, and the API endpoints behind it.

## Before you begin

- Traffic is counted for applications with a `domain`: the numbers come from the proxy's access log, and a request that never passes the proxy, one application calling another by name or a published port, is not in it.
- Any token can read it; the `read` role is enough.
- The agent must run next to its proxy as the standard installation does. An agent without a proxy, or with one that is not the `caddy` container of its own compose project, has no access log to read and answers `409 TRAFFIC_UNAVAILABLE`.

## Every application

```bash
shipwick traffic
```

```text
Requests through the proxy over the last hour
APP      REQ/MIN   5XX          P95     BYTES
my-api   208       20 (0.2%)    48ms    118 MB
web      12.4      0            2.1ms   3.2 MB
```

| Column | |
|---|---|
| `REQ/MIN` | Requests per minute, averaged over the window |
| `5XX` | Responses with a status of 500 and above, and their share of all requests |
| `P95` | The 95th percentile of the durations: 95 of 100 requests were at least this fast |
| `BYTES` | Response bodies as sent, after compression |

`--since 24h` and `--since 7d` widen the window; `1h` is the default, and these three are the values there are.

## One application

```bash
shipwick traffic my-api
shipwick traffic my-api --since 24h
```

```text
my-api  requests through the proxy over the last hour

Requests   12480  (208/min)
Status     12300 2xx · 40 3xx · 120 4xx · 20 5xx (0.2%)
Latency    p50 12ms · p95 48ms · p99 210ms
Sent       118 MB

Slowest paths among the last 200 requests
PATH          REQUESTS   SLOWEST
/checkout     14         1.2s
/api/users    96         48ms

Failing paths among the last 200 requests
PATH          5XX   LAST STATUS
/checkout     3     502
```

The totals cover the window `--since` names. The two tables below them do not: paths are known only for the requests the agent still remembers, the last 200 of the application, so they say where the time and the failures are right now. Up to five paths each; the second table is left out when none of those requests failed. Unlike `status` and `logs`, `traffic` does not read the name from `deploy.yaml`: without a name it is the overview.

A duration is measured by the proxy, from the first byte of the request to the last of the response. The percentiles are estimated from a histogram, so each is as exact as its bucket is wide: `48ms` means "between 25 and 50".

## The most recent requests

```bash
shipwick traffic my-api --requests          # the last 50
shipwick traffic my-api --requests -n 200   # all the agent keeps
shipwick traffic my-api --requests -f       # and every new one as it arrives
```

```text
15:04:05  200  GET /api/users  12ms  2 KB  203.0.113.7
15:04:06  502  POST /checkout  1.2s  45 B  203.0.113.9
```

One request per line, oldest first: the time in your time zone, the status, the method and path, the duration, the size of the response and the address of the client as the proxy saw it.

| Flag | Default | |
|---|---|---|
| `--since` | `1h` | How far back the totals look: `1h`, `24h` or `7d` |
| `--requests` | | List the most recent requests instead of the totals. Needs an application |
| `-n`, `--tail` | `50` | With `--requests`: how many to show, 1 to 200 |
| `-f`, `--follow` | | With `--requests`: keep printing new requests until Ctrl-C |

Following asks the agent again every other second. When more requests arrive between two looks than the agent keeps, the command says that some are not shown.

## What counts as a request of an application

A request counts for the application whose domain, alias or redirect it was sent to. Where several applications [share a hostname by path](/docs/tasks/paths-and-proxy), it counts for the one with the longest path the request is under.

Requests the proxy answered by itself count too: the `308` of a redirect, the `503` of a stopped application, the files of a static one. A static application has traffic like any other. Requests for the agent's and the dashboard's own hostnames are not logged.

## What is kept, and what is not

| | Kept | Where | For how long |
|---|---|---|---|
| Counts | Per application and minute: requests, the four status classes, bytes, and a histogram of durations | The agent's database, next to the metrics | Seven days |
| Requests | The last 200 of each application: time, method, path, status, duration, size, client address | The agent's memory | Until 200 newer ones arrive, or the agent restarts |
| The access log itself | Every line the proxy wrote | The Caddy container's standard output, in Docker's log files | Capped at 3 × 10 MB |

Neither the log nor the agent ever holds a query string or a header. The proxy removes request and response headers before a line is written and cuts the URL at the question mark: a path is all that is kept of a URL, so a token in a query string or an `Authorization` header never reaches the log.

After a restart of the agent the list of requests starts empty, and `--requests` says `No requests yet since the agent started.` The counts are not affected.

## The dashboard

The **Metrics** tab of every application's page shows its traffic, static applications included: requests per step with the 5xx among them, the 95th percentile of their durations, the window's totals over 1h, 24h or 7d, and the most recent requests one by one. See [Use the dashboard](/docs/tasks/dashboard).

## The API

| Endpoint | |
|---|---|
| `GET /applications/:name/traffic?since=1h` | Totals and a series of points over `1h`, `24h` or `7d`, in steps of a minute, five minutes or an hour |
| `GET /applications/:name/requests?tail=50` | The most recent requests, at most 200 |

Both need the `read` role. See the [API reference](/docs/reference/api).

## What's next

- [`shipwick traffic`](/docs/reference/cli#traffic) in the CLI reference.
- [Inspect applications and read logs](/docs/tasks/inspect-and-logs): what the application itself printed, and how its replicas are doing.
- [Alerts and metrics](/docs/tasks/alerts-and-metrics): CPU, memory and disk, and the Prometheus endpoint.
- [Routing and HTTPS](/docs/concepts/routing-and-https#what-the-proxy-saw): how the agent reads the access log, and what that costs.
