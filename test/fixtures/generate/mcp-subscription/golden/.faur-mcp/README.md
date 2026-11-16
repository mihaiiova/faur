# Project-local MCP agent

Install once from this directory: `npm ci`. Requires Node.js 22+ and npm.
No global Pi or Faur is required. Dependencies are pinned in package-lock.json.

## Register locally

Ask your coding agent to register this server for the current project using its
client-specific MCP configuration. Do not change global configuration.

- Transport: stdio
- Command: an absolute path to your Node.js executable
- Arguments: one absolute path to `faur/mcp/host.mjs` in this directory
- Working directory: this directory (optional; the entry point is cwd-independent)
- Agent source: the parent directory of this directory
- Target project: `../..`, resolved relative to the agent source
- Required environment variable names: (none; subscription auth is supplied by the host broker)

Use the client's supported environment/secret mechanism. Never paste credential
values into committed resources. The host uses only the explicitly selected Pi subscription login; it does not load .env.
`config.json` defines the public catalog; it does not expose internal tools.

## Pi Codex subscription authentication

Authentication is explicitly opted into pi-subscription for openai-codex.
In your MCP client's local server environment, set JARED_PI_AUTH_FILE to the
absolute path of your existing private Pi auth.json. This is a HOST-ONLY path
variable, not a credential value and not a runtime env grant. Never copy the
credential file into this project or commit its contents. Keep its permissions
private (owner-only). Sign in with /login openai-codex in a normal Pi session
using that store before invoking MCP; requests never start interactive login.
No separately billed OpenAI API key or provider/model fallback is used.

The trusted host uses Pi's supported getAuth API and native auth-file lock to
refresh/persist only the selected provider. The SDK store internally parses the
shared file, including other entries; those entries and refresh tokens never
reach the worker. The worker gets resolved Codex request auth over private IPC,
not through env, invocation JSON, prompts or logs. It still loads no global
settings, extensions, skills, models.json or upstream MCP. This is not an OS
security boundary against trusted same-user tools.

Normal Pi sessions and multiple hosts using the same store share Pi's file lock.
Invocation cancellation/timeout still stops its worker promptly. Graceful HOST
shutdown drains an already-started refresh (about 15 seconds plus storage work);
configure the client to allow at least 20 seconds before force-killing the host.
If a client cannot honor that grace, do not use shared-login mode with it.
SIGKILL, disk failures or ambiguous remote refresh outcomes can still require
logging in again, as with ordinary Pi; loss-free/crash-durable rotation is not
guaranteed. Do not force-kill the host during refresh.

From the agent source directory, inspect the pinned runtime without a model call:

    node .faur-mcp/faur/mcp/host.mjs --check-auth

This reads local login/catalog metadata; it does not refresh or prove provider
acceptance. To explicitly allow OAuth resolution/refresh (still no model call):

    node .faur-mcp/faur/mcp/host.mjs --check-auth --resolve

The selected model must resolve in the pinned isolated catalog. A model merely
listed in your developer Pi is not sufficient; incompatible catalogs fail with
no substitution. Configured, locally resolved and actually exercised are separate
states. /faur check reports historical evidence, not current provider acceptance
or task success. Auth evidence contains only config/source fingerprints and
timestamps in ignored .faur-mcp/auth-evidence.json, never credentials.

## Maintain

From the agent source directory, run `pi` and trust the project, then use
`/faur <request>`. Without global Pi, run
`node .faur-mcp/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`.
The local extension loads bundled Faur for developer sessions only. If a global
Faur extension is also installed, disable that duplicate for this project.

Finish active calls before editing or applying changes, then restart/reconnect
the MCP server. There is no hot reload. One call runs at a time per server;
overlap is rejected, not queued. Multiple server processes are not coordinated.
After dependency changes, run `npm ci` here again before restarting.

## Execution and limits

Each call starts fresh Pi SDK execution in a child process. Runtime receives
only the explicit built-in tool allowlist and declared environment variables.
It reads the authored part of .pi/APPEND_SYSTEM.md and the operation prompt;
it does not load developer extensions, specialists, skills, upstream MCP,
project/global settings, parent instructions or unrelated credentials. Selected subscription request auth comes from the host broker.
Tools use the explicit target project as their working directory.
Configuration isolation and tool selection are enforced by the SDK loader;
this is NOT OS/filesystem isolation. Read can read outside the project; bash
can access the user's files and credentials. Instructions are advisory.
Do not use this as a boundary against hostile callers or untrusted projects.

POSIX process groups are terminated on completion, error, timeout, cancellation,
stdin close and SIGTERM/SIGINT. Windows hosting is refused in this first slice.
Pi aborts active tools too. Commands that deliberately background/detach work
can outlive a tool call; escaped groups/daemons are outside this guarantee.
Only final answer text is returned, not logs, environment or provider errors.
Declared secret values are redacted from answer text as defense in depth, not
a general exfiltration boundary. All allowed tools share the call's credentials.
An answer is not proof that the requested audit/review succeeded.
