---
title: Expose a service that is not HTTP
description: Publish a container port on the server itself with publish, for a database reached from a laptop, a game server or anything over UDP, which ports are refused, and why the host firewall does not protect a published port.
---

# Expose a service that is not HTTP

The proxy speaks HTTP: a `domain` gets a certificate and a route, and nothing else reaches an application from outside the server. A PostgreSQL that a laptop connects to, a game server, a service over UDP need a port on the server itself, and that is what `publish` gives them. This page shows the configuration, what a published port needs from the rest of `deploy.yaml`, which ports are refused, why the host firewall does not protect a published port, and how other applications keep reaching the service by name.

## Before you begin

- A published port needs `deploy.strategy: recreate` and `replicas: 1`. A server port has one holder: not two replicas, and not the old and the new version side by side during a rolling deployment. Every deployment of the application is therefore a short outage, as for any [stateful application](/docs/tasks/stateful-applications).
- Publish only what must be reachable from outside the server. Other applications on the server reach the service by its name without any published port, and a published port is reachable from the internet whatever the host firewall says (see [The firewall](#the-firewall)).
- Ports `80` and `443` belong to the proxy and are refused, as are the ports the agent and the proxy listen on.

## deploy.yaml

PostgreSQL, published on port `15432` of the server's private address:

```yaml
name: postgres
image: postgres:17
replicas: 1
env:
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
volumes:
  - name: data
    path: /var/lib/postgresql/data
publish:
  - port: 5432
    host: 15432
    address: 10.0.0.5
    protocol: tcp
health:
  tcp: 5432
deploy:
  strategy: recreate
```

| Field | Default | |
|---|---|---|
| `publish[].port` | — | The port the process listens on inside the container. |
| `publish[].host` | the same as `port` | The port on the server. `1`–`65535`, not `80` or `443`. |
| `publish[].address` | every address of the server | One IP address of the server to bind to. Where the server has a private or VPN interface, bind there. |
| `publish[].protocol` | `tcp` | `tcp` or `udp`. |

Up to 20 entries per application; the same server port can be listed once per protocol and address. `port` at the top level is not needed: it names the application for the proxy and for other applications, and a service that is not HTTP has no use for the proxy. `health.tcp: 5432` gives the deployment something to verify, since there is no HTTP endpoint to ask; see [Health checks](/docs/concepts/health-and-supervision).

```bash
shipwick validate --env-file .env.production
```

```text
✓ deploy.yaml is valid (1 variable substituted)

Name           postgres
Image          postgres:17
Version        17
Replicas       1
Health check   TCP :5432 every 10s (timeout 3s, 3 retries)
Resources      unlimited CPU, unlimited memory
Volume         data at /var/lib/postgresql/data
Publish        5432/tcp → server port 15432 on 10.0.0.5
Restart        always
Strategy       recreate
Environment    1 variables
```

Without `address`, the line reads `5432/tcp → server port 15432` and the port is bound on every address of the server. The dashboard shows the same line on the application's page. Instead of an `--env-file`, the password can be stored on the server once with `shipwick secret set POSTGRES_PASSWORD`; the agent then fills it in, and both commands run without the flag.

Deploy, and connect from a machine that reaches `10.0.0.5`:

```bash
shipwick deploy --env-file .env.production
psql -h 10.0.0.5 -p 15432 -U postgres
```

The port comes and goes with the replica: it is bound when the container starts and released when it stops. During a `recreate` deployment, between `Stopped 17: 17.1 cannot run next to it` and `Replica 1 passed health checks`, nothing listens on it, and clients see connection refused until the new version is up.

## What is refused

`shipwick validate` and the agent refuse a configuration that cannot hold a server port:

```text
invalid deploy.yaml

deploy.strategy:
  must be "recreate" for an application that publishes ports: two versions cannot listen on the same server port
  expected: deploy:
    strategy: recreate

replicas:
  must be 1 for an application that publishes ports, got 2: replicas cannot share a server port
  expected: 1

publish[0].host:
  invalid value 443: the proxy listens there
  expected: another server port, e.g. 15432
```

The agent also refuses, before anything is started, a server port that something else already holds: the ports the agent and the proxy listen on, and any port another application's active configuration publishes on the same protocol and an overlapping address (an entry without `address` overlaps every address). The error names the line of `deploy.yaml` to change:

```text
invalid deploy.yaml

publish[0].host:
  already published by application "postgres"
```

For a port of Shipwick's own the owner reads `Shipwick itself (the agent or the proxy)`. Besides `80` and `443`, the agent reserves `8080`, `8443` and the port it listens on itself, `9000` unless `SHIPWICK_LISTEN_ADDR` says otherwise. The check runs for `redeploy` and `rollback` too, since a stored configuration's port may have been taken since.

Docker would refuse the second bind as well, but only when the container starts. For a `recreate` deployment that is after the old version has been stopped, so a mistake that is visible up front would otherwise cost an outage and a rollback.

## The firewall

::: warning Published ports bypass the host firewall
On most distributions Docker inserts its own iptables rules ahead of ufw's or firewalld's. A port published on every address is reachable from the internet whatever the firewall says. Publish only what must be reachable from outside the server, bind it to a private address where one exists (`address: 10.0.0.5`, a VPN or private-network interface), and keep what only other applications need unpublished: they reach it by name.
:::

A database that only the applications on the server use needs no `publish` at all. `postgres:5432` is enough for them, and the cloud provider's firewall is the only one that stands in front of a published port.

## A game server over UDP

```yaml
name: game
image: ghcr.io/company/game-server:2.1.0
replicas: 1
publish:
  - port: 27015
    protocol: udp
  - port: 27015
    protocol: tcp
deploy:
  strategy: recreate
```

Without `host` the server port is the container's. The same number is published once per protocol, which is one entry each. A server without an HTTP endpoint gets no `health` block and is verified by staying up through the stabilization window, or add `health.tcp` where it listens on TCP.

## Other applications still reach it by name

Publishing changes nothing about the networks the container is on. Other applications on the server reach the service at `<name>:<port>`, `postgres:5432` here, the container port and not the published one, and they do so whether or not anything is published:

```yaml
# api/deploy.yaml
env:
  DATABASE_URL: postgres://app:${DATABASE_PASSWORD}@postgres:5432/app
```

The name resolves while the replica is ready; during a `recreate` deployment nobody carries it. See [Call one application from another](/docs/tasks/call-another-application).

## What's next

- The [`publish`](/docs/reference/deploy-yaml#publish) field in the deploy.yaml reference.
- [Run a database or other stateful application](/docs/tasks/stateful-applications) and [Back up and restore volumes](/docs/tasks/backups).
- [Security](/docs/security): what the server exposes, and what it should not.
