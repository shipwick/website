---
title: Verify a release
description: Releases are signed by the workflow that built them, from 0.8.0 on. What the signature proves, how to verify the files and the images with cosign and their provenance with gh attestation verify, what the installer, shipwick upgrade and shipwick server bundle check with and without cosign, and the bill of materials of every binary and image.
---

# Verify a release

The agent is root on your server, so it should be possible to say where it came from. From 0.8.0 on, every release is signed by the workflow that built it. This page says what that signature proves, how to check it yourself for the files and the images, what the installer and `shipwick upgrade` check for you, and where the bill of materials of a release is.

## Before you begin

- Releases before 0.8.0 have no signature. Their files are verified against the release's checksums, as before.
- Verifying a file takes [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) 2.4 or later. An older cosign fails on this signature whatever the file.
- Verifying an image takes cosign 3; cosign 2.6 reads these signatures with `--new-bundle-format`.
- A provenance attestation is read with the GitHub CLI, signed in.

## What the signature proves

A release is signed by the workflow that built it, and by nothing else: there is no signing key, in the repository or anywhere. GitHub tells Sigstore which workflow is running and for which tag, Sigstore issues a certificate for that identity that is valid for ten minutes, and the signature goes into a public log. A signature verifies only for the identity you name, which for release `v0.8.0` is

```text
https://github.com/shipwick/shipwick/.github/workflows/release.yml@refs/tags/v0.8.0
issued by https://token.actions.githubusercontent.com
```

So what it proves is that the file or image was produced by that workflow file, at that tag, in that repository: a commit you can read. It does not prove that the commit is good.

## Verify the files

The release's files — the CLI for every platform, the packages, the compose file, the installer, the digests of the images — are listed in `checksums.txt`, and `checksums.txt` is what is signed. The signature is a file of the release, `checksums.txt.sigstore.json`.

```bash
curl -fsSLO https://github.com/shipwick/shipwick/releases/download/v0.8.0/checksums.txt
curl -fsSLO https://github.com/shipwick/shipwick/releases/download/v0.8.0/checksums.txt.sigstore.json
cosign verify-blob checksums.txt --bundle checksums.txt.sigstore.json \
  --certificate-identity https://github.com/shipwick/shipwick/.github/workflows/release.yml@refs/tags/v0.8.0 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
sha256sum -c --ignore-missing checksums.txt     # the files you downloaded, against the list
```

The first three lines prove who wrote the list; the last holds the files you downloaded against it.

## Verify the images

The images are signed by digest. A tag is resolved to its digest when you verify, so this proves what the registry serves under the tag now.

```bash
cosign verify ghcr.io/shipwick/agent:0.8.0 \
  --certificate-identity https://github.com/shipwick/shipwick/.github/workflows/release.yml@refs/tags/v0.8.0 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The same goes for `ghcr.io/shipwick/dashboard` and `ghcr.io/shipwick/caddy`. The digest it prints is the `index` line of that image in the release's `image-digests.txt`, and what this shows on a server that pulled the tag:

```bash
docker image inspect --format '{{.RepoDigests}}' ghcr.io/shipwick/agent:0.8.0
```

## Verify the provenance

Each file and each image also has a provenance attestation, kept by GitHub: the repository, the commit, the workflow and the run.

```bash
gh attestation verify shipwick_linux_amd64 --repo shipwick/shipwick \
  --cert-identity https://github.com/shipwick/shipwick/.github/workflows/release.yml@refs/tags/v0.8.0
gh attestation verify oci://ghcr.io/shipwick/agent:0.8.0 --repo shipwick/shipwick \
  --cert-identity https://github.com/shipwick/shipwick/.github/workflows/release.yml@refs/tags/v0.8.0
```

## What the installer and the CLI check for you

The installer, `shipwick upgrade` and `shipwick server bundle` verify the signature of `checksums.txt` before they use the checksums, when cosign is installed where they run. Nothing installs cosign for you, and nothing needs it.

| | With cosign installed | Without cosign |
|---|---|---|
| The installer | Verifies the signature and stops if it is not the release workflow's: `✓ The release is signed by the release workflow of github.com/shipwick/shipwick`. A release without a signature is installed with a warning | Says so in one line and goes by the checksums alone: `The release's signature was not checked: cosign is not installed. Every file is checked against the release's checksums.` |
| The installer with `SHIPWICK_REQUIRE_SIGNATURE=1` | The same, and a release without a signature is refused | Installs nothing |
| `shipwick upgrade` | Verifies the signature; a signature that does not verify changes nothing. A release from 0.8.0 on that has no signature is refused | Says that the signature was not checked |
| `shipwick server bundle` | Verifies the signature before it downloads anything else, and says which it was. The signature travels in the bundle | Says that the signature was not checked. The signature travels in the bundle all the same |

A new server has no cosign, so the installer's line about it is the second line of an ordinary installation.

### Make the check a condition

```bash
curl -fsSL https://get.shipwick.com | SHIPWICK_REQUIRE_SIGNATURE=1 sh
```

With `SHIPWICK_REQUIRE_SIGNATURE=1` the installer installs nothing without cosign, from a release without a signature, or from one whose signature does not verify.

Without that setting a release that has no signature is installed with a warning. Releases before 0.8.0 have none, and the installer cannot tell one of those from a release whose signature somebody removed. `shipwick upgrade` can, because it knows which release it asked for: with cosign installed it refuses a release from 0.8.0 on that has no signature.

### A bundle for a server with no connection

Where the bundle is made is also where its signature is checked. With cosign installed there, `shipwick server bundle` verifies the release's signature of `checksums.txt` before it downloads anything else, and says which it was: verified, not checked for want of cosign, or a release from before releases were signed. The signature travels in the bundle as `checksums.txt.sigstore.json`.

The installer on the server does not verify it by itself: cosign asks Sigstore for the keys it trusts, and that server reaches nothing. With `SHIPWICK_REQUIRE_SIGNATURE=1` it does, for a server whose cosign was given those keys beforehand. See [Install on a server with no way out](/docs/tasks/corporate-network#install-on-a-server-with-no-way-out).

### The packages

The Debian and RPM packages of the agent are files of the release, listed in the signed `checksums.txt`. Verify that file as above, and the package against it, before you install one. See [Install from a package](/docs/getting-started/install-from-a-package).

## What a release is made of

Each binary of a release has a bill of materials next to it, `shipwick_linux_amd64.spdx.json` and so on, and `shipwick-agent_amd64.spdx.json` for the agent inside the packages: the Go modules it was linked from, with their versions, and the Go it was compiled with, read from the binary itself. They are listed in `checksums.txt` like every other file.

Each image carries one for each platform, written when it was built from the files in it, as part of the signed manifest list:

```bash
docker buildx imagetools inspect ghcr.io/shipwick/agent:0.8.0 \
  --format '{{ json (index .SBOM "linux/amd64").SPDX }}'
```

All of them are SPDX 2.3 JSON, which scanners such as Grype and Trivy read.

## What's next

- [Install Shipwick on a server](/docs/getting-started/install): the installer and its variables.
- [Upgrade Shipwick](/docs/tasks/upgrade): `shipwick upgrade` and the installer, run again.
- [Security](/docs/security#verified-installation): what is verified on every installation, with or without cosign.
- [`shipwick upgrade`](/docs/reference/cli#upgrade) and [`shipwick server bundle`](/docs/reference/cli#server-bundle) in the CLI reference.
