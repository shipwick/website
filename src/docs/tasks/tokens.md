---
title: Create tokens for CI and teammates
description: Give CI a token that can deploy but not delete, give a teammate one that can only look, see when each token was last used, revoke one, and find out who did what.
---

# Create tokens for CI and teammates

The token the installer printed is the root token, and it can do everything. Nobody else needs that much. This page shows the three roles a token can have, how to create a token for CI or a teammate, how to use it from a pipeline, a laptop and the dashboard, what a token with too small a role is told, how to see when each token was last used and revoke one, and how Shipwick records who did what.

## Before you begin

- Managing tokens needs the `admin` role: the root token, or a token created with `--role admin`.
- The agent must be 0.3.0 or later. An older agent has one token and no roles; `shipwick token` against it answers `The agent does not know this operation — it is probably older than this shipwick.`

## The three roles

Every endpoint of the API requires a role, and a role includes the ones below it:

| Role | May |
|---|---|
| `read` | See everything: applications, deployments and their history, logs, events, metrics, jobs and runs, volumes, the names of the secrets, the server |
| `deploy` | And change what runs: deploy, redeploy, roll back, stop, start, run a job or a command, send an image or a static folder |
| `admin` | And everything else: delete applications, download and restore volume backups, remove the volume of a deleted application, store and remove secrets, create, list and revoke tokens |

Give CI a `deploy` token: a pipeline deploys and rolls back, and never needs to delete an application. Give people `admin` tokens, and someone who only watches a `read` one.

::: warning admin is root on the server
The agent holds the Docker socket, and whoever can submit a `deploy.yaml` can run any image on the server. A `deploy` token is already that; an `admin` token can also delete applications and mint more tokens. Roles limit what a token may ask of the agent, not what the server can be made to do. See [Security](/docs/security).
:::

## The root token

The token the agent is configured with, `SHIPWICK_AGENT_TOKEN` in `/opt/shipwick/.env` or the one the agent generated on its first start, is the **root** token. It has the `admin` role and the name `root`, is not stored in the database, does not appear in `shipwick token ls`, and cannot be revoked through the API: to change it, set a new `SHIPWICK_AGENT_TOKEN` on the agent and restart it. Keep it for yourself, and create the others from it.

## Create a token

```bash
shipwick token create ci --role deploy
```

```text
✓ Created token ci with the deploy role

    swk_Xk3nM9…

Store it now: it will not be shown again.
In CI, set SHIPWICK_AGENT_TOKEN to it. On a machine you work from, save it with: shipwick login
```

The value is shown once. The agent keeps only its SHA-256 hash, so it cannot be shown again; a lost token is revoked and replaced. The `swk_` prefix is not part of the secret: it exists so that a token is recognisable where it must not be, in a log or a repository.

| | |
|---|---|
| Name | Lowercase letters, digits and dashes, at most 40 characters; `root` is taken. A name that exists is refused: `a token with this name already exists`. |
| `--role` | `read`, `deploy` or `admin`. Required: `choose what the token may do: --role read, deploy or admin`. |

Name tokens after what uses them, `ci`, `github-actions`, `alice`, so that `token ls` and the history read well.

## Use a token from CI

A pipeline needs no `shipwick login`. Put the agent's URL and the token in the CI system's secret store and expose them as environment variables:

```yaml
env:
  SHIPWICK_AGENT_URL: ${{ secrets.SHIPWICK_AGENT_URL }}
  SHIPWICK_AGENT_TOKEN: ${{ secrets.SHIPWICK_AGENT_TOKEN }}
```

`shipwick` never accepts the token as a flag. The whole pipeline is in [Deploy from CI](/docs/tasks/deploy-from-ci).

## Use a token from a laptop

```bash
shipwick login --url https://agent.example.com
```

```text
API token:
✓ Logged in to https://agent.example.com (vps-1, agent v0.4.1)
  saved as context default in /home/me/.config/shipwick/config.yaml
```

The token is asked for without echo, verified against the agent, and saved in a file only you can read. `shipwick server status` then says which token you are:

```text
Token           ci (deploy)
```

The same field is `token: {"name": "ci", "role": "deploy"}` in `GET /server`.

## When the role is too small

A token asked to do more than its role allows is told which role it has and which one it needs. From `shipwick`:

```text
This token may not do that: it has the read role.

Use a token with the deploy role, or create one with: shipwick token create <name> --role deploy
```

From the API, `403 FORBIDDEN`:

```json
{ "error": { "code": "FORBIDDEN",
             "message": "this token has the read role; deploying needs deploy or admin",
             "details": { "role": "read", "required": "deploy" } } }
```

A wrong or revoked token is `401 UNAUTHORIZED` instead, `The agent rejected the API token.` from `shipwick`. Guessing is slowed down: after 20 failed authentications within a minute from one address, the agent answers wrong tokens from it with `429 RATE_LIMITED` for the next minute (`Too many failed attempts from this address; try again in a minute.` from `shipwick`). A valid token is never refused, so nobody with the right token is locked out, and only failures count.

## In the dashboard

Anyone signs in to the dashboard with a token, and the dashboard becomes that token. The sidebar shows its name and role. Controls the role does not cover are disabled with the reason: a `read` token cannot deploy, redeploy, roll back, stop or start; only `admin` can delete an application, download or restore a backup, store or remove a secret, remove the volume of a deleted application, or open the Tokens page, where tokens are created, listed and revoked, the new token's value shown once in the page. Whatever the page shows, the agent enforces the roles: a request the role does not cover is answered `403` however it was made. See [Use the dashboard](/docs/tasks/dashboard).

## See which tokens are in use

```bash
shipwick token ls
```

```text
NAME    ROLE    CREATED  LAST USED
ci      deploy  3d ago   4m ago
alice   admin   3d ago   2h ago
viewer  read    1d ago   never
```

`LAST USED` says whether a token is still in use, not what it did last: it is recorded to the minute, and is `never` until the token's first request. The root token is not listed, because it is configured on the agent rather than stored. Without any token besides root, the command says so and shows the line to create one.

## Revoke a token

```bash
shipwick token revoke ci
```

```text
This revokes token ci: whatever uses it is refused from now on.
Type the token name to confirm: ci
✓ Revoked token ci
```

Requests with the token are `401` from then on; a pipeline that still carries it fails at its next `shipwick deploy`. Outside a terminal, pass `--yes`. A token may revoke itself. `shipwick token revoke root` is refused with `the root token is the one the agent is configured with; change SHIPWICK_AGENT_TOKEN on the agent instead`, and an unknown name with `there is no token named ci`.

## Who did what

- **Deployments record the token that started them**: `by` on every deployment in the API, `"root"` for the agent's own token, shown in the dashboard's deployment history. Deployments made before the agent had named tokens carry no `by`.
- **Stops and starts by a token other than root name it** in the application's event feed: `Application stopped by ci`. An operation by the root token reads `Application stopped`; on a server with one token, "by root" would say nothing.
- **`GET /server` names the caller**, so a script can check which token it runs as before it acts.

## What's next

- [Deploy from CI](/docs/tasks/deploy-from-ci) with a `deploy` token.
- [`shipwick token`](/docs/reference/cli#token) in the CLI reference, and [Tokens](/docs/reference/api#tokens) in the API reference.
- [Security](/docs/security): the trust model behind the roles.
