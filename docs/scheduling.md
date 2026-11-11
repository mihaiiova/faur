# External scheduling on Linux

Faur can propose and manage **systemd user timers** for an existing local Pi
skill (#37). systemd runs plain Pi; Faur and `system.yaml` are not runtime
dependencies. There is no schedule declaration in the architecture schema, no
launcher, daemon, scheduler engine or extra generated-project package.

## Conversation

In the existing project, ask:

> /faur Run the progress-check skill every morning at 09:00 Europe/Bucharest,
> with a 15-minute timeout. Show me the proposed schedule.

Before proposing the schedule, Faur clarifies what should happen to the result:
ask an open question, not a fixed-choice menu. Examples include a report in a
specified folder, email to a specified recipient, delivery to another application,
or explicitly no output; these are not an exhaustive list. An already-settled choice is
reused, not asked again. External delivery needs verified tool/MCP access,
credentials, authorization and unattended suitability. The agreed output
behavior belongs in the execution skill; any needed skill/integration change
is approved separately before scheduling. The journal is not assumed to be the
report destination, and choosing no output does not disable logs. This is
advisory conversational guidance, not a CLI/validator requirement.

Faur checks that the skill exists, proposes one schedule operation, then asks
whether to apply, discuss or discard it. Installation is an **external-state
change**: the approval includes native file diffs and systemctl commands.
Headless maintenance cannot approve. Creating a skill and scheduling it are
separate approved changes; the skill must already exist locally.

- `/faur schedule status` — read installed units and manager observations.
- `/faur schedule stop daily` — preview disabling the timer and cancelling the
  active service, then ask. Files remain installed.
- `/faur schedule remove daily` — preview stopping it and deleting both units,
  then ask. Logs are not deleted.
- `/faur Resume/update daily with ...` — propose an update and approve it.
  Updating re-enables the timer; a currently running service finishes under its
  previous configuration. New settings apply on its next start.

No generated agent gets a scheduling tool. These operations belong to the
maker in the developer's Pi. Instructions to obtain approval are advisory;
the maker's interactive apply gate (or explicit CLI `--yes`) enforces approval
for this path, not for arbitrary tools an agent might otherwise possess.

## CLI

Write an operations file (no secrets):

```json
[{
  "op": "add",
  "target": "schedule",
  "name": "daily",
  "value": {
    "skill": "progress-check",
    "request": "Review progress; report only actionable changes.",
    "calendar": "*-*-* 09:00:00",
    "timezone": "Europe/Bucharest",
    "timeoutSeconds": 900,
    "environmentFile": "/home/me/.config/owlie/runtime.env"
  }
}]
```

`environmentFile` and `request` are optional. Timeout defaults to 1800 seconds
and accepts 10–86400. An explicit IANA timezone (or UTC) is required; the calendar
is validated by the installed `systemd-analyze`. Calendar precision is one
second; system load may delay activation. Schedule names are kebab-case, at most
48 characters. Skill names must also be kebab-case. Skills must be in `.pi/skills/<name>/SKILL.md` or
`.agents/skills/<name>/SKILL.md` with matching frontmatter.

```sh
node /path/to/faur/src/faur.mjs change /path/to/agent --operations schedule.json --dry-run
# Review the preview before explicitly approving:
node /path/to/faur/src/faur.mjs change /path/to/agent --operations schedule.json --yes
node /path/to/faur/src/faur.mjs schedule /path/to/agent status
```

Use `op: update` with the **complete** value object to replace the configuration.
For stop/remove, use only `op`, `target` and `name`. Do not combine schedule and
architecture changes in one proposal. The CLI also offers confirmation on a
terminal; without a terminal and without `--yes`, nothing is applied.

## Native ownership and host requirements

Units live in `${XDG_CONFIG_HOME:-~/.config}/systemd/user/`, named with a stable
hash of the project's canonical absolute path and the schedule name. Moving the
project changes its identity: remove old schedules before moving it. The native
unit pair is authoritative; there is no private schedule database. Faur refuses
foreign files, symlinks, incomplete existing pairs and native drop-ins, and
checks that the preview's unit files have not changed before applying.
You can manage native units directly with systemctl; review native edits before
asking Faur to replace them.

The host needs Linux, a reachable systemd user manager supporting `Type=exec`,
`systemctl`, `systemd-analyze`, `flock`, `which`, Node and an installed Pi on the
maker's PATH, plus a writable `/run/user/<uid>` directory for the shared flock
file. Missing/unwritable runtime directories are refused at proposal time.
Native WorkingDirectory/EnvironmentFile paths containing quotes or ending in
whitespace/backslash are refused rather than ambiguously encoded.
Faur records absolute Pi/flock paths and a minimal PATH containing
the Pi and Node directories plus standard binary directories. Other tools must
be available on that PATH, or configured explicitly in the environment file.
Use the same account/configuration directory as the user manager.

Status reports `linger`. With `Linger=no`, operation after logout/reboot is **not
guaranteed**. An administrator can separately authorize
`loginctl enable-linger <user>`. Faur never runs sudo or enables lingering.
A missing manager or unavailable status is reported, not treated as a success.

## Runtime and guarantees

- **Enforced by systemd:** null stdin; wall-time timeout via `RuntimeMaxSec`;
  cgroup cancellation via `KillMode=control-group`, SIGTERM followed by SIGKILL
  after 10 seconds. No automatic restart or missed-run catch-up.
- **Enforced by flock:** scheduled runs sharing the same canonical project path
  cannot overlap. Contention exits 75 rather than queueing. The timer itself
  does not restart its already-active target. Manual Pi runs are not locked.
- **Observed, not inferred:** status shows timer activation, next scheduled
  activation and service process result/exit status. Process success is **not
  task success**; task verdicts belong to the skill/consumer.
- **Output:** stdout/stderr go to the user journal. Read with
  `journalctl --user -u <unit>.service`. Journal availability/retention is host
  policy. No notifications, outcome evaluator, retries or cost cap are supplied.
- **Credentials:** the service inherits the user manager's environment and uses
  ordinary Pi authentication. Your interactive shell's environment and project
  `.env` are not automatically loaded. An optional existing absolute
  `EnvironmentFile` uses systemd assignment syntax, not shell sourcing; Faur
  references its path without reading/copying its values. Environment files can
  override PATH and other variables. Protect them outside Faur and never commit
  secrets. This is trusted execution: environment-based credentials are not
  protected from same-user processes, agents or tools in the run.
- **Trust, not command approval:** `--approve` allows project resource loading;
  it does not approve consequential commands. Interactive-approval commands
  remain blocked unattended. Validate skill suitability separately.
- **No sandbox:** plain Pi loads global configuration and parent context as
  usual. Tool/credential reach is not reduced by a timer or a prompt rule.

Application failures report completed external commands and recovery directions.
File writes have best-effort rollback; manager state, already-started runs and
external effects are **not transactional**. Inspect native files, timer/service
status and the journal before recovery. Faur does not silently retry or claim
that an incomplete apply changed nothing.

## Verification

Default scheduling tests exercise public CLI operations and Pi's approval
adapter with a fake external manager and the real systemd calendar validator.
These Linux-specific tests skip when Linux, systemd-analyze or the user runtime
directory is unavailable. An opt-in test creates uniquely named temporary units
in the actual user manager and exercises **real Pi over RPC approval and real
timer execution**, using a generated project and a local fake model, without
paid-provider credentials. It proves skill expansion/literal arguments, execution
without `system.yaml` or Faur runtime, project-level exclusion, timeout and
cleanup. It disables/removes its units afterward; it installs no Owlie schedule.

```sh
RUN_FAUR_SCHEDULE_TEST=1 node --test test/schedule-systemd.test.mjs
```
