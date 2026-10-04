---
title: Run scheduled jobs and one-off commands
description: Run a migration from the new image before its replicas start, run commands on a cron schedule in UTC, run a command by hand in a container of the application, and read what each run wrote.
---

# Run scheduled jobs and one-off commands

Some work belongs to an application without being part of a replica: a migration that must run before a new version serves, a report at three in the morning, a console script typed by hand. This page shows the three forms Shipwick gives them: `pre_deploy` for the migration, `jobs` for the schedule, `shipwick run` for the command you type. It then covers what is kept of every run, and where failures show up.

## Before you begin

- The application is deployed. Jobs and commands run from the image of its active deployment, with its `env`, its resource limits, its `entrypoint` and `user`, and on the same network, so they reach a database at `postgres:5432` the way a replica does.
- Since 0.5, a job or one-off command whose image has been pruned from the server pulls it again, as a replica does, instead of failing. The pull uses the credential the agent keeps for that registry, if `shipwick registry login` stored one; see [Pull from private registries](/docs/tasks/private-registries).
- A run gets **none of the application's volumes**. A replica may be writing them, and two writers on one volume is how data gets lost. Work that needs the data goes through the application.
- Nothing runs on the server itself. A command runs inside a container, as the image's own command would.
- Listing jobs and runs needs a token with the `read` role; starting one needs `deploy`. See [Create tokens for CI and teammates](/docs/tasks/tokens).
- A static application, a folder served by the proxy, has no image and no containers: `pre_deploy`, `jobs` and `shipwick run` do not apply to it, and the agent says so (`STATIC_APPLICATION`).

## Run a migration before the replicas start

`pre_deploy` runs a command from the **new** image once it is pulled and before any replica of the new version exists:

```yaml
name: my-api
image: ghcr.io/company/my-api:1.4.2
port: 8080
domain: api.example.com
env:
  DATABASE_URL: postgres://app:${DATABASE_PASSWORD}@postgres:5432/app
pre_deploy:
  command: ["dotnet", "Migrate.dll"]
  timeout: 10m
```

| Field | Default | |
|---|---|---|
| `pre_deploy.command` | — | A list of arguments, passed to the container as written. A string is one argument; there is no shell in between. |
| `pre_deploy.timeout` | `10m` | How long the command may take, `1s` to `1h`. A command that outlives it is stopped and the deployment fails. |

The deployment shows the command as two steps:

```text
Deploying my-api...

✓ Validated deploy.yaml (1 variable substituted)
✓ Pulled image ghcr.io/company/my-api:1.4.2
✓ Running pre-deploy command
✓ Pre-deploy command finished (12s)
✓ Started 1 container
✓ Replica 1 passed health checks
✓ Replica 1/2 is serving 1.4.2; its 1.4.1 predecessor is retired
...
```

If the command exits non-zero or runs out of time, the deployment is `FAILED` before anything of the new version was started. The last 20 lines of its output are saved with the deployment, and `shipwick deploy` prints them under the error:

```text
✗ Deployment failed

  pre-deploy command exited 1

  Last output of the pre-deploy command:
  Applying migration 20260301_AddIndexToOrders...
  ERROR: relation "orders" does not exist

my-api is still running 1.4.1; the failed deployment did not affect it.
```

A timeout reads `pre-deploy command timed out after 10m`. The version that is serving is not touched in either case.

::: warning The command runs next to the running version
The replicas of the version that is serving keep running while `pre_deploy` runs, under `recreate` too, whose replicas stop only afterwards. What the command does must be safe next to the old code: add a column, do not drop one. This is the same backward compatibility a rolling update asks of migrations anyway. The container also gets no volumes; a migration works through the database's connection, not its files.
:::

Every pre-deploy run is kept in the application's run history under the job name `pre-deploy`; `shipwick jobs logs my-api pre-deploy` shows the last one's output in full, up to the limits in [What is kept](#what-is-kept).

## Run commands on a schedule

`jobs` runs commands on a cron schedule, each in a fresh container from the application's image:

```yaml
jobs:
  - name: nightly-report
    schedule: "0 3 * * *"
    command: ["node", "report.js"]
    timeout: 1h
  - name: cleanup
    schedule: "*/15 * * * *"
    command: ["node", "cleanup.js"]
```

| Field | Default | |
|---|---|---|
| `jobs[].name` | — | Lowercase letters, digits and dashes, at most 40 characters. Unique within the application. `pre-deploy` and `run` are reserved. |
| `jobs[].schedule` | — | Five cron fields, read in **UTC**. Quote it: `*` is YAML syntax otherwise. |
| `jobs[].command` | — | A list of arguments, like `pre_deploy.command`. |
| `jobs[].timeout` | `1h` | `1s` to `24h`. A run that outlives it is stopped and recorded as `timed_out`. |

Up to 20 jobs per application.

### The schedule

The five fields are minute, hour, day of month, month and day of week:

| Field | Values |
|---|---|
| minute | `0`–`59` |
| hour | `0`–`23` |
| day of month | `1`–`31` |
| month | `1`–`12`, or `jan`–`dec` |
| day of week | `0`–`6` from Sunday, or `sun`–`sat`; `7` is Sunday too |

Every field takes `*`, a value, a range `a-b`, a list `a,b,c` and a step `*/n` or `a-b/n`. When both day fields are restricted, a day that matches either one fires, as in every cron. There are no `@daily` shorthands and no sixth field for seconds.

Schedules are read in UTC whatever the server's time zone, so a job that runs at three in the morning does not move when the server does. A schedule that does not parse is refused by `shipwick validate` and by the agent:

```text
invalid deploy.yaml

jobs[0].schedule:
  invalid value "0 3 * *": expected 5 fields (minute hour day-of-month month day-of-week), got 4
  expected: five cron fields in UTC, e.g. "0 3 * * *" (every day at 03:00), "*/15 * * * *" (every 15 minutes)
```

### How jobs run

- **Once per firing, one run at a time.** A run that is still going when the schedule fires again is left alone, and that firing is skipped.
- **A stopped application runs no jobs.** After `shipwick stop`, `NEXT (UTC)` in the job list is `-` until the application is started again.
- **A run that outlives its timeout is stopped**, and recorded as `timed out`.
- **An agent restart interrupts runs.** A run that was going when the agent stopped is marked `interrupted` and its container removed on the next start; the job runs again at its next scheduled time. A firing that fell while the agent was down is not caught up.
- **A deployment does not cut a run short.** A job of the previous version that is still running when a deployment finishes runs to its end. The next firing uses the new version's image and command.
- **Every run is a fresh container**, removed when the run ends. Nothing is left on disk between runs except what the command wrote to the database or another service.

## See how the jobs are doing

```bash
shipwick jobs my-api
```

```text
NAME            SCHEDULE      LAST RUN  STATUS           NEXT (UTC)
nightly-report  0 3 * * *     21h ago   succeeded        2026-03-02 03:00
cleanup         */15 * * * *  4m ago    failed (exit 1)  2026-03-01 12:15
```

`STATUS` is the last run's outcome: `succeeded`, `failed (exit 1)`, `failed to start`, `timed out`, `interrupted by an agent restart`, or `running`. `LAST RUN` is `never` for a job that has not fired yet. Without an argument the command reads the application's name from `deploy.yaml` in the current directory. An application without jobs answers ``my-api has no scheduled jobs. Add some under `jobs` in deploy.yaml.``

Failed and timed-out runs also appear in the application's event feed, in `shipwick status` and the dashboard, as `Job cleanup failed (exit 1)` or `Job nightly-report timed out after 1h`. Successful runs record no event, because jobs run often; they are in the run history only.

### Start a job now

```bash
shipwick jobs run my-api nightly-report
```

The job starts at once, outside its schedule, and the command waits for it, prints what it wrote, and exits with the run's exit code. While a run of the same job is still going, the agent refuses a second one:

```text
This job is still running from an earlier start.

See it with: shipwick jobs <app>
```

Interrupting the command with Ctrl-C stops the waiting, not the run:

```text
Stopped waiting. The command continues on the server; see its output later with:
  shipwick jobs logs my-api nightly-report --run 42
```

### Read a run's output

```bash
shipwick jobs logs my-api cleanup
```

```text
Run #42 of cleanup: failed (exit 1), started 4m ago
Deleting expired sessions...
Error: connection refused (postgres:5432)
```

Without `--run`, the last run is shown. `--run <id>` picks another; the ids are in the run history (`GET /applications/my-api/runs`, or the dashboard's Jobs section). Two names stand for runs that have no job in `deploy.yaml`: `pre-deploy` shows the last pre-deploy command, `run` the last one-off command. A job that never ran answers `my-api has no runs of cleanup yet.`

## Run a command by hand

`shipwick run` does what a job does, for a command you type: a migration by hand, a console script, a look around.

```bash
shipwick run my-api -- rails db:migrate
```

```text
== 20260301 AddIndexToOrders: migrating ===
== 20260301 AddIndexToOrders: migrated (0.0412s) ===
```

- **The command comes after `--`.** Everything before it is for `shipwick`, everything after is passed to the container as written. Without an application name before `--`, the one in `deploy.yaml` is used: `shipwick run -- python manage.py createsuperuser`. Forgetting the separator is an error, `no command given`, with the example to copy.
- **The output is printed when the command finishes**, not while it runs, and `shipwick` exits with the command's exit code, so `shipwick run` is usable as a step in a script. A non-zero exit ends with `✗ failed (exit 1)` after the output.
- **There is no shell in between.** `--` is followed by arguments, not a command line: a pipeline or a redirect needs the image's own shell, `shipwick run my-api -- sh -c 'cmd | other'`, and only works if the image has one.
- **A command runs for at most an hour**, then is stopped and recorded as `timed out`.
- **Several commands may run at once.** Unlike scheduled jobs, one-off commands are independent of one another.

A command that fails or times out appears in the event feed as `Command rails failed (exit 1)`; a successful one records nothing.

## What is kept

| | |
|---|---|
| Runs | The last 50 runs of each job. Pre-deploy runs and one-off commands are jobs for this purpose, under `pre-deploy` and `run`. |
| Output | The last 200 lines a run wrote, at most 64 KB. The container itself is removed when the run ends. Since 0.7 the log archive keeps more of it, the last 10,000 lines, at most 4 MB: `shipwick logs my-api --run <id>`. See [Find out why it died](/docs/tasks/find-out-why-it-died). |
| Events | A failed or timed-out run adds a warning to the application's event feed. A successful one adds nothing. |
| Notifications | A failed or timed-out run is posted as `job.failed` when a webhook is configured, with the `shipwick jobs logs` line to read its output. See [Get notified](/docs/tasks/notifications). |

A run's output goes through Docker's default log driver whatever `logging` in `deploy.yaml` says: that local copy is where the output is read from, so a `gelf` or `syslog` driver on the replicas does not take the runs' output with it.

## The dashboard

An application's page has a Jobs section: every job with its schedule (marked UTC), its last run and outcome, and its next run relative to now, `Not while stopped` for a stopped application. **Run now** starts a job; the run history lists pre-deploy, scheduled and one-off runs alike, filterable by job, and opens a run's output, following it every second until it finishes. **Run command** is an editor with one field per argument, because the API takes an array and never a shell string. Both actions need the `deploy` role. See [Use the dashboard](/docs/tasks/dashboard).

## From a script

| Method | Path | Role | |
|---|---|---|---|
| `GET` | `/applications/:name/jobs` | read | The jobs of the active deployment, each with `last_run` and `next_run_at` (UTC; `null` while stopped) |
| `GET` | `/applications/:name/runs?job=&limit=50` | read | Runs, newest first, without output |
| `GET` | `/applications/:name/runs/:id` | read | One run with its `output` |
| `POST` | `/applications/:name/jobs/:job/run` | deploy | Start a job now → `202`, or `409 JOB_ALREADY_RUNNING` |
| `POST` | `/applications/:name/run` | deploy | Run a command; body `{"command": ["rails", "db:migrate"]}` → `202` |

Both `POST`s answer with the run and a `Location` to poll until `finished_at` is set. A run's `status` is `running`, `succeeded`, `failed`, `timed_out` or `interrupted`; `exit_code` is `null` when the container could not be started. See [the API reference](/docs/reference/api#get-applications-name-jobs).

## What's next

- The [`pre_deploy`](/docs/reference/deploy-yaml#pre-deploy) and [`jobs`](/docs/reference/deploy-yaml#jobs) fields in the deploy.yaml reference.
- [`shipwick jobs`](/docs/reference/cli#jobs) and [`shipwick run`](/docs/reference/cli#run) in the CLI reference.
- [Get notified](/docs/tasks/notifications) when a job fails.
