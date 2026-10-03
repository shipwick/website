---
title: Install the CLI
description: Install the Shipwick command-line client on a laptop or in CI, and connect it to an agent.
---

# Install the CLI

<div class="wick-note">
<img src="/img/wick.svg" alt="Wick, the Shipwick flame" width="64" height="64">

<p><code>shipwick</code> is the Shipwick command-line client. This page covers installing it on your laptop or in CI, keeping it current with <code>shipwick upgrade</code>, saving the agent's URL and token with <code>shipwick login</code>, working with several servers, and how the CLI decides which agent to talk to.</p>

</div>

The server installer already puts `shipwick` on the server, and since 0.5 signs it in to its own agent when the API has a hostname; see [On the server](#on-the-server). You only need this page for other machines. With the CLI on your laptop, the server itself can be installed from there: `shipwick server install root@203.0.113.10 --agent-domain agent.example.com --dashboard-domain dashboard.example.com` runs the installer over SSH and logs you in; see [Install on a server](/docs/getting-started/install#run-the-installer-from-your-laptop).

## Homebrew

On macOS and Linux:

```bash
brew install shipwick/tap/shipwick
```

Upgrade with `brew upgrade shipwick`; `shipwick upgrade` recognizes a Homebrew installation and prints that line instead of replacing the binary itself. Completions for bash, zsh and fish are installed along with it. The formula installs the same binaries as the installer below, verified against the same checksums; it lives in [shipwick/homebrew-tap](https://github.com/shipwick/homebrew-tap) and follows new releases within a day.

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
curl -fsSL https://get.shipwick.com | SHIPWICK_VERSION=v0.5.1 sh -s -- --cli
```

## Windows

Download `shipwick_windows_amd64.exe` from the [releases page](https://github.com/shipwick/shipwick/releases) and put it on your `PATH`. Later releases are installed with `shipwick upgrade`, below.

## From source

With Go 1.27 or later, from a checkout of the [repository](https://github.com/shipwick/shipwick):

```bash
go build -o bin/shipwick ./cli/cmd/shipwick      # or: make build
```

## Check the installation

```bash
shipwick --version
```

## Upgrade

`shipwick upgrade` replaces the running binary with the latest release, then compares the server's version with it:

```bash
shipwick upgrade
```

```text
✓ Upgraded shipwick v0.3.1 → v0.5.1
  /usr/local/bin/shipwick

The server runs v0.3.1; v0.5.1 is available. On the server run:
  curl -fsSL https://get.shipwick.com | sh
```

The release is downloaded from GitHub and verified against the release's `checksums.txt` before anything changes; the new binary is written next to the old one and renamed over it only once its SHA-256 matches. Pre-releases are never picked. On Windows the replaced binary is left behind as `shipwick.old.exe` and removed the next time `shipwick` runs. If the directory is not writable, the command says so and suggests `sudo shipwick upgrade`, or running the installer again.

The command upgrades only the CLI. The server is upgraded by running the installer on the server, which needs Docker there, or with `shipwick server install user@host` from your machine; `shipwick upgrade` tells you when the server is behind, and says `The server runs v0.5.1, the latest release.` when it is not. A server that cannot be reached is one line, not an error.

A `shipwick` installed with Homebrew is left to Homebrew:

```text
shipwick v0.3.1 was installed with Homebrew; v0.5.1 is available.

Upgrade with: brew upgrade shipwick
```

`--check` only reports:

```bash
shipwick upgrade --check
```

```text
shipwick v0.3.1 is installed; v0.5.1 is available.

Upgrade with: shipwick upgrade
```

When there is nothing to do, the first line reads `shipwick v0.5.1 is up to date.`

## Log in

`shipwick login` saves the agent's URL and the API token for later commands.

```bash
shipwick login --url https://agent.example.com
```

```text
API token:
✓ Logged in to https://agent.example.com (vps-1, agent v0.5.1)
  saved as context default in /home/you/.config/shipwick/config.yaml
```

It asks for the token without echoing it, verifies the token against the agent, and only then writes the config file. If the agent rejects the token, nothing is saved. Without `--url`, `login` asks for the URL too and offers the current one as the default.

Any token works: the root token the installer printed, or one created with `shipwick token create`. What the CLI may do afterwards follows the token's role; `shipwick server status` shows which token and role you are using. See [Create tokens for CI and teammates](/docs/tasks/tokens).

In a script, pipe the token in:

```bash
printf %s "$TOKEN" | shipwick login --url https://agent.example.com --token-stdin
```

For a hostname whose DNS record or certificate does not exist yet, `--no-check` (since 0.5) saves the URL and the token as given, without a request to the agent:

```bash
printf %s "$TOKEN" | shipwick login --url https://agent.example.com --token-stdin --no-check
```

```text
✓ Saved https://agent.example.com as context default in /home/you/.config/shipwick/config.yaml
  not checked against the agent; try it with: shipwick server status
```

The config file is `<user config dir>/shipwick/config.yaml` — `~/.config/shipwick/config.yaml` on Linux. `login` prints the path it wrote. Set `SHIPWICK_CONFIG` to use another location.

To confirm that the CLI reaches the agent:

```bash
shipwick server status
```

To check the whole setup, from the versions to whether each domain's DNS points at the server and answers over HTTPS:

```bash
shipwick doctor
```

It prints one line per check with what to do about it, and exits non-zero when something is broken; see [Your first deployment](/docs/getting-started/first-deployment#when-the-domain-is-not-ready).

CI jobs usually need no login at all: they set two environment variables instead. See [Deploy from CI](/docs/tasks/deploy-from-ci).

## On the server

Since 0.5 there is nothing to set up on the server itself when the API has a hostname. The installer saves `https://<agent hostname>` and the token as a context of the user who runs it, through `shipwick login --token-stdin --no-check`, and `shipwick ps` works there as it does on a laptop. The login is not checked against the agent because, on a new server, the hostname may have neither a DNS record nor a certificate yet; the commands work once it has both.

- With no server saved for that user yet, the context is named `default`.
- Run again, the installer puts the current token back into the context that points at this server, and leaves every other context, and which one is current, as they were. When another context is current, its summary shows the command with the context's name: `shipwick --context <name> ps`.
- When the user has other servers saved and none of them is this one, nothing is changed, and the installer prints the command that adds it: `shipwick login --context here --url https://agent.example.com`.

Without a hostname for the API nothing is saved: the agent publishes no port, so there is no address on the server to log in to. A command run there then says so instead of suggesting an SSH tunnel, which would lead nowhere on the server itself:

```text
cannot reach the Shipwick agent at http://127.0.0.1:9000
  …

The agent on this server publishes no port. Give it a hostname (SHIPWICK_AGENT_DOMAIN in /opt/shipwick/.env, then run the installer again), or see "Reach the API without a hostname" in the handbook, Installation.
```

The ways in without a hostname are in [Reach the API without a hostname](/docs/tasks/access-without-a-hostname).

## Several servers

Each `shipwick login` saves a server under a name, a *context*. Without `--context`, the name is `default`; `shipwick server install` saves the server it installed under its hostname. A second server gets a name of its own and becomes the current one:

```bash
shipwick login --context staging --url https://staging.example.com
```

Commands talk to the current context. `--context` picks another one for a single command, `SHIPWICK_CONTEXT` for a whole shell, and `shipwick context use` changes the current one:

```bash
shipwick deploy --context staging
shipwick context use prod
```

```text
✓ Switched to prod (https://agent.example.com)
```

| Command | |
|---|---|
| `shipwick context ls` | The saved servers and their URLs; `*` marks the current one |
| `shipwick context use <name>` | Make a saved server the current one |
| `shipwick context rm <name>` | Forget a server and its token. Asks first; `--yes` skips the question |
| `shipwick context current` | Print the name of the current server |

```text
  NAME      URL
* prod      https://agent.example.com
  staging   https://staging.example.com
```

While more than one context is saved, output that names the server — `server status`, warnings — adds the context's name, so that a command run against the wrong server is visible as such. A config file written before contexts existed, with `url` and `token` at the top level, still loads as the context `default`.

## How the CLI finds the agent

The URL and the token are resolved separately. The first source that has a value wins.

| | URL | Token |
|---|---|---|
| 1. Flag | `--url` | Never a flag |
| 2. Environment | `SHIPWICK_AGENT_URL` | `SHIPWICK_AGENT_TOKEN` |
| 3. Saved context | yes | yes |
| 4. Default | `http://127.0.0.1:9000` | — |

The saved context is the one `--context` names, else the one `SHIPWICK_CONTEXT` names, else the current one.

The default URL suits an agent on the same machine and one reached through an SSH tunnel. If you did not give the agent a hostname, see [Reach the API without a hostname](/docs/tasks/access-without-a-hostname).

The saved token belongs to the saved URL. If `--url` or `SHIPWICK_AGENT_URL` points `shipwick` at a different agent, the saved token is not sent there; set `SHIPWICK_AGENT_TOKEN` for that agent, or log in to it under a context of its own.

## How the CLI handles the token

An admin token is equivalent to root SSH access to the server, and `shipwick` treats every token that way:

- The token is never accepted as a command-line flag. Arguments are visible to other users through `ps` and are kept in shell history.
- `login` reads the token without echo, or from standard input with `--token-stdin`.
- The config file is written with mode `0600`, in a directory created with mode `0700`.
- A saved token is only sent to the agent it was saved for.
- `shipwick` warns on standard error whenever the token is about to travel over plain HTTP to anything other than the local machine. Use HTTPS or an SSH tunnel.
- A token asked to do more than its role allows is refused by the agent, and `shipwick` says which role it has and which one the command needs.

## What's next

- [Deploy your first application](/docs/getting-started/first-deployment).
- [Create tokens for CI and teammates](/docs/tasks/tokens).
- The full command list is in the [shipwick reference](/docs/reference/cli).
