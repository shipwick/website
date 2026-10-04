---
title: Upgrade Shipwick
description: Upgrade the agent, Caddy setup and dashboard by running the installer again, upgrade the CLI with shipwick upgrade, how a server says that a newer release exists, and what happens to running applications meanwhile.
---

# Upgrade Shipwick

You upgrade a Shipwick server by running the installer again, on the server or from your laptop over SSH, and a CLI elsewhere with `shipwick upgrade`. This page covers what the installer changes, what it leaves alone, how to choose a version, what happens to your applications and to a running deployment while the agent restarts, how the server says that a newer release exists, what the upgrades to 0.7, 0.6, 0.5, 0.4 and 0.3 do on first start and what you may want to turn on afterwards, and how to upgrade the CLI on laptops and in CI.

## Read the changelog first

Shipwick is at 0.x. Before 1.0, a minor version may change the API, `deploy.yaml` or the on-disk format. When it does, the [changelog](https://github.com/shipwick/shipwick/blob/main/CHANGELOG.md) entry says so under **Changed** and explains how to upgrade. Read it before every upgrade.

## A notice when a newer release exists

Since 0.7 the agent asks GitHub once a day which release is the latest, and `GET /server` carries the answer. The dashboard and `shipwick server status` say when the server is behind, without a connection of their own:

```text
Agent           v0.7.0  v0.7.1 is available  (on the server, run the installer again: curl -fsSL https://get.shipwick.com | sh)
```

In the dashboard the notice is on the server's Status tab, with the command that upgrades; see [Use the dashboard](/docs/tasks/dashboard#the-server).

- **The question says nothing about the server.** It is one request to `github.com/shipwick/shipwick/releases/latest`, without a version or an identifier in it. See [What leaves the server unasked](/docs/security#what-leaves-the-server-unasked).
- **It goes through the proxy and the certificate authorities the agent was given.** A server that cannot reach GitHub notices nothing: the request gives up after 15 seconds, nothing is logged above debug level, and the next attempt is a day later like any other.
- **A restart asks nothing.** The last answer is kept in `update-check.json` in the data directory.
- **`SHIPWICK_UPDATE_CHECK=off` stops the question.** The agent says at startup, once, that it asks and how to stop it. See [Agent configuration](/docs/reference/agent-configuration#shipwick-update-check).
- **Pre-releases are never announced**, and nothing is installed: the notice names the command, and running it is yours.

The notice names the installer. On a server [installed from a package](/docs/getting-started/install-from-a-package#upgrade), the newer package is what to install.

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
✓ Removed 2 image(s) of earlier Shipwick releases
✓ Installed the shipwick CLI to /usr/local/bin/shipwick
✓ shipwick on this server is signed in

Shipwick is running.

  Your API token is unchanged: SHIPWICK_AGENT_TOKEN in /opt/shipwick/.env
  From your laptop or CI:   shipwick login --url https://agent.example.com
  On this server:           shipwick ps
  Dashboard:                https://dashboard.example.com
  Open ports 80 and 443 (and 443/udp) — and nothing else — in your firewall.
  DNS records must point straight at this server (at Cloudflare: DNS only). To keep
  Cloudflare's proxy on, add SHIPWICK_CLOUDFLARE_API_TOKEN to /opt/shipwick/.env
  and run:   cd /opt/shipwick && docker compose up -d
  Upgrade later by running this installer again.
```

A server does not upgrade by itself. The compose file of each release pins the Shipwick images — the agent, the dashboard and, since 0.5, the proxy — to that release's version, so a server runs the version it installed until you run the installer again.

From your laptop, the same over SSH:

```bash
shipwick server install root@203.0.113.10
```

It runs the installer on the server; the token is unchanged and not printed again, and the saved context keeps the one it has. `--version v0.4.1` picks a release. A server with no connection is upgraded from a bundle of the newer release: see [Install on a server with no way out](/docs/tasks/corporate-network#install-on-a-server-with-no-way-out). See [Install on a server](/docs/getting-started/install#run-the-installer-from-your-laptop).

What the installer does on an upgrade:

1. Downloads the new release's compose file and verifies it against the release's `checksums.txt`. Only a verified file replaces `/opt/shipwick/compose.yml`. A checksum mismatch installs nothing and leaves the running installation as it was.
2. Keeps `/opt/shipwick/.env` exactly as it is. The root token does not change, and it is not printed again. The hostnames do not change, and the installer does not ask for them. Anything else you put there — `SHIPWICK_WEBHOOK_URL`, a mount for images built from source — stays too.
3. Pulls the images that the new compose file names, and recreates the containers whose definition changed.
4. Waits for the agent to report healthy.
5. Removes the agent, dashboard and proxy images of earlier releases, up to a few hundred megabytes each. The images that are running, and anything else on the server, are kept. This step exists since 0.5; see [Upgrading from 0.4 to 0.5](#upgrading-from-0-4-to-0-5).
6. Replaces `shipwick` on the server with the release's version, verified the same way.
7. With a hostname for the API, puts the token from `.env` back into the CLI context that points at this server, and leaves every other context, and which one is current, as they were. See [The CLI on the server](/docs/getting-started/install#the-cli-on-the-server).

::: info compose.yml is the installer's, compose.override.yml is yours
The installer writes a fresh `/opt/shipwick/compose.yml` on every run. Keep your own changes — [publishing the API on loopback](/docs/tasks/access-without-a-hostname), [mounting `docker login` credentials](/docs/tasks/private-registries) — in `/opt/shipwick/compose.override.yml`. Compose merges the two files, and the installer never touches the override or `.env`.
:::

## Choose a version

By default the installer installs the latest release. Pre-releases, such as release candidates, are never picked by default. To install a specific version:

```bash
curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v0.4.1 sh
```

Everything comes from that one release — the compose file, the images and the CLI — so the three always belong together.

## What happens to running applications

Running applications do not depend on the agent being up. Restarting or upgrading the agent does not restart any application container, and applications keep running while the agent is down.

While the agent is down:

- Nothing supervises the applications. A replica that crashes during that time is not restarted until the agent is back.
- The API does not answer, so `shipwick` and the dashboard cannot show or do anything. A `shipwick deploy` that is waiting on a deployment reports that the agent is not responding, and goes on when it is back.

When the new agent starts, before it serves requests, it reconciles what it finds:

1. A deployment that was in flight when the old agent stopped is resumed, since 0.5. The agent picks it up where it was: containers it had created are kept, replicas that were already serving keep serving, and only what was not done is done. The deployment's events say `Resumed after the agent restarted`. The exception is a `pre_deploy` command that was running when the agent stopped: it is not run a second time, the deployment fails and says so, nothing of the running version has been touched, and you deploy again once you have looked at what the command left behind. An agent before 0.5 marked every such deployment `FAILED`. See [Architecture](/docs/concepts/overview#agent-restarts-and-crashes).
2. Containers that belong to a known application but neither to its active deployment nor to one that resumes are removed.
3. Containers of applications the agent's database does not know are never touched.

Supervision then resumes. The supervisor's state is held in memory, so every replica starts with a clean slate: its backoff history is gone, and its health is unknown until it has been probed again. `shipwick status` shows such a replica as `checking`. Unknown counts as healthy, so an application does not flap to `DOWN` because the agent was restarted. Only the restart counter is kept, for display.

A job that was running when the old agent stopped is marked `interrupted` and its container removed; the job runs again at its next scheduled time. Firings that fell while the agent was down are not caught up.

After a server reboot, the agent brings every application back up according to its restart policy.

### Upgrading from 0.6 to 0.7

0.7 adds to what the agent stores and keeps on its disk; applications run as before, and nothing changes for a `deploy.yaml` that worked before. All three containers are recreated, because their images changed. The proxy is away for the moment that takes, and established connections through it are cut; certificates and configuration are on volumes and stay, and the applications behind the proxy keep running.

On its first start the new agent **applies three schema migrations** to `shipwick.db`, numbers 19 to 21: the index of the log archive, the references to stored secrets that are remembered with each deployment, and what a session's name rests on — the claim it was read from and the tenant it came from. An older agent refuses a database whose schema is newer than it supports, so do not downgrade afterwards. Nothing is encrypted anew.

Existing tokens, rules and sessions keep working. A session from before the upgrade was named by the `email` claim, and stays valid while the agent names people that way.

Four things behave differently without being asked:

- **The agent keeps the last output of containers that end**, from the first one that ends after the upgrade: 14 days, at most 1 GB, as gzip files under `logs/` in its data directory. They are not encrypted, like the logs Docker keeps. `SHIPWICK_LOG_RETENTION_SIZE=0` keeps nothing. See [Find out why it died](/docs/tasks/find-out-why-it-died).
- **The agent asks GitHub once a day whether a newer release exists.** The request says nothing about the server; `SHIPWICK_UPDATE_CHECK=off` stops it. See [above](#a-notice-when-a-newer-release-exists).
- **`"********"` is refused as an `env` value or a basic-auth password**, by `deploy` and `validate` alike, with `400 INVALID_CONFIG` and the fields to fill in. What the API masks can no longer be deployed as a value by pasting it back. A `deploy.yaml` that really holds that text as a value has to change.
- **`GET /audit` says whether older entries match**, as `more` next to `data`, so a page that is exactly full no longer looks like there is another. `ACCESS_NOT_GRANTED` carries the person's name as `details.name`; `details.email` holds the same and stays for older clients.

One thing takes a deployment to arrive: `shipwick config` gives back a reference to a stored secret only for deployments made by 0.7. An application deployed before has all its secret values shown as masks until it is deployed again from its file.

What is new is opt-in. What an operator may want to turn on or use:

| | How |
|---|---|
| Read what a container printed before it died | Nothing to turn on: `shipwick logs my-api --previous`. See [Find out why it died](/docs/tasks/find-out-why-it-died) |
| Keep more or less of that output | `SHIPWICK_LOG_RETENTION_DAYS` and `SHIPWICK_LOG_RETENTION_SIZE` in `/opt/shipwick/.env` |
| Get a lost `deploy.yaml` back | `shipwick config my-api -o deploy.yaml`. See [Get deploy.yaml back from the server](/docs/tasks/get-the-configuration-back) |
| Move a token's end, or change its applications, without a new value | `shipwick token update ci --expires 90d`. See [Change a token](/docs/tasks/tokens#change-a-token) |
| End a dump that hangs at its limit | `backups.before_in: container` in `deploy.yaml`; `pg_dump` then needs `-h localhost`. See [A `before` that is ended at its limit](/docs/tasks/backups#a-before-that-is-ended-at-its-limit) |
| Filter the audit trail by action and result, and export it | `shipwick audit --action token. --outcome refused,failed`, `--format csv`. See [See who changed what](/docs/tasks/audit) |
| Let accounts without an address sign in | `SHIPWICK_OIDC_NAME_CLAIM`, and rules written `name:`. See [Accounts without an address](/docs/tasks/sign-in#accounts-without-an-address) |
| Let the accounts of several Microsoft Entra tenants sign in | `SHIPWICK_OIDC_TENANTS` with Entra's `organizations` issuer. See [Accounts of several Microsoft Entra tenants](/docs/tasks/sign-in#accounts-of-several-microsoft-entra-tenants) |
| Keep an ECR or Artifact Registry credential current | The cloud CLI's token piped into `shipwick registry login`. See [Registries with tokens that expire](/docs/tasks/private-registries#registries-with-tokens-that-expire) |
| Run the agent as a systemd service | The `.deb` or `.rpm` of the release. It is a separate installation, reached by export and import. See [Install from a package](/docs/getting-started/install-from-a-package) |

Each variable is one the new compose file passes through and that is empty until you set it.

A bundle for a server with no connection now proves its images: a release from 0.7.0 on publishes their digests, `shipwick server bundle` checks the archive against them, and the installer checks what Docker loaded. See [Install on a server with no way out](/docs/tasks/corporate-network#install-on-a-server-with-no-way-out).

In the dashboard, an application's Logs tab reads the log archive, **Change the configuration** opens the application's `deploy.yaml`, a token is edited on the Access page, the audit trail is filtered and exported, an export is downloaded and a file imported on the server's page, and every page works with the keyboard alone. See [Use the dashboard](/docs/tasks/dashboard).

On laptops and in CI, upgrade the CLI as described below; the new commands and flags need it. On Windows on Arm, `shipwick upgrade` picks the Arm build, also when the `shipwick` that runs is the x64 one. A 0.6 `shipwick` keeps working against a 0.7 agent for everything it knows. A 0.7 `shipwick` against a 0.6 agent says so where the agent lacks something:

| Asked for | The CLI says |
|---|---|
| `logs --previous`, `--list`, `--id`, `--search` and the others | `the agent is older than this shipwick and keeps no log archive: it shows the output of running containers only` |
| `config` | `the agent is older than this shipwick and does not write an application's deploy.yaml` |
| `audit --action`, `--outcome`, `--actor-kind` | `the agent is older than this shipwick: it filters the audit trail by application, actor and time only, and would have ignored --action, --outcome and --actor-kind` |
| `audit --format`, `--output` | `the agent is older than this shipwick and cannot export its audit trail` |

`token update` against a 0.6 agent changes nothing, and says that the agent is older.

### Upgrading from 0.5 to 0.6

0.6 adds to what the agent stores and to what it tells the proxy; applications run as before, and nothing changes for a `deploy.yaml` that worked before. All three containers are recreated, because their images changed. The proxy is away for the moment that takes, and established connections through it are cut; certificates and configuration are on volumes and stay, and the applications behind the proxy keep running.

On its first start the new agent:

1. **Applies five schema migrations** to `shipwick.db`, numbers 14 to 18: what the agent remembers about imports and a promotion across its own restarts, the applications and the expiry of a token, the audit trail, the access rules, and the sessions of people who signed in. An older agent refuses a database whose schema is newer than it supports, so do not downgrade afterwards. Nothing is encrypted anew.
2. **Loads Caddy's configuration once.** The new agent renders the proxy's configuration with one more setting — requests to replicas never go through a proxy of the environment — so the configuration it finds differs from the one it renders, and it is loaded once. A connection that is being established at that instant is reset, as with any [change of the configuration](/docs/concepts/routing-and-https); it does not happen again afterwards.

Existing tokens keep working: none is limited and none expires. The audit trail starts with the first change made after the upgrade.

Three things behave differently without being asked:

- **A hostname under `redirects` of an application with a `path`** redirects to the domain and that path, `https://example.com/api/users` for a request for `/users`, instead of to the same path on the domain.
- **A standby remembers what it imported** across restarts of its agent, and no longer imports the newest export once more after every restart.
- **An import validates every application's configuration** by all the rules a `deploy.yaml` is held to.

What is new is opt-in. What an operator may want to turn on:

| | How |
|---|---|
| Limit CI's token to what it deploys, and give it an end | Create its replacement with `shipwick token create ci-2 --role deploy --app my-api --expires 90d`, hand it over, revoke the old one. See [Create tokens for CI and teammates](/docs/tasks/tokens) |
| Let people sign in to the dashboard with the company's accounts | `SHIPWICK_OIDC_ISSUER`, `SHIPWICK_OIDC_CLIENT_ID` and `SHIPWICK_OIDC_CLIENT_SECRET` in `/opt/shipwick/.env`, then `shipwick access grant`. See [Sign in with your company's accounts](/docs/tasks/sign-in) |
| Read who changed what | Nothing to turn on: `shipwick audit`. See [See who changed what](/docs/tasks/audit) |
| Stop Node replicas at once instead of after their grace period | `init: true` in `deploy.yaml`. See [An init process](/docs/concepts/deployments#an-init-process) |
| Give a long dump more than an hour | `backups.before_timeout` in `deploy.yaml`. See [Back up on a schedule](/docs/tasks/backups#back-up-on-a-schedule) |
| Show several servers in one dashboard | `SHIPWICK_AGENTS` in `/opt/shipwick/.env`. See [Several servers in one dashboard](/docs/tasks/dashboard#several-servers-in-one-dashboard) |
| Go out through a proxy, trust an authority of your own | `HTTPS_PROXY`, `SHIPWICK_CA_FILE`, `SHIPWICK_DNS_RESOLVERS`, `SHIPWICK_ACME_DIRECTORY`. See [Run behind a corporate proxy or without internet](/docs/tasks/corporate-network) |

Each variable is one the new compose file passes through and that is empty until you set it. Backups larger than 5 GB now reach the bucket without anything being set: an archive of more than 64 MiB is sent in parts.

In the dashboard, an application's page and the server's page are tabs with addresses of their own, and tokens are under Access. The old addresses — `/tokens`, `/secrets`, `/registries` — redirect. See [Use the dashboard](/docs/tasks/dashboard).

On laptops and in CI, upgrade the CLI as described below; the new commands need it. A 0.5 `shipwick` keeps working against a 0.6 agent for everything it knows; it promotes a standby in one request that is held until the end. A 0.6 `shipwick` against a 0.5 agent says so where the agent lacks something: `the agent is older than this shipwick and keeps no audit trail`, `the agent is older than this shipwick: it knows neither --app nor --expires, and created nothing`.

### Upgrading from 0.4 to 0.5

0.5 changes the proxy's image and adds to what the agent stores; applications run as before. All three containers are recreated. The agent and the dashboard because their images changed, and the Caddy container because it is replaced with Shipwick's own build of Caddy, `ghcr.io/shipwick/caddy`: Caddy with the Cloudflare DNS module and nothing else added, pinned to the release like the other two. The proxy is away for the moment that takes, and established connections through it are cut; certificates and configuration are on volumes and stay, and the applications behind the proxy keep running.
On its first start, before it serves requests, the new agent applies four schema migrations to `shipwick.db`, numbers 10 to 13: the registry credentials, the supplied certificates, the traffic samples, and the backups the agent takes. An older agent refuses a database whose schema is newer than it supports, so do not downgrade afterwards. Nothing is encrypted anew; registry passwords and certificate keys are encrypted with the same `encryption.key` as the environment values, and the key can now be [rotated](/docs/tasks/rotate-the-encryption-key).

Two things the upgrade itself does differently from this release on:

- **A deployment that is running while the agent restarts is resumed**, not failed, as described above. The agent that is stopped must already be 0.5 to leave it that way: during the upgrade from 0.4 itself, the old agent still marks a deployment in flight as `FAILED` when it shuts down, so do not start this upgrade in the middle of a deployment.
- **The installer removes the images of earlier releases.** The removal was added in 0.4 and repaired in 0.4.1, but nothing called it; it now runs once the upgraded agent is healthy. Run the installer again on a server that is up to date to reclaim the space; it changes nothing else there.

With a hostname for the API, the installer also signs in the `shipwick` on the server: it saves the URL and the token as a context of the user who runs it, when no other server is saved there. See [The CLI on the server](/docs/getting-started/install#the-cli-on-the-server).

Nothing changes for a `deploy.yaml` that worked before, with one difference in timing: replacing a replica no longer waits for the old one to exit, so a deployment is done when every new replica serves, and the replaced containers get their `SIGTERM` and their grace period in the background. What is new is opt-in. In `deploy.yaml`: `path`, `proxy`, `static.fallback`, `backups`, `deploy.stop_timeout`, wildcard hostnames. On the agent, each a variable in `/opt/shipwick/.env` that the new compose file passes through and that is empty until you set it: `SHIPWICK_CLOUDFLARE_API_TOKEN`, the `SHIPWICK_BACKUP_*` variables, `SHIPWICK_EXPORT_SCHEDULE` and `SHIPWICK_STANDBY_SCHEDULE`, and the two alert thresholds. See [Agent configuration](/docs/reference/agent-configuration). Until `SHIPWICK_BACKUP_PASSPHRASE` is set, the agent's own state is not backed up, and `shipwick doctor` says so.

Private images keep working as they did: a mount of the server's `docker login` credentials in `compose.override.yml` is still read for a registry without a stored credential. `shipwick registry login` stores the credential on the agent instead, and the mount is then no longer needed; see [Pull from private registries](/docs/tasks/private-registries).

On laptops and in CI, upgrade the CLI as described below; the new commands need it. A 0.5 CLI against a 0.4 agent deploys as before: it asks the agent about the domain only before it builds, and sends the whole image; `shipwick server rotate-key` answers `the agent is older than this shipwick and cannot rotate its key`.

### Upgrading from 0.3 to 0.4

0.4 adds to what the agent stores and to what the proxy mounts; applications run as before. The agent and dashboard containers are recreated because their images changed. The Caddy container is recreated once as well, because the new compose file gives it the `caddy-static` volume for the folders of static applications: established connections through the proxy are cut at that moment, and the applications behind it keep running.

On its first start, before it serves requests, the new agent applies two schema migrations to `shipwick.db`, numbers 8 and 9: the `secrets` table, and what a static deployment serves (its digest, file count and size) on every deployment. An older agent refuses a database whose schema is newer than it supports, so do not downgrade afterwards. Nothing is encrypted anew; the stored secrets are encrypted with the same `encryption.key` as the environment values.

Nothing changes for a `deploy.yaml` that worked before. What is new is opt-in: `build: .`, `static:`, `health.start_period`, `shipwick.yaml`, secrets on the server, and the API's rate limit on failed authentications, which a valid token never meets. A 0.3 `shipwick` keeps working against a 0.4 agent for everything it knows; `build`, `static`, `shipwick.yaml`, `secret`, `volumes`, `server install`, `doctor` and `open` need the new CLI, and a 0.4 CLI against a 0.3 agent says `The agent does not know this operation` when it asks for one of them. The [GitHub Action](/docs/tasks/deploy-from-ci) follows the latest release by default.

### Upgrading from 0.2 to 0.3

0.3 changes what the agent stores, not how applications run. No application container is recreated by the upgrade; only the agent, Caddy and dashboard containers are, because their images changed, and applications keep serving throughout.

On its first start, before it serves requests, the new agent:

1. **Applies four schema migrations** to `shipwick.db`, numbers 4 to 7: the `tokens` table, the token name on every deployment (`by`), the metrics history samples, and the runs of jobs and one-off commands. Migrations run inside a transaction and are the reason the agent must not be downgraded afterwards: an older agent refuses a database whose schema is newer than it supports.
2. **Creates `encryption.key`** in its data directory — the `agent-data` volume, `/var/lib/shipwick` inside the container — with mode `0600`, and logs `created the key that encrypts env values in the database; back it up together with shipwick.db`. Every deployment's `env` values, of every deployment made by earlier releases too, are then encrypted in place, once. From now on the database is readable only together with the key.
3. Finds the running replicas, gives them their names and reconciles them, as after every restart.

::: warning Back up encryption.key
Add `encryption.key` to whatever backs up `shipwick.db`. A copy of the database without the key reveals no secrets, which is the point, but the agent cannot read it either: started against a database whose values were encrypted with another key, it refuses to start, names the deployment and variable it could not read, and asks you to restore the key file from your backup or to set `SHIPWICK_ENCRYPTION_KEY` to the key the database was written with. Since 0.5 the agent backs up both itself once `SHIPWICK_BACKUP_PASSPHRASE` is set, and the key can be [rotated](/docs/tasks/rotate-the-encryption-key).
:::

The root token does not change; the token in `/opt/shipwick/.env` is the same one, now with the name `root` and the `admin` role. Tokens for CI and teammates are created from it afterwards, and can be given less: see [Create tokens for CI and teammates](/docs/tasks/tokens). The new compose file passes `SHIPWICK_WEBHOOK_URL` and `SHIPWICK_WEBHOOK_SECRET` from `.env` to the agent, both empty until you set them; see [Get notified](/docs/tasks/notifications). The dashboard's History charts start filling as soon as the new agent samples; there is no history from before the upgrade.

On laptops and in CI, upgrade the CLI as described next. A 0.2 `shipwick` keeps working against a 0.3 agent for everything it knows; the new commands need the new CLI.

### Upgrading from 0.1 to 0.2

0.2 changes how the proxy finds replicas: by a name on a second network instead of by container name. The upgrade recreates the Caddy container once, because it joins that network. Established connections through the proxy are cut at that moment; nothing else is, and applications keep running throughout. The replicas the new agent finds on startup are given their names before Caddy is told to look for them, and Caddy's configuration then changes once. See [Routing and HTTPS](/docs/concepts/routing-and-https).

## Upgrade the CLI elsewhere

The server's copy of `shipwick` is upgraded with the server. On a laptop, the CLI upgrades itself:

```bash
shipwick upgrade
```

```text
✓ Upgraded shipwick v0.3.1 → v0.4.1
  /usr/local/bin/shipwick

The server runs v0.4.1, the latest release.
```

The latest release is downloaded from GitHub and verified against its `checksums.txt` before the binary is swapped; nothing changes if the checksum does not match. The command then compares the server's version with the release. When the server is behind, it says so and prints the installer line to run there; a server it cannot reach is one dim line, not an error. `shipwick upgrade --check` reports and changes nothing.

A `shipwick` from Homebrew is left to Homebrew — the command prints `Upgrade with: brew upgrade shipwick` — because the package manager would otherwise be confused by a file it did not put there. On Windows, `shipwick upgrade` replaces `shipwick.exe` the same way and leaves the old binary behind as `shipwick.old.exe` until the next run removes it.

In CI, pin the version in the installer line instead, and move it when you mean to:

```bash
curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v0.4.1 sh -s -- --cli
```

The [GitHub Action](/docs/tasks/deploy-from-ci) takes the same pin as `version: v0.4.1`. If `shipwick` is newer than the agent and uses an operation the agent does not have, it says so: `The agent does not know this operation — it is probably older than this shipwick.` `shipwick server status` shows both versions, and `shipwick doctor` compares both with the latest release.

## If you installed without the installer

If you run the compose file by hand, replace it with the `compose.production.yml` attached to the new [release](https://github.com/shipwick/shipwick/releases), which pins the images to that version — since 0.5 the proxy's too, Shipwick's own build of Caddy — and passes the optional variables through, keep your `.env`, and run:

```bash
docker compose -f compose.production.yml pull
docker compose -f compose.production.yml up -d
```

If you built the images from source, rebuild them from the new checkout — since 0.5 there are three, the proxy's with `docker build -t ghcr.io/shipwick/caddy -f Dockerfile.caddy .` — and run `sh scripts/install.sh` from it again.

If the agent was installed from a package, install the newer package and run its compose command again; see [Install from a package](/docs/getting-started/install-from-a-package#upgrade).

If the agent runs as a plain binary, replace it with the new build and restart it. The first start of 0.3.0 creates `encryption.key` in `SHIPWICK_DATA_DIR`, or reads `SHIPWICK_ENCRYPTION_KEY` if you set it; the first starts of 0.4.0, 0.5, 0.6 and 0.7 apply the migrations described above.

## What's next

- The [changelog](https://github.com/shipwick/shipwick/blob/main/CHANGELOG.md) and the [releases](https://github.com/shipwick/shipwick/releases).
- [Install the CLI](/docs/getting-started/install-cli#upgrade) covers `shipwick upgrade` in full.
- [Health and supervision](/docs/concepts/health-and-supervision) explains what the supervisor does once it is back.
