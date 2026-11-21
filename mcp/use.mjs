// Distributed with the agent. No installed Faur or global Pi required.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { agentProfile } from './upstream-oauth.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const bundle = join(source, '.faur-mcp');
const cli = join(bundle, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js');
function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Agent setup failed: ${basename(command)}`);
}
function use(action) {
  const config = read(join(bundle, 'config.json'));
  if (action === 'install') {
    run('npm', ['ci', '--ignore-scripts'], bundle);
    const settings = read(join(source, '.pi/settings.json'));
    const temp = mkdtempSync(join(tmpdir(), 'faur-use-'));
    try { for (const pkg of settings.packages ?? []) run(process.execPath, [cli, 'install', '--local', '--approve', typeof pkg === 'string' ? pkg : pkg.source], source, { ...process.env, PI_CODING_AGENT_DIR: temp }); }
    finally { rmSync(temp, { recursive: true, force: true }); }
    return;
  }
  if (action === 'authorize') {
    if (!config.upstreamOAuth) throw new Error('This agent did not enable upstream OAuth.');
    const profile = agentProfile(source);
    mkdirSync(profile, { recursive: true, mode: 0o700 });
    console.log('Use /mcp login <server> to authorize, or /mcp logout <server> to forget access.');
    return run(process.execPath, [cli], source, { ...process.env, PI_CODING_AGENT_DIR: profile });
  }
  if (!['pi','claude'].includes(action)) throw new Error('Expected install, authorize, pi or claude');
  const name = basename(source);
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Install in a directory named for the MCP server (letters, digits, _ or -).');
  const entry = { command: process.execPath, args: [join(bundle, 'faur/mcp/host.mjs')] };
  if (action === 'pi' && existsSync('.pi/system.yaml')) throw new Error(`Faur-managed caller: add this project-local integrations.mcp entry through /faur: ${JSON.stringify({name,config:entry})}`);
  const path = resolve(action === 'pi' ? '.pi/mcp.json' : '.mcp.json');
  const obj = existsSync(path) ? read(path) : {};
  if (!obj || Array.isArray(obj) || typeof obj !== 'object') throw new Error('Invalid MCP config');
  obj.mcpServers ??= {};
  if (typeof obj.mcpServers !== 'object' || Array.isArray(obj.mcpServers)) throw new Error('Invalid MCP config');
  if (Object.hasOwn(obj.mcpServers,name)) {
    if (JSON.stringify(obj.mcpServers[name]) !== JSON.stringify(entry)) throw new Error(`Conflicting local MCP entry: ${name}`);
    if (!existsSync(cli)) use('install');
    return;
  }
  if (!existsSync(cli)) use('install'); // Explicit attachment, never during delegated execution.
  obj.mcpServers[name] = entry;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + `.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2)+'\n', { mode: 0o600, flag: 'wx' }); renameSync(tmp,path);
  console.log(`Registered ${name} in ${path}; reconnect the project MCP client.`);
}
try { use(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
