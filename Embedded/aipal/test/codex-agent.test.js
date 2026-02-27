const test = require('node:test');
const assert = require('node:assert/strict');

const codexAgent = require('../src/agents/codex');

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
