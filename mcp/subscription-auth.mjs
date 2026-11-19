/** Explicit trusted native credential-store selection. Pi owns locking, refresh and writes.
 * Lead and specialists may directly read this store. This is not credential isolation.
 */
import { isAbsolute } from 'node:path';
import { realpathSync, statSync } from 'node:fs';

export const AUTH_ERRORS = Object.freeze({
  'auth-source-missing': 'Set the configured auth.authFileEnv host variable to the absolute path of your existing Pi auth.json. It is not a runtime env grant.',
  'auth-source-invalid': 'Pi subscription credential storage is missing, unreadable or not private. Check the configured auth-file path/permissions and sign in with /login openai-codex in a normal Pi session.',
  'auth-login-required': 'A Pi Codex subscription login is required. Sign in with /login openai-codex in a normal Pi session using the configured credential store, then retry. No API-key fallback is used.',
  'auth-refresh-failed': 'Pi Codex subscription refresh failed or the login expired. Sign in again with /login openai-codex in a normal Pi session using the configured store, then retry. No API-key fallback is used.',
  'auth-catalog-incompatible': 'The declared model is not resolvable in the selected Pi runtime catalog. Choose a compatible openai-codex model or update/regenerate the pinned runtime. No model or API-billing fallback is used.',
  'auth-provider-mismatch': 'Subscription authentication requires the declared openai-codex model and provider; no other provider is allowed.',
  'auth-unavailable': 'Pi subscription authentication is unavailable. Check the local dependency installation and configured login; no API-key fallback is used.',
  'auth-cancelled': 'Subscription authentication was cancelled.',
  'auth-execution-failed': 'Codex subscription execution failed. Check model access and your Pi subscription login, then retry. Provider diagnostics are withheld; no API-key fallback is used.',
});
export function authError(code) {
  return Object.assign(new Error(AUTH_ERRORS[code] ?? AUTH_ERRORS['auth-unavailable']), { code });
}
export function authErrorCode(error) {
  return Object.hasOwn(AUTH_ERRORS, error?.code) ? error.code : 'auth-unavailable';
}
const emptyCredentials = Object.freeze({
  read: async () => undefined,
  list: async () => [],
  modify: async () => { throw authError('auth-unavailable'); },
  delete: async () => { throw authError('auth-unavailable'); },
});

export function selectedAuthPath(auth, env) {
  const configured = env[auth.authFileEnv];
  if (!configured || !isAbsolute(configured)) throw authError('auth-source-missing');
  try {
    const path = realpathSync(configured); // Pi also locks the resolved file, including symlink aliases.
    const info = statSync(path);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error();
    return path;
  } catch { throw authError('auth-source-invalid'); }
}

/** No SDK/store access until a request or an explicit local-auth inspection.
 * loadSdk is an internal deterministic-test seam, not generated configuration.
 */
export function createSelectedAuthStore(auth, modelRef, { env = process.env, runtime: selectedRuntime, modelsPath = null, loadSdk = () => import('@earendil-works/pi-coding-agent') } = {}) {
  let initializing, state, closed = false, catalogResolved = false;
  const pending = new Set(), controllers = new Set();
  const prepare = () => {
    if (!initializing) initializing = (async () => {
      if (auth?.mode !== 'pi-subscription' || auth.provider !== 'openai-codex' || modelRef?.split('/')[0] !== auth.provider) throw authError('auth-provider-mismatch');
      const sdk = await loadSdk();
      const options = { modelsPath, refreshOnCreate: false, allowModelNetwork: false };
      const catalog = selectedRuntime ?? await sdk.ModelRuntime.create({ ...options, credentials: emptyCredentials });
      if (typeof catalog.settleCredentialWrites !== 'function' || typeof sdk.readStoredCredential !== 'function') throw authError('auth-unavailable');
      const id = modelRef.slice(auth.provider.length + 1);
      if (catalog.getError() || !catalog.getModel(auth.provider, id)) throw authError('auth-catalog-incompatible');
      catalogResolved = true;
      const path = selectedAuthPath(auth, env);
      const runtime = selectedRuntime ?? await sdk.ModelRuntime.create({ ...options, authPath: path });
      state = { sdk, path, runtime };
      return state;
    })().catch(error => { initializing = undefined; throw authError(authErrorCode(error)); });
    return initializing;
  };
  const readLogin = current => {
    // Public non-resolving read: an api_key command is never executed here.
    selectedAuthPath(auth, { [auth.authFileEnv]: current.path });
    const login = current.sdk.readStoredCredential(auth.provider, current.path);
    if (login?.type !== 'oauth' || typeof login.access !== 'string' || !login.access || typeof login.refresh !== 'string' || !login.refresh || !Number.isFinite(login.expires)) throw authError('auth-login-required');
    return login;
  };
  const resolve = (signal, onSecret = () => {}) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (closed || signal?.aborted) abort();
    controllers.add(controller);
    const operation = (async () => {
      try {
        controller.signal.throwIfAborted();
        const current = await prepare();
        controller.signal.throwIfAborted();
        const login = readLogin(current);
        onSecret(login.access); onSecret(login.refresh);
        const result = await current.runtime.getAuth(auth.provider, { signal: controller.signal, minOAuthValidityMs: 300000 });
        if (result?.source !== 'OAuth' || !result.auth?.apiKey) throw authError('auth-login-required');
        const stored = readLogin(current);
        onSecret(stored.access); onSecret(stored.refresh); onSecret(result.auth.apiKey);
        return true;
      } catch (error) {
        if (controller.signal.aborted) throw authError('auth-cancelled');
        throw authError(Object.hasOwn(AUTH_ERRORS, error?.code) ? error.code : error?.code === 'oauth' ? 'auth-refresh-failed' : 'auth-unavailable');
      } finally {
        controllers.delete(controller);
        signal?.removeEventListener('abort', abort);
      }
    })();
    pending.add(operation);
    operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  };
  return {
    resolve,
    collectSecrets(secrets) {
      if (!state) return;
      const login = readLogin(state);
      secrets.add(login.access); secrets.add(login.refresh);
    },
    // Metadata only: no getAuth, refresh, model request or interactive login.
    async inspect() {
      try {
        const current = await prepare();
        const login = readLogin(current);
        return { configured: true, catalog: 'resolvable', login: login.expires <= Date.now() ? 'expired; refresh required' : 'present', authenticated: 'not checked', exercised: 'not checked' };
      } catch (error) {
        const code = authErrorCode(error);
        return { configured: true, catalog: catalogResolved ? 'resolvable' : code === 'auth-catalog-incompatible' ? 'incompatible' : 'not verified', login: 'not verified', authenticated: 'not checked', exercised: 'not checked', errorCode: code, fix: AUTH_ERRORS[code] };
      }
    },
    async close() {
      closed = true;
      for (const controller of controllers) controller.abort();
      await Promise.allSettled([...pending]);
      // Explicit local auth inspection drains its own native writes. Invocation
      // workers separately own their native runtime and bounded shutdown.
      await state?.runtime.settleCredentialWrites();
    },
  };
}
