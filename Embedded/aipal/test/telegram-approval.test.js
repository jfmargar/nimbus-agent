const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildApprovalMessage,
  createTelegramApprovalService,
} = require('../src/services/telegram-approval');

test('buildApprovalMessage renders a clear approval summary', () => {
  const message = buildApprovalMessage({
    toolCall: {
      title: 'Run shell command',
      kind: 'execute',
      content: [
        {
          type: 'content',
          content: {
            type: 'text',
            text: 'ls -la',
          },
        },
      ],
    },
  });

  assert.match(message, /Gemini está esperando aprobación/);
  assert.match(message, /Run shell command/);
  assert.match(message, /ls -la/);
});

test('telegram approval service resolves approve actions from inline buttons', async () => {
  let actionHandler = null;
  const edits = [];
  let callbackData = '';
  const bot = {
    action(pattern, handler) {
      actionHandler = { pattern, handler };
    },
    telegram: {
      editMessageText: async (chatId, messageId, _inlineMessageId, text) => {
        edits.push({ chatId, messageId, text });
      },
    },
  };
  const service = createTelegramApprovalService({ bot });
  service.registerHandlers();

  const ctx = {
    chat: { id: 77 },
    message: { message_thread_id: 88 },
    reply: async (_text, extra) => {
      callbackData = extra.reply_markup.inline_keyboard[0][0].callback_data;
      return { message_id: 21 };
    },
  };

  const approvalPromise = service.requestApproval(ctx, {
    signal: null,
    options: [
      { optionId: 'proceed_once', kind: 'allow_once' },
      { optionId: 'cancel', kind: 'reject_once' },
    ],
    toolCall: {
      title: 'Run shell command',
      kind: 'execute',
      content: [],
    },
  });
  await Promise.resolve();

  assert.ok(actionHandler);
  const match = actionHandler.pattern.exec(callbackData);
  assert.ok(match);

  const callbackCtx = {
    match,
    chat: { id: 77 },
    callbackQuery: {
      message: {
        message_thread_id: 88,
        text: buildApprovalMessage({
          toolCall: { title: 'Run shell command', kind: 'execute', content: [] },
        }),
      },
    },
    answerCbQuery: async () => {},
  };
  await actionHandler.handler(callbackCtx);

  const decision = await approvalPromise;
  assert.deepEqual(decision, { optionId: 'proceed_once' });
  assert.equal(edits.length, 1);
  assert.match(edits[0].text, /Estado: aprobado/);
});
