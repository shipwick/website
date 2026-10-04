---
title: Give the agent less than the Docker socket
description: Two arrangements that give the Shipwick agent less than the socket of a Docker daemon that runs as root — a socket proxy with a list of exactly the calls the agent makes, and rootless Docker — with what each takes away, what it does not, what the server needs and what it was tested on.
---

# Give the agent less than the Docker socket

The standard installation gives the agent `/var/run/docker.sock` of a daemon that runs as root, which is why the [trust model](/docs/security#trust-model) starts with "the Docker socket is root". Since 0.8 two arrangements give it less: a socket proxy between the agent and Docker, and rootless Docker. This page sets up each, and says exactly what each does and does not protect against.

They are independent and can be combined. Neither is what the installer sets up, and each costs something.

## Before you begin

- **A socket proxy narrows what a fault in the agent can reach. It is not a wall**: whoever takes the agent over can still create a privileged container, which is root on the server. For a server where a compromised agent must not become root, rootless Docker is the arrangement that holds.
- The socket proxy's overlay needs Docker Compose 2.24.4 or newer.
- Rootless Docker is set up by hand, as the user who runs the daemon. The installer is not used: it runs as root and installs into `/opt/shipwick`.
- Both are run by a script in the repository, in a Docker daemon of its own: `sh scripts/test-socket-proxy.sh`, `sh scripts/test-rootless.sh`.

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
| `GET /images/json`, `/images/<name>/json`, `/images/get` | Which images are here, and their layers; an image written into an export |
| `DELETE /images/<name>` | Images no deployment can go back to |
| `GET /networks/<name>`, `POST /networks/create` | The networks, made at the first start |
| `POST /networks/<name>/connect`, `/disconnect` | A replica's names on the services network |
| `GET /volumes`, `POST /volumes/create`, `DELETE /volumes/<name>` | The volumes of applications |
| `POST /auth` | A registry login is tried before it is stored |

It was found by reading the agent and confirmed by recording: the integration tests and every operation of the repository's cycle test — deploy, rollout, rollback, stop and start, a hook, a job, a one-off command, a backup with its verification, a restore, a static folder, a built image, an export and an import, deletion — run through the proxy with nothing refused.

### What it takes away

Everything in the Engine API that is not on the list: Swarm, plugins, builds, `commit`, `kill`, `restart`, `rename`, `update`, `export`, `top`, events, the prune endpoints, pushing and tagging images, removing networks.

And, by a check the proxy makes on the body of a request, every bind mount: a container created with a directory of the server mounted (`-v /:/host`, `--mount type=bind`), with another container's volumes (`--volumes-from`), or a volume made of a directory (`o=bind`) is refused. The agent mounts named volumes only, so the one directory the proxy is told to allow does not exist. Each of these was tried through the filtered socket and refused.

### What it does not take away

The proxy reads the path of a request and its bind mounts, and nothing else of its body. `POST /containers/create` is on the list, so whoever holds the filtered socket can create a privileged container, one in the server's process namespace with capabilities added, or one with a device of the server: each was tried and accepted, and each is root on the server.

They can also do everything the agent does, to anything: run a command in any container, the reverse proxy included; read the environment of any container, and so every secret; mount any named volume, the agent's own data among them; remove containers, images and volumes.

::: warning The proxy is not a wall between a compromised agent and the server
What it changes is narrower: a fault that makes the agent send one request it never sends is stopped and logged, the part of the Engine API it has no use for is out of reach of anything that goes wrong in it, and the paths to root that remain all go through creating a container, which is one place to look.
:::

A filter on the body of that request — no `Privileged`, no added capabilities, no devices, no namespaces of the server — is what would make it a wall. The proxy used here checks bind mounts and stops there. The other maintained one, [Tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy), filters by section of the API and would allow every call on containers once any is allowed, by its documentation. Docker's own authorization plugins see the whole request, and apply to every client of the daemon, your own `docker` commands included; none was tried here.

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

After a start that was refused, `docker compose up -d` again is not enough: the proxy's container was left without all of its networks and starts that way, reaching either the agent or the applications. Make it again with `docker compose … up -d --force-recreate caddy`.

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
