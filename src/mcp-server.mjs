/** Opt-in public operations. No discovery, execution or implicit capability grants. */
import Ajv from 'ajv';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const reservedEnv = /^(HOME|SHELL|USER|IFS|ENV|BASH_ENV|TMPDIR|NODE_.*|LD_.*|DYLD_.*|PI_.*|FAUR_.*|GIT_.*|PYTHON.*|PERL.*|RUBY.*|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)$/i;

/** Strict draft-07 validation, without coercion, defaults, mutation or remote refs.
 * No format plugins: unsupported formats are rejected during design validation.
 */
export function operationValidator(schema) {
  if (!object(schema) || schema.type !== 'object') throw new Error('inputSchema must be a JSON Schema object with type: object');
  return new Ajv({ strict: true, allErrors: false, validateFormats: true }).compile(schema);
}

export function mcpServerErrors(server, model) {
  if (server === undefined) return [];
  const errors = [];
  const fail = message => errors.push(`document.mcpServer ${message}`);
  const keys = (value, allowed, path) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path} has unknown key "${key}"`);
  };
  if (!object(server)) return ['document.mcpServer must be an object'];
  keys(server, ['projectRoot', 'env', 'timeoutMs', 'operations', 'auth'], '');
  if (!nonempty(server.projectRoot) || server.projectRoot.includes('\0') || server.projectRoot.startsWith('~')) fail('projectRoot must explicitly name an absolute or agent-folder-relative directory (no ~ expansion)');
  if (server.env !== undefined && (!Array.isArray(server.env) || server.env.some(name => !/^[A-Z_][A-Z0-9_]*$/.test(name) || reservedEnv.test(name)) || new Set(server.env).size !== server.env.length)) fail('env must be unique environment variable names, not execution/configuration overrides');
  if (server.auth !== undefined) {
    if (!object(server.auth)) fail('auth must be an object');
    else {
      keys(server.auth, ['mode', 'provider', 'authFileEnv'], 'auth');
      if (server.auth.mode !== 'pi-subscription') fail('auth.mode must be pi-subscription; omit auth for isolated API-key mode');
      if (server.auth.provider !== 'openai-codex') fail('auth.provider must be openai-codex (the supported subscription provider)');
      if (typeof model !== 'string' || model.split('/')[0] !== server.auth.provider) fail('auth.provider must match the orchestrator model provider; no billing/model fallback is allowed');
      const name = server.auth.authFileEnv;
      if (typeof name !== 'string' || name === 'PATH' || !/^[A-Z_][A-Z0-9_]*$/.test(name) || (reservedEnv.test(name) && !name.startsWith('FAUR_'))) fail('auth.authFileEnv must name a dedicated host-only environment variable, not an execution/configuration override');
      if (Array.isArray(server.env) && server.env.includes(name)) fail('auth.authFileEnv must not be included in runtime env grants');
    }
  }
  if (server.timeoutMs !== undefined && (!Number.isInteger(server.timeoutMs) || server.timeoutMs < 1 || server.timeoutMs > 3600000)) fail('timeoutMs must be an integer from 1 to 3600000');
  if (!Array.isArray(server.operations) || !server.operations.length || server.operations.length > 100) fail('operations must contain 1–100 public operations');
  const names = new Set();
  for (const [i, operation] of (Array.isArray(server.operations) ? server.operations : []).entries()) {
    const path = `operations[${i}]`;
    if (!object(operation)) { fail(`${path} must be an object`); continue; }
    keys(operation, ['name', 'description', 'inputSchema', 'prompt'], path);
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(operation.name ?? '') || names.has(operation.name)) fail(`${path}.name must be a unique public tool name (lowercase letters, digits, _ or -; maximum 64 characters)`);
    names.add(operation.name);
    for (const key of ['description', 'prompt']) if (!nonempty(operation[key])) fail(`${path}.${key} must be a non-empty string`);
    try { operationValidator(operation.inputSchema); } catch (error) { fail(`${path}.inputSchema: ${error.message}`); }
  }
  return errors;
}
