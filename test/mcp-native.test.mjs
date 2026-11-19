import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nativeProject, eventsAt } from './helpers/mcp-native-project.mjs';

const enabled = process.env.RUN_FAUR_MCP_TEST === '1';
test('generated external MCP runs source skills/templates, actual specialists, commands, upstream MCP and authored extensions in two targets', { skip: !enabled, timeout: 240000 }, async t => {
  const { source, target, second, home, runtimeDir, put, toolchainPath } = nativeProject(t);
  const oldPath = process.env.PATH; process.env.PATH = toolchainPath;
  t.after(() => { if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath; });
  const { Client } = await import(pathToFileURL(join(runtimeDir, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')));
  const { StdioClientTransport } = await import(pathToFileURL(join(runtimeDir, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')));
  let client;
  const connect = async () => {
    client = new Client({ name: 'native-parity', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(runtimeDir, 'faur/mcp/host.mjs')], cwd: home, env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: join(home, '.pi/agent'), DEVELOPER_ONLY_SECRET: 'GLOBAL_AMBIENT_POISON' }, stderr: 'pipe' });
    await client.connect(transport);
  };
  t.after(async () => { await client?.close(); });
  await connect();
  for (const [workspace, operation, context] of [[target, 'execute', 'TARGET_A_CONTEXT'], [second, 'template', 'TARGET_B_CONTEXT']]) {
    if (workspace === second) {
      await client.close();
      const configPath = join(runtimeDir, 'config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8')); config.projectRoot = '../target-b';
      writeFileSync(configPath, JSON.stringify(config));
      await connect();
    }
    const result = await client.callTool({ name: operation, arguments: operation === 'template' ? { note: 'VALIDATED_TEMPLATE_ARGUMENT' } : {} });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.content[0].text, 'lead done');
    const events = eventsAt(workspace);
    assert.ok(events.some(event => event.child), JSON.stringify(events.at(-2)?.context?.messages?.slice(-3)));
    for (const marker of ['lead-extension', 'child-extension']) assert.equal(readFileSync(join(workspace, marker), 'utf8'), source);
    for (const marker of ['lead-write', 'child-write']) assert.equal(existsSync(join(workspace, marker)), true);
    for (const marker of ['command-marker', 'upstream-marker']) assert.deepEqual(readFileSync(join(workspace, marker), 'utf8').trim().split('\n'), [source, source], 'lead and child really call native command/MCP');
    assert.ok(events.filter(event => event.extensionExec).every(event => event.extensionExec === source));
    for (const event of events.filter(event => event.startup)) assert.equal(event.startup.cwd, source);
    const first = events.find(event => event.context && !event.child);
    assert.equal(first.context.messages.filter(message => message.role === 'assistant').length, 0, 'fresh conversation on each call');
    const serialized = JSON.stringify(events);
    assert.match(serialized, /SOURCE_AUTHORED_INSTRUCTIONS/);
    assert.match(serialized, /SOURCE_SPECIALIST_INSTRUCTIONS/);
    assert.match(serialized, /SOURCE_CONTEXT_INSTRUCTIONS/);
    assert.match(serialized, /PARENT_INSTRUCTION_POISON/, 'ordinary native ancestor context is not excluded');
    assert.match(serialized, /NATIVE_ANCESTOR_SKILL_DESCRIPTION/);
    if (operation === 'template') assert.match(serialized, /VALIDATED_TEMPLATE_ARGUMENT/, 'templates without $@ still receive validated JSON task context');
    assert.match(serialized, workspace === target ? /SOURCE_SKILL_EXPANDED_CONTENT/ : /SOURCE_TEMPLATE_EXPANDED_CONTENT/);
    assert.match(serialized, new RegExp(context));
    assert.doesNotMatch(serialized, /TARGET_INSTRUCTION_POISON|HOME_SKILL_POISON|GLOBAL_AMBIENT_POISON|SOURCE_MAKER_POISON|faur_plan/);
    assert.ok(events.filter(event => event.tools).every(event => !event.tools.includes('faur_plan')));
  }
  for (const marker of ['lead-write', 'child-write', 'command-marker', 'upstream-marker']) assert.equal(existsSync(join(source, marker)), false, 'target writes use explicit paths despite cwd=S');
  await client.close(); client = undefined;
  // Known package/resource failures refuse execution; MCP connection/tool errors remain native.
  const { invoke, loadAgent } = await import(pathToFileURL(join(runtimeDir, 'faur/mcp/host.mjs')));
  const agent = loadAgent(source);
  const initial = eventsAt(second).length;
  const modelsPath = join(source, '.pi/models.json');
  put(modelsPath, '{PRIVATE_MALFORMED_MODELS');
  assert.match((await invoke(agent, 'execute', {})).content[0].text, /declared model is unavailable/);
  rmSync(modelsPath);
  const settingsPath = join(source, '.pi/settings.json');
  const settings = readFileSync(settingsPath, 'utf8');
  put(settingsPath, JSON.stringify({ ...JSON.parse(settings), packages: [...JSON.parse(settings).packages, 'npm:faur-test-missing-package@0.0.0'] }));
  assert.match((await invoke(agent, 'execute', {})).content[0].text, /package is missing or mismatched/);
  assert.equal(eventsAt(second).length, initial, 'missing package fails before any model call');
  put(settingsPath, settings);
  put(settingsPath, JSON.stringify({ ...JSON.parse(settings), extensions: ['./PRIVATE_MISSING_EXTENSION.ts'] }));
  assert.equal((await invoke(agent, 'execute', {})).isError, undefined, 'published native discovery silently skips a nonexistent resource path; no custom discovery validator');
  put(settingsPath, settings);
  const mcpPath = join(source, '.pi/mcp.json');
  const mcp = readFileSync(mcpPath, 'utf8');
  put(mcpPath, JSON.stringify({ mcpServers: { broken: { command: '/PRIVATE_MISSING_SERVER_DIAGNOSTIC' } } }));
  const failed = await invoke(agent, 'execute', {});
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_MISSING/, 'native tool diagnostics are not public output');
  assert.match(JSON.stringify(eventsAt(second)), /mcp__upstream__pwd/, 'Pi owns failed MCP tool invocation; startup is not all-server readiness');
  put(mcpPath, mcp);
  // A source extension load failure is fatal, not quietly skipped.
  put(join(source, '.pi/extensions/broken.ts'), 'throw new Error("PRIVATE_EXTENSION_DIAGNOSTIC")');
  assert.match((await invoke(agent, 'execute', {})).content[0].text, /resource discovery or extension startup failed/);
  rmSync(join(source, '.pi/extensions/broken.ts'));
  put(join(source, '.pi/extensions/replaces-mcp.ts'), 'export default function(pi) { pi.registerCommand("mcp", { description: "Source replacement fixture", handler: async () => {} }); }');
  const replaced = await invoke(agent, 'execute', {});
  assert.equal(replaced.isError, true);
  assert.match(replaced.content[0].text, /disabled or replaced/);
  rmSync(join(source, '.pi/extensions/replaces-mcp.ts'));
  // Native command approvals remain enforced headless, including in specialists.
  const commandPath = join(source, '.pi/commands.json');
  const commands = JSON.parse(readFileSync(commandPath, 'utf8'));
  commands.commands[0].approve = true;
  put(commandPath, JSON.stringify(commands));
  const priorCommands = readFileSync(join(second, 'command-marker'), 'utf8');
  assert.equal((await invoke(agent, 'execute', {})).isError, undefined);
  assert.equal(readFileSync(join(second, 'command-marker'), 'utf8'), priorCommands, 'approval-required commands never run headless');
  commands.commands[0].approve = false; put(commandPath, JSON.stringify(commands));
  // Real delegated native child + detached builtin shell: cancellation must stop active work.
  put(join(source, 'hang-child'), 'hang the actual specialist');
  const specialistPath = join(source, '.pi/agents/specialist.md');
  put(specialistPath, readFileSync(specialistPath, 'utf8').replace('  - write\n', '  - write\n  - bash\n'));
  const controller = new AbortController();
  const pending = invoke(agent, 'execute', {}, controller.signal);
  const deadline = Date.now() + 15000;
  while (!existsSync(join(second, 'child-heartbeat')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(existsSync(join(second, 'child-heartbeat')), true, 'real delegated shell started');
  controller.abort();
  assert.match((await pending).content[0].text, /cancelled/);
  const heartbeat = readFileSync(join(second, 'child-heartbeat'), 'utf8');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(readFileSync(join(second, 'child-heartbeat'), 'utf8'), heartbeat, 'native abort stops foreground child shell process group');
  put(join(source, 'length-answer'), 'length');
  const truncated = await invoke(agent, 'execute', {});
  assert.equal(truncated.isError, true); assert.match(truncated.content[0].text, /incomplete answer/);
  assert.doesNotMatch(JSON.stringify(truncated), /incomplete private answer/);
});
