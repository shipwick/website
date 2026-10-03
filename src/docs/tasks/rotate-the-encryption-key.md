---
title: Rotate the encryption key
description: Replace the key the agent encrypts stored secrets with, using shipwick server rotate-key or the dashboard, when the key is a file in the data directory and when it is set in SHIPWICK_ENCRYPTION_KEY, and what to do with backups made under the old key.
---

# Rotate the encryption key

The agent encrypts every secret it stores with one key. This page shows when to replace that key, what `shipwick server rotate-key` does, the two cases — the key as a file in the data directory, and the key in `SHIPWICK_ENCRYPTION_KEY` — and what the rotation means for backups made before it.

## Before you begin

- Rotating the key needs the `admin` role: the root token, or a token created with `--role admin`.
- The agent must be 0.5 or later. An older one is told apart: `the agent is older than this shipwick and cannot rotate its key`, with `Compare versions with: shipwick server status`.
- Know where the agent's key is. With the installer's setup it is the file `encryption.key` in the agent's data directory, the `agent-data` volume. It is in the agent's environment only if you set `SHIPWICK_ENCRYPTION_KEY` yourself. See [`SHIPWICK_ENCRYPTION_KEY`](/docs/reference/agent-configuration#shipwick-encryption-key).

## When to rotate

Rotate when the key may have been seen: a backup that held it went astray, or someone who had access to the server has left.

Rotation protects what is written from now on. A copy of the old database together with the old key stays readable, so a secret that may have leaked with them has to be changed where it is used as well: the database password at the database, the API key at its provider.

## What a rotation does

The running agent generates a new key and re-encrypts every stored value under it, in one transaction: the `env` values and basic-auth passwords of every deployment record, the secrets stored with `shipwick secret set`, the registry passwords stored with `shipwick registry login` and the keys of supplied certificates. It then carries on with the new key.

- **Nothing is deployed and nothing restarts.** No application is touched, and the agent keeps serving.
- **A crash at any point leaves a database and a key that fit.** The new key is written next to the key file, as `encryption.key.new`, before the database is touched, and moved into place afterwards. If the agent stops in between, its next start tries which of the two keys opens the data and finishes or discards what was interrupted.
- **The agent's log records the rotation and the token that asked for it, never a key.**

## Rotate a key kept in the data directory

This is the default. Run:

```bash
shipwick server rotate-key
```

```text
✓ Rotated the encryption key: 3 stored values and 12 deployments re-encrypted
  The new key is in /var/lib/shipwick/encryption.key on the server. Back it up: database backups made from now on need it, earlier ones the old key.
```

The first number counts the re-encrypted secrets, registry passwords and certificate keys, the second the deployment records. The agent has replaced `encryption.key`, and there is nothing else to do on the server.

In the dashboard, the same is **Rotate encryption key** on the server page, for a token with the `admin` role.

## Rotate a key set in SHIPWICK_ENCRYPTION_KEY

With the key in its environment the agent cannot finish the job: it cannot change the environment it will be started with next. The command prints the new key, once, for you to put there:

```text
✓ Rotated the encryption key: 3 stored values and 12 deployments re-encrypted

    <64 hexadecimal characters>

The agent's key is set in its environment, which it cannot change. Put the new
key in /opt/shipwick/.env on the server before the agent restarts:

    SHIPWICK_ENCRYPTION_KEY=<64 hexadecimal characters>

With the old key there the agent refuses to start. Until it has started with the
new one it keeps a copy in /var/lib/shipwick/encryption.key.new, and removes it then.
```

1. Replace the value of `SHIPWICK_ENCRYPTION_KEY` where you set it: `/opt/shipwick/.env`, as the command says, or wherever else the agent's environment comes from, a secrets manager for instance.
2. Restart the agent so that it starts with the new key:
   ```bash
   cd /opt/shipwick && docker compose up -d
   ```
   Applications keep running while the agent restarts.

Until that restart the agent keeps working with the new key, and holds a copy of it in `encryption.key.new` in its data directory, so that a lost terminal does not lose the key. Started with the new key, the agent removes the copy.

::: warning Until the restart, the key is next to the database
For as long as `encryption.key.new` exists, the data directory holds the key next to the database, which is what setting the variable was meant to avoid. Put the new key in place and restart the agent soon after rotating.
:::

If the agent is started with the old key still in its environment, it refuses to start and says exactly that, and where the new key is. The message begins `the encryption key was rotated, and SHIPWICK_ENCRYPTION_KEY still holds the old one: the new key is in /var/lib/shipwick/encryption.key.new`. Take the key from that file, put it in the variable and start the agent again.

A second rotation is refused until the agent has been restarted with the new key:

```text
The key was already rotated, and the agent has not been restarted with the new one.

Put the key from /var/lib/shipwick/encryption.key.new on the server into /opt/shipwick/.env as SHIPWICK_ENCRYPTION_KEY,
restart the agent, then rotate again.
```

The dashboard shows the new key the same way, once, with the line to put into `/opt/shipwick/.env`. Copy it before you leave the page.

## Backups and the old key

- **Back up the new key.** A backup of `shipwick.db` made from now on is readable only with it.
- **Earlier backups of the database still need the old key.** If you may have to go back to one, keep the old key with it, somewhere that is not the server; if the old key is what leaked, such a backup is what leaked with it, and keeping it protects nothing.
- **The agent's own backups carry the key they need.** With `SHIPWICK_BACKUP_PASSPHRASE` set, the agent backs up `shipwick.db` and `encryption.key` together, encrypted, once a day. A state backup taken before the rotation holds the old database with the old key; `shipwick server backup` takes one of the new pair now.
- **The backup passphrase is a different secret.** Rotating the encryption key does not change `SHIPWICK_BACKUP_PASSPHRASE`, and backups of volumes are not re-encrypted.

## What's next

- [Security](/docs/security#key-rotation): what the key protects, and what it does not.
- [`shipwick server rotate-key`](/docs/reference/cli#server-rotate-key) in the CLI reference, and [`POST /server/rotate-key`](/docs/reference/api) in the API reference.
- [Back up and restore volumes](/docs/tasks/backups), including the agent's own state.
- [Create tokens for CI and teammates](/docs/tasks/tokens): the root token is a different credential, and is changed by setting a new `SHIPWICK_AGENT_TOKEN`.
