---
title: Install from a package
description: Install the Shipwick agent from its Debian or RPM package as a systemd service of the host - what the package installs and what it does not, starting the agent, the proxy and the dashboard, where the API listens, upgrading and removing.
---

# Install from a package

<div class="wick-note">
<img src="/img/wick-tools.svg" alt="Wick, the Shipwick flame, with tools: setting up the server" width="64" height="64">

<p>Since 0.7 the agent is also published as a Debian and an RPM package, for a server where it should be a service of the host — started by systemd, upgraded by the package manager, its output in the journal — instead of a container. This page covers what the package installs and what it does not, starting everything, where the API listens, and upgrading and removing.</p>

</div>

The [installer](/docs/getting-started/install) remains the shortest way to a running server, and sets up everything in one run. The package is for the server whose owner wants the agent managed like the other services of the machine.

## Before you begin

You need:

- A Linux server with systemd, amd64 or arm64. The `.deb` is for Debian and Ubuntu; the `.rpm` is built on Rocky Linux 9 and installs on 8 and later, and on Fedora.
- Docker Engine with the Compose plugin, from your distribution or from Docker. The package recommends Docker and does not depend on one packaging of it.
- Ports 80 and 443 free and reachable from the internet, as for [any installation](/docs/getting-started/install#before-you-begin).

## Install the package

Each release has four packages: `shipwick-agent_amd64.deb`, `shipwick-agent_arm64.deb`, `shipwick-agent_amd64.rpm` and `shipwick-agent_arm64.rpm`. They are files of the release, listed in its `checksums.txt` like the others. Since 0.8.0 that file is signed, and [Verify a release](/docs/tasks/verify-a-release#verify-the-files) has the command that verifies it; the packages carry no signature of their own, and there is no package repository.

```bash
curl -fsSLO https://github.com/shipwick/shipwick/releases/latest/download/shipwick-agent_amd64.deb
curl -fsSL https://github.com/shipwick/shipwick/releases/latest/download/checksums.txt | grep shipwick-agent_amd64.deb | sha256sum -c
sudo apt install ./shipwick-agent_amd64.deb        # or: sudo dnf install ./shipwick-agent_amd64.rpm
```

The file names carry no version, so `releases/latest/download/` is always the latest release; the version is inside the package.

The installation ends by saying what to do next:

```text
The Shipwick agent is installed and not started.

  1. It needs Docker Engine on this server (https://docs.docker.com/engine/install/).
  2. Its settings, with a generated API token:  /etc/shipwick/agent.env
  3. Start it now and at boot:                   systemctl enable --now shipwick-agent
  4. The reverse proxy and the dashboard run as containers:
       docker compose --env-file /etc/shipwick/agent.env -f /usr/share/shipwick/compose.yml up -d

What this package covers, and what it does not: handbook §4, "Installation from a package".
```

## What the package installs

- **`/usr/bin/shipwick-agent`**: the agent.
- **`shipwick-agent.service`**: a systemd unit. It reads the agent's settings from the next file.
- **`/etc/shipwick/agent.env`**: the agent's settings, one `NAME=value` a line. Written on the first installation with a generated API token, readable by root only, and never touched again.
- **`/var/lib/shipwick`**: the agent's [data directory](/docs/reference/agent-configuration#data-directory), with the database, the encryption key and the backups.
- **`/usr/share/shipwick/compose.yml`**: a compose file for the proxy and the dashboard, pinned to the package's version.

It starts nothing and enables nothing: the agent needs Docker, and when it runs is your decision.

## What it does not install

- **Docker.** Install it from your distribution or from Docker.
- **The CLI.** `curl -fsSL https://get.shipwick.com | sh -s -- --cli`, or any way in [Install the CLI](/docs/getting-started/install-cli).
- **The proxy and the dashboard as programs of the host.** Those two stay containers. Caddy finds the replicas of an application by name on a Docker network, which a Caddy installed on the host cannot do; static applications are copied into its container, and requests are counted from its output. The dashboard needs Node, which the package does not bring. The compose file starts both.

## Start it

```bash
systemctl enable --now shipwick-agent
docker compose --env-file /etc/shipwick/agent.env -f /usr/share/shipwick/compose.yml up -d
```

In that order: the agent creates the three Docker networks the compose file joins. The agent finds the proxy by the compose project `shipwick` and the service `caddy`, and talks to it through a socket in `/run/shipwick`.

The API token is `SHIPWICK_AGENT_TOKEN` in `/etc/shipwick/agent.env`. It is the [root token](/docs/getting-started/install#the-api-token): keep the file private.

## Where the API listens

As installed, on `127.0.0.1:9000`. The CLI on the server reaches it:

```bash
shipwick login --url http://127.0.0.1:9000
```

A laptop reaches it through an [SSH tunnel](/docs/tasks/access-without-a-hostname).

The proxy and the dashboard are containers, and a container does not reach the host's loopback.

- **For the API at a hostname**, set `SHIPWICK_AGENT_DOMAIN`. Since 0.8 the agent then also listens on the address the server has on the `shipwick-control` network, which is where the proxy is sent; there it answers the addresses of that network only.
- **For the dashboard**, the agent listens on the address of Docker's bridge instead of loopback. `ip -4 addr show docker0` shows it; it is `172.17.0.1` unless Docker was configured otherwise.

With both:

```bash
# /etc/shipwick/agent.env
SHIPWICK_LISTEN_ADDR=172.17.0.1:9000
SHIPWICK_AGENT_DOMAIN=agent.example.com
SHIPWICK_DASHBOARD_DOMAIN=dashboard.example.com
```

Then restart the agent:

```bash
systemctl restart shipwick-agent
```

Those addresses are reachable from the containers of this server and from nowhere else, and the agent refuses the containers of applications there: see [Who can reach the API](/docs/security#who-can-reach-the-api). A firewall on the server that filters traffic from Docker's networks (`ufw`, `firewalld`) must let port 9000 through from the `shipwick-control` network.

::: warning Never give the API a public address
The API is plain HTTP. On a public address the token travels in clear text, and an admin token is root on the server. The ways in are the proxy, over HTTPS, and the server itself.
:::

Every other setting goes into the same file, one line each, followed by a restart; they are listed in [Agent configuration](/docs/reference/agent-configuration).

## The agent runs as root

It drives Docker through Docker's socket, and whoever may do that can start a container that owns the host. A user of its own in the `docker` group would be root in everything but name, and the proxy's admin socket and root's `docker login` credentials would need opening up for it.

The unit takes away what the agent does not need instead: it cannot gain privileges, `/usr`, `/boot` and `/etc` are read-only to it, home directories are read-only, and it has a `/tmp` of its own. A [`SHIPWICK_BACKUP_DIR`](/docs/reference/agent-configuration#backups) must therefore lie outside those, under `/var` or `/srv`.

## Upgrade

Upgrading is installing the newer package. The agent is restarted when it was running, and `agent.env` stays as it is. The compose command, run again, brings the proxy and the dashboard to the same version:

```bash
sudo apt install ./shipwick-agent_amd64.deb
docker compose --env-file /etc/shipwick/agent.env -f /usr/share/shipwick/compose.yml up -d
```

::: warning Coming from 0.7, the compose command is not optional
It moves the proxy and the dashboard onto the `shipwick-control` network. Until it has run, the agent refuses both, as it refuses any container that calls from an application network.
:::

The upgrade of the installer's installation was walked from every release; the packages were not. See [Upgrade Shipwick](/docs/tasks/upgrade#what-an-upgrade-does).

The [notice about a newer release](/docs/tasks/upgrade#a-notice-when-a-newer-release-exists) in `shipwick server status` names the installer. On a server installed from a package, the package is what to install.

## Remove

Removing the package stops the agent and leaves the applications running, unsupervised: they are containers of Docker. `agent.env` goes with `apt purge`. `/var/lib/shipwick` — the database and the key that decrypts it — is never removed by the package.

## The installer and the package are two installations

An installation made by the installer keeps its data in a Docker volume; one made from a package keeps it in `/var/lib/shipwick`. To move from one to the other, export and import: see [Move to a new server](/docs/tasks/move-to-a-new-server).

## What's next

- [Deploy your first application](/docs/getting-started/first-deployment).
- [Agent configuration](/docs/reference/agent-configuration): every variable that can go into `agent.env`.
- [Upgrade Shipwick](/docs/tasks/upgrade): what happens to running applications while the agent restarts.
- [Security](/docs/security): what the API token is worth.
- [Prepare a server](/docs/tasks/prepare-a-server): SSH keys, security updates, swap, a firewall, backups elsewhere.
