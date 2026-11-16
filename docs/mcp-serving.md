# Project-local agents exposed through MCP

Approved 2026-11-16: an optional exception to Faur's maker-only boundary. The
user wants to call a specialized Pi agent from another coding agent, while
maintaining its behavior and public operations together. Ordinary/minimal
projects remain unchanged. No separate Agent Kit package is introduced.

## Create

Ask from your main project:

> /faur Create Jared in .agents/jared and expose audit and review as MCP tools.

Faur designs the native Pi project and adds this declaration to its
`.pi/system.yaml` (choose the model with the developer):

```yaml
mcpServer:
  projectRoot: ../..
  tools: [read, grep, find, ls]
  env: [ANTHROPIC_API_KEY]
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
    - name: review
      description: Review a change in the target project
      inputSchema:
        type: object
        properties:
          request: { type: string }
        required: [request]
        additionalProperties: false
      prompt: Review the change described by the supplied request.
```

These are public capabilities, not internal tools. Each binds a validated JSON
object to instructions for a fresh execution of the lead. The lead's authored
`.pi/APPEND_SYSTEM.md` is shared with interactive use; its generated developer
capability section is excluded. This first slice deliberately does not load
skills, specialists, arbitrary provider extensions or upstream MCP at runtime.
The runtime uses Pi's built-in model catalog and explicitly declared provider
key variables; it does not use global OAuth logins or custom models.json.

## Install and register

After reviewing and approving the normal generation preview:

```sh
cd .agents/jared/.faur-mcp
npm ci
```

Requires Node.js 22+ and npm. No global Pi or Faur is needed. Commit the generated
manifest, lockfile, configuration and assets; node_modules is ignored.

Tell your coding agent:

> Register the MCP server found in .agents/jared locally for this project.

The generated `.faur-mcp/README.md` supplies transport, exact entry point,
arguments, environment names and source/target path rules. The client chooses
its own configuration format; Faur does not register it automatically or modify
global configuration. Use an absolute Node executable and an absolute path to
`.agents/jared/.faur-mcp/faur/mcp/host.mjs` as its one argument. An arbitrary
caller working directory is safe: source paths are entry-point-relative and
`projectRoot` is agent-source-relative. Store secrets outside committed config,
using the client's supported environment mechanism. Faur never embeds values.

## Maintain

```sh
cd .agents/jared
pi
# /faur Change review to focus on API compatibility
```

Without global Pi:

```sh
node .faur-mcp/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
```

Trust the project to load the local developer extension. A global Faur extension
is unnecessary; disable a duplicate global Faur if present. Public-operation
changes use `set` target `mcpServer` through the existing model validation,
preview, stale-file check and apply path. No second writer or lifecycle is added.
The preview shows public definitions in full and executable library/dependency
assets by path, action and before/after SHA-256, with the direct dependency pins.
As with installing a package, approve only trusted Faur source. This bounded
package-style preview avoids an unreadable full-source/lockfile dump.
Native authored prompts keep their existing ownership contract. Bundled files
and operation config are hash-checked against the generated inventory before
replacement; edited or pre-existing unmarked files conflict. Resolve those edits
explicitly, or delete only the reviewed file before regeneration. Retired bundle
files are removed only when the prior manifest proves their bytes unchanged.
Set `mcpServer` to null in a maintenance operation to remove the interface;
installed dependencies remain on disk with their ignore rule (delete them
manually if no longer needed).

Finish active calls **before editing or applying maintenance**, then restart and
reconnect the server. It captures the catalog and prompt at startup; no hot
reload or file watcher. Each server permits one active call, rejects overlap and
has no queue. Separate server processes are not coordinated. Re-run npm ci if
the locked dependencies changed. Git is the rollback mechanism.

## Hosting and security

- `mcp/host.mjs` uses the maintained MCP SDK for stdio protocol handling;
  `mcp/worker.mjs` delegates execution to Pi's SDK. No agent loop is implemented.
- Every operation shares schema validation, invocation, timeout/cancellation,
  child cleanup and result mapping. Success returns only final answer text;
  model/provider/internal errors return a generic error, not raw stderr.
- Worker stdout is captured separately from MCP stdout. Logs are not returned.
  Invocation input and worker output are bounded to 1 MiB.
- Runtime uses an explicit custom SDK resource loader and in-memory settings and
  sessions. It does not discover project/global settings, extensions, packages,
  skills, parent instructions or developer credential files. Its home and agent
  directory are temporary; only explicitly named variables plus a small fixed
  execution environment reach it. No provider catalog network refresh occurs.
- This is **enforced configuration isolation**, not OS isolation. Tools still
  have the OS account's permissions. Read can access paths outside the target;
  bash can access credential files or spawn escaping processes. Allowed tools
  share the call's credentials. Prompt instructions are advisory. Use trusted
  projects/callers; this is not a sandbox for hostile code or tenants.
- Exact declared environment values are redacted from returned answer text as
  defense in depth. This is not general secret detection or exfiltration
  prevention. Never send credentials as operation inputs.
- On timeout/cancel/shutdown the worker's POSIX process group receives SIGTERM,
  then SIGKILL after 250ms if needed. Same-group leftovers are killed after
  normal completion too. Hosting refuses Windows rather than weakening cleanup.
  Pi's session abort also cancels active built-in tools, including shell groups.
  Shell commands that deliberately background/detach work can outlive their tool
  invocation; supervising daemons or escaped process groups is outside this
  guarantee. Do not use these calls to launch persistent background work.
- SDK run success is not task success: read the answer to judge the audit/review.

## Distribution decision

Plain Pi configuration and upstream MCP integrations connect to servers; they
do not expose an agent's declared capabilities as a server. A skill alone cannot
provide the enforced validation/process/protocol boundary. The MCP SDK and Pi
SDK supply those primitives; Faur adds only their adapter and declarations.
Ajv supplies strict draft-07 validation rather than a handwritten schema subset.

Faur's current package is private and Git-distributed. Pinning a published Faur
runtime would assume a release that does not exist. Instead the generator bundles
ordinary Faur package assets under `.faur-mcp/faur/`, including the canonical
host, maker modules, extension and skill. These are distribution copies from one
implementation, not per-agent server templates or independent forks. The exact
Pi/MCP/schema dependencies and their transitive resolutions are locked. Nothing
points at a developer checkout. The package can maintain itself using the same
code paths. There is no snapshot/publishing/version-selection system.

## Verification

```sh
bash test/test.sh
RUN_FAUR_MCP_TEST=1 node --test test/mcp-server.test.mjs
npm audit --prefix mcp
```

The opt-in integration gate installs into a separate temporary project (paths
contain spaces), uses only its local dependencies and absolute Node executable,
and points real Pi at a local deterministic Azure-compatible fixture. It lists
and invokes audit/review over real MCP stdio, checks invalid input, generic
execution failure, overlap, cancellation/reuse, timeout, restart/catalog/behavior
updates and actual Pi RPC discovery of `/faur`. CLI first-generation approval, retired
bundle cleanup, symlinked entry paths and stdin-EOF shutdown have regressions.
A deterministic worker fixture checks environment filtering, secret redaction,
temporary-home deletion and same-group descendant cleanup. A real Pi bash tool
call proves active detached shell-group cancellation on stdin EOF. Provider requests prove developer
instructions/extensions/tools are not inherited. No paid-provider credits.

Real provider quality, interactive human TUI editing and individual third-party
client registration flows remain live/manual checks, not claims made by this gate.
