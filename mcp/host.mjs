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

const textResult = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });
const LIMIT = 1024 * 1024;

/** Capture config and authored prompt once: a restart is the update boundary. */
export function loadAgent(agentSource) {
  const source = realpathSync(agentSource);
  const { model, thinking, ...config } = JSON.parse(readFileSync(join(source, '.faur-mcp/config.json'), 'utf8'));
  const errors = mcpServerErrors(config);
  if (errors.length || typeof model !== 'string' || !model.includes('/')) throw new Error('Invalid MCP configuration; regenerate with Faur');
  const target = realpathSync(resolve(source, config.projectRoot));
  if (!statSync(target).isDirectory()) throw new Error('Target project root is not a directory');
  const nativePrompt = readFileSync(join(source, '.pi/APPEND_SYSTEM.md'), 'utf8');
  const prompt = nativePrompt.split('<!-- faur:derived v1 begin:')[0].replace(/^<!-- faur:generated v1 sha256=[a-f0-9]{64} -->\n/, '').trim();
  return { source, target, model, thinking, prompt, config, validators: new Map(config.operations.map(op => [op.name, operationValidator(op.inputSchema)])) };
}

function killGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

/** One path for every operation, including validation, cleanup and result mapping.
 * workerPath is an internal test seam, never part of public configuration.
 */
export async function invoke(agent, name, input, signal, { workerPath = new URL('./worker.mjs', import.meta.url) } = {}) {
  const operation = agent.config.operations.find(op => op.name === name);
  if (!operation) return textResult('Unknown public operation', true);
  if (!agent.validators.get(name)(input)) return textResult('Invalid operation input (does not match inputSchema)', true);
  if (signal?.aborted) return textResult('Operation cancelled', true);
  const payload = JSON.stringify({ target: agent.target, model: agent.model, thinking: agent.thinking, systemPrompt: agent.prompt, tools: agent.config.tools, prompt: `${operation.prompt}\n\nOperation arguments (JSON data):\n${JSON.stringify(input)}` });
  if (Buffer.byteLength(payload) > LIMIT) return textResult('Operation input exceeded limit', true);
  const home = mkdtempSync(join(tmpdir(), 'faur-mcp-'));
  const env = { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, PI_CODING_AGENT_DIR: home, PI_OFFLINE: '1', LANG: 'C.UTF-8' };
  for (const key of agent.config.env ?? []) {
    if (!process.env[key]) { rmSync(home, { recursive: true, force: true }); return textResult(`Missing required environment variable: ${key}`, true); }
    env[key] = process.env[key];
  }
  const redact = text => Object.keys(env).filter(key => (agent.config.env ?? []).includes(key)).reduce((value, key) => value.split(env[key]).join('[REDACTED]'), text);
  try {
    return await new Promise(resolveResult => {
      const child = spawn(process.execPath, [fileURLToPath(workerPath)], { cwd: agent.target, env, detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
      let output = '';
      let reason;
      let escalation;
      const stop = message => {
        if (reason) return;
        reason = message;
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
        clearTimeout(timeout);
        clearTimeout(escalation);
        signal?.removeEventListener('abort', abort);
        // Also reap same-group descendants left after a successful worker exit.
        killGroup(child, 'SIGKILL');
        if (reason) return resolveResult(textResult(reason, true));
        try {
          const result = JSON.parse(output);
          if (code !== 0 || result.ok !== true || typeof result.text !== 'string') throw new Error();
          resolveResult(textResult(redact(result.text)));
        } catch { resolveResult(textResult('Pi execution failed', true)); }
      });
      child.stdin.end(payload);
    });
  } finally { rmSync(home, { recursive: true, force: true }); }
}

export async function serve(agentSource) {
  if (process.platform === 'win32') throw new Error('MCP hosting currently requires POSIX process-group cleanup');
  const agent = loadAgent(agentSource);
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
    const call = invoke(agent, request.params.name, request.params.arguments ?? {}, controller.signal);
    active = { controller, call };
    try { return await call; }
    finally { active = undefined; extra.signal.removeEventListener('abort', abort); }
  });
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    active?.controller.abort();
    if (active) await active.call;
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

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  // Installed entry point: <source>/.faur-mcp/faur/mcp/host.mjs.
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  serve(source).catch(() => { process.stderr.write('Faur MCP startup failed; check installation, target root and generated configuration.\n'); process.exitCode = 1; });
}
