/** Distribution assets for the optional MCP interface, through the normal apply path.
 * Faur is private/Git-distributed: bundle its ordinary package files, not a second
 * implementation or a checkout link. The same bundle can maintain itself.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mcpConfig } from './mcp-auth-status.mjs';

const root = new URL('../', import.meta.url);
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const hash = text => createHash('sha256').update(text).digest('hex');
function sourceFiles() {
  const paths = ['package.json', 'LICENSE'];
  function walk(path) {
    for (const entry of readdirSync(new URL(path, root), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules') continue;
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) paths.push(child);
      else throw new Error(`Cannot bundle non-regular Faur asset: ${child}`);
    }
  }
  for (const path of ['src', 'extensions', 'skills/faur', 'mcp']) walk(path);
  return Object.fromEntries(paths.map(path => [`.faur-mcp/faur/${path}`, readFileSync(new URL(path, root), 'utf8')]));
}

function subscriptionInstructions(model) {
  const auth = model.mcpServer.auth;
  return auth ? readFileSync(new URL('mcp/subscription-registration.md', root), 'utf8').replaceAll('{{AUTH_FILE_ENV}}', auth.authFileEnv) : '';
}

function desiredFiles(model) {
  if (!model?.mcpServer) return {};
  return {
    ...sourceFiles(),
    '.faur-mcp/package.json': readFileSync(new URL('mcp/package.json', root), 'utf8'),
    '.faur-mcp/package-lock.json': readFileSync(new URL('mcp/package-lock.json', root), 'utf8'),
    '.faur-mcp/.gitignore': 'node_modules/\nauth-evidence.json\n',
    '.faur-mcp/config.json': json(mcpConfig(model)),
    '.pi/extensions/faur-mcp.ts': "// Developer maintenance only. MCP execution never discovers extensions.\nexport { default } from '../../.faur-mcp/faur/extensions/faur/index.ts';\n",
    '.faur-mcp/README.md': `# Project-local MCP agent\n\nInstall once from this directory: \`npm ci\`. Requires Node.js 22+ and npm.\nNo global Pi or Faur is required. Dependencies are pinned in package-lock.json.\n\n## Register locally\n\nAsk your coding agent to register this server for the current project using its\nclient-specific MCP configuration. Do not change global configuration.\n\n- Transport: stdio\n- Command: an absolute path to your Node.js executable\n- Arguments: one absolute path to \`faur/mcp/host.mjs\` in this directory\n- Working directory: this directory (optional; the entry point is cwd-independent)\n- Agent source: the parent directory of this directory\n- Target project: \`${model.mcpServer.projectRoot}\`, resolved relative to the agent source\n- Required environment variable names: ${(model.mcpServer.env ?? []).join(', ') || (model.mcpServer.auth ? '(none; subscription auth is supplied by the host broker)' : '(none declared; declare the model provider key before invoking)')}\n\nUse the client's supported environment/secret mechanism. Never paste credential\nvalues into committed resources. ${model.mcpServer.auth ? 'The host uses only the explicitly selected Pi subscription login; it does not load .env.' : 'The host does not read .env or global Pi logins.'}\n\`config.json\` defines the public catalog; it does not expose internal tools.\n${subscriptionInstructions(model)}\n## Maintain\n\nFrom the agent source directory, run \`pi\` and trust the project, then use\n\`/faur <request>\`. Without global Pi, run\n\`node .faur-mcp/node_modules/@earendil-works/pi-coding-agent/dist/cli.js\`.\nThe local extension loads bundled Faur for developer sessions only. If a global\nFaur extension is also installed, disable that duplicate for this project.\n\nFinish active calls before editing or applying changes, then restart/reconnect\nthe MCP server. There is no hot reload. One call runs at a time per server;\noverlap is rejected, not queued. Multiple server processes are not coordinated.\nAfter dependency changes, run \`npm ci\` here again before restarting.\n\n## Execution and limits\n\nEach call starts fresh Pi SDK execution in a child process. Runtime receives\nonly the explicit built-in tool allowlist and declared environment variables.\nIt reads the authored part of .pi/APPEND_SYSTEM.md and the operation prompt;\nit does not load developer extensions, specialists, skills, upstream MCP,\nproject/global settings, parent instructions or ${model.mcpServer.auth ? 'unrelated credentials. Selected subscription request auth comes from the host broker.' : 'global credentials.'}\nTools use the explicit target project as their working directory.\nConfiguration isolation and tool selection are enforced by the SDK loader;\nthis is NOT OS/filesystem isolation. Read can read outside the project; bash\ncan access the user's files and credentials. Instructions are advisory.\nDo not use this as a boundary against hostile callers or untrusted projects.\n\nPOSIX process groups are terminated on completion, error, timeout, cancellation,\nstdin close and SIGTERM/SIGINT. Windows hosting is refused in this first slice.\nPi aborts active tools too. Commands that deliberately background/detach work\ncan outlive a tool call; escaped groups/daemons are outside this guarantee.\nOnly final answer text is returned, not logs, environment or provider errors.\nDeclared secret values are redacted from answer text as defense in depth, not\na general exfiltration boundary. All allowed tools share the call's credentials.\nAn answer is not proof that the requested audit/review succeeded.\n`,
  };
}

/** Recorded identities may select only this feature's files, never arbitrary paths. */
export function mcpRecordedPaths(text) {
  if (text === undefined || text === null) return [];
  const recorded = JSON.parse(text);
  if (!recorded || typeof recorded !== 'object' || Array.isArray(recorded)) throw new Error('Invalid MCP generated manifest');
  for (const [path, fingerprint] of Object.entries(recorded)) {
    const allowed = path === '.pi/extensions/faur-mcp.ts' || /^\.faur-mcp\/(?:faur\/[A-Za-z0-9_./-]+|package(?:-lock)?\.json|config\.json|README\.md|\.gitignore)$/.test(path);
    if (!allowed || path.split('/').some(part => !part || part === '.' || part === '..') || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error(`Invalid MCP manifest path or fingerprint: ${path}`);
  }
  return Object.keys(recorded);
}

/** Library distribution is approved like a package, not thousands of source lines.
 * Operational config and authored prompts retain their complete ordinary diffs.
 */
export function mcpDistributionSummary(path, before, after) {
  if (!path.startsWith('.faur-mcp/faur/') && !['.faur-mcp/package.json', '.faur-mcp/package-lock.json', '.faur-mcp/generated.json'].includes(path)) return null;
  return { kind: 'bundled Faur distribution', beforeSha256: before === null ? null : hash(before), afterSha256: after === null ? null : hash(after), note: 'Executable library/locked dependency asset; changes what runs. Review the Faur package source before approving.', ...(path === '.faur-mcp/package.json' && after !== null ? { dependencies: JSON.parse(after).dependencies } : {}) };
}

export function mcpProjectPaths(model) {
  return model?.mcpServer ? [...Object.keys(desiredFiles(model)), '.faur-mcp/generated.json'] : [];
}

/** Every bundled byte is edit-protected. Unknown/unmarked existing files conflict. */
export function mcpProjectFiles(model, existing) {
  const desired = desiredFiles(model);
  const previousPaths = mcpRecordedPaths(existing['.faur-mcp/generated.json']);
  if (!Object.keys(desired).length && !previousPaths.length) return [];
  const recorded = JSON.parse(existing['.faur-mcp/generated.json'] ?? '{}');
  const files = Object.entries(desired).map(([path, content]) => {
    const current = existing[path];
    const action = current === undefined ? 'create' : current === content ? 'none' : recorded[path] === hash(current) ? 'write' : 'conflict';
    return { path, content: action === 'conflict' ? current : content, action, ...(action === 'conflict' ? { desired: content, reason: 'bundled/generated MCP resource edited; reconcile explicitly' } : {}) };
  });
  for (const path of previousPaths.filter(path => !Object.hasOwn(desired, path) && path !== '.faur-mcp/.gitignore')) {
    const current = existing[path];
    if (current === undefined) continue;
    files.push({ path, content: current, action: recorded[path] === hash(current) ? 'remove' : 'conflict', reason: 'removed MCP distribution asset; edited files require explicit reconciliation' });
  }
  const content = json(Object.fromEntries(Object.entries(desired).map(([path, text]) => [path, hash(text)])));
  const path = '.faur-mcp/generated.json';
  files.push({ path, content: Object.keys(desired).length ? content : '', action: !Object.keys(desired).length ? 'remove' : existing[path] === undefined ? 'create' : existing[path] === content ? 'none' : 'write' });
  return files;
}
