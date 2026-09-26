---
title: Call one application from another
description: Reach an application on the same server at http://<name>:<port>, without a domain or a trip through the proxy, and what the name resolves to while replicas come and go.
---

# Call one application from another

Every application with a `port` is reachable by the other applications on the server at `http://<name>:<port>`, where `name` and `port` are the ones in its `deploy.yaml`. This page shows how to point one application at another, and what the name resolves to during deployments and failures.

## Before you begin

- Both applications run on the same Shipwick server. The names exist on the server's `shipwick-services` network only; nothing outside the server can reach them.
- The application being called has a `port`. An application without one gets no name.

## Example: orders calls payments

`payments` is an internal service. It has a port and a health check, and no domain, because nothing outside the server calls it:

```yaml
# payments/deploy.yaml
name: payments
image: ghcr.io/company/payments:2.3.0
port: 8080
replicas: 2
health:
  path: /health
```

`orders` is told where to find it. The hostname is the application's name, the port is the one in its file:

```yaml
# orders/deploy.yaml
name: orders
image: ghcr.io/company/orders:1.8.0
port: 8080
domain: orders.example.com
env:
  PAYMENTS_URL: http://payments:8080
health:
  path: /health
```

Deploy both, the dependency first:

```bash
shipwick deploy -f payments/deploy.yaml -f orders/deploy.yaml
```

Several files deploy in the order given and stop at the first failure, so `orders` is not deployed if `payments` fails. See [Deploy several applications](/docs/reference/cli#several-applications).

`orders` now connects to `http://payments:8080` and gets a healthy replica of whatever version of `payments` is current. Plain HTTP, no domain, no certificate, no trip through the proxy. A database run by Shipwick is reached the same way, `postgres:5432`; see [Run a database or other stateful application](/docs/tasks/stateful-applications).

## What the name resolves to

A replica carries its application's name exactly while it is ready for traffic: it takes the name once it passed its health check (or, without one, once it stayed up through the stabilization window), and loses it the moment it stops. Docker's DNS returns one address per replica that carries the name.

- **Only ready replicas answer.** A replica that fails its health check is taken off the name within a second and put back once it passes again. One that crashes disappears from the name at once.
- **A replica is on the network from its first second.** It can reach `payments` while its own health check is still pending, which matters when passing that check requires a peer. It is findable by others only once it is ready itself.
- **During a rolling deployment, both versions answer.** A new replica takes the name when it is ready; the one it replaces keeps answering until it is stopped. The two versions of `payments` must be able to serve `orders` side by side for that moment.
- **During a `recreate` deployment, nobody answers.** The name is carried by no replica from the moment the old version is stopped until the new one is ready, and a lookup fails. Give the caller a retry, or a connection pool that reconnects.
- **What the proxy resolves is the same mechanism.** Caddy is told `payments_8080`, the name with the port, and asks Docker's DNS for it on every request. Your applications use the plain name. See [Routing and HTTPS](/docs/concepts/routing-and-https).

Requests in flight on a replica that dies are lost with it, as they would be with any server. Everything after goes to the surviving replicas.

## Reserved names

`agent`, `caddy`, `dashboard` and `localhost` are refused as application names: they belong to Shipwick's own containers on the network the applications share. Validation says so:

```text
name:
  "caddy" is reserved for Shipwick's own services
  expected: another name, e.g. my-caddy
```

## What's next

- [Run a database or other stateful application](/docs/tasks/stateful-applications) and reach it at `postgres:5432`.
- [Routing and HTTPS](/docs/concepts/routing-and-https) explains the two networks and how the names are given and taken.
- The [deploy.yaml reference](/docs/reference/deploy-yaml#name) for the rules on names.
