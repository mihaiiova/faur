import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { generateProject, managedPaths } from '../src/generate.mjs';
import { validateSystem } from '../src/validate.mjs';
import { changeModel } from '../src/changes.mjs';
import { planChange, applyChange, approvalPreview } from '../src/maintenance.mjs';
import { installMcp } from './helpers/mcp-install.mjs';
import { loadYaml } from '../src/yaml-loader.mjs';

const operation = (name, prompt = `${name} the project`) => ({ name, description: `Public ${name}`, inputSchema: { type: 'object', properties: { request: { type: 'string' } }, required: ['request'], additionalProperties: false }, prompt });
const design = () => loadYaml().parse(readFileSync(new URL('./fixtures/generate/mcp-server/.pi/system.yaml', import.meta.url), 'utf8'));
function materialize(root, model) {
  mkdirSync(join(root, '.pi'), { recursive: true });
  writeFileSync(join(root, '.pi/system.yaml'), loadYaml().stringify(model));
  for (const file of generateProject(model).files) {
    mkdirSync(dirname(join(root, file.path)), { recursive: true });
    writeFileSync(join(root, file.path), file.content);
  }
}

test('public MCP declaration is strict, explicit and validates full JSON Schema', () => {
  assert.deepEqual(validateSystem(design()), { ok: true, errors: [] });
  const toolchain = design(); toolchain.mcpServer.env = ['PATH'];
  assert.equal(validateSystem(toolchain).ok, true, 'explicit native toolchain PATH grant');
  for (const mutate of [
    m => { m.mcpServer.tools = []; },
    m => { m.mcpServer.tools = ['subagent']; },
    m => { m.mcpServer.env = ['NODE_OPTIONS']; },
    m => { m.mcpServer.operations.push(operation('audit')); },
    m => { m.mcpServer.operations[0].inputSchema.properties.request = { type: 'imaginary' }; },
    m => { m.mcpServer.operations[0].inputSchema.$ref = 'https://example.com/schema'; },
    m => { m.mcpServer.operations[0].command = 'sh'; },
    m => { m.mcpServer.timeoutMs = 0; },
    m => { delete m.mcpServer.projectRoot; },
  ]) {
    const model = design(); mutate(model);
    assert.equal(validateSystem(model).ok, false, JSON.stringify(model.mcpServer));
  }
});

test('subscription auth is explicit, Codex-only, provider-bound and never passes its source variable to tools', () => {
  const model = design();
  model.orchestrator.model = 'openai-codex/gpt-6-sol';
  model.mcpServer.env = [];
  model.mcpServer.auth = { mode: 'pi-subscription', provider: 'openai-codex', authFileEnv: 'JARED_PI_AUTH_FILE' };
  assert.deepEqual(validateSystem(model), { ok: true, errors: [] });
  for (const mutate of [
    m => { m.orchestrator.model = 'openai/gpt-6-sol'; },
    m => { m.orchestrator.model = 12; },
    m => { m.mcpServer.auth.provider = 'openai'; },
    m => { m.mcpServer.auth.mode = 'api-key'; },
    m => { m.mcpServer.auth.authFileEnv = 'HOME'; },
    m => { m.mcpServer.auth.authFileEnv = 'PATH'; },
    m => { m.mcpServer.auth.authFileEnv = '/tmp/auth.json'; },
    m => { m.mcpServer.auth.access = 'never-inline-a-token'; },
    m => { m.mcpServer.env = ['JARED_PI_AUTH_FILE']; },
  ]) {
    const invalid = structuredClone(model); mutate(invalid);
    assert.equal(validateSystem(invalid).ok, false);
  }
});

test('opt-in assets are self-contained, idempotent and edit-protected; minimal is unchanged', () => {
  const model = design();
  const minimal = { ...model }; delete minimal.mcpServer;
  assert.equal(generateProject(minimal).files.some(f => f.path.includes('faur-mcp')), false);
  const generated = generateProject(model);
  assert.deepEqual(generated.errors, []);
  const existing = Object.fromEntries(generated.files.map(f => [f.path, f.content]));
  assert.deepEqual([...managedPaths(model)].sort(), Object.keys(existing).sort());
  assert.ok(generateProject(model, existing).files.every(f => f.action === 'none'));
  assert.equal(JSON.parse(existing['.faur-mcp/package.json']).dependencies['@earendil-works/pi-coding-agent'], '1.5.2');
  assert.equal(JSON.parse(existing['.faur-mcp/package-lock.json']).lockfileVersion, 3);
  // Snapshot public output, not a second copy of canonical bundled library source.
  for (const path of ['.faur-mcp/config.json', '.faur-mcp/package.json', '.pi/extensions/faur-mcp.ts']) {
    assert.equal(existing[path], readFileSync(new URL(`./fixtures/generate/mcp-server/golden/${path}`, import.meta.url), 'utf8'), `golden mismatch: ${path}`);
  }
  assert.equal(Object.hasOwn(JSON.parse(existing['.faur-mcp/config.json']), 'tools'), false);
  existing['.faur-mcp/faur/mcp/host.mjs'] += '\n// authored edit\n';
  assert.equal(generateProject(model, existing).files.find(f => f.path === '.faur-mcp/faur/mcp/host.mjs').action, 'conflict');
  const updated = structuredClone(model.mcpServer); updated.operations[1].description = 'Revised review';
  const changed = changeModel(loadYaml().stringify(model), [{ op: 'set', target: 'mcpServer', value: updated }]);
  assert.equal(changed.model.mcpServer.operations[1].description, 'Revised review');
});

test('CLI first build is approvable; stale bundle removal is hash-protected and installed dependencies stay ignored', () => {
  const root = mkdtempSync(join(tmpdir(), 'faur-mcp-first-build-'));
  try {
    mkdirSync(join(root, '.pi'));
    const model = design();
    writeFileSync(join(root, '.pi/system.yaml'), loadYaml().stringify(model));
    const cli = resolve('src/faur.mjs');
    const generated = spawnSync(process.execPath, [cli, 'generate', root, '--yes'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(generated.status, 0, generated.stderr);
    assert.match(generated.stdout, /bundled Faur distribution/);
    assert.equal(existsSync(join(root, '.faur-mcp/faur/mcp/host.mjs')), true);
    const oldPath = '.faur-mcp/faur/src/retired-module.mjs';
    const oldContent = '// retired distribution asset\n';
    writeFileSync(join(root, oldPath), oldContent);
    const manifest = JSON.parse(readFileSync(join(root, '.faur-mcp/generated.json'), 'utf8'));
    manifest[oldPath] = createHash('sha256').update(oldContent).digest('hex');
    writeFileSync(join(root, '.faur-mcp/generated.json'), JSON.stringify(manifest));
    writeFileSync(join(root, oldPath), oldContent + '// edited\n');
    assert.throws(() => planChange(root, [{ op: 'reconcile' }]), /conflict/i);
    writeFileSync(join(root, oldPath), oldContent);
    const rebuild = planChange(root, [{ op: 'reconcile' }]);
    assert.equal(rebuild.writes[oldPath], null);
    assert.ok(approvalPreview(root, rebuild).length < 100000);
    applyChange(root, rebuild, true);
    assert.equal(existsSync(join(root, oldPath)), false);
    mkdirSync(join(root, '.faur-mcp/node_modules'), { recursive: true });
    writeFileSync(join(root, '.faur-mcp/node_modules/installed'), 'keep ignored');
    const removal = planChange(root, [{ op: 'set', target: 'mcpServer', value: null }]);
    assert.ok(approvalPreview(root, removal).length < 100000);
    applyChange(root, removal, true);
    assert.equal(existsSync(join(root, '.faur-mcp/faur/mcp/host.mjs')), false);
    assert.equal(readFileSync(join(root, '.faur-mcp/.gitignore'), 'utf8'), 'node_modules/\nauth-evidence.json\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('maintenance updates operation definitions through existing preview/apply and refuses native edits', () => {
  const root = mkdtempSync(join(tmpdir(), 'faur-mcp-maintain-'));
  try {
    const model = design(); materialize(root, model);
    const updated = structuredClone(model.mcpServer); updated.operations[0] = operation('audit', 'New audit behavior');
    const operations = [{ op: 'set', target: 'mcpServer', value: updated }];
    const plan = planChange(root, operations);
    assert.match(plan.writes['.faur-mcp/config.json'], /New audit behavior/);
    applyChange(root, plan, true);
    assert.match(readFileSync(join(root, '.faur-mcp/config.json'), 'utf8'), /New audit behavior/);
    writeFileSync(join(root, '.faur-mcp/config.json'), '{}');
    assert.throws(() => planChange(root, operations), /conflict/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('installed generated agent: real Pi, real stdio MCP, restart, cancellation and local maintenance (no paid provider)', { skip: process.env.RUN_FAUR_MCP_TEST !== '1', timeout: 240000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'faur independent project with spaces '));
  const source = join(root, '.agents/jared');
  const home = join(root, 'developer-home');
  const requests = [];
  let mode = 'answer';
  const http = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    if (mode === 'hang') { req.on('close', () => res.end()); return; }
    if (mode === 'error') { res.writeHead(400); res.end(JSON.stringify({ error: { message: 'PRIVATE_PROVIDER_ERROR' } })); return; }
    const answer = mode === 'echo' ? body : body.includes('New audit behavior') ? 'revised audit' : body.includes('review the project') ? 'review answer' : 'audit answer';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    if (mode === 'shell') {
      const command = `cd ${JSON.stringify(root)}; while :; do printf x >> shell-heartbeat; sleep 0.02; done`;
      const item = { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'bash', arguments: JSON.stringify({ command }), status: 'completed' };
      emit({ type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } });
      emit({ type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '', status: 'in_progress' } });
      emit({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: item.arguments });
      emit({ type: 'response.output_item.done', output_index: 0, item });
      emit({ type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
      res.end(); return;
    }
    const item = { id: 'msg_1', type: 'message', role: 'assistant', status: 'in_progress', content: [] };
    emit({ type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } });
    emit({ type: 'response.output_item.added', output_index: 0, item });
    emit({ type: 'response.content_part.added', item_id: 'msg_1', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    emit({ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: answer });
    const done = { ...item, status: 'completed', content: [{ type: 'output_text', text: answer, annotations: [] }] };
    emit({ type: 'response.output_item.done', output_index: 0, item: done });
    emit({ type: 'response.completed', response: { id: 'resp_1', status: mode === 'length' ? 'incomplete' : 'completed', ...(mode === 'length' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}), output: [done], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
    res.end();
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  let client;
  let transport;
  try {
    const model = design(); materialize(source, model);
    mkdirSync(home); mkdirSync(join(root, '.pi/extensions'), { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), 'PARENT_INSTRUCTIONS_MUST_NOT_LOAD');
    writeFileSync(join(root, '.pi/extensions/poison.ts'), 'throw new Error("DEVELOPER_EXTENSION_MUST_NOT_LOAD");');
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ defaultTools: ['write', 'bash'] }));
    installMcp(source);
    const localMaintenance = await import(pathToFileURL(join(source, '.faur-mcp/faur/src/maintenance.mjs')));
    const { invoke, loadAgent } = await import(pathToFileURL(join(source, '.faur-mcp/faur/mcp/host.mjs')));
    const workerPath = pathToFileURL(join(root, 'fixture-worker.mjs'));
    writeFileSync(workerPath, readFileSync(new URL('./fixtures/mcp/invocation-worker.mjs', import.meta.url)));
    const fixtureAgent = loadAgent(source);
    fixtureAgent.config.env = ['FAKE_CREDENTIAL', 'PATH'];
    process.env.FAKE_CREDENTIAL = 'fixture-sensitive-value';
    process.env.DEVELOPER_ONLY_TEST_VALUE = 'must-not-reach-child';
    try {
      const reported = await invoke(fixtureAgent, 'audit', { request: 'fixture-report' }, undefined, { workerPath });
      assert.doesNotMatch(reported.content[0].text, /fixture-sensitive-value|must-not-reach-child/);
      assert.match(reported.content[0].text, /REDACTED/);
      const report = JSON.parse(reported.content[0].text);
      assert.equal(report.cwd, source);
      assert.equal(report.tools, undefined, 'no redundant MCP tool reduction');
      assert.equal(report.env.DEVELOPER_ONLY_TEST_VALUE, undefined);
      assert.equal(report.env.NODE_OPTIONS, undefined);
      assert.ok(report.env.PATH.endsWith(`:${process.env.PATH}`), 'explicit non-secret PATH survives answer redaction after packaged Pi prefix');
      assert.equal(existsSync(report.env.HOME), false, 'per-call home removed');
      delete process.env.FAKE_CREDENTIAL;
      assert.match((await invoke(fixtureAgent, 'audit', { request: 'fixture-report' }, undefined, { workerPath })).content[0].text, /Missing required environment/);
      fixtureAgent.config.env = [];
      assert.match((await invoke(fixtureAgent, 'audit', { request: 'x'.repeat(1024 * 1024) }, undefined, { workerPath })).content[0].text, /input exceeded limit/);
      const malformed = await invoke(fixtureAgent, 'audit', { request: 'fixture-malformed' }, undefined, { workerPath });
      assert.equal(malformed.isError, true); assert.doesNotMatch(JSON.stringify(malformed), /PRIVATE_INVALID/);
      assert.match((await invoke(fixtureAgent, 'audit', { request: 'fixture-oversized' }, undefined, { workerPath })).content[0].text, /output exceeded limit/);
      fixtureAgent.config.timeoutMs = 10000;
      const abort = new AbortController();
      const pending = invoke(fixtureAgent, 'audit', { request: 'fixture-hang' }, abort.signal, { workerPath });
      const deadline = Date.now() + 5000;
      while (!existsSync(join(root, 'worker-ready')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(existsSync(join(root, 'worker-ready')), true);
      await new Promise(resolve => setTimeout(resolve, 100));
      abort.abort();
      assert.match((await pending).content[0].text, /cancelled/);
      const heartbeat = readFileSync(join(root, 'heartbeat'), 'utf8');
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(readFileSync(join(root, 'heartbeat'), 'utf8'), heartbeat, 'same-group descendant stopped');
    } finally { delete process.env.FAKE_CREDENTIAL; delete process.env.DEVELOPER_ONLY_TEST_VALUE; }
    // Imports and process launch resolve only from the independent generated directory.
    const { Client } = await import(pathToFileURL(join(source, '.faur-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')));
    const { StdioClientTransport } = await import(pathToFileURL(join(source, '.faur-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')));
    const env = { PATH: '/nonexistent', HOME: home, PI_CODING_AGENT_DIR: home, DEVELOPER_SECRET: 'DO_NOT_LEAK', NODE_OPTIONS: '', AZURE_OPENAI_API_KEY: 'fixture-key-not-a-credential', AZURE_OPENAI_BASE_URL: `http://127.0.0.1:${http.address().port}/v1` };
    async function connect() {
      client = new Client({ name: 'fixture', version: '1.0.0' });
      transport = new StdioClientTransport({ command: process.execPath, args: [join(source, '.faur-mcp/faur/mcp/host.mjs')], cwd: tmpdir(), env, stderr: 'pipe' });
      await client.connect(transport);
    }
    await connect();
    assert.deepEqual((await client.listTools()).tools.map(t => t.name), ['audit', 'review']);
    for (const name of ['audit', 'review']) {
      const result = await client.callTool({ name, arguments: { request: 'inspect' } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.match(result.content[0].text, new RegExp(`${name} answer`));
    }
    const count = requests.length;
    assert.equal((await client.callTool({ name: 'audit', arguments: { request: 42 } })).isError, true);
    assert.equal(requests.length, count);
    const serialized = JSON.stringify(requests);
    assert.match(serialized, /PARENT_INSTRUCTIONS_MUST_NOT_LOAD/, 'native ancestor context loads: no projectOnly isolation');
    assert.doesNotMatch(serialized, /DEVELOPER_EXTENSION|DO_NOT_LEAK|faur_plan/);
    assert.deepEqual(requests[0].tools.map(t => t.name), ['read', 'write', 'edit', 'ls', 'find', 'grep']);
    mode = 'length';
    const truncated = await client.callTool({ name: 'audit', arguments: { request: 'inspect' } });
    assert.equal(truncated.isError, true, 'incomplete HTTP response never returns truncated success');
    mode = 'error';
    const failed = await client.callTool({ name: 'audit', arguments: { request: 'inspect' } });
    assert.equal(failed.isError, true); assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_PROVIDER_ERROR/);
    mode = 'hang';
    const controller = new AbortController();
    const pending = client.callTool({ name: 'audit', arguments: { request: 'wait' } }, undefined, { signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal((await client.callTool({ name: 'review', arguments: { request: 'overlap' } })).isError, true);
    controller.abort(); await assert.rejects(pending);
    await new Promise(resolve => setTimeout(resolve, 500));
    mode = 'answer';
    assert.equal((await client.callTool({ name: 'review', arguments: { request: 'after cancellation' } })).isError, undefined);
    const updated = structuredClone(model.mcpServer);
    updated.operations[0] = { ...operation('audit', 'New audit behavior'), description: 'Updated public description' };
    localMaintenance.applyChange(source, localMaintenance.planChange(source, [{ op: 'set', target: 'mcpServer', value: updated }]), true);
    assert.equal((await client.listTools()).tools[0].description, 'Public audit');
    await client.close(); await connect();
    assert.equal((await client.listTools()).tools[0].description, 'Updated public description');
    assert.equal((await client.callTool({ name: 'audit', arguments: { request: 'inspect' } })).content[0].text, 'revised audit');
    updated.timeoutMs = 100;
    localMaintenance.applyChange(source, localMaintenance.planChange(source, [{ op: 'set', target: 'mcpServer', value: updated }]), true);
    await client.close(); await connect();
    mode = 'hang';
    const timed = await client.callTool({ name: 'audit', arguments: { request: 'wait' } });
    assert.equal(timed.isError, true); assert.match(timed.content[0].text, /timed out/);
    await client.close(); client = undefined;
    // Symlinked registration must start; EOF (without SIGTERM) cancels active Pi.
    const { spawn } = await import('node:child_process');
    symlinkSync(source, join(root, 'agent link'), 'dir');
    const raw = spawn(process.execPath, [join(root, 'agent link/.faur-mcp/faur/mcp/host.mjs')], { cwd: tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
    let rawOut = ''; raw.stdout.on('data', chunk => { rawOut += chunk; }); raw.stderr.resume();
    try {
      raw.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'eof-fixture', version: '1' } } }) + '\n');
      const readyBy = Date.now() + 5000;
      while (!rawOut.includes('serverInfo') && Date.now() < readyBy) await new Promise(resolve => setTimeout(resolve, 20));
      assert.match(rawOut, /serverInfo/, 'symlinked entry starts MCP');
    } finally { raw.stdin.end(); await once(raw, 'close'); }
    updated.timeoutMs = 30000;
    mode = 'shell';
    localMaintenance.applyChange(source, localMaintenance.planChange(source, [{ op: 'set', target: 'mcpServer', value: updated }]), true);
    const settingsPath = join(source, '.pi/settings.json');
    const nativeSettings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    writeFileSync(settingsPath, JSON.stringify({ ...nativeSettings, defaultTools: ['bash'] }));
    const disconnected = spawn(process.execPath, [join(root, 'agent link/.faur-mcp/faur/mcp/host.mjs')], { cwd: tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
    disconnected.stdout.resume(); disconnected.stderr.resume();
    try {
      const before = requests.length;
      disconnected.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'eof-fixture', version: '1' } } }) + '\n');
      disconnected.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      disconnected.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'audit', arguments: { request: 'wait' } } }) + '\n');
      const requestBy = Date.now() + 5000;
      while (!existsSync(join(root, 'shell-heartbeat')) && Date.now() < requestBy) await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(requests.length > before, 'Pi execution began before EOF');
      assert.equal(existsSync(join(root, 'shell-heartbeat')), true, 'real Pi bash tool started before EOF');
      const closed = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('host remained alive after stdin EOF')), 5000);
        disconnected.once('close', () => { clearTimeout(timeout); resolve(); });
      });
      disconnected.stdin.end(); await closed;
      assert.equal(disconnected.exitCode, 0);
      const heartbeat = readFileSync(join(root, 'shell-heartbeat'), 'utf8');
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(readFileSync(join(root, 'shell-heartbeat'), 'utf8'), heartbeat, 'Pi abort stopped its detached active shell group');
    } finally { if (disconnected.exitCode === null) disconnected.kill('SIGKILL'); }
    // A real Pi RPC maintenance session discovers the local /faur without global binaries.
    const pi = spawn(process.execPath, [join(source, '.faur-mcp/node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), '--approve', '--no-session', '--mode', 'rpc'], { cwd: source, env: { ...env, PATH: '/usr/bin:/bin', PI_OFFLINE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let stderr = ''; pi.stdout.on('data', c => { output += c; }); pi.stderr.on('data', c => { stderr += c; });
    pi.stdin.write(JSON.stringify({ id: 'commands', type: 'get_commands' }) + '\n');
    const deadline = Date.now() + 20000;
    while (!output.includes('commands') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    pi.kill('SIGTERM'); await once(pi, 'close');
    assert.match(output, /"name":"faur"/, `${output}\n${stderr}`);
    assert.doesNotMatch(stderr, /Failed to load extension/);
    assert.equal(existsSync(join(source, '.faur-mcp/node_modules/.bin/pi')), true);
  } finally {
    await client?.close();
    http.closeAllConnections(); await new Promise(resolve => http.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
