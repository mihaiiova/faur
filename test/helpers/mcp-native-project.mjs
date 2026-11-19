import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { generateProject } from '../../src/generate.mjs';
import { loadYaml } from '../../src/yaml-loader.mjs';
import { installMcp } from './mcp-install.mjs';

export function nativeProject(t, { subscription = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'faur full native with spaces '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'), target = join(root, 'target-a'), second = join(root, 'target-b'), home = join(root, 'operator');
  const put = (file, content) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); };
  for (const dir of [source, target, second, home]) mkdirSync(dir);
  const bin = join(root, 'toolchain-bin');
  const toolchainPath = `${bin}:/usr/bin:/bin`;
  put(join(bin, 'fixture-marker'), `#!${process.execPath}\nrequire('fs').appendFileSync(require('path').join(process.argv[2],'command-marker'),process.cwd()+'\\n')\n`);
  chmodSync(join(bin, 'fixture-marker'), 0o755);
  const modelId = subscription ? 'openai-codex/gpt-6-sol' : 'native-fixture/test';
  const design = {
    schema: 1, name: 'native-agent',
    orchestrator: { name: 'lead', model: modelId, prompt: 'SOURCE_AUTHORED_INSTRUCTIONS', tools: ['read', 'write', 'subagent', 'source_marker', 'cli:marker', 'mcp'] },
    agents: [{ name: 'specialist', description: 'Native specialist', model: modelId, tools: ['read', 'write', 'source_marker', 'cli:marker', 'mcp:upstream/pwd'], skills: ['source-skill'], prompt: 'SOURCE_SPECIALIST_INSTRUCTIONS' }],
    skills: [{ name: 'source-skill', description: 'SOURCE_SKILL_DESCRIPTION' }],
    integrations: { cli: [{ name: 'marker', command: 'fixture-marker', args: ['{target}'], approve: false }], mcp: [{ name: 'upstream', config: { command: process.execPath, args: [join(source, 'upstream.cjs')], includeTools: ['pwd'] } }] },
    mcpServer: { projectRoot: '../target-a', env: ['PATH', ...(subscription ? ['FIXTURE_REFRESH_URL'] : [])], timeoutMs: 30000, ...(subscription ? { auth: { mode: 'pi-subscription', provider: 'openai-codex', authFileEnv: 'FIXTURE_AUTH_FILE' } } : {}), operations: [
      { name: 'execute', description: 'Execute native project', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, prompt: '/skill:source-skill execute the native project' },
      { name: 'template', description: 'Expand source template', inputSchema: { type: 'object', properties: { note: { type: 'string' } }, additionalProperties: false }, prompt: '/launch' },
    ] },
  };
  const generated = generateProject(design);
  assert.deepEqual(generated.errors, []);
  for (const file of generated.files) put(join(source, file.path), file.content);
  put(join(source, '.faur-mcp/faur/extensions/faur/index.ts'), 'throw new Error("SOURCE_MAKER_POISON");\n' + readFileSync(join(source, '.faur-mcp/faur/extensions/faur/index.ts'), 'utf8'));
  put(join(source, '.pi/system.yaml'), loadYaml().stringify(design));
  put(join(source, 'AGENTS.md'), 'SOURCE_CONTEXT_INSTRUCTIONS');
  put(join(source, '.pi/skills/source-skill/SKILL.md'), '---\nname: source-skill\ndescription: SOURCE_SKILL_DESCRIPTION\n---\nSOURCE_SKILL_EXPANDED_CONTENT');
  put(join(source, '.pi/prompts/launch.md'), '---\ndescription: Native template\n---\nSOURCE_TEMPLATE_EXPANDED_CONTENT');
  put(join(source, '.pi/extensions/native-provider.ts'), readFileSync(new URL('../fixtures/mcp/native-provider.ts', import.meta.url), 'utf8'));
  // Native commands/MCP stay in S and receive T explicitly in arguments.
  put(join(source, 'upstream.cjs'), `const fs=require('fs');require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!('id'in m))return;const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'upstream',version:'1'}}:m.method==='tools/list'?{tools:[{name:'pwd',description:'actual workspace MCP tool',inputSchema:{type:'object',properties:{target:{type:'string'}},required:['target']}}]}:m.method==='tools/call'?{content:[{type:'text',text:process.cwd()}]}:{};if(m.method==='tools/call')fs.appendFileSync(require('path').join(m.params.arguments.target,'upstream-marker'),process.cwd()+'\\n');process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
  const mcpPath = join(source, '.pi/mcp.json');
  const nativeMcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
  nativeMcp.mcpServers.disabled = { command: '/INTENTIONALLY_DISABLED_POISON', enabled: false };
  put(mcpPath, JSON.stringify(nativeMcp));
  if (subscription) put(join(source, 'subscription-fixture'), 'fake-only');
  for (const [dir, label] of [[target, 'TARGET_A_CONTEXT'], [second, 'TARGET_B_CONTEXT']]) {
    put(join(dir, 'target-context'), label);
    put(join(dir, 'AGENTS.md'), 'TARGET_INSTRUCTION_POISON');
    put(join(dir, '.pi/settings.json'), '{"extensions":["/MUST_NOT_LOAD_TARGET"]}');
    put(join(dir, '.pi/extensions/poison.ts'), 'throw new Error("TARGET_EXECUTABLE_POISON")');
  }
  put(join(root, 'AGENTS.md'), 'PARENT_INSTRUCTION_POISON');
  put(join(root, '.agents/skills/ancestor/SKILL.md'), '---\nname: ancestor\ndescription: NATIVE_ANCESTOR_SKILL_DESCRIPTION\n---\nancestor guidance');
  put(join(root, '.pi/extensions/poison.ts'), 'throw new Error("PARENT_EXECUTABLE_POISON")');
  put(join(home, '.pi/agent/settings.json'), '{"extensions":["/MUST_NOT_LOAD_GLOBAL"]}');
  put(join(home, '.agents/skills/poison/SKILL.md'), '---\nname: poison\ndescription: HOME_SKILL_POISON\n---\npoison');
  installMcp(source);
  // Foreground specialists do not load ambient extensions: declare supported native resources.
  const agentPath = join(source, '.pi/agents/specialist.md');
  put(agentPath, readFileSync(agentPath, 'utf8').replace('---\n', '---\nextensions:\n  - ../extensions/native-provider.ts\n  - ../git/github.com/mihaiiova/pi-commands/index.mjs\n'));
  const runtimeDir = join(source, '.faur-mcp');
  return { root, source, target, second, home, design, put, runtimeDir, toolchainPath };
}

export const eventsAt = target => readFileSync(join(target, 'native-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
