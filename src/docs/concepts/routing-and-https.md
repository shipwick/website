---
title: Routing and HTTPS
description: How Caddy serves application domains, aliases and redirects over HTTPS, how replicas are found by name instead of by proxy configuration, how traffic is balanced, what a deployment and a crash cost, what clients see when nothing can serve, and how ports that are not HTTP are published.
---

# Routing and HTTPS

Caddy stands in front of every application with a `domain`. It terminates TLS and proxies to the replicas; the agent tells it which name stands behind which hostname, and Docker's DNS tells it which replicas carry that name. This page describes how the proxy configuration is produced and kept in place, how replicas come and go without Caddy being reconfigured, how more hostnames are served or redirected, how traffic is balanced, what clients receive when nothing can serve, how a service that is not HTTP is published, and what is not supported.

## A domain is the whole configuration

```yaml
port: 8080
domain: api.example.com
```

Point the domain's DNS at the server and deploy. [Caddy](https://caddyserver.com) serves the domain over HTTPS: the certificate is obtained and renewed automatically, and plain HTTP is redirected to HTTPS.

```text
Internet ──▶ Caddy :443 ──▶ my-api_8080 ──┬──▶ shipwick_my-api_7_1
                                          └──▶ shipwick_my-api_7_2
```

Shipwick does not touch certificates, ACME or HTTP/3. The configuration it generates makes Caddy listen on `:443` with one host matcher per domain, and that is all Caddy needs to do the rest itself. For certificates to be issued, ports 80 and 443 of the server must be reachable from the internet. The production compose file also publishes 443/udp, for HTTP/3.

Application containers publish no host ports, unless `deploy.yaml` asks for some with `publish`; see [Ports that are not HTTP](#ports-that-are-not-http). Caddy reaches them over the private `shipwick-services` network, by name.

Caddy keeps certificates in its data volume (`caddy-data` in the production compose file). Back that volume up, and do not delete it casually.

## Several hostnames: aliases and redirects

```yaml
domain: example.com
aliases: [api.example.com]                  # served exactly like example.com
redirects: [www.example.com, example.net]   # 308 → https://example.com/<same path>
```

An application can answer to more than one hostname. Both lists need a `domain` and take up to 20 hostnames each, validated like the domain.

**Aliases** are more hostnames in the host matcher of the application's one route: the same handler, the same names behind it, nothing else to keep in step. A request to an alias is served by the same replicas as a request to the domain.

**Redirects** are a second route with no backend at all: a static `308` whose `Location` is `https://<domain>` plus the request's path and query. `https://www.example.com/docs?x=1` is answered with a `308` to `https://example.com/docs?x=1`. Because no replica is involved, redirects answer while the application is stopped or has no healthy replica, and a rollout never touches them. `308` rather than `301` keeps the method, so a `POST` to the old hostname stays a `POST`.

Every hostname, in either role, sits in a host matcher on `:443` like the domain does, which is all Caddy needs to obtain and renew a certificate for it: `https://www.example.com` has to be answered before it can be redirected. Point each hostname's DNS at the server. During a rollout, the rollout's routing carries the whole set of hostnames, not only the domain, so aliases do not disappear for its duration and reappear with a reload. See [Serve several hostnames and redirect www](/docs/tasks/several-hostnames).

## Replicas are found by name

Caddy is told a name, not a list of containers. Every application with a `port` has two names on the server's `shipwick-services` network: its own, `my-api`, which is what [other applications call](/docs/tasks/call-another-application), and one that includes the port, `my-api_8080`, which is what the proxy resolves. A replica answers to them exactly while it is ready for traffic: it takes the names once it passed its health check, and loses them the moment it stops. Docker's DNS returns one address per replica that carries the name, and Caddy asks it for every request.

```text
routing = for every replica that should serve: give it its names
        + for every running replica that should not: take them
        + tell Caddy: domain → <app>_<port>, for every name a running replica carries
```

**Ready** means running and not failing its health check. A replica whose health is `unknown` counts as ready. One that is `starting` does not: a restarted replica waits for its first passing check. See [Health checks and supervision](/docs/concepts/health-and-supervision).

- **A replica is born on both networks.** It joins `shipwick`, the network that holds the agent's health probes and its own connections to other applications, and `shipwick-services`, nameless. It is given its names there when it is ready, and loses them when it is not: running but failing its health check, or being restarted. A stopped container drops out of Docker's DNS by itself.
- **Names change by rejoining the network.** Docker sets a container's names on a network only when the container joins it, so giving or taking a name means leaving `shipwick-services` and joining it again. That cuts what the replica has open over that network and nothing else; its database connections live on `shipwick`. It is done to newcomers, which have nothing open, and never to a replica on its way out: that one is stopped with its names on, and stopping is what takes it out of DNS.
- **Caddy resolves the name for every request.** The route uses Caddy's `dynamic_upstreams` with an `A` lookup, refreshed every second, IPv4 only. Two versions of an application on different ports are two sources of one route while the rollout lasts.
- **A name is in the configuration only while a running replica carries it.** Docker's DNS forwards a name nobody carries to the outside resolvers, and every request would wait seconds for that to fail. With no such name, the route is a static `503`.
- **A rollout waits 1.5 seconds** between naming a new replica and stopping its predecessor, so that Caddy's next lookup has found the newcomer. An application with a single replica would otherwise spend that second with a proxy that only knows the replica that just stopped.

### Why names

Loading a Caddy configuration is not free. Caddy replaces its servers, and a connection that is being established at that instant, a TLS handshake in progress or a first request not yet read, is reset. The client sees a connection error, never an error status. This reproduces with Caddy alone, in every version from 2.7 to 2.11, and its `grace_period` and `shutdown_delay` settings do not change it. Measured with a new connection per request from 100 ms away, one reload per replica replaced cost 5 of 233 requests through two minutes of redeploys.

So replicas must come and go without Caddy hearing of it. What Caddy is told, which name stands behind which domain, changes only when a domain or a port does. A rollout, a crash or a restart changes who carries a name, and that is Docker's DNS, not Caddy's configuration.

## The agent owns the configuration

The agent owns Caddy's configuration entirely. Whenever the routes change it renders the complete Caddy JSON and sends it to the admin API's `/load` endpoint. There is no patching of individual configuration paths, hence no half-applied state and no drift. The same routes always produce the same bytes.

```text
routes = for every application with a domain:
           domain + aliases → <app>_<port>, or a static 503 while no running replica carries the name
           redirects        → 308 to https://<domain>, no backend
       + the agent's own route      (SHIPWICK_AGENT_DOMAIN)
       + the dashboard's route      (SHIPWICK_DASHBOARD_DOMAIN)
```

::: warning Do not edit Caddy's configuration by hand
Manual changes are overwritten the next time the agent loads its configuration. Custom Caddy directives are not supported.
:::

### Who syncs routing, and when

Routing, both the names and the Caddy configuration, is synced by:

- a rollout, at every swap of a replica;
- `stop`, `start` and `delete`;
- the supervisor, at the end of every tick, once per second. This is what takes a replica that fails its health check off the name within a second and puts it back once it passes again, and what gives a restarted replica its names once it is ready.

Naming is two calls to Docker, and all of it runs under one lock, because two callers renaming the same replica would collide in the middle. The proxy part is cheap: the rendered configuration is fingerprinted, and an unchanged fingerprint skips the load. The configuration changes when a hostname or a port does, or when a name gains or loses its last running replica. A rollout, a crash or a restart is not that.

### Verification

The fingerprint covers the rendered configuration, not only the routes, so an agent upgrade that renders routes differently reloads Caddy once. It is embedded in the configuration as the `@id` of the final catch-all route. Every 10 seconds the agent asks Caddy for that id and loads the configuration again if it is gone, which is the case when Caddy came back from a restart with an older configuration. The agent also syncs routing once at its own startup.

If Caddy cannot be reached, the agent logs the problem when it appears and when it clears, and retries on every tick. Applications keep running. `GET /api/v1/server` and `shipwick server status` report the proxy's state: `enabled`, `reachable`, the last `error`, and the number of `routes`.

### During a rollout

While a rollout is in progress, the rollout dictates the application's routing. It registers the exact list of replicas that serve at that moment, a mix of two deployments, and updates it at every swap: the new replica in and named, the 1.5 second settle wait, then the predecessor stopped.

This exists for the supervisor's sake. Its tick computes routing from the database, which until the commit still names the old deployment, and would hand the names straight back to replicas the rollout has just retired. At the commit the rollout's list is dropped, because the database now says the same thing. On failure it is dropped too, and routing follows the database back to the previous deployment. Under `recreate`, the list says "nobody" from the moment the old version is stopped until the new one is ready, and the domain answers `503` meanwhile.

A proxy or a Docker that cannot be updated fails the deployment at that swap, before the predecessor is touched.

## Load balancing

Requests are spread over the replicas that carry the name, round-robin. Only ready replicas carry it: a replica that fails its health check is taken off the name within a second, at the supervisor's next tick, and put back once it passes again; one that crashes disappears from Docker's DNS at once.

Each application route is generated with these settings:

| Setting | Value | Purpose |
|---|---|---|
| Selection policy | `round_robin` | Spread requests evenly. |
| Upstreams | `dynamic_upstreams`, `A` records of `<app>_<port>`, `refresh` `1s`, IPv4 only | Ask Docker's DNS who carries the name. An `AAAA` query would be forwarded to the outside resolvers and hold up the answer. |
| `try_duration` | `5s` | A failed connection is retried on another replica. Only connection failures are retried: a request that reached an application is never sent twice. |
| `dial_timeout` | `500ms` | Notice a dead replica in time. Replicas are one bridge hop away; a connection that takes half a second is not going to happen. |
| Passive health check | `max_fails: 1`, `fail_duration: 5s` | Having failed once, a dead replica is skipped by the requests behind it instead of costing each one a timeout. |

## When nothing can serve

| Situation | What the client gets |
|---|---|
| No running replica carries the application's name | `503 Service Unavailable`, with `Retry-After: 5` and the body `503 Service Unavailable: no healthy replica.` The route is a static `503`. |
| The last replica died and the supervisor has not looked yet | The same `503`. A server-level error route turns the `502` or `503` Caddy would produce when it finds nobody behind the name into the same answer. |
| The application was stopped with `shipwick stop` | The same `503`. The route stays in the configuration, so the domain keeps its certificate. |
| A `recreate` deployment is between stopping the old version and the new one being ready | The same `503`. |
| The hostname is one of the application's `redirects`, whatever the application's state | `308 Permanent Redirect` to `https://<domain>` with the same path and query. No replica is involved. |
| No application is served at the requested hostname | `404 Not Found`, with the body `404 Not Found: no application is served at this address.` |

An explicit `503` is generated because Caddy's own answer would be a bare `502`. The application is known; it just has no healthy replica. The domain answers at once instead of timing out.

`stop` follows the same order as a rollout, in reverse: the route goes to the static `503` first, and the containers receive `SIGTERM` second, so no request is cut off mid-flight. Their names go with them. `start` brings the replicas back nameless; they earn the names when they are ready.

## What a deployment costs

A planned change loses no request. A new replica takes the name only once it is healthy; the old one it replaces keeps answering until it is stopped, and taking it off the name is the same thing as stopping it. Caddy's configuration is not touched: nothing is reloaded, and nothing is reset.

Measured on the real stack, with a new connection per request, 12 clients and 50 ms of added latency, through 18 consecutive rolling redeploys: 15,774 of 15,774 requests answered, 0 Caddy loads.

A reload still happens when a domain or a port changes, and a reload is the one thing that costs requests: Caddy resets connections that are being established at that instant, as described under [Why names](#why-names). Established connections are not affected. If a client of yours opens a connection per request and you change a domain or a port under load, give it a retry on connection errors.

## What a crash costs

An unplanned change is not lossless, and cannot quite be:

- Requests in flight on the replica that died are lost with it.
- A crashed replica leaves Docker's DNS at once. Until the supervisor's next tick, within a second, moves the route to the static `503`, a request whose lookup still lists the dead address is retried on another replica, within `try_duration`, the `dial_timeout` and the passive health check, or, if it was the last replica, answered `503`.

Everything after that goes to the surviving replicas.

## One hostname, one application

A hostname belongs to one application, in one role. A deployment that claims a hostname already in use, whether as its domain, an alias or a redirect, and whatever role the hostname has on the other side, is refused as a configuration error before anything is recorded, pulled or started. The error names the line of `deploy.yaml` to change:

```text
invalid deploy.yaml

aliases[1]:
  already served by application "web"
```

The check covers the domain, aliases and redirects of every other application's active deployment, and the hostnames the agent serves itself: an application cannot claim `SHIPWICK_AGENT_DOMAIN` or `SHIPWICK_DASHBOARD_DOMAIN`. Within one file, each hostname may appear once: `"www.example.com" is already listed under aliases[0]`. Through the API this is a `400 INVALID_CONFIG` error whose field is `domain`, `aliases[0]` or `redirects[1]`. A redeploy and a rollback are checked the same way, since a stored configuration's hostnames may have been taken since. Two routes for one hostname would silently send all traffic to whichever sorts first, which is why the rule has no exceptions.

Domains, aliases and redirects are validated hostnames: lowercase letters, digits and dashes in dot-separated labels, at most 253 characters. No scheme, port, path or wildcard is accepted. See the [deploy.yaml reference](/docs/reference/deploy-yaml#domain).

The names on the services network are as exclusive as the domains: `agent`, `caddy`, `dashboard` and `localhost` belong to Shipwick's own containers there and are refused as application names.

## Ports that are not HTTP

The proxy speaks HTTP. A service that does not, a database a laptop connects to or a game server, is published on the server's own ports with `publish`. This is the one exception to "no host ports":

```yaml
publish:
  - port: 5432        # inside the container
    host: 15432       # on the server; default: the same as port
    address: 10.0.0.5 # optional; default: every address of the server
    protocol: tcp     # or udp
```

Exactly the listed container ports are bound on the server, on the given address or on every address. Nothing else changes: the container is on the same networks, other applications still reach it by name, and the port comes and goes with the replica.

- **Only with `deploy.strategy: recreate` and one replica.** A server port has one holder, so the old version must be gone before the new one binds it, and two replicas cannot share it. Validation refuses anything else.
- **Ports Shipwick holds are refused**: 80, 443, 8080 and 8443 are the proxy's, and the port the agent listens on is its own. So is a port another application's active configuration publishes on the same address, or on every address. The check runs before anything is recorded, with the field `publish[0].host` and the message `already published by application "postgres"`. Docker would refuse the second bind too, but only when the container starts, which under `recreate` is after the old version has been stopped.
- **The proxy is not involved.** A published port bypasses Caddy entirely; there is no TLS, no hostname and no health-based rotation in front of it.

::: warning Published ports bypass the host firewall
On most distributions Docker inserts its own iptables rules ahead of ufw's or firewalld's, so a port published on every address is reachable from the internet whatever the firewall says. Publish only what must be reachable from outside the server, bind it to a private address where one exists (`address: 10.0.0.5`, a VPN or private-network interface), and keep what only other applications need unpublished: they reach it by name on the `shipwick` network.
:::

See [Expose a service that is not HTTP](/docs/tasks/non-http-services).

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

Applications still reach each other by name; the names do not depend on Caddy.

## Security of the admin API

Caddy's admin API is as sensitive as the agent's own: whoever reaches it controls all routing and the certificate store. In the standard installation it is a unix socket in a volume that only the agent and Caddy share. Do not move it to a TCP port on the application network, where every application container could reconfigure the proxy.

The configuration is built as data and serialized, never assembled from strings, so input cannot change its structure. See [Security](/docs/security).

## What is not supported

- Custom Caddy directives per application, such as headers or basic authentication. The generated route matches on the hostnames only and proxies everything to the application's `port`; the only other route it generates is the `308` for `redirects`.
- Wildcard domains. Every hostname is listed explicitly, as the `domain`, an alias or a redirect.
- Reaching an application's name from outside the server. The names exist on the `shipwick-services` network only. A port that must be reachable from outside is published with `publish`.
