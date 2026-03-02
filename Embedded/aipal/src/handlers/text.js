function registerTextHandler(options) {
  const {
    bot,
    beginProgress,
    buildMemoryThreadKey,
    buildTopicKey,
    captureMemoryEvent,
    codexProgressUpdatesEnabled,
    consumeScriptContext,
    enqueue,
    extractMemoryText,
    formatScriptContext,
    getTopicId,
    lastScriptOutputs,
    parseSlashCommand,
    replyWithError,
    replyWithResponse,
    renderProgressEvent,
    requestAgentApproval,
    resolveEffectiveAgentId,
    runAgentForChat,
    runScriptCommand,
    scriptManager,
    startTyping,
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

  bot.on('text', (ctx) => {
    const chatId = ctx.chat.id;
    const topicId = getTopicId(ctx);
    const topicKey = buildTopicKey(chatId, topicId);
    const text = ctx.message.text.trim();
    if (!text) return;

    const slash = parseSlashCommand(text);
    if (slash) {
      const normalized = slash.name.toLowerCase();
      if (
        [
          'start',
          'thinking',
          'agent',
          'model',
          'memory',
          'reset',
          'cron',
          'help',
          'menu',
          'document_scripts',
        ].includes(normalized)
      ) {
        return;
      }
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
        try {
          await captureMemoryEvent({
            threadKey: memoryThreadKey,
            chatId,
            topicId,
            agentId: effectiveAgentId,
            role: 'user',
            kind: 'command',
            text,
          });
          let scriptMeta = {};
          try {
            scriptMeta = await scriptManager.getScriptMetadata(slash.name);
          } catch (err) {
            console.error('Failed to read script metadata', err);
            scriptMeta = {};
          }
          const output = await runScriptCommand(slash.name, slash.args);
          const llmPrompt =
            typeof scriptMeta?.llm?.prompt === 'string'
              ? scriptMeta.llm.prompt.trim()
              : '';
          if (llmPrompt) {
            feedback.stopTyping();
            feedback = await createExecutionFeedback(ctx, effectiveAgentId);
            const scriptContext = formatScriptContext({
              name: slash.name,
              output,
            });
            const response = await runAgentForChat(chatId, llmPrompt, {
              topicId,
              scriptContext,
              onEvent: feedback.onEvent,
              onApprovalRequest: (request) =>
                requestAgentApproval(ctx, request),
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
            feedback.stopTyping();
            if (feedback.progress) {
              await feedback.progress.finish();
            }
            await replyWithResponse(ctx, response);
            return;
          }
          lastScriptOutputs.set(topicKey, { name: slash.name, output });
          await captureMemoryEvent({
            threadKey: memoryThreadKey,
            chatId,
            topicId,
            agentId: effectiveAgentId,
            role: 'assistant',
            kind: 'text',
            text: extractMemoryText(output),
          });
          feedback.stopTyping();
          await replyWithResponse(ctx, output);
        } catch (err) {
          console.error(err);
          feedback.stopTyping();
          if (feedback.progress) {
            await feedback.progress.fail('Codex: error durante la ejecucion.');
          }
          await replyWithError(ctx, `Error running /${slash.name}.`, err);
        }
      });
      return;
    }

    enqueue(topicKey, async () => {
      const effectiveAgentId = resolveEffectiveAgentId(chatId, topicId);
      const memoryThreadKey = buildMemoryThreadKey(
        chatId,
        topicId,
        effectiveAgentId
      );
      const feedback = await createExecutionFeedback(ctx, effectiveAgentId);
      try {
        await captureMemoryEvent({
          threadKey: memoryThreadKey,
          chatId,
          topicId,
          agentId: effectiveAgentId,
          role: 'user',
          kind: 'text',
          text,
        });
        const scriptContext = consumeScriptContext(topicKey);
        const response = await runAgentForChat(chatId, text, {
          topicId,
          scriptContext,
          onEvent: feedback.onEvent,
          onApprovalRequest: (request) => requestAgentApproval(ctx, request),
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
        feedback.stopTyping();
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
        await replyWithError(ctx, 'Error processing response.', err);
      }
    });
  });
}

module.exports = {
  registerTextHandler,
};
