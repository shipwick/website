---
title: Upgrade Shipwick
description: Upgrade the agent, Caddy setup, dashboard and deployctl by running the installer again, and what happens to running applications meanwhile.
---

# Upgrade Shipwick

You upgrade a Shipwick server by running the installer again. This page covers what that changes, what it leaves alone, how to choose a version, and what happens to your applications while the agent restarts.

## Read the changelog first

Shipwick is at 0.x. Before 1.0, a minor version may change the API, `deploy.yaml` or the on-disk format. When it does, the [changelog](https://github.com/shipwick/shipwick/blob/main/CHANGELOG.md) entry says so under **Changed** and explains how to upgrade. Read it before every upgrade.

## Upgrade the server

On the server, as root:

```bash
curl -fsSL https://get.shipwick.com | sh
```

```text
✓ Docker 29.8.0 with Compose 5.5.1
✓ Installed /opt/shipwick/compose.yml
✓ Keeping the existing /opt/shipwick/.env (your API token is unchanged)
✓ Started the Shipwick services
✓ The agent is healthy
✓ Installed deployctl to /usr/local/bin/deployctl
```

A server does not upgrade by itself. The compose file of each release pins both Shipwick images to that release's version, so a server runs the version it installed until you run the installer again.

What the installer does on an upgrade:

1. Downloads the new release's compose file and verifies it against the release's `checksums.txt`. Only a verified file replaces `/opt/shipwick/compose.yml`. A checksum mismatch installs nothing and leaves the running installation as it was.
2. Keeps `/opt/shipwick/.env` exactly as it is. The token does not change, and it is not printed again. The hostnames do not change, and the installer does not ask for them.
3. Pulls the images that the new compose file names, and recreates the containers whose definition changed.
4. Waits for the agent to report healthy.
5. Replaces `deployctl` on the server with the release's version, verified the same way.

::: info compose.yml is the installer's, compose.override.yml is yours
The installer writes a fresh `/opt/shipwick/compose.yml` on every run. Keep your own changes — [publishing the API on loopback](/docs/tasks/access-without-a-hostname), [mounting registry credentials](/docs/tasks/private-registries) — in `/opt/shipwick/compose.override.yml`. Compose merges the two files, and the installer never touches the override or `.env`.
:::

## Choose a version

By default the installer installs the latest release. Pre-releases, such as release candidates, are never picked by default. To install a specific version:

```bash
curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v0.1.0 sh
```

Everything comes from that one release — the compose file, the images and the CLI — so the three always belong together.

## What happens to running applications

Running applications do not depend on the agent being up. Restarting or upgrading the agent does not restart any application container, and applications keep running while the agent is down.

While the agent is down:

- Nothing supervises the applications. A replica that crashes during that time is not restarted until the agent is back.
- The API does not answer, so `deployctl` and the dashboard cannot show or do anything. A `deployctl` command that is waiting on a deployment rides out a short outage before it gives up.

When the new agent starts, before it serves requests, it reconciles what it finds:

1. A deployment that was in flight when the old agent stopped is marked `FAILED`, and its leftover containers are removed. Do not upgrade in the middle of a deployment; if you did, deploy again afterwards.
2. Containers that belong to a known application but not to its active deployment are removed.
3. Containers of applications the agent's database does not know are never touched.

Supervision then resumes. The supervisor's state is held in memory, so every replica starts with a clean slate: its backoff history is gone, and its health is unknown until it has been probed again. `deployctl status` shows such a replica as `checking`. Unknown counts as healthy, so an application does not flap to `DOWN` because the agent was restarted. Only the restart counter is kept, for display.

After a server reboot, the agent brings every application back up according to its restart policy.

## Upgrade deployctl elsewhere

The server's copy of `deployctl` is upgraded with the server. On laptops and in CI, run the CLI installer again:

```bash
curl -fsSL https://get.shipwick.com | sh -s -- --cli
```

On Windows, download the new `deployctl_windows_amd64.exe` from the [releases page](https://github.com/shipwick/shipwick/releases).

To compare the versions of the CLI and the agent:

```bash
deployctl server status
```

If `deployctl` is newer than the agent and uses an operation the agent does not have, it says so: `The agent does not know this operation — it is probably older than this deployctl.`

## If you installed without the installer

If you run the compose file by hand, replace it with the `compose.production.yml` attached to the new [release](https://github.com/shipwick/shipwick/releases), which pins the images to that version, keep your `.env`, and run:

```bash
docker compose -f compose.production.yml pull
docker compose -f compose.production.yml up -d
```

If you built the images from source, rebuild them from the new checkout and run `sh scripts/install.sh` from it again.

## What's next

- The [changelog](https://github.com/shipwick/shipwick/blob/main/CHANGELOG.md) and the [releases](https://github.com/shipwick/shipwick/releases).
- [Health and supervision](/docs/concepts/health-and-supervision) explains what the supervisor does once it is back.
