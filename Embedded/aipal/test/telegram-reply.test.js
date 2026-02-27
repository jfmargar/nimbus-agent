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
  await new Promise((resolve) => setTimeout(resolve, 800));
  await progress.finish();

  assert.equal(harness.edits.length, 1);
  assert.equal(harness.edits[0].text, 'Codex: razonando...');
  assert.deepEqual(harness.deletes, [{ chatId: 99, messageId: 1 }]);
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
