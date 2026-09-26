---
title: Install the CLI
description: Install the Shipwick command-line client on a laptop or in CI, and connect it to an agent.
---

# Install the CLI

`shipwick` is the Shipwick command-line client. This page covers installing it on your laptop or in CI, saving the agent's URL and token with `shipwick login`, and how the CLI decides which agent to talk to.

The server installer already puts `shipwick` on the server. You only need this page for other machines.

## Homebrew

On macOS and Linux:

```bash
brew install shipwick/tap/shipwick
```

Upgrade with `brew upgrade shipwick`. Completions for bash, zsh and fish are installed along with it. The formula installs the same binaries as the installer below, verified against the same checksums; it lives in [shipwick/homebrew-tap](https://github.com/shipwick/homebrew-tap) and follows new releases within a day.

## The installer

```bash
curl -fsSL https://get.shipwick.com | sh -s -- --cli
```

With `--cli`, the installer installs `shipwick` and nothing else. It needs neither root nor Docker. It downloads the binary for your platform (Linux or macOS, amd64 or arm64) from the latest [release](https://github.com/shipwick/shipwick/releases), verifies it against the release's `checksums.txt`, and moves it to `/usr/local/bin`. If the checksum does not match, nothing is installed.

```text
Shipwick installer (shipwick/shipwick@latest)

✓ Installed the shipwick CLI to /usr/local/bin/shipwick

  Next:   shipwick login
```

If `/usr/local/bin` is not writable, the installer uses `sudo` to move the binary into place. To install somewhere else, set `SHIPWICK_BIN_DIR` to a directory on your `PATH`:

```bash
curl -fsSL https://get.shipwick.com | SHIPWICK_BIN_DIR="$HOME/.local/bin" sh -s -- --cli
```

To install a specific version, set `SHIPWICK_VERSION`:

```bash
curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v0.2.0 sh -s -- --cli
```

## Windows

Download `shipwick_windows_amd64.exe` from the [releases page](https://github.com/shipwick/shipwick/releases) and put it on your `PATH`.

## From source

With Go 1.27 or later, from a checkout of the [repository](https://github.com/shipwick/shipwick):

```bash
go build -o bin/shipwick ./cli/cmd/shipwick      # or: make build
```

## Check the installation

```bash
shipwick --version
```

## Log in

`shipwick login` saves the agent's URL and the API token for later commands.

```bash
shipwick login --url https://agent.example.com
```

It asks for the token without echoing it, verifies the token against the agent, and only then writes the config file. If the agent rejects the token, nothing is saved. Without `--url`, `login` asks for the URL too and offers the current one as the default.

In a script, pipe the token in:

```bash
printf %s "$TOKEN" | shipwick login --url https://agent.example.com --token-stdin
```

The config file is `<user config dir>/shipwick/config.yaml` — `~/.config/shipwick/config.yaml` on Linux. `login` prints the path it wrote. Set `SHIPWICK_CONFIG` to use another location.

To confirm that the CLI reaches the agent:

```bash
shipwick server status
```

CI jobs usually need no login at all: they set two environment variables instead. See [Deploy from CI](/docs/tasks/deploy-from-ci).

## How the CLI finds the agent

The URL and the token are resolved separately. The first source that has a value wins.

| | URL | Token |
|---|---|---|
| 1. Flag | `--url` | Never a flag |
| 2. Environment | `SHIPWICK_AGENT_URL` | `SHIPWICK_AGENT_TOKEN` |
| 3. Saved by `shipwick login` | yes | yes |
| 4. Default | `http://127.0.0.1:9000` | — |

The default URL suits an agent on the same machine and one reached through an SSH tunnel. If you did not give the agent a hostname, see [Reach the API without a hostname](/docs/tasks/access-without-a-hostname).

The saved token belongs to the saved URL. If `--url` or `SHIPWICK_AGENT_URL` points `shipwick` at a different agent, the saved token is not sent there; set `SHIPWICK_AGENT_TOKEN` for that agent, or log in to it.

## How the CLI handles the token

The API token is equivalent to root SSH access to the server, and `shipwick` treats it that way:

- The token is never accepted as a command-line flag. Arguments are visible to other users through `ps` and are kept in shell history.
- `login` reads the token without echo, or from standard input with `--token-stdin`.
- The config file is written with mode `0600`, in a directory created with mode `0700`.
- A saved token is only sent to the agent it was saved for.
- `shipwick` warns on standard error whenever the token is about to travel over plain HTTP to anything other than the local machine. Use HTTPS or an SSH tunnel.

## What's next

- [Deploy your first application](/docs/getting-started/first-deployment).
- The full command list is in the [shipwick reference](/docs/reference/cli).
