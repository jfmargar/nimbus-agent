const fs = require('fs/promises');

function createTelegramReplyService(options) {
  const {
    bot,
    chunkMarkdown,
    chunkText,
    documentDir,
    extractDocumentTokens,
    extractImageTokens,
    formatError,
    imageDir,
    isPathInside,
    markdownToTelegramHtml,
  } = options;
  const PROGRESS_UPDATE_INTERVAL_MS = 250;
  const TEXTUAL_PROGRESS_SUPPRESSION_MS = 4000;

  async function replyWithError(ctx, label, err) {
    const detail = formatError(err);
    const text = `${label}\n${detail}`.trim();
    for (const chunk of chunkText(text, 3500)) {
      await ctx.reply(chunk);
    }
  }

  function startTyping(ctx) {
    const send = async () => {
      try {
        await ctx.sendChatAction('typing');
      } catch (err) {
        console.error('Typing error', err);
      }
    };
    send();
    const timer = setInterval(send, 4000);
    return () => clearInterval(timer);
  }

  function renderProgressEvent(event) {
    if (!event || typeof event !== 'object') return '';
    if (typeof event.message === 'string' && event.message.trim()) {
      return event.message.trim();
    }
    if (event.type === 'output_text' && typeof event.text === 'string') {
      return summarizeProgressText(event.text);
    }
    if (event.type === 'status' && event.phase) {
      return `Codex: ${event.phase}`;
    }
    if (event.type === 'tool_activity' && event.tool) {
      return `Codex: ${event.tool}`;
    }
    if (event.type === 'error') {
      return 'Codex: error durante la ejecucion.';
    }
    return '';
  }

  function getProgressEventPriority(event) {
    if (!event || typeof event !== 'object') return 'ignore';
    if (event.type === 'error') return 'critical';
    if (event.type === 'output_text' && typeof event.text === 'string' && event.text.trim()) {
      return 'textual';
    }
    if (event.type === 'tool_activity') {
      return 'fallback';
    }
    if (
      event.type === 'status' &&
      typeof event.message === 'string' &&
      event.message.trim()
    ) {
      const message = event.message.trim();
      if (event.source === 'session_feedback') return 'textual';
      if (event.phase === 'running' && !/^Codex:\s/i.test(message)) {
        return 'textual';
      }
      if (
        event.phase === 'running' &&
        (/^Codex plan/i.test(message) || /^Codex:\s*actualizando plan/i.test(message))
      ) {
        return 'textual';
      }
      return 'status';
    }
    return 'ignore';
  }

  function summarizeProgressText(text) {
    const compact = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!compact) return '';
    return compact.length > 800 ? `${compact.slice(0, 797)}...` : compact;
  }

  async function beginProgress(ctx, initialText) {
    const message = await ctx.reply(String(initialText || 'Procesando...').trim());
    const chatId = ctx.chat?.id;
    const messageId = message?.message_id;
    let lastSentText = String(initialText || 'Procesando...').trim();
    let pendingText = '';
    let flushTimer = null;
    let active = true;
    let lastFlushAt = 0;
    let flushInFlight = null;
    let lastTextualEventAt = 0;

    async function flush(force = false) {
      if (!active || !chatId || !messageId) return;
      const nextText = String(pendingText || '').trim();
      if (!nextText || nextText === lastSentText) return;
      if (!force && flushTimer) return;
      pendingText = '';
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (flushInFlight) {
        return flushInFlight;
      }
      flushInFlight = (async () => {
        try {
          await bot.telegram.editMessageText(chatId, messageId, undefined, nextText);
          lastSentText = nextText;
          lastFlushAt = Date.now();
        } catch (err) {
          const detail = String(err?.description || err?.message || '');
          if (detail.includes('message is not modified')) {
            lastSentText = nextText;
            lastFlushAt = Date.now();
            return;
          }
          console.warn('Progress update error', err);
        } finally {
          flushInFlight = null;
          if (active && pendingText && pendingText !== lastSentText) {
            scheduleFlush();
          }
        }
      })();
      try {
        await flushInFlight;
      } catch {
        // flushInFlight already logs failures.
      }
    }

    function scheduleFlush(delayMs = PROGRESS_UPDATE_INTERVAL_MS) {
      if (!active || flushTimer) return;
      flushTimer = setTimeout(() => {
        flush(true).catch((err) => {
          console.warn('Progress flush error', err);
        });
      }, Math.max(0, delayMs));
    }

    return {
      async updateEvent(event) {
        const priority = getProgressEventPriority(event);
        if (priority === 'ignore') return;
        const now = Date.now();
        if (
          priority === 'fallback' &&
          lastTextualEventAt > 0 &&
          now - lastTextualEventAt < TEXTUAL_PROGRESS_SUPPRESSION_MS
        ) {
          return;
        }
        const message = renderProgressEvent(event);
        if (!message) return;
        if (priority === 'textual' || priority === 'critical') {
          lastTextualEventAt = now;
        }
        await this.update(message);
      },
      async update(text) {
        const nextText = String(text || '').trim();
        if (!nextText || nextText === lastSentText) return;
        pendingText = nextText;
        const elapsedMs = Date.now() - lastFlushAt;
        if (!lastFlushAt || elapsedMs >= PROGRESS_UPDATE_INTERVAL_MS) {
          await flush(true);
          return;
        }
        scheduleFlush(PROGRESS_UPDATE_INTERVAL_MS - elapsedMs);
      },
      async finish() {
        if (!active) return;
        active = false;
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (flushInFlight) {
          try {
            await flushInFlight;
          } catch {
            // flushInFlight already logs failures.
          }
        }
        try {
          await bot.telegram.deleteMessage(chatId, messageId);
        } catch (err) {
          console.warn('Progress delete error', err);
        }
      },
      async fail(text) {
        if (!active) return;
        const nextText = String(text || '').trim();
        if (!nextText) return;
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        pendingText = nextText;
        await flush(true);
      },
    };
  }

  async function replyWithResponse(ctx, response) {
    const { cleanedText: afterImages, imagePaths } = extractImageTokens(
      response || '',
      imageDir
    );
    const { cleanedText, documentPaths } = extractDocumentTokens(
      afterImages,
      documentDir
    );
    const text = cleanedText.trim();
    if (text) {
      for (const chunk of chunkMarkdown(text, 3000)) {
        const formatted = markdownToTelegramHtml(chunk) || chunk;
        await ctx.reply(formatted, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
      }
    }
    const uniqueImages = Array.from(new Set(imagePaths));
    for (const imagePath of uniqueImages) {
      try {
        if (!isPathInside(imageDir, imagePath)) {
          console.warn('Skipping image outside IMAGE_DIR:', imagePath);
          continue;
        }
        await fs.access(imagePath);
        await ctx.replyWithPhoto({ source: imagePath });
      } catch (err) {
        console.warn('Failed to send image:', imagePath, err);
      }
    }
    const uniqueDocuments = Array.from(new Set(documentPaths));
    for (const documentPath of uniqueDocuments) {
      try {
        if (!isPathInside(documentDir, documentPath)) {
          console.warn('Skipping document outside DOCUMENT_DIR:', documentPath);
          continue;
        }
        await fs.access(documentPath);
        await ctx.replyWithDocument({ source: documentPath });
      } catch (err) {
        console.warn('Failed to send document:', documentPath, err);
      }
    }
    if (!text && uniqueImages.length === 0 && uniqueDocuments.length === 0) {
      await ctx.reply('(no response)');
    }
  }

  async function replyWithTranscript(ctx, transcript, replyToMessageId) {
    const header = 'Transcript:';
    const text = String(transcript || '').trim();
    const replyOptions = replyToMessageId
      ? { reply_to_message_id: replyToMessageId }
      : undefined;
    if (!text) {
      await ctx.reply(`${header}\n(vacía)`, replyOptions);
      return;
    }
    const maxChunkSize = Math.max(1, 3500 - header.length - 1);
    const chunks = chunkText(text, maxChunkSize);
    for (let i = 0; i < chunks.length; i += 1) {
      const prefix = i === 0 ? `${header}\n` : '';
      await ctx.reply(`${prefix}${chunks[i]}`, replyOptions);
    }
  }

  async function sendResponseToChat(chatId, response, sendOptions = {}) {
    const { topicId } = sendOptions;
    const threadExtra = topicId ? { message_thread_id: topicId } : {};
    const { cleanedText: afterImages, imagePaths } = extractImageTokens(
      response || '',
      imageDir
    );
    const { cleanedText, documentPaths } = extractDocumentTokens(
      afterImages,
      documentDir
    );
    const text = cleanedText.trim();
    if (text) {
      for (const chunk of chunkMarkdown(text, 3000)) {
        const formatted = markdownToTelegramHtml(chunk) || chunk;
        await bot.telegram.sendMessage(chatId, formatted, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...threadExtra,
        });
      }
    }
    const uniqueImages = Array.from(new Set(imagePaths));
    for (const imagePath of uniqueImages) {
      try {
        if (!isPathInside(imageDir, imagePath)) continue;
        await fs.access(imagePath);
        await bot.telegram.sendPhoto(chatId, { source: imagePath }, threadExtra);
      } catch (err) {
        console.warn('Failed to send image:', imagePath, err);
      }
    }
    const uniqueDocuments = Array.from(new Set(documentPaths));
    for (const documentPath of uniqueDocuments) {
      try {
        if (!isPathInside(documentDir, documentPath)) continue;
        await fs.access(documentPath);
        await bot.telegram.sendDocument(
          chatId,
          { source: documentPath },
          threadExtra
        );
      } catch (err) {
        console.warn('Failed to send document:', documentPath, err);
      }
    }
  }

  return {
    beginProgress,
    getProgressEventPriority,
    replyWithError,
    replyWithResponse,
    renderProgressEvent,
    replyWithTranscript,
    sendResponseToChat,
    startTyping,
    textualProgressSuppressionMs: TEXTUAL_PROGRESS_SUPPRESSION_MS,
  };
}

module.exports = {
  createTelegramReplyService,
};
