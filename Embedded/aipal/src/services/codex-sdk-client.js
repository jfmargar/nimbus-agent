const fs = require('fs/promises');

const DEFAULT_APPROVAL_MODE = 'never';
const DEFAULT_SANDBOX_MODE = 'workspace-write';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_FEEDBACK_POLL_MS = 150;

function createCodexSdkClient(options = {}) {
  const {
    agentTimeoutMs = DEFAULT_TIMEOUT_MS,
    approvalMode = DEFAULT_APPROVAL_MODE,
    codexPathOverride,
    env,
    getLocalCodexSessionMeta,
    loadCodexSdkModule = () => import('@openai/codex-sdk'),
    sandboxMode = DEFAULT_SANDBOX_MODE,
  } = options;

  let codexPromise = null;

  async function getCodex() {
    if (!codexPromise) {
      codexPromise = (async () => {
        const sdkModule = await loadCodexSdkModule();
        const Codex = sdkModule?.Codex;
        if (typeof Codex !== 'function') {
          throw new Error('No pude inicializar el SDK oficial de Codex.');
        }
        return new Codex({
          codexPathOverride,
          env,
        });
      })();
    }
    return codexPromise;
  }

  async function runTurn(request = {}) {
    const {
      cwd,
      imagePaths = [],
      model,
      onEvent,
      prompt,
      threadId,
      thinking,
      timeoutMs = agentTimeoutMs,
    } = request;

    const events = [];
    const threadItems = new Map();
    let finalResponse = '';
    const allOutputTexts = [];
    const currentTurnOutputTexts = [];
    let usage = null;
    let resolvedThreadId = String(threadId || '').trim();
    let timer = null;
    const controller = new AbortController();
    let sawTurnStarted = false;
    const recentEventKeys = [];
    const recentEventKeySet = new Set();
    const turnStartedAt = Date.now();
    let stopSessionFeedbackStream = null;

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        controller.abort(new Error(`Command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    try {
      const codex = await getCodex();
      const threadOptions = buildThreadOptions({
        approvalMode,
        cwd,
        model,
        sandboxMode,
        thinking,
      });
      const thread = resolvedThreadId
        ? codex.resumeThread(resolvedThreadId, threadOptions)
        : codex.startThread(threadOptions);
      stopSessionFeedbackStream = await ensureSessionFeedbackStream({
        getLocalCodexSessionMeta,
        onEvent: async (event) => {
          if (!rememberEventKey(recentEventKeys, recentEventKeySet, event)) return;
          events.push(event);
          if (typeof onEvent === 'function') {
            await onEvent(event);
          }
        },
        sinceTs: turnStartedAt,
        threadId: resolvedThreadId,
      });
      const input = buildInput(prompt, imagePaths);
      const streamedTurn = await thread.runStreamed(input, {
        signal: controller.signal,
      });

      for await (const rawEvent of streamedTurn.events) {
        if (rawEvent?.type === 'turn.started') {
          sawTurnStarted = true;
        }
        const normalizedEvents = normalizeThreadEvent(rawEvent, {
          cwd,
          knownThreadId: resolvedThreadId || thread.id || '',
          threadItems,
        });
        if (rawEvent?.type === 'thread.started' && rawEvent.thread_id) {
          resolvedThreadId = String(rawEvent.thread_id || '').trim();
          stopSessionFeedbackStream = await ensureSessionFeedbackStream({
            currentStop: stopSessionFeedbackStream,
            getLocalCodexSessionMeta,
            onEvent: async (event) => {
              if (!rememberEventKey(recentEventKeys, recentEventKeySet, event)) return;
              events.push(event);
              if (typeof onEvent === 'function') {
                await onEvent(event);
              }
            },
            sinceTs: turnStartedAt,
            threadId: resolvedThreadId,
          });
        } else if (!resolvedThreadId && thread.id) {
          resolvedThreadId = String(thread.id || '').trim();
          stopSessionFeedbackStream = await ensureSessionFeedbackStream({
            currentStop: stopSessionFeedbackStream,
            getLocalCodexSessionMeta,
            onEvent: async (event) => {
              if (!rememberEventKey(recentEventKeys, recentEventKeySet, event)) return;
              events.push(event);
              if (typeof onEvent === 'function') {
                await onEvent(event);
              }
            },
            sinceTs: turnStartedAt,
            threadId: resolvedThreadId,
          });
        }
        for (const event of normalizedEvents) {
          if (!rememberEventKey(recentEventKeys, recentEventKeySet, event)) continue;
          events.push(event);
          if (typeof onEvent === 'function') {
            await onEvent(event);
          }
          if (event.type === 'output_text' && event.text) {
            allOutputTexts.push(event.text);
            if (sawTurnStarted) {
              currentTurnOutputTexts.push(event.text);
            }
          }
          if (event.type === 'session' && event.threadId) {
            resolvedThreadId = String(event.threadId || '').trim();
          }
        }
        if (rawEvent?.type === 'turn.completed') {
          usage = rawEvent.usage || null;
        }
      }

      if (currentTurnOutputTexts.length > 0) {
        finalResponse = currentTurnOutputTexts[currentTurnOutputTexts.length - 1];
      } else if (allOutputTexts.length > 0) {
        finalResponse = allOutputTexts[allOutputTexts.length - 1];
      } else if (!finalResponse) {
        finalResponse = collectAgentMessages(threadItems);
      }

      return {
        text: finalResponse.trim(),
        conversationId: resolvedThreadId || undefined,
        threadId: resolvedThreadId || undefined,
        cwd: String(cwd || '').trim() || undefined,
        events,
        rawMeta: {
          usage,
        },
      };
    } catch (err) {
      const normalized = normalizeSdkError(err, timeoutMs);
      const errorEvent = {
        type: 'error',
        errorKind: normalized.errorKind,
        message: normalized.message,
      };
      events.push(errorEvent);
      if (typeof onEvent === 'function') {
        await onEvent(errorEvent);
      }
      normalized.events = events;
      throw normalized;
    } finally {
      if (timer) clearTimeout(timer);
      if (typeof stopSessionFeedbackStream === 'function') {
        await stopSessionFeedbackStream();
      }
    }
  }

  return {
    runTurn,
  };
}

async function ensureSessionFeedbackStream(options = {}) {
  const {
    currentStop,
    getLocalCodexSessionMeta,
    onEvent,
    sinceTs,
    threadId,
  } = options;
  if (typeof currentStop === 'function') {
    return currentStop;
  }
  if (typeof getLocalCodexSessionMeta !== 'function') {
    return currentStop || null;
  }
  const normalizedThreadId = String(threadId || '').trim();
  if (!normalizedThreadId) {
    return currentStop || null;
  }
  return startSessionFeedbackStream({
    getLocalCodexSessionMeta,
    onEvent,
    sinceTs,
    threadId: normalizedThreadId,
  });
}

async function startSessionFeedbackStream(options = {}) {
  const { getLocalCodexSessionMeta, onEvent, sinceTs, threadId } = options;
  if (typeof getLocalCodexSessionMeta !== 'function') {
    return null;
  }

  let meta = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    meta = await getLocalCodexSessionMeta(threadId);
    if (meta?.filePath) break;
    await delay(Math.min(SESSION_FEEDBACK_POLL_MS, 50 * (attempt + 1)));
  }

  const filePath = String(meta?.filePath || '').trim();
  if (!filePath) {
    return null;
  }

  let active = true;
  let timer = null;
  let offset = 0;
  let buffered = '';
  const seenLineKeys = new Set();

  try {
    const stat = await fs.stat(filePath);
    offset = stat.size;
  } catch {
    offset = 0;
  }

  const poll = async () => {
    if (!active) return;
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > offset) {
        const handle = await fs.open(filePath, 'r');
        try {
          const length = stat.size - offset;
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, offset);
          offset = stat.size;
          buffered += buffer.toString('utf8', 0, bytesRead);
        } finally {
          await handle.close();
        }

        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() || '';
        for (const line of lines) {
          const normalizedLine = String(line || '').trim();
          if (!normalizedLine) continue;
          const entry = parseSessionEntry(normalizedLine);
          if (!entry) continue;
          const event = normalizePersistedSessionEvent(entry, sinceTs);
          if (!event) continue;
          const lineKey = `${event.type}:${event.message || event.text || ''}`;
          if (seenLineKeys.has(lineKey)) continue;
          seenLineKeys.add(lineKey);
          if (typeof onEvent === 'function') {
            await onEvent(event);
          }
        }
      }
    } catch {
      // Ignore transient read errors while polling an active session file.
    } finally {
      if (active) {
        timer = setTimeout(() => {
          poll().catch(() => {});
        }, SESSION_FEEDBACK_POLL_MS);
      }
    }
  };

  timer = setTimeout(() => {
    poll().catch(() => {});
  }, SESSION_FEEDBACK_POLL_MS);

  return async () => {
    active = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

function parseSessionEntry(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizePersistedSessionEvent(entry, sinceTs) {
  const entryTs = normalizeDateInput(entry?.timestamp);
  if (sinceTs > 0 && entryTs > 0 && entryTs < sinceTs) {
    return null;
  }
  if (String(entry?.type || '').trim().toLowerCase() !== 'event_msg') {
    return null;
  }
  const payloadType = String(entry?.payload?.type || '').trim().toLowerCase();
  if (payloadType !== 'agent_reasoning') {
    return null;
  }
  const text = summarizeProgressText(entry?.payload?.text || '');
  if (!text) {
    return null;
  }
  return {
    type: 'status',
    phase: 'running',
    message: text,
    source: 'session_feedback',
  };
}

function normalizeDateInput(value) {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeProgressText(text) {
  const compact = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  return compact.length > 400 ? `${compact.slice(0, 397)}...` : compact;
}

function rememberEventKey(keys, keySet, event) {
  const key = `${event?.type || ''}|${event?.phase || ''}|${event?.tool || ''}|${
    event?.message || event?.text || ''
  }`;
  if (keySet.has(key)) {
    return false;
  }
  keys.push(key);
  keySet.add(key);
  if (keys.length > 100) {
    const oldest = keys.shift();
    if (oldest) keySet.delete(oldest);
  }
  return true;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildThreadOptions({
  approvalMode,
  cwd,
  model,
  sandboxMode,
  thinking,
}) {
  const options = {
    approvalPolicy: approvalMode || DEFAULT_APPROVAL_MODE,
    sandboxMode: sandboxMode || DEFAULT_SANDBOX_MODE,
    skipGitRepoCheck: true,
  };

  const workingDirectory = String(cwd || '').trim();
  if (workingDirectory) {
    options.workingDirectory = workingDirectory;
  }
  if (model) {
    options.model = model;
  }
  const reasoning = normalizeReasoningEffort(thinking);
  if (reasoning) {
    options.modelReasoningEffort = reasoning;
  }
  return options;
}

function buildInput(prompt, imagePaths = []) {
  const text = String(prompt || '').trim();
  const inputs = [];
  if (text) {
    inputs.push({ type: 'text', text });
  }
  for (const imagePath of imagePaths) {
    const normalized = String(imagePath || '').trim();
    if (!normalized) continue;
    inputs.push({ type: 'local_image', path: normalized });
  }
  if (inputs.length <= 1 && inputs[0]?.type === 'text') {
    return inputs[0].text;
  }
  return inputs;
}

function normalizeReasoningEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['minimal', 'low', 'medium', 'high', 'xhigh'].includes(normalized)) {
    return normalized;
  }
  return undefined;
}

function normalizeThreadEvent(rawEvent, options = {}) {
  const { cwd, knownThreadId, threadItems } = options;
  const events = [];

  if (!rawEvent || typeof rawEvent !== 'object') {
    return events;
  }

  if (rawEvent.type === 'thread.started') {
    events.push({
      type: 'session',
      conversationId: rawEvent.thread_id,
      threadId: rawEvent.thread_id,
      cwd: String(cwd || '').trim() || undefined,
      message: 'Codex: sesion iniciada.',
    });
    events.push({
      type: 'status',
      phase: 'starting',
      message: 'Codex: iniciando sesion...',
    });
    return events;
  }

  if (rawEvent.type === 'turn.started') {
    events.push({
      type: 'status',
      phase: 'starting',
      message: 'Codex: enviando turno...',
    });
    return events;
  }

  if (rawEvent.type === 'turn.completed') {
    events.push({
      type: 'status',
      phase: 'finalizing',
      message: 'Codex: finalizando respuesta...',
    });
    return events;
  }

  if (rawEvent.type === 'turn.failed') {
    const normalized = normalizeSdkError(rawEvent.error);
    events.push({
      type: 'error',
      errorKind: normalized.errorKind,
      message: normalized.message,
    });
    return events;
  }

  if (rawEvent.type === 'error') {
    const normalized = normalizeSdkError(rawEvent);
    events.push({
      type: 'error',
      errorKind: normalized.errorKind,
      message: normalized.message,
    });
    return events;
  }

  const item = rawEvent.item;
  if (!item || typeof item !== 'object') {
    return events;
  }

  if (item.id) {
    threadItems.set(item.id, item);
  }

  if (item.type === 'agent_message') {
    const text = String(item.text || '').trim();
    if (text) {
      events.push({
        type: 'output_text',
        text,
      });
      if (rawEvent.type === 'item.started' || rawEvent.type === 'item.updated') {
        events.push({
          type: 'status',
          phase: 'streaming',
          message: 'Codex: redactando respuesta...',
        });
      }
    }
    return events;
  }

  if (item.type === 'reasoning') {
    const text = String(item.text || '').trim();
    events.push({
      type: 'status',
      phase: 'running',
      message: text || 'Codex: razonando...',
    });
    return events;
  }

  if (item.type === 'todo_list') {
    const summary = summarizeTodoList(item.items);
    events.push({
      type: 'status',
      phase: 'running',
      message: summary || 'Codex: actualizando plan...',
    });
    return events;
  }

  if (item.type === 'command_execution') {
    events.push({
      type: 'tool_activity',
      tool: item.command || 'command_execution',
      state: mapItemState(rawEvent.type, item.status),
      detail: summarizeCommandOutput(item),
      message: buildCommandMessage(item, rawEvent.type),
    });
    return events;
  }

  if (item.type === 'mcp_tool_call') {
    const toolName = [item.server, item.tool].filter(Boolean).join(':') || 'mcp_tool_call';
    events.push({
      type: 'tool_activity',
      tool: toolName,
      state: mapItemState(rawEvent.type, item.status),
      detail: item.error?.message || '',
      message: buildToolMessage(toolName, rawEvent.type, item.status),
    });
    return events;
  }

  if (item.type === 'web_search') {
    const toolName = `web_search:${String(item.query || '').trim() || 'query'}`;
    events.push({
      type: 'tool_activity',
      tool: toolName,
      state: mapItemState(rawEvent.type, 'completed'),
      detail: String(item.query || '').trim(),
      message: 'Codex: realizando busqueda web...',
    });
    return events;
  }

  if (item.type === 'file_change') {
    events.push({
      type: 'tool_activity',
      tool: 'file_change',
      state: item.status === 'failed' ? 'failed' : 'finished',
      detail: formatChangedFiles(item.changes),
      message:
        item.status === 'failed'
          ? 'Codex: no pudo aplicar cambios en archivos.'
          : 'Codex: aplicando cambios en archivos...',
    });
    return events;
  }

  if (item.type === 'error') {
    const normalized = normalizeSdkError({ message: item.message });
    events.push({
      type: 'warning',
      message: normalized.message,
    });
    return events;
  }

  if (knownThreadId) {
    events.push({
      type: 'session',
      conversationId: knownThreadId,
      threadId: knownThreadId,
      cwd: String(cwd || '').trim() || undefined,
      message: 'Codex: continuando sesion existente.',
    });
  }
  return events;
}

function mapItemState(eventType, status) {
  if (eventType === 'item.started') return 'started';
  if (status === 'failed') return 'failed';
  return 'finished';
}

function summarizeCommandOutput(item) {
  const output = String(item?.aggregated_output || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!output) return '';
  return output.length > 200 ? `${output.slice(0, 197)}...` : output;
}

function buildCommandMessage(item, eventType) {
  const command = String(item?.command || '').trim();
  if (eventType === 'item.started') {
    return command
      ? `Codex: ejecutando comando: ${command}`
      : 'Codex: ejecutando comando...';
  }
  if (item?.status === 'failed') {
    return command
      ? `Codex: comando fallo: ${command}`
      : 'Codex: un comando fallo.';
  }
  return command
    ? `Codex: comando completado: ${command}`
    : 'Codex: comando completado.';
}

function buildToolMessage(toolName, eventType, status) {
  if (eventType === 'item.started') {
    return `Codex: ejecutando herramienta ${toolName}...`;
  }
  if (status === 'failed') {
    return `Codex: la herramienta ${toolName} fallo.`;
  }
  return `Codex: herramienta ${toolName} completada.`;
}

function formatChangedFiles(changes = []) {
  return changes
    .map((change) => `${change.kind || 'update'}:${change.path || '?'}`)
    .join(', ');
}

function summarizeTodoList(items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const pending = items.find((item) => item && item.completed === false);
  const candidate = pending || items[0];
  const text = String(candidate?.text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const prefix = pending ? 'Codex plan: ' : 'Codex plan completado: ';
  const summarized = `${prefix}${text}`;
  return summarized.length > 200 ? `${summarized.slice(0, 197)}...` : summarized;
}

function collectAgentMessages(threadItems) {
  return [...threadItems.values()]
    .filter((item) => item?.type === 'agent_message')
    .map((item) => String(item.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeSdkError(err, timeoutMs) {
  const message = extractErrorMessage(err) || 'Codex no pudo completar la solicitud.';
  const normalized = new Error(message);
  normalized.code = err?.code;
  normalized.stderr = err?.stderr;
  normalized.errorKind = classifyErrorKind(message, err, timeoutMs);
  return normalized;
}

function classifyErrorKind(message, err, timeoutMs) {
  const text = `${String(message || '')}\n${String(err?.stderr || '')}`.toLowerCase();
  if (
    err?.code === 'ENOENT' ||
    text.includes("cannot find package '@openai/codex-sdk'") ||
    text.includes('failed to spawn codex') ||
    text.includes('spawn codex') ||
    text.includes('codex not found')
  ) {
    return 'cli_missing';
  }
  if (
    text.includes('thread not found') ||
    text.includes('session not found') ||
    text.includes('could not find thread') ||
    text.includes('no such session')
  ) {
    return 'session_not_found';
  }
  if (text.includes('approval')) {
    return 'approval_required';
  }
  if (
    text.includes('sandbox') ||
    text.includes('operation not permitted') ||
    text.includes('permission denied')
  ) {
    return 'sandbox_denied';
  }
  if (
    err?.name === 'AbortError' ||
    err?.code === 'ETIMEDOUT' ||
    text.includes('timed out') ||
    (timeoutMs && text.includes(String(timeoutMs).toLowerCase()))
  ) {
    return 'timeout';
  }
  return 'unknown';
}

function extractErrorMessage(err) {
  if (!err) return '';
  if (typeof err.message === 'string' && err.message.trim()) {
    return err.message.trim();
  }
  if (typeof err.error?.message === 'string' && err.error.message.trim()) {
    return err.error.message.trim();
  }
  if (typeof err.stderr === 'string' && err.stderr.trim()) {
    return err.stderr.trim();
  }
  return String(err).trim();
}

module.exports = {
  createCodexSdkClient,
  normalizeSdkError,
};
