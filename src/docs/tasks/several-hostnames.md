---
title: Serve several hostnames and redirect www
description: Serve an application on more than one hostname with aliases, answer www and an old domain with a 308 to the domain using redirects, what a redirect keeps, how certificates are handled, and why a hostname belongs to one application.
---

# Serve several hostnames and redirect www

An application has one `domain`, and often more than one name: `www.example.com` next to `example.com`, an old domain that still gets traffic, a second hostname that should serve the same thing. This page shows `aliases`, hostnames served exactly like the domain, and `redirects`, hostnames answered with a `308` to the domain; what a redirect keeps, how certificates are obtained, how redirects behave while the application is stopped, and the rule that a hostname belongs to one application, with the error it produces.

## Before you begin

- Both fields need a `domain`. An alias is served like it; a redirect is sent to it.
- Every hostname, alias or redirect, needs its DNS pointed at the server: Caddy obtains a certificate for each one, and a hostname that does not resolve to the server gets no certificate.
- Up to 20 aliases and 20 redirects per application.

## deploy.yaml

```yaml
name: web
image: ghcr.io/company/web:3.2.0
port: 8080
domain: example.com
aliases: [api.example.com]
redirects: [www.example.com, example.net]
health:
  path: /health
```

| Field | |
|---|---|
| `domain` | The hostname the application is served on, and the one redirects are sent to. |
| `aliases` | More hostnames served exactly like `domain`: the same route, the same replicas, their own certificates. `api.example.com` here answers with the same content as `example.com`. |
| `redirects` | Hostnames answered with a `308` to `https://<domain>` with the same path and query. `www.example.com` and the old `example.net` here. |

Hostnames are lowercased and validated like `domain`. `shipwick validate` shows them:

```text
✓ deploy.yaml is valid

Name           web
Image          ghcr.io/company/web:3.2.0
Version        3.2.0
Replicas       1
Port           8080
Domain         example.com
Aliases        api.example.com
Redirects      www.example.com, example.net → https://example.com
Health check   GET /health every 10s (timeout 3s, 3 retries)
Resources      unlimited CPU, unlimited memory
Restart        always
```

## What a redirect answers

```bash
curl -sI https://www.example.com/docs?x=1
```

```text
HTTP/2 308
location: https://example.com/docs?x=1
```

- **Path and query are kept.** The `Location` is `https://<domain>` followed by the request's path and query, unchanged.
- **The method is kept.** `308` rather than `301`: a `POST` to the old hostname stays a `POST` at the new one instead of turning into a `GET`.
- **The target is always HTTPS**, whatever the request came in on. Plain HTTP on port 80 is redirected to HTTPS by Caddy first, for every hostname.
- **A redirect needs no replica.** It is answered by the proxy from a static route, so `https://www.example.com/…` is redirected whether or not the application is running: after `shipwick stop web`, `example.com` and `api.example.com` answer `503`, `www.example.com` still redirects.

## Certificates

Every hostname is a host matcher in the proxy's configuration, and Caddy obtains and renews a certificate for each one, aliases and redirects alike; a redirect hostname must be answered over HTTPS before it can be redirected. Point each hostname's DNS at the server before deploying. Nothing else is needed. See [Routing and HTTPS](/docs/concepts/routing-and-https).

Adding or removing a hostname changes the proxy's configuration and reloads it once, on the deployment that makes the change. A deployment that changes nothing about hostnames does not touch the proxy.

## One hostname, one application

A hostname belongs to one application, in one role. Two routes for one hostname would silently send all of its traffic to whichever sorts first, so both `shipwick validate` and the agent refuse a hostname that is taken, and the error names the line of `deploy.yaml` to change.

Within one file, a hostname listed twice, or as an alias and a redirect, is caught by `shipwick validate`:

```text
invalid deploy.yaml

redirects[0]:
  "api.example.com" is already listed under aliases[0]
  expected: each hostname once
```

Across applications, the agent checks every hostname against the active configuration of every other application, and against its own, before anything is started:

```text
invalid deploy.yaml

aliases[1]:
  already served by application "shop"
```

A hostname the agent or the dashboard is served on (`SHIPWICK_AGENT_DOMAIN`, `SHIPWICK_DASHBOARD_DOMAIN`) reads `already served by Shipwick itself (the agent or the dashboard)`. The same check runs for `redeploy` and `rollback`, since a stored configuration's hostnames may have been taken since.

To move a hostname from one application to another, remove it from the first and deploy that, then add it to the second. The owner is the active deployment's configuration, so the hostname is free the moment the first deployment completes.

`aliases` or `redirects` without a `domain` is refused too:

```text
aliases:
  requires domain: aliases are served like it
  expected: domain: example.com
```

## Moving to a new domain

To move an application from `example.net` to `example.com`, make the new name the domain and the old one a redirect, and deploy:

```yaml
domain: example.com
redirects: [example.net, www.example.net, www.example.com]
```

Every URL under the old domain answers with a `308` to the same URL under the new one, method included, for as long as the redirect stays in the file. Bookmarks, links and search engines follow it; forms keep posting.

## The dashboard

An application's page shows its hostnames as the domain, its aliases, and each redirect as `www.example.com → example.com`. See [Use the dashboard](/docs/tasks/dashboard).

## What's next

- The [`domain`](/docs/reference/deploy-yaml#domain), [`aliases`](/docs/reference/deploy-yaml#aliases) and [`redirects`](/docs/reference/deploy-yaml#redirects) fields in the deploy.yaml reference.
- [Routing and HTTPS](/docs/concepts/routing-and-https): how the proxy is configured and why a hostname has one owner.
- [Reach the API without a hostname](/docs/tasks/access-without-a-hostname), for the agent's and the dashboard's own hostnames.
