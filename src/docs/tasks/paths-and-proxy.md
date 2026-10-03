---
title: Share a hostname by path and configure the proxy
description: Serve several applications on one hostname with path, remove the prefix with strip_prefix, add response headers, protect an application or a path with basic authentication, redirect one path to another, and answer the routes of a single-page application with a fallback page.
---

# Share a hostname by path and configure the proxy

A `domain` gives an application a whole hostname. Often one hostname is what you have: `example.com/api` from one application, the rest of `example.com` from another. This page shows `path`, which limits an application to one part of its domain, and the `proxy` block, which says what the proxy does for an application's requests beyond passing them on: `strip_prefix`, response headers, basic authentication and redirects from one path to another. It ends with the fallback page of a static single-page application, and with what is refused.

## Before you begin

- `path` and `proxy` need a `domain`. `proxy.strip_prefix` needs a `path`.
- Each application that shares a hostname is an application of its own: its own `deploy.yaml`, replicas, health checks, rollouts and rollbacks. Deploying one does not touch the others.
- A basic-auth password is a secret. Write it as `${NAME}` and keep the value in your environment, an `--env-file`, or on the server with `shipwick secret set`.
- Changing `path` or the `proxy` block changes the proxy's configuration and reloads it once, on the deployment that makes the change.

## Several applications on one hostname

Two files, one hostname:

```yaml
# api/deploy.yaml
name: api
image: ghcr.io/company/api:2.4.0
port: 8080
domain: example.com
path: /api
health:
  path: /health
```

```yaml
# web/deploy.yaml
name: web
image: ghcr.io/company/web:3.2.0
port: 3000
domain: example.com
```

`api` serves `example.com/api` and everything under it; `web`, which has no `path`, takes the rest.

| Rule | |
|---|---|
| The longest path wins | With a third application at `/api/admin`, a request for `/api/admin/users` goes there, `/api/users` to `api`, and everything else to `web`. |
| Whole segments | `/api` matches `/api` and `/api/users`, not `/apix`. |
| Case does not count | `/API` and `/api` are one path. |
| The rest is a `404` | Without an application that takes the rest, a path nobody serves answers `404`. |
| Aliases follow | Aliases are served under the same path. `redirects` remain whole hostnames. |

A `path` starts with `/`, does not end with one, and has letters, digits, dots, dashes, underscores and tildes between the slashes, at most 200 characters. `path: /` is the same as no path.

`shipwick validate` shows it:

```text
✓ deploy.yaml is valid

Name           api
Image          ghcr.io/company/api:2.4.0
Version        2.4.0
Replicas       1
Port           8080
Domain         example.com
Path           /api
Health check   GET /health every 10s (timeout 3s, 3 retries)
Resources      unlimited CPU, unlimited memory
Restart        always
```

The deployment ends with `Routed https://example.com/api to 1 replica`, and `shipwick ps`, `status` and `open` show the address with its path.

## What the application sees

The application sees the path as the visitor sent it: a request for `https://example.com/api/users` arrives as `/api/users`. Most frameworks can be told their base path, and that is the setting to use, because the application then writes its own links and redirects with the prefix.

For an application that cannot be told, `strip_prefix` removes the prefix before the request reaches it:

```yaml
name: api
image: ghcr.io/company/api:2.4.0
port: 8080
domain: example.com
path: /api
proxy:
  strip_prefix: true
```

`/api/users` now arrives as `/users`. The proxy does not rewrite responses: the redirects and links the application sends must add the prefix themselves, or they lead to `web`.

`health.path` is not affected either way. The agent asks the replica itself, not the proxy, so it is the path as the application knows it.

::: tip Changing the prefix of a running application
A rolling deployment switches the route with its first new replica, so for the rest of the rollout old replicas may receive requests under the new version's prefix handling. If the old version cannot serve them, deploy that change with `deploy.strategy: recreate`.
:::

## Response headers

```yaml
domain: example.com
proxy:
  headers:
    X-Frame-Options: DENY
    Strict-Transport-Security: max-age=31536000
```

The headers are set on every response the application, or the folder of a static one, gives, and replace a header of the same name the application sent. Values are sent as written; nothing in them is expanded by the proxy.

Up to 50 headers, each value at most 4096 characters. The headers that describe a connection or the framing of a message — `Connection`, `Content-Length`, `Content-Encoding`, `Transfer-Encoding`, `Upgrade` and their relatives — are the proxy's to write and are refused:

```text
invalid deploy.yaml

proxy.headers.Content-Length:
  belongs to the connection, and the proxy writes it itself
  expected: a header about the content, e.g. X-Frame-Options, Cache-Control
```

## A password in front of an application

Basic authentication for everything the application serves:

```yaml
name: staging
image: ghcr.io/company/web:3.3.0-rc1
port: 3000
domain: staging.example.com
proxy:
  basic_auth:
    - username: team
      password: ${STAGING_PASSWORD}
```

Or for one path of it, and everything under that path:

```yaml
domain: example.com
proxy:
  basic_auth:
    - path: /admin
      username: admin
      password: ${ADMIN_PASSWORD}
```

The password is a secret, treated like an `env` value. Store it on the server once:

```bash
shipwick secret set ADMIN_PASSWORD
```

and the agent fills it in at every deployment. Or keep it on your machine: the CLI fills `${ADMIN_PASSWORD}` in from its environment or from `--env-file`.

```bash
shipwick deploy --env-file .env.production
```

- **It is never shown.** The password is encrypted in the database, reads `********` wherever the configuration is shown, and is never returned by the API. The proxy is given a bcrypt hash of it, never the password.
- **At least 8 characters, at most 72 bytes**, which is where bcrypt stops reading. A username has no colon and at most 255 characters.
- **Several users.** Several entries with the same `path` are several users of it. Up to 20 entries.
- **The longer path decides.** Where the paths of two entries overlap, the accounts of the longest decide: with one account for everything and another for `/admin`, `/admin` accepts only the second.
- **Paths are the visitor's.** Under `path: /api`, the admin area is `/api/admin`, with or without `strip_prefix`.

`shipwick validate` names what the block asks for and none of its values:

```text
Proxy          a password for /admin
```

Basic authentication sends the password with every request; it is protected by HTTPS, which every domain has. It keeps a staging site or an admin area closed. It is not a login system.

## Redirect one path to another

```yaml
domain: example.com
proxy:
  redirects:
    - from: /old
      to: /new
    - from: /blog
      to: https://blog.example.org/
      status: 301
```

| Field | Default | |
|---|---|---|
| `from` | — | One path, matched exactly: `/old`, not `/old/page`. |
| `to` | — | A path on the same host, or an absolute `https://` URL. The query string of the request travels along unless `to` has one of its own. |
| `status` | `308` | `301`, `302`, `307` or `308`. `308` and `307` keep the method. |

Up to 100 redirects, each `from` once. A redirect answers before a password is asked for. A redirect to itself, or a circle of them, is refused; with `/a` sent to `/b` and `/b` back to `/a`:

```text
invalid deploy.yaml

proxy.redirects[0].to:
  leads back to /a through the other redirects: a browser would follow them forever
  expected: a path that is not redirected

proxy.redirects[1].to:
  leads back to /b through the other redirects: a browser would follow them forever
  expected: a path that is not redirected
```

To redirect a whole hostname, `www.example.com` or an old domain, use [`redirects`](/docs/tasks/several-hostnames) at the top level instead.

## The order a request meets them

A redirect answers first. Then the proxy asks for a password. Then the application answers, and the headers are set on what it sends. The headers are on the redirects too, and not on the `401` that asks for the password.

All of it in one file:

```yaml
name: api
image: ghcr.io/company/api:2.4.0
port: 8080
domain: example.com
path: /api
proxy:
  strip_prefix: true
  headers:
    X-Frame-Options: DENY
    Strict-Transport-Security: max-age=31536000
  basic_auth:
    - path: /api/admin
      username: admin
      password: ${ADMIN_PASSWORD}
  redirects:
    - from: /api/v1
      to: /api/v2
```

```text
Proxy          strips /api; 2 response headers; a password for /api/admin; 1 redirect
```

## A single-page application

A static application is a folder the proxy serves itself; see [A folder instead of a container](/docs/concepts/deployments#a-folder-instead-of-a-container). A request for a path that names no file is a `404`. A single-page application, whose router reads the path in the browser, names the page that answers those instead:

```yaml
name: web
static:
  dir: dist/
  fallback: index.html
domain: example.com
```

Every path that names no file is then answered with that page and status 200, a missing image or script included. The file must be in the folder: the CLI looks before it uploads, the agent before it routes. `shipwick init` writes the block for a project built by Vite. `shipwick validate` shows it:

```text
Folder         dist/ — served by the proxy, no container
Fallback       index.html for paths that name no file
```

A static application takes `path` and the `proxy` block like any other. Under a `path` its files are always looked up without the prefix, so `strip_prefix` changes nothing for it, and a request for the path itself is sent on to the path with a trailing slash, so that relative links in the page lead below it.

## What is refused

`shipwick validate` and the agent refuse a file whose paths cannot mean what they say:

```text
invalid deploy.yaml

proxy.strip_prefix:
  requires path: it is the prefix that is removed
  expected: path: /api

proxy.basic_auth[0].path:
  "/admin" is outside path /api, which is all this application serves
  expected: /api/admin

proxy.basic_auth[0].password:
  is too short: at least 8 characters
  expected: ${ADMIN_PASSWORD}, with the value in the environment, in --env-file or stored with shipwick secret set
```

The agent also refuses, before anything is started, a path of a hostname that another application's active configuration already serves:

```text
invalid deploy.yaml

path:
  example.com/api is already served by application "api"; applications share a domain under different paths
```

Two applications that both name the hostname without a path are refused the same way, under `domain`, as `already served by application "web"`. A hostname that another application redirects, or that the agent or the dashboard is served on, cannot be shared under any path. The check runs for `redeploy` and `rollback` too.

## The dashboard

An application's address is its domain and path wherever it is shown. Its page shows the `proxy` block: the headers, the redirects, and the accounts by name, never their passwords. A static application's page shows its fallback page. See [Use the dashboard](/docs/tasks/dashboard).

## What's next

- The [`path`](/docs/reference/deploy-yaml#path), [`proxy`](/docs/reference/deploy-yaml#proxy) and [`static`](/docs/reference/deploy-yaml#static) fields in the deploy.yaml reference.
- [Serve several hostnames and redirect www](/docs/tasks/several-hostnames): aliases, wildcards, and redirects of whole hostnames.
- [See what the proxy served](/docs/tasks/traffic): requests are counted for the application whose path they fall under.
- [Routing and HTTPS](/docs/concepts/routing-and-https#paths-on-one-hostname): how routes that share a hostname are ordered, and why the prefix is passed on by default.
