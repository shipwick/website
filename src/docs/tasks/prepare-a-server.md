---
title: Prepare a server
description: What has to be right at the provider before the first command, and seven things Shipwick leaves to the server's operator, with the commands for Debian, Ubuntu and the RHEL family and what shipwick doctor sees of each — SSH keys, security updates, swap, a firewall, the clock, backups that leave the server, and the kernel's table of neighbours.
---

# Prepare a server

Shipwick deploys applications; it does not administer the server under them. Two things are decided at the provider before anything of Shipwick runs, and seven more are the operator's, worth doing before the server carries data that matters. This page lists them with the commands, and says which of them `shipwick doctor` sees.

## Before the first command

Two things decide whether `shipwick server install` gets in and whether certificates arrive, and both are set at the provider.

**The key.** Create the server with your SSH public key selected, so that it is in `/root/.ssh/authorized_keys` from the first boot. On Ubuntu images root has no password and logs in with a key only; a server created without one can be reached through the provider's console or rescue system, where the key is pasted into that file, or through the provider's own way of installing a key on a running server. `shipwick server install` says which key it offered when the server does not know it, and names those three ways out.

**The firewall in front of the server** — the one the provider offers beside the machine, not the one on it — has to admit 80 and 443 over TCP and 443 over UDP from everywhere, and SSH from where you are. One that is closed is silence, not a refusal: the installer finishes, the agent is healthy, and no certificate is ever issued. `shipwick server install` probes the two ports from your machine when it is done and names the firewall when they are silent, and so does `shipwick doctor`. A server that is to sit behind Cloudflare alone admits 80 and 443 from Cloudflare's address ranges instead of from everywhere; what that arrangement needs is in [Admit Cloudflare only](/docs/tasks/cloudflare-only).

## Before you begin

- The commands are for Debian and Ubuntu and for the RHEL family (RHEL, Rocky Linux, AlmaLinux), run as root.
- They were run in containers of Debian 12, Ubuntu 24.04 and Rocky Linux 9. A container has no systemd and may not turn swap on, so the lines marked *not run* are the standard ones and were not.
- `shipwick doctor` asks the agent, so it sees the memory, the swap, the two ports, the backups and the number of containers. It does not look at SSH, at updates or at the clock.

| | `shipwick doctor` |
|---|---|
| 1. SSH takes keys, not passwords | does not look |
| 2. Security updates install themselves | does not look |
| 3. The server has swap | `! The server has no swap: …` |
| 4. A firewall lets in SSH, 80 and 443 | `✗ Port 443 on … timed out` when it is too strict; not when it is too open |
| 5. The clock is synchronised | does not look |
| 6. Backups leave the server | `! The encryption key exists only on this server. …` |
| 7. The kernel's table of neighbours fits the containers | `! The server runs 301 containers; the kernel's table of neighbours holds 1024 entries …` from a quarter of the table on |

## SSH without passwords

Log in with a key first, and keep that session open until a second one has worked.

```bash
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' \
  > /etc/ssh/sshd_config.d/00-keys-only.conf
sshd -t && sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '
systemctl restart ssh     # Debian, Ubuntu; not run
systemctl restart sshd    # RHEL family; not run
```

`sshd -T` prints what is in effect, and must say `passwordauthentication no`, `kbdinteractiveauthentication no` and `permitrootlogin without-password`, the older name of `prohibit-password`. The file's name begins with `00` because the first file to set an option wins: a `50-cloud-init.conf` beside it that says `PasswordAuthentication yes`, as some providers' images have, then changes nothing.

## Automatic security updates

On Debian and Ubuntu the package is enough: it brings `/etc/apt/apt.conf.d/20auto-upgrades`, which turns the daily run on, and `50unattended-upgrades`, which says what it may upgrade.

```bash
apt-get install -y unattended-upgrades
apt-config dump | grep -E 'APT::Periodic::(Update-Package-Lists|Unattended-Upgrade) '   # both "1"
unattended-upgrade --dry-run --debug    # what it would upgrade now
```

On the RHEL family the package installs nothing until it is told to:

```bash
dnf install -y dnf-automatic
sed -i 's/^upgrade_type = .*/upgrade_type = security/; s/^apply_updates = .*/apply_updates = yes/' /etc/dnf/automatic.conf
systemctl enable --now dnf-automatic.timer    # not run
```

Both upgrade the distribution's packages.

- **Docker stays at its version.** When it was installed from Docker's own repository, it is not among the origins `50unattended-upgrades` lists, and it is upgraded when you upgrade it.
- **Neither reboots the server.** `Unattended-Upgrade::Automatic-Reboot` is off, and `reboot = never` in `automatic.conf`: a new kernel waits for a reboot at a time you choose. What a reboot does to the applications is in [When things break](/docs/tasks/when-things-break#the-server-reboots).

## A swap file

Without swap a full memory is a killed process at once. The other half is a memory limit for every application: see [Resource limits and metrics](/docs/concepts/resources#an-application-without-a-limit). The size is yours to choose; this file is 2 GB.

```bash
dd if=/dev/zero of=/swapfile bs=1M count=2048
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile                                   # not run
echo '/swapfile none swap sw 0 0' >> /etc/fstab    # not run; keeps it after a reboot
```

`shipwick doctor` says when there is none, and which applications have no limit:

```text
! 3 applications run without a memory limit: postgres, redis, web. One that leaks takes the server's memory from all the others; set resources.memory in deploy.yaml
! The server has no swap: once its 4 GB of memory is used, the kernel kills a process at once. Add a swap file on the server
```

## A firewall, and what Docker does to it

SSH, 80 and 443 come in — 443 over UDP as well, for HTTP/3 — and nothing else.

```bash
apt-get install -y ufw              # Debian, Ubuntu
ufw default deny incoming
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443                       # TCP and UDP
ufw enable
```

```bash
firewall-cmd --permanent --add-service=ssh --add-service=http --add-service=https --add-service=http3    # RHEL family; not run
firewall-cmd --reload                                                                                    # not run
```

`firewall-cmd` needs the running firewalld that a container does not have; `firewall-offline-cmd` took the same four services there.

::: warning A firewall on the server does not close a port Docker has published
On most distributions Docker inserts its own rules ahead of ufw's or firewalld's. Where that holds, 80 and 443 answer whether or not the rules above name them, and a `publish` in `deploy.yaml` is the place to be careful, not the firewall. See [Unprivileged containers](/docs/security#unprivileged-containers). A firewall in front of the server — the one most providers offer beside the machine — is not bypassed, and is the one to rely on.
:::

With the agent [installed from a package](/docs/getting-started/install-from-a-package#where-the-api-listens), the firewall on the server must let Docker's networks reach the agent's port.

`shipwick doctor` tries 80 and 443 from where it runs, and says so when one is closed, telling a port that refuses — nothing listens, the proxy is not up — from one that is silent, which is a firewall dropping the packets, at the provider; a port that is open and should not be is not something it sees.

```text
✗ Port 443 on 203.0.113.10 timed out after 3s: a firewall in front of the server drops the packets — the provider's firewall (Hetzner Cloud Firewall, an AWS security group, a DigitalOcean cloud firewall). Open 80 and 443 TCP and 443 UDP there; certificates cannot be obtained until then
✗ Port 443 on 203.0.113.10 refused the connection: nothing listens there. The proxy is not up; on the server: cd /opt/shipwick && docker compose ps
```

`shipwick server install` makes the same probe from your machine once the installer is done, so a provider's firewall that is closed is said before the first certificate is waited for.

## The clock

A certificate is valid from one instant to another, and requests to a bucket are signed with the time: a clock that is far off fails both, in ways that do not mention the clock.

```bash
timedatectl show -p NTPSynchronized                         # NTPSynchronized=yes; not run
apt-get install -y systemd-timesyncd                        # Debian, Ubuntu, when it says no
dnf install -y chrony && systemctl enable --now chronyd     # RHEL family; the second half not run
```

## Backups that leave the server

A backup on the server's own disk is gone with the server. [Back up and restore volumes](/docs/tasks/backups) has the bucket and the passphrase that put a copy elsewhere — of the volumes and of the agent's own state, the encryption key included — and `shipwick doctor` says which of the two is missing:

```text
! The encryption key exists only on this server. Set SHIPWICK_BACKUP_PASSPHRASE (and an S3 bucket) in /opt/shipwick/.env to back it up; losing it loses every secret
✓ Agent state backed up 3h ago to the server's own disk (set SHIPWICK_BACKUP_S3_* in /opt/shipwick/.env to keep a copy elsewhere)
```

## The kernel's table of neighbours

Every address on the server's networks — each container's on each of its two networks, the proxy's, the agent's, and the entries every container keeps of the peers it talks to — is a neighbour to the kernel, and it keeps at most `net.ipv4.neigh.default.gc_thresh3` of them: 1024 in a stock kernel. When the table is full, containers stop reaching each other (`neighbour: arp_cache: neighbor table overflow!` in the kernel log), which the measurement of what one server carries met between 300 and 400 containers. A server meant for hundreds of containers raises the three thresholds before that; the file is read at boot.

```bash
printf 'net.ipv4.neigh.default.gc_thresh1 = 2048\nnet.ipv4.neigh.default.gc_thresh2 = 4096\nnet.ipv4.neigh.default.gc_thresh3 = 8192\n' \
  > /etc/sysctl.d/90-neighbours.conf
sysctl -p /etc/sysctl.d/90-neighbours.conf
sysctl net.ipv4.neigh.default.gc_thresh3    # 8192
```

Since 0.9 `shipwick doctor` warns from a quarter of the table on, counting the managed containers and the proxy. An agent [installed from a package](/docs/getting-started/install-from-a-package) reads the table's size from the kernel and `GET /server` carries it (`kernel_limits.neighbour_table`); the agent in its container cannot — the kernel shows the setting in the host's own network namespace only — and `doctor` then names the stock size and says to check the server's:

```text
! The server runs 301 containers; the kernel's table of neighbours holds 1024 entries and each container takes several: raise net.ipv4.neigh.default.gc_thresh3 (and gc_thresh1/2) in /etc/sysctl.d before it fills
```

## What's next

- [Install Shipwick on a server](/docs/getting-started/install): what the installer does, and what it needs.
- [`shipwick doctor`](/docs/reference/cli#doctor) in the CLI reference: every line it prints.
- [Resource limits and metrics](/docs/concepts/resources): a memory limit for every application.
- [When things break](/docs/tasks/when-things-break): a full disk, a Docker daemon that does not answer, a reboot.
- [Security](/docs/security): what Shipwick does about the server, and what it leaves to you.
