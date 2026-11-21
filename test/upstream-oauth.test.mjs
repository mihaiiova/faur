import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { Client } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

// Start at the persisted result of one operator sign-in. Only the loopback
// fixture can issue/accept these tokens; no browser, provider account or npm install.
test('two delegated Pi workers reuse one upstream grant and its rotated token', async t => {
  const source = mkdtempSync(join(tmpdir(), 'faur-oauth-test-'));
  t.after(() => rmSync(source, { recursive: true, force: true }));
  let base, refreshes = 0, calls = 0, unauthorized = 0;
  const upstream = createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.url.startsWith('/.well-known/oauth-protected-resource')) return json(200, { resource: `${base}/mcp`, authorization_servers: [base] });
    if (req.url.startsWith('/.well-known/oauth-authorization-server')) return json(200, { issuer: base, authorization_endpoint: base+'/authorize', token_endpoint: base+'/token', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] });
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.url === '/token' && new URLSearchParams(body).get('refresh_token') === 'old-grant') {
      refreshes++; return json(200, { access_token: 'rotated-access', refresh_token: 'new-grant', token_type: 'Bearer', expires_in: 3600 });
    }
    if (req.url === '/token') return json(400, { error: 'invalid_grant' });
    if (req.url !== '/mcp') return json(404, {});
    if (req.headers.authorization !== 'Bearer rotated-access') {
      unauthorized++; res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`); return json(401, {});
    }
    if (req.method !== 'POST') return json(405, {});
    const { id, method, params } = JSON.parse(body);
    if (id === undefined) { res.writeHead(202); return res.end(); }
    const result = method === 'initialize' ? { protocolVersion: params.protocolVersion, serverInfo: { name: 'local', version: '1' }, capabilities: { tools: {} } } : method === 'tools/list' ? { tools: [{ name: 'search', description: 'fixture', inputSchema: { type: 'object' } }] } : { content: [{ type: 'text', text: `found-${++calls} rotated-access` }] };
    json(200, { jsonrpc: '2.0', id, result });
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening'); base = `http://127.0.0.1:${upstream.address().port}`;
  t.after(() => upstream.close());
  const url = `${base}/mcp`, profile = join(source, '.local/state/faur/agents', createHash('sha256').update(source).digest('hex'), 'oauth'); mkdirSync(profile, { recursive: true, mode: 0o700 });
  const store = join(profile, 'mcp-auth.json');
  writeFileSync(store, JSON.stringify({ [url]: { serverUrl: url, tokens: { access_token: 'old-access', refresh_token: 'old-grant', token_type: 'Bearer' }, tokensExpireAt: 1 } }), { mode: 0o600 });
  mkdirSync(join(source, '.pi/extensions'), { recursive: true }); mkdirSync(join(source, '.faur-mcp'));
  writeFileSync(join(source, '.pi/mcp.json'), JSON.stringify({ mcpServers: { local: { url, exposure: 'direct', oauth: { clientId: 'fixture' } } } }));
  writeFileSync(join(source, '.pi/extensions/provider.ts'), `import {createFauxCore,fauxToolCall,fauxAssistantMessage} from '@earendil-works/pi-ai';
export default pi => { const faux=createFauxCore({api:'fixture',provider:'fixture',models:[{id:'test'}]}); let first=true;
pi.registerProvider('fixture',{baseUrl:'http://localhost:0',apiKey:'fake',api:'fixture',models:[{type:'chat',id:'test',name:'test',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:10000,maxTokens:500}],streamSimple(m,c,o){
const msg=first?fauxAssistantMessage([fauxToolCall('mcp__local__search',{})]):fauxAssistantMessage(JSON.stringify(c.messages.at(-1).content)+' '+process.env.PI_CODING_AGENT_DIR);first=false;faux.setResponses([msg]);return faux.streamSimple(m,c,o);}});};`);
  async function client(optIn) {
    writeFileSync(join(source, '.faur-mcp/config.json'), JSON.stringify({ model: 'fixture/test', projectRoot: '.', ...(optIn && { upstreamOAuth: true }), operations: [{ name: 'design', description: 'search', prompt: 'search', inputSchema: { type: 'object' } }] }));
    const c = new Client({ name: 'caller', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--input-type=module', '-e', `import {serve} from ${JSON.stringify(new URL('../mcp/host.mjs', import.meta.url).href)};await serve(process.argv[1])`, source], env: { HOME: source } });
    await c.connect(transport); t.after(() => c.close()); return () => c.callTool({ name: 'design', arguments: {} });
  }
  const call = await client(true);
  const a = await call(), b = await call();
  assert.match(a.content[0].text, /found-1/); assert.match(b.content[0].text, /found-2/);
  assert.notEqual(a.content[0].text.split(' ').at(-1), b.content[0].text.split(' ').at(-1));
  assert.doesNotMatch(JSON.stringify([a,b]), /rotated-access|old-grant|new-grant/);
  assert.equal(refreshes, 1); assert.match(readFileSync(store, 'utf8'), /new-grant/);
  const isolated = await client(false); await isolated(); assert.equal(calls, 2); assert.ok(unauthorized > 0);
  writeFileSync(store, JSON.stringify({ [url]: { serverUrl: url, tokens: { access_token: 'revoked', refresh_token: 'revoked', token_type: 'Bearer' }, tokensExpireAt: 1 } }));
  const expired = await call(); assert.equal(expired.isError, true); assert.match(expired.content[0].text, /\/mcp login/);
  writeFileSync(store, '{}'); const denied = await call(); assert.equal(denied.isError, true); assert.match(denied.content[0].text, /\/mcp login/); assert.equal(calls, 2);
});
