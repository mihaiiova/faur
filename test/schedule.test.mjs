import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('src/faur.mjs');
const unsupported = process.platform !== 'linux' || spawnSync('systemd-analyze', ['--version']).status !== 0 || !existsSync(`/run/user/${process.getuid()}`) ? 'needs Linux, systemd-analyze and a user runtime directory' : false;
function project(t) {
  const base = mkdtempSync(join(tmpdir(), 'faur-schedule-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'project space % $');
  mkdirSync(join(root, '.pi/skills/check'), { recursive: true });
  writeFileSync(join(root, '.pi/skills/check/SKILL.md'), '---\nname: check\ndescription: Check progress.\n---\nCheck progress.\n');
  const bin = join(base, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'systemctl'), `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.SCHEDULE_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.env.SCHEDULE_FAIL && process.argv.includes(process.env.SCHEDULE_FAIL)) process.exit(1);
if (process.argv.includes('show')) console.log('LoadState=loaded\\nActiveState=active\\nUnitFileState=enabled\\nNextElapseUSecRealtime=tomorrow\\nResult=success\\nExecMainStatus=0\\nFragmentPath='+(process.env.SCHEDULE_FRAGMENT || '')+'\\nDropInPaths='+(process.env.SCHEDULE_DROPIN || ''));
`);
  chmodSync(join(bin, 'systemctl'), 0o755);
  const env = { ...process.env, XDG_CONFIG_HOME: join(base, 'config'), PATH: `${bin}:${process.env.PATH}`, SCHEDULE_CALLS: join(base, 'calls') };
  const value = { skill: 'check', request: 'Check progress; literal $HOME %n', calendar: '*-*-* 09:00:00', timezone: 'Europe/Bucharest', timeoutSeconds: 60 };
  const op = { op: 'add', target: 'schedule', name: 'daily', value };
  function run(operations, ...flags) {
    const file = join(base, 'operations.json');
    writeFileSync(file, JSON.stringify(operations));
    return spawnSync(process.execPath, [cli, 'change', root, '--operations', file, ...flags], { env, encoding: 'utf8', input: '' });
  }
  const status = () => spawnSync(process.execPath, [cli, 'schedule', root, 'status'], { env, encoding: 'utf8', input: '' });
  return { base, root, env, op, run, status };
}

test('approved CLI operations install, update, stop and remove native units; status reads the manager', { skip: unsupported }, t => {
  const { base, op, run, status } = project(t);
  const refused = run([op]);
  assert.equal(refused.status, 0, refused.stderr);
  assert.match(refused.stdout, /Not approved/);
  assert.equal(existsSync(join(base, 'calls')), false);
  const installed = run([op], '--yes');
  assert.equal(installed.status, 0, installed.stderr);
  const dir = join(base, 'config/systemd/user');
  const service = readdirSync(dir).find(f => f.endsWith('.service'));
  assert.match(readFileSync(join(dir, service), 'utf8'), /RuntimeMaxSec=60/);
  const report = status();
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /NextElapseUSecRealtime/);
  assert.match(report.stdout, /task success/i);
  assert.equal(run([{ ...op, op: 'update', value: { ...op.value, timeoutSeconds: 90 } }], '--yes').status, 0);
  assert.match(readFileSync(join(dir, service), 'utf8'), /RuntimeMaxSec=90/);
  assert.equal(run([{ op: 'stop', target: 'schedule', name: 'daily' }], '--yes').status, 0);
  assert.equal(existsSync(join(dir, service)), true);
  assert.equal(run([{ op: 'remove', target: 'schedule', name: 'daily' }], '--yes').status, 0);
  assert.deepEqual(readdirSync(dir), []);
  const calls = readFileSync(join(base, 'calls'), 'utf8');
  assert.match(calls, /"disable","--now"/);
  assert.match(calls, /"stop"/);
});

test('CLI refuses unsafe schedules, foreign native files and unavailable managers without installing anything', { skip: unsupported }, t => {
  const { base, env, op, run } = project(t);
  for (const value of [{ ...op.value, timezone: 'Not/AZone' }, { ...op.value, calendar: 'not a calendar' }, { ...op.value, calendar: '-h' }, { ...op.value, skill: 'missing' }, { ...op.value, request: 'line\nbreak' }, { ...op.value, timeoutSeconds: 0 }, { ...op.value, unknown: true }]) {
    assert.equal(run([{ ...op, value }], '--dry-run').status, 1);
  }
  assert.equal(run([op, op], '--dry-run').status, 1);
  env.SCHEDULE_FAIL = 'show';
  const failed = run([op], '--yes');
  assert.equal(failed.status, 1);
  assert.equal(existsSync(join(base, 'config/systemd/user')), false);
  delete env.SCHEDULE_FAIL;
  for (const [flag, value] of [['SCHEDULE_FRAGMENT', '/etc/systemd/user/foreign.service'], ['SCHEDULE_DROPIN', '/etc/systemd/user/service.d/override.conf']]) {
    env[flag] = value;
    const refused = run([op], '--yes');
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, /takes precedence|drop-ins/);
    assert.equal(existsSync(join(base, 'config/systemd/user')), false);
    delete env[flag];
  }
  const preview = run([op], '--dry-run');
  const parsed = JSON.parse(preview.stdout.slice(0, preview.stdout.lastIndexOf('Dry run')));
  const file = parsed.files[0].path;
  mkdirSync(join(base, 'config/systemd/user'), { recursive: true });
  writeFileSync(file, '# Native developer-owned file\n');
  const collision = run([op], '--yes');
  assert.equal(collision.status, 1);
  assert.match(collision.stderr, /foreign/);
  assert.equal(readFileSync(file, 'utf8'), '# Native developer-owned file\n');
});

test('CLI refuses symlink units and reports partial manager failure instead of claiming a clean apply', { skip: unsupported }, t => {
  const { base, env, op, run } = project(t);
  const preview = run([op], '--dry-run');
  const file = JSON.parse(preview.stdout.slice(0, preview.stdout.lastIndexOf('Dry run'))).files[0].path;
  mkdirSync(join(base, 'config/systemd/user'), { recursive: true });
  const authored = join(base, 'authored');
  writeFileSync(authored, 'keep this');
  symlinkSync(authored, file);
  const refused = run([op], '--yes');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /symlink/);
  assert.equal(readFileSync(authored, 'utf8'), 'keep this');
  rmSync(file);
  env.SCHEDULE_FAIL = 'enable';
  const failed = run([op], '--yes');
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /partially changed/);
  assert.match(failed.stderr, /completed: systemctl --user daemon-reload/);
  assert.equal(existsSync(file), false, 'unit file writes roll back, not external manager state');
});

test('CLI previews native systemd scheduling without modifying the project or installing units', { skip: unsupported }, t => {
  const { base, root, op, run } = project(t);
  const result = run([op], '--dry-run');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OnCalendar=\*-\*-\* 09:00:00 Europe\/Bucharest/);
  assert.match(result.stdout, /StandardInput=null/);
  assert.match(result.stdout, /RuntimeMaxSec=60/);
  assert.match(result.stdout, /KillMode=control-group/);
  assert.match(result.stdout, /flock/);
  assert.match(result.stdout, /\$\$HOME %%n/);
  assert.match(result.stdout, /Persistent=false/);
  assert.equal(existsSync(join(base, 'config/systemd/user')), false);
  assert.equal(existsSync(join(root, '.pi/system.yaml')), false);
});
