---
title: Sign in with your company's accounts
description: Let people sign in to the Shipwick dashboard through an OpenID Connect provider such as Google Workspace, Microsoft Entra, Okta or Keycloak, and say with shipwick access who gets which role.
---

# Sign in with your company's accounts

A token is right for the CLI and for CI. For people in a browser, the agent can leave the question of who someone is to the place that already answers it: an OpenID Connect provider — Google Workspace, Microsoft Entra, Okta, Keycloak, or any other. Since 0.6, people sign in to the dashboard there, with whatever second factor and password rules the provider enforces, and a table on the agent says what each of them may do.

Shipwick keeps no passwords and no list of users. Tokens keep working exactly as before, and the dashboard still takes one.

This page covers registering Shipwick at the provider, the three lines that turn sign-in on, the rules that say who gets in and as what, what a session is and when it ends, and how to take access away.

## Before you begin

- The dashboard has a hostname: `SHIPWICK_DASHBOARD_DOMAIN` is set. The provider sends people back to it. See [Use the dashboard](/docs/tasks/dashboard#enable-the-dashboard).
- You can register an application at the provider.
- Managing the rules needs the `admin` role: the root token, or an `admin` token. See [Create tokens for CI and teammates](/docs/tasks/tokens).
- The agent and `shipwick` are 0.6 or later.

## Register Shipwick at the provider

Register Shipwick as a web application — a *confidential* client, the authorization-code flow — with one redirect URI: the dashboard's hostname followed by `/auth/callback`.

```text
https://dashboard.example.com/auth/callback
```

The provider issues a client id and a client secret. Where to do it, and what else each provider needs, follows.

### Google Workspace

Issuer: `https://accounts.google.com`

Google Cloud console → *APIs & Services* → *Credentials* → *Create credentials* → *OAuth client ID*, type *Web application*, with the redirect URI under *Authorized redirect URIs*. Set the consent screen's user type to *Internal* to admit your organisation only.

Google's ID tokens name no groups: use rules for addresses and for your domain.

### Microsoft Entra ID

Issuer: `https://login.microsoftonline.com/<tenant id>/v2.0`

*App registrations* → *New registration*, *Accounts in this organizational directory only*, redirect URI of the platform *Web*; the secret under *Certificates & secrets*. The tenant's own issuer is required: the shared `common` and `organizations` endpoints name no single issuer and are refused.

For group rules add a groups claim under *Token configuration*. Entra sends each group's **object id**, so a rule reads `group:0f3c…`, and leaves the claim out for a person in more groups than fit a token: limit it to the groups assigned to the application. An account without a mail address has no `email` claim and cannot sign in.

### Okta

Issuer: `https://<your org>.okta.com`

*Applications* → *Create App Integration* → *OIDC – OpenID Connect* → *Web Application*, with the redirect URI under *Sign-in redirect URIs*.

For group rules add a groups claim filter to the application's ID token (claim name `groups`) and set `SHIPWICK_OIDC_SCOPES="openid email profile groups"`.

### Keycloak

Issuer: `https://<host>/realms/<realm>`

A client with *Client authentication* on and the *Standard flow*, the redirect URI under *Valid redirect URIs*.

For group rules add a mapper of the type *Group Membership* to the client's dedicated scope: token claim name `groups`, *Add to ID token* on, and *Full group path* off for plain names (`developers`) or on for paths (`/developers`). An account whose e-mail address is not verified in Keycloak is refused.

### Any other provider

Any provider that speaks OpenID Connect works the same way: a confidential web client, the authorization-code flow, the redirect URI above. Its issuer is the URL under which it publishes `/.well-known/openid-configuration`.

Sign-in was tested against Keycloak 26; the notes for the other three follow what those providers document.

## Turn it on

The client id, the client secret and the provider's issuer URL go into `/opt/shipwick/.env` on the server:

```bash
SHIPWICK_DASHBOARD_DOMAIN=dashboard.example.com
SHIPWICK_OIDC_ISSUER=https://accounts.example.com/realms/company
SHIPWICK_OIDC_CLIENT_ID=shipwick
SHIPWICK_OIDC_CLIENT_SECRET=…
```

Then apply the change, and check:

```bash
cd /opt/shipwick && docker compose up -d      # the agent reads its environment at start
shipwick server status
```

```text
Sign-in         https://accounts.example.com/realms/company
```

The issuer is the URL under which the provider publishes `/.well-known/openid-configuration`, written exactly as the provider writes it there. It must be `https`; plain `http` is accepted for `localhost` and private addresses only. The agent reads the provider's endpoints and signing keys from there and reads them again every hour, so a key the provider rotates needs nothing done here. A provider that is down at that moment stops sign-ins, not the agent: tokens and sessions that exist are not affected.

Two more variables exist for a provider that differs from the defaults:

| Variable | Default | |
|---|---|---|
| `SHIPWICK_OIDC_SCOPES` | `openid email profile` | What is asked of the provider, separated by spaces; must contain `openid`. |
| `SHIPWICK_OIDC_GROUPS_CLAIM` | `groups` | The claim of the ID token that lists a person's groups. |

All of them are described in [Agent configuration](/docs/reference/agent-configuration).

The sign-in page of the dashboard now offers **Sign in with** the provider above the token field. Nobody gets in yet: that takes a rule.

## Say who gets in, and as what

Nobody, until a rule says so:

```bash
shipwick access grant ada@example.com --role admin
shipwick access grant group:backend --role deploy --app my-api --app worker
shipwick access grant '*@example.com' --role read
```

```text
✓ group:backend has the deploy role, limited to my-api, worker
Whoever is signed in and gets something else by this is signed out with their next request, and signs in again.
```

A rule gives a role — the [same three a token has](/docs/tasks/tokens#the-three-roles), and for `deploy` the same optional [limit to applications](/docs/tasks/tokens#limit-a-token-to-some-applications) — to one of three things:

| Written as | Matches |
|---|---|
| `ada@example.com` | The person with that address. |
| `group:backend` | Everyone in that group, as the provider names it, case and all. |
| `'*@example.com'` | Every address at exactly that domain, not its subdomains. Quote it, or the shell expands the star. |

Granting again to the same address, group or domain replaces the rule. Rules are kept whether or not a provider is configured, so the table can be prepared first.

```bash
shipwick access ls
```

```text
WHO               ROLE     APPLICATIONS     GRANTED   BY
ada@example.com   admin    all              2d ago    root
group:backend     deploy   my-api, worker   2d ago    root
*@example.com     read     all              1d ago    ada@example.com
```

### Which rule decides

The most specific rule that matches a person decides, and the others are not looked at:

1. the rule for their address;
2. else the rules for their groups;
3. else the rule for their domain.

So `*@example.com` can let the whole company read, a group can deploy, and a rule for one address can give that person less than their group as well as more. Of several groups the highest role counts; where that is `deploy`, a group without a limit lifts it, and the limits of the others add up.

Someone without a matching rule who signs in is refused with a sentence they can forward to whoever administers the server:

```text
grace@example.com signed in, and no rule on this server gives that address a role.
An admin grants one with: shipwick access grant grace@example.com --role read
```

The agent takes the address from the provider's ID token, and only one the provider does not mark as unverified.

## What signing in gives

A session of ten hours: longer than a working day, so nobody signs in twice in one, and shorter than the night between two, so every day starts with what the provider says about the person that day. It is not extended by use.

To the agent a signed-in person is the same kind of caller a token is, with a role and perhaps a list of applications. Everything about [roles and limits](/docs/tasks/tokens) holds unchanged, deployments name the address in `by`, and the [audit trail](/docs/tasks/audit) shows the person:

```text
WHEN                  WHO               ACTION    ON       RESULT   FROM          DETAIL
2026-10-03 09:14:02   ada@example.com   deploy    my-api   ok       203.0.113.9   deployment 31
2026-10-03 09:00:11   ada@example.com   signin    server   ok       203.0.113.9   role deploy, limited to my-api, expires 2026-10-03T19:00:11Z
```

Sign-ins are recorded, the refused ones too, and so is every change to the rules.

## Take access away

A session rests on what the rules gave the person when they signed in, and every request asks the rules again. Revoke the rule, or change what it gives, and the sessions that rested on it end with their next request — not when they expire — and say why. Signing in again gives what the rules give now, or nothing.

```bash
shipwick access revoke group:backend
```

```text
✓ Revoked the rule for group:backend
Whoever signed in through it is signed out with their next request, unless another rule gives them the same.
```

What the agent cannot see is a change at the provider: someone removed from a group there, or whose account was disabled, keeps a session that exists until it ends, ten hours at most. To end it now:

```bash
shipwick access sessions                    # who is signed in, as what, until when
shipwick access signout ada@example.com     # ends every session of that person
```

```text
WHO               ROLE     APPLICATIONS   SIGNED IN   ENDS         LAST USED
ada@example.com   deploy   my-api         41m ago     in 9 hours   2m ago
```

```text
✓ Signed ada@example.com out of 1 session
```

::: warning signout signs a person out; it does not keep them out
While a rule covers them and the provider lets them in, they can sign in again. Offboarding happens at the provider; a rule for a single address is revoked here.
:::

## In the dashboard

Under **Access**, the **Sign-in** tab holds the same table: the rules with **Revoke** on each, a form that gives an address, a group or a domain a role, and who is signed in now. See [Use the dashboard](/docs/tasks/dashboard#access).

A session that has expired, or was ended, returns the person to the sign-in page with the reason.

## What Shipwick does about it

- The client secret is read from the agent's environment, sent to the provider's token endpoint and nowhere else, and never logged or returned. The dashboard and the browser never see it.
- The sign-in is the authorization-code flow with PKCE. The code the provider appends to the callback is useless to anyone who reads it there: redeeming it takes a verifier that never left the dashboard's server-side cookie, and the provider redeems each code once.
- The agent believes an ID token only if one of the provider's keys signed it (RS256 or ES256; a token that claims to be unsigned is refused), if it was issued by the configured issuer for this client, is within its time and minutes old, and carries the one-time value of this sign-in. Each such value is accepted once.
- The provider is only ever asked to send people back to the dashboard's configured hostname, never to an address taken from a request.
- Of a session the agent keeps the SHA-256, as of a token. A failed sign-in and a session nobody issued count towards the same limit as a wrong token.
- Rules, sessions and sign-ins stay on the server: an [export](/docs/tasks/move-to-a-new-server) takes none of them along, as it takes no tokens.

## What's next

- [Create tokens for CI and teammates](/docs/tasks/tokens): what the CLI and a pipeline use, and what the three roles allow.
- [See who changed what](/docs/tasks/audit): sign-ins and everything done after them.
- [`shipwick access`](/docs/reference/cli#access) in the CLI reference, and [`/auth` and `/access`](/docs/reference/api#get-auth) in the API reference.
- [Security](/docs/security): the trust model behind the roles.
