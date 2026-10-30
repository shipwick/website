---
title: Where your data is
description: For whoever answers a security questionnaire - what a Shipwick server stores and where, what is encrypted at rest and with which key, what leaves the server, what a backup and an export contain, who can read what, what is logged and for how long, and how tokens and sessions are kept.
---

# Where your data is

This page is for whoever has to answer a security questionnaire about a Shipwick server: what the agent stores and where, what is encrypted and with which key, what leaves the server, what a backup and an export contain, who can read what, and what is logged for how long. Each section points at the page where the behaviour is described in full. Nothing here is a promise beyond what those pages say; where a limit exists, it is named.

The short version: everything the agent knows is in one directory on the server, `/var/lib/shipwick`; every secret in it is encrypted with a key that is not in the database; the application's own data is in Docker volumes; nothing leaves the server unasked except one request a day to GitHub that carries no information about the server, and that can be switched off.

## Before you begin

- The layout below is the installer's: the agent, the proxy and the dashboard as containers under `/opt/shipwick`, with the agent's data in the Docker volume `shipwick_agent-data`. An agent installed [from a package](/docs/getting-started/install-from-a-package) runs as a host process with the same data directory and its settings in `/etc/shipwick/agent.env`; the proxy and the dashboard are containers there as well.
- The agent drives Docker — since 1.1 through a socket proxy, which passes a request to create a container all the same. Whoever is root on the server, or holds an `admin` token, can read everything described here, in clear; see [Security](/docs/security#trust-model). The protections below are about copies: a backup, a snapshot, a disk, a file that left the server.

## What is stored on the server, and where

| Where | What | Mode |
|---|---|---|
| `/opt/shipwick/.env` | The agent's settings: the root token (`SHIPWICK_AGENT_TOKEN`), the hostnames, and whatever else you set — the backup passphrase, the bucket's keys, a Cloudflare API token, a webhook URL, the sign-in provider's client secret. In clear: it is the agent's environment | `0600` |
| `/var/lib/shipwick/shipwick.db` | The agent's database: applications, every deployment with its full configuration, replicas, events, job runs, metric and traffic samples, the stored secrets, registry credentials and supplied certificates, the record of every backup, the hashes of the created tokens, the audit trail, the sign-in rules and sessions, the index of the log archive. Secret values in it are encrypted; see below | in a directory of mode `0700` |
| `/var/lib/shipwick/encryption.key` | The key the secret values are encrypted with, 64 hexadecimal characters. Absent when the key is given as `SHIPWICK_ENCRYPTION_KEY` instead | `0600` |
| `/var/lib/shipwick/backups/` | The backups the agent takes, unless `SHIPWICK_BACKUP_DIR` names another directory: an application's volumes under `<application>/<id>/`, the agent's own state under `_agent/`, exports under `_export/`. Plain tar files without a passphrase, `.enc` files with one | |
| `/var/lib/shipwick/logs/` | The log archive: what each container printed before it ended, one gzip file per kept run. Not encrypted, like the logs Docker keeps | |
| `/var/lib/shipwick/uploads/` | The folders of static applications, until they are deployed | |
| `/var/lib/shipwick/agent-token.sha256`, `update-check.json`, `encryption.key.new` | The hash of a root token the agent generated itself; what it last learned about releases; the new key while a rotation is settled | |
| Docker volumes `shipwick_<application>_<volume>` | The applications' own data, under Docker's directory, `/var/lib/docker/volumes` by default. Shipwick does not encrypt them; a backup of them can be | Docker's |
| The proxy's volumes `shipwick_caddy-data`, `shipwick_caddy-config`, `shipwick_caddy-static` | Caddy's own storage: the certificates it obtained, with their private keys; its autosaved configuration, which carries the Cloudflare API token and the keys of certificates you supplied; the files of static applications | Docker's; mounted by Caddy alone |
| Docker's container directories | For every container, its configuration — the environment in clear, as `docker inspect` shows it — and its log, capped at three files of 10 MB. The agent's, the proxy's and the dashboard's logs are kept the same way | Docker's |

The complete list of the data directory, file by file, is under [Data directory](/docs/reference/agent-configuration#data-directory); the tables of the database under [What is stored](/docs/concepts/overview#what-is-stored). Where an application's volume is on the server is under [Where the data lives](/docs/tasks/stateful-applications#where-the-data-lives).

## What is encrypted at rest, and with which key

Two keys exist, for two different things.

**The encryption key** protects secret values in the database. It is 32 random bytes, in `encryption.key` next to the database or in `SHIPWICK_ENCRYPTION_KEY`, never in the database itself, so a copy of `shipwick.db` alone reveals no secret. The scheme is AES-256-GCM with a fresh random nonce per value and the value's name as additional authenticated data, so a ciphertext moved to another variable, another secret or another deployment does not decrypt. What is sealed with it:

| Sealed | Bound to |
|---|---|
| The `env` values of every deployment, the passwords of its `proxy.basic_auth` entries and, since 0.10, its `logging.options.splunk-token` | The variable's name; the password's position; the option's name |
| The secrets stored with `shipwick secret set`, for the server or for one application | The secret's name and scope |
| The passwords stored with `shipwick registry login` | The registry |
| The private keys of certificates supplied with `shipwick cert set` | The hostname |
| The references of a deployment: which of its values were `${NAME}` placeholders, as the document wrote them | The deployment |

Everything else in the database is readable: names, images, hostnames, the names of variables, the history, the audit trail, the hashes of tokens. The agent proves the key against the stored values at every start and refuses to start with one that does not fit. The key can be rotated while the agent runs, and a copy of the database taken before a rotation opens with the key of that time. See [Secrets at rest](/docs/security#secrets-at-rest), [`SHIPWICK_ENCRYPTION_KEY`](/docs/reference/agent-configuration#shipwick-encryption-key) and [Keep the encryption key off the server's disk](/docs/tasks/key-off-the-disk).

**The backup passphrase**, `SHIPWICK_BACKUP_PASSPHRASE`, protects what leaves the data directory as a file: backups and exports. A key is derived from it with PBKDF2-HMAC-SHA256 and a random salt per file, and the file is encrypted with AES-256-GCM before it reaches the disk or the bucket. Truncating or altering such a file is detected when it is read. Without a passphrase, application backups are plain tar files and the agent's own state is not backed up at all, so that the key is never written anywhere in clear. See [Backups and exports](/docs/security#backups-and-exports).

Not encrypted by Shipwick, and worth saying so on a questionnaire: the applications' volumes; the log archive and Docker's logs, which hold whatever the applications printed; the environment of running containers, which is in clear inside them and in Docker's files; Caddy's certificate store; and the settings file, `/opt/shipwick/.env`, which holds the root token and the passphrase itself. The disk they are on is yours to encrypt.

## What leaves the server

Unasked, one thing: once a day the agent sends a `HEAD` request to `https://github.com/shipwick/shipwick/releases/latest` to learn whether a newer release exists. It carries no body, no query, no cookie, and a `User-Agent` of `shipwick-agent` without a version: GitHub learns the address the request came from, and that a Shipwick agent runs behind it, and nothing else. `SHIPWICK_UPDATE_CHECK=off` stops it, and the agent says at startup, once, that it asks and how to stop it. See [What leaves the server unasked](/docs/security#what-leaves-the-server-unasked).

Everything else leaves because a setting says so:

| To | What | When |
|---|---|---|
| The webhook URL (`SHIPWICK_WEBHOOK_URL`) | Deployment outcomes and applications going down or recovering: the application's name, the version, the outcome. Signed with `SHIPWICK_WEBHOOK_SECRET` when set | Each event |
| The S3 bucket (`SHIPWICK_BACKUP_S3_*`) | Backups and exports, encrypted with the passphrase before they are sent | On the schedules you set |
| The certificate authority (`SHIPWICK_ACME_DIRECTORY`, Let's Encrypt by default) | The hostnames you serve, for their certificates | When a certificate is needed or renewed |
| Cloudflare's API (`SHIPWICK_CLOUDFLARE_API_TOKEN`) | DNS records for the certificate challenge; and a check of what the token may do, when the agent starts and when `shipwick doctor` asks, at most once a minute | Only with the token set |
| The sign-in provider (`SHIPWICK_OIDC_*`) | The sign-in itself; the client secret goes to the provider's token endpoint and nowhere else | Each sign-in |
| The registries your images name | Image pulls, with the stored credential for that registry | Deployments, rollbacks, jobs |
| The resolvers of `SHIPWICK_DNS_RESOLVERS`, public ones by default | Whether a hostname points at the server | When a certificate has not arrived and the agent says why |

An outbound proxy, when the server has one, carries all of it; see [Run behind a corporate proxy or without internet](/docs/tasks/corporate-network). The CLI asks GitHub for the latest release only when you run `shipwick upgrade`, `shipwick doctor` or `shipwick server bundle`. The dashboard makes no request to any third party, and the browser never talks to the agent: the dashboard's own server relays.

## What a backup and an export contain

| | A backup of an application | A backup of the agent's state | An export |
|---|---|---|---|
| Holds | One tar archive per volume of the application | `shipwick.db` and `encryption.key`, a consistent copy of the database and the key to it | Every application's active configuration with its `env` values and basic-auth passwords in clear, the stored secrets, registry credentials and certificates with their keys, the images that exist only on the server, the folders of static applications, and an archive of every volume |
| Does not hold | Anything of the agent | The applications' volumes, the log archive | Deployment history, metrics, events, archived logs, API tokens, the audit trail, access rules, sessions, backups |
| Encrypted | With the passphrase, when one is set | Always: without a passphrase it is not taken | Always, with the passphrase you give the command or with `SHIPWICK_BACKUP_PASSPHRASE` for an export on a schedule |
| Kept | On the server and, with a bucket, in it; the oldest beyond `keep` removed | Seven, daily, where application backups go, under `_agent/` | Where you wrote it, or where backups go, `SHIPWICK_EXPORT_KEEP` of them |
| Needs | `deploy` to take and verify; `admin` to download, restore or remove | `admin` | `admin` |

The export is the file to think about on a questionnaire: it is the one artefact that holds every secret of the server at once, in clear inside its encryption, and it is written only on an `admin`'s request or a schedule an `admin` set. The encryption key itself does not travel in it: the values are sealed again with the new server's key on import. See [What an export holds](/docs/tasks/move-to-a-new-server#what-an-export-holds), [The agent's own state](/docs/tasks/backups#the-agent-s-own-state) and [Backups and exports](/docs/security#backups-and-exports).

## Who can read what

Every API request except the health check is authenticated. A caller is a token with a role, or a person who signed in through your identity provider and was given a role by a rule. A role includes the ones below it:

| Role | Reads | Changes |
|---|---|---|
| `read` | Everything: the server, the applications and their configuration with `env` values masked, deployments, logs and the log archive, events, metrics and traffic, the backups taken, the names of secrets, the registries a credential is stored for, the certificates without their keys | Nothing |
| `deploy` | The same, and the `deploy.yaml` of an application back from the server, with the values that were written in plain sight in it | Deploys, redeploys, rollbacks, stop and start, commands and jobs, image and folder uploads, taking and verifying backups. Can be limited to named applications and given an end |
| `admin` | Everything, the audit trail included | Everything else: delete applications, manage tokens, secrets, registry credentials, certificates and sign-in rules, rotate the key, download, restore and remove backups and volumes, back up the agent's state, export and import |

What no role reads back: the value of a secret, a registry password, a certificate's key, a backup passphrase, a token once it was shown. `env` values are masked as `********` in every response, with the one exception the `deploy` row names, which exists so that a lost `deploy.yaml` can be had again; see [Get deploy.yaml back from the server](/docs/tasks/get-the-configuration-back). A limit on a `deploy` token narrows what it can change, not what it reads: one Docker daemon does not separate tenants, and Shipwick does not promise it; see [What Shipwick does not do yet](/docs/security#what-shipwick-does-not-do-yet).

The root token, the one in `/opt/shipwick/.env`, is `admin` and is equivalent to root on the server. See [The three roles](/docs/tasks/tokens#the-three-roles) and [Sign in with your company's accounts](/docs/tasks/sign-in).

## What is logged, and for how long

| Record | Holds | Does not hold | Kept |
|---|---|---|---|
| The agent's log | What the agent did; for each request its method, path, status, duration and remote address | Tokens, `Authorization` headers, request bodies, `env` values, query strings | By Docker: three files of 10 MB per container; with the package, the journal |
| The audit trail | For every request that changed something, or was refused: who (the token's or person's name), when, from where, what it was about, and the outcome. Sign-ins too | Anything from a request's body except names: no `env`, no value, no command, no passphrase | A year, and at most 100,000 entries, in the database; travels with its backups |
| The proxy's access log | Time, hostname, method, path, status, duration, size and client address of each request to an application | Headers, query strings, TLS details, the remote port; and no request to the agent's or the dashboard's hostname at all | Docker's three files of 10 MB for the Caddy container |
| Traffic | Per-minute counts and a latency histogram per application; the last 200 requests of each application | Bodies, headers | Seven days in the database; the 200 requests in memory only |
| Metrics | CPU and memory per replica | | Seven days, one sample every 30 seconds |
| Events | The supervisor's commentary per application: restarts, health, alerts, stops by name | | The newest 500 per application |
| Job runs | The last 200 lines of each run's output | | The last 50 runs per job |
| The log archive | What a container printed before it ended, as the application printed it | | 14 days after the container ended (`SHIPWICK_LOG_RETENTION_DAYS`), within 1 GB (`SHIPWICK_LOG_RETENTION_SIZE`); not encrypted; not in backups or exports |

The one record whose contents Shipwick cannot vouch for is the log archive, and the replica logs it is made from: an application that prints a secret has it there for as long as the archive keeps the entry. See [Nothing secret in logs or responses](/docs/security#nothing-secret-in-logs-or-responses), [See who changed what](/docs/tasks/audit#what-is-recorded), [What the proxy logs](/docs/security#what-the-proxy-logs) and [Where it is, and where it is not](/docs/tasks/find-out-why-it-died#where-it-is-and-where-it-is-not).

## Tokens and sessions

- **Tokens are stored as SHA-256 hashes**, in memory and in the database, and compared in constant time. A created token is shown once; the agent cannot show it again. Its name, role, application limit and end are stored in clear next to the hash. The root token is not in the database at all: the agent keeps its hash in memory, and in `agent-token.sha256` if it generated the token itself.
- **A token does not expire unless given an end** with `--expires`; the root token has none. A token is revoked at once with `shipwick token revoke`, and its end can be moved. Everything a token did stays in the audit trail under its name.
- **Guessing is slowed down**: after 20 failed authentications within a minute from one address, wrong tokens from it are answered `429` for a minute. A valid token is never refused.
- **The dashboard** keeps the token in an `httpOnly`, `SameSite=Strict` cookie, `Secure` over HTTPS, valid for 7 days; it never reaches the page's JavaScript, and the browser never talks to the agent.
- **A person who signed in** through the identity provider holds a session of ten hours, not extended by use, of which the agent stores the SHA-256 like a token's. The session rests on a rule; a rule revoked or changed ends the sessions that rested on it with their next request, and `shipwick access signout` ends one at once. What the agent cannot see is a change at the provider: an account disabled there keeps its session until it ends, ten hours at most. The provider's client secret is in the agent's environment, not in the database, and goes to the provider's token endpoint only.

See [Tokens and roles](/docs/security#tokens-and-roles), [Signing in through a provider](/docs/security#signing-in-through-a-provider) and [Session handling in the dashboard](/docs/security#session-handling-in-the-dashboard).

## What's next

- [Security](/docs/security): the trust model behind all of the above, and how to report a vulnerability.
- [Keep the encryption key off the server's disk](/docs/tasks/key-off-the-disk) when the questionnaire asks where the key is.
- [Back up and restore volumes](/docs/tasks/backups) and [Bring a lost server back](/docs/tasks/restore-the-agent-state): what a backup is good for.
- [Agent configuration](/docs/reference/agent-configuration): every variable named here.
