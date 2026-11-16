/** Project-local inventory and deterministic command routing. No registry, installs,
 * recursive discovery, target resource loading or execution.
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { safePath } from './maintenance-store.mjs';
import { loadYaml } from './yaml-loader.mjs';
import { validateSystem } from './validate.mjs';

export function discoverProjectAgents(project) {
  const base = safePath(resolve(project), '.agents');
  if (!existsSync(base)) return { agents: [], warnings: [] };
  if (!lstatSync(base).isDirectory()) throw new Error('.agents must be a directory');
  const agents = [], warnings = [];
  for (const entry of readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'skills') continue;
    if (/[\x00-\x1f\x7f]/.test(entry.name)) { warnings.push('Skipped an .agents entry with control characters in its name'); continue; }
    const path = `.agents/${entry.name}`;
    if (entry.isSymbolicLink()) { warnings.push(`Skipped symlink: ${path}`); continue; }
    if (!entry.isDirectory()) continue;
    try {
      const marker = safePath(project, `${path}/.pi/system.yaml`);
      if (!existsSync(marker)) continue;
      if (!lstatSync(marker).isFile()) { warnings.push(`Not a regular Faur design: ${path}/.pi/system.yaml`); continue; }
      let valid = false;
      try { valid = validateSystem(loadYaml().parse(readFileSync(marker, 'utf8'))).ok; } catch { /* Keep broken designs discoverable, without echoing file contents. */ }
      let built = false;
      try {
        const record = safePath(project, `${path}/.faur/build.json`);
        built = existsSync(record) && lstatSync(record).isFile();
      } catch { warnings.push(`Ignored unsafe build record: ${path}/.faur/build.json`); }
      agents.push({ name: entry.name, path, root: resolve(project, path), valid, built });
    } catch { warnings.push(`Skipped unsafe or unreadable Faur design: ${path}`); }
  }
  return { agents, warnings };
}

const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Named targets win; ambiguous requests require a picker or explicit syntax.
 * Creation intent never silently retargets an existing agent mentioned as an example.
 */
export function routeAgentRequest(request, agents) {
  request = request.trim();
  if (request === 'agents') return { kind: 'list' };
  const explicit = /^agent\s+(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+([\s\S]*))?$/.exec(request);
  if (explicit) {
    const name = explicit[1] ?? explicit[2] ?? explicit[3];
    const exact = agents.find(agent => agent.name === name);
    const matches = exact ? [exact] : agents.filter(agent => agent.name.toLowerCase() === name.toLowerCase());
    return matches.length === 1 ? { kind: 'target', agent: matches[0], request: explicit[4] ?? '' }
      : matches.length ? { kind: 'choose', agents: matches, request: explicit[4] ?? '', ambiguous: true } : { kind: 'missing', name };
  }
  if (/^(?:create|build|design|new)(?:\s|$)/i.test(request)) return { kind: 'create', request };
  const matches = agents.filter(agent => new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped(agent.name)}(?=$|[^\\p{L}\\p{N}_-])`, 'iu').test(request));
  if (matches.length === 1) {
    const prefix = new RegExp(`^${escaped(matches[0].name)}(?:\\s+|$)`, 'i');
    return { kind: 'target', agent: matches[0], request: request.replace(prefix, '') };
  }
  return { kind: 'choose', agents: matches.length ? matches : agents, request, ambiguous: matches.length > 1 };
}
