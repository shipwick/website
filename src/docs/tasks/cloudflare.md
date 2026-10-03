---
title: Put Cloudflare in front of the server
description: Keep hostnames behind Cloudflare's proxy by giving the agent a Cloudflare API token, so that certificates are obtained through a DNS record; which permissions the token needs, how to set it, the SSL/TLS mode to choose, what changes for proxied records, visitor addresses and wildcard hostnames, and what shipwick doctor reports.
---

# Put Cloudflare in front of the server

With Cloudflare's proxy on for a record, the orange cloud, a visitor's connection ends at Cloudflare, and so does the certificate authority's: the proxy on your server cannot prove over HTTP or TLS that it serves the hostname, and gets no certificate. Give the agent a Cloudflare API token and Caddy proves it through a DNS record instead, the ACME DNS-01 challenge, which needs nothing to reach the server. This page shows how to create the token and give it to the agent, which SSL/TLS mode to set, what changes for proxied records, for the visitor's address and for wildcard hostnames, and what `shipwick doctor` and the API report.

## Before you begin

- Your hostnames are in zones at Cloudflare. With the token set, every certificate comes through Cloudflare DNS, also for hostnames whose record is DNS only: a hostname in a zone the token cannot edit, or at another DNS provider, gets no certificate while the token is set.
- You can do without all of this by leaving the proxy off: a record that is *DNS only* points straight at the server, and certificates are obtained as on any other server.
- The agent needs its reverse proxy, which the standard installation has. A plain agent without `SHIPWICK_CADDY_ADMIN` refuses to start with the token set.

## Create the token

In the Cloudflare dashboard: *My Profile* → *API Tokens* → *Create Token*, with two permissions on the zones your hostnames are in:

- *Zone → Zone → Read*
- *Zone → DNS → Edit*

Caddy uses the token to create and remove the `_acme-challenge` TXT records, nothing else. It must be an API token, not the Global API Key: the agent refuses a value of another form at startup and names the rule, never the value.

## Give it to the agent

On a new server, give it to the installer:

```bash
curl -fsSL https://get.shipwick.com | SHIPWICK_CLOUDFLARE_API_TOKEN=... sh
```

The installer writes it to `/opt/shipwick/.env` with the other settings, and its closing lines say that certificates are obtained through Cloudflare DNS and remind you of the SSL/TLS mode. It refuses a value that is not letters, digits, `-` and `_` before it installs anything.

On an existing server, add the line to `/opt/shipwick/.env`, then recreate the containers that read it:

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

Without the token, a deployment that names a wildcard is refused unless a certificate of your own covers it. See [Every name under a domain](/docs/tasks/several-hostnames#every-name-under-a-domain).

## Check it

`shipwick doctor` reads from the agent whether the DNS challenge is on, and judges a record behind Cloudflare's proxy accordingly. With the token:

```text
✓ api.example.com → Cloudflare's proxy (104.16.0.1)
```

Without it, the same record is a problem, in the agent's words:

```text
✗ api.example.com resolves to Cloudflare's proxy (104.16.0.1), not to the server: turn the proxy off for this record (DNS only), or set SHIPWICK_CLOUDFLARE_API_TOKEN on the agent to keep it on
```

When the agent's own hostname is proxied too, the server's address cannot be learned from the outside, and `doctor` says what it leaves out:

```text
! The server's own address is not known behind Cloudflare's proxy: ports 80 and 443 and the records' targets are not checked
```

Through the API, `GET /server` reports `proxy.dns_challenge`: `true` when certificates are obtained through a DNS record. It says that the challenge is on and nothing about the token.

While a certificate is on its way, `shipwick status` has a line for the hostname, `being obtained`; see [certificate status](/docs/tasks/certificates#certificate-status). If one never arrives, Caddy's log says why: `docker logs shipwick-caddy-1` on the server. A hostname in a zone the token cannot edit is one that never gets one.

## Going back

Remove the line from `/opt/shipwick/.env` and run `docker compose up -d` in `/opt/shipwick` again. Certificates are then obtained from the server itself, so set the records to *DNS only* first: a hostname that still resolves to Cloudflare's proxy is held back until its record points at the server. A deployed wildcard hostname is no longer served unless a certificate of your own covers it.

## What's next

- [`SHIPWICK_CLOUDFLARE_API_TOKEN`](/docs/reference/agent-configuration#shipwick-cloudflare-api-token) in the agent configuration reference, and [`GET /server`](/docs/reference/api#get-server) in the API reference.
- [Use a certificate of your own](/docs/tasks/certificates): the other way to a wildcard hostname.
- [Routing and HTTPS](/docs/concepts/routing-and-https#behind-cloudflare): why one policy covers every hostname, and where the token is kept.
