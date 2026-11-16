/** Opt-in public operations. No discovery, execution or implicit capability grants. */
import Ajv from 'ajv';

export const MCP_TOOLS = ['read', 'grep', 'find', 'ls', 'write', 'edit', 'bash'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const reservedEnv = /^(PATH|HOME|SHELL|USER|IFS|ENV|BASH_ENV|TMPDIR|NODE_.*|LD_.*|DYLD_.*|PI_.*|FAUR_.*|GIT_.*|PYTHON.*|PERL.*|RUBY.*|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)$/i;

/** Strict draft-07 validation, without coercion, defaults, mutation or remote refs.
 * No format plugins: unsupported formats are rejected during design validation.
 */
export function operationValidator(schema) {
  if (!object(schema) || schema.type !== 'object') throw new Error('inputSchema must be a JSON Schema object with type: object');
  return new Ajv({ strict: true, allErrors: false, validateFormats: true }).compile(schema);
}

export function mcpServerErrors(server) {
  if (server === undefined) return [];
  const errors = [];
  const fail = message => errors.push(`document.mcpServer ${message}`);
  const keys = (value, allowed, path) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path} has unknown key "${key}"`);
  };
  if (!object(server)) return ['document.mcpServer must be an object'];
  keys(server, ['projectRoot', 'tools', 'env', 'timeoutMs', 'operations'], '');
  if (!nonempty(server.projectRoot) || server.projectRoot.includes('\0') || server.projectRoot.startsWith('~')) fail('projectRoot must explicitly name an absolute or agent-folder-relative directory (no ~ expansion)');
  if (!Array.isArray(server.tools) || server.tools.some(tool => !MCP_TOOLS.includes(tool)) || new Set(server.tools).size !== server.tools.length) fail(`tools must be an explicit unique list drawn from ${MCP_TOOLS.join(', ')}`);
  if (server.env !== undefined && (!Array.isArray(server.env) || server.env.some(name => !/^[A-Z_][A-Z0-9_]*$/.test(name) || reservedEnv.test(name)) || new Set(server.env).size !== server.env.length)) fail('env must be unique environment variable names, not execution/configuration overrides');
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
