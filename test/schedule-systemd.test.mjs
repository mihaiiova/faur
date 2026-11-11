import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const enabled = process.env.RUN_FAUR_SCHEDULE_TEST === '1';
const repo = resolve(import.meta.dirname, '..');
const cli = join(repo, 'src/faur.mjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Explicit opt-in: creates uniquely named temporary user units, invokes a real
// generated project with a local fake model, and always disables/removes units.
test('native timer runs plain Pi without Faur/system.yaml, preserves arguments, excludes overlaps and cancels timed-out cgroups', { skip: !enabled, timeout: 120000 }, async t => {
  const ctl = (...args) => execFileSync('systemctl', ['--user', ...args], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  ctl('show', '--property=Version', '--value');
  const base = mkdtempSync(join(tmpdir(), 'faur-systemd-'));
  const root = join(base, 'project % space $');
  mkdirSync(root);
  const env = { ...process.env, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || join(homedir(), '.config') };
  const operation = { op: 'add', target: 'schedule', name: 'smoke', value: { skill: 'check', request: 'literal $HOME %n ; "quoted" back\\slash untouched', calendar: '*-*-* *:*:00/5', timezone: 'UTC', timeoutSeconds: 10, environmentFile: join(root, 'runtime env') } };
  const change = op => {
    const file = join(base, 'operations.json');
    writeFileSync(file, JSON.stringify([op]));
    const run = spawnSync(process.execPath, [cli, 'change', root, '--operations', file, '--yes'], { env, encoding: 'utf8', timeout: 30000, input: '' });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    return run;
  };
  const status = () => {
    const run = spawnSync(process.execPath, [cli, 'schedule', root, 'status'], { env, encoding: 'utf8', input: '' });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };
  mkdirSync(join(root, '.pi'), { recursive: true });
  writeFileSync(join(root, '.pi/system.yaml'), 'schema: 1\nname: schedule-smoke\norchestrator:\n  name: lead\n  model: faux/faux-1\n  tools: [read]\n  prompt: Answer the scheduled check.\n');
  const built = spawnSync(process.execPath, [cli, 'generate', root], { input: '', encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  mkdirSync(join(root, '.pi/skills/check'), { recursive: true });
  writeFileSync(join(root, '.pi/skills/check/SKILL.md'), '---\nname: check\ndescription: Check scheduled progress\n---\nReturn SCHEDULE-OK.\n');
  const pi = execFileSync('which', ['pi'], { encoding: 'utf8' }).trim();
  const ai = pathToFileURL(resolve(dirname(realpathSync(pi)), '../../node_modules/@earendil-works/pi-ai/dist/index.js')).href;
  const provider = join(root, '.pi/provider.mjs');
  writeFileSync(provider, `import { createFauxCore, fauxAssistantMessage } from ${JSON.stringify(ai)};
import { appendFileSync, existsSync } from 'node:fs';
export default pi => {
 const faux = createFauxCore({api:'faux-test',provider:'faux',models:[{id:'faux-1'}]});
 faux.setResponses([fauxAssistantMessage('SCHEDULE-OK')]);
 pi.registerProvider('faux',{baseUrl:'http://localhost',apiKey:'test',api:'faux-test',streamSimple:faux.streamSimple,models:[{type:'chat',id:'faux-1',name:'faux',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1000}]});
 pi.on('before_agent_start', async event => {
   appendFileSync(${JSON.stringify(join(base, 'prompts'))}, JSON.stringify(event.prompt)+'\\n');
   if (existsSync(${JSON.stringify(join(base, 'slow'))})) await new Promise(r => setTimeout(r,30000));
 });
};`);
  const settings = JSON.parse(readFileSync(join(root, '.pi/settings.json'), 'utf8'));
  assert.equal(settings.packages, undefined);
  settings.extensions = [provider];
  writeFileSync(join(root, '.pi/settings.json'), JSON.stringify(settings));
  rmSync(join(root, '.pi/system.yaml'));
  writeFileSync(join(root, 'runtime env'), `PI_CODING_AGENT_DIR=${base}/home\nPI_OFFLINE=1\n`);
  const units = [];
  const locks = new Set();
  t.after(() => {
    for (const unit of units) {
      try { ctl('disable', '--now', `${unit}.timer`); } catch {}
      try { ctl('stop', `${unit}.service`); } catch {}
      for (const type of ['timer', 'service']) rmSync(join(env.XDG_CONFIG_HOME, 'systemd/user', `${unit}.${type}`), { force: true });
      try { ctl('reset-failed', `${unit}.service`); } catch {}
    }
    for (const lock of locks) rmSync(lock, { force: true });
    try { ctl('daemon-reload'); } finally { rmSync(base, { recursive: true, force: true }); }
  });
  // Register cleanup before the external-state mutation, including a partial apply.
  const previewFile = join(base, 'preview.json');
  writeFileSync(previewFile, JSON.stringify([operation]));
  const preview = spawnSync(process.execPath, [cli, 'change', root, '--operations', previewFile, '--dry-run'], { env, encoding: 'utf8' });
  assert.equal(preview.status, 0, preview.stderr);
  const planned = JSON.parse(preview.stdout.slice(0, preview.stdout.lastIndexOf('Dry run')));
  const unit = planned.schedule.unit;
  units.push(unit);
  locks.add(join(planned.schedule.runtimeDirectory, `${unit.slice(0, unit.lastIndexOf('-'))}.lock`));
  // The maker's real Pi dialog, not model text, authorizes installation.
  // Keep system.yaml only while Faur maintains the project, then remove it
  // before the scheduled agent runs.
  const architecture = 'schema: 1\nname: schedule-smoke\norchestrator:\n  name: lead\n  model: faux/faux-1\n  tools: [read]\n  prompt: Answer the scheduled check.\n';
  writeFileSync(join(root, '.pi/system.yaml'), architecture);
  const maker = join(base, 'maker.mjs');
  writeFileSync(maker, `import { createFauxCore, fauxAssistantMessage, fauxToolCall } from ${JSON.stringify(ai)};
export default pi => {
 const faux = createFauxCore({api:'faux-test',provider:'faux',models:[{id:'faux-1'}]});
 faux.setResponses([fauxAssistantMessage(fauxToolCall('faur_plan',{action:'propose',operations:${JSON.stringify(JSON.stringify([operation]))}})),fauxAssistantMessage('Please review the schedule.')]);
 pi.registerProvider('faux',{baseUrl:'http://localhost',apiKey:'test',api:'faux-test',streamSimple:faux.streamSimple,models:[{type:'chat',id:'faux-1',name:'faux',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1000}]});
};`);
  const child = spawn(pi, ['--no-extensions', '-e', maker, '-e', join(repo, 'extensions/faur/index.ts'), '--approve', '--no-session', '--mode', 'rpc'], { cwd: root, env: { ...env, PI_OFFLINE: '1', PI_CODING_AGENT_DIR: join(base, 'maker-home') }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const events = [];
  let buffer = '', stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((ok, fail) => {
    const timeout = setTimeout(() => fail(new Error(`Pi schedule approval timeout: ${stderr} ${JSON.stringify(events)}`)), 30000);
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        events.push(event);
        if (event.type === 'extension_ui_request' && event.method === 'select') child.stdin.write(JSON.stringify({ type: 'extension_ui_response', id: event.id, value: 'Apply' }) + '\n');
        if (event.type === 'extension_ui_request' && event.method === 'notify' && /^Applied:/.test(event.message)) { clearTimeout(timeout); ok(); }
      }
    });
    child.stdin.write(JSON.stringify({ id: 'schedule', type: 'prompt', message: '/faur schedule a progress check' }) + '\n');
  });
  assert.ok(events.some(e => e.method === 'select' && /systemctl/.test(e.title)), 'the real approval shows external commands');
  assert.equal(readFileSync(join(root, '.pi/system.yaml'), 'utf8'), architecture, 'scheduling never changes the architecture');
  child.kill();
  rmSync(join(root, '.pi/system.yaml'));
  let report;
  for (let i = 0; i < 100; i++) {
    report = status().schedules[0];
    if (report?.service?.ExecMainExitTimestamp && report.service.ExecMainStatus === '0' && report.service.ActiveState === 'inactive') break;
    await sleep(150);
  }
  assert.equal(report.service.Result, 'success', JSON.stringify(report));
  assert.ok(report.service.ExecMainExitTimestamp, JSON.stringify(report));
  const prompt = readFileSync(join(base, 'prompts'), 'utf8');
  assert.ok(prompt.trim().split('\n').map(line => JSON.parse(line)).some(value => value.includes(operation.value.request)), prompt);
  assert.match(prompt, /Return SCHEDULE-OK/);
  assert.equal(existsSync(join(root, '.pi/system.yaml')), false);
  const journal = execFileSync('journalctl', ['--user', '-u', `${unit}.service`, '--no-pager'], { encoding: 'utf8' });
  assert.match(journal, /SCHEDULE-OK/);
  change({ op: 'stop', target: 'schedule', name: 'smoke' });
  assert.equal(status().schedules[0].timer.ActiveState, 'inactive');
  // Install a second timer far in the future. Starting two native services for
  // the same project must contend on the shared flock, not execute twice.
  const second = { ...operation, name: 'other', value: { ...operation.value, calendar: '2099-01-01 00:00:00' } };
  writeFileSync(previewFile, JSON.stringify([second]));
  const secondPreview = spawnSync(process.execPath, [cli, 'change', root, '--operations', previewFile, '--dry-run'], { env, encoding: 'utf8' });
  const secondUnit = JSON.parse(secondPreview.stdout.slice(0, secondPreview.stdout.lastIndexOf('Dry run'))).schedule.unit;
  units.push(secondUnit);
  change(second);
  writeFileSync(join(base, 'slow'), '1');
  ctl('start', `${unit}.service`);
  await sleep(300);
  ctl('start', `${secondUnit}.service`);
  await sleep(300);
  assert.equal(ctl('show', `${secondUnit}.service`, '--property=ExecMainStatus', '--value'), '75');
  for (let i = 0; i < 100 && ctl('show', `${unit}.service`, '--property=ActiveState', '--value') === 'active'; i++) await sleep(150);
  assert.equal(ctl('show', `${unit}.service`, '--property=Result', '--value'), 'timeout');
  assert.equal(ctl('show', `${unit}.service`, '--property=MainPID', '--value'), '0');
  change({ op: 'remove', target: 'schedule', name: 'other' });
  change({ op: 'remove', target: 'schedule', name: 'smoke' });
  assert.deepEqual(status().schedules, []);
});
