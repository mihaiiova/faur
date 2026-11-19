# Faur

**Design, generate, check, and revise specialized Pi agents.**

Current release: [v0.42.0](https://github.com/mihaiiova/faur/releases/tag/v0.42.0)
— native-agent MCP serving, without modified Pi packages.

Faur (formerly **Pi Forge**) is a conversational development tool
for specialized agents. You describe the outcome you want. Faur recommends the
simplest agent that achieves it and generates it as an ordinary, project-local
Pi project: an orchestrator, optional specialists, skills, packages, MCP
integrations and declared commands. It then keeps that agent
working as your needs change.

**The specialized agent is the product. Pi is its runtime.** Faur composes
Pi's own resources and adds no workflow engine or scheduler of its own. A
normal project pins no Faur: declared commands use a separate package when
needed; Faur does not provide MCP per-call approvals. It starts with `pi` in
its folder. Optional MCP-serving projects bundle Faur's thin adapter and local
maintenance assets; Pi still owns agent execution.

> **Direction (2026-11-02).** Faur is the maker; generated projects are
> ordinary Pi projects that run with plain `pi`, with Faur uninstalled globally.
> The optional project-local MCP interface is the approved hosting exception.
> See the [product direction](docs/product-direction.md) and the
> [migration plan](docs/architecture-audit.md#5-runtime-dependencies-and-the-migration).

- [Product direction](docs/product-direction.md): what Faur is, how to judge
  changes, and its non-goals. This is the authoritative document.
- [Documentation](https://faur.mightyagents.dev): installation, building agents,
  running, maintenance and scheduling.
- [Roadmap](docs/roadmap.md): current priorities and authoritative GitHub issues.
- [AGENTS.md](AGENTS.md): engineering principles for anyone changing this
  repository.

> **Rename:** Faur was formerly Pi Forge. Older projects are regenerated
> into a new directory; review and manually reconcile their authored files.
> See [migration](#no-faur-in-the-ordinary-project).

### Architecture in brief

```text
you ──▶ /faur (builder, conversational)
          │  faur CLI: discover · validate · generate --dry-run · generate
          ▼
   <project>/.pi/system.yaml   record of the agreed design (schema 1)
   <project>/.pi/…             native Pi files: settings, agents, skills, mcp.json, prompts
   <project>/.faur/            maker build record and capability evidence
          │
          ▼
   pi, pi -p "/skill:…"   Pi runs the agent; /faur revises it
```

- **Design and generate:** `/faur` holds a design conversation, writes
  `system.yaml`, previews the generated files and writes them only after you
  confirm. Generation is deterministic and idempotent, and never silently
  overwrites your edits.
- **Check:** `/faur check` validates `system.yaml`, compares generated files,
  and reports capability evidence for every agent. A configured capability is
  not necessarily verified; results distinguish live, last seen, missing and
  not verifiable. Checking actual behavior is on the [roadmap](docs/roadmap.md).
- **Revise:** inside a project, `/faur <request>` proposes a small structured
  change. When the turn ends, Faur shows the diff and applies it only if you
  approve.

The former personal Pi setup (spec lifecycle, domain skills, sync/state
extensions) now lives in the private
[`pi-personal`](https://github.com/mihaiiova/pi-personal) repository; see
[Personal Pi setup](#personal-pi-setup).

## Using Faur today

Start it from any Pi session outside a Faur project with `/faur <outcome>`
(or `/skill:faur`). The builder works as a design conversation, not an
interview: it uses what you've already said, recommends the simplest system
that fits, and asks only questions that change the design. When you say
"build it", it runs `faur discover`, writes a `.pi/system.yaml`, previews
the generated files and applies them only after you confirm. See the
[conversational acceptance scenarios](docs/faur-conversation.md). The deterministic CLI behind it:

```sh
node src/faur.mjs discover [dir]          # models, your skills, MCP, CLIs
node src/faur.mjs validate <dir>
node src/faur.mjs generate <dir> --dry-run  # then without --dry-run
node src/faur.mjs modify <dir> --dry-run
```

### Manage project-local agents

New independent agents default to `.agents/<name>/`; explicit locations remain
supported. From the main project:

```text
/faur agents
/faur                          # pick an agent
/faur agent jared status
/faur Update Jared’s review operation
```

Faur discovers direct children with `.pi/system.yaml`, not a new registry or ID.
Maintenance keeps the existing preview/approval path and never loads the target
agent's executable resources. See [project-local agents](docs/project-local-agents.md).

### Expose an agent through MCP

```text
/faur Create Jared in .agents/jared and expose audit and review as MCP tools.
```

Faur can generate a local stdio MCP server so another coding agent can call your
agent's named operations, such as `audit` or `review`:

```text
Claude Code / Codex / another MCP client
                  │ public operation + validated JSON arguments
                  ▼
       Faur-generated external MCP server
                  │ fresh native Pi session
                  ▼
       Your agent in its own folder
       instructions · skills · specialists · commands
                  │ optional connections it uses
                  ▼
          Mobbin / other MCP services
```

These are two different interfaces: `mcpServer.operations` declares what your
agent **offers to callers**; `integrations.mcp` declares the services your agent
**uses**. Faur does not automatically expose every internal tool publicly.

Install the generated host dependencies once:

```sh
cd .agents/jared/.faur-mcp
npm ci
```

Review/install the agent's declared native packages, supply model credentials,
and ask your coding agent to register the server using `.faur-mcp/README.md`.
Consumers need Node.js >=22.19.0 and npm on Linux/macOS, but no separately
installed global Pi or Faur. The runtime uses published, unmodified packages.

**Where it works:** Pi runs from the agent's own folder. The configured target
project is supplied as an absolute path in each request. File operations must
use absolute target paths; shell commands must explicitly change directory.
This is advisory—not automatic path rebasing or a filesystem sandbox. Calls
have fresh conversations, but source-local files/memory are shared; keep
project-specific state in the target project.

Native instructions, skills, templates, extensions, specialists, commands and
upstream MCP use Pi's ordinary loading and child-inheritance policies. Ancestor
instructions/skills can load, and server startup alone does not verify that
every integration works. Only bundled maker maintenance opts out of execution.

Use explicitly granted provider-key environment variables, or opt into an
existing Pi Codex subscription store. Trusted agent code, specialists and tools
can directly access that selected store, including other entries; there is no
credential isolation, automatic login or API-billing fallback. Forced shutdown
can interrupt refresh. Timeouts and cancellation are bounded; detached/background
work may survive. See [MCP serving](docs/mcp-serving.md) for configuration,
registration, authentication and the full limits.

### Models: chosen per agent

Nothing is hardcoded. Every agent — the orchestrator and each subagent — names
its own model from the machine's Pi line-up (`pi --list-models`, also reported by
`faur discover`), with an optional thinking level. Agents may share a model or
each use a different one, and any model can be changed later.

### Skills: chosen per agent, suggested from skills.sh

Faur ships no domain skills of its own. When you set up a system, or add or
change an agent, it searches the open skills registry ([skills.sh](https://skills.sh))
for that agent's role and suggests a few candidates, with source, install count
and page. It shows each skill's actual `SKILL.md` and files before you decide.
Your picks are pinned to a commit and installed with the open `skills` CLI into
the project's own `.agents/skills/` (never globally), recorded in
`skills-lock.json`:

```sh
node src/faur.mjs search-skills seo audit
node src/faur.mjs preview-skill coreyhaines31/marketingskills@seo-audit
```

While designing, Faur reads public pages you give it with
`faur fetch <url>`: https only, public addresses, no credential-bearing URLs,
and the result is marked as untrusted content. It does not search the web.

A skill can also be authored as a project file, come from a pinned package, or be vendored
from a directory you point at. Each agent lists the skills it receives:

```yaml
schema: 1
name: research-desk
orchestrator:
  name: lead
  model: openai-codex/gpt-6-sol
  thinking: medium
  tools: [read, grep, subagent]
agents:
  - name: researcher
    model: deepseek/deepseek-flash
    thinking: high
    tools: [read, grep]
    skills: [notes, house-style]
skills:
  - name: notes
    source: ../my-skills/notes            # vendored into .pi/skills/notes/ once
  - name: house-style
    source: npm:@acme/house-style@1.2.0   # pinned package, added to runtime packages
  - name: seo-audit                       # from skills.sh, pinned to a commit
    source: skills:coreyhaines31/marketingskills/skills/seo-audit@17772c7a80b7b8c7a47af30f648374cd8bd8adc5
```

Skills in the shared Agent Skills folder `~/.agents/skills/` also load for the
orchestrator; specialist skills follow their declared lists and native inheritance
settings.

### Tools: browsing by default

Faur adds `read`, `ls`, `find` and `grep` to every non-empty tool list and
shows the additions in the change preview. Omitting `tools` requests that
baseline; `tools: []` stays empty. `codemode` must be granted explicitly:
it can reach other exposed tools, including inherited global MCP servers.
The generator enforces the baseline, not OS isolation; actual tool access
is governed by Pi and its packages.

### Tasks and document formats

Faur puts an agent's procedures in skills, not in a schema. When the
conversation shows a repeatable task, report or handoff, Faur drafts a skill
for that agent (when to use it, steps, output paths and format, rules) and
proposes it with the design. Approving the change writes
`.pi/skills/<name>/SKILL.md`; `system.yaml` records only its name and
description. From then on the file is yours: Faur never regenerates it, and
revising it is another previewed proposal. Skill instructions are advisory,
not enforced output guarantees.

Faur does not choose foreground or background launches. Built-in MCP tools
work in either mode; foreground specialists need extension paths in their native
agent files, which Faur cannot generally infer. On every start with Faur loaded,
it checks declared tools and skills, reporting missing capabilities and cases
it cannot verify. MCP servers connect after
start, so `/faur check` also checks their tools. The last result is saved in
`.faur/check.json` and shown by `/faur status`.

Outside a session, run `node /path/to/faur/src/faur.mjs check-agent <project>`.
It makes no model calls and does not connect MCP by default; `--connect` runs
`pi mcp list --json` using the project's isolated Pi home and may connect to
networks and use configured credentials. Pi's shell commands read project MCP
servers only for a saved trust decision, so `--connect` saves one in the
project's own isolated Pi home and
reports `trustSaved`; your personal Pi home is not touched. CLI
checks test command presence only, not authentication or functionality. The
CLI inspects installed Pi extensions using Pi's SDK without installing missing
packages. If the project has auto-discovered extension code that Pi's SDK
could load even when disabled, CLI extension results are `not verifiable`
(configuration files alone don't count); use `/faur check` in
a running session. Extension loading runs the installed extensions' registration
code. Results reflect observations, not a functional or credential test.

### MCP: Pi's built-in support

Generated systems use Pi's built-in MCP; there is no MCP package to install.
Declare each server in `integrations.mcp` and choose per agent which tools it
gets: `mcp:<server>` or `mcp:<server>/<tool>` for a specialist, `mcp` for the
orchestrator. In the server's config, `includeTools` lists the tools agents may
use and `excludeTools` hides tools from everyone. Faur does not provide
per-call MCP approvals. These rules
rely on Pi's built-in MCP. A global extension can replace it; `/faur check`
reports known conflicts. Use `/mcp`
to see the servers, their tools and errors, and to sign in to
servers that use OAuth.

See [`schema.md`](skills/faur/schema.md) for every field, validation
rule and the file-ownership contract.

### Prompts: roles, not tool manuals

Each agent's prompt describes its role, goals and rules. What it can use —
tools, MCP servers, commands, skills, and for the orchestrator its specialists —
is generated from `system.yaml` into a "What you can use" section, so removing
an integration also removes it from what agents are told. The section is part of
the generated project (each agent file, and after the orchestrator's prompt in
`.pi/APPEND_SYSTEM.md`, between markers), so it changes when the system is
regenerated, never because the Faur tooling was updated. What agents use at
run time comes from Pi and the packages the project pins, never from Faur:
[pi-commands](https://github.com/mihaiiova/pi-commands) for declared commands,
only when declared. The Faur version that last built the project is recorded in
`.faur/build.json`. Specialist prompts live in the Markdown body of
`.pi/agents/<name>.md`, not YAML `systemPrompt` frontmatter. A change that removes
a capability lists any prompt that still mentions it, and
`/faur review` flags prompts that describe specific tools.

### Commands: CLI permissions per agent

Agents can run command-line tools you already use (`gh`, `wrangler`, your own
scripts) through declared commands instead of a full shell. Each is a fixed
shape in `system.yaml` where the agent fills in only the `{placeholders}`:

```yaml
integrations:
  cli:
    - name: create-issue
      command: gh
      args: [issue, create, --repo, mihaiiova/owlie-app, --title, "{title}", --body-file, "{body:file}"]
      approve: true   # the default: you approve each run
```

Give it to an agent with `cli:create-issue` in its `tools`. Commands run
without a shell, with your own CLI logins. In a running system:

- `/faur permissions` lists commands and who may run them; `add` and `remove
  <name>` change them through a preview you confirm.
- An agent that needs a command it has no tool for says so; you add it with
  `/faur permissions add` or a `/faur` request.
- The project pins [pi-commands](https://github.com/mihaiiova/pi-commands),
  which runs them from the generated `.pi/commands.json`.

### Running and maintaining a generated system

A generated project starts with `pi` in its folder, which adds your global Pi
configuration to the project's. `/faur check` reports known conflicts, including
a package that replaces built-in MCP. The caller owns any isolation; plain Pi
inherits the shell environment and is not an OS sandbox. Workflows run headless
as skills: `pi --approve -p "/skill:<workflow> <request>"` (see
[headless workflows](docs/headless-workflows.md)).
`/faur check` reports declared model providers without configured
credentials and declared environment variables that are unset. For example,
use `/login deepseek` or set `DEEPSEEK_API_KEY` before starting it. Start the
project once interactively to install pinned packages before checking
extension-provided tools.
On first installation Pi may leave npm output pipes open briefly after exit.

Pi loads the project's `AGENTS.md`, and any in parent folders, into the
orchestrator's prompt; generation warns about files
from outside the project. Their contents are sent to the model, so review
untrusted instructions for prompt injection. Specialist project context follows
native per-agent inheritance settings.

Inside it, `/faur` is the one command:

| Command | What it does |
|---|---|
| `/faur [request]` | Revise the agent, for example `/faur add a research specialist` or `/faur use a cheaper model for the writer`. When the turn ends with a proposal, Faur prompts you to **discuss** (the default), **apply** or **discard** it. Plain replies continue the conversation until you apply or discard, or leave with `/faur exit`. The mode survives `/reload` (a proposal waiting for approval is dropped); restarting Pi leaves it. Without a request, or with `review`, the first answer is a read-only review. |
| `/faur check` | Validate `system.yaml`, compare the generated files with it, and run the launch check. |
| `/faur status` | Agents, models, integrations and last capability-check status. |
| `/faur sync` | Preview rebuilding the project with this Faur and apply only after confirmation. |
| `/faur schedule status` | Inspect native Linux user-systemd timers and the last service process result, not task success. |
| `/faur schedule stop <name>` / `remove <name>` | Preview and confirm disabling/cancelling a schedule, or removing its native units. |

If a change conflicts with a customized README, Faur can keep its existing prose
and propose only the new documentation in the same diff. Approval is explicit;
a changed file invalidates the preview, and repeated exact additions are not
duplicated. Once reconciled, README is fully authored and generation leaves it
alone. No file deletion, fingerprint editing or unsupported README drift adoption
is needed. See the [file-ownership contract](skills/faur/schema.md#4-ownership--edit-preservation-contract).

### Schedule a skill on Linux

Ask `/faur run the progress-check skill daily at 09:00 Europe/Bucharest with
a 15-minute timeout`. First agree what should happen to the result: a report,
external delivery or explicitly no output, for example. That behavior belongs
in the skill; needed skill or integration changes are approved separately.
The skill must already exist locally before scheduling.

Faur previews native **systemd user timers** and asks before changing external
state. systemd runs plain Pi, without Faur or `system.yaml`. systemd enforces
the wall-time timeout and process-group cancellation; `flock` prevents overlap
between scheduled runs of the same project, not manual runs. There is no
missed-run catch-up, retry, notification or task-success evaluator.

The host needs Linux and a reachable systemd user manager. Running after logout
or reboot needs host configuration (check `linger`); Faur never enables it or
runs sudo. Your shell environment and project `.env` are not automatically
loaded. Runs use ordinary Pi authentication and optionally an existing systemd
`EnvironmentFile`; credentials remain accessible to agents and tools in these
trusted runs. `--approve` permits project loading, not consequential commands:
commands requiring interactive approval remain blocked unattended.

stdout/stderr go to the user journal, not automatically to your agreed report
destination. Status reports service process results, **not task success**.
Scheduling adds no schema fields or runtime packages. See
[scheduling](docs/scheduling.md) for host requirements, CLI operations,
credentials, guarantees and recovery.

Lower-level: `/faur env` and `/faur permissions [add | remove
<name>]`. Headless sessions never apply a change.
While preparing a change, the maintainer can read public documentation (for
example an MCP server's README and releases) to verify versions, tools and
auth, and can declare the environment variables an integration needs. You set
their values in the environment Pi starts in: export them, or load the
project's gitignored `.env` with direnv. Configure values outside Faur. Generation and change previews also add missing
secret and state paths to an existing `.gitignore` without rewriting your rules.
Ignoring files does not remove credentials already committed to git: rotate any
credentials that were committed, including those in `.env` or `.faur/`.

#### Credentials in trusted runs

For a trusted run, declare the variable names under `integrations.env` and
have the caller supply them in the process environment (directly, or from
`.env` through direnv). Pi reads no `.env` itself. Plain Pi inherits the
**entire caller environment**, including undeclared variables; the optional MCP
host instead passes explicit environment grants and a small fixed environment.
Do not put credential values in a workflow request: it becomes prompt text.

A separate Pi configuration directory, when supplied by the caller or MCP host,
is **not an OS security boundary**. Pi, agents, tools and their subprocesses can
access inherited credentials; same-user processes may also access the environment or source
files. Tool approval and `secret: true` do not isolate values, and Faur does
not guarantee redaction of tool output, screenshots, logs or artifacts. Use only
trusted agents and tools, and prefer a restricted test account. For Playwright,
its `--secrets` option expects a dotenv file; environment inheritance alone
does not automatically create that file or change its MCP configuration.

A trusted run is not a **protected integration**, where selected secrets
reach only one authorized tool and not Pi, other agents, other tools or other
runs. Faur does not provide protected integrations: separate files, file
modes, processes or path rules do not hide values from same-user code (investigated
in #70). That boundary
is deferred until an agent needs it, and will be claimed only with
adversarial evidence.

#### No Faur in the ordinary project

Ordinary generated projects pin no Faur package. Optional `mcpServer` projects
bundle Faur's adapter and developer maintenance assets instead; their npm
runtime dependencies are locked separately. See [MCP serving](docs/mcp-serving.md).

Install Faur in your own Pi to
design and maintain projects; the projects run with Pi and the packages they
declare, with Faur uninstalled. Updating Faur changes nothing in a project
until you run `/faur sync` in it, which rebuilds the generated files with the
installed Faur and shows any change to what agents can run or reach before
writing it. Roll back with git.

Projects made by older Pi Forge releases must be regenerated into a **new,
empty directory**, not rebuilt in place: old generated markers and `.forge/`
state are not recognized as Faur ownership. Projects pinned to Pi Forge
v0.30.0 or earlier cannot use their old pinned `/faur sync` to update directly
because `maintenance-rebuild.mjs` was removed. Keep the original untouched.

```sh
mkdir -p /path/to/new-project/.pi
cp /path/to/old-project/.pi/system.yaml /path/to/new-project/.pi/system.yaml
node /path/to/faur/src/faur.mjs generate /path/to/new-project --dry-run
node /path/to/faur/src/faur.mjs generate /path/to/new-project
```

Review the copied design for old paths and unsupported declarations first.
A design that still has `documents` or `workflows` can be migrated in
place: run `/faur`, and it proposes skills that carry those procedures and
removes the old declarations in the same approved change. Review the preview before approval. Compare the original native files and
manually reconcile every authored prompt, skill, script and configuration
change into the new project, without copying credentials or stale runtime
state blindly. Verify the result before replacing or retiring the original.
Projects predating Pi Forge need the same fresh regeneration.

### Tests

```sh
bash test/test.sh
RUN_FAUR_MCP_TEST=1 node --test test/mcp-server.test.mjs
```

The MCP gate installs into an independent temporary project and uses real Pi/MCP
with a local deterministic model, not a paid provider. The default suite includes
real Pi RPC checks for parent-project target selection and approval.

### Documentation and website deployment

In this checkout, `/skill:deploy` audits local documentation against the code,
updates this README and the Faur pages/catalog in the sibling `mightyagents`
repository, runs checks and builds, and deploys only the approved sites.
Use `/reload` to discover the repository-local skill. A documentation-only
refresh does not deploy or cut a release.

### Releasing

Generated projects do not update automatically. To publish Faur, set
`package.json` `version` to `X.Y.Z` on a work branch, merge it into `master`,
then tag the release commit `vX.Y.Z` and push the tag.

## Install

```sh
git clone https://github.com/mihaiiova/faur.git /path/to/faur
pi install /path/to/faur
```

`/faur` is then available in your Pi sessions. Ordinary generated projects do
not pin Faur; opt-in MCP-serving projects bundle its hosting/maintenance assets.
To install this release instead of a local checkout, use
`pi install git:github.com/mihaiiova/faur@v0.42.0`.
Faur pins its own packages in `package.json` under `pi.packages`.

Updating Faur does not update existing generated agents. For older MCP projects,
remove the unsupported `mcpServer.tools` field (native agent tool settings are now
authoritative), preview/reconcile regeneration, install declared source packages
and restart/reconnect the server. Review the expanded native execution and
credential boundary. Older specialist files need their instructions reconciled
into native Markdown bodies; preserve authored edits. See the
[v0.42.0 upgrade notes](docs/releases/v0.42.0.md#upgrade-and-limits).

## Personal Pi setup

The spec lifecycle, domain skills and the `explore`, `pi-config`, `pi-sync`,
`project-state`, `save-md`, `skills-select` and `startup-check` extensions moved,
with their history, to [`mihaiiova/pi-personal`](https://github.com/mihaiiova/pi-personal).
It is the reference for a new development-workflow integration that will be
built from scratch with Faur.

To move a machine over, install it next to this repository, then pull this one:

```sh
git clone https://github.com/mihaiiova/pi-personal.git /path/to/pi-personal
pi install /path/to/pi-personal
ln -sfn /path/to/pi-personal/AGENTS.md ~/.pi/agent/AGENTS.md   # global instructions moved too
cd /path/to/faur && git remote set-url origin https://github.com/mihaiiova/faur.git && git pull
```

Then `/reload`. `/pi-sync` now syncs `pi-personal`; update this repository with
`git pull`.

### Project setup checks

A trusted project's `system.yaml` can declare setup checks at project level or on MCP and CLI integrations:

```yaml
setup:
  - description: Install the browser
    check: { file: ./browser }
    install: npm run install-browser
```

`/faur check` reports unmet steps; `/faur setup` previews installs and asks for confirmation. For non-interactive administration use `faur setup <dir> --yes`. Steps marked `needsRoot` are printed, not run. Workflow launches never install. **Command checks execute shell code with your permissions automatically** during Faur checks and setup inspection; use only trusted declarations. Plain Pi workflow launches do not add a Faur setup preflight.

An MCP or CLI integration may also declare `secretsFile: .faur/service-secrets.env`. Faur creates a missing file privately, does not overwrite an existing file, and adds an ignore entry. Declare the variable in `integrations.env` and configure its value in that file outside Faur; do not send secrets to the model. Integrations must be configured to read their chosen file themselves; Faur does not load it into the launcher environment. Existing tracked files, unsafe permissions, and symlinks must be corrected by the user. Git ignore does not remove a previously committed secret.

## License

[MIT](LICENSE)
