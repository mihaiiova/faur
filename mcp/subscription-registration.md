## Explicit native Pi Codex subscription store

In the client's local server environment, set {{AUTH_FILE_ENV}} to the absolute
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
