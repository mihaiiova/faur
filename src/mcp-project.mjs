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
    '.pi/extensions/faur-mcp.ts': `// Developer maintenance only: never import the maker in native agent execution.
export default async function (pi) {
  if (process.env.FAUR_MCP_RUNTIME === '1') return;
  const { default: maintain } = await import('../../.faur-mcp/faur/extensions/faur/index.ts');
  return maintain(pi);
}
`,
    '.faur-mcp/README.md': `# Project-local MCP agent

Requires Node.js >=22.19.0 and npm. Install locked host dependencies here with
\`npm ci\`. No global Pi or Faur is required. Separately review and install
source-declared Pi packages using native Pi in the agent source; operation
calls never install missing packages. Reinstall when dependency pins change.

## Register locally

Use your client's supported local MCP configuration (never global registration):

- Transport: stdio
- Command: an absolute path to Node.js
- Argument: the absolute path to \`faur/mcp/host.mjs\` in this directory
- Agent source S: the parent directory of this directory
- Target T: \`${model.mcpServer.projectRoot}\`, relative to S
- Required environment names: ${(model.mcpServer.env ?? []).join(', ') || '(none declared)'}

Working directory at registration does not select resources. Only named env
grants plus a small fixed environment reach native lead/children/processes.
PATH can be explicitly granted for native toolchains; HOME, Pi/Node loader
configuration and ambient globals cannot. Never commit credential values.
${subscriptionInstructions(model)}
## Native execution and trust — amendment 2026-11-19

This supersedes the unpublished source/workspace experiment, reduced runtime
and lead-only auth broker. Published unmodified Pi 1.5.2 runs each fresh SDK
session with cwd=S (the source), not T. Native settings, authored instructions,
skills, templates, specialists, extensions, packages, commands and upstream MCP
load by ordinary Pi discovery. Only the bundled developer maintenance extension
opts out via an internal environment marker before importing Faur; that marker
is not a security boundary. Genuine authored extensions load normally.

Every operation supplies the absolute T and validated JSON arguments as task
context after native skill/template expansion. Target work must use absolute
paths or shell cd T; commands/MCP receive T in arguments when needed. This is
ADVISORY, not automatic tool/workspace rebasing or a sandbox. Relative assets,
commands, upstream MCP and default specialist cwd remain S. Fresh conversations
do not isolate source files/memory: keep project-specific state under T.

A fresh Pi config/state directory and explicit env grants are used, but discovery
is NOT hermetic: ancestor instructions/skills and explicit source paths follow
ordinary native policies. Foreground specialists do not automatically inherit
all lead extensions/context/skills: declare extension resources in native agent
metadata and select skills/inheritance as supported by pi-subagents. Background
children have different native inheritance. No custom inheritance is added.

Builtin MCP/codemode/tool_search factories are bound with native session_start.
Pi connects enabled servers in the background; first prompts wait for direct
servers, and deferred tools wait when needed. Startup alone does not prove all
servers connected. Verify actual configured tools. Known package/resource and
extension errors reported by the SDK fail actionable; no operation installs code.
Native discovery may skip nonexistent resource paths without diagnostics: startup
is not exhaustive resource readiness, and no second discovery validator is added. No separate
mcpServer.tools list exists: native source tool selection applies.

Trusted lead, specialists, tools and subprocesses share OS permissions and any
explicitly selected credential store, including other entries. They can read
outside T. There is no automatic login, global auth discovery or
model/provider/API-billing fallback. Provider and extension logs are withheld;
only final answer text is returned. Exact declared env values (except non-secret
PATH) and observed selected tokens are redacted as defense in depth, not an
exfiltration boundary.
Truncated model answers are errors, not successful results.

## Lifecycle and maintenance

One active call per host; overlap is rejected, not queued. Input/output bounds
are 1 MiB. Timeout, cancellation, EOF and SIGTERM/SIGINT abort the native session,
emit native shutdown and terminate the POSIX worker group (SIGKILL after 250ms).
Windows hosting is refused. Native tools own cleanup of separately grouped
processes; same-group leftovers are killed even on success. Native detached
background specialists, escaped groups and daemons may outlive the operation;
this adapter does not supervise persistent work. Do not launch it in MCP calls.
Forced termination during native credential refresh can interrupt persistence
and require re-login; loss-free token rotation is not guaranteed.

Finish active calls before editing/applying, then restart/reconnect. Public
catalog/config are captured at host startup; source resources load per fresh
call. No watcher or hot reload. Separate hosts are not coordinated.

Maintain from S with \`pi\` and \`/faur <request>\`, or without global Pi:
\`node .faur-mcp/node_modules/@earendil-works/pi-coding-agent/dist/cli.js\`.
Trust the project to load the local maintenance extension. Disable duplicate
global Faur. Changes retain normal preview/approval/stale-state protections.
A successful run is not proof of task success; review the answer.
`,
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
