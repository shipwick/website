---
title: Keep the encryption key off the server's disk
description: Give the agent its encryption key through SHIPWICK_ENCRYPTION_KEY from a secret manager at start-up - with a systemd drop-in for the package, and what the compose installation can and cannot do - and what that means for an unattended reboot, for backups and for key rotation.
---

# Keep the encryption key off the server's disk

By default the key that encrypts every secret in the agent's database is a file next to the database, `encryption.key`, so that a copy of the data directory is a copy of both. `SHIPWICK_ENCRYPTION_KEY` lets the key come from the agent's environment instead, and from there it is one step to a secret manager that hands it over at start-up. This page shows that step for the two kinds of installation, and what it changes: a reboot now needs the secret manager, backups carry the key the agent was given, and a rotation ends with a value to put into the manager.

## Before you begin

- Read [`SHIPWICK_ENCRYPTION_KEY`](/docs/reference/agent-configuration#shipwick-encryption-key) for what the key protects and what it does not. Root on the server can read the agent's memory, and `docker inspect` shows every container's environment to anyone with the Docker socket: this page is about copies of the disk, not about the server itself.
- The key is 64 hexadecimal characters, 32 random bytes; `openssl rand -hex 32` makes one. The agent trims surrounding whitespace and refuses anything else at start: `SHIPWICK_ENCRYPTION_KEY: expected 64 hexadecimal characters`. The value is never repeated in a log or an error.
- Where the agent runs decides how far "off the disk" goes. As a host process, installed [from a package](/docs/getting-started/install-from-a-package), the key can live in the process's environment alone. As a container, under the installer's compose file, Docker writes a container's environment into its own files under `/var/lib/docker` when it creates the container, so the key leaves the agent's data directory but not the disk. Both arrangements are below, each with what it buys.

## How the agent finds its key

At every start, in this order:

1. `SHIPWICK_ENCRYPTION_KEY`, when set. Nothing is written to disk.
2. Otherwise `encryption.key` in the data directory, written by an earlier run.
3. Otherwise a new key, generated and written there with mode `0600`, and a log line asking you to back it up.

Then the agent opens the database and proves the key against every stored value, before it serves anything. A key that does not fit stops it:

```text
the encryption key does not match the database (deployment 12, variable DATABASE_URL): restore /var/lib/shipwick/encryption.key from your backup or set SHIPWICK_ENCRYPTION_KEY
```

Nothing is changed by a failed start. The one thing to know about the order: a start with the variable unset and the file gone is case 3 — the agent writes a fresh key, finds that it does not open the data, and stops with the message above. Set the variable, which wins over the file, and remove the file it left behind.

## With the package: a systemd drop-in

The package's unit reads `/etc/shipwick/agent.env`. A drop-in adds a command that fetches the key before the agent starts and a second environment file for it, on `/run`, which is memory:

```bash
systemctl edit shipwick-agent
```

```ini
[Service]
# A directory on /run, created before the unit starts and removed when it stops.
RuntimeDirectory=shipwick-agent
RuntimeDirectoryMode=0700
# Writes SHIPWICK_ENCRYPTION_KEY=... into that directory.
ExecStartPre=/usr/local/sbin/shipwick-fetch-key
# Read again before each command of the unit runs, so the agent sees what ExecStartPre wrote.
# The leading - lets ExecStartPre itself start while the file does not exist yet.
EnvironmentFile=-/run/shipwick-agent/key.env
```

`/usr/local/sbin/shipwick-fetch-key` asks your secret manager and writes one line. With the AWS CLI and a secret named `shipwick/encryption-key`:

```sh
#!/bin/sh
set -eu
umask 077
key=$(aws secretsmanager get-secret-value --secret-id shipwick/encryption-key \
        --query SecretString --output text)
printf 'SHIPWICK_ENCRYPTION_KEY=%s\n' "$key" > /run/shipwick-agent/key.env
```

The line that differs for another manager is the one that fetches: `vault kv get -field=value secret/shipwick/encryption-key`, `op read op://…`, `gcloud secrets versions access latest --secret=…`. Whatever it is, it runs as root, as the agent does, with the credentials that machine holds for the manager: an instance role, an AppRole, a service account. The file it writes is on a tmpfs, readable by root alone, and gone when the unit stops. Then:

```bash
systemctl daemon-reload
systemctl restart shipwick-agent
journalctl -u shipwick-agent -n 20
```

The agent starts with the key from the environment; it neither reads nor writes `encryption.key`. See [Running the agent as a service of the host](/docs/reference/agent-configuration#running-the-agent-as-a-service-of-the-host) for the unit as the package ships it.

## With the installer: the compose file

The installer's compose file passes `SHIPWICK_ENCRYPTION_KEY` through from the environment `docker compose` runs in, `.env` included. Two ways to set it:

- **In `/opt/shipwick/.env`**, a line `SHIPWICK_ENCRYPTION_KEY=…`. The file is `0600` and already holds the root token, which is root on this server. `shipwick server configure` does not take this variable, on purpose; it is edited by hand, and `docker compose up -d` recreates the agent with it.
- **In the shell that runs `docker compose up -d`**, from the secret manager's CLI, with no line in `.env`: `SHIPWICK_ENCRYPTION_KEY=$(aws secretsmanager get-secret-value …) docker compose up -d`. Compose passes a variable it finds in its environment the same way.

What either buys: the key is no longer in the `agent-data` volume, so a copy of the data directory, a backup of the volume or a snapshot of it is a database nobody can read. What neither buys: `.env` is on the same disk, and Docker keeps the container's environment in the container's configuration under `/var/lib/docker` for as long as the container exists, with or without `.env`, which is what `docker inspect shipwick-agent-1` reads it from. A snapshot of the whole disk has the key either way. Off the disk, as against out of the data directory, is what the package arrangement above gives.

## Moving an existing installation

An agent that has a key file keeps using it until the variable is set; the variable then wins and the file is ignored. Put the file's content into the manager, give it to the agent, confirm that the agent started, then remove the file:

```bash
cd /opt/shipwick
docker run --rm -v shipwick_agent-data:/data:ro busybox cat /data/encryption.key   # the value to store
# ... store it in the secret manager, and set SHIPWICK_ENCRYPTION_KEY as above ...
docker compose up -d
shipwick server status                    # the agent is up, with the same applications
docker compose stop agent
docker run --rm -v shipwick_agent-data:/data busybox rm /data/encryption.key
docker compose start agent
```

The agent proves the key at every start, so a wrong value in the variable is caught at the `up -d`, while the file is still there to fall back to. With the package, the file is `/var/lib/shipwick/encryption.key` on the host.

## What it does to a reboot

The agent needs the key at every start, and after a reboot the applications need the agent. Docker's own restart policy is turned off on every container Shipwick creates, because restarts are the supervisor's; after a reboot Docker starts the agent and the proxy, and the agent starts the applications. If the agent cannot get its key, the applications stay down.

- **The fetch fails** — the manager is unreachable, the machine's credentials expired — and `ExecStartPre` exits non-zero: the unit fails, and systemd starts it again every five seconds (`Restart=on-failure`, `RestartSec=5`), fetching each time, until the manager answers. Under compose there is no fetch: a reboot starts the same container with the environment it was created with, `.env` or command line alike, which is the same fact as the key being in Docker's files. A key given on the command line is lost only when the container is recreated — `docker compose up -d` after an upgrade or a settings change — in a shell that does not have it; the agent then starts without a key, finds no key file, and stops with the mismatch message above, every time Docker restarts it.
- **The key is wrong** — the manager holds an old value, or another server's: the agent stops with the mismatch message. Nothing is changed; put the right value in the manager and start again.
- **The agent does not start** for either reason: the replicas that ran before the reboot are not started, `shipwick ps` is not answered, the dashboard cannot sign in, scheduled jobs and backups do not run. The proxy is up and serves static applications from its own volume, and answers for everything else with an error, since no replica carries its name.
- **The agent stops while the server stays up** is a different case: the applications keep running, as they do during an upgrade, and nothing restarts them until the agent is back.

So an unattended reboot is as unattended as the fetch. A manager reachable from the server without a person — a cloud secret store with an instance role, a Vault with AppRole or agent authentication — gives a reboot that needs nobody. One that needs a person to unseal or approve means a server that waits for that person after every reboot, with its applications down and nothing answering `shipwick ps` until then. Decide that before the first reboot, not after.

## What it does to backups

The key is never in the database. A backup of `shipwick.db` alone, from the volume or from a snapshot, is unreadable without the key, which is what this page sets out to get. Two consequences:

- **The agent's state backup carries the key it was given.** With `SHIPWICK_BACKUP_PASSPHRASE` set, the agent backs up `shipwick.db` and the key once a day, encrypted, under `_agent/` where application backups go, and `shipwick server backup` takes one now. The key goes into that backup from the agent's memory, whichever way it arrived, as `encryption.key.enc`. So the bucket together with the passphrase is a second place the key exists; keep the passphrase out of the bucket's account, and treat it as you treat the manager's credentials. See [The agent's own state](/docs/tasks/backups#the-agent-s-own-state).
- **Restoring puts the key back into the variable, not into a file.** On a new server, decrypt the two files with `shipwick backups decrypt`, copy `shipwick.db` into the data directory, and put the content of `encryption.key` into the secret manager — or `.env` — so that the agent is started with it; see [Bring a lost server back](/docs/tasks/restore-the-agent-state).

Without a passphrase the agent's state is not backed up at all, and `shipwick doctor` says `The encryption key exists only on this server`. With the key in a secret manager that line is no longer true, but `doctor` cannot know where the variable's value came from; the database still has no backup until the passphrase is set.

## What it does to rotation

`shipwick server rotate-key` re-encrypts every stored value under a new key while the agent runs, and then has to hand the new key to whoever sets the variable, because the agent cannot change its own environment. The command prints the key once:

```text
✓ Rotated the encryption key: 3 stored values and 12 deployments re-encrypted

    <64 hexadecimal characters>

The agent's key is set in its environment, which it cannot change. Put the new
key in /opt/shipwick/.env on the server before the agent restarts:

    SHIPWICK_ENCRYPTION_KEY=<64 hexadecimal characters>

With the old key there the agent refuses to start. Until it has started with the
new one it keeps a copy in /var/lib/shipwick/encryption.key.new, and removes it then.
```

With a secret manager, "put it in `.env`" means store the new value in the manager, then restart the agent; a drop-in that fetches at start picks it up by itself. Until that restart the agent holds a copy of the new key in `encryption.key.new`, in the data directory, so that a lost terminal does not lose the key — which is the one moment this arrangement has the key on the disk. Rotate and restart in one sitting. Started with the old value still in the manager, the agent refuses to start and names the file that holds the new key; a second rotation is refused until the agent has started with the new one. The dashboard shows the key the same way, once. The steps are under [Rotate the encryption key](/docs/tasks/rotate-the-encryption-key#rotate-a-key-set-in-shipwick-encryption-key).

## What's next

- [Where your data is](/docs/tasks/where-your-data-is): the key among everything else a server holds, for a questionnaire.
- [Rotate the encryption key](/docs/tasks/rotate-the-encryption-key): when, and what happens to earlier backups.
- [Bring a lost server back](/docs/tasks/restore-the-agent-state): the restore with the key in the variable.
- [Staging and production](/docs/tasks/staging-and-production#what-the-two-servers-must-not-share): one key per server.
