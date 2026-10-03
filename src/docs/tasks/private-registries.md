---
title: Pull from private registries
description: Give the Shipwick agent a credential for a private image registry with shipwick registry login.
---

# Pull from private registries

An image in a private registry needs a credential on the server. This page covers how to give the agent one with `shipwick registry login`, which exists since 0.5, what the agent does with it, what happens when a pull is refused, and the older way through `docker login` on the server, which still works.

If the image is built from a Dockerfile in your project, no registry is needed at all: with `build: .` in `deploy.yaml`, `shipwick deploy` builds the image on your machine and sends it to the server, and nothing below applies. See [`build`](/docs/reference/deploy-yaml#build). A registry stays the right tool when CI builds the image, or when the image is somebody else's.

## Log in

From wherever you run `shipwick`, with a token that has the `admin` role:

```bash
shipwick registry login ghcr.io --username octocat
```

```text
✓ Logged in to ghcr.io as octocat
  The server pulls images from ghcr.io with this credential from now on.
```

The password or token is asked for without echo. It is never an argument, because arguments leak through `ps` and shell history. In a script or a pipeline, pipe it in:

```bash
printf '%s' "$GHCR_TOKEN" | shipwick registry login ghcr.io --username octocat
```

Outside a terminal the password is read from standard input by itself; `--password-stdin` is accepted for those used to Docker's flag, and reads it from there even in a terminal.

The registry is named the way image references name it: `ghcr.io`, `registry.example.com:5000`, `docker.io` for Docker Hub. There is nothing to put in `deploy.yaml`. The image reference is enough:

```yaml
image: ghcr.io/company/my-api:1.4.2
```

Use a token that may only read. The server pulls images; it never pushes.

## What the agent does with it

Before it stores the credential, the agent has the Docker daemon check it against the registry. A mistyped token is refused at once, and not by the next deployment:

```text
Error: ghcr.io refused the login: denied: denied

Nothing was stored. Check the username and the token, and that the token may read images; then log in again.
```

The first line ends with the registry's own answer. A registry that cannot be asked, because its name does not resolve or it does not answer within 30 seconds, is refused the same way, with `Check the registry's name, and that the server can reach it.`

An accepted credential is kept in the agent's database with the password encrypted, like a secret; see [Secrets at rest](/docs/security#secrets-at-rest). The agent sends it with every pull from that registry: deployments, rollbacks, scheduled jobs and one-off commands, and a replica whose image was pruned from the server.

Nobody reads the password back. The list shows registries and usernames, and needs only the `read` role:

```bash
shipwick registry ls
```

```text
REGISTRY   USERNAME   UPDATED
ghcr.io    octocat    2h ago
```

Logging in again replaces the credential. To remove it:

```bash
shipwick registry logout ghcr.io
```

```text
✓ Logged out of ghcr.io
  Running applications are not affected; the server pulls from there without this credential from now on.
```

Up to 50 registries can be stored.

## When a pull is refused

A deployment whose image cannot be pulled fails before anything is started, and the running version is not affected. When the registry refused the pull for want of a credential, the reason names the command to run:

```text
✗ Deployment failed

  pull access denied for ghcr.io/company/my-api: run shipwick registry login ghcr.io (or check the image name)
```

Registries answer the same way for an image that does not exist as for one you may not see, which is why the image name is worth a look too. When a credential is stored and the registry refuses it for this image, the reason says so instead:

```text
  pull access denied for ghcr.io/company/my-api: the credential stored for ghcr.io does not give access to it; replace it with shipwick registry login ghcr.io (or check the image name)
```

One exception: if the pull fails but the image already exists on the server — it was built there, or pulled earlier — the agent uses the local copy and records a warning with the deployment:

```text
! Could not pull ghcr.io/company/my-api:1.4.2, using the local copy (…)
```

## The alternative: docker login on the server

For a registry without a stored credential, the agent reads the Docker CLI's configuration file, as it did before `registry login` existed. A stored credential takes precedence over it.

The file is `~/.docker/config.json`, in the home directory of the user the agent runs as. The standard `DOCKER_CONFIG` variable is honored: if it is set, the agent reads `config.json` from that directory instead. On the server, as root:

```bash
docker login ghcr.io
```

In the installer's setup the agent runs in a container, and the file on the host has to be mounted into it. Add the mount in `/opt/shipwick/compose.override.yml` (create the file if it does not exist). Compose merges it with `compose.yml`, and unlike `compose.yml` it is never replaced by an [upgrade](/docs/tasks/upgrade):

```yaml
services:
  agent:
    volumes:
      - /root/.docker/config.json:/root/.docker/config.json:ro
```

Then recreate the agent:

```bash
cd /opt/shipwick && docker compose up -d
```

Run `docker login` before you start the agent with this mount, so that the file exists. Recreating the agent does not restart your applications.

## Credential helpers are not supported

Only a username with a password or token works, in both ways. Credential helpers (`credsStore` in the Docker configuration, `docker-credential-*` programs) are not supported: a helper is a program on the server, which the agent's container does not have, and the agent executes nothing.

If `docker login` wrote a `credsStore` key and left the entry under `auths` empty, the credential went to a helper, and the agent cannot use it. Use `shipwick registry login` instead.

For registries whose tokens expire within hours, renew the credential with `shipwick registry login` from a scheduled job of your own.

## What's next

- [Deploy from CI](/docs/tasks/deploy-from-ci), where images usually come from a private registry.
- [Security](/docs/security#secrets-at-rest), for how stored credentials are encrypted, and [Rotate the encryption key](/docs/tasks/rotate-the-encryption-key).
- [`shipwick registry`](/docs/reference/cli#registry) in the CLI reference.
- [Use the dashboard](/docs/tasks/dashboard): the Registries page does the same from a browser.
