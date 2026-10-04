---
title: Prepare a server
description: Six things Shipwick leaves to the server's operator, with the commands for Debian, Ubuntu and the RHEL family and what shipwick doctor sees of each — SSH keys, security updates, swap, a firewall, the clock, and backups that leave the server.
---

# Prepare a server

Shipwick deploys applications; it does not administer the server under them. Six things are the operator's, and worth doing before the server carries data that matters. This page lists them with the commands, and says which of them `shipwick doctor` sees.

## Before you begin

- The commands are for Debian and Ubuntu and for the RHEL family (RHEL, Rocky Linux, AlmaLinux), run as root.
- They were run in containers of Debian 12, Ubuntu 24.04 and Rocky Linux 9. A container has no systemd and may not turn swap on, so the lines marked *not run* are the standard ones and were not.
- `shipwick doctor` asks the agent, so it sees the memory, the swap, the two ports and the backups. It does not look at SSH, at updates or at the clock.

| | `shipwick doctor` |
|---|---|
| 1. SSH takes keys, not passwords | does not look |
| 2. Security updates install themselves | does not look |
| 3. The server has swap | `! The server has no swap: …` |
| 4. A firewall lets in SSH, 80 and 443 | `✗ Port 443 is not reachable on …` when it is too strict; not when it is too open |
| 5. The clock is synchronised | does not look |
| 6. Backups leave the server | `! The encryption key exists only on this server. …` |

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

`shipwick doctor` tries 80 and 443 from where it runs, and says so when one is closed; a port that is open and should not be is not something it sees.

```text
✗ Port 443 is not reachable on 203.0.113.10: open it in the server's firewall; certificates are issued and renewed through ports 80 and 443
```

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

## What's next

- [Install Shipwick on a server](/docs/getting-started/install): what the installer does, and what it needs.
- [`shipwick doctor`](/docs/reference/cli#doctor) in the CLI reference: every line it prints.
- [Resource limits and metrics](/docs/concepts/resources): a memory limit for every application.
- [When things break](/docs/tasks/when-things-break): a full disk, a Docker daemon that does not answer, a reboot.
- [Security](/docs/security): what Shipwick does about the server, and what it leaves to you.
