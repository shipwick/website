---
title: From Docker Compose
description: Move an application from a docker-compose.yml on a server to Shipwick - what each part of the Compose file becomes in deploy.yaml or shipwick.yaml, what has no equivalent and why, and a complete three-service example that validates.
---

# From Docker Compose

The commonest starting point is a `docker-compose.yml` on a server, started by hand over SSH and kept running by Docker's restart policy. This page takes such a file apart and says what each part becomes in Shipwick: a Compose service is an application, described by a `deploy.yaml` of its own or as one entry of a `shipwick.yaml`, and most keys have a counterpart with a different name and a few stricter rules. Some have none, and the page says why. It ends with a three-service Compose file and the `shipwick.yaml` that replaces it, both complete and checked with `shipwick validate`.

## Before you begin

- A server with Shipwick installed, and the CLI on your machine; see [Install on a server](/docs/getting-started/install). Shipwick's proxy takes ports 80 and 443, so a Compose stack that publishes them has to be stopped before the first deployment.
- Images come from a registry the server can pull from, or are built from a Dockerfile on your machine by `shipwick deploy` and sent to the server. A Compose service with `build:` keeps its Dockerfile; nothing is built on the server.
- A DNS record for every hostname an application is to be served at. Shipwick serves HTTPS and obtains the certificates; see [Routing and HTTPS](/docs/concepts/routing-and-https).

## Two files

A `deploy.yaml` describes one application. A `shipwick.yaml` describes several: an `apps` list in which every entry is a complete `deploy.yaml` plus `after`, the names of the entries that must have deployed before this one starts. A Compose file with one service becomes a `deploy.yaml`; one with several becomes a `shipwick.yaml`, or one `deploy.yaml` per service in a directory each, deployed with `shipwick deploy -f a/deploy.yaml -f b/deploy.yaml` in order. Either way the agent knows only applications: a `shipwick.yaml` is cut into one document per entry before it is sent. See [Several applications](/docs/reference/deploy-yaml#several-applications-shipwick-yaml).

Only `name` and `image` — or `build` in its place — are required. Everything else has a default.

## What each part becomes

| Compose | Shipwick | |
|---|---|---|
| `services.<name>` | `name` | The service's key is the application's name: lowercase letters, digits and dashes, at most 63 characters. `container_name` and `hostname` fall away: the name is the hostname other applications use |
| `image` | `image` | Any image reference. Its tag is the deployment's version, so prefer a tag to `latest` |
| `build` | `build` | `build: .`, or `{context, dockerfile}`. Built on your machine by `shipwick deploy` and sent to the server. No `image` next to it; `args` has no counterpart |
| `ports` | `domain` and `port`, or `publish` | For HTTP, a hostname: the proxy serves it over HTTPS and no host port is opened. For anything else, `publish` opens a port of the server |
| `expose` | `port` | The port the application listens on. Other applications reach it there by name |
| `environment` | `env` | The same map. Secrets as `${NAME}`, stored on the server |
| `env_file` | `env` with `${NAME}`, and `--env-file` | Each variable the application needs is listed under `env`; the file fills in the placeholders where `shipwick` runs, or the server does from its secrets |
| `secrets` | `${NAME}` and `shipwick secret set` | A value stored on the server once, encrypted, filled in when you deploy |
| `volumes` (named) | `volumes[].name` / `path` | Named volumes only; needs `deploy.strategy: recreate` and one replica |
| `volumes` (bind mount) | — | The agent mounts nothing of the server into a container; see below |
| `tmpfs`, `read_only` | `security.tmpfs`, `security.read_only` | Directories kept in memory; a root filesystem that cannot be written |
| `depends_on` | `after` | In `shipwick.yaml` only: the entries that must have deployed first. `condition: service_healthy` is what `after` means |
| `healthcheck` | `health` | `test` becomes `path`, `tcp` or `command`; `interval`, `timeout`, `retries` and `start_period` keep their names |
| `restart` | `restart.policy` | `always` (the default), `on-failure` or `never`; `unless-stopped` is `always`. Restarts are the supervisor's, not Docker's |
| `command`, `entrypoint`, `user` | the same | Lists of arguments; a string is one argument |
| `init` | `init` | `true` puts Docker's init process first |
| `deploy.replicas` | `replicas` | 1–50, and 1 with `volumes` or `publish` |
| `deploy.resources.limits`, `mem_limit`, `cpus` | `resources.cpu`, `resources.memory` | Limits per replica: `cpu: 0.5`, `memory: 512mb`. Reservations have no counterpart |
| `deploy.update_config` | `deploy.strategy` | `rolling`, the default, replaces replicas one at a time; `recreate` stops the old version first |
| `stop_grace_period` | `deploy.stop_timeout` | Between `SIGTERM` and `SIGKILL`, 1s–10m, default `10s` |
| `logging` | `logging` | The driver and its options, as given |
| `cap_drop` | `security.capabilities` | `none`, or the capabilities to keep; the key only takes away |
| `networks` | — | Nothing to write: every application is reachable by name on one shared network |
| `cap_add`, `privileged`, `network_mode: host`, `pid: host`, `devices`, `sysctls`, `extra_hosts`, `dns`, `labels`, `profiles` | — | No equivalent; see [What has no equivalent](#what-has-no-equivalent) |

The rules of every key are in the [deploy.yaml reference](/docs/reference/deploy-yaml). The parts that change meaning, not only name, follow.

## ports: a hostname, or a published port

A Compose service that is a web application publishes a port, `"8080:80"`, and something in front of it — or nothing — handles HTTPS. In Shipwick an HTTP application gets a hostname instead. The proxy serves it over HTTPS, obtains the certificate and finds the replicas by name; no port of the server is opened for it:

```yaml
port: 80                 # what the container listens on
domain: app.example.com  # what the proxy serves it at
```

A service that is not HTTP — a database a laptop connects to, a game server — is published on the server's own ports with `publish`. Each entry names the container port and, optionally, the server's port, the address to bind and the protocol:

```yaml
publish:
  - port: 5432
    host: 15432          # default: the same as port
    address: 10.0.0.5    # default: every address of the server
    protocol: tcp        # or udp
```

Publishing needs `deploy.strategy: recreate` and one replica, because a server port has one holder; 80 and 443 are the proxy's and are refused. A published port bypasses the host firewall the way it does under Compose, since both are Docker's `-p`. See [Expose a service that is not HTTP](/docs/tasks/non-http-services).

## environment and env_file: secrets become ${NAME}

`environment` is `env`, the same map. The difference is what happens to a password. A Compose `.env` or `env_file` sits on the server next to the file, in clear. Here a value that must not be in the file is written as `${NAME}` and stored on the server once, encrypted; the agent fills it in when it records the deployment, and nothing on your machine or in the repository holds it:

```yaml
env:
  DATABASE_URL: postgres://app:${DATABASE_PASSWORD}@db:5432/app
  STRIPE_KEY: ${STRIPE_KEY}
```

```bash
shipwick secret set DATABASE_PASSWORD --app api   # asks for the value without echo; or pipe it in
shipwick secret set STRIPE_KEY --app api
```

Or keep the `.env` you have and pass it where `shipwick` runs: `shipwick deploy --env-file .env` fills in every `${NAME}` the file has a value for before the document is sent. Two things differ from Compose's `env_file`: only the variables you list under `env` reach the container, the file does not go in whole; and a name that is set nowhere is an error, never an empty value. `$${NAME}` is a literal `${NAME}`. The rules are under [Placeholders](/docs/reference/cli#placeholders), and the server's side under [Keep secrets on the server](/docs/tasks/secrets).

## volumes: named only

A named volume maps directly. `pgdata:/var/lib/postgresql/data` under a service, with `pgdata:` in the top-level `volumes`, becomes:

```yaml
volumes:
  - name: pgdata
    path: /var/lib/postgresql/data
deploy:
  strategy: recreate
```

The volume is the Docker volume `shipwick_<application>_<name>` on the server. It belongs to the application, not to a deployment: a redeploy, a rollback and `shipwick delete` leave it alone. An application with volumes needs `deploy.strategy: recreate` and one replica, because two versions of a database must not write the same files at once; see [Run a stateful application](/docs/tasks/stateful-applications). To bring the data of an existing Compose volume over, archive it and put it into the new volume with `shipwick restore`; see [Restore an archive from your machine](/docs/tasks/backups#restore-an-archive-from-your-machine).

A bind mount — `./config:/etc/app:ro`, `/var/run/docker.sock:/var/run/docker.sock` — has no equivalent, and a path written where a name goes is refused:

```text
invalid deploy.yaml

volumes[0].name:
  invalid value "./config"
  expected: lowercase letters, digits and dashes, e.g. data
```

The reason is who may deploy. Whoever can send a `deploy.yaml` to the agent can run containers on your server, and a key that mounted a path of the server would let them read or write any file on it: the agent's data directory, the proxy's certificates, the Docker socket itself. So the agent mounts nothing of the host into any container, for every application and without a switch; see [Unprivileged containers](/docs/security#unprivileged-containers). A configuration file the application reads is built into the image with `COPY`, or handed over as `env`; scratch space that need not survive is a `tmpfs` entry under `security`; data that must survive is a named volume.

## depends_on becomes after

`depends_on` is about start order, and `condition: service_healthy` about readiness. `after`, in a `shipwick.yaml`, is the second thing: the entries it names must have deployed, which means their replicas passed their health checks, before this one starts. If one of them fails, this one is skipped and the command exits non-zero.

```yaml
apps:
  - name: db
    # ...
  - name: api
    after: [db]
```

`after` is needed less often than `depends_on`. Names on the services network resolve whatever the order, so an application that retries its database connection needs no `after`; one that exits when the database is not there at startup does. See [Call one application from another](/docs/tasks/call-another-application).

## healthcheck becomes health

The same four timings, and one of three checks in place of `test`:

| Compose `test` | `health` |
|---|---|
| An HTTP endpoint, `curl -f http://localhost/health` | `path: /health`: the agent asks the replica itself; no `curl` in the image needed |
| A port that must accept a connection | `tcp: 5432` |
| `["CMD", "pg_isready", "-U", "postgres"]` | `command: ["pg_isready", "-U", "postgres"]` |
| `["CMD-SHELL", "pg_isready -U postgres"]` | The same list, without the shell: `command: ["pg_isready", "-U", "postgres"]`. Nothing in `deploy.yaml` runs through a shell, so a `test` that needs one is rewritten as arguments |

`interval`, `timeout`, `retries` and `start_period` keep their names, with defaults of `10s`, `3s`, `3` and `0s`. A health check does more here than under Compose: a deployment replaces a replica only once the new one has passed it, a replica carries the application's name on the network only while it passes, and a failing replica is restarted by the supervisor. See [Health checks and supervision](/docs/concepts/health-and-supervision).

## restart becomes the supervisor

`restart: always` and `restart: unless-stopped` are `restart.policy: always`, the default; `on-failure` stays `on-failure`; `restart: "no"` is `never`. Docker's own restart policy is turned off on every container Shipwick creates: restarts are the supervisor's, with backoff, crash-loop detection and an event for each. After a reboot the agent starts the applications again according to their policy; with `on-failure`, a process that exits with 0 when asked to stop is left stopped, as Docker's `on-failure` would leave it. See [Restart policy](/docs/concepts/health-and-supervision#restart-policy).

## command, entrypoint and user

The same three, the way `docker run --entrypoint`, its trailing arguments and `--user` work. Each is a list of arguments passed as written. A string is one argument, spaces included: `command: node worker.js` starts a program called `node worker.js`. Compose's string form, which it splits like a shell, has to be written out:

```yaml
command: ["node", "worker.js"]
user: "1000:1000"
```

## networks: nothing to write

Compose puts a project's services on a network of their own and makes each reachable by its service name. Shipwick does the same for every application on the server, without a key: an application with a `port` is reachable by the others at `http://<name>:<port>`, by its `deploy.yaml` name. `db` in the example below is `db:5432` to `api`, exactly as under Compose. The name is carried by a replica while it is ready, so a failing replica drops out of it. See [Call one application from another](/docs/tasks/call-another-application).

Two differences. There is one network for all applications: a Compose setup with a network per project separated them, Shipwick does not, and every application can reach every other by name. And `agent`, `caddy`, `dashboard` and `localhost` are taken; a service with one of those names is renamed.

## Resource limits

`deploy.resources.limits.cpus` and `memory`, or the older `cpus` and `mem_limit`, become `resources.cpu` and `resources.memory`, per replica, with a hard memory cap that swap does not extend:

```yaml
resources:
  cpu: 1
  memory: 512mb
```

Reservations have no counterpart. See [Resource limits and metrics](/docs/concepts/resources).

## What has no equivalent

Every container Shipwick creates is unprivileged, runs with `no-new-privileges`, mounts nothing of the server, and publishes no port unless `publish` lists it. There is no key that widens that, for any application, so a `deploy.yaml` cannot ask for what these Compose keys ask for:

- **Bind mounts**, including the Docker socket: see [volumes](#volumes-named-only).
- **`privileged`, `cap_add`**: `security.capabilities` only drops capabilities from Docker's default set, it never adds one.
- **`network_mode: host`, `pid: host`, `ipc: host`**: a container shares nothing of the server's namespaces.
- **`devices`, `sysctls`, `ulimits`, `extra_hosts`, `dns`**: not available.
- **`build.args`**: a build takes the Dockerfile as it is. A value the build needs is written in the Dockerfile; a value the application needs at run time is `env`.
- **`labels`, `profiles`, `x-*` extensions**: not read.

An application that needs one of these does not fit a server that runs other people's deployments next to it, and does not fit Shipwick; see [Security](/docs/security#unprivileged-containers) for what a container goes without and why.

## A worked example

A Compose file with a database, an API built from a Dockerfile and a frontend image, with the API's secret in an `.env` next to it:

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  api:
    build: ./api
    environment:
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@db:5432/postgres
    env_file: .env                # STRIPE_KEY=…
    ports:
      - "8080:8080"
    depends_on:
      db:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: "1"
          memory: 512M
    restart: unless-stopped

  web:
    image: ghcr.io/company/web:2.3.0
    environment:
      API_URL: http://api:8080
    ports:
      - "80:3000"
    depends_on: [api]
    restart: unless-stopped

volumes:
  pgdata:
```

The same three services as a `shipwick.yaml`, next to the `api/` directory with its Dockerfile:

```yaml
# shipwick.yaml
apps:
  - name: db
    image: postgres:17
    port: 5432
    env:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - name: pgdata
        path: /var/lib/postgresql/data
    health:
      command: ["pg_isready", "-U", "postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      strategy: recreate

  - name: api
    build: ./api
    port: 8080
    domain: api.example.com
    env:
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@db:5432/postgres
      STRIPE_KEY: ${STRIPE_KEY}
    health:
      path: /health
    resources:
      cpu: 1
      memory: 512mb
    after: [db]

  - name: web
    image: ghcr.io/company/web:2.3.0
    port: 3000
    domain: example.com
    redirects: [www.example.com]
    env:
      API_URL: http://api:8080
```

What changed, service by service:

- **`db`** gets a `port`, so that `api` finds it at `db:5432`; the volume is named; `CMD-SHELL` became a list; `recreate` is required by the volume. `restart: unless-stopped` is the default and is left out.
- **`api`** gets a hostname in place of the published port; the two secrets are `${NAME}` placeholders; `depends_on` with `service_healthy` is `after: [db]`; the limits move to `resources`; a health check is added, which `shipwick deploy` uses to decide whether the new version may take traffic.
- **`web`** gets `example.com` in place of port 80, and `www.example.com` redirected to it, which the Compose file had nowhere to say. `API_URL` is unchanged: the name resolves the same way.

Store the two secrets on the server, `POSTGRES_PASSWORD` for both applications that use it and `STRIPE_KEY` for the API alone, then check the file:

```bash
shipwick secret set POSTGRES_PASSWORD           # the server's: db and api both refer to it
shipwick secret set STRIPE_KEY --app api
shipwick validate
```

```text
✓ shipwick.yaml is valid (2 variables left to the server)

db
api  after db
web

Name           db
Image          postgres:17
Version        17
Replicas       1
Port           5432
Health check   command pg_isready -U postgres every 10s (timeout 5s, 5 retries)
Resources      unlimited CPU, unlimited memory
Volume         pgdata at /var/lib/postgresql/data
Restart        always
Strategy       recreate
Environment    1 variables

Name           api
Build          api/ (Dockerfile)
Replicas       1
Port           8080
Domain         api.example.com
Health check   GET /health every 10s (timeout 3s, 3 retries)
Resources      1 CPU, 512 MB
Restart        always
Environment    2 variables

Name          web
Image         ghcr.io/company/web:2.3.0
Version       2.3.0
Replicas      1
Port          3000
Domain        example.com
Redirects     www.example.com → https://example.com
Resources     unlimited CPU, unlimited memory
Restart       always
Environment   1 variables
```

The three lines after the first are the order: `db` and `web` start together, `api` once `db` has deployed. Then, with the DNS records for `api.example.com`, `example.com` and `www.example.com` pointing at the server and the Compose stack stopped:

```bash
shipwick deploy
```

`shipwick deploy` builds `api` on your machine, sends the image to the server, pulls the other two, and deploys them in that order, each line of output prefixed with the application's name. From then on, a change to the API is `shipwick deploy api`, and nothing else in the file is touched. The volume `shipwick_db_pgdata` starts empty; to carry the data over from the Compose volume, archive it and restore it as described under [Restore an archive from your machine](/docs/tasks/backups#restore-an-archive-from-your-machine).

## What's next

- [Several applications](/docs/reference/deploy-yaml#several-applications-shipwick-yaml): the rules of `shipwick.yaml`, and `shipwick init` next to one.
- [Run a stateful application](/docs/tasks/stateful-applications): the database, its backups, and reaching it from the other applications.
- [Keep secrets on the server](/docs/tasks/secrets): where the `.env` file's values go.
- [Deploy from CI](/docs/tasks/deploy-from-ci): the pipeline that replaces `ssh` and `docker compose up -d`.
- [Security](/docs/security#unprivileged-containers): what a container goes without, and why there is no key for it.
