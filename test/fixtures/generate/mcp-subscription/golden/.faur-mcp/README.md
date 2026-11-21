# Project-local MCP agent

Requires Node.js >=22.19.0 and npm. Install locked host dependencies here with
`npm ci`. No global Pi or Faur is required. Separately review and install
source-declared Pi packages using native Pi in the agent source; operation
calls never install missing packages. Reinstall when dependency pins change.

## Use this agent from another project

For coding agents: when asked to use this installed agent, run Node on this
agent's absolute `faur/mcp/use.mjs` path from the consumer project root,
with argument `pi` or `claude`. It prepares a missing runtime and registers
only this project. If sign-in is required, the operator uses the same helper
with `authorize`; no upstream credentials belong in the caller's config.

## Register locally (manual alternative)

Use your client's supported local MCP configuration (never global registration):

- Transport: stdio
- Command: an absolute path to Node.js
- Argument: the absolute path to `faur/mcp/host.mjs` in this directory
- Agent source S: the parent directory of this directory
- Target T: `../..`, relative to S
- Required environment names: (none declared)

Working directory at registration does not select resources. Only named env
grants plus a small fixed environment reach native lead/children/processes.
PATH can be explicitly granted for native toolchains; HOME, Pi/Node loader
configuration and ambient globals cannot. Never commit credential values.
## Explicit native Pi Codex subscription store

In the client's local server environment, set JARED_PI_AUTH_FILE to the absolute
path of an existing owner-only Pi auth.json owned by the current user. Only the
variable name is generated; never copy or commit credentials. The selector
variable is host-only, but its selected store is directly available to trusted
native lead, specialists, tools and subprocesses through a temporary auth.json
symlink. No auth values are copied. Other store entries are NOT hidden from
trusted code. This intentionally supersedes the lead-only broker (2026-11-18).

Sign in with /login openai-codex in a normal Pi session using that store first.
Requests never log in, discover global auth or fall back to API billing. Native
Pi owns store locking, expiry rechecks, refresh and persistence, including
symlink aliases and normal Pi clients. Forced cancellation/termination during
refresh can interrupt persistence and require re-login; this is not a durable
broker service or OS security boundary.

Inspect metadata without model requests or refresh:

    node .faur-mcp/faur/mcp/host.mjs --check-auth

Explicitly permit native OAuth resolution/refresh (still no model request):

    node .faur-mcp/faur/mcp/host.mjs --check-auth --resolve

Configured, locally resolved and successfully exercised are distinct. The auth
check uses the installed native catalog and S's .pi/models.json, not global overrides;
source extension models require an authorized actual operation for verification.
/faur check never reads credentials or refreshes automatically. Ignored
.faur-mcp/auth-evidence.json holds only boundary-versioned config/source
fingerprints and timestamps. History is advisory, not current provider/model
acceptance or task-success proof. Old broker evidence is not reused.

## Native execution and trust — amendment 2026-11-19

This supersedes the unpublished source/workspace experiment, reduced runtime
and lead-only auth broker. Published unmodified Pi 1.5.2 runs each fresh SDK
session with cwd=S (the source), not T. Native settings, authored instructions,
skills, templates, specialists, extensions, packages, commands and upstream MCP
load by ordinary Pi discovery. Only the bundled developer maintenance extension
opts out via an internal environment marker before importing Faur; that marker
is not a security boundary. Genuine authored extensions load normally.

Every operation supplies the absolute T and validated JSON arguments as task
context after native skill/template expansion. Target work must use absolute
paths or shell cd T; commands/MCP receive T in arguments when needed. This is
ADVISORY, not automatic tool/workspace rebasing or a sandbox. Relative assets,
commands, upstream MCP and default specialist cwd remain S. Fresh conversations
do not isolate source files/memory: keep project-specific state under T.

A fresh Pi config/state directory and explicit env grants are used, but discovery
is NOT hermetic: ancestor instructions/skills and explicit source paths follow
ordinary native policies. Foreground specialists do not automatically inherit
all lead extensions/context/skills: declare extension resources in native agent
metadata and select skills/inheritance as supported by pi-subagents. Background
children have different native inheritance. No custom inheritance is added.

Builtin MCP/codemode/tool_search factories are bound with native session_start.
Pi connects enabled servers in the background; first prompts wait for direct
servers, and deferred tools wait when needed. Startup alone does not prove all
servers connected. Verify actual configured tools. Known package/resource and
extension errors reported by the SDK fail actionable; no operation installs code.
Native discovery may skip nonexistent resource paths without diagnostics: startup
is not exhaustive resource readiness, and no second discovery validator is added. No separate
mcpServer.tools list exists: native source tool selection applies.

Trusted lead, specialists, tools and subprocesses share OS permissions and any
explicitly selected credential store, including other entries. They can read
outside T. There is no automatic login, global auth discovery or
model/provider/API-billing fallback. Provider and extension logs are withheld;
only final answer text is returned. Exact declared env values (except non-secret
PATH) and observed selected tokens are redacted as defense in depth, not an
exfiltration boundary.
Truncated model answers are errors, not successful results.

## Lifecycle and maintenance

One active call per host; overlap is rejected, not queued. Input/output bounds
are 1 MiB. Timeout, cancellation, EOF and SIGTERM/SIGINT abort the native session,
emit native shutdown and terminate the POSIX worker group (SIGKILL after 250ms).
Windows hosting is refused. Native tools own cleanup of separately grouped
processes; same-group leftovers are killed even on success. Native detached
background specialists, escaped groups and daemons may outlive the operation;
this adapter does not supervise persistent work. Do not launch it in MCP calls.
Forced termination during native credential refresh can interrupt persistence
and require re-login; loss-free token rotation is not guaranteed.

Finish active calls before editing/applying, then restart/reconnect. Public
catalog/config are captured at host startup; source resources load per fresh
call. No watcher or hot reload. Separate hosts are not coordinated.

Maintain from S with `pi` and `/faur <request>`, or without global Pi:
`node .faur-mcp/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`.
Trust the project to load the local maintenance extension. Disable duplicate
global Faur. Changes retain normal preview/approval/stale-state protections.
A successful run is not proof of task success; review the answer.
