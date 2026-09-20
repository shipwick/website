---
title: Agent configuration
description: Every environment variable of the Shipwick agent with its default and meaning, the data directory, how the API token is resolved, the agent's subcommands, and the variables of the production compose file.
---

# Agent configuration

The agent is configured through `SHIPWICK_*` environment variables only. It has no configuration file and no flags. This page lists every variable, describes the data directory and the token resolution order, the agent's subcommands, and the variables that the production compose file adds.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| [`SHIPWICK_AGENT_TOKEN`](#api-token) | generated | The API bearer token. At least 16 characters. |
| `SHIPWICK_LISTEN_ADDR` | `127.0.0.1:9000` | Address the API listens on. Loopback by default, on purpose. The agent image sets it to `0.0.0.0:9000`. |
| [`SHIPWICK_DATA_DIR`](#data-directory) | `/var/lib/shipwick` on Linux | Directory for the SQLite database and the token hash. |
| `SHIPWICK_DOCKER_NETWORK` | `shipwick` | Docker bridge network that application containers join. Created if it does not exist. |
| [`SHIPWICK_CADDY_ADMIN`](#shipwick-caddy-admin) | none | Caddy's admin endpoint. Unset: domains are recorded but not served. |
| `SHIPWICK_AGENT_DOMAIN` | none | Serve the agent's API over HTTPS at this hostname, through Caddy. Requires `SHIPWICK_CADDY_ADMIN`. |
| `SHIPWICK_DASHBOARD_DOMAIN` | none | Serve the dashboard over HTTPS at this hostname, through Caddy. Requires `SHIPWICK_CADDY_ADMIN`. Must differ from `SHIPWICK_AGENT_DOMAIN`. |
| `SHIPWICK_DASHBOARD_UPSTREAM` | `dashboard:3000` | Where Caddy reaches the dashboard, as `host:port`. The host is a hostname or an IP address; the port is 1 to 65535. Validated only when `SHIPWICK_DASHBOARD_DOMAIN` is set. |
| `SHIPWICK_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `SHIPWICK_LOG_FORMAT` | `text` | `text` or `json`. Logs go to standard error. |
| `DOCKER_HOST`, `DOCKER_CONFIG` | Docker defaults | The standard Docker variables are honored. `DOCKER_CONFIG` is the directory that holds `config.json`, which the agent reads for registry credentials. |

The agent refuses to start with an invalid value: an unknown log level or format, a token shorter than 16 characters, a domain that is not a valid hostname, a domain without `SHIPWICK_CADDY_ADMIN`, identical agent and dashboard hostnames, or a malformed dashboard upstream.

Both hostnames are trimmed, converted to lowercase and validated by the same rule as `domain` in `deploy.yaml`. Applications cannot claim either of them.

### SHIPWICK_LISTEN_ADDR

The API speaks plain HTTP. The default binds it to loopback so that exposing it is an explicit choice. The agent image sets `SHIPWICK_LISTEN_ADDR=0.0.0.0:9000`, so that Caddy and the dashboard can reach the API over the container network. The production compose file publishes no host port for it: the only ways in are Caddy, over HTTPS, and the server itself.

::: warning
Never expose port 9000 directly to the internet. Serve the API through Caddy with `SHIPWICK_AGENT_DOMAIN`, or reach it over an SSH tunnel or a private network. See [Security](/docs/security).
:::

### SHIPWICK_CADDY_ADMIN

Two forms are accepted:

| Form | Example | |
|---|---|---|
| Unix socket | `unix//run/caddy/admin.sock` | Recommended. Only processes that share the socket can reconfigure the proxy. The path must be absolute. |
| TCP | `http://127.0.0.1:2019` | For a Caddy installed on the host next to an agent running as a plain binary. `http://host:port` without a path. |

The agent echoes this address into the configuration it loads, so that Caddy's admin endpoint stays where it is.

When the variable is unset, routing is disabled: the agent warns at startup, domains are recorded but nothing serves them, and `shipwick server status` reports the proxy as not configured. See [Routing and HTTPS](/docs/concepts/routing-and-https).

### SHIPWICK_AGENT_DOMAIN and SHIPWICK_DASHBOARD_DOMAIN

With `SHIPWICK_AGENT_DOMAIN` set, the agent adds a route for its own API. When the agent runs in a container on the application network, Caddy reaches it at the container's hostname and the port of `SHIPWICK_LISTEN_ADDR`. As a host process, Caddy is assumed to be a host process too, and reaches the agent at the listen address (`127.0.0.1` if the address is unspecified).

With `SHIPWICK_DASHBOARD_DOMAIN` set, the agent adds a route to `SHIPWICK_DASHBOARD_UPSTREAM`.

Both routes have response buffering disabled, so that followed logs arrive line by line.

## Data directory

`SHIPWICK_DATA_DIR` defaults to:

| Platform | Default |
|---|---|
| Linux | `/var/lib/shipwick` |
| Other | `<user config dir>/shipwick`, or `shipwick-data` in the working directory if the user config directory cannot be determined |

The agent image sets `SHIPWICK_DATA_DIR=/var/lib/shipwick` and declares it a volume. The production compose file mounts the `agent-data` volume there.

The directory is created with mode `0700` if it does not exist. It contains:

| File | Content |
|---|---|
| `shipwick.db` | The SQLite database: applications, deployments with their full configuration, replicas, events. It runs in WAL mode, so SQLite keeps its `-wal` and `-shm` files next to it. |
| `agent-token.sha256` | The hex-encoded SHA-256 hash of a token the agent generated itself. Mode `0600`. Present only if the agent ever generated its token. |

::: warning Protect this directory
Environment values of every deployment are stored unencrypted in `shipwick.db`. Anyone who can read the data directory can read every application's secrets.
:::

The database schema is migrated automatically at startup. An agent refuses to open a database whose schema is newer than it supports, and asks to be upgraded.

## API token

The agent authenticates every API request, except `GET /api/v1/health`, against the SHA-256 hash of one token. The hash is determined at startup, in this order:

1. **`SHIPWICK_AGENT_TOKEN`**, when set, always wins. Its hash is kept in memory. Nothing is written to disk.
2. Otherwise, **the hash persisted in the data directory** by a previous run (`agent-token.sha256`).
3. Otherwise, **a token is generated**: `shw_` followed by 64 hexadecimal characters, from 32 random bytes. Only its hash is persisted. The token itself is printed once to standard output.

The agent only ever keeps the hash, in memory and on disk. A generated token cannot be recovered afterwards. If the hash file is corrupt, the agent refuses to start and says so: delete the file to generate a new token, or set `SHIPWICK_AGENT_TOKEN`.

A generated token is printed directly to standard output, never through the logger, so it does not end up in log aggregation by way of the log stream. Under Docker, however, "printed" means it is in the container's log (`docker logs`) for as long as that container exists. The installer avoids this by generating the token itself and passing it in as `SHIPWICK_AGENT_TOKEN`. Do the same when setting things up by hand, for example with `openssl rand -hex 32`.

To change the token, set a new `SHIPWICK_AGENT_TOKEN` and restart the agent. Running applications are not affected by an agent restart.

## Subcommands

```text
shipwick-agent [healthcheck|version]
```

| Invocation | |
|---|---|
| `shipwick-agent` | Run the agent. |
| `shipwick-agent version` | Print the version and exit. |
| `shipwick-agent healthcheck` | Probe the agent configured by the same environment: `GET /api/v1/health` on the port of `SHIPWICK_LISTEN_ADDR`, on `127.0.0.1` if the listen host is unspecified, with a 3 second timeout. Exits `0` on HTTP 200 and `1` otherwise. |

`healthcheck` exists for container health checks: the agent image ships no shell, `curl` or `wget`. The image declares it as its `HEALTHCHECK`, with an interval of 10 seconds, a timeout of 5 seconds, a start period of 5 seconds and 3 retries.

Any other arguments are an error. The agent has no flags.

## Startup and shutdown

At startup the agent opens the database, connects to Docker, ensures the application network exists and joins it if the agent runs in a container, reconciles interrupted deployments and leftover containers, syncs the proxy, starts the supervisor, and then serves the API. Startup work is bounded by 30 seconds. If Docker is unreachable, the agent exits with an error. If Caddy is unreachable, it logs the error and keeps retrying in the background.

On `SIGINT` or `SIGTERM` the agent shuts down gracefully within 30 seconds. A second signal kills it immediately. See [Architecture](/docs/concepts/overview#agent-restarts-and-crashes).

## The production compose file

[`configs/compose.production.yml`](https://github.com/shipwick/shipwick/blob/main/configs/compose.production.yml) runs the agent, Caddy and the dashboard as one Compose project named `shipwick`. The installer writes it to `/opt/shipwick/compose.yml`. It reads these variables from a `.env` file next to it:

| Variable | Default | |
|---|---|---|
| `SHIPWICK_AGENT_TOKEN` | required | Passed to the agent. Compose refuses to start without it. |
| `SHIPWICK_AGENT_DOMAIN` | empty | Passed to the agent. Leave empty to not expose the API through Caddy. |
| `SHIPWICK_DASHBOARD_DOMAIN` | empty | Passed to the agent. Leave empty to not expose the dashboard. |
| `SHIPWICK_HTTP_PORT` | `80` | Host port published for Caddy's port 80. |
| `SHIPWICK_HTTPS_PORT` | `443` | Host port published for Caddy's port 443, TCP and UDP. |
| `SHIPWICK_AGENT_IMAGE` | `ghcr.io/shipwick/agent:latest` | Agent image. |
| `SHIPWICK_DASHBOARD_IMAGE` | `ghcr.io/shipwick/dashboard:latest` | Dashboard image. |

The image defaults above are those of the file in the repository. In the copy that belongs to a release, which is what the installer fetches, both images are pinned to that release's version.

Override the ports only if something else owns 80 and 443. Automatic HTTPS needs the real ones to be reachable from the internet.

The file fixes the rest of the agent's configuration:

| Setting | Value |
|---|---|
| `SHIPWICK_CADDY_ADMIN` | `unix//run/caddy/admin.sock`, a socket in the `caddy-admin` volume that only the agent and Caddy mount |
| `SHIPWICK_LOG_FORMAT` | `json` |
| Dashboard's `SHIPWICK_AGENT_URL` | `http://agent:9000` |
| Agent port | Not published. The only ways in are Caddy and the server itself. |
| Caddy | `caddy:2-alpine`, started with a bootstrap configuration that contains only the admin socket. The agent loads the real configuration. |
| Network | One network named `shipwick`, shared by all three services and by application containers |
| Restart policy | `unless-stopped` for all three services |

Volumes:

| Volume | Mounted in | Content |
|---|---|---|
| `agent-data` | agent, at `/var/lib/shipwick` | The data directory |
| `caddy-data` | Caddy, at `/data` | Certificates. Back this volume up, and do not delete it casually. |
| `caddy-config` | Caddy, at `/config` | Caddy's own configuration directory. Caddy is started with `--resume`. |
| `caddy-admin` | agent and Caddy, at `/run/caddy` | The admin socket |

The agent also mounts `/var/run/docker.sock`, which is root-equivalent access to the server.

The installer replaces `/opt/shipwick/compose.yml` on every upgrade. Your own changes belong in `/opt/shipwick/compose.override.yml`, which Compose merges with it and the installer never touches. The two most common ones:

- **Private images.** Mount the server's `docker login` credentials into the agent: `/root/.docker/config.json:/root/.docker/config.json:ro`. See [Pull from private registries](/docs/tasks/private-registries).
- **No hostname for the API.** Leave `SHIPWICK_AGENT_DOMAIN` empty and publish the API on the server's loopback only, with `ports: ["127.0.0.1:9000:9000"]` on the agent, then reach it through an SSH tunnel. See [Reach the API without a hostname](/docs/tasks/access-without-a-hostname).

## Running the agent as a plain binary

The agent also runs as a plain binary on Linux, next to a Caddy installed on the host:

```bash
SHIPWICK_AGENT_TOKEN=… SHIPWICK_CADDY_ADMIN=http://127.0.0.1:2019 shipwick-agent
```

As a host process on Linux the agent reaches container addresses directly. With Docker Desktop on macOS or Windows it cannot, and warns at startup: applications with a `health` block cannot be deployed by a host-process agent there.
