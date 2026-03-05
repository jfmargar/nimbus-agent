const test = require('node:test');
const assert = require('node:assert/strict');

const { createTelegramReplyService } = require('../src/services/telegram-reply');

function createServiceHarness() {
  const edits = [];
  const deletes = [];
  let replyCount = 0;
  const service = createTelegramReplyService({
    bot: {
      telegram: {
        deleteMessage: async (chatId, messageId) => {
          deletes.push({ chatId, messageId });
        },
        editMessageText: async (chatId, messageId, _inlineMessageId, text) => {
          edits.push({ chatId, messageId, text });
        },
        sendMessage: async () => {},
      },
    },
    chunkMarkdown: (text) => [text],
    chunkText: (text) => [text],
    documentDir: '/tmp',
    extractDocumentTokens: (text) => ({ cleanedText: text, documentPaths: [] }),
    extractImageTokens: (text) => ({ cleanedText: text, imagePaths: [] }),
    formatError: (err) => err.message,
    imageDir: '/tmp',
    isPathInside: () => true,
    markdownToTelegramHtml: (text) => text,
  });

  const ctx = {
    chat: { id: 99 },
    reply: async (text) => {
      replyCount += 1;
      return { message_id: replyCount, text };
    },
  };

  return {
    ctx,
    deletes,
    edits,
    service,
  };
}

test('beginProgress edits a single telegram message and deletes it on finish', async () => {
  const harness = createServiceHarness();

  const progress = await harness.service.beginProgress(
    harness.ctx,
    'Codex: iniciando sesion...'
  );
  await progress.update('Codex: razonando...');
  await progress.finish();

  assert.equal(harness.edits.length, 1);
  assert.equal(harness.edits[0].text, 'Codex: razonando...');
  assert.deepEqual(harness.deletes, [{ chatId: 99, messageId: 1 }]);
});

test('beginProgress coalesces rapid updates and keeps the latest visible text', async () => {
  const harness = createServiceHarness();

  const progress = await harness.service.beginProgress(
    harness.ctx,
    'Codex: iniciando sesion...'
  );
  await progress.update('Paso 1');
  await progress.update('Paso 2');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await progress.finish();

  assert.deepEqual(
    harness.edits.map((edit) => edit.text),
    ['Paso 1', 'Paso 2']
  );
});

test('beginProgress prioritizes feedback text over command updates', async () => {
  const harness = createServiceHarness();

  const progress = await harness.service.beginProgress(
    harness.ctx,
    'Codex: iniciando sesion...'
  );
  await progress.updateEvent({
    type: 'status',
    phase: 'running',
    message: 'Voy a revisar el archivo App.kt antes de compilar.',
  });
  await progress.updateEvent({
    type: 'tool_activity',
    tool: './gradlew test',
    message: 'Codex: ejecutando comando: ./gradlew test',
  });
  await progress.finish();

  assert.deepEqual(
    harness.edits.map((edit) => edit.text),
    ['Voy a revisar el archivo App.kt antes de compilar.']
  );
});

test('renderProgressEvent prefers explicit event messages', () => {
  const harness = createServiceHarness();

  assert.equal(
    harness.service.renderProgressEvent({
      type: 'tool_activity',
      tool: 'git status',
      message: 'Codex: ejecutando comando: git status',
    }),
    'Codex: ejecutando comando: git status'
  );
});

test('renderProgressEvent shows agent commentary from output text', () => {
  const harness = createServiceHarness();

  assert.equal(
    harness.service.renderProgressEvent({
      type: 'output_text',
      text: 'Voy a analizar el archivo X antes de compilar.',
    }),
    'Voy a analizar el archivo X antes de compilar.'
  );
});

test('beginProgress prioritizes textual feedback over command activity', async () => {
  const harness = createServiceHarness();

  const progress = await harness.service.beginProgress(
    harness.ctx,
    'Codex: iniciando sesion...'
  );
  await progress.updateEvent({
    type: 'status',
    phase: 'running',
    source: 'session_feedback',
    message: '**Checking repository layout** I am verifying the domain repository.',
  });
  await progress.updateEvent({
    type: 'tool_activity',
    tool: 'git status',
    message: 'Codex: ejecutando comando: git status',
  });
  await progress.finish();

  assert.deepEqual(harness.edits.map((edit) => edit.text), [
    '**Checking repository layout** I am verifying the domain repository.',
  ]);
});

test('getProgressEventPriority marks command activity as fallback', () => {
  const harness = createServiceHarness();

  assert.equal(
    harness.service.getProgressEventPriority({
      type: 'tool_activity',
      tool: 'git status',
      message: 'Codex: ejecutando comando: git status',
    }),
    'fallback'
  );
  assert.equal(
    harness.service.getProgressEventPriority({
      type: 'status',
      phase: 'running',
      source: 'session_feedback',
      message: 'Checking repository layout',
    }),
    'textual'
  );
});
