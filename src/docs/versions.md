---
title: Versions and compatibility
description: What a Shipwick version number promises from 1.0 on - what a patch and a minor may change, how deploy.yaml, the API, the files on the server and the CLI stay compatible across 1.x, how something is deprecated, which release receives fixes, and what is not promised.
---

# Versions and compatibility

From 1.0 on, a version number is a promise: what worked keeps working through every 1.x, and what is to change is announced before it does. This page says what each part of the number means, what stays the same in `deploy.yaml`, in the API, in the files on the server and between the CLI and the agent, how something is retired, which release receives fixes, and what is not promised. The [changelog](https://github.com/shipwick/shipwick/blob/main/CHANGELOG.md) is where each release says what it did under these rules.

## What the number means

Versions are `1.x.y`.

- **A patch** (`y`) fixes. It changes nothing anyone has to relearn.
- **A minor** (`x`) adds. It removes or renames nothing in `deploy.yaml`, the API or the CLI.
- **2.0** is the only release that may break, and it comes with a written upgrade. Nothing is planned for it yet.

A key, a field, a flag or a command that is to go is marked deprecated in the changelog of one minor and keeps working through that minor; it goes in 2.0 at the earliest. Nothing disappears between one release and the next without having been announced in the release before.

## deploy.yaml and shipwick.yaml

Every key 1.0 accepts, every 1.x accepts with the same meaning. New keys are optional, and a document that worked keeps working. What a new key adds is in the [deploy.yaml reference](/docs/reference/deploy-yaml), each with the release it came in.

A server older than the file is the one case where a key is refused: an agent does not know what a later release added, and says so rather than deploying the application without what the key asked for. The remedy is the upgrade, one step; see [Upgrade Shipwick](/docs/tasks/upgrade).

## The API

`/api/v1` stays. Paths, fields, status codes, error codes and the [envelope](/docs/reference/api#envelopes) stay; fields and endpoints are added, never removed or renamed, within 1.x. A list is never absent: it is `[]` when there is nothing in it.

Two rules let a client of your own work against every 1.x agent:

- An older agent answers an endpoint it does not have with [`404 ENDPOINT_NOT_FOUND`](/docs/reference/api#error-codes). A client that calls something newer than the agent reads that as "not on this server", not as an error of its own.
- A field the client does not know is read as absent, not as a fact. A field an older agent does not send says nothing about what it holds; the reference says, endpoint by endpoint, which release added what.

## The files on the server

`shipwick.db` changes only by a migration the agent applies when it starts, and the changelog names the migration under **Changed**. `encryption.key`, `agent-token.sha256`, the export file and the backup file keep their formats: a copy of any of them made under 1.0 is read by every 1.x. What each file is and holds is in [Where your data is](/docs/tasks/where-your-data-is).

Going back across a migration is not possible. An agent refuses a database newer than it supports, in words, and the installer puts the release that ran back. To be able to go back across such a release, copy the agent's data before you upgrade: [Go back to the release before](/docs/tasks/upgrade#go-back-to-the-release-before).

## CLI and agent

A 1.x CLI works against any 1.x agent. A command the agent does not know is refused in words, with the command that compares the two versions, and an older CLI keeps every command it had against a newer agent. [`shipwick server status`](/docs/reference/cli#server-status) says when the two are of different minor versions and which to upgrade; the installer brings the server's CLI to the agent's version, and [`shipwick upgrade`](/docs/tasks/upgrade#upgrade-the-cli-elsewhere) the one on your machine.

## Support

Fixes, security fixes included, are released as the next patch of the latest minor. Only the latest release is supported, and upgrading to it is one step from any 1.x: the installer, which brings a server from any release since 0.1.0 as well; see [Upgrade Shipwick](/docs/tasks/upgrade). This is how it was before 1.0; it is said here for 1.x. How to report a vulnerability, and what to expect, is in [Security](/docs/security#reporting-a-vulnerability).

## What is not promised

- **Measured numbers are measurements, not limits.** What one server carries and how long something takes were measured on the hardware the documentation names; they describe, they do not bind.
- **The dashboard's pages and the wording of CLI output may change in a minor.** A script that must not break reads the API, not the terminal.
- **Internal packages are not an API.** `agent/internal` and `cli/internal` change as the code needs.

## What's next

- [Upgrade Shipwick](/docs/tasks/upgrade): what an upgrade does, from every release, and how to go back.
- The [changelog](https://github.com/shipwick/shipwick/blob/main/CHANGELOG.md): what each release changed, and the migration it applied, if any.
- The [REST API](/docs/reference/api) and the [deploy.yaml reference](/docs/reference/deploy-yaml): every field with the release it came in.
