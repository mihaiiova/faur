/** Sanitized, historical hosting evidence. No SDK, credential reads or refresh. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readText, atomicWrite, json } from './maintenance-store.mjs';

export const MCP_AUTH_EVIDENCE = '.faur-mcp/auth-evidence.json';
export const mcpConfig = model => ({ ...model.mcpServer, model: model.orchestrator.model, thinking: model.orchestrator.thinking ?? 'off' });
const fingerprint = (config, env) => createHash('sha256').update(JSON.stringify([config, env[config.auth?.authFileEnv] ?? null])).digest('hex');

/** Best-effort non-secret observation; it never makes task success depend on
 * a writable project. The evidence is local history, not an integrity boundary.
 */
export function recordMcpAuthEvidence(root, config, env, kind) {
  if (!config.auth || !['catalog', 'authenticated', 'exercised'].includes(kind)) return;
  const identity = fingerprint(config, env);
  let prior = {};
  try { const value = JSON.parse(readText(root, MCP_AUTH_EVIDENCE)); if (value.fingerprint === identity) prior = value; } catch { /* no compatible prior observation */ }
  const now = new Date().toISOString();
  const value = { fingerprint: identity, ...(typeof prior.catalogAt === 'string' ? { catalogAt: prior.catalogAt } : {}), ...(typeof prior.authenticatedAt === 'string' ? { authenticatedAt: prior.authenticatedAt } : {}), ...(typeof prior.exercisedAt === 'string' ? { exercisedAt: prior.exercisedAt } : {}), ...({ catalog: { catalogAt: now }, authenticated: { authenticatedAt: now }, exercised: { exercisedAt: now } }[kind]) };
  try { atomicWrite(root, MCP_AUTH_EVIDENCE, json(value)); }
  catch { process.stderr.write('Faur MCP authentication evidence could not be recorded; capability checks remain unverified.\n'); }
}

export function mcpHostingStatus(root, model, { env = process.env } = {}) {
  if (!model.mcpServer) return undefined;
  const config = mcpConfig(model);
  const subscription = config.auth?.mode === 'pi-subscription';
  const result = {
    mode: subscription ? 'pi-subscription' : 'isolated-api-key',
    configured: true,
    provider: config.model.split('/')[0],
    sourceConfigured: subscription ? Boolean(env[config.auth.authFileEnv]) : (config.env ?? []).every(name => Boolean(env[name])),
    catalog: 'not verified in the isolated runtime',
    authenticated: 'not verified',
    exercised: 'not verified',
    fix: subscription ? 'Use node .faur-mcp/faur/mcp/host.mjs --check-auth for local metadata/catalog checks, or --check-auth --resolve to explicitly permit OAuth refresh (no model call).' : 'Environment presence is not authentication; verify through an explicitly authorized operation.',
  };
  try {
    const actual = JSON.parse(readText(root, '.faur-mcp/config.json'));
    if (!isDeepStrictEqual(actual, config)) { result.configured = false; result.fix = 'Hosting config differs from the design; reconcile with /faur sync before checking authentication.'; return result; }
  } catch { result.configured = false; result.fix = 'Hosting config is missing or unreadable; regenerate/reconcile it before checking authentication.'; return result; }
  try {
    const version = JSON.parse(readText(root, '.faur-mcp/node_modules/@earendil-works/pi-coding-agent/package.json')).version;
    result.runtimeVersion = typeof version === 'string' ? version : 'unknown';
  } catch { result.runtimeVersion = 'not installed or unreadable'; }
  if (!subscription) return result;
  try {
    const record = JSON.parse(readText(root, MCP_AUTH_EVIDENCE));
    if (record.fingerprint !== fingerprint(config, env)) return result;
    const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
    if (validTime(record.catalogAt)) result.catalog = `last resolved in isolated runtime ${record.catalogAt}; not checked now`;
    if (validTime(record.authenticatedAt)) result.authenticated = `last resolved locally ${record.authenticatedAt}; not checked now`;
    if (validTime(record.exercisedAt)) result.exercised = `last successful model invocation ${record.exercisedAt}; task success not verified`;
  } catch { /* no historical evidence */ }
  return result;
}
