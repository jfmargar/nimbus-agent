const fs = require('fs/promises');
const path = require('path');

function normalizeProjectCwd(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  try {
    return path.resolve(trimmed);
  } catch {
    return '';
  }
}

function isSessionCompatibleWithProject(sessionMeta, projectCwd) {
  const target = normalizeProjectCwd(projectCwd);
  const candidate = normalizeProjectCwd(sessionMeta?.cwd);
  if (!target || !candidate) return false;
  return candidate === target || candidate.startsWith(`${target}${path.sep}`);
}

function createAgentRunner(options) {
  const {
    agentMaxBuffer,
    agentTimeoutMs,
    buildBootstrapContext,
    buildMemoryRetrievalContext,
    buildPrompt,
    documentDir,
    execLocal,
    execLocalWithPty,
    fileInstructionsEvery,
    findNewestSessionDiff,
    getAgent,
    getAgentLabel,
    getGlobalAgent,
    getGlobalModels,
    getGlobalThinking,
    getLocalCodexSessionMeta,
    getThreads,
    imageDir,
    listLocalCodexSessionsSince,
    listSqliteCodexThreads,
    memoryRetrievalLimit,
    persistProjectOverrides,
    persistThreads,
    prefixTextWithTimestamp,
    resolveAgentProjectCwd,
    resolveEffectiveAgentId,
    resolveThreadId,
    shellQuote,
    setProjectForAgent,
    threadTurns,
    defaultTimeZone,
    getDefaultAgentCwd,
    listLocalCodexSessions,
  } = options;
  const interactiveNewSessionTimeoutMs = Math.min(agentTimeoutMs, 45000);

  async function resolveLatestCodexSessionId(cwd) {
    if (typeof listLocalCodexSessions !== 'function') return '';
    const normalizedCwd = String(cwd || '').trim();
    if (!normalizedCwd) return '';

    // Codex may flush session metadata a little after command exit.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const sessions = await listLocalCodexSessions({
          limit: 20,
          cwd: normalizedCwd,
        });
        const latest = Array.isArray(sessions)
          ? sessions.find((session) => String(session?.id || '').trim())
          : null;
        const id = String(latest?.id || '').trim();
        if (id) return id;
      } catch {
        // Ignore session listing errors in fallback path.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return '';
  }

  async function ensureProjectCwdExists(cwd) {
    const normalized = normalizeProjectCwd(cwd);
    if (!normalized) return '';
    const stat = await fs.stat(normalized);
    if (!stat.isDirectory()) {
      throw new Error(`El proyecto activo no es un directorio válido: ${normalized}`);
    }
    return normalized;
  }

  function buildExecOptions(base = {}, cwdOverride) {
    const cwd =
      String(cwdOverride || '').trim() ||
      (typeof getDefaultAgentCwd === 'function' ? getDefaultAgentCwd() : undefined);
    if (!cwd) return base;
    return { ...base, cwd };
  }

  function isUsefulInteractiveReply(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return false;
    if (normalized.length < 8) return false;
    if (/^Tip:/i.test(normalized)) return false;
    if (/^Usage:/i.test(normalized)) return false;
    if (/^For more information/i.test(normalized)) return false;
    if (/Continue anyway\?/i.test(normalized)) return false;
    if (/interactive TUI/i.test(normalized)) return false;
    if (/^[?[\]0-9;<>uhtlrmc\\]+$/.test(normalized)) return false;
    return true;
  }

  function buildInteractiveCreationReply({ executionCwd, parsedText, execError, candidateId }) {
    const normalizedText = String(parsedText || '').trim();
    if (!candidateId) return '';
    if (execError?.code === 'ETIMEDOUT') {
      return `Sesión creada y conectada en ${path.basename(
        executionCwd
      )}.\nA partir del próximo mensaje continuaré esa sesión.`;
    }
    if (isUsefulInteractiveReply(normalizedText)) {
      return normalizedText;
    }
    return `Sesión creada y conectada en ${path.basename(
      executionCwd
    )}.\nA partir del próximo mensaje continuaré esa sesión.`;
  }

  async function syncThreadAndProject({
    chatId,
    topicId,
    effectiveAgentId,
    threadKey,
    threadId,
    executionCwd,
    threads,
  }) {
    if (!threadId) return;
    threads.set(threadKey, threadId);
    persistThreads().catch((err) =>
      console.warn('Failed to persist threads:', err)
    );

    if (
      effectiveAgentId !== 'codex' ||
      typeof getLocalCodexSessionMeta !== 'function' ||
      typeof setProjectForAgent !== 'function'
    ) {
      return;
    }

    try {
      const meta = await getLocalCodexSessionMeta(threadId);
      const metaCwd = String(meta?.cwd || executionCwd || '').trim();
      if (!metaCwd) return;
      setProjectForAgent(chatId, topicId, effectiveAgentId, metaCwd);
      if (typeof persistProjectOverrides === 'function') {
        persistProjectOverrides().catch((err) =>
          console.warn('Failed to persist project overrides:', err)
        );
      }
    } catch (err) {
      console.warn('Failed to sync project override from session metadata:', err);
    }
  }

  async function buildSessionCreationSnapshot(cwd) {
    if (!cwd || typeof listLocalCodexSessions !== 'function') {
      return {
        previousIds: [],
        startedAt: Date.now(),
        sessionSnapshotCount: 0,
      };
    }
    const sessions = await listLocalCodexSessions({
      limit: 50,
      cwd,
    });
    return {
      previousIds: sessions.map((session) => String(session?.id || '').trim()).filter(Boolean),
      startedAt: Date.now(),
      sessionSnapshotCount: sessions.length,
    };
  }

  async function findCreatedCliSession({ cwd, previousIds, startedAt }) {
    const normalizedCwd = String(cwd || '').trim();
    if (!normalizedCwd) return null;

    if (typeof findNewestSessionDiff === 'function') {
      const diffCandidates = await findNewestSessionDiff({
        cwd: normalizedCwd,
        previousIds,
        sinceTs: startedAt,
        limit: 20,
      });
      const cliCandidate = diffCandidates.find(
        (session) => String(session?.source || '').trim().toLowerCase() === 'cli'
      );
      if (cliCandidate) {
        return { session: cliCandidate, detectionSource: 'jsonl' };
      }
      if (diffCandidates.length === 1) {
        return { session: diffCandidates[0], detectionSource: 'jsonl' };
      }
      if (diffCandidates.length > 1) {
        return { session: null, detectionSource: 'jsonl-ambiguous' };
      }
    }

    if (typeof listLocalCodexSessionsSince === 'function') {
      const sessions = await listLocalCodexSessionsSince({
        cwd: normalizedCwd,
        sinceTs: startedAt,
        limit: 20,
      });
      const candidates = sessions.filter(
        (session) => !previousIds.includes(String(session?.id || '').trim())
      );
      const cliCandidate = candidates.find(
        (session) => String(session?.source || '').trim().toLowerCase() === 'cli'
      );
      if (cliCandidate) {
        return { session: cliCandidate, detectionSource: 'jsonl' };
      }
      if (candidates.length === 1) {
        return { session: candidates[0], detectionSource: 'jsonl' };
      }
      if (candidates.length > 1) {
        return { session: null, detectionSource: 'jsonl-ambiguous' };
      }
    }

    if (typeof listSqliteCodexThreads === 'function') {
      const sqliteCandidates = await listSqliteCodexThreads({
        cwd: normalizedCwd,
        source: 'cli',
        sinceTs: startedAt,
        limit: 10,
      });
      const filtered = sqliteCandidates.filter(
        (session) => !previousIds.includes(String(session?.id || '').trim())
      );
      if (filtered.length === 1) {
        return { session: filtered[0], detectionSource: 'sqlite' };
      }
      if (filtered.length > 1) {
        return { session: null, detectionSource: 'sqlite-ambiguous' };
      }
    }

    return null;
  }

  async function resolveNewCliSessionId(snapshot, cwd) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const resolved = await findCreatedCliSession({
        cwd,
        previousIds: snapshot.previousIds,
        startedAt: snapshot.startedAt,
      });
      if (resolved?.session || resolved?.detectionSource?.includes('ambiguous')) {
        return resolved;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return null;
  }

  async function runCodexNewSessionInteractive({
    agent,
    chatId,
    topicId,
    effectiveAgentId,
    executionCwd,
    finalPrompt,
    model,
    thinking,
    threadKey,
    threads,
  }) {
    if (typeof agent.buildInteractiveNewSessionCommand !== 'function') {
      throw new Error(
        'No pude crear una sesión visible de Codex para este proyecto. Puedes reintentar o usar Continuar última sesión.'
      );
    }

    const snapshot = await buildSessionCreationSnapshot(executionCwd);
    console.info(
      `Agent start chat=${chatId} topic=${topicId || 'root'} agent=${agent.id} cwd=${
        executionCwd || '(default)'
      } thread=new mode=new-interactive-cli startedAt=${snapshot.startedAt} sessionSnapshotCount=${
        snapshot.sessionSnapshotCount
      }`
    );

    const promptBase64 = Buffer.from(finalPrompt, 'utf8').toString('base64');
    const promptExpression = '"$PROMPT"';
    const interactiveCmd = agent.buildInteractiveNewSessionCommand({
      prompt: finalPrompt,
      promptExpression,
      cwd: executionCwd,
      thinking,
      model,
    });
    const command = [
      `PROMPT_B64=${shellQuote(promptBase64)};`,
      'PROMPT=$(printf %s "$PROMPT_B64" | base64 --decode);',
      'export TERM=xterm-256color;',
      `${interactiveCmd}`,
    ].join(' ');

    const startedAt = Date.now();
    let output = '';
    let execError;
    try {
      output = await execLocalWithPty(command, {
        ...buildExecOptions({}, executionCwd),
        timeout: interactiveNewSessionTimeoutMs,
        maxBuffer: agentMaxBuffer,
      });
    } catch (err) {
      execError = err;
      if (err && typeof err.stdout === 'string') {
        output = err.stdout;
      }
    } finally {
      const elapsedMs = Date.now() - startedAt;
      console.info(
        `Agent finished chat=${chatId} topic=${topicId || 'root'} durationMs=${elapsedMs} mode=new-interactive-cli`
      );
    }

    const parsed = typeof agent.parseInteractiveOutput === 'function'
      ? agent.parseInteractiveOutput(output)
      : { text: String(output || '').trim(), sawText: Boolean(String(output || '').trim()) };
    if (execError || !String(parsed?.text || '').trim()) {
      const preview = String(output || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400);
      if (preview) {
        console.warn(
          `Agent interactive new-session output preview chat=${chatId} topic=${
            topicId || 'root'
          } preview=${preview}`
        );
      }
    }
    const resolved = await resolveNewCliSessionId(snapshot, executionCwd);
    const candidateId = String(resolved?.session?.id || '').trim();
    const detectionSource = String(resolved?.detectionSource || 'none');
    const sourceType = String(resolved?.session?.source || '').trim().toLowerCase() || 'unknown';
    console.info(
      `Agent new-session resolve chat=${chatId} topic=${topicId || 'root'} candidateIds=${
        candidateId || '(none)'
      } detectionSource=${detectionSource} sourceTypeIfKnown=${sourceType}`
    );

    if (!candidateId) {
      if (detectionSource.includes('ambiguous')) {
        throw new Error(
          'No pude asociar de forma segura la nueva sesión visible de Codex. Puedes reintentar o usar Continuar última sesión.'
        );
      }
      throw new Error(
        'No pude crear una sesión visible de Codex para este proyecto. Puedes reintentar o usar Continuar última sesión.'
      );
    }

    await syncThreadAndProject({
      chatId,
      topicId,
      effectiveAgentId,
      threadKey,
      threadId: candidateId,
      executionCwd,
      threads,
    });

    if (execError) {
      console.warn(
        `Agent interactive new-session exited non-zero chat=${chatId} topic=${topicId || 'root'} code=${
          execError.code || 'unknown'
        } timeoutMs=${interactiveNewSessionTimeoutMs}`
      );
    }
    const reply = buildInteractiveCreationReply({
      executionCwd,
      parsedText: parsed?.text,
      execError,
      candidateId,
    });
    if (execError?.code === 'ETIMEDOUT') {
      console.info(
        `Agent interactive session created successfully despite timeout chat=${chatId} topic=${
          topicId || 'root'
        } threadId=${candidateId} cwd=${executionCwd} replyMode=confirmation`
      );
    }
    return reply;
  }

  async function runAgentOneShot(prompt) {
    const globalAgent = getGlobalAgent();
    const agent = getAgent(globalAgent);
    const thinking = getGlobalThinking();
    let promptText = String(prompt || '');
    if (agent.id === 'claude') {
      promptText = prefixTextWithTimestamp(promptText, {
        timeZone: defaultTimeZone,
      });
    }
    const promptBase64 = Buffer.from(promptText, 'utf8').toString('base64');
    const promptExpression = '"$PROMPT"';
    const agentCmd = agent.buildCommand({
      prompt: promptText,
      promptExpression,
      threadId: undefined,
      thinking,
    });

    const command = [
      `PROMPT_B64=${shellQuote(promptBase64)};`,
      'PROMPT=$(printf %s "$PROMPT_B64" | base64 --decode);',
      `${agentCmd}`,
    ].join(' ');

    let commandToRun = command;
    if (agent.needsPty) {
      commandToRun = wrapCommandWithPty(commandToRun);
    }
    if (agent.mergeStderr) {
      commandToRun = `${commandToRun} 2>&1`;
    }

    const startedAt = Date.now();
    console.info(`Agent one-shot start agent=${getAgentLabel(globalAgent)}`);
    let output;
    let execError;
    try {
      output = await execLocal('bash', ['-lc', commandToRun], {
        ...buildExecOptions(),
        timeout: agentTimeoutMs,
        maxBuffer: agentMaxBuffer,
      });
    } catch (err) {
      execError = err;
      if (err && typeof err.stdout === 'string' && err.stdout.trim()) {
        output = err.stdout;
      } else {
        throw err;
      }
    } finally {
      const elapsedMs = Date.now() - startedAt;
      console.info(`Agent one-shot finished durationMs=${elapsedMs}`);
    }

    const parsed = agent.parseOutput(output);
    if (execError && !parsed.sawJson && !String(parsed.text || '').trim()) {
      throw execError;
    }
    if (execError) {
      console.warn(
        `Agent one-shot exited non-zero; returning stdout (code=${execError.code || 'unknown'})`
      );
    }
    return parsed.text || output;
  }

  async function runAgentForChat(chatId, prompt, runOptions = {}) {
    const { topicId, agentId: overrideAgentId, imagePaths, scriptContext, documentPaths } =
      runOptions;
    const effectiveAgentId = resolveEffectiveAgentId(
      chatId,
      topicId,
      overrideAgentId
    );
    const agent = getAgent(effectiveAgentId);
    const resolvedCwd =
      typeof resolveAgentProjectCwd === 'function'
        ? await resolveAgentProjectCwd(chatId, topicId, effectiveAgentId)
        : '';
    const executionCwd = await ensureProjectCwdExists(resolvedCwd).catch((err) => {
      if (!resolvedCwd) return '';
      throw err;
    });

    const threads = getThreads();
    const { threadKey, threadId, migrated } = resolveThreadId(
      threads,
      chatId,
      topicId,
      effectiveAgentId
    );
    const turnCount = (threadTurns.get(threadKey) || 0) + 1;
    threadTurns.set(threadKey, turnCount);
    const shouldIncludeFileInstructions =
      !threadId || turnCount % fileInstructionsEvery === 0;
    if (migrated) {
      persistThreads().catch((err) =>
        console.warn('Failed to persist migrated threads:', err)
      );
    }

    if (threadId && agent.id === 'codex' && typeof getLocalCodexSessionMeta === 'function') {
      let sessionMeta = null;
      try {
        sessionMeta = await getLocalCodexSessionMeta(threadId);
      } catch (err) {
        console.warn('Failed to load current session metadata:', err);
      }

      if (!sessionMeta) {
        throw new Error(
          'No pude localizar la sesión activa de este tópico. Usa Projects para continuar la última sesión o crear una nueva.'
        );
      }

      if (executionCwd && !isSessionCompatibleWithProject(sessionMeta, executionCwd)) {
        throw new Error(
          'La sesión activa no pertenece al proyecto seleccionado. Usa Projects para continuar la última sesión o crear una nueva.'
        );
      }
    }

    let promptWithContext = prompt;
    if (agent.id === 'claude') {
      promptWithContext = prefixTextWithTimestamp(promptWithContext, {
        timeZone: defaultTimeZone,
      });
    }
    if (!threadId) {
      const bootstrap = await buildBootstrapContext({ threadKey });
      promptWithContext = promptWithContext
        ? `${bootstrap}\n\n${promptWithContext}`
        : bootstrap;
    }
    const retrievalContext = await buildMemoryRetrievalContext({
      query: prompt,
      chatId,
      topicId,
      agentId: effectiveAgentId,
      limit: memoryRetrievalLimit,
    });
    if (retrievalContext) {
      promptWithContext = promptWithContext
        ? `${promptWithContext}\n\n${retrievalContext}`
        : retrievalContext;
    }

    const thinking = getGlobalThinking();
    const finalPrompt = buildPrompt(
      promptWithContext,
      imagePaths || [],
      imageDir,
      scriptContext,
      documentPaths || [],
      documentDir,
      { includeFileInstructions: shouldIncludeFileInstructions }
    );
    const model = getGlobalModels()[effectiveAgentId];

    if (agent.id === 'codex' && !threadId) {
      return runCodexNewSessionInteractive({
        agent,
        chatId,
        topicId,
        effectiveAgentId,
        executionCwd,
        finalPrompt,
        model,
        thinking,
        threadKey,
        threads,
      });
    }

    const promptBase64 = Buffer.from(finalPrompt, 'utf8').toString('base64');
    const promptExpression = '"$PROMPT"';
    const agentCmd = agent.buildCommand({
      prompt: finalPrompt,
      promptExpression,
      threadId,
      thinking,
      model,
    });
    const command = [
      `PROMPT_B64=${shellQuote(promptBase64)};`,
      'PROMPT=$(printf %s "$PROMPT_B64" | base64 --decode);',
      `${agentCmd}`,
    ].join(' ');
    let commandToRun = command;
    if (agent.mergeStderr) {
      commandToRun = `${commandToRun} 2>&1`;
    }

    const startedAt = Date.now();
    const executionMode = threadId ? 'resume-exec' : 'new';
    console.info(
      `Agent start chat=${chatId} topic=${topicId || 'root'} agent=${agent.id} cwd=${
        executionCwd || '(default)'
      } thread=${threadId || 'new'} mode=${executionMode}`
    );
    let output;
    let execError;
    try {
      output = await execLocal('bash', ['-lc', commandToRun], {
        ...buildExecOptions({}, executionCwd),
        timeout: agentTimeoutMs,
        maxBuffer: agentMaxBuffer,
      });
    } catch (err) {
      execError = err;
      if (err && typeof err.stdout === 'string' && err.stdout.trim()) {
        output = err.stdout;
      } else {
        throw err;
      }
    } finally {
      const elapsedMs = Date.now() - startedAt;
      console.info(
        `Agent finished chat=${chatId} topic=${topicId || 'root'} durationMs=${elapsedMs} mode=${executionMode}`
      );
    }
    const parsed = agent.parseOutput(output);
    if (execError && !parsed.sawJson && !String(parsed.text || '').trim()) {
      throw execError;
    }
    if (execError) {
      console.warn(
        `Agent exited non-zero; returning stdout chat=${chatId} topic=${topicId || 'root'} code=${execError.code || 'unknown'}`
      );
    }
    if (!parsed.threadId && agent.id === 'codex') {
      const resolved = await resolveLatestCodexSessionId(executionCwd);
      if (resolved) {
        parsed.threadId = resolved;
      }
    }
    if (!parsed.threadId && typeof agent.listSessionsCommand === 'function') {
      try {
        const listCommand = agent.listSessionsCommand();
        let listCommandToRun = listCommand;
        if (agent.mergeStderr) {
          listCommandToRun = `${listCommandToRun} 2>&1`;
        }
        const listOutput = await execLocal('bash', ['-lc', listCommandToRun], {
          ...buildExecOptions(),
          timeout: agentTimeoutMs,
          maxBuffer: agentMaxBuffer,
        });
        if (typeof agent.parseSessionList === 'function') {
          const resolved = agent.parseSessionList(listOutput);
          if (resolved) {
            parsed.threadId = resolved;
          }
        }
      } catch (err) {
        console.warn('Failed to resolve agent session id:', err?.message || err);
      }
    }
    await syncThreadAndProject({
      chatId,
      topicId,
      effectiveAgentId,
      threadKey,
      threadId: parsed.threadId,
      executionCwd,
      threads,
    });
    return parsed.text || output;
  }

  return {
    runAgentForChat,
    runAgentOneShot,
  };
}

module.exports = {
  createAgentRunner,
  isSessionCompatibleWithProject,
};
