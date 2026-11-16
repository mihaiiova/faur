import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { generateProject } from '../src/generate.mjs';
import { loadYaml } from '../src/yaml-loader.mjs';
import { mcpConfig, mcpHostingStatus, recordMcpAuthEvidence } from '../src/mcp-auth-status.mjs';
import { planChange, approvalPreview, approvalSummary } from '../src/maintenance.mjs';
import { checkProject } from '../src/check.mjs';

const model = () => loadYaml().parse(readFileSync(new URL('./fixtures/generate/mcp-subscription/.pi/system.yaml', import.meta.url), 'utf8'));
function materialize(root, design) {
  for (const file of generateProject(design).files) { mkdirSync(dirname(join(root, file.path)), { recursive: true }); writeFileSync(join(root, file.path), file.content); }
  writeFileSync(join(root, '.pi/system.yaml'), loadYaml().stringify(design));
}

test('auth declaration, preview and capability history contain metadata, never credentials or automatic auth checks', t => {
  const root = mkdtempSync(join(tmpdir(), 'faur-auth-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const design = model(), plain = structuredClone(design); delete plain.mcpServer.auth;
  const generated = generateProject(design);
  for (const path of ['.faur-mcp/config.json', '.faur-mcp/README.md']) assert.equal(generated.files.find(file => file.path === path).content, readFileSync(new URL(`./fixtures/generate/mcp-subscription/golden/${path}`, import.meta.url), 'utf8'), `golden mismatch: ${path}`);
  materialize(root, plain);
  const plan = planChange(root, [{ op: 'set', target: 'mcpServer', value: design.mcpServer }]);
  assert.match(approvalPreview(root, plan), /pi-subscription/);
  assert.match(approvalSummary(root, plan).join('\n'), /shared Pi credential store/);
  materialize(root, design);
  const env = { JARED_PI_AUTH_FILE: '/a/nonexistent/private/credential/store' };
  const fresh = mcpHostingStatus(root, design, { env });
  assert.equal(fresh.configured, true); assert.equal(fresh.sourceConfigured, true);
  assert.equal(fresh.authenticated, 'not verified'); assert.equal(fresh.exercised, 'not verified');
  assert.equal(checkProject(root, { env, runSetupChecks: false }).mcpHosting.authenticated, 'not verified');
  recordMcpAuthEvidence(root, mcpConfig(design), env, 'authenticated');
  const resolved = mcpHostingStatus(root, design, { env });
  assert.match(resolved.authenticated, /last resolved locally/); assert.equal(resolved.exercised, 'not verified');
  recordMcpAuthEvidence(root, mcpConfig(design), env, 'exercised');
  assert.match(mcpHostingStatus(root, design, { env }).exercised, /last successful model invocation/);
  assert.equal(mcpHostingStatus(root, design, { env: {} }).authenticated, 'not verified', 'different source has no reusable attestation');
  const evidence = readFileSync(join(root, '.faur-mcp/auth-evidence.json'), 'utf8');
  assert.doesNotMatch(evidence, /nonexistent|credential\/store|access|refresh/);
});

test('native broker, independent generated worker and cross-process refresh use fake-only credentials', { skip: process.env.RUN_FAUR_MCP_TEST !== '1', timeout: 240000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'faur subscription with spaces '));
  const source = join(root, 'project/.agents/jared'), runtimeDir = join(source, '.faur-mcp');
  const home = join(root, 'pi-home'); mkdirSync(home);
  const authPath = join(home, 'auth.json');
  const unrelated = { type: 'oauth', access: 'UNRELATED_ACCESS_MUST_NOT_LEAK', refresh: 'UNRELATED_REFRESH_MUST_NOT_LEAK', expires: Date.now() + 3600000 };
  const login = expires => ({ type: 'oauth', access: 'fixture-access-fresh', refresh: 'fixture-refresh-fresh', expires });
  const reset = expires => { writeFileSync(authPath, JSON.stringify({ 'openai-codex': login(expires), 'fixture-unrelated': unrelated }), { mode: 0o600 }); chmodSync(authPath, 0o600); };
  let refreshes = 0, refreshFailure = false, releaseRefresh;
  const http = createServer(async (req, res) => {
    let input = ''; for await (const chunk of req) input += chunk;
    assert.equal(JSON.parse(input).refresh, 'fixture-refresh-fresh');
    refreshes++;
    if (releaseRefresh) await releaseRefresh.promise;
    res.writeHead(refreshFailure ? 400 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(refreshFailure ? { privateDiagnostic: 'DO_NOT_LEAK_REFRESH_ERROR' } : { type: 'oauth', access: 'fixture-access-rotated', refresh: 'fixture-refresh-rotated', expires: Date.now() + 3600000 }));
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  const children = new Set();
  t.after(async () => { for (const child of children) child.kill('SIGKILL'); http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  const design = model(); materialize(source, design);
  mkdirSync(join(root, 'project/.pi/extensions'), { recursive: true });
  writeFileSync(join(root, 'project/AGENTS.md'), 'PARENT_PRIVATE_INSTRUCTIONS');
  writeFileSync(join(root, 'project/.pi/extensions/poison.ts'), 'throw new Error("GLOBAL_POISON");');
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ extensions: ['GLOBAL_POISON'], defaultTools: ['write', 'bash'] }));
  writeFileSync(join(home, 'models.json'), JSON.stringify({ providers: { 'openai-codex': { models: [{ id: 'global-only-model', name: 'must not load' }] } } }));
  const installed = spawnSync('npm', ['ci', '--ignore-scripts'], { cwd: runtimeDir, encoding: 'utf8', timeout: 120000 });
  assert.equal(installed.status, 0, installed.stderr);
  for (const name of ['subscription-sdk.mjs', 'subscription-driver.mjs', 'subscription-worker.mjs', 'subscription-cli.mjs', 'subscription-server.mjs']) writeFileSync(join(runtimeDir, name), readFileSync(new URL(`./fixtures/mcp/${name}`, import.meta.url)));
  const env = { PATH: '/usr/bin:/bin', HOME: home, PI_CODING_AGENT_DIR: home, PI_OFFLINE: '1', JARED_PI_AUTH_FILE: authPath, FIXTURE_REFRESH_URL: `http://127.0.0.1:${http.address().port}`, DEVELOPER_ONLY_SECRET: 'DO_NOT_LEAK_AMBIENT', OPENAI_API_KEY: 'DO_NOT_USE_BILLED_KEY' };
  const cliHome = join(home, 'cli-home'); mkdirSync(cliHome); symlinkSync(authPath, join(cliHome, 'auth.json'));
  function run(mode, overrides = {}) {
    const cli = mode === 'cli';
    const args = cli ? [join(runtimeDir, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), '--no-extensions', '-e', join(runtimeDir, 'subscription-cli.mjs'), '--approve', '--no-session', '--model', 'openai-codex/gpt-6-sol', '-p', '/fixture-auth'] : [join(runtimeDir, 'subscription-driver.mjs'), mode];
    const child = spawn(process.execPath, args, { cwd: runtimeDir, env: { ...env, ...(cli ? { HOME: cliHome, PI_CODING_AGENT_DIR: cliHome } : {}), ...overrides }, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    if (cli) child.stdin.end();
    children.add(child);
    let stdout = '', stderr = ''; const events = [];
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('message', event => events.push(event));
    const result = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => { children.delete(child); try { assert.equal(code, 0, stderr); const output = cli ? stderr.split('\n').find(line => line.startsWith('{"ok":')) : stdout; assert.ok(output?.trim(), `fixture ${mode} produced no output: ${stderr}`); resolve({ value: JSON.parse(output), stdout, stderr }); } catch (error) { reject(error); } });
    });
    return { child, result, events };
  }
  async function until(predicate) { const deadline = Date.now() + 15000; while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(predicate(), 'fixture event reached deadline'); }

  await t.test('metadata distinguishes configured/login presence from resolved and exercised', async () => {
    reset(0); const result = await run('inspect').result;
    assert.equal(result.value.catalog, 'resolvable'); assert.match(result.value.login, /expired/);
    assert.equal(result.value.authenticated, 'not checked'); assert.equal(result.value.exercised, 'not checked');
    assert.equal(refreshes, 0, 'metadata does not refresh');
    const real = await run('check-real').result;
    assert.equal(real.value.mode, 'pi-subscription'); assert.equal(real.value.catalog, 'resolvable');
    reset(Date.now() + 3600000);
    const resolved = await run('check-real-resolve').result;
    assert.match(resolved.value.authenticated, /resolved locally/); assert.equal(resolved.value.exercised, 'not checked');
    assert.equal(refreshes, 0);
  });
  await t.test('missing/private/provider/catalog errors are sanitized and never fall back to API billing', async () => {
    reset(Date.now() + 3600000);
    const absent = await run('invoke', { JARED_PI_AUTH_FILE: '' }).result;
    assert.equal(absent.value.isError, true); assert.match(absent.value.content[0].text, /authFileEnv/);
    writeFileSync(authPath, JSON.stringify({ 'fixture-unrelated': unrelated }));
    assert.match((await run('invoke').result).value.content[0].text, /login is required/);
    reset(Date.now() + 3600000); chmodSync(authPath, 0o644);
    assert.match((await run('invoke').result).value.content[0].text, /not private/);
    chmodSync(authPath, 0o600);
    const incompatible = await run('resolve', { FIXTURE_MODEL: 'openai-codex/global-only-model', JARED_PI_AUTH_FILE: '' }).result;
    assert.equal(incompatible.value.errorCode, 'auth-catalog-incompatible', 'catalog rejected before source access');
    assert.equal(refreshes, 0);
  });
  await t.test('fresh auth reaches real isolated Pi only through private IPC; final output/evidence never contains credentials', async () => {
    reset(Date.now() + 3600000);
    const result = await run('invoke').result;
    assert.equal(result.value.isError, undefined, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-access|fixture-refresh|UNRELATED_|DO_NOT_LEAK|DO_NOT_USE_BILLED/);
    assert.match(result.value.content[0].text, /REDACTED/);
    const answer = JSON.parse(result.value.content[0].text);
    assert.equal(answer.isolation.subscriptionBearerUsed, true);
    assert.equal(answer.isolation.sourceVisible, false); assert.equal(answer.isolation.ambientVisible, false);
    assert.equal(answer.isolation.privateInstructionsVisible, false);
    assert.equal(answer.isolation.credentialInPrompt, false);
    assert.deepEqual(answer.isolation.tools, ['read']);
    const status = mcpHostingStatus(source, design, { env });
    assert.match(status.authenticated, /last resolved locally/); assert.match(status.exercised, /last successful model invocation/);
    assert.equal(refreshes, 0);
    for (const file of generateProject(design).files) assert.doesNotMatch(readFileSync(join(source, file.path), 'utf8'), /fixture-access|fixture-refresh|UNRELATED_ACCESS_MUST_NOT_LEAK|DO_NOT_USE_BILLED_KEY/);
  });
  await t.test('real stdio MCP lists/invokes subscription operations without exposing auth over the protocol', async () => {
    reset(Date.now() + 3600000);
    const { Client } = await import(pathToFileURL(join(runtimeDir, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')));
    const { StdioClientTransport } = await import(pathToFileURL(join(runtimeDir, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')));
    const client = new Client({ name: 'subscription-fixture', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(runtimeDir, 'subscription-server.mjs')], cwd: tmpdir(), env, stderr: 'pipe' });
    let diagnostics = '';
    try {
      await client.connect(transport);
      transport.stderr?.on('data', chunk => { diagnostics += chunk; });
      assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['audit', 'review']);
      for (const name of ['audit', 'review']) {
        const result = await client.callTool({ name, arguments: { request: 'inspect' } });
        assert.equal(result.isError, undefined, JSON.stringify(result));
        assert.match(result.content[0].text, /REDACTED/);
        assert.doesNotMatch(JSON.stringify(result), /fixture-access|fixture-refresh|UNRELATED_|DO_NOT_LEAK/);
      }
    } finally { await client.close(); }
    assert.doesNotMatch(diagnostics, /fixture-access|fixture-refresh|UNRELATED_|DO_NOT_LEAK/);
  });

  await t.test('normal Pi CLI, SDK client and multiple brokers share native auth-file locks, including symlink aliases', async () => {
    reset(0); refreshes = 0;
    const alias = join(home, 'auth-alias.json'); symlinkSync(authPath, alias);
    let release; releaseRefresh = { promise: new Promise(resolve => { release = resolve; }) };
    const clients = [run('resolve'), run('native-resolve'), run('resolve', { JARED_PI_AUTH_FILE: alias }), run('cli')];
    await until(() => refreshes === 1); await new Promise(resolve => setTimeout(resolve, 300)); release();
    const results = await Promise.all(clients.map(client => client.result));
    for (const result of results) assert.equal(result.value.ok, true, JSON.stringify(result));
    assert.equal(refreshes, 1); releaseRefresh = undefined;
    const stored = JSON.parse(readFileSync(authPath, 'utf8'));
    assert.equal(stored['openai-codex'].refresh, 'fixture-refresh-rotated'); assert.deepEqual(stored['fixture-unrelated'], unrelated);
  });
  await t.test('failed expired-login refresh preserves credentials and returns no raw diagnostics', async () => {
    reset(0); refreshes = 0; refreshFailure = true;
    const before = readFileSync(authPath, 'utf8');
    const result = await run('invoke').result;
    assert.equal(result.value.isError, true); assert.match(result.value.content[0].text, /refresh failed/);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_REFRESH|DO_NOT_LEAK_REFRESH|fixture-refresh|UNRELATED_/);
    assert.equal(readFileSync(authPath, 'utf8'), before); refreshFailure = false;
  });
  for (const ending of ['cancel', 'timeout']) await t.test(`${ending} ends the invocation while refresh is pending; graceful broker close waits for persisted rotation`, async () => {
    reset(0); refreshes = 0;
    let release; releaseRefresh = { promise: new Promise(resolve => { release = resolve; }) };
    const invocation = run('invoke');
    await until(() => invocation.events.some(event => event.event === 'refresh-started'));
    if (ending === 'cancel') invocation.child.send('cancel');
    await until(() => invocation.events.some(event => event.event === 'invocation-returned'));
    assert.equal(JSON.parse(readFileSync(authPath, 'utf8'))['openai-codex'].refresh, 'fixture-refresh-fresh');
    assert.equal(children.has(invocation.child), true, 'host remains alive to finish refresh');
    release();
    const result = await invocation.result;
    assert.match(result.value.content[0].text, ending === 'cancel' ? /cancelled/ : /timed out/);
    assert.equal(JSON.parse(readFileSync(authPath, 'utf8'))['openai-codex'].refresh, 'fixture-refresh-rotated');
    assert.deepEqual(JSON.parse(readFileSync(authPath, 'utf8'))['fixture-unrelated'], unrelated);
    releaseRefresh = undefined;
  });
});
