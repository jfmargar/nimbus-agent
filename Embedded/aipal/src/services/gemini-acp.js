const { execFileSync, spawn } = require('child_process');
const { once } = require('events');
const fs = require('fs');
const path = require('path');
const { Readable, Writable } = require('stream');

const GEMINI_BIN = 'gemini';
const ACP_TIMEOUT_GRACE_MS = 1500;
const CAPACITY_MESSAGE_REGEX =
  /"message"\s*:\s*"([^"]+)"|No capacity available for model ([^\s"]+)/i;

let cachedSdk = null;

function normalizeErrorText(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const capacityMatch = trimmed.match(CAPACITY_MESSAGE_REGEX);
  if (capacityMatch) {
    return capacityMatch[1] || `No capacity available for model ${capacityMatch[2]}`;
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    lines.find((line) =>
      /RESOURCE_EXHAUSTED|rate limit|429|permission|approval/i.test(line)
    ) ||
    lines[0] ||
    trimmed
  );
}

function resolveGeminiCliEntry(execFileSyncImpl = execFileSync) {
  const whichOutput = execFileSyncImpl('which', [GEMINI_BIN], {
    encoding: 'utf8',
  });
  const binPath = fs.realpathSync(String(whichOutput || '').trim());
  return path.resolve(binPath);
}

function loadAcpSdk() {
  if (cachedSdk) return cachedSdk;
  const entryPath = resolveGeminiCliEntry();
  const packageRoot = path.resolve(entryPath, '..', '..');
  const sdkPath = path.join(
    packageRoot,
    'node_modules',
    '@agentclientprotocol',
    'sdk'
  );
  cachedSdk = require(sdkPath);
  return cachedSdk;
}

function createTimeoutError(timeoutMs) {
  const err = new Error(`Gemini agotó el tiempo de espera (${timeoutMs} ms).`);
  err.code = 'ETIMEDOUT';
  return err;
}

function getApprovalMode() {
  const normalized = String(process.env.AIPAL_GEMINI_APPROVAL_MODE || '')
    .trim()
    .toLowerCase();
  if (['default', 'auto_edit', 'yolo', 'plan'].includes(normalized)) {
    return normalized;
  }
  return 'default';
}

function createAbortError(reason) {
  const detail = String(reason?.message || reason || 'abort');
  const err = new Error(`Gemini cancelado: ${detail}`);
  err.code = 'ABORT_ERR';
  return err;
}

async function killChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit').catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, ACP_TIMEOUT_GRACE_MS)),
  ]);
  if (child.exitCode === null && !child.signalCode) {
    child.kill('SIGKILL');
    await once(child, 'exit').catch(() => {});
  }
}

function createGeminiAcpRunner(options = {}) {
  const {
    spawnImpl = spawn,
    loadSdk = loadAcpSdk,
    timeoutMs = 120000,
    toolHeartbeatMs = 8000,
  } = options;

  async function runTurn(runOptions = {}) {
    const {
      cwd,
      prompt,
      threadId,
      model,
      env,
      onApprovalRequest,
      onEvent,
      signal,
    } = runOptions;
    const sdk = loadSdk();
    const args = ['--experimental-acp', '--approval-mode', getApprovalMode()];
    if (model) {
      args.push('--model', String(model));
    }
    const child = spawnImpl(GEMINI_BIN, args, {
      cwd,
      env: { ...process.env, ...(env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let completed = false;
    let didTimeout = false;
    let sessionId = String(threadId || '').trim();
    let timeoutTimer = null;
    let abortListener = null;
    let connection = null;
    const outputChunks = [];
    let announcedResponse = false;
    const toolTitles = new Map();
    let toolHeartbeat = null;
    let activeToolLabel = '';
    let activeToolStartedAt = 0;
    let acceptSessionUpdates = false;

    function appendAgentChunk(textChunk) {
      const incoming = String(textChunk || '');
      if (!incoming) return;
      const current = outputChunks.join('');

      // Gemini streams can arrive as deltas or as "full text so far".
      if (current && incoming.startsWith(current)) {
        outputChunks.length = 0;
        outputChunks.push(incoming);
        return;
      }
      if (current && current.startsWith(incoming)) {
        return;
      }
      outputChunks.push(incoming);
    }

    async function emitEvent(event) {
      if (typeof onEvent !== 'function' || !event) return;
      try {
        await onEvent(event);
      } catch (err) {
        console.warn('Gemini progress event failed:', err);
      }
    }

    function buildToolTitle(update) {
      return String(update?.title || update?.toolCallId || 'tool').trim();
    }

    function clearToolHeartbeat() {
      if (!toolHeartbeat) return;
      clearInterval(toolHeartbeat);
      toolHeartbeat = null;
    }

    function formatElapsedLabel(startedAt) {
      const elapsedSeconds = Math.max(
        1,
        Math.floor((Date.now() - startedAt) / 1000)
      );
      return `${elapsedSeconds} s`;
    }

    function startToolHeartbeat(label) {
      clearToolHeartbeat();
      activeToolLabel = String(label || 'una herramienta').trim();
      activeToolStartedAt = Date.now();
      if (!toolHeartbeatMs || toolHeartbeatMs <= 0) return;
      toolHeartbeat = setInterval(() => {
        emitEvent({
          type: 'tool_activity',
          agent: 'gemini',
          tool: activeToolLabel,
          state: 'running',
          message: `Gemini: ${activeToolLabel} sigue en curso (${formatElapsedLabel(
            activeToolStartedAt
          )}).`,
        }).catch(() => {});
      }, toolHeartbeatMs);
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk || '');
      });
    }

    const childError = new Promise((_, reject) => {
      child.once('error', reject);
    });

    const client = {
      async requestPermission(params) {
        await emitEvent({
          type: 'status',
          agent: 'gemini',
          phase: 'awaiting_approval',
          message: `Gemini: esperando permiso para ${String(
            params?.toolCall?.title || 'continuar'
          ).trim()}.`,
        });
        if (typeof onApprovalRequest !== 'function') {
          const rejectOption = params.options.find(
            (option) => option.kind === 'reject_once'
          );
          if (!rejectOption) {
            throw new Error('Gemini pidió aprobación, pero no hay canal interactivo.');
          }
          return {
            outcome: {
              outcome: 'selected',
              optionId: rejectOption.optionId,
            },
          };
        }

        const decision = await onApprovalRequest({
          sessionId: params.sessionId,
          toolCall: params.toolCall,
          options: params.options,
          signal,
        });
        return {
          outcome: {
            outcome: 'selected',
            optionId: decision.optionId,
          },
        };
      },
      async sessionUpdate(params) {
        const update = params?.update;
        if (!update || typeof update !== 'object') return;
        if (!acceptSessionUpdates) {
          return;
        }
        if (update.sessionUpdate === 'tool_call') {
          const title = buildToolTitle(update);
          if (update.toolCallId) {
            toolTitles.set(String(update.toolCallId).trim(), title);
          }
          startToolHeartbeat(title);
          await emitEvent({
            type: 'tool_activity',
            agent: 'gemini',
            tool: title,
            state: 'running',
            message: `Gemini: ejecutando ${title}.`,
          });
          return;
        }
        if (update.sessionUpdate === 'tool_call_update') {
          const toolLabel =
            toolTitles.get(String(update.toolCallId || '').trim()) ||
            buildToolTitle(update);
          if (update.status === 'completed' || update.status === 'failed') {
            clearToolHeartbeat();
          }
          const statusText =
            update.status === 'completed'
              ? 'completó'
              : update.status === 'failed'
                ? 'falló'
                : 'actualizó';
          await emitEvent({
            type: 'tool_activity',
            agent: 'gemini',
            tool: toolLabel,
            state:
              update.status === 'completed'
                ? 'finished'
                : update.status === 'failed'
                  ? 'failed'
                  : 'running',
            message: `Gemini: ${statusText} ${toolLabel}.`,
          });
          return;
        }
        if (
          update.sessionUpdate === 'agent_message_chunk' &&
          update.content?.type === 'text'
        ) {
          clearToolHeartbeat();
          if (!announcedResponse) {
            announcedResponse = true;
            await emitEvent({
              type: 'status',
              agent: 'gemini',
              phase: 'responding',
              message: 'Gemini: preparando respuesta...',
            });
          }
          appendAgentChunk(update.content.text);
        }
      },
    };

    if (signal) {
      abortListener = () => {
        if (completed) return;
        if (sessionId && connection?.cancel) {
          connection.cancel({ sessionId }).catch(() => {});
        }
        killChild(child).catch(() => {});
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }

    try {
      const stream = sdk.ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout)
      );
      connection = new sdk.ClientSideConnection(() => client, stream);
      await emitEvent({
        type: 'status',
        agent: 'gemini',
        phase: 'initializing',
        message: 'Gemini: iniciando sesión...',
      });
      timeoutTimer = setTimeout(() => {
        if (completed) return;
        didTimeout = true;
        if (sessionId && connection?.cancel) {
          connection.cancel({ sessionId }).catch(() => {});
        }
        killChild(child).catch(() => {});
      }, timeoutMs);

      await Promise.race([
        connection.initialize({
          protocolVersion: sdk.PROTOCOL_VERSION,
          clientCapabilities: {},
        }),
        childError,
      ]);

      if (sessionId) {
        await emitEvent({
          type: 'status',
          agent: 'gemini',
          phase: 'resuming',
          message: 'Gemini: retomando sesión...',
        });
        await Promise.race([
          connection.loadSession({
            sessionId,
            cwd: cwd || process.cwd(),
            mcpServers: [],
          }),
          childError,
        ]);
      } else {
        await emitEvent({
          type: 'status',
          agent: 'gemini',
          phase: 'new_session',
          message: 'Gemini: creando sesión...',
        });
        const sessionResult = await Promise.race([
          connection.newSession({
            cwd: cwd || process.cwd(),
            mcpServers: [],
          }),
          childError,
        ]);
        sessionId = String(sessionResult?.sessionId || '').trim();
      }

      acceptSessionUpdates = true;
      await emitEvent({
        type: 'status',
        agent: 'gemini',
        phase: 'processing',
        message: 'Gemini: procesando solicitud...',
      });
      await Promise.race([
        connection.prompt({
          sessionId,
          prompt: [{ type: 'text', text: String(prompt || '') }],
        }),
        childError,
      ]);

      completed = true;
      clearToolHeartbeat();
      return {
        text: outputChunks.join('').trim(),
        threadId: sessionId,
      };
    } catch (err) {
      if (signal?.aborted) {
        throw createAbortError(signal.reason);
      }
      if (didTimeout) {
        const timeoutErr = createTimeoutError(timeoutMs);
        timeoutErr.cause = err;
        throw timeoutErr;
      }
      const detail = normalizeErrorText(
        err?.message || err?.stderr || stderr || err
      );
      const wrapped = new Error(detail || 'Gemini no pudo completar la petición.');
      wrapped.cause = err;
      wrapped.stderr = stderr;
      throw wrapped;
    } finally {
      completed = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
      }
      clearToolHeartbeat();
      await killChild(child).catch(() => {});
    }
  }

  return {
    runTurn,
  };
}

module.exports = {
  createGeminiAcpRunner,
  getApprovalMode,
  normalizeErrorText,
};
