# Pi subscription authentication for MCP hosting — investigation

Inspected 2026-11-16 against the installed global and MCP-local Pi SDK 1.5.2.
This records the investigation and the subsequently approved implementation
boundary implemented in v0.41.0.
No real credential files were read, no login or provider endpoint was contacted,
and no live subscription/model call was made. Implementation regression tests use
only fake credentials and local HTTP fixtures; default isolated API-key behavior
is unchanged.

## Findings from primary sources

Paths below refer to the installed packages under `mcp/node_modules/` (the SDK
version pinned by `mcp/package.json`). They identify the actual implementation,
not an assumption based on API names.

1. **Provider-scoped resolution is public.** `@earendil-works/pi-coding-agent/
   dist/core/model-runtime.d.ts` exposes `ModelRuntime.create({authPath,
   credentials, modelsPath, refreshOnCreate})`, `getAuth(providerId, options)`,
   `getModel`, `registerNativeProvider` and `settleCredentialWrites`.
   `dist/core/model-runtime.js:79–117,369–382,438–443` shows their delegation.
   The SDK's `examples/sdk/09-api-keys-and-oauth.ts` documents authPath selection;
   `pi-ai/README.md`, “How Auth Resolves” and “Credential Store”, documents
   provider-specific auth resolution and the injected store contract.
2. **Pi already coordinates cooperating processes.** `pi-coding-agent/dist/core/
   auth-storage.js:45–167,411–430` locks the resolved auth-file path with
   `proper-lockfile`, reads authoritative current contents under the lock and
   merges the selected provider before persisting. Normal Pi and multiple MCP
   processes must use the same source store, not credential copies.
3. **Refresh must not live in a killable invocation worker.** `pi-ai/dist/auth/
   resolve.js:46–115` rechecks expiry under the store lock. Once refresh starts,
   cancellation is detached so a rotated token can be persisted; refresh uses
   its own 15-second timeout. Lock waiting is cancellable. Public getAuth may
   return cancellation before persistence completes. `pi-coding-agent/dist/core/
   runtime-credentials.js:32–47` and `ModelRuntime.settleCredentialWrites()`
   provide a drain for these outstanding writes. The current Faur host kills
   its invocation worker after a 250ms grace; putting native refresh there
   would defeat that protection.
4. **Codex is not API-key fallback.** `pi-ai/dist/providers/openai-codex.js:6–20`
   defines an OAuth-only, subscription-labelled provider targeting ChatGPT's
   backend. `pi-ai/dist/auth/resolve.js:17–38` does not fall back after a stored
   OAuth refresh failure. `pi-ai/dist/auth/oauth/openai-codex.js:318–345` refreshes
   through the provider implementation and derives request auth from the OAuth
   access token. Its `apiKey` result field is a transport parameter holding that
   bearer token, not evidence of API billing.
5. **A persistent provider-scoped store cannot currently be composed entirely
   through public SDK exports.** `pi-coding-agent/package.json:15–24` exposes
   only its root and RPC entry. `dist/index.d.ts:4,15` exports
   `readStoredCredential` and ModelRuntime, not AuthStorage/FileAuthStorageBackend.
   The public one-off read has no locked update operation. Deep-importing native
   storage or implementing a second refresh/file-lock system would not satisfy
   the requested supported-mechanisms contract.
6. **An SDK-native auth broker is a possible alternative boundary.** Public
   ModelRuntime can own the existing file store in the long-lived MCP host and
   resolve only a fixed provider via getAuth. A worker can use the public native
   provider registration/auth resolver interfaces to request that provider's
   resolved request auth over a private IPC channel. It needs neither the source
   auth-file path nor refresh tokens. However, the broker's native AuthStorage
   necessarily parses the shared auth.json internally: other provider entries
   reside in that trusted SDK store. Restricting requests/results to Codex is
   not isolation of the broker itself from those entries.
7. **Catalog compatibility is separate from authentication.** SDK creation with
   an injected empty store, `modelsPath:null`, `refreshOnCreate:false` and network
   catalog refresh disabled resolved built-in Codex IDs without any credential
   reads. A model seen by the developer's Pi may instead come from a newer cached
   catalog, models.json or a provider extension. It must resolve in the pinned
   isolated runtime before auth access; never substitute another model/provider.
8. **Availability is not authentication or execution.** `pi-ai/dist/models.js:
   274–276` treats a stored OAuth entry as available without validating expiry
   or contacting the provider. Successful getAuth means local auth resolution
   (including refresh when needed); a successful model call is separate evidence.

## Deterministic observations

Two disposable, offline probes used empty or fake-only injected stores and a
fresh HOME. No configured user store was accessed.

- Creating the isolated ModelRuntime and enumerating its Codex catalog caused
  zero credential-store read/list/modify calls. The catalog present here contains
  `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-6-astra`, `gpt-6-luna`,
  `gpt-6-sol`, `gpt-6.1-sol` and `gpt-6.1-terra`. Do not hardcode this list into
  Faur or assume that older/discovered IDs resolve.
- With a fake OAuth provider, cancellation returned before the mock refresh
  committed. Awaiting settleCredentialWrites then observed the committed update;
  exactly one refresh occurred. Delegating resolved auth through another
  runtime's public provider auth resolver succeeded without persisting any
  worker credential. Model-stream and interactive-login functions in the probe
  were forbidden. This tests public API composition, not native cross-process
  file-store behavior or real Codex acceptance.

## Approved design (2026-11-16)

The user explicitly selected the native broker after being shown the shared-store
trade-off. Implementation uses that boundary; a strict broker-process credential
store facade is not claimed. Automated fake-only regression tests cover native
multi-process refresh (including a normal Pi CLI), IPC delegation, cancellation/
drain and default-mode isolation. No live subscription acceptance is claimed.

### Declaration

```yaml
mcpServer:
  auth:                         # omitted: existing isolated API-key behavior
    mode: pi-subscription
    provider: openai-codex
    authFileEnv: JARED_PI_AUTH_FILE
```

The named host-only variable would contain an explicit absolute path to the
user's existing Pi auth.json, configured by the caller, never a credential value
in generated resources. It would not be included in runtime env grants. The
provider must match the declared model; unrelated providers and billing fallback
are refused. No global settings/models/extensions/skills/MCP would load.

Implementation contract:

- Keep credential reads/refresh/persistence in the long-lived host's native Pi
  runtime, not the invocation process or a copied store. Expose only selected
  provider resolution to the worker over private IPC, on each model request.
- Preserve the current worker tool allowlist, temporary home, in-memory settings
  and sessions, custom resource loader, timeout, cancellation and group cleanup.
- Cancellation still stops invocation promptly. Broker shutdown waits for native
  credential writes to settle; a started refresh can extend graceful shutdown
  beyond the invocation timeout. Hard-killing the broker cannot provide a
  loss-free refresh guarantee. Native storage also uses direct writes, not a
  crash-durable transaction; disk failure/ambiguous remote refresh outcomes have
  the same limitations as ordinary Pi.
- Check the exact model in the pinned isolated catalog before accessing auth.
  Missing login, invalid/unreadable storage, failed refresh and catalog mismatch
  must have distinct sanitized actionable errors; never surface raw SDK causes.
- Never pass stored credentials/refresh tokens through invocation JSON, env,
  prompts or logs. Resolved access tokens remain in memory/IPC only and are
  excluded/redacted from returned output. This remains trusted same-user code,
  not an OS boundary against a tool with unrestricted filesystem/process access.
- Update schema/generation/previews/registration docs and capability checks
  together. Report declaration configured, login metadata, auth resolution and
  actual invocation evidence separately. Default checks must not initiate login,
  provider refresh or a model call silently.
- Regression gates must cover missing/expired/failed auth, selected-provider
  filtering, native multi-process refresh contention (including normal Pi),
  cancellation with a refresh still committing, shutdown drain, sanitized errors,
  credential leakage, incompatible models and unchanged API-key/default isolation.
  Live subscription acceptance requires separate permission.

If the requirement excludes **even the trusted broker's SDK store** from reading
unrelated credential entries, do not implement this alternative. The smallest
upstream prerequisite is a public persistent credential-store factory (export
AuthStorage or equivalent), so Faur can put a provider/OAuth-only facade between
native persistence and ModelRuntime. Preserve Pi's existing lock/refresh/drain
semantics; do not copy the store or reimplement OAuth. That facade restricts API
access, not OS access, and native JSON persistence still has to preserve other
entries internally. Stronger physical/per-provider secret isolation would need
an upstream per-provider storage backend or credential broker, not just an export.
