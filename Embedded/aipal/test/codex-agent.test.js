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

test('buildInteractiveNewSessionCommand uses codex interactive CLI without exec', () => {
  const command = codexAgent.buildInteractiveNewSessionCommand({
    promptExpression: '"$PROMPT"',
    cwd: '/Users/test/project-a',
    model: 'gpt-5-codex',
    thinking: 'medium',
  });

  assert.match(command, /^codex /);
  assert.doesNotMatch(command, /\bexec\b/);
  assert.match(command, /--no-alt-screen/);
  assert.match(command, /-C '\/Users\/test\/project-a'/);
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

test('parseInteractiveOutput strips warnings and returns last meaningful line', () => {
  const parsed = codexAgent.parseInteractiveOutput(`
WARNING: proceeding, even though we could not update PATH
Continue anyway? [y/N]:
\u001b[32mRespuesta útil\u001b[0m
  `);

  assert.equal(parsed.text, 'Respuesta útil');
  assert.equal(parsed.sawText, true);
});

test('parseInteractiveOutput drops tip-only terminal noise', () => {
  const parsed = codexAgent.parseInteractiveOutput(`
\u001b[?2004hTip: Use /help for commands
For more information, try '--help'.
  `);

  assert.equal(parsed.text, '');
  assert.equal(parsed.sawText, false);
});

test('parseInteractiveOutput extracts thread id from resume hint', () => {
  const parsed = codexAgent.parseInteractiveOutput(`
Token usage: total=7215 input=7146 output=69
To continue this session, run codex resume 019ca828-c4e9-7cc1-9be5-0a5f110110ce
  `);

  assert.equal(parsed.threadId, '019ca828-c4e9-7cc1-9be5-0a5f110110ce');
});
