# Project-local agents exposed through MCP

## Amendment — 2026-11-19: published native Pi, source cwd

This supersedes the unpublished source/workspace/project-only experiment of
2026-11-18 and the reduced runtime/lead-only broker. No Pi or third-party changes,
forks, tarballs or unpublished APIs are required. The public operation names and
JSON input schemas are unchanged. Regenerate declarations without the redundant
`mcpServer.tools` key (strictly rejected). Minimal output is unchanged.
Specialist prompts/capability guidance are native Markdown bodies, correcting
the previously ignored YAML `systemPrompt` field; authored edits require explicit
reconciliation, not migration machinery.

Independent generated projects pass normal registry `npm ci` with official
Pi **1.5.2**, MCP SDK **1.32.2**, Ajv **8.20.0**, TypeBox **1.1.24** and YAML
**2.8.3**. Native packages are explicitly installed separately: pi-subagents
**0.83.1** and official pi-commands git **v0.1.0**. No global Pi/Faur is needed.
There is no pending native-API publication prerequisite.

## Declare and generate

> /faur Create Jared in .agents/jared and expose audit and review as MCP tools.

Select its native resources and model in the ordinary design, then add:

```yaml
mcpServer:
  projectRoot: ../..
  env: [ANTHROPIC_API_KEY, PATH]
  timeoutMs: 120000
  operations:
    - name: audit
      description: Audit the target project for engineering risks
      inputSchema:
        type: object
        properties:
          request: { type: string }
        required: [request]
        additionalProperties: false
      prompt: Audit the project according to the supplied request.
```

Public operations bind validated JSON arguments to a fresh lead execution. They
are not internal tool exposure. Native tool selection comes from source settings
and specialists, not a second `mcpServer.tools` list. Operation prompts may invoke
native `/skill:name` expansion or source prompt templates. User arguments remain
serialized JSON data; instructions to treat them as data are advisory, not a
prompt-injection security boundary.

After normal preview/approval, install locked host dependencies with `npm ci`
in `.agents/jared/.faur-mcp`. Requires Node.js >=22.19.0 and npm, not global Pi/Faur.
Review and explicitly install source-declared packages using **native Pi** in S
before calling the server. Calls preflight native package availability and never
install missing code. Missing/mismatched packages fail with installation advice.
Use the packaged Pi CLI, for example from S:
`node .faur-mcp/node_modules/@earendil-works/pi-coding-agent/dist/cli.js install --local --approve npm:pi-subagents@0.83.1`
(and the exact other declared package sources). No consumer executable override.

Register locally using the generated README: stdio, absolute Node executable,
one absolute argument `.agents/jared/.faur-mcp/faur/mcp/host.mjs`. Client-specific
configuration is the client's responsibility. No automatic/global registration.
Only explicitly named environment variables plus a small fixed environment reach
native execution. `PATH` may be explicitly granted for toolchains. HOME, Pi and
Node loader/config overrides remain refused; ambient secrets are not inherited.
Never embed credential values or copy auth files into generated assets.

## Source S and target T: ordinary native semantics

Each call creates a fresh process/in-memory session with `cwd=S`, a fresh Pi
config/state directory D and the exact declared model. S is the real source
folder derived from the installed entry point. T is `mcpServer.projectRoot`
resolved to an existing absolute directory relative to S. Registration cwd
selects neither. The target's config is not copied, installed or loaded as a
workspace; there is no workspace abstraction or custom resource isolation.

- Native settings, source models.json/provider registrations, authored lead
  instructions, skills, templates, packages, extensions, commands, specialist
  definitions and upstream MCP load normally from S. Ancestor AGENTS.md and
  skills follow native discovery too. The fresh HOME/config directory omits
  the operator's normal home settings; it does not make discovery hermetic or
  exclude all ancestors/explicit paths.
- Every operation supplies the absolute T and validated JSON arguments through
  a native before_agent_start task-context message, after native skill/template
  expansion (including templates without argument placeholders). Arguments are
  data; prompt-injection guidance is advisory, not an enforcement boundary.
- Builtin tools, extension tools/pi.exec, commands, default specialist cwd and
  default upstream stdio MCP cwd remain **S**, not T. Source-relative assets keep
  native meaning. For target work use absolute paths or shell `cd T`. Pass T
  explicitly in delegated tasks and command/MCP arguments when needed. This is
  **ADVISORY**, not sandboxing or automatic path/cwd rebasing.
- Native child policies are not magical parity: foreground specialists load
  declared extension resources, not every ambient lead extension. Use native
  `extensions` metadata (paths relative to the agent file) for authored tools,
  providers or commands; select skills/context inheritance explicitly as
  supported by pi-subagents. Background children have different inheritance.
  Faur does not force custom inheritance or generate resource-path guesses.
- Bundled developer maintenance code alone opts out before import via an
  internal runtime environment marker. This is a convenience guard, not a
  security boundary. Genuine authored extensions load normally.
- Builtin MCP, codemode and tool_search factories are bound through published
  `bindExtensions`/session_start. Connections start in the background; first
  prompts wait up to native limits for direct tools; deferred/codemode calls
  wait for needed servers. Startup is **not** proof every enabled server
  connected. Native tool errors/diagnostics and actual calls establish behavior;
  a model can recover from a tool error. No Faur connection/status manager,
  human /mcp parsing or unpublished readiness handle exists.
- Known missing/mismatched packages, discovery and extension errors fail
  actionable and sanitized when reported by the SDK. Native discovery can skip a
  nonexistent settings resource path without a diagnostic; this adapter does
  not add a second discovery validator or claim exhaustive resource readiness.
  Operations never install code. Disabled/replaced
  built-in MCP is refused; individual server connection errors follow native
  behavior, not an all-server startup guarantee.

Fresh sessions prevent conversation reuse, not shared source-local files or
memory. Operations must keep project-specific state under T. Trusted lead,
specialists, tools and subprocesses share OS permissions and any selected
credential store; they can read outside T. No OS/filesystem, credential or
strict discovery isolation is claimed. Trust S, all resources and callers.
There is no alternate model/provider/API-billing fallback or global auth
selection. The packaged official Pi binary is first on child PATH even when
an explicit toolchain PATH is granted; no ambient global Pi is required.

## Explicit subscription store

Choose `openai-codex/<model>` and opt in:

```yaml
mcpServer:
  # projectRoot, operations as above
  env: [PATH]
  auth:
    mode: pi-subscription
    provider: openai-codex
    authFileEnv: JARED_PI_AUTH_FILE
```

The client's local environment sets `JARED_PI_AUTH_FILE` to the absolute path of
an existing owner-only Pi auth.json owned by the current user. Only its variable
name is generated. The selector variable cannot also be a runtime env grant.
The host validates ownership/permissions and creates a temporary auth.json
**symlink**, never a credential copy. Trusted native lead and children directly
use that selected store, including access to other entries. No lead-only broker
or credential confidentiality is claimed. Other store-directory configuration
is not discovered. No automatic login/global auth discovery/API-key fallback.
Sign in with `/login openai-codex` in a normal Pi session using that store first.

Pi owns native locking, expiry rechecks, refresh and persistence across clients,
workers and specialists, including symlink aliases. Bounded termination may
interrupt a started refresh/persistence and require re-login. Do not force-kill
during refresh; loss-free/crash-durable token rotation is not guaranteed. This
is intentionally not the old long-lived broker/drain contract.

Explicit local checks from S (neither makes a model call or logs in):

```sh
node .faur-mcp/faur/mcp/host.mjs --check-auth
node .faur-mcp/faur/mcp/host.mjs --check-auth --resolve
```

The first checks installed catalog/login metadata without refresh; the second
permits native resolution/refresh. Both use the installed catalog and S's
`.pi/models.json`, not global models. Source extension models require an actual
authorized invocation to verify. `/faur check` never reads credentials or
refreshes automatically: configured, locally resolved and successfully
exercised are distinct. Ignored `auth-evidence.json` stores only boundary-versioned
config/source fingerprints and timestamps. Old broker evidence is invalidated.
History is advisory, not current acceptance, integrity or task-success proof.

## Lifecycle, results and maintenance

One active call per host; overlap is refused, not queued. Separate hosts are not
coordinated. Inputs/worker outputs are bounded to 1 MiB. Fresh sessions prevent
conversation reuse. Only final answer text is returned, not provider diagnostics,
logs or extension traces. Model errors and output-length stops are errors, never
truncated success. Exact granted env values (except non-secret PATH) and observed
selected login tokens are redacted as defense in depth, not general exfiltration
prevention.

Timeout/cancel/EOF/SIGTERM/SIGINT abort native execution, emit session shutdown
and terminate the worker's POSIX group, escalating after 250ms; same-group
leftovers are killed on completion too. Windows hosting is refused. Native tools
own cleanup of separately grouped active subprocesses. Tests prove foreground
specialist/builtin-shell abort. **Detached background specialists, escaping groups
and daemons may outlive an operation**; the adapter is not a persistent-work
supervisor. Do not launch persistent/background work in these calls. Forced
termination also has the native credential-refresh limitations above.

Finish active calls before editing/applying. Public config/catalog are captured
at host startup; source resources load for each fresh call. Restart/reconnect
after changes; no watcher/hot reload. Reinstall dependencies when pins change.
Maintain from S with `pi` and `/faur`, or local
`node .faur-mcp/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`.
Trust the project; disable duplicate global Faur. Preview/apply, stale checks,
authored-file conflicts and hash-protected retired-asset removal retain the
existing lifecycle. Git is rollback. A successful run is not task success.

## Architecture and verification

Native Pi owns execution/discovery/delegation/packages/auth/MCP connections. The
MCP SDK owns stdio protocol; Ajv supplies strict draft-07 validation. Faur adds
only the public declaration/process adapter, not an agent loop, resource loader,
package manager or second MCP client. Source cwd plus absolute target task
instructions intentionally does not enforce target cwd or path containment.

```sh
bash test/test.sh
RUN_FAUR_MCP_TEST=1   node --test test/mcp-server.test.mjs
RUN_FAUR_MCP_TEST=1   node --test test/mcp-native.test.mjs
RUN_FAUR_MCP_TEST=1   node --test test/mcp-auth.test.mjs
```

The sequential gates use independent generated projects, installed local Pi,
local fake models/credentials and real external MCP stdio. They exercise source
instructions/skill/template expansion, actual specialist prompts/tools, extension
execution, native commands/upstream MCP, two targets, ordinary ancestor discovery, strict
failure paths, auth refresh/locking/direct child store access, command approvals,
malformed input, model errors/length, protocol stdout, restart/catalog, bounded
cancellation/foreground-child cleanup and maker approval/state protections.
The tests use registry npm ci and explicit native package installation only. No paid provider or real credential
reads. Source/global custom third-party behavior, escaped/background processes,
provider quality and individual client registration remain unverified/manual.
