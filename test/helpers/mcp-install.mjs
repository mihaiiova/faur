/** Install only published dependencies; native Pi owns source package installation. */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

export function installMcp(source) {
  const cwd = join(source, '.faur-mcp');
  const home = mkdtempSync(join(tmpdir(), 'faur-install-'));
  const env = { HOME: home, PI_CODING_AGENT_DIR: home, PATH: `${cwd}/node_modules/.bin:/usr/bin:/bin` };
  const run = (command, args, dir) => {
    const result = spawnSync(command, args, { cwd: dir, env, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  };
  try {
    run('npm', ['ci', '--ignore-scripts'], cwd);
    const settings = JSON.parse(readFileSync(join(source, '.pi/settings.json'), 'utf8'));
    for (const pkg of settings.packages ?? []) run(process.execPath, [join(cwd, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), 'install', '--local', '--approve', typeof pkg === 'string' ? pkg : pkg.source], source);
  } finally { rmSync(home, { recursive: true, force: true }); }
}
