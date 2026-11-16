import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverProjectAgents, routeAgentRequest } from '../src/project-agents.mjs';

const design = 'schema: 1\nname: jared\norchestrator: { name: lead, model: fixture/model, tools: [] }\n';
function agent(root, name, text = design) {
  const path = join(root, '.agents', name);
  mkdirSync(join(path, '.pi'), { recursive: true });
  writeFileSync(join(path, '.pi/system.yaml'), text);
  return path;
}

test('discovers only direct .agents children with a Faur design; no registry or generated build required', t => {
  const root = mkdtempSync(join(tmpdir(), 'faur-discovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const jared = agent(root, 'jared');
  mkdirSync(join(jared, '.faur')); writeFileSync(join(jared, '.faur/build.json'), '{}');
  agent(root, 'research assistant');
  agent(root, 'broken', 'schema: [bad YAML');
  agent(root, 'skills');
  mkdirSync(join(root, '.agents/unrelated'));
  agent(root, 'nested/container');
  const result = discoverProjectAgents(root);
  assert.deepEqual(result.agents.map(a => a.name), ['broken', 'jared', 'research assistant']);
  assert.equal(result.agents.find(a => a.name === 'jared').root, jared);
  assert.equal(result.agents.find(a => a.name === 'jared').built, true);
  assert.equal(result.agents.find(a => a.name === 'research assistant').built, false);
  assert.equal(result.agents.find(a => a.name === 'broken').valid, false);
  assert.equal(result.agents.find(a => a.name === 'jared').valid, true);
});

test('discovery does not follow symlinks or execute target resources', t => {
  const root = mkdtempSync(join(tmpdir(), 'faur-discovery-links-'));
  const outside = mkdtempSync(join(tmpdir(), 'faur-outside-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  const jared = agent(outside, 'jared');
  mkdirSync(join(root, '.agents'));
  symlinkSync(jared, join(root, '.agents/linked'), 'dir');
  const poisoned = join(root, '.agents/poisoned'); mkdirSync(poisoned);
  symlinkSync(join(jared, '.pi'), join(poisoned, '.pi'), 'dir');
  const marker = join(root, '.agents/marker'); mkdirSync(join(marker, '.pi'), { recursive: true });
  symlinkSync(join(jared, '.pi/system.yaml'), join(marker, '.pi/system.yaml'));
  assert.deepEqual(discoverProjectAgents(root).agents, []);
  assert.equal(discoverProjectAgents(root).warnings.length, 3);
  rmSync(join(root, '.agents'), { recursive: true });
  symlinkSync(join(outside, '.agents'), join(root, '.agents'), 'dir');
  assert.throws(() => discoverProjectAgents(root), /symlink/i);
});

test('missing .agents is an empty inventory and a non-directory is explicitly refused', t => {
  const root = mkdtempSync(join(tmpdir(), 'faur-discovery-empty-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(discoverProjectAgents(root), { agents: [], warnings: [] });
  writeFileSync(join(root, '.agents'), 'authored file');
  assert.throws(() => discoverProjectAgents(root), /directory/i);
});

const agents = ['jared', 'researcher', 'research assistant'].map(name => ({ name, path: `.agents/${name}`, root: `/project/.agents/${name}` }));
test('routing supports explicit names and natural named requests without substring guessing', () => {
  assert.equal(routeAgentRequest('agents', agents).kind, 'list');
  assert.deepEqual(routeAgentRequest('agent jared status', agents), { kind: 'target', agent: agents[0], request: 'status' });
  assert.deepEqual(routeAgentRequest('Jared status', agents), { kind: 'target', agent: agents[0], request: 'status' });
  assert.equal(routeAgentRequest('Update Jared’s review operation', agents).agent, agents[0]);
  assert.equal(routeAgentRequest('Update jaredish', agents).kind, 'choose');
  assert.equal(routeAgentRequest('Update Jared and researcher', agents).agents.length, 2);
  assert.equal(routeAgentRequest('agent "research assistant" check', agents).agent, agents[2]);
  assert.equal(routeAgentRequest('agent missing status', agents).kind, 'missing');
  assert.equal(routeAgentRequest('agent ../outside status', agents).kind, 'missing');
  assert.equal(routeAgentRequest('', agents).kind, 'choose');
  assert.equal(routeAgentRequest('Create Bob like Jared', agents).kind, 'create');
  assert.equal(routeAgentRequest('create an agent in ./custom', agents).kind, 'create');
  assert.equal(routeAgentRequest('make Jared better', agents).agent, agents[0]);
});

test('case collisions never silently pick a target', () => {
  const collisions = [{ name: 'jared' }, { name: 'Jared' }];
  assert.equal(routeAgentRequest('Update JARED', collisions).kind, 'choose');
  assert.equal(routeAgentRequest('agent jared status', collisions).agent, collisions[0]);
});
