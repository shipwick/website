---
title: Scan an image before it is deployed
description: Put a vulnerability scanner in the pipeline between the build and shipwick deploy, where its result can stop the job - a worked GitHub Actions example with Trivy, a severity gate and exit-code 1 - and what a scanner cannot see, so the image production runs is scanned again on a schedule.
---

# Scan an image before it is deployed

A scanner belongs in the pipeline, between the step that builds the image and the step that deploys it, where a finding can stop the job before `shipwick deploy` runs. The agent does not scan images, by design: a scanner is a product of its own, with a database to keep current and a policy to decide, and the pipeline is where that decision already has a place; see [Not planned](https://github.com/shipwick/shipwick/blob/main/ROADMAP.md#not-planned) in the roadmap. This page shows the step with Trivy next to the `shipwick/deploy` action, what the gate's three settings mean, and what a scanner in a pipeline cannot see, which is why the image that production runs is scanned again on a schedule.

## Before you begin

- The pipeline builds the image and pushes it to a registry, and `shipwick/deploy` or `shipwick deploy --image` deploys that reference; see [Deploy from CI](/docs/tasks/deploy-from-ci). A `deploy.yaml` with `build: .` builds on the runner inside `shipwick deploy`, with no image reference to scan in between; for a scanned pipeline, build and push first.
- A scanner. The example uses [Trivy](https://github.com/aquasecurity/trivy-action), which has a GitHub action; any scanner that exits non-zero on a finding works the same way, since a failing step stops the job before the deploy step.

## The step

Between `docker/build-push-action` and `shipwick/deploy`:

```yaml
- uses: aquasecurity/trivy-action@v0.36.0
  with:
    image-ref: ghcr.io/${{ github.repository }}:${{ github.sha }}
    severity: CRITICAL,HIGH
    ignore-unfixed: true
    exit-code: '1'
```

| Setting | |
|---|---|
| `image-ref` | The image the build step just pushed, by the same reference the deploy step gets. Scan what you deploy, not a sibling tag |
| `severity` | The findings that count. `CRITICAL,HIGH` stops the job for those two and lists the rest without stopping it; the default lists every severity |
| `ignore-unfixed` | Leave out findings the distribution has not published a fix for. Without it, a base image with an open CVE and no fix blocks every deployment until upstream moves, and the job fails for something no rebuild can change |
| `exit-code` | `'1'` makes a finding of the chosen severities fail the step, and with it the job. The default, `0`, reports and goes on, which is a log, not a gate |

The output is Trivy's table, in the job's log, one row per finding with the package, the installed and the fixed version and the CVE.

## A complete workflow

Build, push, scan, deploy. A finding of the chosen severities fails `scan`, and `shipwick/deploy` never runs:

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}

      - name: Scan the image
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: ghcr.io/${{ github.repository }}:${{ github.sha }}
          severity: CRITICAL,HIGH
          ignore-unfixed: true
          exit-code: '1'

      - uses: shipwick/deploy@v1
        with:
          url: https://agent.example.com
          token: ${{ secrets.SHIPWICK_TOKEN }}
          image: ghcr.io/${{ github.repository }}:${{ github.sha }}
```

Two things about the order. The image is in the registry before it is scanned: the runner is logged in to it from the build, so the scanner pulls it like the server would, and a failing image sits in the registry under its SHA tag but is never named to an agent. If a failing image must not be pushed at all, build with `load: true` and `push: false`, scan the local image, and push in a second `docker/build-push-action` step, which reuses the build. And the scan is in the same job as the deploy, so that a job that reaches `shipwick/deploy` has passed it; a scan in a separate job needs `needs:` on the deploy job to mean the same.

Trivy also scans the image for secrets by default (`scanners: vuln,secret`): a key or a password that a build copied into a layer is a finding. The answer on Shipwick's side is to keep such values out of the image and give them to the container as `env`, as `${NAME}` filled in from the secrets stored on the server; see [Keep secrets on the server](/docs/tasks/secrets).

## What a scanner in a pipeline cannot see

A scan is a statement about one image at one moment, with the vulnerability database of that moment. Three things are outside it.

- **The server.** Docker Engine, the kernel and the rest of the host are not in any image. They are kept current by the distribution's security updates, which [Prepare a server](/docs/tasks/prepare-a-server#automatic-security-updates) turns on, and Shipwick itself by [upgrading](/docs/tasks/upgrade). The agent's, the proxy's and the dashboard's images carry a bill of materials for scanners to read; see [Verify a release](/docs/tasks/verify-a-release).
- **Tomorrow's database.** An image that passed today has the same packages next month, and the database has new entries for them. Nothing in the pipeline runs again until the next push, which for a stable application may be a long time. The image that production runs has to be scanned again, on a schedule.
- **The base image behind the tag.** `FROM node:22` names whatever that tag is on the day of the build; a rebuild without a code change picks up a newer base with its fixes, and the image production runs keeps the old one until it is rebuilt and redeployed. A scheduled rescan is what tells you when that is due.

### Scan the image production runs

A second workflow, on a schedule, scans the image the server runs now — not the last one the pipeline built, which may be a failed deployment that production never took. The reference comes from the agent, as `active_deployment.image` of [`GET /applications/:name`](/docs/reference/api#get-applications-name), with a token of the `read` role:

```yaml
name: Rescan production

on:
  schedule:
    - cron: '30 6 * * 1'     # Mondays, 06:30 UTC

permissions:
  contents: read
  packages: read

jobs:
  rescan:
    runs-on: ubuntu-latest
    steps:
      - id: image
        run: |
          image=$(curl -fsS -H "Authorization: Bearer $SHIPWICK_AGENT_TOKEN" \
            "$SHIPWICK_AGENT_URL/api/v1/applications/my-api" | jq -r .data.active_deployment.image)
          echo "ref=$image" >> "$GITHUB_OUTPUT"
        env:
          SHIPWICK_AGENT_URL: https://agent.example.com
          SHIPWICK_AGENT_TOKEN: ${{ secrets.SHIPWICK_READ_TOKEN }}
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: ${{ steps.image.outputs.ref }}
          severity: CRITICAL,HIGH
          ignore-unfixed: true
          exit-code: '1'
```

A failed run is the signal: rebuild from the current base image and deploy, or [roll back](/docs/tasks/roll-back) if the finding is in a change of your own. `shipwick status my-api` shows the same `Image` line the workflow reads, for a look by hand. Give the workflow a token of its own with the `read` role, which reads the image and can change nothing; see [Create tokens for CI and teammates](/docs/tasks/tokens).

## What's next

- [Deploy from CI](/docs/tasks/deploy-from-ci): the action's inputs, exit codes, and building on the runner.
- [Staging and production](/docs/tasks/staging-and-production): the scanned image goes to staging first, and to production after an approval.
- [Verify a release](/docs/tasks/verify-a-release): the signatures and bills of materials of Shipwick's own images.
- [Security](/docs/security#unprivileged-containers): what a container goes without once it runs, whatever its image holds.
