---
title: Pull from private registries
description: Give the Shipwick agent credentials for a private image registry with docker login on the server.
---

# Pull from private registries

Shipwick pulls images with the credentials that `docker login` stores on the server. This page covers where the agent looks for them, what it does not support, and the extra step needed when the agent runs in a container, as it does in the installer's setup.

## How it works

The agent pulls images through the Docker Engine API. Before each pull it reads the Docker CLI's configuration file, and if that file has an entry for the image's registry, it sends those credentials with the pull.

The file is `~/.docker/config.json`, in the home directory of the user the agent runs as. The standard `DOCKER_CONFIG` variable is honored: if it is set, the agent reads `config.json` from that directory instead.

There is nothing to put in `deploy.yaml`. The image reference is enough:

```yaml
image: ghcr.io/company/my-api:1.4.2
```

Credentials never pass through `deployctl` or the API.

## Log in on the server

On the server, as root:

```bash
docker login ghcr.io
```

Once per registry is enough. The agent reads the file each time it pulls an image.

## When the agent runs in a container

In the installer's setup the agent runs in a container, and its `~/.docker/config.json` is a path inside that container. The file on the host has to be mounted into it. Add the mount in `/opt/shipwick/compose.override.yml` (create the file if it does not exist). Compose merges it with `compose.yml`, and unlike `compose.yml` it is never replaced by an [upgrade](/docs/tasks/upgrade):

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

The agent runs as root inside its container, so `/root/.docker/config.json` is where it looks. The mount is read-only. Run `docker login` before you start the agent with this mount, so that the file exists. Recreating the agent does not restart your applications.

## When the agent runs as a plain binary

Nothing else is needed. Run `docker login` as the user the agent runs as, or point the agent's `DOCKER_CONFIG` at the directory that holds the `config.json` you want it to use.

## Credential helpers are not supported

The agent reads static credentials only: the `auths` entries of `config.json`. Credential helpers (`credsStore`) are not supported, and such entries are skipped. The pull then goes out without credentials, and the registry refuses it.

Check what `docker login` wrote:

```bash
cat /root/.docker/config.json
```

An entry the agent can use looks like this:

```json
{
  "auths": {
    "ghcr.io": {
      "auth": "<base64 of user:password>"
    }
  }
}
```

If the file has a `credsStore` key and the entry under `auths` is empty, the credentials went to a helper. Support for credential helpers is on the roadmap.

## When a pull fails

A deployment whose image cannot be pulled fails before anything is started, and the running version is not affected. `deployctl deploy` prints the reason.

One exception: if the pull fails but the image already exists on the server — it was built there, or pulled earlier — the agent uses the local copy and records a warning with the deployment:

```text
! Could not pull ghcr.io/company/my-api:1.4.2, using the local copy (…)
```

## What's next

- [Deploy from CI](/docs/tasks/deploy-from-ci), where images usually come from a private registry.
- [Security](/docs/security).
