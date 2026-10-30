---
title: The Docker socket
description: How the Shipwick agent reaches Docker since 1.1 — through a socket proxy that answers exactly the calls the agent makes, in every installation the installer sets up — what the proxy refuses and what it does not, the overlay that gives the agent the socket itself, Docker's authorization plugin with a policy that refuses what makes a container root, rootless Docker, and what each was tested on.
---

# The Docker socket

The Docker daemon of a server runs as root, and its socket is root to whoever holds it. Since 1.1, in every installation the installer sets up, the agent does not hold it: a socket proxy holds the socket and answers the agent the calls on its list, and the agent has no other way to the daemon. Before 1.1 the agent had `/var/run/docker.sock` itself, and the proxy was an overlay to put in by hand.

That is the default, and the rest of this page is what stands around it: the overlay that gives the agent the socket itself, for the few servers that want it; Docker's authorization plugin, which reads what the proxy cannot and is what refuses a compromised agent root; and rootless Docker, where root is nobody's. Each is run by a script in the repository, in a Docker daemon of its own: `sh scripts/test-socket-proxy.sh`, `sh scripts/test-docker-authz.sh`, `sh scripts/test-rootless.sh`.

The agent says how it reaches Docker, read off the address it was given: `docker.socket` in [`GET /server`](/docs/reference/api#get-server) is `"proxy"` or `"direct"`, [`shipwick server status`](/docs/reference/cli#server-status) ends its Docker line with `behind the socket proxy` or `holding the Docker socket`, and [`shipwick doctor`](/docs/reference/cli#doctor) has a hint for the second and nothing for the first. An agent before 1.1 says nothing, which is not a claim either way.

## Before you begin

- **The socket proxy narrows what a fault in the agent can reach. It is not a wall**: whoever takes the agent over can still create a privileged container, which is root on the server. For a server where a compromised agent must not become root, the authorization plugin or rootless Docker is what holds. The [trust model](/docs/security#trust-model) still begins with "an admin token is root on the server" for that reason.
- Nothing is to be done for the proxy: a new server has it from the installer, and a server that ran without it gains it on its next [upgrade](/docs/tasks/upgrade#upgrading-from-1-0-to-1-1).
- The overlay that takes the proxy out again needs Docker Compose 2.24.4 or newer.
- The authorization plugin is installed into the daemon, as root, and judges every client of it, your own `docker` commands included.
- Rootless Docker is set up by hand, as the user who runs the daemon. The installer is not used: it runs as root and installs into `/opt/shipwick`.

## The socket proxy

[configs/compose.production.yml](https://github.com/shipwick/shipwick/blob/main/configs/compose.production.yml) runs [wollomatic/socket-proxy](https://github.com/wollomatic/socket-proxy) as a fourth container, `socket-proxy`, between the agent and Docker. The proxy holds `/var/run/docker.sock`; the agent gets a second, filtered socket in a volume the two share (`DOCKER_HOST=unix:///run/docker-proxy/docker.sock`), and no other way to Docker. The proxy has no network, no capabilities and a read-only filesystem, and answers only the requests on its list — a method and a path each — with `403` for every other.

Nothing is to be done for it: a new server has it from the installer, and a server that ran without it gains it on its next upgrade, since the installer replaces `compose.yml`. A server that had put the proxy in by hand, with the `compose.socket-proxy.yml` of 0.8 to 1.0 as its `compose.override.yml`, keeps running — Compose merges the two definitions — and the installer says to take the `socket-proxy` service and the `docker-proxy` volume out of the override: the override's list of calls replaces the release's, and an agent that makes one call more is refused it by the older list, which shows as `Forbidden` in a failed operation and as a `blocked request` line in `docker logs shipwick-socket-proxy-1`. See [Upgrading from 1.0 to 1.1](/docs/tasks/upgrade#upgrading-from-1-0-to-1-1).

- **Mounts of your own**, such as a Docker `config.json` or a CA file, go into the agent's `volumes` in `compose.override.yml` as before.
- **`SHIPWICK_SOCKET_PROXY_LOG_LEVEL=DEBUG`** in `.env` makes the proxy log every request it lets through as well; `SHIPWICK_SOCKET_PROXY_IMAGE` names another image of it than the version the file pins, and the installer keeps the setting across upgrades. See [Agent configuration](/docs/reference/agent-configuration#the-production-compose-file).
- **The image is pulled from Docker Hub**, and held against the digests the release published like Shipwick's own three; a [bundle](/docs/tasks/corporate-network#install-on-a-server-with-no-way-out) for a server with no way out carries it.

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
| `POST /images/<id>/tag` | A tag an upload the agent refused had moved, pointed back at the image it named |
| `DELETE /images/<name>` | Images no deployment can go back to; what a refused upload brought, by its ID |
| `GET /networks/<name>`, `POST /networks/create` | The two networks, made at the first start; at every start, the subnets the API may be called from |
| `POST /networks/<name>/connect`, `/disconnect` | A replica's names on the services network |
| `GET /volumes`, `POST /volumes/create`, `DELETE /volumes/<name>` | The volumes of applications |
| `POST /auth` | A registry login is tried before it is stored |

It was found by reading the agent and confirmed by recording: every operation of the repository's cycle test (`scripts/test-cycle.sh`) — deploy, rollout, rollback, stop and start, a hook, a job, a one-off command, a backup with its verification, a restore, a static folder, a built image, an export and an import, deletion — runs through the proxy with nothing refused, and the development stack runs the same service, so a call the list lacks is refused on the developer's machine first.

### What it takes away

Everything in the Engine API that is not on the list: Swarm, plugins, builds, `commit`, `kill`, `restart`, `rename`, `update`, `export`, `top`, events, the prune endpoints, pushing and tagging images, removing networks.

And, by a check the proxy makes on the body of a request, every bind mount: a container created with a directory of the server mounted (`-v /:/host`, `--mount type=bind`), with another container's volumes (`--volumes-from`), or a volume made of a directory (`o=bind`) is refused. The agent mounts named volumes only, so the one directory the proxy is told to allow does not exist. Each of the bind mounts was tried through the filtered socket and refused, as were Swarm, plugins, `kill`, `update`, `commit`, `network rm` and `system prune` (`scripts/test-socket-proxy.sh`).

### What it does not take away

The proxy reads the path of a request and its bind mounts, and nothing else of its body. `POST /containers/create` is on the list, so whoever holds the filtered socket can create a privileged container, one in the server's process namespace with capabilities added, or one with a device of the server: each was tried and accepted, and each is root on the server.

They can also do everything the agent does, to anything: run a command in any container, the reverse proxy included; read the environment of any container, and so every secret; mount any named volume, the agent's own data among them; remove containers, images and volumes.

::: warning The proxy is not a wall between a compromised agent and the server
What it changes is narrower: a fault that makes the agent send one request it never sends is stopped and logged, the part of the Engine API it has no use for is out of reach of anything that goes wrong in it, and the paths to root that remain all go through creating a container, which is one place to look.
:::

A filter on the body of that request — no `Privileged`, no added capabilities, no devices, no namespaces of the server — is what would make it a wall. The proxy used here checks bind mounts and stops there. The other maintained one, [Tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy), filters by section of the API and would allow every call on containers once any is allowed, by its documentation. Docker's own authorization plugins see the whole request: that is the [further step below](#behind-an-authorization-plugin). For a server where a compromised agent must not become root, it or rootless Docker is what holds.

## The socket itself

[configs/compose.direct-socket.yml](https://github.com/shipwick/shipwick/blob/main/configs/compose.direct-socket.yml) takes the proxy out and gives the agent `/var/run/docker.sock`, the way every installation before 1.1 had it. The agent needs nothing the proxy refuses, so the reasons are few: a daemon reached at an address of your own rather than a socket (`DOCKER_HOST` in a `compose.override.yml`, which the proxy cannot forward to), or a server where one container fewer weighs more than the list. The cost is the list: whoever takes over the agent has the whole Engine API instead of the calls above.

On a server the installer set up:

```bash
cd /opt/shipwick
curl -fsSL -o compose.override.yml \
  https://raw.githubusercontent.com/shipwick/shipwick/v<version>/configs/compose.direct-socket.yml    # or merge it into yours
docker compose up -d --remove-orphans    # removes the proxy's container as well
```

By hand it is `docker compose -f compose.production.yml -f compose.direct-socket.yml up -d --remove-orphans`.

- **The overlay replaces the agent's list of mounts** (`!override`) and removes the proxy's service (`!reset`), both of which take Docker Compose 2.24.4 or newer. Mounts of your own go into the same list.
- **The installer leaves the override alone on an upgrade**, so the choice holds.
- **`SHIPWICK_DOCKER_SOCKET`** in `.env` names the daemon's socket when it is elsewhere than `/var/run/docker.sock`.

The agent says what it has: `shipwick server status` ends its Docker line with `holding the Docker socket`, `GET /server` carries `docker.socket: "direct"`, and `shipwick doctor` prints a hint that names this overlay and the package as the two places this is expected:

```text
! The agent holds the Docker socket itself, and whoever takes it over has the whole Engine API. The default installation puts a filtered socket between the agent and Docker: on a server the installer set up, take compose.direct-socket.yml out of compose.override.yml and run docker compose up -d there; an agent installed from a package holds the socket by design (handbook: The Docker socket)
```

An agent installed [from a package](/docs/getting-started/install-from-a-package#the-agent-runs-as-root) holds the socket the same way, and for a reason of its own: it is a process of the host, with no compose file of the installer's to put a container between it and the daemon.

## Behind an authorization plugin

Docker asks an [authorization plugin](https://docs.docker.com/engine/extend/plugins_authorization/), when one is configured, about every request to the daemon before it acts on it — the method, the path and the body — and does what the plugin answers. Since 0.9 [configs/docker-authz.rego](https://github.com/shipwick/shipwick/blob/main/configs/docker-authz.rego) is a policy for [opa-docker-authz](https://github.com/open-policy-agent/opa-docker-authz), the Open Policy Agent's plugin, maintained since 2016 (v0.11 is of 2026-10-06). The policy allows everything except what makes a container, or a command run in one, root on the server:

- a privileged container;
- a directory of the server mounted: `Binds`, a `Mounts` entry of type `bind`, another container's volumes (`--volumes-from`), and a volume with any driver option (`docker volume create -o …`, which is how a directory of the server becomes a volume: `-o o=bind` — or, since 0.10, the same options on a container's `--mount type=volume,volume-opt=…`, which the daemon creates on the way), with one path allowed, the daemon's own socket under either of its names (`/var/run/docker.sock`, `/run/docker.sock`), which the socket proxy's container is given and which leads back to the policy;
- a namespace of the server: `--pid`, `--net`, `--ipc`, `--userns`, `--uts` or `--cgroupns` set to `host`;
- a capability beyond Docker's default set (`--cap-add SYS_ADMIN`, `ALL`), a device, `seccomp` or `apparmor` set to `unconfined`, `label=disable`, and `systempaths=unconfined` in the form it travels in: a `MaskedPaths` or `ReadonlyPaths` list of any length, which replaces the daemon's default set (null or absent keeps it). Before 0.10 the policy looked for `systempaths=unconfined` as a `SecurityOpt` string, which no client sends;
- a privileged command in a container (`docker exec --privileged`);
- Swarm, and plugins.

Nothing in Shipwick changes for it: the compose file stays as it is, the socket proxy in front of the agent included — the plugin sits at the daemon and judges the proxy's requests like everyone's. On the server, as root:

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

The body of the request. Each of these was tried through the daemon's socket and refused with `authorization denied by plugin …: request rejected by administrative policy`: `docker run --privileged`, `-v /:/host`, `--mount type=bind`, `--volumes-from`, `--pid=host`, `--net=host`, `--ipc=host`, `--cap-add SYS_ADMIN`, `--cap-add ALL`, `--device`, `--security-opt seccomp=unconfined`, `--security-opt systempaths=unconfined`, `docker exec --privileged`, `docker volume create -o type=none -o o=bind -o device=/`, `--mount type=volume,volume-opt=type=none,volume-opt=o=bind,volume-opt=device=/`, `docker swarm init`, `docker plugin ls`. `scripts/test-docker-authz.sh` installs the plugin in a daemon of its own, runs everything an installation does through it, the agent behind the socket proxy as on every server — the agent never asks for any of the above, so everything passes — and then tries each refusal. On Docker 29.9 with the plugin's v0.11.

One thing the plugin itself does not do: it decodes a request's body only when the request says `Content-Type: application/json` and nothing more, while the daemon also takes `application/json; charset=utf-8`. Sent with that header, a request for a privileged container reached the daemon with no body for the policy to see, and was accepted — tried here. The policy therefore refuses a `containers/create`, an `exec` or a `volumes/create` whose body it was not given; no Docker client sends JSON with a charset, so nothing legitimate is refused by that.

### What it costs

The policy judges every client of the daemon, not the agent alone: your own `docker run --privileged` on the server is refused, and so is a bind mount of your own — a CA file or a `config.json` in `compose.override.yml` — until its path is added to `allowed_binds` in the policy, and so is a volume of your own created with `-o`. `docker plugin` commands are refused too, so to change or remove the plugin, take it out of `daemon.json` and send the daemon `HUP` first. A policy file that is missing or unreadable makes the plugin allow every request; it refuses nothing by accident, and protects nothing by accident either. With rootless Docker in the same installation it was not run.

## Rootless Docker

A [rootless daemon](https://docs.docker.com/engine/security/rootless/) runs as an ordinary user of the server, and so does everything it starts: the agent, the socket proxy, the reverse proxy, the applications. Root inside a container, a privileged container, the Docker socket itself — each is that user and no more. Whoever takes over the agent has that user's files, which is all of Shipwick, its applications, their data and their secrets, and not the server.

Put `compose.production.yml` of the release, [configs/compose.rootless.yml](https://github.com/shipwick/shipwick/blob/main/configs/compose.rootless.yml) and a `.env` with `SHIPWICK_AGENT_TOKEN` (and the hostnames) into a directory of the user who runs Docker, and start it as that user:

```bash
docker compose -f compose.production.yml -f compose.rootless.yml up -d
```

The overlay hands the socket proxy `$XDG_RUNTIME_DIR/docker.sock`, where a rootless daemon listens, in place of `/var/run/docker.sock`; the agent is behind the proxy as on any server. `SHIPWICK_DOCKER_SOCKET` in `.env` names the path instead, and makes the overlay unnecessary.

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
Docker          29.8.2, rootless, behind the socket proxy; memory and CPU limits are not enforced

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

Docker 29.8.2 rootless (RootlessKit 3.1.0, Compose 5.5 and 5.6) on a 6.18 kernel with cgroup v2, in two privileged containers: the `docker:dind-rootless` image, which has no systemd and therefore no controllers, and Debian 12 with systemd 252 and the delegation above. Not on a server or a virtual machine of its own. `scripts/test-rootless.sh` runs the first of the two, the agent behind the socket proxy as on every server.

## What's next

- [Security](/docs/security): the trust model these arrangements narrow, and [who can reach the API](/docs/security#who-can-reach-the-api).
- [Upgrade Shipwick](/docs/tasks/upgrade#upgrading-from-1-0-to-1-1): how the proxy arrives on a server that ran without it.
- [Resource limits and metrics](/docs/concepts/resources#limits-that-are-not-enforced): what a limit that is not enforced means for an application.
- [Install Shipwick on a server](/docs/getting-started/install#the-compose-file-by-hand): the compose file, by hand.
- [`shipwick doctor`](/docs/reference/cli#doctor) in the CLI reference.
