import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export function agentProfile(source) {
  const id = createHash('sha256').update(realpathSync(source)).digest('hex');
  return join(homedir(), '.local/state/faur/agents', id, 'oauth');
}

export function privateProfile(path) {
  if (!path || !isAbsolute(path)) throw new Error('profile');
  const dir = realpathSync(path);
  for (const [p, file] of [[dir, false], [join(dir, 'mcp-auth.json'), true]]) {
    const s = lstatSync(p);
    if (!(file ? s.isFile() : s.isDirectory()) || s.uid !== process.getuid() || (s.mode & 0o077)) throw new Error('profile');
  }
  return dir;
}

// Pi 1.5.2 exposes createMcpExtension({credentials}) but not its concrete store
// constructors at the package root. Resolve relative to that exact locked SDK.
// A symlink alone would put Pi's per-server refresh locks in different temp dirs.
export async function nativeCredentials(dir, secrets) {
  const sdk = import.meta.resolve('@earendil-works/pi-coding-agent');
  const { McpOAuthCredentialStore } = await import(new URL('./extensions/mcp/oauth.js', sdk));
  const { FileAuthStorageBackend } = await import(new URL('./core/auth-storage.js', sdk));
  const native = new McpOAuthCredentialStore(new FileAuthStorageBackend(join(dir, 'mcp-auth.json')), dir);
  const remember = state => {
    for (const value of [state?.tokens?.access_token, state?.tokens?.refresh_token, state?.tokens?.id_token, state?.clientInformation?.client_secret, state?.codeVerifier]) if (typeof value === 'string' && value) secrets.add(value);
    return state;
  };
  return {
    forServer(name, url) {
      const store = native.forServer(name, url);
      return { ...store, load: () => remember(store.load()), save: state => store.save(remember(state)) };
    },
    tokens: native.tokens.bind(native), remove: native.remove.bind(native),
  };
}
