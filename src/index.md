---
layout: home
title: Shipwick
titleTemplate: ':title · Production deployments on your own server'

hero:
  name: Shipwick
  text: Production deployments on your own server.
  tagline: One small file describes your application. One command ships it, with health checks, automatic rollback and HTTPS. Jobs, backups, secrets and a dashboard are included. All of it on the Linux server you already have.
  image:
    src: /deploy.png
    alt: A terminal showing shipwick deploy pulling an image, passing health checks, routing a domain and finishing in 6.1 seconds
  actions:
    - theme: brand
      text: Deploy your first app
      link: /docs/getting-started/install
    - theme: alt
      text: Documentation
      link: /docs/
    - theme: alt
      text: GitHub
      link: https://github.com/shipwick/shipwick
---

<div class="home">

<section>

## Three steps, five minutes

<p class="lead">A Linux server with Docker, a domain that points at it, and an image of your application. That is all Shipwick asks for.</p>

<div class="steps">
<div class="step">
<span class="num n1">1</span>

### Set up the server

Run one command on the server. It installs the agent, the reverse proxy and the dashboard, and prints your API token.

```bash
curl -fsSL https://get.shipwick.com | sh
```

</div>
<div class="step">
<span class="num n2">2</span>

### Connect your laptop

Install the CLI and sign in once. From now on `shipwick` talks to your server, from anywhere.

```bash
brew install shipwick/tap/shipwick
shipwick login --url https://agent.example.com
```

</div>
<div class="step">
<span class="num n3">3</span>

### Deploy

Describe the application in `deploy.yaml`, then ship it. Replicas are replaced one at a time, each only after it proved healthy.

```bash
shipwick init
shipwick deploy
```

</div>
</div>

<div class="columns">
<div>

```yaml
# deploy.yaml
name: my-api
image: ghcr.io/company/my-api:1.4.2
port: 8080
domain: api.example.com
replicas: 2

health:
  path: /health
```

</div>
<div>

```text
$ shipwick deploy
Deploying my-api...

✓ Validated deploy.yaml
✓ Pulled image ghcr.io/company/my-api:1.4.2
✓ Started 1 container
✓ Replica 1 passed health checks
✓ Replica 1/2 is serving 1.4.2
✓ Replica 2 passed health checks
✓ Replica 2/2 is serving 1.4.2
✓ Routed https://api.example.com to 2 replicas
✓ Deployment successful

my-api 1.4.2  deployed in 6.1s
https://api.example.com
```

</div>
</div>

<div class="next">

[Install on a server](/docs/getting-started/install)
[Install the CLI](/docs/getting-started/install-cli)
[Your first deployment](/docs/getting-started/first-deployment)

</div>

</section>

<section>

## Everything a small production needs

<div class="tiles">
<div class="tile t-blue">
<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"/></svg>

### Rolling deployments

One replica at a time, each only after it passed its health check. A version that does not come up is rolled back on its own; the one that works keeps serving.

</div>
<div class="tile t-green">
<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 4v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V7l7-4z"/><path d="M9 12l2 2 4-4"/></svg>

### HTTPS, done

Every domain gets a certificate and is load-balanced across healthy replicas. Aliases and `www` redirects are one line each. There is no proxy configuration to write.

</div>
<div class="tile t-amber">
<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>

### Jobs and migrations

A command that runs from the new image before any replica starts. Cron jobs from the same image. `shipwick run my-api -- rails db:migrate` for the one you do by hand.

</div>
<div class="tile t-purple">
<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>

### Databases, volumes, backups

Persistent volumes for the things that keep data. `shipwick backup` downloads them as plain tar files; `shipwick restore` puts one back.

</div>
<div class="tile t-rose">
<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>

### Secrets and tokens

`${PASSWORD}` keeps secrets out of files; the server stores them encrypted. Tokens with roles: `deploy` for CI, `read` for a teammate, `admin` for you.

</div>
<div class="tile t-teal">
<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M7 12l3-3 2 2 4-4"/></svg>

### A dashboard that knows everything

Replicas, health, a week of CPU and memory, deployment history, live logs, jobs, backups and tokens. Whatever the dashboard does, the CLI and the API can do too.

</div>
</div>

</section>

<section>

## Two applications and a database

<p class="lead">Applications reach each other by name on the server. No domain is needed for that, and nothing outside can reach those names.</p>

<div class="columns three">
<div>

```yaml
# postgres/deploy.yaml
name: postgres
image: postgres:17
port: 5432
env:
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
volumes:
  - name: data
    path: /var/lib/postgresql/data
health:
  tcp: 5432
deploy:
  strategy: recreate
```

</div>
<div>

```yaml
# api/deploy.yaml
name: api
image: ghcr.io/company/api:2.3.0
port: 8080
domain: api.example.com
env:
  DATABASE_URL: postgres://app:${POSTGRES_PASSWORD}@postgres:5432/app
health:
  path: /health
pre_deploy:
  command: ["./migrate", "up"]
```

</div>
<div>

```yaml
# web/deploy.yaml
name: web
image: ghcr.io/company/web:2.3.0
port: 3000
domain: example.com
redirects: [www.example.com]
```

</div>
</div>

```bash
shipwick deploy -f postgres/deploy.yaml -f api/deploy.yaml -f web/deploy.yaml --env-file .env.production
```

They deploy in that order. If one fails, the ones after it are not touched, and the one that failed keeps running its previous version.

<div class="next">

[Run a database](/docs/tasks/stateful-applications)
[Call one application from another](/docs/tasks/call-another-application)
[Deploy from CI](/docs/tasks/deploy-from-ci)

</div>

</section>

<section>

## Why one server

<p>A single server is a lot of computer. A few cores, a few gigabytes of memory and a good network run a company's whole product for the price of a lunch a month, and most products never need more than that. What such a server lacks is not power but the platform around it: deploying without downtime, restarting what crashes, rolling back a bad release, serving HTTPS, keeping secrets out of files, running the nightly job, taking the backup.</p>

<p>Shipwick is that platform, built for one server on purpose. One process, one SQLite file, one YAML file per application. Nothing to keep alive besides the server itself. When one server is no longer enough, you have outgrown Shipwick, and the <code>deploy.yaml</code> you wrote says everything about the application that the next platform will ask.</p>

<div class="next">

[Architecture](/docs/concepts/overview)
[Deployments](/docs/concepts/deployments)
[Security](/docs/security)

</div>

</section>

<section>

## Install

On a Linux server with Docker, as root:

```bash
curl -fsSL https://get.shipwick.com | sh
```

On your laptop or in CI, only the CLI:

```bash
curl -fsSL https://get.shipwick.com | sh -s -- --cli
```

Or with Homebrew: `brew install shipwick/tap/shipwick`. Everything the installer downloads comes from one release and is verified against its checksums. The agent holds the Docker socket, so an admin token is as valuable as root SSH access to the server: read [Security](/docs/security) before you put it on the internet.

<div class="next">

[Install on a server](/docs/getting-started/install)
[Your first deployment](/docs/getting-started/first-deployment)
[deploy.yaml reference](/docs/reference/deploy-yaml)

</div>

</section>

</div>
