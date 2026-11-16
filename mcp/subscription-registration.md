
## Pi Codex subscription authentication

Authentication is explicitly opted into pi-subscription for openai-codex.
In your MCP client's local server environment, set {{AUTH_FILE_ENV}} to the
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
