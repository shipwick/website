---
title: Reach the API without a hostname
description: Keep the Shipwick agent's API off the public internet and reach it through an SSH tunnel or a private network.
---

# Reach the API without a hostname

The agent's API does not have to be reachable from the internet. This page shows how to leave it unexposed and use `shipwick` through an SSH tunnel or a private network instead. It is for servers where you have no hostname to spare for the API, or prefer not to publish it.

::: warning Never expose port 9000
The API speaks plain HTTP, and its token is equivalent to root SSH access to the server. Do not publish port 9000 on a public interface and do not open it in your firewall. The ways in are HTTPS through Caddy, an SSH tunnel, or a private network.
:::

## Leave the API hostname empty

When the installer asks for the API hostname, press Enter. `SHIPWICK_AGENT_DOMAIN` stays empty in `/opt/shipwick/.env`, Caddy serves no route to the API, and the agent container publishes no port. The installer says so when it finishes:

```text
  No API hostname was set, so the API is not exposed. Reach it through a tunnel:
    1. create /opt/shipwick/compose.override.yml:
           services:
             agent:
               ports: ["127.0.0.1:9000:9000"]
       and run:   cd /opt/shipwick && docker compose up -d
    2. on your laptop:   ssh -N -L 9000:127.0.0.1:9000 root@<this-server> &   shipwick login
```

To take an existing API hostname away, set `SHIPWICK_AGENT_DOMAIN=` to empty in `/opt/shipwick/.env` and run `docker compose up -d` in `/opt/shipwick`.

Applications and the dashboard are not affected. The dashboard reaches the agent over the internal Docker network, so you can keep the dashboard on a hostname while the API stays private.

## Publish the API on the server's loopback

In the installer's setup the agent runs in a container that publishes no port, on purpose. For a tunnel to have something to connect to, publish the port on the server's loopback address only.

Create `/opt/shipwick/compose.override.yml` with a `ports` entry for the `agent` service. Compose merges this file with `compose.yml`, and an [upgrade](/docs/tasks/upgrade) never replaces it:

```yaml
services:
  agent:
    ports: ["127.0.0.1:9000:9000"]
```

Then:

```bash
cd /opt/shipwick && docker compose up -d
```

The `127.0.0.1:` prefix matters. Without it, Docker publishes the port on every interface of the server.

If the agent runs as a plain binary instead, there is nothing to do: it listens on `127.0.0.1:9000` by default.

## Open an SSH tunnel

On your laptop:

```bash
ssh -N -L 9000:127.0.0.1:9000 user@server &
```

This forwards port 9000 on your laptop to port 9000 on the server's loopback, over SSH. `-N` opens the tunnel without starting a remote shell.

Then log in. The default URL of `shipwick` is `http://127.0.0.1:9000`, which is the tunnel:

```bash
shipwick login
```

```text
Agent URL [http://127.0.0.1:9000]:
API token:
```

Press Enter to accept the URL, and paste the token. From then on every `shipwick` command works as long as the tunnel is open. Without the tunnel, `shipwick` reports that it cannot reach the agent and reminds you of the `ssh -L` command.

`shipwick` does not warn about plain HTTP here: the token only travels to your own machine's loopback address, and SSH encrypts it from there.

## Use a private network

If the server and your laptop or CI runner share a private network — WireGuard, Tailscale or similar — you can reach the API over it. Publish the agent's port on the server's private address instead of loopback, in the same `compose.override.yml`:

```yaml
services:
  agent:
    ports: ["<private address>:9000:9000"]
```

Then point `shipwick` at it:

```bash
shipwick login --url http://<private address>:9000
```

`shipwick` warns whenever a token is about to travel over plain HTTP to anything other than the local machine, and it will do so here. It cannot know that the network underneath is encrypted. Make sure that it is, and that the address is not reachable from outside the private network.

## CI

A pipeline needs to reach the API as well. A runner inside your private network can use the private address. For hosted runners, serving the API over HTTPS with `SHIPWICK_AGENT_DOMAIN` is the usual choice; see [Deploy from CI](/docs/tasks/deploy-from-ci).

## What's next

- [Security](/docs/security) explains why the API is closed by default.
- [Agent configuration](/docs/reference/agent-configuration) lists `SHIPWICK_LISTEN_ADDR` and the other variables.
