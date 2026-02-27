const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clearProjectOverride,
  getProjectOverride,
  getProjectOverrideKey,
  setProjectOverride,
} = require('../src/project-overrides');

test('project overrides are keyed by chat, topic, and agent', () => {
  const overrides = new Map();

  setProjectOverride(overrides, 100, 10, 'codex', '/tmp/project-a');
  setProjectOverride(overrides, 100, 11, 'codex', '/tmp/project-b');
  setProjectOverride(overrides, 100, 10, 'claude', '/tmp/project-c');

  assert.equal(getProjectOverride(overrides, 100, 10, 'codex'), '/tmp/project-a');
  assert.equal(getProjectOverride(overrides, 100, 11, 'codex'), '/tmp/project-b');
  assert.equal(getProjectOverride(overrides, 100, 10, 'claude'), '/tmp/project-c');
  assert.equal(getProjectOverride(overrides, 100, 11, 'claude'), undefined);
});

test('project overrides normalize root topic and can be cleared', () => {
  const overrides = new Map();
  const key = getProjectOverrideKey(42, undefined, 'codex');

  setProjectOverride(overrides, 42, undefined, 'codex', '/tmp/root-project');
  assert.equal(key, '42:root:codex');
  assert.equal(getProjectOverride(overrides, 42, 'root', 'codex'), '/tmp/root-project');

  assert.equal(clearProjectOverride(overrides, 42, undefined, 'codex'), true);
  assert.equal(getProjectOverride(overrides, 42, undefined, 'codex'), undefined);
});
