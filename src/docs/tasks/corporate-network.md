---
title: Run behind a corporate proxy or without internet
description: Set up Shipwick on a server whose way out is a proxy, a certificate authority of the company's own or nothing at all - HTTPS_PROXY, SHIPWICK_CA_FILE, SHIPWICK_DNS_RESOLVERS, SHIPWICK_ACME_DIRECTORY, and installing from a bundle made with shipwick server bundle.
---

# Run behind a corporate proxy or without internet

A server inside a company's network often reaches the internet through a proxy, trusts a certificate authority of the company's own, or reaches nothing outside at all. Since 0.6 Shipwick has a setting for each of these. Nothing on this page is needed on a server with a plain connection.

This page covers what goes out of a server and who sends it, the proxy for the installer, the agent and Caddy, the proxy Docker needs for itself, an authority of your own, certificates when Let's Encrypt cannot reach the server, DNS behind a firewall, and installing and upgrading a server with no connection from one file.

## What goes out, and what it follows

A server whose way to the internet is a proxy has several programs that go out, and each has its own setting:

| What goes out | Who sends it | What it follows |
|---|---|---|
| Image pulls | the Docker daemon | Docker's own configuration, [below](#give-docker-the-proxy-too). Nothing set for Shipwick reaches a pull |
| Notifications to the webhook, backups to the bucket | the agent | `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`; `SHIPWICK_CA_FILE` |
| Certificates: the certificate authority, Cloudflare's API | Caddy | the same three variables; `SHIPWICK_ACME_DIRECTORY` |
| Whether a hostname points at the server | the agent, by DNS | `SHIPWICK_DNS_RESOLVERS` |
| Whether a newer release exists, once a day, since 0.7 | the agent, to GitHub | the same three variables; `SHIPWICK_CA_FILE`. `SHIPWICK_UPDATE_CHECK=off` stops it |
| The installer's downloads | `curl` or `wget` | `HTTPS_PROXY` |
| `shipwick` to the agent and to GitHub (`upgrade`, `doctor`, `server bundle`) | the CLI | `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`; `SHIPWICK_CA_FILE` |

Health checks, requests from Caddy to replicas, the Docker socket and Caddy's admin socket never go through a proxy, whatever the variables say. Neither does a request to a name without a dot — a container or an application on the server's own networks — so those need no entry in `NO_PROXY`. The dashboard talks to the agent only, inside the server, and to nothing else.

## Install through a proxy

Give the installer the proxy. It uses it for its downloads and writes it to `/opt/shipwick/.env`, from where the compose file hands it to the agent and to Caddy:

```bash
export HTTPS_PROXY=http://proxy.example.com:3128
curl -fsSL https://get.shipwick.com | sudo -E sh
```

A user name and a password go into the URL, `http://user:password@proxy.example.com:3128`, with characters that are special in a URL percent-encoded. They are a secret: the agent logs the proxy's host and port and nothing else of it, and no error repeats the URL.

To add or change the proxy later, edit `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` in `/opt/shipwick/.env` and apply the change:

```bash
cd /opt/shipwick && docker compose up -d
```

## Give Docker the proxy too

Images are pulled by the Docker daemon, which reads neither that file nor the shell's variables. It needs the proxy in `/etc/docker/daemon.json`, and a restart:

```json
{
  "proxies": {
    "http-proxy": "http://proxy.example.com:3128",
    "https-proxy": "http://proxy.example.com:3128",
    "no-proxy": "localhost,127.0.0.0/8"
  }
}
```

```bash
systemctl restart docker
```

A registry whose certificate comes from an authority of your own — or a proxy that opens TLS and signs with one — is trusted by the daemon through `/etc/docker/certs.d/<registry>/ca.crt`.

When a pull fails on the way to the registry, the deployment's error says which of the two it was and names the file to change. `shipwick doctor` compares the two sides:

```text
! The agent goes through the proxy proxy.example.com:3128, and the Docker daemon on the server has none configured: images are pulled by the daemon, not by the agent. If pulls fail, add "proxies" to /etc/docker/daemon.json on the server and restart Docker
```

With `build:` in `deploy.yaml` there is no pull: `shipwick deploy` builds on your machine and sends the image through the agent.

## When the proxy refuses

The agent's log names the proxy, the destination and the proxy's answer, so that a refusal is not mistaken for the destination's:

```text
level=WARN msg="notification not delivered" event=deployment.succeeded app=my-api host=hooks.example.com attempts=4 error="the proxy proxy.example.com:3128 refused to connect to hooks.example.com:443 (403 Forbidden): check that the proxy allows this destination"
```

## Trust a certificate authority of your own

A webhook endpoint or a bucket inside the company, or a proxy that opens TLS, presents a certificate that no public authority issued. Put the authority's certificate — PEM, one or several — on the server, name it in `/opt/shipwick/.env` by the path the agent's container sees:

```bash
SHIPWICK_CA_FILE=/etc/shipwick/ca.pem
```

and mount it in `/opt/shipwick/compose.override.yml`:

```yaml
services:
  agent:
    volumes:
      - /etc/shipwick/ca.pem:/etc/shipwick/ca.pem:ro
  caddy:
    volumes:
      - /etc/shipwick/ca.pem:/etc/ssl/certs/shipwick-ca.pem:ro
```

Then `cd /opt/shipwick && docker compose up -d`.

The authorities in the file are trusted in addition to the system's, by the agent for the webhook, the bucket and the sign-in provider. The agent checks the file when it starts and does not start with one it cannot use. The message says what is wrong:

- the file is missing;
- it is a directory, which is what Docker creates when the path left of the colon does not exist;
- it holds a key;
- it holds a server's certificate instead of its authority's;
- it holds only certificates that have expired.

The second mount is for Caddy, which needs the authority only to reach an ACME server of your own, below: Caddy reads every certificate in `/etc/ssl/certs`. The Docker daemon has its own trust, above.

On a laptop, `SHIPWICK_CA_FILE` in the environment does the same for `shipwick`, for an agent whose certificate that authority issued.

## Certificates

Let's Encrypt has to reach the server on ports 80 and 443 from the internet, and Caddy has to reach Let's Encrypt. A proxy provides the second, not the first.

- **With `SHIPWICK_CLOUDFLARE_API_TOKEN`** only outgoing requests are needed, and they go through the proxy. See [Put Cloudflare in front of the server](/docs/tasks/cloudflare).
- **An ACME server of your own.** `SHIPWICK_ACME_DIRECTORY` is its directory URL, `https://ca.example.internal/acme/acme/directory`; Caddy then obtains and renews every certificate there and asks no public authority. Its own certificate has to be trusted by Caddy: the second mount above.
- **Certificates you supply**, with `shipwick cert set <hostname> --cert <file> --key <file>`, need no authority to be reachable at all. See [Use a certificate of your own](/docs/tasks/certificates).

## DNS

Before a hostname is routed, the agent asks public name servers whether it points at the server; see [DNS first](/docs/concepts/routing-and-https#dns-first). Behind a firewall that lets no DNS out they do not answer. The agent then asks the server's own resolver and leaves the public ones alone for five minutes. Hostnames that exist only inside the company are found that way too.

Nothing needs to be set for that. Two settings make it explicit:

```bash
SHIPWICK_DNS_RESOLVERS=system               # skip the public ones from the start
SHIPWICK_DNS_RESOLVERS=10.0.0.2,10.0.0.3    # ask these name servers instead
```

## See what is set

`shipwick server status` shows the network settings, on a server where something is set:

```text
Network         proxy proxy.example.com:3128 · certificate authorities of its own · DNS system
```

`GET /server` reports the same as `network`, with `docker_proxy` saying whether the Docker daemon has a proxy; see [the API reference](/docs/reference/api#get-server). The dashboard names them on the server's Status tab, and warns when the agent has a proxy and the daemon has none.

## Install on a server with no way out

A server that reaches neither GitHub nor a registry is installed from files. On a machine that has a connection and Docker:

```bash
shipwick server bundle --arch amd64
```

```text
✓ Release v0.7.0: compose.production.yml, install.sh and shipwick_linux_amd64 match its checksums
✓ The three images are the ones release v0.7.0 published for linux/amd64
✓ Wrote shipwick-v0.7.0-linux-amd64.tar.gz (113 MB)

Copy it to the server, and there, as root:
  tar -xzf shipwick-v0.7.0-linux-amd64.tar.gz
  sh shipwick-v0.7.0-linux-amd64/install.sh
The server needs Docker Engine and the Compose plugin; nothing is downloaded there.
checksums.txt of the release: sha256 646205a7…
```

This is the output for a release from 0.7.0 on. The bundle of 0.6.0 has no second line: see [The images are proven too](#the-images-are-proven-too).

The bundle holds the release's compose file, installer and checksums, the `shipwick` binary for the server, and the three images in one archive, pulled for the server's architecture.

| Flag | |
|---|---|
| `--arch` | `amd64` or `arm64`: the server's architecture. `amd64` unless you say otherwise. |
| `--version <tag>` | A release other than the latest. A bundle can be made of 0.6.0 and later. |
| `-o <file>` | Where to write the bundle. Default: `shipwick-<version>-linux-<arch>.tar.gz` in the current directory. |
| `--no-pull` | Save the images this machine has under the release's names instead of pulling them. They are not checked against the release's digests. |

The release's files are verified against its checksums when the bundle is made and again by the installer on the server; the image archive carries a checksum of its own, so a copy that arrived damaged is refused before anything is changed.

### The images are proven too

From 0.7.0 on, a release publishes `image-digests.txt`, listed in its `checksums.txt` like every other file: for each image the digest of its manifest list and, for each platform, the digest of the manifest and of the image's configuration, read back from the registry after the release pushed them.

- **`shipwick server bundle` reads the archive `docker save` wrote** before it goes into the bundle. It must hold the configuration the release published for the server's platform and the layers that configuration lists, and name that image, and no other, by the release's tag. An archive that does not is refused, and no bundle is written.
- **The installer checks once more what Docker made of the archive** — the ID of each loaded image against the same file — before it replaces the compose file. An image that is not the release's is removed again, and the installation is left as it was.

Two bundles are not proven, and both the command and the installer say so: one made with `--no-pull`, whose images are whatever the machine had under the release's names, and one of a release before 0.7.0, which published no digests. The installer's line:

```text
! The images in this bundle were not checked against the release's digests: it was made with --no-pull, or of a release before 0.7.0.
```

Everything in a bundle follows from its `checksums.txt`, and the bundle brings that file itself: on the server, the checks tell a damaged or mixed-up bundle, not one that somebody rebuilt on purpose. Against that, both ends print the SHA-256 of `checksums.txt`. Compare the line `shipwick server bundle` printed with the one the installer prints.

### On the server

Copy the file by whatever means the network allows, unpack it and run the installer inside it. It is the same installer and asks the same questions; it downloads nothing and pulls nothing:

```text
✓ The bundle is complete (/root/shipwick-v0.7.0-linux-amd64)
  checksums.txt of the release: sha256 646205a7…
✓ Docker 29.8.2 with Compose 5.5.1
✓ Loaded the images from the bundle
✓ The images are the ones the release published
✓ Installed /opt/shipwick/compose.yml
✓ Wrote /opt/shipwick/.env
✓ Started the Shipwick services
✓ The agent is healthy
✓ Installed the shipwick CLI to /usr/local/bin/shipwick
```

`sh install.sh --bundle <directory or .tar.gz>` does the same from anywhere.

**Upgrading** is the same procedure with the bundle of a newer release; `.env` and the token stay as they are, and the images of the release before are removed.

What such a server needs besides:

- **Docker.** The bundle does not bring it. Install Docker Engine and the Compose plugin from your distribution's packages, copied to the server, or from Docker's static binaries ([docs.docker.com/engine/install/binaries](https://docs.docker.com/engine/install/binaries/)); the installer checks for both before it changes anything.
- **Your applications' images.** With `build:` in `deploy.yaml`, `shipwick deploy` builds on your machine and sends the image through the agent: no registry is involved. An `image:` has to come from a registry the server reaches, inside the company; its certificate and credentials are Docker's, as above, and [`shipwick registry login`](/docs/tasks/private-registries).
- **Certificates.** Let's Encrypt is out of reach: an ACME server of your own, or certificates you supply, as above.
- **Nothing else.** DNS falls back to the server's resolver by itself. The webhook, the bucket and the sign-in provider, if you use them, are inside the company, with `SHIPWICK_CA_FILE` when their certificates are. `shipwick doctor` on such a network reports that it could not check for a newer release, and goes on. The agent's own daily question about one goes unanswered and unnoticed; `SHIPWICK_UPDATE_CHECK=off` spares it the attempt.

## What's next

- [Agent configuration](/docs/reference/agent-configuration): every variable on this page, with what the agent says when one is wrong.
- [`shipwick server bundle`](/docs/reference/cli#server-bundle) in the CLI reference.
- [Use a certificate of your own](/docs/tasks/certificates) and [Pull from private registries](/docs/tasks/private-registries).
- [Upgrade Shipwick](/docs/tasks/upgrade): what an upgrade changes, from a bundle or not.
