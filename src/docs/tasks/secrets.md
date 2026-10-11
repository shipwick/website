---
title: Keep secrets on the server
description: Store a password or an API key on the Shipwick server once with shipwick secret set, for one application or for the whole server, refer to it as ${NAME} in deploy.yaml, know which secret answers when both exist, choose a value that survives a connection string, and remove one.
---

# Keep secrets on the server

A value that must not be in `deploy.yaml` — a database password, an API key — is written there as `${NAME}` and stored on the server once, so that no laptop and no pipeline has to hold it. This page shows how to store a secret for one application or for the whole server, which one answers when both exist, what a value that goes into a connection string must not contain, and how to list and remove secrets.

## Before you begin

- Storing and removing a secret needs the `admin` role; listing them needs `read`. Values are asked for without echo or piped in, never given as an argument.
- The other place a `${NAME}` can be filled in is where `shipwick` runs, from its environment or an `--env-file`; see [Placeholders](/docs/reference/cli#placeholders). This page is about the server's side.
- Secrets of one application need an agent of 0.9 or later; an older agent keeps one list for the whole server, and `shipwick secret set --app` against it stores nothing and says so.

## Store a secret

```yaml
env:
  DATABASE_URL: postgres://app:${DATABASE_PASSWORD}@postgres:5432/app
```

```bash
shipwick secret set DATABASE_PASSWORD --app my-api   # asks for the value without echo; or pipe it in
```

```text
Value for DATABASE_PASSWORD:
✓ Stored secret DATABASE_PASSWORD for my-api
  ${DATABASE_PASSWORD} in my-api's deploy.yaml resolves to it from the next deployment on, before a server-wide DATABASE_PASSWORD; other applications do not see it.
```

A secret belongs to one application or to the whole server, since 0.9. `--app my-api` stores it for `my-api` alone: only `my-api`'s `${DATABASE_PASSWORD}` resolves to it, and a second application can have a `DATABASE_PASSWORD` of its own. Without `--app` the secret is the server's, which every application without one of its own falls back to, as every secret was before 0.9.

Store what an application owns — its database password, its session key, the API key of a service only it talks to — with `--app`; store what several applications share — a registry login, the key of a mail provider they all send through — once, for the server. The application need not exist yet: its secrets are stored first and its first deployment finds them.

In a script, pipe the value in, or read it from a file:

```bash
printf '%s' "$DATABASE_PASSWORD" | shipwick secret set DATABASE_PASSWORD --app my-api
shipwick secret set TLS_KEY --from-file key.pem
```

The agent fills the value into the `env` values of a deployment when the deployment is recorded, so the record holds the value, and a rollback restores what that deployment ran with, whichever scope it came from. A changed secret applies from the next deployment on; running containers keep the value they were started with. A `${NAME}` that is set neither where `shipwick` runs nor on the server, by the application or the server, refuses the deployment before anything is recorded, with `shipwick secret set NAME` as what to run.

## A password that goes into a URL

A secret written into a connection string — `postgres://app:${DATABASE_PASSWORD}@postgres:5432/app` — is read by the application as part of a URL, where `@`, `:`, `/`, `?`, `#`, `%` and whitespace mean something and are not the password any more; the connection fails, and nothing says why until then. Letters, digits, `-`, `_`, `.` and `~` are safe anywhere in a URL. `shipwick secret set` stores a value with other characters all the same, and warns which ones it saw, never the value:

```text
! this value has characters a URL cannot carry unescaped (@, /); if it goes into a connection string, use another
```

For a password you choose yourself, make one that is safe:

```bash
openssl rand -hex 24 | shipwick secret set DATABASE_PASSWORD --app my-api
```

## List and remove

```bash
shipwick secret ls
```

```text
NAME               SCOPE    CREATED  UPDATED
DATABASE_PASSWORD  server   3d ago   3d ago
DATABASE_PASSWORD  my-api   2h ago   2h ago
STRIPE_KEY         my-api   3d ago   3d ago
```

Names, scopes and dates, never values: the value goes into containers and nowhere else, and nobody reads it back. `SCOPE` is `server` or the application's name; a server-wide secret and the applications' of the same name sit together, the server's first.

```bash
shipwick secret rm DATABASE_PASSWORD --app my-api   # my-api's own; a server-wide one answers from the next deployment on
shipwick secret rm DATABASE_PASSWORD                # the server's; applications with one of their own keep it
```

```text
✓ Removed secret DATABASE_PASSWORD
  The DATABASE_PASSWORD of my-api stays: ${DATABASE_PASSWORD} is unchanged there.
```

Both ask first; `--yes` skips the question. Deployments already made keep the value they were started with; the next `deploy` whose `env` refers to a name that neither the application nor the server has is refused, with the command to store it again.

## The dashboard and the API

The dashboard's Secrets page stores, replaces and removes the server's secrets; the value is cleared from the page as soon as the request is sent. Through the API, `application` is a field of the body of `PUT /secrets/:name`, a query parameter of `DELETE /secrets/:name` and a field of every entry of `GET /secrets`, `""` for the server's; see [`GET /secrets`](/docs/reference/api#get-secrets) in the API reference.

## What's next

- [Deploy from CI](/docs/tasks/deploy-from-ci#supply-secrets-with): the pipeline's side of `${NAME}`.
- [Security](/docs/security#secrets-kept-on-the-server): how a secret is encrypted, bound to its name and scope, and never shown again.
- [Get deploy.yaml back from the server](/docs/tasks/get-the-configuration-back): what `shipwick config` gives back in place of a value.
- [`shipwick secret`](/docs/reference/cli#secret) in the CLI reference.
