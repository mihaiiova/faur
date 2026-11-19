import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { generateProject } from '../src/generate.mjs';
import { loadYaml } from '../src/yaml-loader.mjs';
import { mcpConfig, mcpHostingStatus, recordMcpAuthEvidence } from '../src/mcp-auth-status.mjs';
import { planChange, approvalPreview, approvalSummary } from '../src/maintenance.mjs';
import { nativeProject, eventsAt } from './helpers/mcp-native-project.mjs';
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
  const oldFingerprint = createHash('sha256').update(JSON.stringify([mcpConfig(design), env.JARED_PI_AUTH_FILE])).digest('hex');
  writeFileSync(join(root, '.faur-mcp/auth-evidence.json'), JSON.stringify({ fingerprint: oldFingerprint, authenticatedAt: new Date().toISOString() }));
  assert.equal(mcpHostingStatus(root, design, { env }).authenticated, 'not verified', 'old broker evidence cannot attest direct native trust');
  recordMcpAuthEvidence(root, mcpConfig(design), env, 'authenticated');
  const resolved = mcpHostingStatus(root, design, { env });
  assert.match(resolved.authenticated, /last resolved locally/); assert.equal(resolved.exercised, 'not verified');
  recordMcpAuthEvidence(root, mcpConfig(design), env, 'exercised');
  assert.match(mcpHostingStatus(root, design, { env }).exercised, /last successful model invocation/);
  assert.equal(mcpHostingStatus(root, design, { env: {} }).authenticated, 'not verified', 'different source has no reusable attestation');
  const evidence = readFileSync(join(root, '.faur-mcp/auth-evidence.json'), 'utf8');
  assert.doesNotMatch(evidence, /nonexistent|credential\/store|access|refresh/);
});


test('explicit authentication metadata checks resolve source models.json without refresh or global model discovery', { skip: process.env.RUN_FAUR_MCP_TEST !== '1', timeout: 180000 }, async t => {
  const { source, home, runtimeDir } = nativeProject(t, { subscription: true });
  const authPath = join(home, 'auth.json');
  writeFileSync(authPath, JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'fixture-custom-access', refresh: 'fixture-custom-refresh', expires: 0 } }), { mode: 0o600 });
  const previous = process.env.FIXTURE_AUTH_FILE;
  process.env.FIXTURE_AUTH_FILE = authPath;
  t.after(() => { if (previous === undefined) delete process.env.FIXTURE_AUTH_FILE; else process.env.FIXTURE_AUTH_FILE = previous; });
  const configPath = join(runtimeDir, 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.model = 'openai-codex/source-only-auth-test';
  writeFileSync(configPath, JSON.stringify(config));
  const modelsPath = join(source, '.pi/models.json');
  writeFileSync(modelsPath, JSON.stringify({ providers: { 'openai-codex': { models: [{ id: 'source-only-auth-test', name: 'Source-only auth metadata fixture', reasoning: false, input: ['text'] }] } } }));
  const before = readFileSync(authPath, 'utf8');
  const { checkAuthentication } = await import(pathToFileURL(join(runtimeDir, 'faur/mcp/host.mjs')));
  const status = await checkAuthentication(source);
  assert.equal(status.errorCode, undefined, JSON.stringify(status));
  assert.equal(status.catalog, 'resolvable');
  assert.match(status.login, /expired/);
  assert.equal(status.authenticated, 'not checked');
  assert.equal(readFileSync(authPath, 'utf8'), before, 'metadata neither refreshes nor mutates the selected store');
  rmSync(modelsPath);
  assert.equal((await checkAuthentication(source)).errorCode, 'auth-catalog-incompatible', 'source-only model is not silently resolved from ambient catalogs');
});

test('generated native lead and real specialist directly use the selected fake store, native locking/refresh and no API fallback', { skip: process.env.RUN_FAUR_MCP_TEST !== '1', timeout: 240000 }, async t => {
  const { source, target, second, home, runtimeDir, toolchainPath } = nativeProject(t, { subscription: true });
  const authPath = join(home, 'auth.json');
  const unrelated = { type: 'oauth', access: 'UNRELATED_FAKE_ACCESS', refresh: 'UNRELATED_FAKE_REFRESH', expires: Date.now() + 3600000 };
  const reset = expires => { writeFileSync(authPath, JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'fixture-access-fresh', refresh: 'fixture-refresh-fresh', expires }, 'fixture-unrelated': unrelated }), { mode: 0o600 }); chmodSync(authPath, 0o600); };
  let refreshes = 0, failRefresh = false;
  const http = createServer(async (req, res) => {
    let input = ''; for await (const chunk of req) input += chunk;
    assert.equal(JSON.parse(input).refresh, 'fixture-refresh-fresh');
    refreshes++;
    await new Promise(resolve => setTimeout(resolve, 100));
    res.writeHead(failRefresh ? 400 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(failRefresh ? { error: 'PRIVATE_FAKE_REFRESH_ERROR' } : { type: 'oauth', access: 'fixture-access-rotated', refresh: 'fixture-refresh-rotated', expires: Date.now() + 3600000 }));
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  t.after(async () => { http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); });
  const before = Object.fromEntries(['FIXTURE_AUTH_FILE', 'FIXTURE_REFRESH_URL', 'OPENAI_API_KEY', 'PATH'].map(key => [key, process.env[key]]));
  process.env.PATH = toolchainPath;
  process.env.FIXTURE_AUTH_FILE = authPath;
  process.env.FIXTURE_REFRESH_URL = `http://127.0.0.1:${http.address().port}`;
  process.env.OPENAI_API_KEY = 'AMBIENT_BILLED_KEY_MUST_NOT_BE_USED';
  t.after(() => { for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const { invoke, loadAgent, checkAuthentication } = await import(pathToFileURL(join(runtimeDir, 'faur/mcp/host.mjs')));
  const agent = loadAgent(source);
  reset(0);
  const metadata = await checkAuthentication(source);
  assert.equal(metadata.catalog, 'resolvable'); assert.match(metadata.login, /expired/);
  assert.equal(metadata.authenticated, 'not checked'); assert.equal(refreshes, 0, 'metadata never refreshes');
  const other = { ...agent, target: second };
  const results = await Promise.all([invoke(agent, 'execute', {}), invoke(other, 'execute', {})]);
  for (const result of results) {
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.content[0].text, 'lead done');
    assert.doesNotMatch(JSON.stringify(result), /fixture-access|fixture-refresh|UNRELATED|BILLED|PRIVATE/);
  }
  assert.equal(refreshes, 1, 'concurrent native workers/children share the resolved auth-file lock');
  const stored = JSON.parse(readFileSync(authPath, 'utf8'));
  assert.equal(stored['openai-codex'].refresh, 'fixture-refresh-rotated'); assert.deepEqual(stored['fixture-unrelated'], unrelated);
  for (const workspace of [target, second]) {
    const events = eventsAt(workspace);
    assert.ok(events.some(event => event.child && event.authenticated === true), JSON.stringify(events.map(e => ({child:e.child,authenticated:e.authenticated,last:e.context?.messages?.at(-1)}))).slice(-7000));
    assert.ok(events.some(event => !event.child && event.authenticated === true));
    for (const startup of events.filter(event => event.startup)) {
      assert.equal(startup.selectedStore, authPath, 'lead/child native directory points directly to the explicitly selected store');
      assert.equal(startup.directStoreAccess, true, 'trusted code can access other entries: no broker secrecy claim');
      assert.equal(startup.selectorEnvVisible, false);
    }
    assert.doesNotMatch(JSON.stringify(events.filter(event => event.context)), /fixture-access|fixture-refresh|UNRELATED_FAKE|AMBIENT_BILLED/);
  }
  const status = mcpHostingStatus(source, { ...model(), ...{ mcpServer: agent.config, orchestrator: { model: agent.model, thinking: agent.thinking } } }, { env: process.env });
  assert.match(status.trust, /directly available/);
  // Native no-fallback errors are checked on a fresh call each time.
  delete process.env.FIXTURE_AUTH_FILE;
  assert.match((await invoke(agent, 'execute', {})).content[0].text, /authFileEnv/);
  process.env.FIXTURE_AUTH_FILE = authPath;
  chmodSync(authPath, 0o644);
  assert.match((await invoke(agent, 'execute', {})).content[0].text, /not private/);
  reset(Date.now() + 3600000);
  const resolved = await checkAuthentication(source, { resolveAuth: true });
  assert.match(resolved.authenticated, /resolved locally/);
  assert.equal(resolved.exercised, 'not checked');
  writeFileSync(authPath, JSON.stringify({ 'fixture-unrelated': unrelated }));
  assert.match((await invoke(agent, 'execute', {})).content[0].text, /login is required/);
  writeFileSync(authPath, JSON.stringify({ 'openai-codex': { type: 'api_key', key: 'FORBIDDEN_BILLED_KEY' } }));
  assert.match((await invoke(agent, 'execute', {})).content[0].text, /login is required/, 'selected API key cannot substitute for an OAuth login');
  reset(0); failRefresh = true;
  const bytes = readFileSync(authPath, 'utf8');
  const failed = await invoke(agent, 'execute', {});
  assert.equal(failed.isError, true); assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_FAKE|fixture-refresh|AMBIENT_BILLED/);
  assert.equal(readFileSync(authPath, 'utf8'), bytes, 'failed refresh preserves native credentials');
});
