---
title: Put Cloudflare in front of the server
description: Keep hostnames behind Cloudflare's proxy by giving the agent a Cloudflare API token, so that certificates are obtained through a DNS record; which permissions the token needs, exactly, how to set it, how the agent checks what the token can do, the SSL/TLS mode to choose, what changes for proxied records, visitor addresses and wildcard hostnames, and what shipwick doctor reports.
---

# Put Cloudflare in front of the server

With Cloudflare's proxy on for a record, the orange cloud, a visitor's connection ends at Cloudflare, and so does the certificate authority's: the proxy on your server cannot prove over HTTP or TLS that it serves the hostname, and gets no certificate. Give the agent a Cloudflare API token and Caddy proves it through a DNS record instead, the ACME DNS-01 challenge, which needs nothing to reach the server. This page shows how to create the token and give it to the agent, how the agent checks that the token can do its job, which SSL/TLS mode to set, what changes for proxied records, for the visitor's address and for wildcard hostnames, and what `shipwick doctor` and the API report. A server whose firewall admits Cloudflare's addresses alone is the next page, [Admit Cloudflare only](/docs/tasks/cloudflare-only).

## Before you begin

- Your hostnames are in zones at Cloudflare. With the token set, every certificate comes through Cloudflare DNS, also for hostnames whose record is DNS only: a hostname in a zone the token cannot edit, or at another DNS provider, gets no certificate while the token is set.
- You can do without all of this by leaving the proxy off: a record that is *DNS only* points straight at the server, and certificates are obtained as on any other server.
- The agent needs its reverse proxy, which the standard installation has. A plain agent without `SHIPWICK_CADDY_ADMIN` refuses to start with the token set.

## Create the token

In the Cloudflare dashboard: *My Profile* → *API Tokens* → *Create Token*, with two permissions on the zones your hostnames are in, those two exactly:

- *Zone → Zone → Read*
- *Zone → DNS → Edit*

*DNS Settings*, *DNS Firewall* and *DNS Views* are other permissions: a token with one of them in place of *DNS → Edit* lists the zones perfectly well and cannot create a record, and the proxy's log says only *Authentication error (code 10000)*. Caddy uses the token to create and remove the `_acme-challenge` TXT records, nothing else. It must be an API token, not the Global API Key: the agent refuses a value of another form at startup and names the rule, never the value.

**The token's IP filter**, if you give it one (*Client IP Address Filtering*), must name every address the server calls from. A server with an IPv6 address calls Cloudflare from it, and a filter that names the IPv4 address alone is refused with the same *Authentication error (code 10000)*. The agent's check, [below](#check-it), prints the address Cloudflare saw.

## Give it to the agent

On a new server, give it to the installer:

```bash
curl -fsSL https://get.shipwick.com | SHIPWICK_CLOUDFLARE_API_TOKEN=... sh
```

The installer writes it to `/opt/shipwick/.env` with the other settings, and its closing lines say that certificates are obtained through Cloudflare DNS and remind you of the SSL/TLS mode. It refuses a value that is not letters, digits, `-` and `_` before it installs anything. Since 0.9 it also prints, once the agent is up, what the agent found out about the token: the lines `shipwick doctor` prints about it, [below](#check-it).

On an existing server, one command from your machine, since 0.9:

```bash
shipwick server configure root@203.0.113.10 SHIPWICK_CLOUDFLARE_API_TOKEN=...
```

```text
✓ /opt/shipwick/.env on root@203.0.113.10: SHIPWICK_CLOUDFLARE_API_TOKEN added
✓ The agent is healthy
Next: check that the token can do its job with: shipwick doctor
```

The value travels to the server as data, never as part of a command, and is checked with the installer's rule; see [Change a setting later](/docs/getting-started/install#change-a-setting-later). Or add the line to `/opt/shipwick/.env` yourself, then recreate the containers that read it:

```bash
# /opt/shipwick/.env
SHIPWICK_CLOUDFLARE_API_TOKEN=...
```

```bash
cd /opt/shipwick && docker compose up -d
```

The token is then in `/opt/shipwick/.env`, in the agent's environment, and inside the configuration the agent loads into Caddy, and therefore in Caddy's autosaved copy of it on the `caddy-config` volume. It is never logged and never returned by the API.

## Set the SSL/TLS mode to Full (strict)

Set it on the zone.

| Mode | What happens |
|---|---|
| *Flexible* | Cloudflare talks to the server over plain HTTP, which Caddy redirects to HTTPS, which Cloudflare fetches over HTTP again: a redirect loop. |
| *Full* | Works, but accepts any certificate from the server. |
| *Full (strict)* | Checks the certificate Caddy obtained, which is the point of obtaining it. |

## What changes

**Proxied records are served instead of held back.** Without the token, a hostname that resolves to Cloudflare's addresses waits, and the deployment says why:

```text
! Routing https://api.example.com is waiting for DNS: resolves to Cloudflare's proxy (104.21.5.6), not to this server: turn the proxy off for this record (DNS only), or set SHIPWICK_CLOUDFLARE_API_TOKEN on the agent to keep it on. It is served, and its certificate obtained, once the record points at this server
```

With the token, such a hostname is taken as ready: where Cloudflare sends its traffic cannot be seen from the outside, and the certificate no longer depends on it. Make sure the record's target in Cloudflare is this server; the agent cannot check that for you. A hostname that does not resolve, or resolves to some other server, waits as before; see [DNS first](/docs/concepts/routing-and-https#dns-first).

**Applications see the visitor's address.** Cloudflare's address ranges become trusted proxies of Caddy, so an application finds the visitor's address first in `X-Forwarded-For`, followed by Cloudflare's. From any other sender the header is replaced, since anyone can send one. The ranges are the ones Cloudflare publishes, as of 2026-10-03; they are compiled into the agent.

**Wildcard hostnames can be deployed.** An authority issues a wildcard certificate only through the DNS challenge, which the token turns on:

```yaml
domain: example.com
aliases: ["*.example.com"]
```

Cloudflare has a limit of its own here. The certificate it presents to visitors covers, on the free plan, the zone and one label below it: `*.example.com` is served, and `*.apps.example.com` is refused at Cloudflare before the request reaches your server, whatever certificate the server holds. A deeper wildcard needs a certificate for it at Cloudflare, or its record set to *DNS only*.

Without the token, a deployment that names a wildcard is refused unless a certificate of your own covers it. See [Every name under a domain](/docs/tasks/several-hostnames#every-name-under-a-domain).

## Check it

Since 0.9 the agent verifies the token the way the proxy is going to use it: when it starts, and whenever `shipwick doctor` asks. It asks Cloudflare whether it accepts the token from the address the server really calls from, which zones the token sees, and — the only sure test of *DNS → Edit* — whether it can create a TXT record in each: `_shipwick-check.<zone>`, with a TTL of 60 and a value that names the server, removed at once. Because the check writes, it runs once at start and at most once a minute on request, never in a loop. The result is one line in the agent's log, `cloudflare` in `GET /server`, and lines in `shipwick doctor` that say what to change:

```text
✓ Cloudflare: the token can edit the DNS records of example.com (checked just now)
```

```text
✗ Cloudflare: the token cannot edit DNS records of example.com: it needs Zone → DNS → Edit (DNS Settings, DNS Firewall and DNS Views are other permissions) (checked 3 minutes ago)
✗ Cloudflare: Cloudflare refuses the token from this server's address 2a01:4f8:1c1b:5e07::1: an IP filter on the token must name that address, or the token is not valid (Cloudflare answered HTTP 403, code 10000: Authentication error) (checked just now)
! Cloudflare: no zone is visible to the token: … (checked just now)
✗ Cloudflare: shop.example.net is not in a zone the token sees (example.com), so its certificate cannot be obtained through DNS. Give the token Zone → Zone → Read and Zone → DNS → Edit on its zone
```

A hostname served from a zone the token cannot edit, or from a zone it does not see, is a problem: its certificate is not coming. Anything else wrong with the token is a problem once hostnames are served, and worth a look (`!`) until then. `doctor` with an `admin` token asks the agent for a fresh check; any other token reads the last one, and the line says when it was made. Cloudflare answers the same *code 10000* to an unknown token and to a known token from an address its IP filter excludes, so one sentence names the address and both causes. Nothing of the token itself is in any of this.

`shipwick doctor` also reads from the agent whether the DNS challenge is on, and judges a record behind Cloudflare's proxy accordingly. With the token:

```text
✓ api.example.com → Cloudflare's proxy (104.16.0.1)
```

Without it, the same record is a problem, in the agent's words:

```text
✗ api.example.com resolves to Cloudflare's proxy (104.16.0.1), not to the server: turn the proxy off for this record (DNS only), or set SHIPWICK_CLOUDFLARE_API_TOKEN on the agent to keep it on
```

When the agent's own hostname is proxied too, the server's address cannot be learned from the outside, and one line takes the place of the port lines:

```text
! Behind Cloudflare only: ports and record targets are not checked from outside
```

What that arrangement needs, and what `doctor` can still see, is in [Admit Cloudflare only](/docs/tasks/cloudflare-only).

Through the API, `GET /server` reports `proxy.dns_challenge`, `true` when certificates are obtained through a DNS record, and since 0.9 `cloudflare`: when the token was last checked, whether it is in order, the address Cloudflare saw, the zones with whether each can be edited, and the problems as sentences. `POST /server/cloudflare/verify` runs the check again, at most once a minute, with the `admin` role; see [`POST /server/cloudflare/verify`](/docs/reference/api#post-server-cloudflare-verify) in the API reference. Neither says anything about the token's value.

While a certificate is on its way, `shipwick status` has a line for the hostname, `being obtained`; see [certificate status](/docs/tasks/certificates#certificate-status). If one does not arrive, since 0.9 the reason is read out of the proxy's log for you, next to that line, in the application's events once per reason, in `GET /applications/:name` (`certificates[].failure`) and in `shipwick doctor` as a problem:

```text
shop.example.com    being obtained: the proxy has no certificate for it yet: the DNS record for the challenge could not be created: the token cannot edit DNS records of example.com: it needs Zone → DNS → Edit
```

Caddy's own words stay in `docker logs shipwick-caddy-1` on the server. A hostname in a zone the token cannot edit is one that never gets a certificate while the token is set.

## Going back

Remove the line from `/opt/shipwick/.env` and run `docker compose up -d` in `/opt/shipwick` again — or, from your machine, `shipwick server configure root@203.0.113.10 --unset SHIPWICK_CLOUDFLARE_API_TOKEN`. Certificates are then obtained from the server itself, so set the records to *DNS only* first: a hostname that still resolves to Cloudflare's proxy is held back until its record points at the server. A deployed wildcard hostname is no longer served unless a certificate of your own covers it.

## What's next

- [Admit Cloudflare only](/docs/tasks/cloudflare-only): a firewall that admits Cloudflare's addresses and nothing else.
- [`SHIPWICK_CLOUDFLARE_API_TOKEN`](/docs/reference/agent-configuration#shipwick-cloudflare-api-token) in the agent configuration reference, and [`GET /server`](/docs/reference/api#get-server) and [`POST /server/cloudflare/verify`](/docs/reference/api#post-server-cloudflare-verify) in the API reference.
- [Use a certificate of your own](/docs/tasks/certificates): the other way to a wildcard hostname.
- [Routing and HTTPS](/docs/concepts/routing-and-https#behind-cloudflare): why one policy covers every hostname, and where the token is kept.
