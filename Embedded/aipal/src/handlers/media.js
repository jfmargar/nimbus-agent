function registerMediaHandlers(options) {
  const {
    bot,
    beginProgress,
    buildMemoryThreadKey,
    buildTopicKey,
    captureMemoryEvent,
    codexProgressUpdatesEnabled,
    documentDir,
    downloadTelegramFile,
    extractMemoryText,
    getAudioPayload,
    getDocumentPayload,
    getImagePayload,
    getTopicId,
    imageDir,
    enqueue,
    replyWithError,
    replyWithResponse,
    replyWithTranscript,
    renderProgressEvent,
    resolveEffectiveAgentId,
    runAgentForChat,
    safeUnlink,
    startTyping,
    transcribeAudio,
  } = options;

  function shouldUseAgentProgress(effectiveAgentId) {
    return (
      typeof beginProgress === 'function' &&
      ((effectiveAgentId === 'codex' && codexProgressUpdatesEnabled) ||
        effectiveAgentId === 'gemini' ||
        effectiveAgentId === 'opencode')
    );
  }

  function getProgressInitialText(effectiveAgentId) {
    if (effectiveAgentId === 'gemini') return 'Gemini: iniciando sesión...';
    if (effectiveAgentId === 'opencode') return 'Opencode: iniciando sesión...';
    return 'Codex: iniciando sesion...';
  }

  function getProgressFailureText(effectiveAgentId) {
    if (effectiveAgentId === 'gemini') return 'Gemini: error durante la ejecución.';
    if (effectiveAgentId === 'opencode') return 'Opencode: error durante la ejecución.';
    return 'Codex: error durante la ejecucion.';
  }

  async function createExecutionFeedback(ctx, effectiveAgentId) {
    const useProgress = shouldUseAgentProgress(effectiveAgentId);
    if (!useProgress) {
      return {
        onEvent: undefined,
        progress: null,
        stopTyping: startTyping(ctx),
      };
    }
    const progress = await beginProgress(
      ctx,
      getProgressInitialText(effectiveAgentId)
    );
    return {
      onEvent: async (event) => {
        if (!progress) return;
        if (typeof progress.updateEvent === 'function') {
          await progress.updateEvent(event);
          return;
        }
        const message = renderProgressEvent(event);
        if (message) {
          await progress.update(message);
        }
      },
      progress,
      stopTyping: () => {},
    };
  }

  bot.on(['voice', 'audio', 'document'], (ctx, next) => {
    const chatId = ctx.chat.id;
    const topicId = getTopicId(ctx);
    const topicKey = buildTopicKey(chatId, topicId);
    const payload = getAudioPayload(ctx.message);
    if (!payload) return next();

    enqueue(topicKey, async () => {
      const effectiveAgentId = resolveEffectiveAgentId(chatId, topicId);
      const memoryThreadKey = buildMemoryThreadKey(
        chatId,
        topicId,
        effectiveAgentId
      );
      let feedback = {
        onEvent: undefined,
        progress: null,
        stopTyping: startTyping(ctx),
      };
      let audioPath;
      let transcriptPath;
      try {
        audioPath = await downloadTelegramFile(ctx, payload, {
          prefix: 'audio',
          errorLabel: 'audio',
        });
        const { text, outputPath } = await transcribeAudio(audioPath);
        transcriptPath = outputPath;
        await replyWithTranscript(ctx, text, ctx.message?.message_id);
        if (!text) {
          await ctx.reply("I couldn't transcribe the audio.");
          return;
        }
        await captureMemoryEvent({
          threadKey: memoryThreadKey,
          chatId,
          topicId,
          agentId: effectiveAgentId,
          role: 'user',
          kind: 'audio',
          text,
        });
        feedback.stopTyping();
        feedback = await createExecutionFeedback(ctx, effectiveAgentId);
        const response = await runAgentForChat(chatId, text, {
          topicId,
          onEvent: feedback.onEvent,
        });
        await captureMemoryEvent({
          threadKey: memoryThreadKey,
          chatId,
          topicId,
          agentId: effectiveAgentId,
          role: 'assistant',
          kind: 'text',
          text: extractMemoryText(response),
        });
        if (feedback.progress) {
          await feedback.progress.finish();
        }
        await replyWithResponse(ctx, response);
      } catch (err) {
        console.error(err);
        feedback.stopTyping();
        if (feedback.progress) {
          await feedback.progress.fail(getProgressFailureText(effectiveAgentId));
        }
        if (err && err.code === 'ENOENT') {
          await replyWithError(
            ctx,
            "I can't find the transcription command. Install parakeet-mlx or set AIPAL_WHISPER_CMD.",
            err
          );
        } else {
          await replyWithError(ctx, 'Error processing audio.', err);
        }
      } finally {
        feedback.stopTyping();
        await safeUnlink(audioPath);
        await safeUnlink(transcriptPath);
      }
    });
  });

  bot.on(['photo', 'document'], (ctx, next) => {
    const chatId = ctx.chat.id;
    const topicId = getTopicId(ctx);
    const topicKey = buildTopicKey(chatId, topicId);
    const payload = getImagePayload(ctx.message);
    if (!payload) return next();

    enqueue(topicKey, async () => {
      const effectiveAgentId = resolveEffectiveAgentId(chatId, topicId);
      const memoryThreadKey = buildMemoryThreadKey(
        chatId,
        topicId,
        effectiveAgentId
      );
      let feedback = {
        onEvent: undefined,
        progress: null,
        stopTyping: startTyping(ctx),
      };
      let imagePath;
      try {
        imagePath = await downloadTelegramFile(ctx, payload, {
          dir: imageDir,
          prefix: 'image',
          errorLabel: 'image',
        });
        const caption = (ctx.message.caption || '').trim();
        const prompt = caption || 'User sent an image.';
        await captureMemoryEvent({
          threadKey: memoryThreadKey,
          chatId,
          topicId,
          agentId: effectiveAgentId,
          role: 'user',
          kind: 'image',
          text: prompt,
        });
        feedback.stopTyping();
        feedback = await createExecutionFeedback(ctx, effectiveAgentId);
        const response = await runAgentForChat(chatId, prompt, {
          topicId,
          imagePaths: [imagePath],
          onEvent: feedback.onEvent,
        });
        await captureMemoryEvent({
          threadKey: memoryThreadKey,
          chatId,
          topicId,
          agentId: effectiveAgentId,
          role: 'assistant',
          kind: 'text',
          text: extractMemoryText(response),
        });
        if (feedback.progress) {
          await feedback.progress.finish();
        }
        await replyWithResponse(ctx, response);
      } catch (err) {
        console.error(err);
        feedback.stopTyping();
        if (feedback.progress) {
          await feedback.progress.fail(getProgressFailureText(effectiveAgentId));
        }
        await replyWithError(ctx, 'Error processing image.', err);
      } finally {
        feedback.stopTyping();
      }
    });
  });

  bot.on('document', (ctx) => {
    const chatId = ctx.chat.id;
    const topicId = getTopicId(ctx);
    const topicKey = buildTopicKey(chatId, topicId);
    if (getAudioPayload(ctx.message) || getImagePayload(ctx.message)) return;
    const payload = getDocumentPayload(ctx.message);
    if (!payload) return;

    enqueue(topicKey, async () => {
      const effectiveAgentId = resolveEffectiveAgentId(chatId, topicId);
      const memoryThreadKey = buildMemoryThreadKey(
        chatId,
        topicId,
        effectiveAgentId
      );
      let feedback = {
        onEvent: undefined,
        progress: null,
        stopTyping: startTyping(ctx),
      };
      let documentPath;
      try {
        documentPath = await downloadTelegramFile(ctx, payload, {
          dir: documentDir,
          prefix: 'document',
          errorLabel: 'document',
        });
        const caption = (ctx.message.caption || '').trim();
        const prompt = caption || 'User sent a document.';
        await captureMemoryEvent({
          threadKey: memoryThreadKey,
          chatId,
          topicId,
          agentId: effectiveAgentId,
          role: 'user',
          kind: 'document',
          text: prompt,
        });
        feedback.stopTyping();
        feedback = await createExecutionFeedback(ctx, effectiveAgentId);
        const response = await runAgentForChat(chatId, prompt, {
          topicId,
          documentPaths: [documentPath],
          onEvent: feedback.onEvent,
        });
        await captureMemoryEvent({
          threadKey: memoryThreadKey,
          chatId,
          topicId,
          agentId: effectiveAgentId,
          role: 'assistant',
          kind: 'text',
          text: extractMemoryText(response),
        });
        if (feedback.progress) {
          await feedback.progress.finish();
        }
        await replyWithResponse(ctx, response);
      } catch (err) {
        console.error(err);
        feedback.stopTyping();
        if (feedback.progress) {
          await feedback.progress.fail(getProgressFailureText(effectiveAgentId));
        }
        await replyWithError(ctx, 'Error processing document.', err);
      } finally {
        feedback.stopTyping();
      }
    });
  });
}

module.exports = {
  registerMediaHandlers,
};
