---
title: Routing and HTTPS
description: How Caddy serves application domains over HTTPS, how the agent owns and verifies the proxy configuration, how traffic is balanced, and what clients see when replicas are unavailable.
---

# Routing and HTTPS

Caddy stands in front of every application with a `domain`. It terminates TLS and proxies to the replicas; the agent tells it what to route where. This page describes how the proxy configuration is produced and kept in place, how traffic is balanced, what clients receive when nothing can serve, and what is not supported.

## A domain is the whole configuration

```yaml
port: 8080
domain: api.example.com
```

Point the domain's DNS at the server and deploy. [Caddy](https://caddyserver.com) serves the domain over HTTPS: the certificate is obtained and renewed automatically, and plain HTTP is redirected to HTTPS.

```text
Internet ──▶ Caddy :443 ──▶ shipwick_my-api_7_1:8080
                       └──▶ shipwick_my-api_7_2:8080
```

Shipwick does not touch certificates, ACME or HTTP/3. The configuration it generates makes Caddy listen on `:443` with one host matcher per domain, and that is all Caddy needs to do the rest itself. For certificates to be issued, ports 80 and 443 of the server must be reachable from the internet. The production compose file also publishes 443/udp, for HTTP/3.

Application containers publish no host ports. Caddy reaches them over the private `shipwick` network, by container name. Names are used instead of IP addresses because a restarted container may get a new address, and Docker's DNS always knows the current one.

Caddy keeps certificates in its data volume (`caddy-data` in the production compose file). Back that volume up, and do not delete it casually.

## The agent owns the configuration

The agent owns Caddy's configuration entirely. On every routing change it renders the complete Caddy JSON from the desired routes and sends it to the admin API's `/load` endpoint, which Caddy applies gracefully: connections are not dropped. There is no patching of individual configuration paths, hence no half-applied state and no drift. The same routes always produce the same bytes.

```text
desired routes = for every application with a domain:
                   the ready replicas of its serving deployment
                 + the agent's own route      (SHIPWICK_AGENT_DOMAIN)
                 + the dashboard's route      (SHIPWICK_DASHBOARD_DOMAIN)
```

**Ready** means running and not failing its health check. A replica whose health is `unknown` counts as ready. One that is `starting` does not: a restarted replica waits for its first passing check. See [Health checks and supervision](/docs/concepts/health-and-supervision).

::: warning Do not edit Caddy's configuration by hand
Manual changes are overwritten the next time the agent loads its configuration. Custom Caddy directives are not supported.
:::

### Who updates routing, and when

- A rollout, at every swap of a replica.
- `stop`, `start` and `delete`.
- The supervisor, at the end of every tick, once per second. This is what takes crashed and unhealthy replicas out of rotation and puts recovered ones back.

Syncing every second is affordable because the rendered configuration is fingerprinted, and an unchanged fingerprint skips the reload.

### Verification

The fingerprint covers the rendered configuration, not only the routes, so an agent upgrade that renders routes differently reloads Caddy too. It is embedded in the configuration as the `@id` of the final catch-all route. Every 10 seconds the agent asks Caddy for that id and loads the configuration again if it is gone, which is the case when Caddy came back from a restart with an older configuration. The agent also syncs the proxy once at its own startup.

If Caddy cannot be reached, the agent logs the problem when it appears and when it clears, and retries on every tick. Applications keep running. `GET /api/v1/server` and `shipwick server status` report the proxy's state: `enabled`, `reachable`, the last `error`, and the number of `routes`.

### During a rollout

While a rollout is in progress, the rollout dictates the application's routing. It registers the exact list of replicas that serve at that moment, a mix of two deployments, and updates it at every swap: new replica in, its predecessor out, load the configuration, then retire the predecessor.

This exists for the supervisor's sake. Its tick computes routes from the database, which until the commit still names the old deployment, and would route traffic straight back to replicas the rollout has just retired. At the commit the rollout's list is dropped, because the database now says the same thing. On failure it is dropped too, and routing follows the database back to the previous deployment.

A proxy that cannot be updated fails the deployment at that swap, before the predecessor is touched.

## Load balancing

Requests are spread over the ready replicas round-robin. Only ready replicas are in the configuration at all: a replica that crashes or fails its health check leaves the rotation within about a second, at the supervisor's next tick, and rejoins once it passes again.

Each application route is generated with these settings:

| Setting | Value | Purpose |
|---|---|---|
| Selection policy | `round_robin` | Spread requests evenly. |
| `try_duration` | `5s` | A failed connection is retried on another replica. Only connection failures are retried: a request that reached an application is never sent twice. |
| `dial_timeout` | `500ms` | Notice a dead replica in time. Docker's DNS takes seconds to give up on a container name it no longer knows, longer than any retry budget. Replicas are one bridge hop away. |
| Passive health check | `max_fails: 1`, `fail_duration: 5s` | Having failed once, a dead replica is skipped by the requests behind it instead of costing each one a timeout. |

## When nothing can serve

| Situation | What the client gets |
|---|---|
| The application has no ready replica | `503 Service Unavailable`, with `Retry-After: 5` and the body `503 Service Unavailable: no healthy replica.` |
| The application was stopped with `shipwick stop` | The same `503`. The route stays in the configuration, so the domain keeps its certificate. |
| No application is served at the requested hostname | `404 Not Found`, with the body `404 Not Found: no application is served at this address.` |

An explicit `503` is generated because Caddy's own answer to a route without upstreams would be a bare `502`. The application is known; it just has no healthy replica. The domain answers at once instead of timing out.

`stop` follows the same order as a rollout, in reverse: routing goes to "no upstreams" first and the containers receive `SIGTERM` second, so no request is cut off mid-flight.

## What a crash costs

Planned changes are lossless. Measured under constant load: 100 of 100 requests answered `200` through a rolling redeploy, and 76 of 76 through a rollout that failed half-way and was rolled back.

An unplanned change is not lossless, and cannot quite be:

- Requests in flight on the replica that died are lost with it.
- The one request that discovers the dead replica may get a `502`.

Caddy would normally retry that request on another replica. But it abandons retries in progress when its configuration is reloaded, and removing the dead replica from the configuration is a reload. The short dial timeout and the passive health check keep the window to about half a second and one request. Everything after it goes to the surviving replicas.

Delaying the removal to let retries finish was considered and rejected as not worth the machinery.

## One domain, one application

A domain belongs to one application. A deployment that claims a domain already in use is refused as a configuration error before anything is recorded, pulled or started:

```text
invalid deploy.yaml

domain:
  already served by application "web"
```

The check covers the domain of every other application's active deployment and the hostnames the agent serves itself: an application cannot claim `SHIPWICK_AGENT_DOMAIN` or `SHIPWICK_DASHBOARD_DOMAIN`. Through the API this is a `400 INVALID_CONFIG` error with the field `domain`.

Domains are validated hostnames: lowercase letters, digits and dashes in dot-separated labels, at most 253 characters. No scheme, port, path or wildcard is accepted. See the [deploy.yaml reference](/docs/reference/deploy-yaml#domain).

## The API and the dashboard on hostnames

The agent can serve its own API and the dashboard through the same Caddy, which is how they get HTTPS:

| Variable | Effect |
|---|---|
| `SHIPWICK_AGENT_DOMAIN` | The agent's API is served at this hostname. |
| `SHIPWICK_DASHBOARD_DOMAIN` | The dashboard is served at this hostname, proxied to `SHIPWICK_DASHBOARD_UPSTREAM` (default `dashboard:3000`). |

```bash
shipwick login --url https://agent.example.com
```

Both require `SHIPWICK_CADDY_ADMIN` to be set, and the two hostnames must differ. Both routes are generated with response buffering disabled, because followed logs are a stream and must arrive line by line.

Serving the API at a hostname is the way to reach it from a laptop or from CI without an SSH tunnel. The alternative is described in [Reach the API without a hostname](/docs/tasks/access-without-a-hostname). Variables are described in [Agent configuration](/docs/reference/agent-configuration).

## Without a proxy

If `SHIPWICK_CADDY_ADMIN` is not set, routing is disabled. Domains are recorded but nothing serves them. The agent warns at startup, and a deployment of an application with a domain records a warning step:

```text
No reverse proxy is configured, so api.example.com is not being served. Set SHIPWICK_CADDY_ADMIN on the agent
```

## Security of the admin API

Caddy's admin API is as sensitive as the agent's own: whoever reaches it controls all routing and the certificate store. In the standard installation it is a unix socket in a volume that only the agent and Caddy share. Do not move it to a TCP port on the application network, where every application container could reconfigure the proxy.

The configuration is built as data and serialized, never assembled from strings, so input cannot change its structure. See [Security](/docs/security).

## What is not supported

- Custom Caddy directives per application, such as headers, redirects or basic authentication. The generated route matches on the hostname only and proxies everything to the application's `port`.
- More than one domain per application, and wildcard domains. `domain` is a single hostname.
