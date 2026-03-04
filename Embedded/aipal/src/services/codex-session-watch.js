const fs = require('fs/promises');

const SESSION_FEEDBACK_POLL_MS = 150;
const TURN_STATE_POLL_MS = 250;
const ASSISTANT_MESSAGE_DEBOUNCE_MS = 500;

function createCodexSessionWatcher(options = {}) {
  const {
    threadId,
    sessionFilePath,
    startedAt,
    getLocalCodexSessionMeta,
    getLocalCodexSessionTurnState,
    onProgressEvent,
    onCompleted,
    onError,
  } = options;

  const normalizedThreadId = String(threadId || '').trim();
  const sinceTs = normalizeDateInput(startedAt);
  let resolvedSessionFilePath = String(sessionFilePath || '').trim();
  let started = false;
  let stopped = false;
  let fileTimer = null;
  let stateTimer = null;
  let offset = 0;
  let fileInitialized = false;
  let buffered = '';
  let completionDelivered = false;
  let candidateAssistantKey = '';
  let candidateAssistantDetectedAt = 0;
  const seenProgressKeys = new Set();

  async function emitError(message) {
    if (typeof onError === 'function') {
      await onError({ type: 'failed', message: String(message || '').trim() });
    }
  }

  async function ensureSessionFilePath() {
    if (resolvedSessionFilePath) return resolvedSessionFilePath;
    if (!normalizedThreadId || typeof getLocalCodexSessionMeta !== 'function') {
      return '';
    }
    try {
      const meta = await getLocalCodexSessionMeta(normalizedThreadId);
      const nextPath = String(meta?.filePath || '').trim();
      if (nextPath) {
        resolvedSessionFilePath = nextPath;
      }
    } catch {
      // Ignore transient metadata resolution failures.
    }
    return resolvedSessionFilePath;
  }

  async function initializeFileOffset() {
    if (fileInitialized || !resolvedSessionFilePath) return;
    fileInitialized = true;
    offset = 0;
  }

  async function pollSessionFile() {
    if (stopped || completionDelivered) return;
    try {
      await ensureSessionFilePath();
      await initializeFileOffset();
      if (resolvedSessionFilePath) {
        const stat = await fs.stat(resolvedSessionFilePath);
        if (stat.size < offset) {
          offset = 0;
          buffered = '';
        }
        if (stat.size > offset) {
          const handle = await fs.open(resolvedSessionFilePath, 'r');
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
          if (buffered && offset === stat.size) {
            lines.push(buffered);
            buffered = '';
          }
          for (const line of lines) {
            const entry = parseSessionEntry(line);
            if (!entry) continue;
            const event = normalizePersistedSessionEvent(entry, sinceTs, resolvedSessionFilePath);
            if (!event) continue;
            const progressKey = [
              event.timestamp || '',
              event.source || '',
              event.message || '',
            ].join('|');
            if (seenProgressKeys.has(progressKey)) continue;
            seenProgressKeys.add(progressKey);
            if (typeof onProgressEvent === 'function') {
              await onProgressEvent(event);
            }
          }
        }
      }
    } catch {
      // Ignore transient read errors while the session is active.
    } finally {
      if (!stopped && !completionDelivered) {
        fileTimer = setTimeout(() => {
          pollSessionFile().catch((err) => {
            emitError(err?.message || err).catch(() => {});
          });
        }, SESSION_FEEDBACK_POLL_MS);
      }
    }
  }

  async function emitCompleted(state) {
    if (completionDelivered) return;
    completionDelivered = true;
    await stop();
    if (typeof onCompleted === 'function') {
      await onCompleted({
        type: 'completed',
        assistantMessage: String(state?.assistantMessage || '').trim(),
        assistantTimestamp: String(state?.assistantTimestamp || '').trim(),
        taskComplete: Boolean(state?.taskComplete),
        taskCompleteTimestamp: String(state?.taskCompleteTimestamp || '').trim(),
      });
    }
  }

  async function pollTurnState() {
    if (stopped || completionDelivered) return;
    try {
      if (normalizedThreadId && typeof getLocalCodexSessionTurnState === 'function') {
        const state = await getLocalCodexSessionTurnState(normalizedThreadId, {
          sinceTs,
        });
        if (state?.taskComplete) {
          await emitCompleted(state);
          return;
        }
        const assistantMessage = String(state?.assistantMessage || '').trim();
        const assistantTimestamp = String(state?.assistantTimestamp || '').trim();
        if (assistantMessage && assistantTimestamp) {
          const candidateKey = `${assistantTimestamp}|${assistantMessage}`;
          if (candidateAssistantKey !== candidateKey) {
            candidateAssistantKey = candidateKey;
            candidateAssistantDetectedAt = Date.now();
          } else if (
            candidateAssistantDetectedAt > 0 &&
            Date.now() - candidateAssistantDetectedAt >= ASSISTANT_MESSAGE_DEBOUNCE_MS
          ) {
            await emitCompleted(state);
            return;
          }
        }
      }
    } catch {
      // Ignore transient turn-state failures while following.
    } finally {
      if (!stopped && !completionDelivered) {
        stateTimer = setTimeout(() => {
          pollTurnState().catch((err) => {
            emitError(err?.message || err).catch(() => {});
          });
        }, TURN_STATE_POLL_MS);
      }
    }
  }

  async function start() {
    if (started || stopped) return;
    started = true;
    await Promise.all([pollSessionFile(), pollTurnState()]);
  }

  async function stop() {
    stopped = true;
    if (fileTimer) {
      clearTimeout(fileTimer);
      fileTimer = null;
    }
    if (stateTimer) {
      clearTimeout(stateTimer);
      stateTimer = null;
    }
  }

  return {
    start,
    stop,
  };
}

function normalizePersistedSessionEvent(entry, sinceTs, sessionFilePath) {
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
  const message = summarizeProgressText(entry?.payload?.text || '');
  if (!message) return null;
  return {
    type: 'progress',
    source: 'session_feedback',
    message,
    timestamp: String(entry?.timestamp || '').trim(),
    sessionFilePath: String(sessionFilePath || '').trim(),
  };
}

function parseSessionEntry(line) {
  const normalized = String(line || '').trim();
  if (!normalized) return null;
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function summarizeProgressText(text) {
  const compact = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  return compact.length > 400 ? `${compact.slice(0, 397)}...` : compact;
}

function normalizeDateInput(value) {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

module.exports = {
  createCodexSessionWatcher,
};
