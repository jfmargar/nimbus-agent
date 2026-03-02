const test = require('node:test');
const assert = require('node:assert/strict');

const geminiAgent = require('../src/agents/gemini');

test('buildCommand uses default approval mode and forwards model and resume id', () => {
  const command = geminiAgent.buildCommand({
    prompt: 'hola',
    threadId: 'session-123',
    model: 'gemini-2.5-pro',
  });

  assert.match(command, /^gemini /);
  assert.match(command, /--approval-mode default/);
  assert.doesNotMatch(command, /--yolo/);
  assert.match(command, /--model 'gemini-2\.5-pro'/);
  assert.match(command, /--resume 'session-123'/);
});

test('parseOutput extracts JSON response from noisy PTY output', () => {
  const parsed = geminiAgent.parseOutput(`
Loaded cached credentials.
Loading extension: Stitch
{"response":"Hola desde Gemini"}
  `);

  assert.deepEqual(parsed, {
    text: 'Hola desde Gemini',
    threadId: undefined,
    sawJson: true,
  });
});

test('parseOutput collapses capacity errors into a concise message', () => {
  const parsed = geminiAgent.parseOutput(`
Attempt 1 failed with status 429. Retrying with backoff... GaxiosError: [{
  "error": {
    "code": 429,
    "message": "No capacity available for model gemini-3-flash-preview on the server"
  }
}]
  `);

  assert.equal(
    parsed.text,
    'No capacity available for model gemini-3-flash-preview on the server'
  );
  assert.equal(parsed.sawJson, false);
});
