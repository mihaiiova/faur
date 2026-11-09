import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withBaseline, withBaselineTools } from '../src/tool-selection.mjs';
import { validateSystem } from '../src/validate.mjs';
import { generateProject } from '../src/generate.mjs';

const base = { schema: 1, name: 'tools', orchestrator: { name: 'lead', model: 'example/model' } };

test('omitted, empty and explicit tools use the approved browsing baseline', () => {
  assert.deepEqual(withBaseline(undefined), ['read', 'ls', 'find', 'grep']);
  assert.deepEqual(withBaseline([]), []);
  assert.deepEqual(withBaseline(['write']), ['write', 'read', 'ls', 'find', 'grep']);
  assert.deepEqual(withBaseline(['codemode']), ['codemode', 'read', 'ls', 'find', 'grep']);
  assert.deepEqual(withBaselineTools(base).orchestrator.tools, ['read', 'ls', 'find', 'grep']);
});

test('policies are rejected rather than silently ignored', () => {
  const result = validateSystem({ ...base, policies: { enforced: [] } });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /unknown key "policies"/);
});

test('generation emits browsing for omitted tools and no tools for empty lists', () => {
  const model = { ...base, agents: [{ name: 'reader', model: 'example/model' }, { name: 'empty', model: 'example/model', tools: [] }] };
  const files = generateProject(model).files;
  const settings = JSON.parse(files.find(f => f.path === '.pi/settings.json').content);
  assert.deepEqual(settings.defaultTools, ['read', 'ls', 'find', 'grep']);
  const reader = files.find(f => f.path === '.pi/agents/reader.md').content;
  const empty = files.find(f => f.path === '.pi/agents/empty.md').content;
  assert.match(reader, /tools:\n  - read\n  - ls\n  - find\n  - grep/);
  assert.match(empty, /tools:\nmodel:/);
});
