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

  async function createExecutionFeedback(ctx, effectiveAgentId) {
    const useProgress =
      codexProgressUpdatesEnabled &&
      effectiveAgentId === 'codex' &&
      typeof beginProgress === 'function';
    if (!useProgress) {
      return {
        onEvent: undefined,
        progress: null,
        stopTyping: startTyping(ctx),
      };
    }
    const progress = await beginProgress(ctx, 'Codex: iniciando sesion...');
    return {
      onEvent: async (event) => {
        if (!progress || event?.type === 'output_text') return;
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
          await feedback.progress.fail('Codex: error durante la ejecucion.');
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
          await feedback.progress.fail('Codex: error durante la ejecucion.');
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
          await feedback.progress.fail('Codex: error durante la ejecucion.');
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
