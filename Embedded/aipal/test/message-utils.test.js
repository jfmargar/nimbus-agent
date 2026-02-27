const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSharedSessionPrompt } = require('../src/message-utils');

test('buildSharedSessionPrompt returns plain text when there is only user text', () => {
  assert.equal(buildSharedSessionPrompt('Hola'), 'Hola');
});

test('buildSharedSessionPrompt includes minimal image and document context', () => {
  const prompt = buildSharedSessionPrompt(
    'Revisa',
    ['/tmp/image.png'],
    '',
    ['/tmp/doc.pdf']
  );

  assert.match(prompt, /^Revisa/);
  assert.match(prompt, /User sent image file\(s\):/);
  assert.match(prompt, /- \/tmp\/image\.png/);
  assert.match(prompt, /Read images from those paths if needed\./);
  assert.match(prompt, /User sent document file\(s\):/);
  assert.match(prompt, /- \/tmp\/doc\.pdf/);
  assert.match(prompt, /Read documents from those paths if needed\./);
});

test('buildSharedSessionPrompt includes script context without bootstrap noise', () => {
  const prompt = buildSharedSessionPrompt('Hazlo', [], 'resultado script', []);

  assert.match(prompt, /Context from last slash command output:/);
  assert.match(prompt, /resultado script/);
  assert.doesNotMatch(prompt, /Bootstrap config:/);
  assert.doesNotMatch(prompt, /Relevant memory retrieved:/);
  assert.doesNotMatch(prompt, /Output style for Telegram:/);
});
