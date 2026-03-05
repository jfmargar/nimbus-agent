const crypto = require('crypto');

const CALLBACK_PREFIX = 'ga';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function summarizeApprovalContent(content) {
  if (!Array.isArray(content) || content.length === 0) return '';
  const lines = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'diff') {
      lines.push(`Cambio en ${item.path || '(sin ruta)'}`);
      continue;
    }
    if (item.type === 'content' && item.content?.type === 'text') {
      const text = String(item.content.text || '').trim();
      if (text) {
        lines.push(text);
      }
    }
  }
  return lines.join('\n').trim();
}

function buildApprovalMessage(request) {
  const title = String(request?.toolCall?.title || 'Acción sin título').trim();
  const kind = String(request?.toolCall?.kind || '').trim();
  const detail = summarizeApprovalContent(request?.toolCall?.content);
  const parts = [
    '<b>Gemini está esperando aprobación</b>',
    '',
    `<b>Acción:</b> ${escapeHtml(title)}`,
  ];
  if (kind) {
    parts.push(`<b>Tipo:</b> ${escapeHtml(kind)}`);
  }
  if (detail) {
    parts.push('');
    parts.push(escapeHtml(detail).slice(0, 1200));
  }
  parts.push('');
  parts.push('Elige una opción para continuar este turno.');
  return parts.join('\n');
}

function createTelegramApprovalService({ bot }) {
  const pendingApprovals = new Map();

  function findOption(options, kind) {
    return Array.isArray(options)
      ? options.find((option) => option?.kind === kind)
      : null;
  }

  async function requestApproval(ctx, request) {
    const approveOption =
      findOption(request?.options, 'allow_once') ||
      findOption(request?.options, 'allow_always');
    const rejectOption = findOption(request?.options, 'reject_once');
    if (!approveOption || !rejectOption) {
      throw new Error('Gemini pidió una aprobación que Nimbus no puede representar.');
    }

    const approvalId = crypto.randomBytes(6).toString('hex');
    const message = await ctx.reply(buildApprovalMessage(request), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Aprobar',
              callback_data: `${CALLBACK_PREFIX}:${approvalId}:approve`,
            },
            {
              text: 'Rechazar',
              callback_data: `${CALLBACK_PREFIX}:${approvalId}:reject`,
            },
          ],
        ],
      },
    });

    return new Promise((resolve, reject) => {
      const abortSignal = request?.signal;
      let abortListener = null;
      const cleanup = () => {
        if (abortSignal && abortListener) {
          abortSignal.removeEventListener('abort', abortListener);
          abortListener = null;
        }
      };
      const record = {
        chatId: ctx.chat?.id,
        topicId: ctx.message?.message_thread_id,
        messageId: message?.message_id,
        approveOptionId: approveOption.optionId,
        rejectOptionId: rejectOption.optionId,
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
      };
      pendingApprovals.set(approvalId, record);

      if (abortSignal) {
        abortListener = () => {
          if (!pendingApprovals.has(approvalId)) return;
          pendingApprovals.delete(approvalId);
          record.reject(new Error('La aprobación de Gemini fue cancelada.'));
        };
        if (abortSignal.aborted) {
          abortListener();
          return;
        }
        abortSignal.addEventListener('abort', abortListener, { once: true });
      }
    });
  }

  function registerHandlers() {
    bot.action(/^ga:([a-f0-9]+):(approve|reject)$/, async (ctx) => {
      const approvalId = ctx.match?.[1];
      const decision = ctx.match?.[2];
      const pending = pendingApprovals.get(approvalId);
      if (!pending) {
        await ctx.answerCbQuery('Esta aprobación ya no está activa.');
        return;
      }

      const currentChatId = ctx.chat?.id;
      const currentTopicId = ctx.callbackQuery?.message?.message_thread_id;
      if (
        currentChatId !== pending.chatId ||
        String(currentTopicId || '') !== String(pending.topicId || '')
      ) {
        await ctx.answerCbQuery('Esta aprobación pertenece a otro hilo.');
        return;
      }

      pendingApprovals.delete(approvalId);
      const optionId =
        decision === 'approve'
          ? pending.approveOptionId
          : pending.rejectOptionId;
      const statusText =
        decision === 'approve'
          ? '\n\nEstado: aprobado.'
          : '\n\nEstado: rechazado.';

      try {
        if (pending.messageId) {
          const originalText =
            ctx.callbackQuery?.message?.text ||
            ctx.callbackQuery?.message?.caption ||
            'Solicitud de aprobación';
          await bot.telegram.editMessageText(
            pending.chatId,
            pending.messageId,
            undefined,
            `${originalText}${statusText}`,
            {
              parse_mode: 'HTML',
            }
          );
        }
      } catch (err) {
        console.warn('Failed to edit approval message:', err);
      }

      await ctx.answerCbQuery(
        decision === 'approve' ? 'Aprobado' : 'Rechazado'
      );
      pending.resolve({ optionId });
    });
  }

  return {
    buildApprovalMessage,
    registerHandlers,
    requestApproval,
  };
}

module.exports = {
  buildApprovalMessage,
  createTelegramApprovalService,
};
