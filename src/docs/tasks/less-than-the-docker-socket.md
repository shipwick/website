---
title: Give the agent less than the Docker socket
description: Three arrangements that give the Shipwick agent less than the socket of a Docker daemon that runs as root — a socket proxy with a list of exactly the calls the agent makes, Docker's authorization plugin with a policy that refuses what makes a container root, and rootless Docker — with what each takes away, what it does not, what the server needs and what it was tested on.
---

# Give the agent less than the Docker socket

The standard installation gives the agent `/var/run/docker.sock` of a daemon that runs as root, which is why the [trust model](/docs/security#trust-model) starts with "the Docker socket is root". Three arrangements give it less: a socket proxy between the agent and Docker and rootless Docker, since 0.8, and since 0.9 Docker's authorization plugin with a policy of the repository's. This page sets up each, and says exactly what each does and does not protect against.

They are independent. None is what the installer sets up, and each costs something.

## Before you begin

- **A socket proxy narrows what a fault in the agent can reach. It is not a wall**: whoever takes the agent over can still create a privileged container, which is root on the server. For a server where a compromised agent must not become root, the authorization plugin or rootless Docker is what holds.
- The socket proxy's overlay needs Docker Compose 2.24.4 or newer.
- The authorization plugin is installed into the daemon, as root, and judges every client of it, your own `docker` commands included.
- Rootless Docker is set up by hand, as the user who runs the daemon. The installer is not used: it runs as root and installs into `/opt/shipwick`.
- Each is run by a script in the repository, in a Docker daemon of its own: `sh scripts/test-socket-proxy.sh`, `sh scripts/test-docker-authz.sh`, `sh scripts/test-rootless.sh`.

## Behind a socket proxy

[configs/compose.socket-proxy.yml](https://github.com/shipwick/shipwick/blob/main/configs/compose.socket-proxy.yml) puts [wollomatic/socket-proxy](https://github.com/wollomatic/socket-proxy) between the agent and Docker. The proxy holds the socket; the agent gets a second, filtered socket in a volume the two share, and no other way to Docker. The proxy has no network, no capabilities and a read-only filesystem, and answers only the requests on its list — a method and a path each — with `403` for every other.

On a server the installer set up:

```bash
cd /opt/shipwick
curl -fsSL -o compose.override.yml \
  https://raw.githubusercontent.com/shipwick/shipwick/v<version>/configs/compose.socket-proxy.yml    # or merge it into yours
docker compose up -d
```

By hand it is `docker compose -f compose.production.yml -f compose.socket-proxy.yml up -d`.

- **The file replaces the agent's list of mounts** (`!override`), which is what takes the socket away from it. Mounts of your own, such as a Docker `config.json`, go into the same list.
- **Take the file of the version the agent is.** The list is the calls that version makes; a newer agent that needs one more is refused it, which shows as `Forbidden` in a failed operation and as a `blocked request` line in `docker logs shipwick-socket-proxy-1`.
- **`SHIPWICK_SOCKET_PROXY_LOG_LEVEL=DEBUG`** in `.env` makes the proxy log every request it lets through as well; `SHIPWICK_SOCKET_PROXY_IMAGE` names another image of it than the version the file pins.

### The list

It is all the agent ever asks of Docker:

| Call | What the agent does with it |
|---|---|
| `HEAD`, `GET /_ping` | Is the daemon there, and which API version does it speak |
| `GET /info` | The server's status; the daemon's proxy, when a pull fails |
| `GET /system/df` | The sizes of volumes |
| `GET /containers/json`, `/containers/<id>/json` | The containers of an application and their state; the reverse proxy's container; its own |
| `GET /containers/<id>/logs`, `/stats` | Logs, followed or read; Caddy's access log; CPU and memory |
| `GET`, `PUT /containers/<id>/archive` | A volume read for a backup or an export, and written by a restore; the files of a static application |
| `POST /containers/create`, `/containers/<id>/start`, `/stop`, `/wait`; `DELETE /containers/<id>` | Replicas, jobs, the containers of backups |
| `POST /containers/<id>/exec`, `/exec/<id>/start`; `GET /exec/<id>/json` | Health checks by command, `backups.before`, the checks on a static folder |
| `POST /images/create`, `/images/load` | Pulling an image; an image built by the CLI, or brought by an import |
| `GET /images/json`, `/images/<name>/json`, `/images/get` | Which images are here, and their layers; an image written into an export; which image each tag names, before an archive is loaded |
| `POST /images/<id>/tag` | A tag an upload the agent refused had moved, pointed back at the image it named. Since 0.10: take the `compose.socket-proxy.yml` of this version |
| `DELETE /images/<name>` | Images no deployment can go back to; what a refused upload brought, by its ID |
| `GET /networks/<name>`, `POST /networks/create` | The networks, made at the first start |
| `POST /networks/<name>/connect`, `/disconnect` | A replica's names on the services network |
| `GET /volumes`, `POST /volumes/create`, `DELETE /volumes/<name>` | The volumes of applications |
| `POST /auth` | A registry login is tried before it is stored |

It was found by reading the agent and confirmed by recording: every operation of the repository's cycle test (`scripts/test-cycle.sh`) — deploy, rollout, rollback, stop and start, a hook, a job, a one-off command, a backup with its verification, a restore, a static folder, a built image, an export and an import, deletion — runs through the proxy with nothing refused.

### What it takes away

Everything in the Engine API that is not on the list: Swarm, plugins, builds, `commit`, `kill`, `restart`, `rename`, `update`, `export`, `top`, events, the prune endpoints, pushing and tagging images, removing networks.

And, by a check the proxy makes on the body of a request, every bind mount: a container created with a directory of the server mounted (`-v /:/host`, `--mount type=bind`), with another container's volumes (`--volumes-from`), or a volume made of a directory (`o=bind`) is refused. The agent mounts named volumes only, so the one directory the proxy is told to allow does not exist. Each of the bind mounts was tried through the filtered socket and refused, as were Swarm, plugins, `kill`, `update`, `commit`, `network rm` and `system prune` (`scripts/test-socket-proxy.sh`).

### What it does not take away

The proxy reads the path of a request and its bind mounts, and nothing else of its body. `POST /containers/create` is on the list, so whoever holds the filtered socket can create a privileged container, one in the server's process namespace with capabilities added, or one with a device of the server: each was tried and accepted, and each is root on the server.

They can also do everything the agent does, to anything: run a command in any container, the reverse proxy included; read the environment of any container, and so every secret; mount any named volume, the agent's own data among them; remove containers, images and volumes.

::: warning The proxy is not a wall between a compromised agent and the server
What it changes is narrower: a fault that makes the agent send one request it never sends is stopped and logged, the part of the Engine API it has no use for is out of reach of anything that goes wrong in it, and the paths to root that remain all go through creating a container, which is one place to look.
:::

A filter on the body of that request — no `Privileged`, no added capabilities, no devices, no namespaces of the server — is what would make it a wall. The proxy used here checks bind mounts and stops there. The other maintained one, [Tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy), filters by section of the API and would allow every call on containers once any is allowed, by its documentation. Docker's own authorization plugins see the whole request: that is the next arrangement. For a server where a compromised agent must not become root, it or rootless Docker below is what holds.

## Behind an authorization plugin

Docker asks an [authorization plugin](https://docs.docker.com/engine/extend/plugins_authorization/), when one is configured, about every request to the daemon before it acts on it — the method, the path and the body — and does what the plugin answers. Since 0.9 [configs/docker-authz.rego](https://github.com/shipwick/shipwick/blob/main/configs/docker-authz.rego) is a policy for [opa-docker-authz](https://github.com/open-policy-agent/opa-docker-authz), the Open Policy Agent's plugin, maintained since 2016 (v0.11 is of 2026-10-06). The policy allows everything except what makes a container, or a command run in one, root on the server:

- a privileged container;
- a directory of the server mounted: `Binds`, a `Mounts` entry of type `bind`, another container's volumes (`--volumes-from`), and a volume with any driver option (`docker volume create -o …`, which is how a directory of the server becomes a volume: `-o o=bind` — or, since 0.10, the same options on a container's `--mount type=volume,volume-opt=…`, which the daemon creates on the way), with one path allowed, the daemon's own socket under either of its names (`/var/run/docker.sock`, `/run/docker.sock`), which the agent's container is given and which leads back to the policy;
- a namespace of the server: `--pid`, `--net`, `--ipc`, `--userns`, `--uts` or `--cgroupns` set to `host`;
- a capability beyond Docker's default set (`--cap-add SYS_ADMIN`, `ALL`), a device, `seccomp` or `apparmor` set to `unconfined`, `label=disable`, and `systempaths=unconfined` in the form it travels in: a `MaskedPaths` or `ReadonlyPaths` list of any length, which replaces the daemon's default set (null or absent keeps it). Before 0.10 the policy looked for `systempaths=unconfined` as a `SecurityOpt` string, which no client sends;
- a privileged command in a container (`docker exec --privileged`);
- Swarm, and plugins.

Nothing in Shipwick changes for it: the compose file stays as it is, with or without the socket proxy. On the server, as root:

```bash
mkdir -p /etc/docker/policies
curl -fsSL -o /etc/docker/policies/authz.rego \
  https://raw.githubusercontent.com/shipwick/shipwick/v<version>/configs/docker-authz.rego
docker plugin install --grant-all-permissions ghcr.io/open-policy-agent/opa-docker-authz:v0.11 \
  opa-args="-policy-file /opa/policies/authz.rego"
# Add to /etc/docker/daemon.json:
#   "authorization-plugins": ["ghcr.io/open-policy-agent/opa-docker-authz:v0.11"]
kill -HUP "$(pidof dockerd)"    # the daemon reads that setting again without a restart
```

The plugin has `/etc/docker` of the server at `/opa`, read-only, and reads the policy file again for every request, so a change to the file is in effect at once.

### What it adds to the socket proxy

The body of the request. Each of these was tried through the daemon's socket and refused with `authorization denied by plugin …: request rejected by administrative policy`: `docker run --privileged`, `-v /:/host`, `--mount type=bind`, `--volumes-from`, `--pid=host`, `--net=host`, `--ipc=host`, `--cap-add SYS_ADMIN`, `--cap-add ALL`, `--device`, `--security-opt seccomp=unconfined`, `--security-opt systempaths=unconfined`, `docker exec --privileged`, `docker volume create -o type=none -o o=bind -o device=/`, `--mount type=volume,volume-opt=type=none,volume-opt=o=bind,volume-opt=device=/`, `docker swarm init`, `docker plugin ls`. `scripts/test-docker-authz.sh` installs the plugin in a daemon of its own, runs everything an installation does through it — the agent never asks for any of the above, so everything passes — and then tries each refusal. On Docker 29.9 with the plugin's v0.11.

One thing the plugin itself does not do: it decodes a request's body only when the request says `Content-Type: application/json` and nothing more, while the daemon also takes `application/json; charset=utf-8`. Sent with that header, a request for a privileged container reached the daemon with no body for the policy to see, and was accepted — tried here. The policy therefore refuses a `containers/create`, an `exec` or a `volumes/create` whose body it was not given; no Docker client sends JSON with a charset, so nothing legitimate is refused by that.

### What it costs

The policy judges every client of the daemon, not the agent alone: your own `docker run --privileged` on the server is refused, and so is a bind mount of your own — a CA file or a `config.json` in `compose.override.yml` — until its path is added to `allowed_binds` in the policy, and so is a volume of your own created with `-o`. `docker plugin` commands are refused too, so to change or remove the plugin, take it out of `daemon.json` and send the daemon `HUP` first. A policy file that is missing or unreadable makes the plugin allow every request; it refuses nothing by accident, and protects nothing by accident either. With the socket proxy or with rootless Docker in the same installation it was not run.

## Rootless Docker

A [rootless daemon](https://docs.docker.com/engine/security/rootless/) runs as an ordinary user of the server, and so does everything it starts: the agent, the proxy, the applications. Root inside a container, a privileged container, the Docker socket itself — each is that user and no more. Whoever takes over the agent has that user's files, which is all of Shipwick, its applications, their data and their secrets, and not the server.

Put `compose.production.yml` of the release, [configs/compose.rootless.yml](https://github.com/shipwick/shipwick/blob/main/configs/compose.rootless.yml) and a `.env` with `SHIPWICK_AGENT_TOKEN` (and the hostnames) into a directory of the user who runs Docker, and start it as that user:

```bash
docker compose -f compose.production.yml -f compose.rootless.yml up -d
```

The overlay mounts `$XDG_RUNTIME_DIR/docker.sock`, where a rootless daemon listens, in place of `/var/run/docker.sock`; `SHIPWICK_DOCKER_SOCKET` in `.env` names another path.

**With the socket proxy as well**, set `SHIPWICK_DOCKER_SOCKET=/run/user/<uid>/docker.sock` in `.env` and use `compose.socket-proxy.yml` instead of `compose.rootless.yml`: the proxy then holds that socket.

### What the server needs first

As root:

```bash
# Ports 80 and 443 for a process that is not root.
echo 'net.ipv4.ip_unprivileged_port_start=80' > /etc/sysctl.d/50-shipwick.conf
sysctl --system

# Limits: let the user's services have the cgroup controllers.
mkdir -p /etc/systemd/system/user@.service.d
printf '[Service]\nDelegate=cpu cpuset io memory pids\n' > /etc/systemd/system/user@.service.d/delegate.conf
systemctl daemon-reload

# The daemon, and with it every container, starts at boot and not at login.
loginctl enable-linger <user>
```

### Ports

Without the first setting the proxy does not start, and Docker says why:

```text
cannot expose privileged port 80, you can add 'net.ipv4.ip_unprivileged_port_start=80' to /etc/sysctl.conf (currently 1024), or set CAP_NET_BIND_SERVICE on rootlesskit binary, or choose a larger port number (>= 1024)
```

After a start that was refused, `docker compose up -d` again is not enough: the proxy's container was left without all of its networks and starts that way, reaching either the agent or the applications. Make it again with `docker compose … up -d --force-recreate caddy`. Since 0.9 the agent looks at the proxy's networks every half minute and says which are missing: in its log when that changes, in `GET /server` (`proxy.networks_missing`), in `shipwick server status`, and in `shipwick doctor` as a problem with that command.

The same message fails a deployment whose `publish` names a port below the setting; ports from it upwards are published as on any server.

### Limits

`resources.cpu` and `resources.memory` are enforced when the daemon has the cgroup controllers, which takes cgroup v2, systemd and the delegation above. With them a replica limited to 32 MB had 32 MB in its `memory.max`, was killed when it took more, and was reported `out of memory`, as on a rootful server.

Without them — no systemd, or no delegation — Docker accepts the limits, reports them back when asked about the container, and applies nothing; what it reports as one container's CPU and memory is then the usage of everything the daemon runs. Docker does not say so when the container is created. Shipwick does, wherever a limit is shown:

```text
$ shipwick deploy
! Docker on this server does not enforce resources.memory and resources.cpu: the replicas run without a limit. shipwick doctor says what the server lacks

$ shipwick status
Limits     0.5 CPU, 64 MB  (Docker on this server does not enforce the memory and CPU limits; see shipwick doctor)

$ shipwick server status
Docker          29.8.2, rootless; memory and CPU limits are not enforced

$ shipwick doctor
! Docker on the server is rootless and does not enforce memory and CPU limits: no replica is held to resources.memory and resources.cpu of its deploy.yaml, and the usage shown for a replica is not its own. Delegate the cpu and memory cgroup controllers to the user who runs Docker, on a server with systemd (handbook: Rootless Docker)
```

The agent's log says it at every start, and the `memory` alert is not raised on such a server: there is no limit for a replica to come close to. A rootful daemon whose kernel offers no memory controller reports itself the same way and is answered the same way, without the word "rootless"; no such server was at hand to run it on.

### The address of a client

Rootless Docker's default port forwarding hands every connection to the proxy from one address, the gateway of the proxy's network: `172.18.0.1` for a request that came from `172.17.0.11` in the test, where a rootful daemon passed `172.17.0.11` on. Everything that keeps a client's address therefore keeps that one: the `FROM` column of the [audit trail](/docs/tasks/audit), and the client of the [requests the proxy logs](/docs/tasks/traffic) for an application.

Docker's documentation names another port driver, `slirp4netns`, as the one that keeps the address, at a cost in throughput. In the containers this was tested in, connections from outside did not arrive with it, so it is not confirmed here.

### What works as on any server

Deployments, rollouts and rollbacks; the application networks, the names replicas carry on the services network, leaving and joining it; health checks from the agent; published ports; volumes, backups with their verification, restores, exports and imports; static folders; images built by the CLI; jobs and one-off commands; the server's memory, swap and disk in `shipwick server status`, which are the server's and not the user's. Volumes are under the user's `~/.local/share/docker/volumes`. After the daemon was restarted, the agent, the proxy and the applications came back by themselves.

### Not covered

- **The agent as a service of the host**, as the `.deb` and `.rpm` install it, was not run against a rootless daemon, and is not expected to work: container networks are inside the daemon's own network namespace, where a process of the host cannot reach a replica for its health check.
- **A reboot of a real server**, and SELinux or AppArmor in enforcing mode, were not tried.

### Tested on

Docker 29.8.2 rootless (RootlessKit 3.1.0, Compose 5.5 and 5.6) on a 6.18 kernel with cgroup v2, in two privileged containers: the `docker:dind-rootless` image, which has no systemd and therefore no controllers, and Debian 12 with systemd 252 and the delegation above. Not on a server or a virtual machine of its own. `scripts/test-rootless.sh` runs the first of the two, alone and with `--socket-proxy`.

## What's next

- [Security](/docs/security): the trust model these arrangements narrow, and [who can reach the API](/docs/security#who-can-reach-the-api).
- [Resource limits and metrics](/docs/concepts/resources#limits-that-are-not-enforced): what a limit that is not enforced means for an application.
- [Install Shipwick on a server](/docs/getting-started/install#the-compose-file-by-hand): the compose file, by hand.
- [`shipwick doctor`](/docs/reference/cli#doctor) in the CLI reference.
