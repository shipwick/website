---
title: Install Shipwick on a server
description: Set up the Shipwick agent, Caddy and the dashboard on a Linux server with the installer, or by hand.
---

# Install Shipwick on a server

This page is for whoever administers the server. It covers the installer, what it puts on the machine, the API token, DNS and firewall, and the ways to install without it.

## Before you begin

You need:

- A Linux server, and root on it.
- Docker, installed and running, with the Compose plugin. The installer does not install Docker; that decision belongs to the server's owner. If Docker is missing, the installer stops and points you to `curl -fsSL https://get.docker.com | sh`.
- `curl` or `wget`.
- Ports 80 and 443 free on the server and reachable from the internet. Automatic HTTPS depends on them.
- Optionally, two DNS names that point at the server: one for the API, one for the dashboard. Every application you give a `domain` later needs a DNS record too.

## Run the installer

On the server, as root:

```bash
curl -fsSL https://get.shipwick.com | sh
```

The installer asks two questions. Both are optional; press Enter to skip either.

| Question | Stored as | Effect |
|---|---|---|
| Hostname for the API, used by the shipwick CLI | `SHIPWICK_AGENT_DOMAIN` | The agent's API is served over HTTPS at this hostname, through Caddy |
| Hostname for the dashboard | `SHIPWICK_DASHBOARD_DOMAIN` | The dashboard is served over HTTPS at this hostname, through Caddy |

Give bare hostnames such as `agent.example.com`: no `https://`, no port, no path. The two must be different. Hostnames are validated before anything is written.

Without a terminal, the installer asks nothing and takes the hostnames from the environment:

```bash
curl -fsSL https://get.shipwick.com | SHIPWICK_AGENT_DOMAIN=agent.example.com SHIPWICK_DASHBOARD_DOMAIN=dashboard.example.com sh
```

The output looks like this:

```text
Shipwick installer (shipwick/shipwick@latest)

✓ Docker 29.8.0 with Compose 5.5.1
✓ Installed /opt/shipwick/compose.yml
✓ Wrote /opt/shipwick/.env
✓ Started the Shipwick services
✓ The agent is healthy
✓ Installed the shipwick CLI to /usr/local/bin/shipwick

Shipwick is running.

  API token (also in /opt/shipwick/.env — it is root on this server, treat it so):

      <64 hexadecimal characters>

  From your laptop or CI:   shipwick login --url https://agent.example.com
  Dashboard:                https://dashboard.example.com
  Open ports 80 and 443 (and 443/udp) — and nothing else — in your firewall.
  Upgrade later by running this installer again.
```

## What the installer does

1. Checks for Linux, root, a running Docker and the Compose plugin.
2. Writes `/opt/shipwick/compose.yml`. This is the release's `compose.production.yml`, in which both Shipwick images are pinned to the release's version. The file is verified against the release's `checksums.txt` before it replaces anything.
3. On the first run only, writes `/opt/shipwick/.env` with a freshly generated API token and the two hostnames. The file has mode `0600` and the directory `0700`.
4. Pulls the images, starts the services, and waits for the agent to report healthy.
5. Installs `shipwick` to `/usr/local/bin`, verified the same way. A checksum mismatch installs nothing and leaves a running installation as it was.
6. Prints the token and the next steps.

Three containers run afterwards, defined in `/opt/shipwick/compose.yml`:

| Service | What it is |
|---|---|
| `agent` | The Shipwick agent. It has the Docker socket mounted and publishes no port: the only ways in are Caddy and the server itself. |
| `caddy` | The reverse proxy. It publishes ports 80 and 443 (TCP) and 443 (UDP), and obtains and renews certificates on its own. |
| `dashboard` | The web dashboard. It is reached only through Caddy, at the dashboard hostname, and has no credentials of its own. |

State lives in Docker volumes: the agent's SQLite database in `agent-data`, certificates in `caddy-data`. Back up `caddy-data` and do not delete it casually.

The installer accepts these environment variables:

| Variable | Default | |
|---|---|---|
| `SHIPWICK_VERSION` | `latest` | Release to install |
| `SHIPWICK_AGENT_DOMAIN` | — | Hostname for the API; asked for when run in a terminal |
| `SHIPWICK_DASHBOARD_DOMAIN` | — | Hostname for the dashboard; likewise |
| `SHIPWICK_INSTALL_DIR` | `/opt/shipwick` | Where `compose.yml` and `.env` are written |
| `SHIPWICK_BIN_DIR` | `/usr/local/bin` | Where `shipwick` is installed |

## The API token

The installer generates the token and prints it once, in the run that created it. It is also in `/opt/shipwick/.env`.

::: warning The token is root on the server
The agent controls the Docker daemon, and whoever controls the Docker daemon controls the host. Treat the API token like root SSH access to the server: keep it in a password manager or a CI secret, and keep `/opt/shipwick/.env` private.
:::

The agent itself keeps only the SHA-256 of the token. Read [Security](/docs/security) for the full picture.

## DNS and firewall

Point DNS at the server for the API hostname, the dashboard hostname, and the domain of every application you deploy. Caddy obtains a certificate for a hostname once its DNS record resolves to the server and ports 80 and 443 are reachable.

In your firewall, open ports 80 and 443 (and 443/udp, for HTTP/3), and nothing else. The agent's own port, 9000, speaks plain HTTP and must never be exposed to the internet.

If you skipped the API hostname, the API is not exposed at all. See [Reach the API without a hostname](/docs/tasks/access-without-a-hostname).

## Install a specific version

Everything the installer fetches comes from one [release](https://github.com/shipwick/shipwick/releases) — never from a branch — and each file is verified against that release's checksums. By default that is the latest release. To choose one:

```bash
curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v0.1.0 sh
```

Because the images are pinned in the compose file, a server runs the version it installed until you run the installer again. That is also how you [upgrade](/docs/tasks/upgrade).

## Other ways to install

### The compose file, by hand

The installer's setup is one file, [configs/compose.production.yml](https://github.com/shipwick/shipwick/blob/main/configs/compose.production.yml), plus a `.env` next to it:

```bash
SHIPWICK_AGENT_TOKEN=<output of: openssl rand -hex 32>
SHIPWICK_AGENT_DOMAIN=agent.example.com
SHIPWICK_DASHBOARD_DOMAIN=dashboard.example.com
```

```bash
docker compose -f compose.production.yml up -d
```

Generate the token yourself, as shown. The token must be at least 16 characters. If you let the agent generate one, it prints it to its log, and under Docker that log stays readable through `docker logs` for as long as the container exists.

The compose file attached to a release pins both images to that release. The copy in the repository refers to `latest`.

### From source

Build the images on the server from a checkout of the repository, then run the installer from that checkout. It uses the compose file next to it instead of downloading one.

```bash
docker build -t ghcr.io/shipwick/agent .
docker build -t ghcr.io/shipwick/dashboard dashboard/
sh scripts/install.sh
```

Build the CLI with `make build`.

### A plain binary, next to a Caddy on the host

The agent also runs as a plain binary on Linux, built with `make build`, next to a Caddy installed on the host. Point the agent at Caddy's admin endpoint:

```bash
SHIPWICK_CADDY_ADMIN=http://127.0.0.1:2019
```

The agent listens on `127.0.0.1:9000` by default and keeps its data in `/var/lib/shipwick`. All variables are listed in [Agent configuration](/docs/reference/agent-configuration).

## What's next

- [Install the CLI](/docs/getting-started/install-cli) on your laptop.
- [Deploy your first application](/docs/getting-started/first-deployment).
- [Open the dashboard](/docs/tasks/dashboard).
