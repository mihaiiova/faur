/** Shared stdio adapter. Pi owns execution; this module only hosts public operations. */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, realpathSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { mcpServerErrors, operationValidator } from '../src/mcp-server.mjs';
import { mcpConfig, recordMcpAuthEvidence } from '../src/mcp-auth-status.mjs';
import { AUTH_ERRORS, authErrorCode, createSubscriptionBroker } from './subscription-auth.mjs';

const textResult = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });
const LIMIT = 1024 * 1024;

/** Capture config and authored prompt once: a restart is the update boundary. */
export function loadAgent(agentSource, brokerOptions) {
  const source = realpathSync(agentSource);
  const { model, thinking, ...config } = JSON.parse(readFileSync(join(source, '.faur-mcp/config.json'), 'utf8'));
  const errors = mcpServerErrors(config, model);
  if (errors.length || typeof model !== 'string' || !model.includes('/')) throw new Error('Invalid MCP configuration; regenerate with Faur');
  const target = realpathSync(resolve(source, config.projectRoot));
  if (!statSync(target).isDirectory()) throw new Error('Target project root is not a directory');
  const nativePrompt = readFileSync(join(source, '.pi/APPEND_SYSTEM.md'), 'utf8');
  const prompt = nativePrompt.split('<!-- faur:derived v1 begin:')[0].replace(/^<!-- faur:generated v1 sha256=[a-f0-9]{64} -->\n/, '').trim();
  return { source, target, model, thinking, prompt, config, validators: new Map(config.operations.map(op => [op.name, operationValidator(op.inputSchema)])), ...(config.auth ? { authBroker: createSubscriptionBroker(config.auth, model, brokerOptions) } : {}) };
}

function killGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

/** One path for every operation, including validation, cleanup and result mapping.
 * workerPath is an internal test seam, never part of public configuration.
 */
export async function invoke(agent, name, input, signal, { workerPath = new URL('./worker.mjs', import.meta.url), authBroker = agent.authBroker } = {}) {
  const operation = agent.config.operations.find(op => op.name === name);
  if (!operation) return textResult('Unknown public operation', true);
  if (!agent.validators.get(name)(input)) return textResult('Invalid operation input (does not match inputSchema)', true);
  if (signal?.aborted) return textResult('Operation cancelled', true);
  const payload = JSON.stringify({ target: agent.target, model: agent.model, thinking: agent.thinking, systemPrompt: agent.prompt, tools: agent.config.tools, ...(agent.config.auth ? { auth: { mode: 'pi-subscription', provider: agent.config.auth.provider } } : {}), prompt: `${operation.prompt}\n\nOperation arguments (JSON data):\n${JSON.stringify(input)}` });
  if (Buffer.byteLength(payload) > LIMIT) return textResult('Operation input exceeded limit', true);
  const home = mkdtempSync(join(tmpdir(), 'faur-mcp-'));
  const env = { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, PI_CODING_AGENT_DIR: home, PI_OFFLINE: '1', LANG: 'C.UTF-8' };
  for (const key of agent.config.env ?? []) {
    if (!process.env[key]) { rmSync(home, { recursive: true, force: true }); return textResult(`Missing required environment variable: ${key}`, true); }
    env[key] = process.env[key];
  }
  const secrets = new Set((agent.config.env ?? []).map(key => env[key]));
  const redact = text => [...secrets].filter(Boolean).sort((a, b) => b.length - a.length).reduce((value, secret) => value.split(secret).join('[REDACTED]'), text);
  try {
    return await new Promise(resolveResult => {
      const authController = new AbortController();
      const child = spawn(process.execPath, [fileURLToPath(workerPath)], { cwd: agent.target, env, detached: true, stdio: ['pipe', 'pipe', 'ignore', ...(agent.config.auth ? ['ipc'] : [])] });
      let outstandingAuth = 0, authenticated = false;
      const observe = kind => recordMcpAuthEvidence(agent.source, mcpConfig({ mcpServer: agent.config, orchestrator: { model: agent.model, thinking: agent.thinking } }), process.env, kind);
      if (agent.config.auth) child.on('message', message => {
        if (message?.type !== 'faur-auth-request' || !Number.isSafeInteger(message.id) || message.id < 1 || outstandingAuth >= 4 || authController.signal.aborted) return;
        outstandingAuth++;
        // No provider/path comes from the worker: the broker is bound to the
        // approved declaration, and credentials never cross MCP stdout.
        const request = authBroker ? authBroker.resolve(authController.signal, secret => secrets.add(secret)) : Promise.reject({ code: 'auth-unavailable' });
        const reply = data => { try { if (child.connected) child.send({ type: 'faur-auth-result', id: message.id, ...data }, () => {}); } catch { /* worker exited during auth resolution */ } };
        request.then(result => { authenticated = true; observe('authenticated'); reply({ result }); }, error => reply({ errorCode: authErrorCode(error) })).finally(() => { outstandingAuth--; });
      });
      let output = '';
      let reason;
      let escalation;
      const stop = message => {
        if (reason) return;
        reason = message;
        authController.abort();
        killGroup(child, 'SIGTERM');
        escalation = setTimeout(() => killGroup(child, 'SIGKILL'), 250);
      };
      const abort = () => stop('Operation cancelled');
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const timeout = setTimeout(() => stop('Operation timed out'), agent.config.timeoutMs ?? 120000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (Buffer.byteLength(output) + Buffer.byteLength(chunk) > LIMIT) stop('Operation output exceeded limit');
        else output += chunk.toString('utf8');
      });
      child.stdin.on('error', () => {}); // Early worker exit is mapped below, never an unhandled EPIPE.
      child.on('error', () => { reason = 'Pi execution could not start'; });
      child.on('close', code => {
        authController.abort();
        clearTimeout(timeout);
        clearTimeout(escalation);
        signal?.removeEventListener('abort', abort);
        // Also reap same-group descendants left after a successful worker exit.
        killGroup(child, 'SIGKILL');
        if (reason) return resolveResult(textResult(reason, true));
        try {
          const result = JSON.parse(output);
          if (agent.config.auth && result.ok !== true) return resolveResult(textResult(Object.hasOwn(AUTH_ERRORS, result.errorCode) ? AUTH_ERRORS[result.errorCode] : AUTH_ERRORS['auth-execution-failed'], true));
          if (code !== 0 || result.ok !== true || typeof result.text !== 'string') throw new Error();
          if (authenticated) observe('exercised');
          resolveResult(textResult(redact(result.text)));
        } catch { resolveResult(textResult('Pi execution failed', true)); }
      });
      child.stdin.end(payload);
    });
  } finally { rmSync(home, { recursive: true, force: true }); }
}

export async function serve(agentSource, { brokerOptions, workerPath } = {}) {
  if (process.platform === 'win32') throw new Error('MCP hosting currently requires POSIX process-group cleanup');
  const agent = loadAgent(agentSource, brokerOptions);
  const server = new Server({ name: 'faur-agent', version: '1.0.0' }, { capabilities: { tools: {} } });
  let active;
  let shuttingDown = false;
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: agent.config.operations.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (shuttingDown || active) return textResult('Server busy; retry after the active call finishes', true);
    const controller = new AbortController();
    const abort = () => controller.abort();
    extra.signal.addEventListener('abort', abort, { once: true });
    if (extra.signal.aborted) abort();
    const call = invoke(agent, request.params.name, request.params.arguments ?? {}, controller.signal, { workerPath });
    active = { controller, call };
    try { return await call; }
    finally { active = undefined; extra.signal.removeEventListener('abort', abort); }
  });
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    active?.controller.abort();
    if (active) await active.call;
    // Invocation cleanup stays bounded; refresh/persistence belongs to this
    // trusted host and must drain before a graceful host exit.
    await agent.authBroker?.close();
    await server.close();
  }
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.stdin.once('end', shutdown);
  process.stdin.once('close', shutdown);
  process.stdout.once('error', shutdown);
  const transport = new StdioServerTransport();
  server.onclose = shutdown;
  await server.connect(transport);
}

/** Explicit local auth check. Metadata by default; --resolve may refresh OAuth,
 * but never logs in or makes a model request. Output is whitelisted metadata.
 */
export async function checkAuthentication(agentSource, { resolveAuth = false } = {}) {
  const agent = loadAgent(agentSource);
  if (!agent.authBroker) return { mode: 'isolated-api-key', configured: true, authenticated: 'not checked', exercised: 'not checked' };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
  const config = mcpConfig({ mcpServer: agent.config, orchestrator: { model: agent.model, thinking: agent.thinking } });
  try {
    const status = await agent.authBroker.inspect();
    if (status.catalog === 'resolvable') recordMcpAuthEvidence(agent.source, config, process.env, 'catalog');
    if (resolveAuth && !status.errorCode) {
      try {
        await agent.authBroker.resolve(controller.signal);
        status.authenticated = 'resolved locally; provider/model acceptance not exercised';
        recordMcpAuthEvidence(agent.source, config, process.env, 'authenticated');
      } catch (error) { status.errorCode = authErrorCode(error); status.fix = AUTH_ERRORS[status.errorCode]; }
    }
    return { mode: 'pi-subscription', ...status };
  } finally {
    await agent.authBroker.close();
    process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
  }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  // Installed entry point: <source>/.faur-mcp/faur/mcp/host.mjs.
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const run = process.argv[2] === '--check-auth'
    ? checkAuthentication(source, { resolveAuth: process.argv[3] === '--resolve' }).then(status => { process.stdout.write(`${JSON.stringify(status)}\n`); if (status.errorCode) process.exitCode = 1; })
    : serve(source);
  run.catch(() => { process.stderr.write('Faur MCP startup failed; check installation, target root and generated configuration.\n'); process.exitCode = 1; });
}
