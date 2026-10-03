---
title: Routing and HTTPS
description: How Caddy serves application domains, aliases, wildcards and redirects over HTTPS, how several applications share a hostname by path, what the proxy block adds, how replicas are found by name instead of by proxy configuration, how certificates are obtained directly, through Cloudflare DNS or supplied by you, how traffic is balanced and counted, what a deployment and a crash cost, what clients see when nothing can serve, and how ports that are not HTTP are published.
---

# Routing and HTTPS

Caddy stands in front of every application with a `domain`. It terminates TLS and proxies to the replicas; the agent tells it which name stands behind which hostname, and Docker's DNS tells it which replicas carry that name. This page describes how the proxy configuration is produced and kept in place, how replicas come and go without Caddy being reconfigured, how more hostnames are served or redirected, how several applications share one hostname by path, what the `proxy` block of `deploy.yaml` adds to a route, how wildcard hostnames work, how traffic is balanced and responses compressed, what clients receive when nothing can serve, how a hostname waits for its DNS record, how certificates are obtained with Cloudflare in front of the server or supplied by you, how their status is reported, what the agent reads from the proxy's access log, how a static site is served from a folder, how a service that is not HTTP is published, and what is not supported.

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

Shipwick does not reimplement certificates, ACME or HTTP/3. The configuration it generates makes Caddy listen on `:443` with one host matcher per domain, and that is all Caddy needs to do the rest itself. For certificates to be issued, ports 80 and 443 of the server must be reachable from the internet, unless certificates come through a DNS record; see [Behind Cloudflare](#behind-cloudflare). The production compose file also publishes 443/udp, for HTTP/3.

The proxy is Shipwick's own build of Caddy, `ghcr.io/shipwick/caddy`: the official image plus the Cloudflare DNS module and nothing else, on every installation whether or not a Cloudflare token is set. It is pinned to the release like the agent and the dashboard; [`SHIPWICK_CADDY_IMAGE`](/docs/reference/agent-configuration#shipwick-caddy-image) overrides it.

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

A hostname that is redirected belongs to one application. One that is served, as a domain or an alias, can be shared by several applications, path by path.

## Paths on one hostname

`path` limits an application to one part of its domain, so that several applications answer under one hostname:

```yaml
name: api                 # example.com/api and everything under it
domain: example.com
path: /api
```

```yaml
name: web                 # the rest of example.com
domain: example.com
```

The longest path wins: with a third application at `/api/admin`, a request for `/api/admin/users` goes there, `/api/users` to `api`, and everything else to `web`. Without an application that takes the rest, the rest is a `404`. A path matches whole segments, `/api` and `/api/users` but not `/apix`, and without regard to case, so `/API` and `/api` are one path.

Applications that share a hostname stay separate routes with separate backends: each keeps its own name on the services network, its own replicas, health checks, rollouts and rollbacks, and its own `503` when it is down. In the generated configuration the route's matcher is the hostnames and the two patterns `/api` and `/api/*`, and routes are ordered by the length of their path, longest first and the ones without a path last. Aliases are served under the same path; `redirects` remain whole hostnames.

The application sees the path as the visitor sent it, `/api/users`. Most frameworks can be told their base path. For one that cannot, `proxy.strip_prefix: true` removes the prefix and the application sees `/users`; its redirects and links must then add the prefix themselves, because the proxy does not rewrite responses. That is why passing the request on as it came is the default.

See [Share a hostname by path and configure the proxy](/docs/tasks/paths-and-proxy).

## Headers, passwords and path redirects

The `proxy` block says what Caddy does for an application's requests beyond passing them on:

```yaml
domain: example.com
proxy:
  headers:                        # on every response
    X-Frame-Options: DENY
    Strict-Transport-Security: max-age=31536000
  basic_auth:
    - path: /admin                # optional; without it, the whole application
      username: admin
      password: ${ADMIN_PASSWORD}
  redirects:
    - from: /old
      to: /new                    # or https://elsewhere.example/page
      status: 308                 # 301, 302, 307 or 308
```

A request meets them in that order: a redirect answers first, then the proxy asks for a password, then the application, or the folder of a static one, answers, and the headers are set on what it sends, replacing a header of the same name. The headers are on the redirects too, and not on the `401` that asks for the password. Every path in the block is a path as the visitor asks for it: under `path: /api`, the admin area is `/api/admin`, with or without `strip_prefix`, and paths outside `/api` are refused.

- **Passwords.** A password is a secret, treated like an `env` value: `${ADMIN_PASSWORD}` is filled in by the CLI from its environment or `--env-file`, else by the agent from the secrets stored with `shipwick secret set`. It is encrypted in the database, shown as `********` wherever the configuration is shown, and Caddy is given a bcrypt hash of it, never the password. Where the paths of two entries overlap, the longer one decides. Basic authentication keeps a staging site or an admin area closed; it is not a login system.
- **Redirects.** `from` is one path, matched exactly; `to` is a path on the same host or an absolute `https://` URL. The query string travels along unless `to` has one. The default status, `308`, keeps the method.
- **Headers.** Values are sent as written: nothing in them is expanded by the proxy. The headers that describe a connection or the framing of a message, `Connection`, `Content-Length`, `Content-Encoding`, `Transfer-Encoding`, `Upgrade` and their relatives, are Caddy's to write and are refused.

There is no pass-through of Caddy directives: every option is a validated field, and the agent renders it as data. bcrypt salts randomly, so the agent keeps each hash for as long as a routed deployment has the account, and the next version of an application with the same password renders the same configuration. The hashes are kept in memory only: after a restart of the agent, Caddy's configuration is loaded once more when an application has passwords.

## Wildcard hostnames

`domain` and `aliases` may be a wildcard: one leading `*` label, quoted in YAML.

```yaml
domain: example.com
aliases: ["*.example.com"]
```

`*.example.com` is every name one label below the domain: `a.example.com`, and neither `example.com` nor `a.b.example.com`. An authority issues a wildcard certificate only through the DNS challenge, so a deployment that names one is refused unless the agent has `SHIPWICK_CLOUDFLARE_API_TOKEN` or [a certificate of your own](#a-certificate-of-your-own) covers it.

`*.example.com` and `api.example.com` are different hostnames and may belong to different applications. A request for `api.example.com` goes to the application that names it exactly, every other name under the domain to the wildcard's: the configuration lists every route's exact hostnames first and all wildcards after them. `redirects` cannot be wildcards, and cannot point at a wildcard `domain`.

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
           domain + aliases, under path → <app>_<port>, or a static 503 while no running replica carries the name
                                          (for a static application: the folder the agent copied into Caddy)
                                          with what the proxy block asks for in front of it
           redirects                    → 308 to https://<domain>, no backend
       + the agent's own route      (SHIPWICK_AGENT_DOMAIN)
       + the dashboard's route      (SHIPWICK_DASHBOARD_DOMAIN)
       + the certificates you supplied, and the DNS challenge when a Cloudflare token is set
```

::: warning Do not edit Caddy's configuration by hand
Manual changes are overwritten the next time the agent loads its configuration. Custom Caddy directives are not supported; the `proxy` block of `deploy.yaml` is the supported way to ask more of the proxy.
:::

### Who syncs routing, and when

Routing, both the names and the Caddy configuration, is synced by:

- a rollout, at every swap of a replica;
- `stop`, `start` and `delete`;
- the supervisor, at the end of every tick, once per second. This is what takes a replica that fails its health check off the name within a second and puts it back once it passes again, and what gives a restarted replica its names once it is ready.

Naming is two calls to Docker, and all of it runs under one lock, because two callers renaming the same replica would collide in the middle. The proxy part is cheap: the rendered configuration is fingerprinted, and an unchanged fingerprint skips the load. The configuration changes when a hostname, a path, a port or the `proxy` block does, when a certificate is supplied or removed, or when a name gains or loses its last running replica. A rollout, a crash or a restart is not that.

### Verification

The fingerprint covers the rendered configuration, not only the routes, so an agent upgrade that renders routes differently reloads Caddy once. It is embedded in the configuration as the `@id` of the final catch-all route. Every 10 seconds the agent asks Caddy for that id and loads the configuration again if it is gone, which is the case when Caddy came back from a restart with an older configuration. The agent also syncs routing once at its own startup.

If Caddy cannot be reached, the agent logs the problem when it appears and when it clears, and retries on every tick. Applications keep running. `GET /api/v1/server` and `shipwick server status` report the proxy's state: `enabled`, `reachable`, the last `error`, and the number of `routes`.

### During a rollout

While a rollout is in progress, the rollout dictates the application's routing. It registers the exact list of replicas that serve at that moment, a mix of two deployments, and updates it at every swap: the new replica in and named, the 1.5 second settle wait, then the predecessor stopped.

This exists for the supervisor's sake. Its tick computes routing from the database, which until the commit still names the old deployment, and would hand the names straight back to replicas the rollout has just retired. At the commit the rollout's list is dropped, because the database now says the same thing. On failure it is dropped too, and routing follows the database back to the previous deployment. Under `recreate`, the list says "nobody" from the moment the old version is stopped until the new one is ready, and the domain answers `503` meanwhile.

The rollout's routing carries the new version's `path` and `proxy` block along with its hostnames. They take effect with the first batch that puts a new replica behind the name, so for the rest of a rolling deployment old replicas may receive requests under the new version's prefix handling. A change of `path` or `strip_prefix` that the old version cannot serve is a case for `deploy.strategy: recreate`.

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

## Compression

Responses are compressed with zstd or gzip when the client asks for it, zstd preferred, for text, JSON, JavaScript, SVG and the other content types that shrink, from a kilobyte up. What the application already compressed, or does not ask to have compressed, leaves as it came: the encoder holds back the first bytes of a response until it knows the type and the size, so a 42 KB page a browser accepts compressed leaves smaller, and an image leaves untouched. Every application route gets it, static folders included, with nothing to configure. The agent's own API and the dashboard are compressed the same way. A followed log goes around the encoder, which would hold the response's header back until the application printed its next line, and a client could not tell an open stream from a request that hangs.

## When nothing can serve

| Situation | What the client gets |
|---|---|
| No running replica carries the application's name | `503 Service Unavailable`, with `Retry-After: 5` and the body `503 Service Unavailable: no healthy replica.` The route is a static `503`. |
| The last replica died and the supervisor has not looked yet | The same `503`. A server-level error route turns the `502` or `503` Caddy would produce when it finds nobody behind the name into the same answer. |
| The application was stopped with `shipwick stop` | The same `503`. The route stays in the configuration, so the domain keeps its certificate. |
| A `recreate` deployment is between stopping the old version and the new one being ready | The same `503`. |
| The hostname is one of the application's `redirects`, whatever the application's state | `308 Permanent Redirect` to `https://<domain>` with the same path and query. No replica is involved. |
| The hostname is shared by path, and no application takes the requested path | `404 Not Found`. An application without a `path` takes the rest of the hostname; without one, the rest is a `404`. |
| No application is served at the requested hostname | Over HTTPS the connection fails before any answer: there is no certificate for a hostname nothing serves. Plain HTTP is redirected to HTTPS first. A request that does get through with an unknown hostname answers `404 Not Found`, with the body `404 Not Found: no application is served at this address.` |

An explicit `503` is generated because Caddy's own answer would be a bare `502`. The application is known; it just has no healthy replica. The domain answers at once instead of timing out.

`stop` follows the same order as a rollout, in reverse: the route goes to the static `503` first, and the containers receive `SIGTERM` second, so no request is cut off mid-flight. Their names go with them. `start` brings the replicas back nameless; they earn the names when they are ready.

## What a deployment costs

A planned change loses no request. A new replica takes the name only once it is healthy; the old one it replaces keeps answering until it is stopped, and taking it off the name is the same thing as stopping it. Caddy's configuration is not touched: nothing is reloaded, and nothing is reset.

Measured on the real stack, with a new connection per request, 12 clients and 50 ms of added latency, through 18 consecutive rolling redeploys: 15,774 of 15,774 requests answered, 0 Caddy loads.

Replacing a replica does not wait for the old one to exit. A deployment is done when every new replica serves; the replaced containers get their `SIGTERM` and their grace period in the background, [`deploy.stop_timeout`](/docs/reference/deploy-yaml#deploy), 10 seconds unless you set it. A container that had to be killed at the end of its grace period is reported in the application's events, with what to do about it: handle `SIGTERM` in the application, or give it longer. See [Deployments](/docs/concepts/deployments).

A reload still happens when a domain, a path, a port or the `proxy` block changes, and a reload is the one thing that costs requests: Caddy resets connections that are being established at that instant, as described under [Why names](#why-names). Established connections are not affected. If a client of yours opens a connection per request and you change one of them under load, give it a retry on connection errors.

## What a crash costs

An unplanned change is not lossless, and cannot quite be:

- Requests in flight on the replica that died are lost with it.
- A crashed replica leaves Docker's DNS at once. Until the supervisor's next tick, within a second, moves the route to the static `503`, a request whose lookup still lists the dead address is retried on another replica, within `try_duration`, the `dial_timeout` and the passive health check, or, if it was the last replica, answered `503`.

Everything after that goes to the surviving replicas.

## DNS first

A hostname is handed to Caddy only once it resolves to this server. Deploying before the DNS record exists is fine: the deployment succeeds, and instead of `Routed https://…` it prints a warning that names the record to create:

```text
! Routing https://api.example.com is waiting for DNS: does not resolve yet; add an A record: api.example.com → 62.238.109.115 (DNS only, not proxied). It is served, and its certificate obtained, once the record points at this server
```

The agent knows the server's addresses, so the message spells the record out: an `A` record with the IPv4 address, and an `AAAA` record as well when the server has an IPv6 address. A record that points at another server is told to change: `resolves to 104.21.5.6, not to this server (62.238.109.115)`. One that points at Cloudflare's proxy is recognised, because the record itself is right and the orange cloud is what breaks the certificate: `resolves to Cloudflare's proxy (104.21.5.6), not to this server: turn the proxy off for this record (DNS only), or set SHIPWICK_CLOUDFLARE_API_TOKEN on the agent to keep it on`. The second way out is described under [Behind Cloudflare](#behind-cloudflare). The agent looks the hostname up again every 10 seconds; as soon as the record is right, the hostname is served, the certificate is obtained, and the application's event feed says `api.example.com now points at this server and is being served`. Aliases and redirects are checked one by one; a domain that is not ready holds back its aliases and redirects with it, since the redirects point at the domain. `shipwick doctor` makes the same checks from your machine, for every domain at once, and adds the ports.

The reason is Let's Encrypt's rate limit of five failed authorizations per hostname per hour. Caddy asks for a certificate the moment it hears of a hostname, and a hostname that does not resolve fails within seconds: deployed before its DNS, a domain would use up the five within minutes and stay without a certificate for the rest of the hour, however quickly the record was fixed.

The agent asks public resolvers (Cloudflare's, Google's and Quad9's) rather than the server's own: a server's resolver remembers that a record did not exist for as long as the zone's negative TTL says, half an hour on Cloudflare, and would keep the hostname waiting that long after the record was created. When none of the public resolvers can be reached, the server's own decides. The agent learns the server's addresses from `SHIPWICK_AGENT_DOMAIN` and `SHIPWICK_DASHBOARD_DOMAIN` at startup. Without either, a hostname only has to resolve at all. The agent's and the dashboard's own hostnames are never held back: they are the operator's, not an application's, and holding them back could lock the operator out.

Three kinds of hostname are decided without looking at where they point:

- **A hostname behind Cloudflare's proxy, when the agent has a Cloudflare token.** It is taken as ready: where Cloudflare sends its traffic cannot be seen from the outside, and the certificate no longer depends on it. A hostname that does not resolve, or resolves to some other server, waits as before.
- **A hostname a supplied certificate covers.** No authority is asked for it, so there is no rate limit to protect, and it does not wait for DNS.
- **A wildcard.** There is no single record to look up. It is served when the agent has the Cloudflare token or a supplied certificate covers it, and a deployment that names one without either is refused.

## Behind Cloudflare

With the orange cloud on, a visitor's connection ends at Cloudflare, and so does the certificate authority's: Caddy cannot prove over HTTP or TLS that it serves the hostname. With a Cloudflare API token in `SHIPWICK_CLOUDFLARE_API_TOKEN`, Caddy proves it through a DNS record instead, the ACME DNS-01 challenge, which needs nothing to reach the server.

- **Every certificate then comes through Cloudflare DNS**, also for hostnames whose record is DNS only. One policy covers everything, because whether a record is proxied changes with a click in someone else's dashboard, and a certificate that depended on the agent noticing would fail at the next renewal. The price: a hostname in a zone the token cannot edit, or at another DNS provider, gets no certificate while the token is set.
- **Proxied records are served instead of held back**, as described under [DNS first](#dns-first).
- **The visitor's address.** Cloudflare's address ranges become trusted proxies of Caddy, so applications find the visitor's address first in `X-Forwarded-For`, followed by Cloudflare's. From any other sender the header is replaced, since anyone can send one. The ranges are the ones Cloudflare publishes, as of 2026-10-03; they are compiled into the agent.
- **SSL/TLS mode: Full (strict).** In *Flexible* mode Cloudflare talks to the server over plain HTTP, which Caddy redirects to HTTPS, which Cloudflare fetches over HTTP again: a redirect loop. *Full* works but accepts any certificate from the server; *Full (strict)* checks the one Caddy obtained.
- **Where the token is.** In `/opt/shipwick/.env`, in the agent's environment, and inside the configuration the agent loads into Caddy, and therefore in Caddy's autosaved copy of it on the `caddy-config` volume. It is never logged and never returned by the API. `GET /server` says only that the DNS challenge is on, as `proxy.dns_challenge`.

Without the token nothing changes: Caddy's own challenges apply, and records must point straight at the server. See [Put Cloudflare in front of the server](/docs/tasks/cloudflare).

## A certificate of your own

For a hostname whose certificate comes from somewhere else, a corporate authority or a wildcard bought for the whole domain, you give the agent the certificate and its key with `shipwick cert set`.

A supplied certificate belongs to the server, not to one application, and it is not a key of `deploy.yaml`: one wildcard certificate serves the hostnames of many applications, and a key does not belong in a file that lives in a repository. Every hostname it covers, its DNS names with a wildcard among them counting for one label, is served with it, whichever application the hostname belongs to. Caddy asks no authority for those hostnames, and they do not wait for DNS.

The agent checks before it stores anything: the chain parses, the key belongs to the first certificate, and that certificate covers the hostname it is stored under and is within its validity. Whether the chain leads to an authority browsers trust is not checked; a private authority's certificate is a use of this. The key is encrypted in the database like a secret, and nothing returns it.

Shipwick does not renew what it did not obtain, and Caddy goes on serving an expired certificate until you replace or remove it. Removing one puts its hostnames back under automatic certificates, and behind the DNS gate, at once. See [Use a certificate of your own](/docs/tasks/certificates).

## Certificate status

Caddy obtains and renews certificates without being asked, and says little while it does. The agent learns what a visitor is going to see the way a browser would: once a minute it connects to Caddy with the hostname as the server name and reads the certificate it is handed, without verifying it. On a development machine the issuer is Caddy's own authority, and is reported as that. A hostname that has no certificate yet is looked at again every 10 seconds.

| Status | Meaning |
|---|---|
| waiting for DNS | The [DNS gate](#dns-first) holds the hostname back; it is not in the proxy yet. |
| being obtained | Caddy serves the hostname and presents no certificate for it yet. HTTPS connections to it fail until it does. |
| expiring | The certificate has 14 days or less to go. Caddy renews a ninety-day certificate thirty days before its end, so a certificate that gets that far is one whose renewal has been failing. |
| in order | Everything else. |

`shipwick status` names every hostname whose certificate is not in order, and why; the application's events record a certificate being obtained and one running out, and a [webhook](/docs/tasks/notifications) is told `certificate.expiring` at 14 days and again at 3. The agent reaches Caddy at `caddy:443`; [`SHIPWICK_PROXY_TLS_ADDR`](/docs/reference/agent-configuration#shipwick-proxy-tls-addr) changes that. See [Use a certificate of your own](/docs/tasks/certificates#certificate-status).

## What the proxy saw

Status codes, durations and request counts exist in one place, the proxy. Caddy writes an access log to its standard output, Docker keeps it, capped at 3 × 10 MB like every container's log, and the agent follows it. There is no new volume, no new port and nothing to rotate; a proxy that restarts is a stream that ended, and the agent resumes at the last line it saw.

- **What a line carries.** The time, hostname, method, path, status, duration, size and client address of a request. Request and response headers are removed before the line is written, and the URL is cut at the question mark, so a token in a query string never reaches the log, let alone the agent.
- **Whose request it is.** A request counts for the application whose domain, alias or redirect it was sent to, and where applications share a hostname by `path`, for the one with the longest path the request is under. Redirects and the `503` of a stopped application count; a static application has traffic like any other. Requests for the agent's and the dashboard's own hostnames are not logged.
- **What is kept.** Counts per application and minute, with the status classes, the bytes and a histogram of durations, for seven days, next to the metrics. A percentile is as exact as its histogram bucket is wide: 48 ms means "between 25 and 50". The requests themselves are the last 200 of each application, in the agent's memory only.
- **What it costs.** Reading the log costs the agent about 27 µs of CPU per request: 3% of one core at 880 requests a second, measured on the development stack, where Caddy itself used 15 times as much for the same requests.

`shipwick traffic` and the dashboard's Traffic panel show it. See [See what the proxy served](/docs/tasks/traffic).

## A hostname and path, one application

A hostname and path belong to one application. Two applications may serve one hostname under different paths; the same path twice, or no path on both, would silently send all traffic to whichever sorts first. A hostname that is redirected, or that is Shipwick's own, is taken whole: a redirect has no paths to share. A deployment that claims what is already in use is refused as a configuration error before anything is recorded, pulled or started. The error names the line of `deploy.yaml` to change:

```text
invalid deploy.yaml

path:
  example.com/api is already served by application "api"; applications share a domain under different paths
```

Two applications that both name the hostname without a path collide on the hostname itself, and so does anything that meets a redirect:

```text
invalid deploy.yaml

aliases[1]:
  already served by application "web"
```

The check covers the domain, aliases, path and redirects of every other application's active deployment, and the hostnames the agent serves itself: an application cannot claim `SHIPWICK_AGENT_DOMAIN` or `SHIPWICK_DASHBOARD_DOMAIN` under any path. Within one file, each hostname may appear once: `"www.example.com" is already listed under aliases[0]`. Through the API this is a `400 INVALID_CONFIG` error whose field is `domain`, `path`, `aliases[0]` or `redirects[1]`. A redeploy and a rollback are checked the same way, since a stored configuration's hostnames may have been taken since.

Domains, aliases and redirects are validated hostnames: lowercase letters, digits and dashes in dot-separated labels, at most 253 characters. No scheme, port or path is accepted in them; a `domain` or an alias may start with one `*` label, a redirect may not. A `path` starts with `/`, does not end with one, and has letters, digits, dots, dashes, underscores and tildes between the slashes, at most 200 characters. See the [deploy.yaml reference](/docs/reference/deploy-yaml#domain).

The names on the services network are as exclusive as the domains: `agent`, `caddy`, `dashboard` and `localhost` belong to Shipwick's own containers there and are refused as application names.

## A folder served by Caddy itself

A static application (`static: dist/` in `deploy.yaml`; see [A folder instead of a container](/docs/concepts/deployments#a-folder-instead-of-a-container)) has no replica and no name on the network. Its route is a Caddy `file_server` whose root is the folder the agent copied into Caddy's own container, `/srv/shipwick/<app>/<digest>`, on the `caddy-static` volume of the compose setup. The folder must hold an `index.html`; a request for a path that names no file is a `404`, unless the application names a fallback page:

```yaml
static:
  dir: dist/
  fallback: index.html
```

Every path that names no file is then answered with that page and status 200, a missing image or script included, which is what the router of a single-page application needs. The file must be in the folder: the CLI looks before it uploads, the agent before it routes.

Aliases, redirects, `path` and the `proxy` block work as above, and so do `stop`, which turns the route into the static `503`, and `start`. Under a `path` the prefix is always removed, since the files are looked up in the folder, and a request for the path itself is sent to it with a trailing slash, so that relative links in the page lead below it. Responses are compressed like any other.

Because the root changes with every new folder, deploying a static application reloads Caddy once, the one kind of change a rollout of containers never causes; a rollback or redeploy re-uses a kept folder and reloads once as well. The agent keeps the folder that serves and the one before it, and removes older ones. An application that stops being a folder, because its next deployment names an image, keeps the last folder for as long as a plain `shipwick rollback` would return to it, which is until its second container version.

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

- Custom Caddy directives. What a route does beyond proxying is what the [`proxy`](/docs/reference/deploy-yaml#proxy) block offers: response headers, basic authentication, path redirects and `strip_prefix`. The proxy does not rewrite responses.
- A wildcard in the middle of a hostname or more than one label deep, a wildcard under `redirects`, and redirects sent to a wildcard `domain`.
- Wildcard hostnames without the DNS challenge or a supplied certificate that covers them.
- DNS providers other than Cloudflare for the DNS challenge. With the token set, every hostname must be in a zone the token can edit.
- Renewal of a certificate you supplied. Shipwick reports when it runs out; replacing it is yours to do.
- Reaching an application's name from outside the server. The names exist on the `shipwick-services` network only. A port that must be reachable from outside is published with `publish`.
