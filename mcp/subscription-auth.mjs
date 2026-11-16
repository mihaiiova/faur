/** Trusted host-side OAuth resolution. Only Pi owns locking, refresh and writes.
 * Workers receive resolved Codex request auth, never auth paths/refresh tokens.
 */
import { isAbsolute } from 'node:path';
import { realpathSync, statSync } from 'node:fs';

export const AUTH_ERRORS = Object.freeze({
  'auth-source-missing': 'Set the configured auth.authFileEnv host variable to the absolute path of your existing Pi auth.json. It is not a runtime env grant.',
  'auth-source-invalid': 'Pi subscription credential storage is missing, unreadable or not private. Check the configured auth-file path/permissions and sign in with /login openai-codex in a normal Pi session.',
  'auth-login-required': 'A Pi Codex subscription login is required. Sign in with /login openai-codex in a normal Pi session using the configured credential store, then retry. No API-key fallback is used.',
  'auth-refresh-failed': 'Pi Codex subscription refresh failed or the login expired. Sign in again with /login openai-codex in a normal Pi session using the configured store, then retry. No API-key fallback is used.',
  'auth-catalog-incompatible': 'The declared model is not resolvable in the pinned isolated Pi catalog. Choose a compatible openai-codex model or update/regenerate the pinned runtime. No model or API-billing fallback is used.',
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
export const emptyCredentials = Object.freeze({
  read: async () => undefined,
  list: async () => [],
  modify: async () => { throw authError('auth-unavailable'); },
  delete: async () => { throw authError('auth-unavailable'); },
});

function sourcePath(auth, env) {
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
export function createSubscriptionBroker(auth, modelRef, { env = process.env, loadSdk = () => import('@earendil-works/pi-coding-agent') } = {}) {
  let initializing, state, closed = false, catalogResolved = false;
  const pending = new Set(), controllers = new Set();
  const prepare = () => {
    if (!initializing) initializing = (async () => {
      if (auth?.mode !== 'pi-subscription' || auth.provider !== 'openai-codex' || modelRef?.split('/')[0] !== auth.provider) throw authError('auth-provider-mismatch');
      const sdk = await loadSdk();
      const options = { modelsPath: null, refreshOnCreate: false, allowModelNetwork: false };
      const catalog = await sdk.ModelRuntime.create({ ...options, credentials: emptyCredentials });
      if (typeof catalog.settleCredentialWrites !== 'function' || typeof sdk.readStoredCredential !== 'function') throw authError('auth-unavailable');
      const id = modelRef.slice(auth.provider.length + 1);
      if (!catalog.getModel(auth.provider, id)) throw authError('auth-catalog-incompatible');
      catalogResolved = true;
      const path = sourcePath(auth, env);
      const runtime = await sdk.ModelRuntime.create({ ...options, authPath: path });
      state = { sdk, path, runtime };
      return state;
    })().catch(error => { initializing = undefined; throw authError(authErrorCode(error)); });
    return initializing;
  };
  const readLogin = current => {
    // Public non-resolving read: an api_key command is never executed here.
    sourcePath(auth, { [auth.authFileEnv]: current.path });
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
        return { source: 'OAuth', auth: { apiKey: result.auth.apiKey } };
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
      // A started native refresh outlives request cancellation. Never kill its
      // owner as part of the invocation's 250ms worker-cleanup deadline.
      await state?.runtime.settleCredentialWrites();
    },
  };
}

/** Private Node IPC, never MCP stdout or invocation prompt JSON. */
export function workerAuthClient(channel = process) {
  const requests = new Map();
  let nextId = 0;
  const reply = message => {
    if (message?.type !== 'faur-auth-result') return;
    const request = requests.get(message.id);
    if (!request) return;
    if (message.errorCode) request.reject(authError(authErrorCode({ code: message.errorCode })));
    else if (message.result?.source === 'OAuth' && typeof message.result.auth?.apiKey === 'string') request.resolve(message.result);
    else request.reject(authError('auth-unavailable'));
  };
  const disconnected = () => { for (const request of [...requests.values()]) request.reject(authError('auth-unavailable')); };
  channel.on('message', reply);
  channel.on('disconnect', disconnected);
  return {
    resolve(signal) {
      if (!channel.connected || signal?.aborted) return Promise.reject(authError(signal?.aborted ? 'auth-cancelled' : 'auth-unavailable'));
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const finish = (fn, value) => { requests.delete(id); signal?.removeEventListener('abort', abort); fn(value); };
        const abort = () => finish(reject, authError('auth-cancelled'));
        requests.set(id, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
        signal?.addEventListener('abort', abort, { once: true });
        channel.send({ type: 'faur-auth-request', id }, error => { if (error) requests.get(id)?.reject(authError('auth-unavailable')); });
      });
    },
    close() { disconnected(); channel.removeListener('message', reply); channel.removeListener('disconnect', disconnected); },
  };
}

/** Public Pi provider/auth composition; transport remains Codex's native API.
 * The resolver never consults worker env, files or API-key fallback sources.
 */
export function installSubscriptionResolver(runtime, providerId, resolveAuth) {
  const provider = runtime.getProvider(providerId);
  if (providerId !== 'openai-codex' || !provider?.auth.oauth?.isSubscription) throw authError('auth-provider-mismatch');
  runtime.registerNativeProvider({ ...provider, auth: { apiKey: {
    name: 'Selected Pi subscription broker',
    // Pi's prompt preflight requires configured delegation. This does not
    // attest a usable login; resolve() still gates every actual model request.
    check: async () => ({ type: 'oauth', source: 'selected Pi subscription delegation; login not checked' }),
    resolve: ({ signal }) => resolveAuth(signal),
  } } });
}
