import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { generateProject } from '../src/generate.mjs';
import { loadYaml } from '../src/yaml-loader.mjs';

const repo = resolve(import.meta.dirname, '..');
const piPath = execFileSync('which', ['pi'], { encoding: 'utf8' }).trim();
const ai = pathToFileURL(resolve(dirname(realpathSync(piPath)), '../../node_modules/@earendil-works/pi-ai/dist/index.js')).href;
const model = name => ({ schema: 1, name, description: `Agent ${name}`, orchestrator: { name: 'lead', model: 'faux/faux-1', tools: ['read'], prompt: `Original ${name}.` } });

function launch(t, responses, choose, own = false) {
  const root = mkdtempSync(join(tmpdir(), 'faur parent with spaces '));
  const targets = {};
  for (const name of ['jared', 'researcher']) {
    const target = targets[name] = join(root, '.agents', name);
    const design = model(name);
    for (const file of generateProject(design).files) {
      mkdirSync(dirname(join(target, file.path)), { recursive: true });
      writeFileSync(join(target, file.path), file.content);
    }
    writeFileSync(join(target, '.pi/system.yaml'), loadYaml().stringify(design));
    mkdirSync(join(target, '.pi/extensions'));
    writeFileSync(join(target, '.pi/extensions/poison.ts'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(root, 'target-was-loaded'))}, 'bad'); throw new Error('target extension must not load');`);
  }
  mkdirSync(join(root, '.agents/skills'));
  mkdirSync(join(root, '.pi'));
  if (own) {
    for (const file of generateProject(model('main')).files) {
      mkdirSync(dirname(join(root, file.path)), { recursive: true });
      writeFileSync(join(root, file.path), file.content);
    }
    writeFileSync(join(root, '.pi/system.yaml'), loadYaml().stringify(model('main')));
  }
  writeFileSync(join(root, 'app.txt'), 'Main project stays untouched.');
  const log = join(root, 'active-tools.log');
  const provider = join(root, 'provider.mjs');
  writeFileSync(provider, `import {createFauxCore,fauxAssistantMessage,fauxToolCall} from ${JSON.stringify(ai)};
import {appendFileSync} from 'node:fs';
export default pi => {
 const faux=createFauxCore({api:'faux-test',provider:'faux',models:[{id:'faux-1'}]});
 faux.setResponses([${responses}]);
 pi.registerProvider('faux',{baseUrl:'http://localhost',apiKey:'test',api:'faux-test',streamSimple:faux.streamSimple,models:[{type:'chat',id:'faux-1',name:'faux',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1000}]});
 pi.registerCommand('test-reload',{description:'reload',handler:async(_args,ctx)=>{await ctx.reload();}});
 pi.on('turn_start',()=>appendFileSync(${JSON.stringify(log)},JSON.stringify(pi.getActiveTools())+'\\n'));
};`);
  const child = spawn(piPath, ['--no-extensions', '-e', provider, '-e', join(repo, 'extensions/faur/index.ts'), '--approve', '--no-session', '--model', 'faux/faux-1', '--mode', 'rpc'], { cwd: root, env: { ...process.env, PI_OFFLINE: '1', PI_CODING_AGENT_DIR: join(root, '.home') }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 1000);
      await closed; clearTimeout(force);
    }
    rmSync(root, { recursive: true, force: true });
  });
  const events = [];
  let buffer = '', stderr = '', wake = () => {};
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let event; try { event = JSON.parse(line); } catch { continue; }
      events.push(event);
      if (event.type === 'extension_ui_request' && event.method === 'select') child.stdin.write(JSON.stringify({ type: 'extension_ui_response', id: event.id, value: choose(event) }) + '\n');
      wake();
    }
  });
  const until = (predicate, ms = 20000) => new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`timed out: ${JSON.stringify(events.filter(e => e.type === 'extension_ui_request'))}\n${stderr}`)), ms);
    const check = () => { if (predicate()) { clearTimeout(timer); wake = () => {}; ok(); } };
    wake = check; check();
  });
  let id = 0;
  const send = message => child.stdin.write(JSON.stringify({ id: String(++id), type: 'prompt', message }) + '\n');
  const notices = () => events.filter(e => e.type === 'extension_ui_request' && e.method === 'notify').map(e => e.message);
  return { root, targets, child, events, log, until, send, notices };
}

test('main-project /faur inventories, routes named maintenance, preserves pending proposals and applies only to the selected agent', { timeout: 60000 }, async t => {
  const operations = JSON.stringify([{ op: 'set', target: 'orchestrator', value: { ...model('jared').orchestrator, prompt: 'Updated Jared only.' } }]);
  const round = `fauxAssistantMessage(fauxToolCall('faur_plan',{action:'inspect'})),fauxAssistantMessage(fauxToolCall('faur_plan',{action:'propose',operations:${JSON.stringify(operations)}})),fauxAssistantMessage('Review the preview.')`;
  let previews = 0;
  const app = launch(t, `${round},${round}`, event => {
    assert.match(event.title, /^Apply this change\?/);
    return ++previews === 1 ? "Let's discuss" : 'Apply';
  });
  const { root, targets, events, send, until, notices } = app;
  const originalResearcher = readFileSync(join(targets.researcher, '.pi/system.yaml'), 'utf8');
  send('/faur exit');
  await until(() => notices().some(message => message === 'Not in /faur.'));
  send('/faur agents');
  await until(() => notices().some(message => message.includes('Project-local Faur agents:')));
  const listing = notices().find(message => message.includes('Project-local Faur agents:'));
  assert.match(listing, /jared: .agents\/jared/); assert.match(listing, /researcher: .agents\/researcher/);
  assert.doesNotMatch(listing, /skills:/);
  assert.equal(events.filter(e => e.type === 'agent_end').length, 0, 'listing spends no model calls');
  send('/faur Update Jared’s prompt');
  await until(() => notices().some(message => message.includes('The proposal is not applied yet')));
  const inspect = events.filter(e => e.type === 'message_end' && e.message?.role === 'toolResult').map(e => {
    try { return JSON.parse(e.message.content[0].text); } catch { return null; }
  }).find(value => value?.maintenanceSession);
  assert.equal(inspect.maintenanceSession.target, targets.jared);
  assert.equal(inspect.maintenanceSession.cwd, root);
  assert.equal(inspect.maintenanceSession.targetResourcesLoaded, false);
  assert.deepEqual(inspect.executionEvidence, []);
  send('/faur agent researcher status');
  await until(() => notices().some(message => message.includes('no proposal was discarded')));
  assert.doesNotMatch(readFileSync(join(targets.jared, '.pi/system.yaml'), 'utf8'), /Updated Jared/);
  send('/faur exit');
  await until(() => notices().some(message => message.includes('pending proposal was discarded')));
  send('/faur agent researcher status');
  await until(() => notices().some(message => message.startsWith('researcher: Agent researcher')));
  send('/faur agent jared Update the prompt');
  await until(() => notices().some(message => message.startsWith('Applied:')));
  assert.match(readFileSync(join(targets.jared, '.pi/system.yaml'), 'utf8'), /Updated Jared only/);
  assert.equal(readFileSync(join(targets.researcher, '.pi/system.yaml'), 'utf8'), originalResearcher);
  assert.equal(readFileSync(join(root, 'app.txt'), 'utf8'), 'Main project stays untouched.');
  assert.equal(existsSync(join(root, '.pi/system.yaml')), false);
  assert.equal(existsSync(join(root, 'target-was-loaded')), false);
});

test('explicit creation in a Faur main project starts independent design with the .agents default', { timeout: 30000 }, async t => {
  const app = launch(t, "fauxAssistantMessage('DESIGN-READY')", () => { throw new Error('creation needs no target picker'); }, true);
  const before = readFileSync(join(app.root, '.pi/system.yaml'), 'utf8');
  app.send('/faur Create Bob in ./custom');
  await app.until(() => app.events.some(event => event.type === 'agent_end'));
  const messages = app.events.find(event => event.type === 'agent_end').messages;
  const prompt = messages.find(message => message.role === 'user').content[0].text;
  assert.match(prompt, /Mode: DESIGN \(new independent project/);
  assert.ok(prompt.includes(join(app.root, '.agents', '<name>')));
  assert.match(prompt, /Honor an explicitly requested location/);
  assert.match(prompt, /User request: Create Bob in \.\/custom/);
  assert.equal(readFileSync(join(app.root, '.pi/system.yaml'), 'utf8'), before);
});

test('bare /faur offers a picker and restores the selected target and tool restrictions across reload', { timeout: 60000 }, async t => {
  const app = launch(t, "fauxAssistantMessage('NOTED'),fauxAssistantMessage('NOTED')", event => {
    assert.equal(event.title, 'Which Faur agent?');
    return event.options.find(option => option.startsWith('researcher —'));
  });
  const { targets, events, send, until, notices, log } = app;
  const ends = () => events.filter(event => event.type === 'agent_end').length;
  send('/faur'); await until(() => ends() >= 1);
  assert.ok(events.some(event => event.type === 'extension_ui_request' && event.method === 'setStatus' && event.statusText?.includes(targets.researcher)));
  send('/test-reload');
  await until(() => notices().some(message => message.startsWith('Still in /faur after /reload')));
  send('/faur status');
  await until(() => notices().some(message => message.startsWith('researcher: Agent researcher')));
  send('/faur agent jared status');
  await until(() => notices().some(message => message.includes('no proposal was discarded')));
  send('continue reviewing'); await until(() => ends() >= 2);
  renameSync(targets.researcher, targets.researcher + '-moved');
  send('/faur exit'); await until(() => notices().some(message => message.startsWith('Left /faur.')));
  renameSync(targets.researcher + '-moved', targets.researcher);
  send('normal work'); await until(() => ends() >= 3);
  const active = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(active[0], ['faur_plan']); assert.deepEqual(active[1], ['faur_plan']);
  assert.ok(active.at(-1).includes('read')); assert.ok(!active.at(-1).includes('faur_plan'));
  assert.equal(existsSync(join(app.root, 'target-was-loaded')), false);
});
