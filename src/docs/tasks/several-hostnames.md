---
title: Serve several hostnames and redirect www
description: Serve an application on more than one hostname with aliases, serve every name under a domain with a wildcard, answer www and an old domain with a 308 to the domain using redirects, what a redirect keeps, how certificates are handled, and which hostnames two applications can and cannot share.
---

# Serve several hostnames and redirect www

An application has one `domain`, and often more than one name: `www.example.com` next to `example.com`, an old domain that still gets traffic, a second hostname that should serve the same thing. This page shows `aliases`, hostnames served exactly like the domain, wildcards among them, and `redirects`, hostnames answered with a `308` to the domain; what a redirect keeps, how certificates are obtained, how redirects behave while the application is stopped, and the rule that a hostname is taken once, or once per path, with the error it produces.

## Before you begin

- Both fields need a `domain`. An alias is served like it; a redirect is sent to it.
- Every hostname, alias or redirect, needs its DNS pointed at the server: Caddy obtains a certificate for each one, and a hostname that does not resolve to the server gets no certificate. A deployment whose hostname is not ready says which record to create; see [DNS first](/docs/concepts/routing-and-https#dns-first). With [Cloudflare in front of the server](/docs/tasks/cloudflare), a proxied record is served as well.
- A wildcard needs the Cloudflare token on the agent, or a certificate of your own that covers it; see [Every name under a domain](#every-name-under-a-domain).
- Up to 20 aliases and 20 redirects per application.
- A static application, a folder served by the proxy, takes `aliases` and `redirects` like any other.

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
| `redirects` | Hostnames answered with a `308` to `https://<domain>` with the same path and query. `www.example.com` and the old `example.net` here. For an application with a [`path`](/docs/tasks/paths-and-proxy), to `https://<domain><path>`: below the part of the domain the application serves. |

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

`shipwick status` names every hostname whose certificate is still being obtained, waits for DNS or is about to run out; see [certificate status](/docs/tasks/certificates#certificate-status). A hostname covered by a certificate you supplied with `shipwick cert set` is served with that one instead, and does not wait for DNS.

## Every name under a domain

`domain` and `aliases` may be a wildcard: one leading `*` label, quoted in YAML.

```yaml
name: web
image: ghcr.io/company/web:3.2.0
port: 8080
domain: example.com
aliases: ["*.example.com"]
```

`*.example.com` is every name one label below the domain: `a.example.com`, and neither `example.com` nor `a.b.example.com`. A certificate authority issues a wildcard certificate only through a DNS record, so one of two things must be in place before you deploy:

- the agent has `SHIPWICK_CLOUDFLARE_API_TOKEN`, see [Put Cloudflare in front of the server](/docs/tasks/cloudflare); or
- a certificate of your own covers the wildcard, see [Use a certificate of your own](/docs/tasks/certificates).

Without either, the deployment is refused before anything is started:

```text
invalid deploy.yaml

aliases[0]:
  a certificate for a wildcard is issued only through a DNS record, and the agent is not set up for that
  expected: SHIPWICK_CLOUDFLARE_API_TOKEN on the agent, or a certificate of your own: shipwick cert set '*.example.com' --cert fullchain.pem --key privkey.pem
```

`*.example.com` and `api.example.com` are different hostnames and may belong to different applications. A request for `api.example.com` goes to the application that names it exactly, every other name under the domain to the wildcard's. `redirects` cannot be wildcards, and cannot be sent to a wildcard `domain`: put the wildcard under `aliases` and keep a plain hostname as the domain.

`shipwick open` has no address to open for an application whose `domain` is a wildcard, and `shipwick doctor` says for a wildcard that it has no single record or address to check.

## A hostname is taken once, or once per path

A hostname that is redirected belongs to one application. One that is served, as a domain or an alias, belongs to one application too, unless the applications that share it each serve a `path` of their own; see [Share a hostname by path and configure the proxy](/docs/tasks/paths-and-proxy). Two routes for the same hostname and path would silently send all of its traffic to whichever sorts first, so both `shipwick validate` and the agent refuse what is taken, and the error names the line of `deploy.yaml` to change.

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

That is the answer when neither application has a `path`, or when the hostname is one of the other application's redirects. When both name the same path, the error says so and names the way out:

```text
invalid deploy.yaml

path:
  example.com/api is already served by application "api"; applications share a domain under different paths
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

An application's page shows its hostnames as the domain, its aliases, and each redirect as `www.example.com → example.com`. A hostname whose certificate waits for DNS, is being obtained or is about to expire carries a badge and the agent's sentence. See [Use the dashboard](/docs/tasks/dashboard).

## What's next

- The [`domain`](/docs/reference/deploy-yaml#domain), [`aliases`](/docs/reference/deploy-yaml#aliases) and [`redirects`](/docs/reference/deploy-yaml#redirects) fields in the deploy.yaml reference.
- [Share a hostname by path and configure the proxy](/docs/tasks/paths-and-proxy): several applications under one hostname, response headers, passwords and path redirects.
- [Put Cloudflare in front of the server](/docs/tasks/cloudflare) and [Use a certificate of your own](/docs/tasks/certificates): the two ways to a wildcard certificate.
- [Routing and HTTPS](/docs/concepts/routing-and-https): how the proxy is configured and why a hostname and path have one owner.
- [Reach the API without a hostname](/docs/tasks/access-without-a-hostname), for the agent's and the dashboard's own hostnames.
