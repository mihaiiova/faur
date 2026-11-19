# `system.yaml` schema (v1) + ownership contract

This is the canonical reference for Faur's declarative system
model. It is implemented and enforced by `parse.mjs` and `validate.mjs`, surfaced
through `faur validate <dir>`. The model lives at
`<dir>/.pi/system.yaml` and is the faur's source of truth for the generated
project.

> **Direction (2026-11-02):** `system.yaml` becomes Faur's design record.
> Native Pi files become authoritative for execution, may be edited directly,
> and are reconciled with this record when Faur is invoked. This document
> describes the current release; the migration is staged in
> `docs/architecture-audit.md` §5.

## 1. Schema v1

Top-level keys (all others rejected):

| Key | Required | Type | Meaning |
|---|---|---|---|
| `schema` | yes | integer `1` | schema version |
| `name` | yes | kebab-case string | system/project name |
| `description` | no | string | one-line summary |
| `orchestrator` | no | object | the primary Pi session (→ `.pi/APPEND_SYSTEM.md` + settings) |
| `agents` | no | array | specialist subagents (→ `.pi/agents/*.md`) |
| `skills` | no | array | authored, packaged or vendored skills (→ `.pi/skills/*/`) |
| `integrations` | no | object | MCP servers + env requirements |
| `setup` | no | array | project setup checks and installs (see Setup checks) |
| `mcpServer` | no | object | opt-in public stdio MCP interface to the lead (below); distinct from upstream `integrations.mcp` |
| `packages` | no | array of `npm:`/`git:` specs | additional runtime extension packages (`pi-subagents` is always included; `pi-mcp-adapter` is rejected because it would replace Pi's built-in MCP; packaged skill sources are added automatically) |

The **orchestrator is a top-level block**, not an `agents[]` entry. Pi has no
"primary agent" file: the primary session is shaped by `.pi/settings.json`
(model + `defaultTools`) and `.pi/APPEND_SYSTEM.md` (instructions). `agents[]`
holds specialist *subagents* only.

### Models

There are no model tiers and no default models. Every agent — the orchestrator
and each subagent — names its own model, chosen from the machine's Pi line-up
(`pi --list-models`, also reported by `faur discover` as `models`):

```yaml
orchestrator:
  name: lead
  model: provider/model-id      # required: "provider/id"
  thinking: medium              # optional: off|minimal|low|medium|high|xhigh|max
agents:
  - name: researcher
    model: other-provider/model-id
```

Validation checks the `provider/id` shape and the thinking level, not
availability: the catalog is machine-specific. `faur validate`, `generate`
and `modify` warn about a model missing from the local line-up, without
failing. The orchestrator's model becomes `defaultProvider`/`defaultModel`/
`defaultThinkingLevel` in `.pi/settings.json`; a subagent's model and thinking
level go into its own `.pi/agents/<name>.md` frontmatter. Specialist prompts
and generated capability guidance are native Markdown bodies (2026-11-18); the
old YAML `systemPrompt` generation was ignored by native pi-subagents and is
superseded. Regenerate old files or explicitly reconcile authored edits. No routing overrides
(`subagents.agentOverrides`) are emitted, and stale ones are removed.

### `orchestrator`

Allowed keys: `name` (required string), `description`, `prompt`, `model`
(required `provider/id`), `thinking` and `tools` (array of strings).

**Tool baseline (enforced by the generator).** Every explicit, non-empty
`tools` list, the orchestrator's and each subagent's, includes `read`, `ls`,
`find` and `grep`. Faur adds missing entries when it reads a design
and records them in `system.yaml` on the next change; the preview names the
added tools. `codemode` is never added implicitly: list it to grant it. Unlike
file browsing, it can reach other exposed tools, including inherited global
MCP servers, even when those tools are not directly listed. `tools: []` stays empty; omitted lists request the browsing baseline. A native edit that drops a
baseline tool cannot be adopted; Faur refuses and says why. The tools an agent
can actually call depend on Pi and its packages; a list is not OS isolation.

Pi loads the project's `AGENTS.md` (and `AGENTS.md` files in parent folders)
into the orchestrator's prompt by itself. Generation
warns about files from outside the project. They are instructions sent to the
model; treat them as untrusted input. Specialist project context follows native
per-agent inheritance settings, including `inheritProjectContext`.

### Prompts and the generated "What you can use" section

`prompt` (orchestrator and agents) describes the role, goals, judgement, rules
and boundaries. It should not list tools, MCP servers, commands or skills: the
Faur renders a "What you can use" section from the declarations — built-in
tools, MCP servers (with `config.description` and which tools ask first),
commands, other tools, skills, and for the orchestrator its specialists. A
subagent's section is written into its agent file after its prompt; the
orchestrator's follows its prompt in `.pi/APPEND_SYSTEM.md`, between
`<!-- faur:derived v1 … -->` markers, so Pi loads both natively. The
orchestrator's specialist launch note is in the same section. It is build
output: it changes when the system is regenerated,
not when the Faur tooling is updated. A change
that removes an MCP server, command or skill reports `staleMentions`: the
prompts that still name it.

### `agents[]`

Allowed keys: `name` (required string), `description`, `tools` (array of
strings), `model` (required `provider/id`), `thinking`, `skills` (array of
declared `skills[].name`), `prompt`, `inheritProjectContext`, `inheritSkills`.
`tools:` is the subagent allowlist (enforced by pi-subagents), including the
browsing baseline above. Faur does not
select foreground or background execution. Built-in MCP tools work in either
mode. A foreground specialist using an extension tool must also list the
providing extension path in its native agent file; Faur cannot infer that path
from the tool name and reports the limitation. Developer edits to agent files
are detected and preserved for explicit reconciliation.
Nobody can answer an approval prompt in the background, so a subagent that
can reach a `cli:` command without `approve: false` is rejected. The
orchestrator can make those calls instead. Faur does not add per-call approval to MCP calls.
`skills:` selects the
skills the subagent receives. Duplicate `name`s are rejected.

### `skills[]`

The faur ships no skills of its own; each agent gets the skills the user
chooses for it, including ones the faur suggests from skills.sh.
Allowed keys: `name` (required string), `description`, and at most one of:

- With no `source`, the skill is an ordinary project file at
  `.pi/skills/<name>/SKILL.md` holding one of the agent's procedures. Faur
  drafts it from the conversation: an `add` or `update` operation for the
  skill carries the whole file as `content` (frontmatter `name` matching the
  declaration, and a `description` saying when to use it). The approved change
  writes it with the same preview and stale-file check as every other file; it
  is never stored in `system.yaml` and never regenerated, so later edits are
  the developer's. Skill instructions are advisory.
- `source: npm:<name>@<version>` or `git:<repo>@<ref>` — provided by a pinned
  package, which joins the runtime `packages`. No local file is generated.
- `source: ./path`, `../path`, `/abs/path` or `~/path` — a directory containing
  `SKILL.md` whose frontmatter `name` matches. `faur generate`/`modify`
  vendor it into `.pi/skills/<name>/` once (binary-safe, symlinks refused); an
  existing project copy is never overwritten. Relative paths resolve from the
  project directory.
- `source: skills:<owner>/<repo>/<skill-dir>@<commit>` — one skill directory
  from the open Agent Skills ecosystem (skills.sh), pinned to a full 40-character
  commit. `faur generate`/`modify` and an approved `/faur` change install it
  with the `skills` CLI (`npx skills@1.7.4 add <github tree URL> --agent pi
  --copy -y`) into the project's `.agents/skills/<name>/` — never globally —
  and `skills-lock.json` records the commit. The installed `SKILL.md` must
  declare `name` and, in maintenance, match the previewed content. Removing
  the declaration removes the installed copy. `faur search-skills` and
  `faur preview-skill <owner/repo>@<name>` find and pin skills.

Duplicate `name`s are rejected.

### `integrations`

Allowed keys: `mcp` (array), `env` (array) and `cli` (array).

- `mcp[]` entries: `name` (required string) and `config` (required non-empty
  object); optional `setup` and `secretsFile` are described under Setup checks. Generated systems use Pi's built-in MCP, and the connection
  settings pass through to `.pi/mcp.json`: `{url, headers?, oauth?}` or
  `{command, args?, env?, cwd?}`, plus `description` and `timeout`. Two
  keys are Faur's and become Pi's exposure:
  - `includeTools`: the tools agents may use. They are declared directly and
    the rest of the server is hidden. Without it, the server's tools are
    `deferred`: the orchestrator finds them with `tool_search`.
  - `excludeTools`: tools nobody may use (`hidden`: registered but
    unreachable, also for specialists, when Pi built-in MCP handles the server).
  `exposure` and `toolExposure` are rejected: Faur derives them. Pi's automatic
  codemode activation is disabled (`autoEnableCodemode: false`) to preserve
  tool lists; an agent gets codemode only when its `tools`
  list names it. Codemode can reach exposed global and project MCP tools. Pi names each tool `mcp__<server>__<tool>`. An
  orchestrator with `mcp` in its tools is told about every
  server's usable tools; without it, it is told it has none, while its
  specialists get their `mcp:` selections. That is advisory: nothing stops
  the orchestrator calling an MCP tool. Faur does not provide per-call MCP
  approval; the removed `approveTools` key is rejected. OAuth servers need no credentials in the
  config: sign in with `/mcp`. Credentials in `env` and `headers` must be
  `${NAME}` references. Non-secret settings, such as OAuth scopes, are
  written as literals and shown in the approval. Faur rejects a literal it
  recognizes as a credential: by name (`token`, `secret`, `key`, …), by known
  token prefixes, by an opaque 32+ character value, or by a URL with an
  embedded password. That check is best effort, not enforcement: a secret
  under an innocuous name with no recognizable shape is not detected. A global `/mcp` extension can replace Pi's
  built-in MCP; `/faur check` reports known conflicts. Duplicate `name`s are rejected.
- `env[]` entries: `name` (required shell variable name) and `secret`
  (optional boolean). These become `.env.example` entries. Pi reads no
  `.env`: the values come from the environment Pi starts in (exported, or
  loaded with direnv), and `/faur check` reports declared names that are
  unset. The complete caller environment reaches Pi and its tools, even for
  undeclared names. `secret: true` does not isolate or reliably redact a
  value. Use trusted tools and restricted test credentials; do not put
  credential values in a workflow request. Names that change how the shell, Node, Pi or the
  network stack run (`PATH`, `NODE_OPTIONS`, `LD_*`, `DYLD_*`, proxy variables,
  `PI_CODING_AGENT_DIR`, `FAUR_*`, …) are rejected.
- `cli[]` entries declare command-line tools: `name` (required kebab-case),
  `description`, `command` (required: one program name or path, no spaces),
  `args` (array of strings), `approve` (boolean, default `true`), and optional `setup` and `secretsFile` (see Setup checks). An
  argument that is exactly `{name}` is a value the agent supplies for each
  call (it may not start with `-`); `{name:file}` writes the agent's text to
  a temporary file and passes its path. Every other argument is fixed. The
  command runs directly, without a shell, from the project directory, with
  the user's own CLI logins and the environment Pi started in.
  `approve: true` asks the user before each run (Allow once / Allow for this
  session / Deny); without a UI (a headless run, or a background subagent)
  such a call fails instead of running. Duplicate `name`s are rejected.
  [pi-commands](https://github.com/mihaiiova/pi-commands) runs them: the
  project pins it and gets a generated `.pi/commands.json`; Faur takes no part
  at run time.

  An agent gets a command by listing `cli:<name>` in its `tools`; every `cli:` reference must name a declared
  entry. In Pi the tool is `cli_<name>` (hyphens become underscores). The
  orchestrator gets the commands its `tools` list; a subagent gets exactly the ones in its allowlist.
  `/faur permissions` (list, add, remove) edits these
  declarations through the normal preview. An agent that needs a command it
  has no tool for says so; adding one is a design change made through Faur.

  ```yaml
  integrations:
    cli:
      - name: create-issue
        description: Open an issue in owlie-app
        command: gh
        args: [issue, create, --repo, mihaiiova/owlie-app, --title, "{title}", --body-file, "{body:file}"]
  agents:
    - name: marketing-lead
      tools: [read, write, "cli:create-issue"]
  ```

### `mcpServer` (opt-in public operations)

Requires an orchestrator. Allowed keys:

- `projectRoot` (required): absolute path or path relative to the **agent source
  folder**, e.g. `../..` for `.agents/jared` in a main project. No `~` expansion.
  The directory must exist when starting the server. This is target T supplied
  as an absolute task path, not tool cwd or filesystem containment.
- `tools` is no longer a key (2026-11-18); it is strictly rejected. Native
  source settings and specialist definitions select tools. Source instructions,
  skills, prompt templates, specialists, extensions, packages, commands and
  upstream MCP load through published Pi's ordinary discovery, never a reduced list.
- `env` (optional): unique uppercase environment variable **names**, including
  the model provider key. No values. Execution/configuration override names
  (e.g. HOME, NODE_*, PI_*, FAUR_*) are refused. Every declared variable
  must be set for invocation; undeclared environment variables are excluded.
  PATH may be explicitly granted for native toolchains and subprocesses.
- `auth` (optional; since v0.41.0): explicit Pi subscription delegation. Allowed
  keys are only `mode: pi-subscription`, `provider: openai-codex`, and
  `authFileEnv: <UPPERCASE_VARIABLE_NAME>` (all required). The provider must match
  the orchestrator model provider. The named host-only variable supplies an
  absolute path to an existing owner-only Pi auth.json; no path/value is embedded
  in the declaration, and the variable must not appear in runtime `env` grants.
  Execution/configuration override names such as HOME/PATH/PI_* are rejected;
  FAUR_* host-only names are allowed. Omit `auth` for the unchanged isolated
  API-key mode. No automatic source discovery, login, API-key/provider fallback,
  auth-file copying is enabled. Ordinary discovery still includes ancestor resources.
- `timeoutMs` (optional): integer 1–3600000, default 120000, covering child startup
  and execution. Shutdown has a further 250ms SIGTERM grace before SIGKILL.
- `operations` (required): 1–100 entries, each with only `name`, `description`,
  `inputSchema`, `prompt`. Names match `^[a-z][a-z0-9_-]{0,63}$` and are unique.
  Description and prompt are non-empty strings. `inputSchema` is an object-root
  draft-07 JSON Schema compiled by Ajv in strict mode: unsupported keywords,
  unknown formats and unresolved/remote refs are rejected. Inputs are validated
  without coercion, defaults or mutation. Use `additionalProperties: false`
  when undeclared inputs should be refused.

Each binding runs a fresh published native lead in source S. The operation prompt
uses native skill/template expansion; a before_agent_start task-context message
always supplies absolute T and validated JSON, even for templates without $@.
Lead/child tools, commands, relative assets, processes and default MCP stdio stay
cwd=S. Target work requires absolute paths or shell cd T; pass T in delegated
tasks and command/MCP arguments as needed. This is advisory, not automatic
workspace rebasing or a sandbox. Ordinary ancestor discovery/native child
resource and inheritance policies apply, not strict isolation. Foreground
specialists need declared extension paths in native metadata; Faur does not
infer them. Fresh conversations do not isolate shared source files/memory:
keep project-specific state under T. Only bundled maker maintenance opts out
via an internal convenience marker; genuine authored extensions load normally.
Known package/resource/extension errors fail actionable. Source packages must
be installed explicitly; operation calls never acquire code. Native MCP starts
on session_start, waits for direct/deferred tools according to native policy;
startup alone is not proof every enabled server connected. Verify actual tools.

The selected model/thinking comes from the orchestrator; native catalog, source
models.json and source provider registrations resolve the exact model. No global
model discovery or alternate model/provider/API-billing fallback. Default auth
uses named env grants, not global logins. Subscription mode explicitly selects
an owner-only store through authFileEnv; native lead, specialists, tools and
subprocesses may directly access that store (temporary symlink, no copied values),
including other entries. Pi owns locking/refresh/persistence. This supersedes
the lead-only broker contract (2026-11-18). Forced termination can interrupt
refresh/persistence and require re-login; no loss-free rotation guarantee.
No strict discovery, OS/filesystem or credential isolation is claimed. Treat
source/callers as trusted. Prompt-injection guidance is advisory.

Normal registry npm ci uses published unmodified Pi 1.5.2 with exact locked
host dependencies. Source packages install through native Pi separately.
No fork, tarballs, unpublished API or publication gate is required.
See docs/mcp-serving.md.

Generated registration instructions include `--check-auth` (local metadata and
catalog only) and `--check-auth --resolve` (explicit permission to resolve/refresh
OAuth, never a model call). `/faur check` does not silently read global credentials
or refresh; it distinguishes configuration, historical local auth resolution and
historical successful invocation. Those timestamps/fingerprints live only in
ignored `.faur-mcp/auth-evidence.json`, with no token values. They are not current
provider acceptance, task success or tamper-proof attestations. A live subscription
smoke test requires separate permission.

Generation adds `.faur-mcp/` (config, pinned npm manifest/lockfile, local
registration guide and bundled Faur package assets) and a developer-only native
extension `.pi/extensions/faur-mcp.ts`. Run `npm ci` in `.faur-mcp` first.
The package remains readable with no checkout links or global binary dependency;
the packaged Pi CLI requires no global Pi binary.
MCP source/definitions are derived, but every generated asset is hash-checked
against `.faur-mcp/generated.json` before replacement: an edit conflicts instead
of being overwritten. The manifest is an edit-preservation mechanism, not an
integrity/security boundary. Native lead prompt ownership stays unchanged.
Use `set` target `mcpServer` through the normal maintenance preview/apply path to
change operations; a null value removes the optional interface. Retired assets
are removed only when their recorded hashes match; installed node_modules is
never deleted, and its nested ignore rule is retained. Finish active calls before editing/applying; restart/reconnect
for changes to become visible. One call at a time per server; no queue, hot reload
or cross-server coordination. See `docs/mcp-serving.md` in the Faur repository.

## 2. Validation rules

`validateSystem(doc)` returns `{ ok, errors[] }`. Errors name the offending
path/key and the expected value. Rejected conditions:

- non-object document;
- `schema` missing or not `1`;
- `name` missing, empty, or not kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`);
- unknown keys at any level (top level and every nested object, except the
  opaque MCP `config` object);
- wrong types / missing required fields within each block;
- a missing or non-`provider/id` model, or an unknown thinking level;
- unresolved references (agent, skill, MCP names, including
  `agents[].skills`);
- an unrecognized skill `source`;
- duplicate `name` within `agents[]`, `skills[]`, or `integrations.mcp[]`.

The skill name `faur` is reserved (it is the Faur skill) and cannot be declared in
`skills[]`. Operational model edits use the structured operations of
`/faur`, which reuse this validator and reject dangling references.
The generating Faur version is recorded in `.faur/build.json`, never part of
this operational model. Ordinary projects pin no Faur; opt-in `mcpServer`
projects carry bundled Faur package assets for hosting and local maintenance. An explicit empty orchestrator `tools: []` stays empty; omitted tools request the browsing baseline. Lead defaultTools controls built-in tools; independently registered extension tools may remain active, and MCP exposure is configured separately.

`policies` is no longer accepted. Move MCP hide rules to `integrations.mcp[].config.excludeTools` and advisory instructions to prompts or skills. Review agent restrictions explicitly: narrower nonempty specialist allowlists cannot be represented, so do not silently replace them with the browsing baseline. Import and native adoption refuse omitted or narrower native tool lists when representing them would change access; review those lists before importing or adopting.

## 3. Schema versions

Only `schema: 1` is accepted. There is no migration: designs using the earlier
tier-based layout (`models.tiers`, tier names as agent models) must be redefined
with per-agent models. The removed `documents`, `workflows` and `skills[].body`
fields are replaced by local skills. `/faur` still reads a design that has
`documents` or `workflows`: inspect reports them, the next proposal carries a
skill for each procedure they describe, and applying it removes the old keys
and any untouched skill Faur generated for a workflow (an edited one is kept
and reported). `faur validate` and `faur generate` reject them.

## 4. Ownership / edit-preservation contract

1. **Derived files** (`settings.json` model fragment + `packages` + `defaultTools`,
   and `mcp.json`) are faur-owned and regenerated on
   every `generate`; **unknown keys the faur does not own are preserved**
   The `packages` list is a faur-owned derived key holding only what the
   design uses (`deps.mjs` `runtimeNeeds`, `runtimePackages`): the Faur
   `pi-commands` for declared commands, `pi-subagents` with `agents[]` or the `subagent` tool, and any
   `system.yaml` `packages` and packaged skill sources. A minimal agent pins
   nothing. `mcp.json` exists only with MCP servers and `.env.example` only
   with `integrations.env`; removing the last one removes the file.
   Hand-editing a derived file is unsupported — change the model instead.
2. **Authored files** (agents, the orchestrator prompt in `APPEND_SYSTEM.md`,
   README, `.gitignore`, `.env.example`) are user-owned.
   `APPEND_SYSTEM.md` also holds the derived "What you can use" section after
   the prompt, between markers: it is rewritten with the declarations, and a
   hand edit inside it, or text after it, is a conflict rather than lost. The faur scaffolds them
   when absent. On modification it records a content fingerprint of what it
   last wrote; if a file differs from that fingerprint *and* the model wants to
   change it, the faur treats it as a **conflict** and proposes a diff,
   surfacing it for the user to resolve; it never silently overwrites (and, in
   this MVP, never auto-applies a conflict — the user resolves it by editing the
   file or re-running after a deliberate edit).
   **Exception for `.gitignore`:** generation and change/rebuild plans append a
   marked block containing any missing `.env`, `.faur/`, `.pi/state.json`,
   `.pi/sessions/`, `.pi/git/`, and `.pi/npm/` entries, plus declared
   integration secret file paths.
   Existing lines are never rewritten or reordered. An exact directory entry
   with or without a trailing slash counts as present; file entries must not
   have a trailing slash. If a potentially matching root negation follows a
   required exact rule, or exists when that rule is absent, Faur refuses to
   apply: resolve the rules explicitly rather than letting Faur override them.
   Wildcard negations are treated conservatively and can be rejected even when
   unrelated. Faur also refuses nested negation rules along required `.pi`
   paths and declared integration secret paths, even if unrelated. The append is shown in
   dry runs and change previews, and repeating it is a no-op.
   **README reconciliation in `/faur`:** `faur_plan` inspection includes the
   absolute README path and redacted content. A `propose` call may carry
   `readmeAppend` alongside its operations: only new documentation, or an empty
   string to preserve without additions. Faur preserves the existing prose,
   skips an exact already-present addition, and removes the scaffold header so
   README becomes fully authored. Future generation leaves it untouched.
   The combined configuration/README diff requires explicit approval; the
   existing stale-file check and checked-write rollback cover the whole plan.
   Writes use per-file atomic replacement and best-effort synchronous rollback,
   not crash-safe multi-file transactions or isolation from concurrent readers.
   Discarding applies nothing. This is not automatic semantic merging and does
   not authorize overwriting other authored conflicts. README drift adoption
   is not supported; no fingerprint editing or file deletion is required.
   **Local skill files** are never generated or regenerated. Faur writes one
   only as part of an approved change that carries its `content`, with the
   same preview and stale-file check as other files; otherwise it leaves them
   alone. Edits made outside Faur are the developer's and are not subject to
   its approval.
   **Vendored skill directories** (`skills[].source` paths) are user-owned
   copies: created once from the source, never overwritten or deleted by the
   faur. Delete a copy explicitly to refresh it from its source.
3. **`system.yaml`** is faur-owned but user-editable; `modify` updates only
   the keys it is changing and preserves unknown keys (best-effort on
   comments).
4. **Precedence:** the declarative model is authoritative for *derived*
   config; authored content is authoritative for *content*. On conflict the
   authored file wins until the user confirms a merge.
5. **Preview:** `generate --dry-run` and `modify --dry-run` print the full
   planned diff and write nothing; the builder always previews before applying.
6. **Idempotence:** `generate`/`modify` are pure functions of (model, disk) —
   same inputs produce the same result and never duplicate content.

The optional MCP package bundle is separate from the native Pi `packages`
list and its npm dependencies are locked in `.faur-mcp/package-lock.json`. Maintenance
change proposals delete removed agent scaffolds only when intact, reject
authored conflicts, and require separately confirmed drift reconciliation.
The build record's declaration inventory identifies previously declared paths;
it does not establish ownership. An intact inline marker is required before an
inventoried scaffold removed by a manual model edit may be deleted. Removed
vendored skills require explicit resolution. For registry skill removal or
replacement, the inventory records the previous pinned source, not ownership
hashes. Before applying, the skills CLI installs that source in a temporary
project; the complete installed tree, including modes, must match before the
existing copy may be removed or replaced. A missing source identity, unavailable
source, mismatched lock or edited tree is refused. The CLI is not OS-sandboxed.
If an older build has no inventory, unlisted files are preserved; a locked,
installed skill missing from the model is refused as ambiguous.

`system.yaml` is parsed with the **`yaml`** package (v2.8.3), pinned in
`pi.packages` and resolved from the Pi package install dir by
`yaml-loader.mjs` — never a hand-rolled YAML subset.

### Setup checks

The project and entries in `integrations.mcp` and `integrations.cli` can declare `setup` steps:

```yaml
setup:
  - description: Install the browser
    check: { command: 'test -x ./browser' }
    install: 'npm run install-browser'
    platforms: [linux, darwin]
    needsRoot: false
```

Alternatively use `check: { file: path }`. Applied CLI generation, Faur capability checks and setup inspection can run these checks automatically. Plain Pi headless launches do not add a Faur setup preflight. **Command checks execute shell code with the user's permissions and may have side effects or access secrets. Only use trusted project declarations.** Do not put literal credentials in setup commands; use environment references. Install commands run only after confirmation via `/faur setup` or `faur setup <dir> --yes`; `needsRoot` commands are printed for manual execution. Headless workflows never install.

MCP and CLI integrations may declare `secretsFile: .faur/service-secrets.env`. Paths must be project-relative, use only letters, digits, `_`, `-`, `.`, and `/`, and contain no `.` or `..` components or symlinks. To protect case-insensitive filesystems, reserved paths are rejected regardless of case: `.faur`, `.pi`, `data`, `.env`, `.env.example`, `run`, `README.md`, `data/knowledge/.gitkeep`, `.faur/build.json`, `.faur/capabilities.json`, `.faur/check.json`, and `.faur/permission-requests.json`; all paths under `.pi/` or `.faur/pi-home/`; and any `.git` or `.gitignore` path component. Faur adds an anchored gitignore entry and creates the missing file with mode 0600 without replacing existing content. Before applying, Faur conservatively refuses any negation rule in a nested `.gitignore` along the secret file's directory path, even if unrelated; resolve it explicitly. Root negations are handled as described in the `.gitignore` exception above. Existing files must be regular, private, and untracked/ignored; Faur reports problems rather than changing them. Configure declared `integrations.env` values outside Faur; never send secrets to the model. The integration must be configured to read its secrets file; Faur does not automatically load it. Git ignore cannot undo committed secrets. Path checks are not a defense against hostile concurrent filesystem changes.
