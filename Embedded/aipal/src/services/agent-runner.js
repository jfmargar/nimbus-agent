const fs = require('fs/promises');
const path = require('path');
const { createCodexSdkClient: defaultCreateCodexSdkClient } = require('./codex-sdk-client');

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isVisibleCodexSessionSource(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'cli' || normalized === 'exec';
}

function normalizeDateInput(value) {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function createAgentRunner(options) {
  const {
    agentMaxBuffer,
    agentTimeoutMs,
    buildBootstrapContext,
    buildMemoryRetrievalContext,
    buildPrompt,
    buildSharedSessionPrompt,
    codexApprovalMode,
    codexSandboxMode,
    createCodexSdkClient = defaultCreateCodexSdkClient,
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
    wrapCommandWithPty,
  } = options;
  const interactiveNewSessionTimeoutMs = Math.min(agentTimeoutMs, 45000);
  const interactiveEarlyAbortGraceMs = 600;
  const cliSessionResolveAttempts = 16;
  const cliSessionResolveIntervalMs = 250;
  const codexSdkClient = createCodexSdkClient({
    agentTimeoutMs,
    approvalMode: codexApprovalMode,
    sandboxMode: codexSandboxMode,
  });

  async function resolveLatestCodexSessionId(cwd, sessionFilter = {}) {
    if (typeof listLocalCodexSessions !== 'function') return '';
    const normalizedCwd = String(cwd || '').trim();
    if (!normalizedCwd) return '';
    const includeIds = Array.isArray(sessionFilter.includeIds)
      ? new Set(sessionFilter.includeIds.map((value) => String(value || '').trim()).filter(Boolean))
      : null;
    const excludeIds = new Set(
      Array.isArray(sessionFilter.excludeIds)
        ? sessionFilter.excludeIds.map((value) => String(value || '').trim()).filter(Boolean)
        : []
    );
    const sinceTs = normalizeDateInput(sessionFilter.sinceTs);

    // Codex may flush session metadata a little after command exit.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const sessions = await listLocalCodexSessions({
          limit: 20,
          cwd: normalizedCwd,
        });
        const latest = Array.isArray(sessions)
          ? sessions
              .filter((session) => {
                const sessionId = String(session?.id || '').trim();
                if (!sessionId) return false;
                if (includeIds && !includeIds.has(sessionId)) return false;
                if (excludeIds.has(sessionId)) return false;
                if (sinceTs > 0 && normalizeDateInput(session?.timestamp) < sinceTs) {
                  return false;
                }
                return true;
              })
              .sort(
                (a, b) => normalizeDateInput(b?.timestamp) - normalizeDateInput(a?.timestamp)
              )[0]
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

  function isSharedCodexSession(agent) {
    return String(agent?.id || '').trim().toLowerCase() === 'codex';
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
        previousLatestId: '',
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
      previousLatestId: String(sessions[0]?.id || '').trim(),
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
      const cliCandidate = diffCandidates.find((session) =>
        isVisibleCodexSessionSource(session?.source)
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
      const cliCandidate = candidates.find((session) =>
        isVisibleCodexSessionSource(session?.source)
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
    for (let attempt = 0; attempt < cliSessionResolveAttempts; attempt += 1) {
      const resolved = await findCreatedCliSession({
        cwd,
        previousIds: snapshot.previousIds,
        startedAt: snapshot.startedAt,
      });
      if (resolved?.session || resolved?.detectionSource?.includes('ambiguous')) {
        return resolved;
      }
      await new Promise((resolve) => setTimeout(resolve, cliSessionResolveIntervalMs));
    }
    return null;
  }

  function logCodexSdkEvent(baseMeta, event) {
    if (!event || typeof event !== 'object') return;
    const fragments = [
      'Agent event',
      `agent=codex`,
      `mode=sdk`,
      `chat=${baseMeta.chatId}`,
      `topic=${baseMeta.topicId || 'root'}`,
      `cwd=${baseMeta.executionCwd || '(default)'}`,
    ];
    if (baseMeta.threadId) {
      fragments.push(`threadId=${baseMeta.threadId}`);
    }
    if (event.conversationId) {
      fragments.push(`conversationId=${event.conversationId}`);
    }
    if (event.threadId) {
      fragments.push(`eventThreadId=${event.threadId}`);
    }
    if (event.phase) {
      fragments.push(`phase=${event.phase}`);
    }
    if (event.errorKind) {
      fragments.push(`errorKind=${event.errorKind}`);
    }
    if (event.tool) {
      fragments.push(`tool=${String(event.tool).replace(/\s+/g, '_')}`);
    }
    console.info(fragments.join(' '));
  }

  function isUsefulSessionCreationReply(text) {
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

  function buildSessionCreationReply({ executionCwd, parsedText, execError, candidateId }) {
    const normalizedText = String(parsedText || '').trim();
    if (!candidateId) return '';
    if (execError?.code === 'ETIMEDOUT') {
      return `Sesion creada y conectada en ${path.basename(
        executionCwd
      )}.\nA partir del proximo mensaje continuare esa sesion.`;
    }
    if (isUsefulSessionCreationReply(normalizedText)) {
      return normalizedText;
    }
    return `Sesion creada y conectada en ${path.basename(
      executionCwd
    )}.\nA partir del proximo mensaje continuare esa sesion.`;
  }

  function buildExistingSessionReuseReply({ executionCwd }) {
    return `No pude confirmar la creacion de una sesion nueva en ${path.basename(
      executionCwd
    )}.\nHe vuelto a conectar la sesion anterior del proyecto y seguire trabajando ahi.`;
  }

  function finalizeInteractiveExecution({
    execPromise,
    abortController,
    getExecFinished,
    waitForCompletion,
    graceMs,
    chatId,
    topicId,
  }) {
    return (async () => {
      if (waitForCompletion) {
        await execPromise;
        return;
      }
      await Promise.race([execPromise, delay(graceMs)]);
      if (!getExecFinished()) {
        console.info(
          `pty_abort_requested chat=${chatId} topic=${topicId || 'root'} reason=grace_elapsed graceMs=${graceMs}`
        );
        abortController.abort(new Error('grace_elapsed'));
      }
      await execPromise;
    })();
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
    waitForInteractiveCompletion = false,
    backgroundInteractiveCleanup = false,
  }) {
    if (typeof agent.buildInteractiveNewSessionCommand !== 'function') {
      throw new Error(
        'No pude crear una sesion visible de Codex para este proyecto. Puedes reintentar o usar Continuar ultima sesion.'
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
    const abortController = new AbortController();
    let output = '';
    let execError;
    let execFinished = false;
    const execPromise = execLocalWithPty(command, {
      ...buildExecOptions({}, executionCwd),
      timeout: interactiveNewSessionTimeoutMs,
      maxBuffer: agentMaxBuffer,
      signal: abortController.signal,
    })
      .then((value) => {
        execFinished = true;
        output = value;
      })
      .catch((err) => {
        execFinished = true;
        execError = err;
        if (err && typeof err.stdout === 'string') {
          output = err.stdout;
        }
      });

    const cleanupPromise = finalizeInteractiveExecution({
      execPromise,
      abortController,
      getExecFinished: () => execFinished,
      waitForCompletion: waitForInteractiveCompletion && !backgroundInteractiveCleanup,
      graceMs: interactiveEarlyAbortGraceMs,
      chatId,
      topicId,
    });

    let resolved;
    async function finalizeCleanup() {
      try {
        await cleanupPromise;
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
      return {
        parsed,
        execError,
      };
    }

    resolved = await resolveNewCliSessionId(snapshot, executionCwd);
    let candidateId = String(resolved?.session?.id || '').trim();
    let reusedExistingSession = false;
    const detectionSource = String(resolved?.detectionSource || 'none');
    const sourceType = String(resolved?.session?.source || '').trim().toLowerCase() || 'unknown';
    if (!candidateId) {
      const earlyLatest = await resolveLatestCodexSessionId(executionCwd, {
        excludeIds: snapshot.previousIds,
        sinceTs: snapshot.startedAt,
      });
      if (earlyLatest) {
        candidateId = earlyLatest;
      }
    }
    console.info(
      `Agent new-session resolve chat=${chatId} topic=${topicId || 'root'} candidateIds=${
        candidateId || '(none)'
      } detectionSource=${detectionSource} sourceTypeIfKnown=${sourceType}`
    );

    if (!candidateId) {
      const cleanupResult = await finalizeCleanup();
      const parsedInteractiveThreadId = String(cleanupResult.parsed?.threadId || '').trim();
      if (parsedInteractiveThreadId) {
        await syncThreadAndProject({
          chatId,
          topicId,
          effectiveAgentId,
          threadKey,
          threadId: parsedInteractiveThreadId,
          executionCwd,
          threads,
        });
        return {
          text: buildSessionCreationReply({
            executionCwd,
            parsedText: cleanupResult.parsed?.text,
            execError: cleanupResult.execError,
            candidateId: parsedInteractiveThreadId,
          }),
          threadId: parsedInteractiveThreadId,
          reusedExistingSession: false,
        };
      }
      const fallbackLatest = await resolveLatestCodexSessionId(executionCwd, {
        excludeIds: snapshot.previousIds,
        sinceTs: snapshot.startedAt,
      });
      if (fallbackLatest) {
        await syncThreadAndProject({
          chatId,
          topicId,
          effectiveAgentId,
          threadKey,
          threadId: fallbackLatest,
          executionCwd,
          threads,
        });
        return {
          text: buildSessionCreationReply({
            executionCwd,
            parsedText: cleanupResult.parsed?.text,
            execError: cleanupResult.execError,
            candidateId: fallbackLatest,
          }),
          threadId: fallbackLatest,
          reusedExistingSession: false,
        };
      }
      const previousSessionId =
        snapshot.previousLatestId ||
        (await resolveLatestCodexSessionId(executionCwd, {
          includeIds: snapshot.previousIds,
        }));
      if (previousSessionId) {
        reusedExistingSession = true;
        await syncThreadAndProject({
          chatId,
          topicId,
          effectiveAgentId,
          threadKey,
          threadId: previousSessionId,
          executionCwd,
          threads,
        });
        return {
          text: buildExistingSessionReuseReply({
            executionCwd,
          }),
          threadId: previousSessionId,
          reusedExistingSession,
        };
      }
      if (detectionSource.includes('ambiguous')) {
        throw new Error(
          'No pude asociar de forma segura la nueva sesion visible de Codex. Puedes reintentar o usar Continuar ultima sesion.'
        );
      }
      throw new Error(
        'No pude crear una sesion visible de Codex para este proyecto. Puedes reintentar o usar Continuar ultima sesion.'
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

    if (backgroundInteractiveCleanup) {
      return {
        text: buildSessionCreationReply({
          executionCwd,
          parsedText: '',
          execError: null,
          candidateId,
        }),
        threadId: candidateId,
        reusedExistingSession,
        cleanupPromise: finalizeCleanup()
          .then((result) => ({
            finished: true,
            parsedText: result.parsed?.text || '',
            execError: result.execError || null,
          }))
          .catch((err) => {
            console.warn('Interactive cleanup failed after session attach:', err);
            return {
              finished: false,
              parsedText: '',
              execError: err,
            };
          }),
      };
    }

    const cleanupResult = await finalizeCleanup();
    if (cleanupResult.execError) {
      console.warn(
        `Agent interactive new-session exited non-zero chat=${chatId} topic=${topicId || 'root'} code=${
          cleanupResult.execError.code || 'unknown'
        } timeoutMs=${interactiveNewSessionTimeoutMs}`
      );
    }
    return {
      text: buildSessionCreationReply({
        executionCwd,
        parsedText: cleanupResult.parsed?.text,
        execError: cleanupResult.execError,
        candidateId,
      }),
      threadId: candidateId,
      reusedExistingSession,
    };
  }

  async function runCodexTurn({
    agent,
    chatId,
    topicId,
    effectiveAgentId,
    executionCwd,
    finalPrompt,
    imagePaths = [],
    model,
    thinking,
    threadKey,
    threads,
    threadId,
    onEvent,
  }) {
    const normalizedThreadId = String(threadId || '').trim();
    const snapshot = normalizedThreadId
      ? null
      : await buildSessionCreationSnapshot(executionCwd);
    let detectionSource = 'none';
    console.info(
      `Agent start chat=${chatId} topic=${topicId || 'root'} agent=${agent.id} cwd=${
        executionCwd || '(default)'
      } thread=${normalizedThreadId || 'new'} mode=sdk startedAt=${
        snapshot?.startedAt || Date.now()
      } sessionSnapshotCount=${snapshot?.sessionSnapshotCount || 0}`
    );

    const startedAt = Date.now();
    let result;
    try {
      result = await codexSdkClient.runTurn({
        cwd: executionCwd,
        imagePaths,
        model,
        onEvent: async (event) => {
          logCodexSdkEvent(
            {
              chatId,
              topicId,
              executionCwd,
              threadId: normalizedThreadId,
            },
            event
          );
          if (typeof onEvent === 'function') {
            await onEvent(event);
          }
        },
        prompt: finalPrompt,
        thinking,
        threadId: normalizedThreadId,
        timeoutMs: agentTimeoutMs,
      });
    } finally {
      const elapsedMs = Date.now() - startedAt;
      console.info(
        `Agent finished chat=${chatId} topic=${topicId || 'root'} durationMs=${elapsedMs} mode=sdk`
      );
    }

    let candidateId = String(result?.threadId || result?.conversationId || '').trim();
    if (!candidateId && snapshot) {
      const resolved = await resolveNewCliSessionId(snapshot, executionCwd);
      detectionSource = String(resolved?.detectionSource || 'none');
      const sourceType = String(resolved?.session?.source || '').trim().toLowerCase() || 'unknown';
      candidateId = String(resolved?.session?.id || '').trim();
      console.info(
        `Agent new-session resolve chat=${chatId} topic=${topicId || 'root'} candidateIds=${
          candidateId || '(none)'
        } detectionSource=${detectionSource} sourceTypeIfKnown=${sourceType}`
      );
      if (!candidateId && detectionSource.includes('ambiguous')) {
        throw new Error(
          'No pude asociar de forma segura la nueva sesion visible de Codex. Puedes reintentar o usar Continuar ultima sesion.'
        );
      }
    }

    if (!candidateId) {
      if (detectionSource.includes('ambiguous')) {
        throw new Error(
          'No pude asociar de forma segura la nueva sesion visible de Codex. Puedes reintentar o usar Continuar ultima sesion.'
        );
      }
      throw new Error(
        normalizedThreadId
          ? 'No pude reanudar la sesion de Codex indicada. Usa Projects para elegir otra sesion.'
          : 'No pude crear una sesion visible de Codex para este proyecto. Puedes reintentar o usar Continuar ultima sesion.'
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

    return {
      ...result,
      threadId: candidateId,
      conversationId: String(result?.conversationId || candidateId).trim() || candidateId,
      text: String(result?.text || '').trim(),
    };
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
    if (agent.id === 'codex') {
      const result = await codexSdkClient.runTurn({
        cwd: typeof getDefaultAgentCwd === 'function' ? getDefaultAgentCwd() : '',
        model: getGlobalModels()[globalAgent],
        prompt: promptText,
        thinking,
        timeoutMs: agentTimeoutMs,
      });
      return result.text;
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

  async function runAgentTurnForChat(chatId, prompt, runOptions = {}) {
    const {
      topicId,
      agentId: overrideAgentId,
      imagePaths,
      scriptContext,
      documentPaths,
      onEvent,
      waitForInteractiveCompletion = false,
      backgroundInteractiveCleanup = false,
    } = runOptions;
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

    const sharedCodexSession = isSharedCodexSession(agent);
    let promptWithContext = prompt;
    if (agent.id === 'claude') {
      promptWithContext = prefixTextWithTimestamp(promptWithContext, {
        timeZone: defaultTimeZone,
      });
    }
    if (!threadId && !sharedCodexSession) {
      const bootstrap = await buildBootstrapContext({ threadKey });
      promptWithContext = promptWithContext
        ? `${bootstrap}\n\n${promptWithContext}`
        : bootstrap;
    }
    if (!sharedCodexSession) {
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
    }

    const thinking = getGlobalThinking();
    const finalPrompt = sharedCodexSession
      ? buildSharedSessionPrompt(
          promptWithContext,
          imagePaths || [],
          scriptContext,
          documentPaths || []
        )
      : buildPrompt(
          promptWithContext,
          imagePaths || [],
          imageDir,
          scriptContext,
          documentPaths || [],
          documentDir,
          { includeFileInstructions: shouldIncludeFileInstructions }
        );
    if (!String(finalPrompt || '').trim()) {
      throw new Error(
        'No encontré contenido útil para enviar a Codex en este turno.'
      );
    }
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
        waitForInteractiveCompletion,
        backgroundInteractiveCleanup,
      });
    }

    if (agent.id === 'codex') {
      const result = await runCodexTurn({
        agent,
        chatId,
        topicId,
        effectiveAgentId,
        executionCwd,
        finalPrompt,
        imagePaths: imagePaths || [],
        model,
        thinking,
        threadKey,
        threads,
        threadId,
        onEvent,
      });
      return {
        text: result.text,
      };
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
    return {
      text: parsed.text || output,
    };
  }

  async function runAgentForChat(chatId, prompt, runOptions = {}) {
    const result = await runAgentTurnForChat(chatId, prompt, runOptions);
    return result?.text || '';
  }

  return {
    runAgentForChat,
    runAgentTurnForChat,
    runAgentOneShot,
  };
}

module.exports = {
  createAgentRunner,
  isSessionCompatibleWithProject,
};
