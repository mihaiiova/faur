/** Maker-side composition of native user-systemd units; never loaded by scheduled Pi. */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync, accessSync, constants } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { scanSkills } from './discover.mjs';
import { digest, readText, fingerprints, assertUnchanged, applyWrites } from './maintenance-store.mjs';
import { diffLines } from './diff.mjs';

const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const unitRoot = () => resolve(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'));
const prefix = root => `pi-schedule-${digest(realpathSync(root)).slice(0, 16)}-`;
const marker = root => `# Project: ${digest(realpathSync(root))}\n`;
function text(value, label, max = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid schedule ${label}`);
  return value;
}
// systemd specifiers apply to paths too; environment substitution applies only to ExecStart.
const nativePath = value => {
  text(value, 'path');
  if (!isAbsolute(value) || /["']/.test(value) || /[\\\\\s]$/.test(value)) throw new Error('Native unit paths must be absolute, contain no quotes, and cannot end in whitespace or backslash');
  return value.replaceAll('%', '%%');
};
const quote = (value, exec = false) => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', () => exec ? '$$' : '$') + '"';
function command(file, args) {
  try { return execFileSync(file, args, { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 }).trim(); }
  catch (error) { throw new Error(`${file} ${args.join(' ')} failed: ${error.stderr?.toString().trim() || error.message}`); }
}
function executable(name) {
  const path = command('which', [name]);
  if (!isAbsolute(path) || !statSync(path).isFile()) throw new Error(`No absolute executable for ${name}`);
  return text(path, `${name} executable`);
}
function filesAt(root, name) {
  if (!namePattern.test(name ?? '') || name.length > 48) throw new Error('Schedule name must be kebab-case, at most 48 characters');
  const unit = prefix(root) + name;
  const files = ['service', 'timer'].map(type => `systemd/user/${unit}.${type}`);
  const home = unitRoot();
  const before = Object.fromEntries(files.map(path => [path, readText(home, path)]));
  for (const [path, content] of Object.entries(before)) {
    if (content !== null && !content.startsWith(marker(root))) throw new Error(`Refusing foreign schedule file: ${join(home, path)}`);
    if (existsSync(join(home, `${path}.d`))) throw new Error(`Schedule has native drop-ins: ${path}.d; manage those explicitly first`);
  }
  return { unit, home, files, before };
}
export function planSchedule(root, operation) {
  if (process.platform !== 'linux') throw new Error('Scheduling currently requires Linux user systemd');
  root = realpathSync(root);
  const { op, name, value } = operation;
  if (!['add', 'update', 'stop', 'remove'].includes(op) || Object.keys(operation).some(k => !['op', 'target', 'name', 'value'].includes(k))) throw new Error('Use schedule add, update, stop or remove');
  const { unit, home, files, before } = filesAt(root, name);
  const present = Object.values(before).some(v => v !== null);
  if (op === 'add' ? present : !Object.values(before).every(v => v !== null)) throw new Error(op === 'add' ? 'Schedule already exists; use update' : 'Schedule pair is missing or incomplete');
  const writes = {};
  let calendar;
  let execution;
  if (op === 'add' || op === 'update') {
    if (!value || Object.keys(value).some(k => !['skill', 'request', 'calendar', 'timezone', 'timeoutSeconds', 'environmentFile'].includes(k))) throw new Error('Unknown schedule fields');
    if (!namePattern.test(value.skill ?? '')) throw new Error('Invalid schedule skill');
    const skill = ['.pi/skills', '.agents/skills'].map(dir => join(dir, value.skill, 'SKILL.md')).find(path => readText(root, path) !== null);
    if (!skill) throw new Error(`Missing local skill ${value.skill}; create and approve it before scheduling`);
    if (scanSkills({ [skill]: readText(root, skill) })[0]?.name !== value.skill) throw new Error('Scheduled skill frontmatter must declare its matching name');
    text(value.timezone, 'timezone', 100);
    if (!/^[A-Za-z0-9_+\/-]+$/.test(value.timezone)) throw new Error('Invalid schedule timezone');
    try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); } catch { throw new Error('Invalid schedule timezone'); }
    calendar = `${text(value.calendar, 'calendar', 200)} ${value.timezone}`;
    if (calendar.includes('%')) throw new Error('Calendar cannot contain specifiers');
    command('systemd-analyze', ['calendar', '--', calendar]);
    const timeout = value.timeoutSeconds ?? 1800;
    if (!Number.isInteger(timeout) || timeout < 10 || timeout > 86400) throw new Error('timeoutSeconds must be 10–86400');
    const pi = executable('pi'), flock = executable('flock');
    const request = `/skill:${value.skill}${value.request !== undefined && value.request !== '' ? ` ${text(value.request, 'request')}` : ''}`;
    const runtime = `/run/user/${process.getuid()}`;
    try {
      if (!statSync(runtime).isDirectory()) throw new Error('not a directory');
      accessSync(runtime, constants.W_OK | constants.X_OK);
    } catch { throw new Error(`Scheduling requires a writable user runtime directory: ${runtime}`); }
    const lock = `${runtime}/pi-schedule-${digest(root).slice(0, 16)}.lock`;
    execution = { skill: value.skill, request: value.request ?? '', timeoutSeconds: timeout, runtimeDirectory: runtime, ...(value.environmentFile ? { environmentFile: value.environmentFile } : {}) };
    const args = [flock, '--nonblock', '--conflict-exit-code', '75', lock, pi, '--approve', '--no-session', '-p', request];
    const path = [...new Set([dirname(pi), dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'])].join(':');
    let environment = '';
    if (value.environmentFile !== undefined) {
      text(value.environmentFile, 'environmentFile');
      if (!isAbsolute(value.environmentFile) || !statSync(value.environmentFile).isFile()) throw new Error('environmentFile must name an existing absolute file (values are never read by Faur)');
      if (/[?*\[]/.test(value.environmentFile)) throw new Error('Environment file globs are not supported');
      environment = `EnvironmentFile=${nativePath(value.environmentFile)}\n`;
    }
    writes[files[0]] = `${marker(root)}[Unit]\nDescription=Scheduled Pi skill ${name}\n\n[Service]\nType=exec\nWorkingDirectory=${nativePath(root)}\nExecStart=${args.map(arg => quote(arg, true)).join(' ')}\nEnvironment=${quote(`PATH=${path}`)}\n${environment}StandardInput=null\nStandardOutput=journal\nStandardError=journal\nRuntimeMaxSec=${timeout}\nTimeoutStopSec=10\nKillMode=control-group\nSendSIGKILL=yes\nRestart=no\n`;
    writes[files[1]] = `${marker(root)}[Unit]\nDescription=Timer for Pi skill ${name}\n\n[Timer]\nOnCalendar=${calendar}\nUnit=${unit}.service\nPersistent=false\nAccuracySec=1s\n\n[Install]\nWantedBy=timers.target\n`;
  } else {
    if (value !== undefined) throw new Error('stop/remove do not accept schedule values');
    if (op === 'remove') for (const path of files) writes[path] = null;
  }
  const commands = op === 'add' || op === 'update'
    ? [...(op === 'update' ? [['disable', '--now', `${unit}.timer`]] : []), ['daemon-reload'], ['enable', '--now', `${unit}.timer`], ['restart', `${unit}.timer`]]
    : [['disable', '--now', `${unit}.timer`], ['stop', `${unit}.service`], ...(op === 'remove' ? [['daemon-reload']] : [])];
  const preview = {
    schedule: { name, action: op, cwd: root, ...(calendar ? { calendar } : {}), ...execution, unit, environment: 'User-manager environment and ordinary Pi auth; shell startup and project .env are not loaded. Optional EnvironmentFile uses systemd syntax, not shell.', overlap: 'flock excludes other scheduled runs of this project; contention exits 75, not queued. Manual runs are not covered.', logs: `journalctl --user -u ${unit}.service`, limitations: 'Process success is not task success. No notifications, retries, catch-up, cost limit or OS isolation. Plain Pi loads global config; trusted tools share credentials. --approve grants project trust, not consequential-command approval. User lingering must be checked; Faur never changes it.' },
    files: Object.entries(writes).map(([path, content]) => ({ path: join(home, path), action: content === null ? 'remove' : before[path] === null ? 'create' : 'update', diff: diffLines(before[path] ?? '', content ?? '') })),
    commands: commands.map(args => ['systemctl', '--user', ...args]),
    modelDiff: '', redactedChanges: [],
  };
  return { kind: 'schedule', root, home, unit, name, action: op, writes, expected: fingerprints(home, files), commands, preview };
}

/** Approval is owned by the existing maintenance apply path, never by the model. */
export function applySchedule(root, plan, approved) {
  if (approved !== true) throw new Error('Explicit user approval required');
  if (realpathSync(root) !== plan.root || unitRoot() !== plan.home) throw new Error('Schedule context changed; preview again');
  filesAt(root, plan.name);
  assertUnchanged(plan.home, plan.expected);
  command('systemctl', ['--user', 'show', '--property=Version', '--value']);
  for (const type of ['timer', 'service']) {
    const native = properties(command('systemctl', ['--user', 'show', `${plan.unit}.${type}`, '--property=FragmentPath,DropInPaths']));
    if (native.DropInPaths) throw new Error('Schedule has active native drop-ins; manage those explicitly first');
    if (native.FragmentPath && native.FragmentPath !== join(plan.home, `systemd/user/${plan.unit}.${type}`)) throw new Error('A different native unit takes precedence; refusing schedule changes');
  }
  const completed = [];
  const run = args => { command('systemctl', ['--user', ...args]); completed.push(['systemctl', '--user', ...args].join(' ')); };
  try {
    // Stop the timer before replacing/removing native configuration. A running
    // service survives update, but stop/remove explicitly cancel its cgroup.
    const early = plan.action === 'update' ? 1 : ['stop', 'remove'].includes(plan.action) ? 2 : 0;
    for (const args of plan.commands.slice(0, early)) run(args);
    applyWrites(plan.home, plan.writes, plan.expected, approved, {
      afterWrites: () => { for (const args of plan.commands.slice(early)) run(args); },
    });
  } catch (error) {
    throw new Error(`Schedule apply failed: ${error.message}. External state may be partially changed; completed: ${completed.join('; ') || 'none'}. Inspect systemctl --user status ${plan.unit}.timer ${plan.unit}.service and native files in ${join(plan.home, 'systemd/user')}; preview again before recovery. File rollback cannot undo executions or manager state.`);
  }
  return `Schedule ${plan.name}: ${plan.action} applied. Inspect status and the journal; this is not functional task verification.`;
}

const properties = output => Object.fromEntries(output.split('\n').filter(line => line.includes('=')).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
/** Native configuration and manager observations, not a run/task database. */
export function scheduleStatus(root) {
  const home = unitRoot();
  const dir = join(home, 'systemd/user');
  const start = prefix(root);
  const names = existsSync(dir) ? [...new Set(readdirSync(dir).filter(f => f.startsWith(start) && /\.(service|timer)$/.test(f)).map(f => f.slice(start.length).replace(/\.(service|timer)$/, '')))].sort() : [];
  let manager;
  try { command('systemctl', ['--user', 'show', '--property=Version', '--value']); manager = { available: true }; }
  catch (error) { manager = { available: false, error: error.message }; }
  let linger;
  try { linger = command('loginctl', ['show-user', String(process.getuid()), '--property=Linger', '--value']); } catch { linger = 'unknown'; }
  const schedules = names.map(name => {
    try {
      const { unit, files, before } = filesAt(root, name);
      const result = { name, unit, files: files.map(path => ({ path: join(home, path), present: before[path] !== null })) };
      if (manager.available) for (const type of ['timer', 'service']) {
        try { result[type] = properties(command('systemctl', ['--user', 'show', `${unit}.${type}`, '--property=LoadState,ActiveState,SubState,UnitFileState,FragmentPath,DropInPaths,NextElapseUSecRealtime,LastTriggerUSec,Result,ExecMainCode,ExecMainStatus,ExecMainStartTimestamp,ExecMainExitTimestamp'])); }
        catch (error) { result[type] = { unavailable: error.message }; }
      }
      return result;
    } catch (error) { return { name, error: error.message }; }
  });
  return { manager, linger, schedules, note: 'Installed configuration and process results are not task success. Linger=no means runs after logout/reboot are not guaranteed; enable lingering separately with administrator approval. Logs: journalctl --user -u <unit>.service. Native edits/drop-ins can change execution guarantees.' };
}
