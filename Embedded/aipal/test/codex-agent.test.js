const test = require('node:test');
const assert = require('node:assert/strict');

const codexAgent = require('../src/agents/codex');

test('buildCommand uses codex exec with resume when thread exists', () => {
  const command = codexAgent.buildCommand({
    promptExpression: '"$PROMPT"',
    threadId: 'thread-123',
    model: 'gpt-5-codex',
    thinking: 'medium',
  });

  assert.match(command, /^codex exec resume /);
  assert.match(command, /--json/);
  assert.match(command, /--model 'gpt-5-codex'/);
  assert.match(command, /model_reasoning_effort="medium"/);
  assert.match(command, /"\$PROMPT"$/);
});

test('parseOutput returns final message and thread id from json events', () => {
  const parsed = codexAgent.parseOutput(`
{"type":"thread.started","thread_id":"thread-123"}
{"type":"item.completed","item":{"type":"agent_message","text":"respuesta"}}
  `);

  assert.equal(parsed.threadId, 'thread-123');
  assert.equal(parsed.text, 'respuesta');
  assert.equal(parsed.sawJson, true);
});
