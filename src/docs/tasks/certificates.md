---
title: Use a certificate of your own
description: Serve hostnames with a certificate you supply using shipwick cert set, ls and rm, what the agent checks before it stores one, how the key is kept, how wildcard hostnames are served with a supplied certificate, how to go back to automatic certificates, and how the status of every certificate is reported.
---

# Use a certificate of your own

Certificates are obtained and renewed by the proxy on its own; nothing on this page is needed for that. It is for a hostname whose certificate comes from somewhere else: a corporate authority, a wildcard bought for the whole domain. This page shows `shipwick cert set`, `ls` and `rm`, what the agent checks before it stores a certificate, how the key is kept, how a supplied certificate makes a wildcard hostname deployable, how to go back to automatic certificates, and where the status of every certificate, supplied or obtained, is reported.

## Before you begin

- You need two files in PEM: the chain, with the hostname's certificate first and the intermediates after it, and its private key, without a passphrase.
- Storing and removing a certificate needs a token with the `admin` role; listing needs `read`. See [Create tokens for CI and teammates](/docs/tasks/tokens).
- Shipwick does not renew what it did not obtain. Replacing the certificate before it expires is yours to do; the server tells you when it is due.
- At most 50 certificates can be stored, and each file is at most 64 KB.

## Store a certificate

```bash
shipwick cert set example.com --cert fullchain.pem --key privkey.pem
```

```text
✓ Stored the certificate for example.com
Issuer    Corp Issuing CA
Expires   2027-09-01
Covers    example.com, *.example.com
  The hostnames it covers are served with it from now on. It is not renewed for you: replace it before it expires with the same command.
```

| | |
|---|---|
| `<hostname>` | The name the certificate is stored under: a hostname as in `deploy.yaml`, or a wildcard in quotes, `'*.example.com'`. The certificate must cover it. |
| `--cert` | The chain in PEM: the hostname's certificate first, then the intermediates. |
| `--key` | Its private key in PEM, without a passphrase. |

A certificate belongs to the server, not to one application. Every hostname it covers, its DNS names with a wildcard among them counting for one label, is served with it, whichever application the hostname belongs to. The proxy asks no authority for those hostnames, and they do not wait for DNS, since there is no rate limit to protect. The proxy is updated before the command returns. A deployment says so:

```text
✓ Routed https://example.com to 2 replicas, with the certificate you supplied for it
```

Replacing a certificate is `cert set` again, under the same hostname.

## What the agent checks

The agent checks before it stores anything, and each refusal is a sentence that says which check failed, without repeating the files' content:

- **The chain parses**, and holds only certificates. A key in the certificate file is refused: `the certificate file contains a private key: give the key separately, and only certificates here`.
- **The key belongs to the first certificate.** If it does not: `the key does not belong to the first certificate of the chain: the server's own certificate comes first, the intermediates after it`. A key protected by a passphrase is refused with the command that removes it, `openssl pkey -in <key> -out privkey.pem`.
- **The certificate covers the hostname it is stored under**: `the certificate does not cover example.org: it is for example.com, *.example.com`. A wildcard name covers exactly one label, and a wildcard hostname is covered only by the same wildcard.
- **It is within its validity**: `the certificate expired on 2026-09-01`.

Whether the chain leads to an authority browsers trust is not checked: a private authority's certificate is a use of this.

## The key

The key is encrypted in the database like a secret, and nothing returns it: `cert ls`, the API and the dashboard show the issuer, the dates and the names. It is never logged or repeated in an error. See [Secrets at rest](/docs/security#secrets-at-rest).

## List the certificates

```bash
shipwick cert ls
```

```text
HOSTNAME        ISSUER            EXPIRES                   COVERS
*.example.org   Corp Issuing CA   2026-10-24 (in 21 days)   *.example.org
example.com     Corp Issuing CA   2027-09-01                example.com, *.example.com
```

`EXPIRES` is the certificate's last day. In its last 30 days the line says how far off that is, and after it `(expired)`. An expired certificate stays listed, and the proxy goes on serving it, until you replace or remove it.

## Wildcard hostnames

A wildcard certificate is stored under the wildcard:

```bash
shipwick cert set '*.example.com' --cert wildcard.pem --key wildcard.key
```

It covers every name one label below the domain, `a.example.com` and neither `example.com` nor `a.b.example.com`, and it lets `"*.example.com"` be used as a `domain` or an alias in `deploy.yaml`:

```yaml
domain: example.com
aliases: ["*.example.com"]
```

Without it, and without [Cloudflare's DNS challenge](/docs/tasks/cloudflare), a deployment that names a wildcard is refused; an authority issues a wildcard certificate only through a DNS record. A wildcard hostname is covered only by a certificate that names the same wildcard, not by one that lists some names under the domain. See [Every name under a domain](/docs/tasks/several-hostnames#every-name-under-a-domain).

## Go back to automatic certificates

```bash
shipwick cert rm example.com
```

```text
Remove the certificate for example.com? The server will obtain its own for the hostnames it covers. [y/N] y
✓ Removed the certificate for example.com
```

The hostnames it covered go back to certificates the proxy obtains itself, and behind the DNS gate, at once: each needs its DNS to point at the server. A wildcard hostname in a `deploy.yaml` is no longer served unless the agent has `SHIPWICK_CLOUDFLARE_API_TOKEN`. In a script, pass `--yes` (`-y`); without a terminal the command refuses to remove without it.

## Certificate status

Whether a certificate was supplied or obtained, the agent reports what a visitor is going to see. Once a minute it connects to the proxy with the hostname as the server name and reads the certificate it is handed. `shipwick status` names every hostname whose certificate is not in order, and why:

```text
HOSTNAME            CERTIFICATE
www.example.com     waiting for DNS: does not resolve yet; add an A record: www.example.com → 62.238.109.115 (DNS only, not proxied)
new.example.com     being obtained: the proxy has no certificate for it yet; HTTPS connections to it fail until it does
old.example.com     expires in 9 days, on 2026-03-10 (Let's Encrypt E7)
```

| Line | Meaning | What to do |
|---|---|---|
| `waiting for DNS` | The hostname is not in the proxy yet, because it does not resolve to this server. | Create or change the record the line names. The agent looks again every 10 seconds. See [DNS first](/docs/concepts/routing-and-https#dns-first). |
| `being obtained` | The proxy serves the hostname and presents no certificate for it yet. | Usually nothing: a certificate takes seconds. If the line stays, the proxy's log says why: `docker logs shipwick-caddy-1` on the server. |
| `expires in …` | The certificate has 14 days or less to go. | For an obtained certificate, renewal has been failing: the proxy renews a ninety-day certificate thirty days before its end, and its log says why. A supplied one is replaced with `shipwick cert set`. |

`shipwick status --verbose` lists the hostnames that are in order too, with their issuer and last day: `valid until 2026-06-01 (Let's Encrypt E7)`. On a development machine the issuer is Caddy's own authority, and is reported as that.

The same is told in other places:

- **Events.** The application's events record a certificate being obtained, `Certificate for new.example.com obtained from Let's Encrypt E7, valid until 2026-06-01`, and one running out, with what to do: for an obtained certificate the proxy's log, for a supplied one the `cert set` command that replaces it.
- **Webhook.** A [webhook](/docs/tasks/notifications) is told `certificate.expiring` at 14 days and again at 3.
- **`shipwick doctor`** reports a supplied certificate that will expire within 30 days, and one that has expired as a problem:

  ```text
  ! The certificate you supplied for example.com expires on 2026-10-24. Replace it before then with: shipwick cert set example.com --cert <file> --key <file>
  ```

- **The API.** The application detail carries `certificates`, one entry per hostname.

The agent reaches the proxy at `caddy:443`. Where the proxy listens somewhere else, [`SHIPWICK_PROXY_TLS_ADDR`](/docs/reference/agent-configuration#shipwick-proxy-tls-addr) says where.

## The dashboard

The **Certificates** page lists the certificates you supplied, marks their last 30 days and what has expired, and lets an admin add one, as two PEM fields, or remove one. On an application's page, every hostname whose certificate waits for DNS, is being obtained or is about to expire carries a badge and the agent's sentence. See [Use the dashboard](/docs/tasks/dashboard).

## What's next

- [`shipwick cert`](/docs/reference/cli#cert) and [`shipwick status`](/docs/reference/cli#status) in the CLI reference.
- [Put Cloudflare in front of the server](/docs/tasks/cloudflare): certificates through a DNS record, for proxied records and wildcards.
- [Routing and HTTPS](/docs/concepts/routing-and-https#a-certificate-of-your-own): why a certificate belongs to the server and not to a `deploy.yaml`.
