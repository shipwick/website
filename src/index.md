---
layout: home
title: Shipwick
titleTemplate: ':title · Production deployments on your own server'

hero:
  name: Shipwick
  text: Production deployments on your own server.
  tagline: For developers and small teams with a Linux server of their own. One small file describes your application; one command builds it, ships it to the server and serves it over HTTPS, with health checks and automatic rollback.
  image:
    src: /img/hero.svg
    alt: A laptop sends a container to one server, where Wick, the Shipwick flame, keeps watch
  actions:
    - theme: brand
      text: Get started
      link: /docs/getting-started/install-cli
    - theme: alt
      text: What is Shipwick?
      link: /docs/
---

<div class="home">

<section>

<figure class="flow">
<img src="/img/flow.svg" alt="Four stations from left to right: shipwick init writes the files, shipwick deploy builds and sends the image, the health checks pass, and the application answers at its address" width="1200" height="220">
<figcaption>
<ol>
<li><code>shipwick init</code></li>
<li><code>shipwick deploy</code></li>
<li>Health checks pass</li>
<li><code>https://your-app</code></li>
</ol>
</figcaption>
</figure>

</section>

<section class="band">

## Five minutes

<p class="lead">A Linux server you can reach over SSH, a domain that points at it, and your project on your laptop, with Docker running there. That is all it takes.</p>

<div class="steps">
<div class="step card">
<span class="num n1">1</span>
<img class="wick" src="/img/wick.svg" alt="" width="56" height="56">

### Install the CLI

On your laptop. One binary, `shipwick`; with Homebrew it is `brew install shipwick/tap/shipwick`.

```bash
curl -fsSL https://get.shipwick.com | sh -s -- --cli
```

</div>
<div class="step card">
<span class="num n2">2</span>
<img class="wick" src="/img/wick-tools.svg" alt="" width="56" height="56">

### Install the server

From your laptop, over SSH. It installs Docker if it is missing, then the agent, the reverse proxy and the dashboard, and saves the API token for you. `--agent-domain` and `--dashboard-domain` give the API and the dashboard their hostnames.

```bash
shipwick server install root@203.0.113.10
```

</div>
<div class="step card">
<span class="num n3">3</span>
<img class="wick" src="/img/wick-check.svg" alt="" width="56" height="56">

### Deploy

In your project. `init` writes a Dockerfile and a `deploy.yaml` for it. `deploy` builds the image on your machine, sends it over and replaces replicas one at a time, each after it proved healthy. No registry needed.

```bash
shipwick init
shipwick deploy
```

</div>
</div>

<div class="next">

[Install the CLI](/docs/getting-started/install-cli)
[Install on a server](/docs/getting-started/install)
[Your first deployment](/docs/getting-started/first-deployment)

</div>

</section>

<section>

## What a deployment looks like

<figure class="shot">
<img src="/deploy.png" alt="A terminal showing shipwick deploy pulling an image, starting a container, passing health checks, routing https://api.example.com and finishing in 6.1 seconds" width="2200" height="1120">
<figcaption>The version that works keeps serving until the new one has proved itself.</figcaption>
</figure>

<div class="columns">
<div>

```yaml
# deploy.yaml
name: my-api
build: .                  # built on your machine, sent to the server
port: 8080
domain: api.example.com   # served over HTTPS, certificate included
replicas: 2
health:
  path: /health           # traffic moves over only once this answers 200
```

</div>
<div>

The file above is the whole configuration: where the image comes from, the port it listens on, the domain, how many replicas, and how to tell that one is healthy. The certificate is obtained on the first request.

Already have an image in a registry, as in the picture? Name it instead of building: `image: ghcr.io/company/my-api:1.4.2`. A built frontend needs no container at all: `static: dist/`, and the proxy serves the folder.

</div>
</div>

</section>

<section>

## Everything a small production needs

<div class="tiles">
<div class="tile card t-blue">
<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"/></svg>

### Deployments that undo themselves

One replica at a time, each after its health check. A version that does not come up never takes traffic; the one that works keeps serving.

</div>
<div class="tile card t-green">
<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 4v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V7l7-4z"/><path d="M9 12l2 2 4-4"/></svg>

### HTTPS with nothing to configure

A certificate for every domain, load balancing across healthy replicas, aliases, `www` redirects and compression. Static sites are served by the proxy itself.

</div>
<div class="tile card t-amber">
<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>

### Migrations, cron jobs, one-off commands

A command from the new image before any replica starts, scheduled jobs from the same image, and `shipwick run my-api -- rails db:migrate` for the one you do by hand.

</div>
<div class="tile card t-purple">
<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>

### Databases, with backups as plain files

Volumes for the things that keep data. The server backs them up on a schedule, encrypted, to an S3-compatible bucket, and `shipwick backups verify` proves that one restores. `shipwick backup` downloads a volume as a tar file.

</div>
<div class="tile card t-rose">
<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>

### Secrets on the server, access with limits

`shipwick secret set` keeps a value encrypted on the server and `${NAME}` fills it in on every deploy. A `deploy` token for CI, limited to its applications and with an end; your company's accounts for people; an audit trail of who changed what.

</div>
<div class="tile card t-teal">
<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M7 12l3-3 2 2 4-4"/></svg>

### A dashboard, a CLI and an API

Replicas, health, a week of CPU and memory, history, live logs and what a crashed container printed last, jobs, backups, secrets and access, for one server or several. Whatever one of the three does, the others can.

</div>
</div>

<figure class="shot">
<img src="/img/dashboard.png" alt="The overview of the Shipwick dashboard: a sentence that says four applications need attention, the alerts that hold, and the applications with what is wrong with each" width="2880" height="1800">
<figcaption>The dashboard: the same information as the terminal, live, with the everyday actions. It opens with the answer to "is everything fine?".</figcaption>
</figure>

</section>

<section>

## Two applications and a database

<p class="lead">Applications reach each other by name on the server, <code>postgres:5432</code>, and nothing outside the server can reach those names. Several applications live in one <code>shipwick.yaml</code>.</p>

```yaml
# shipwick.yaml
apps:
  - name: postgres
    image: postgres:17
    port: 5432
    env:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}   # filled in when you deploy, never in the file
    volumes:
      - name: data
        path: /var/lib/postgresql/data
    health:
      tcp: 5432
    deploy:
      strategy: recreate                        # a database cannot run twice

  - name: api
    build: api                                  # built on your machine, sent to the server
    port: 8080
    domain: api.example.com
    env:
      DATABASE_URL: postgres://app:${POSTGRES_PASSWORD}@postgres:5432/app
    health:
      path: /health
    pre_deploy:
      command: ["./migrate", "up"]              # runs from the new image before any replica starts
    after: [postgres]                           # not before the database is up

  - name: web
    static: web/dist                            # served by the proxy, no container
    domain: example.com
    redirects: [www.example.com]
```

```bash
shipwick secret set POSTGRES_PASSWORD     # once; asked without echo, kept encrypted on the server
shipwick deploy
```

`postgres` and `web` deploy at the same time, `api` once `postgres` is done. If one fails, what depends on it is skipped, the rest finishes, and the one that failed keeps running its previous version.

<div class="next">

[Run a database](/docs/tasks/stateful-applications)
[Call one application from another](/docs/tasks/call-another-application)
[Deploy from CI](/docs/tasks/deploy-from-ci)

</div>

</section>

<section>

## One server, on purpose

<div class="side">
<div>

A single server is a lot of computer. A few cores and a few gigabytes of memory run the 1 to 20 applications of most products with room to spare. What such a server lacks is not power but the platform around it: deploying without downtime, restarting what crashes, rolling back a bad release, serving HTTPS, keeping secrets out of files, running the nightly job, taking the backup.

Shipwick is that platform, built for one server on purpose. One process, one SQLite file, one YAML file per application, and nothing to keep alive besides the server itself. It schedules nothing across machines. When one server is no longer enough, you have outgrown Shipwick, and the `deploy.yaml` you wrote says everything about the application that the next platform will ask.

<div class="next">

[Architecture](/docs/concepts/overview)
[Deployments](/docs/concepts/deployments)
[Rollback](/docs/concepts/rollback)

</div>

</div>
<div>
<img src="/img/one-server.svg" alt="One server with several applications inside it, a shield in front, and Wick keeping watch" width="600" height="420">
</div>
</div>

</section>

<section class="band">

<div class="heading">
<img src="/img/wick-watch.svg" alt="" width="56" height="56">

## For the people who run it

</div>

<p class="lead">Everything above, with the details an operator asks for first.</p>

<div class="pro">
<div class="card">

### What is on the server

Three containers from `/opt/shipwick/compose.yml`: the agent, Caddy and the dashboard. The agent's state is one SQLite file, `shipwick.db`, with its `encryption.key` beside it in the `agent-data` volume; certificates live in `caddy-data`, the folders of static sites in `caddy-static`. No external database, no queue, no second server.

<div class="next">

[Agent configuration](/docs/reference/agent-configuration)
[What the installer does](/docs/getting-started/install#what-the-installer-does)

</div>

</div>
<div class="card">

### Security

The agent holds the Docker socket, so an `admin` token is root on the server: treat it so, and give CI a `deploy` token. The API speaks plain HTTP on `127.0.0.1:9000` and is reached over HTTPS through Caddy, an SSH tunnel or a private network. Only the SHA-256 of each token is kept, `env` values and secrets are encrypted at rest, no shell runs anywhere, and containers are never privileged; `security` in `deploy.yaml` takes away more, per application. Application containers do not reach the API, and releases are signed by the workflow that builds them. People can sign in through your OpenID Connect provider, and every change is in the audit trail.

<div class="next">

[Security](/docs/security)
[Tokens and roles](/docs/tasks/tokens)
[Sign in with your accounts](/docs/tasks/sign-in)

</div>

</div>
<div class="card">

### One API, three clients

The dashboard, `shipwick` and `curl` use the same REST API under `/api/v1`, and every endpoint is registered with the role it needs: `read`, `deploy` or `admin`. A deployment's request body is the `deploy.yaml` itself, and the agent validates it again whatever the client checked.

<div class="next">

[REST API](/docs/reference/api)
[shipwick CLI](/docs/reference/cli)
[deploy.yaml](/docs/reference/deploy-yaml)

</div>

</div>
</div>

</section>

<section>

## Install

<div class="columns">
<div>
<p class="caption">On your laptop or in CI, the CLI:</p>

```bash
curl -fsSL https://get.shipwick.com | sh -s -- --cli
```

</div>
<div>
<p class="caption">Or on a Linux server with Docker, as root, the server itself:</p>

```bash
curl -fsSL https://get.shipwick.com | sh
```

</div>
</div>

The CLI also comes with Homebrew, `brew install shipwick/tap/shipwick`, and for Windows as `shipwick_windows_amd64.exe`, or `shipwick_windows_arm64.exe` on Arm, from the [latest release](https://github.com/shipwick/shipwick/releases/latest). With it installed, `shipwick server install root@203.0.113.10 --agent-domain agent.example.com --dashboard-domain dashboard.example.com` sets up the server over SSH, saves the token for you and prints the DNS records to create; `shipwick doctor` checks the whole setup afterwards. Everything the installer downloads comes from one release and is verified against its checksums. A server with no connection is [installed from one file](/docs/tasks/corporate-network), and the agent also comes as a [Debian and an RPM package](/docs/getting-started/install-from-a-package).

<div class="closing">
<img src="/img/wick-wave.svg" alt="Wick, the Shipwick flame, waving" width="80" height="80">

<p>One file, one command, and the version that works keeps serving. <a href="/docs/getting-started/first-deployment">Your first deployment</a> is one page away.</p>

</div>

</section>

</div>
