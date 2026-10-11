---
title: Admit Cloudflare only
description: Run a Shipwick server whose firewall admits ports 80 and 443 from Cloudflare's addresses alone - the five things it takes, what shipwick doctor can and cannot see from outside such a server, and what does not pass through Cloudflare's proxy.
---

# Admit Cloudflare only

A server that admits ports 80 and 443 from Cloudflare's addresses alone, and from nowhere else, is a sound arrangement: every visitor comes through Cloudflare, and what Cloudflare refuses never reaches the server. This page lists what it takes, what it changes about `shipwick doctor`, and what does not pass through Cloudflare's proxy. It builds on [Put Cloudflare in front of the server](/docs/tasks/cloudflare), which has the token and the SSL/TLS mode.

## Before you begin

- The agent has a Cloudflare API token, [created and set](/docs/tasks/cloudflare) as described there, with *Zone → Zone → Read* and *Zone → DNS → Edit* on your zones, those two exactly.
- Every hostname the server serves — the API's, the dashboard's and every application's — is in a zone at Cloudflare.
- The firewall is the provider's, beside the machine. One on the server does not close a port Docker has published; see [A firewall, and what Docker does to it](/docs/tasks/prepare-a-server#a-firewall-and-what-docker-does-to-it).

## What it takes

Five things.

1. **The provider's firewall** admits 80 and 443 (and 443/udp) from Cloudflare's published ranges only — <https://www.cloudflare.com/ips-v4> and <https://www.cloudflare.com/ips-v6> — and SSH from where you administer. The ranges change rarely, and they do change: keep the firewall's copy current. The agent carries its own copy for recognising proxied records, dated under [Behind Cloudflare](/docs/concepts/routing-and-https#behind-cloudflare); the firewall's is yours.
2. **Every hostname served is proxied**, the orange cloud: the agent's and the dashboard's hostnames too. A record that is *DNS only* would send visitors straight at a server that refuses them.
3. **SSL/TLS mode *Full (strict)*** on the zone, as under [Set the SSL/TLS mode](/docs/tasks/cloudflare#set-the-ssl-tls-mode-to-full-strict).
4. **`SHIPWICK_CLOUDFLARE_API_TOKEN`** on the agent, so that certificates come through DNS. Let's Encrypt cannot reach port 443 through such a firewall: without the token the `tls-alpn-01` challenge fails with *Timeout during connect (likely firewall problem)*, which `shipwick status` and `doctor` show as *Let's Encrypt could not connect to the server on port 443 (tls-alpn-01): a firewall in front of it?*
5. **The token's IP filter**, if it has one, names both of the server's addresses, the IPv6 one included: a server that has one calls Cloudflare from it. `doctor` prints the address Cloudflare saw the agent's check come from.

## What doctor sees

From outside, the agent's hostname resolves to Cloudflare, so the server's own address is nowhere in DNS, and ports 80 and 443 and the targets of the records are not checked. The screen says so in one line, in place of the port lines:

```text
! Behind Cloudflare only: ports and record targets are not checked from outside
```

What it does see is what the agent sees from inside, in the same screen: the token's check — whether Cloudflare accepts the token from the server's address, which zones it sees and can edit — and the certificates' failures, in the proxy's words. See [Check it](/docs/tasks/cloudflare#check-it).

## What does not pass through Cloudflare's proxy

- **A request body larger than Cloudflare's limit for your plan** — 100 MB on the free plan, per Cloudflare's documentation — is refused by Cloudflare before it reaches the agent: an image sent by `shipwick deploy` from a `build`, a volume restore, an import. Send those through a tunnel that does not pass through Cloudflare: `ssh -L 9000:127.0.0.1:9000 user@server`, then `shipwick deploy --url http://127.0.0.1:9000`; see [Reach the API without a hostname](/docs/tasks/access-without-a-hostname).
- **A response that stays silent** is closed by Cloudflare after 100 seconds without a byte. Long streams are kept alive and survive that limit from 0.9: a followed log carries a heartbeat every 20 seconds while the application is quiet, and `shipwick logs -f` takes a stream that was cut up where it left off; see [Read logs](/docs/tasks/inspect-and-logs#read-logs). A request whose answer is held until the work is done — `POST /import`, `POST /standby/promote` without `wait=false` — carries nothing until then; `shipwick` polls on the side and uses `wait=false`, and a client of your own should too. See [Following logs](/docs/reference/api#following-logs) and [`POST /standby/promote`](/docs/reference/api#post-standby-promote).

## What's next

- [Put Cloudflare in front of the server](/docs/tasks/cloudflare): the token, the check and the SSL/TLS mode.
- [Prepare a server](/docs/tasks/prepare-a-server#before-the-first-command): the firewall at the provider, and why a closed one is silence.
- [Reach the API without a hostname](/docs/tasks/access-without-a-hostname): the tunnel for what Cloudflare does not carry.
- [Routing and HTTPS](/docs/concepts/routing-and-https#behind-cloudflare): why one policy covers every hostname once the token is set.
