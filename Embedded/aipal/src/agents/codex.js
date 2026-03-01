const { shellQuote, resolvePromptValue } = require('./utils');

const CODEX_CMD = 'codex';
const BASE_ARGS = '--json --skip-git-repo-check --yolo';
const INTERACTIVE_BASE_ARGS = '--no-alt-screen -a never -s workspace-write';
const MODEL_ARG = '--model';
const REASONING_CONFIG_KEY = 'model_reasoning_effort';
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const INTERACTIVE_RESUME_ID_REGEX = /codex resume ([0-9a-f-]{16,})/i;

function appendOptionalArg(args, flag, value) {
  if (!flag || !value) return args;
  return `${args} ${flag} ${shellQuote(value)}`.trim();
}

function appendOptionalReasoning(args, value) {
  if (!value) return args;
  const configValue = `${REASONING_CONFIG_KEY}="${value}"`;
  return `${args} --config ${shellQuote(configValue)}`.trim();
}

function buildCommand({ prompt, promptExpression, threadId, model, thinking }) {
  const promptValue = resolvePromptValue(prompt, promptExpression);
  let args = BASE_ARGS;
  args = appendOptionalArg(args, MODEL_ARG, model);
  args = appendOptionalReasoning(args, thinking);
  if (threadId) {
    return `${CODEX_CMD} exec resume ${shellQuote(threadId)} ${args} ${promptValue}`.trim();
  }
  return `${CODEX_CMD} exec ${args} ${promptValue}`.trim();
}

function buildInteractiveNewSessionCommand({
  prompt,
  promptExpression,
  model,
  thinking,
  cwd,
}) {
  const promptValue = resolvePromptValue(prompt, promptExpression);
  let args = INTERACTIVE_BASE_ARGS;
  args = appendOptionalArg(args, '-C', cwd);
  args = appendOptionalArg(args, MODEL_ARG, model);
  args = appendOptionalReasoning(args, thinking);
  return `${CODEX_CMD} ${args} ${promptValue}`.trim();
}

function parseOutput(output) {
  const lines = String(output || '').split(/\r?\n/);
  let threadId;
  const allMessages = [];
  const finalMessages = [];
  let sawJson = false;
  let buffer = '';
  for (const line of lines) {
    if (!buffer) {
      if (!line.startsWith('{')) {
        continue;
      }
      buffer = line;
    } else {
      buffer += line;
    }
    let payload;
    try {
      payload = JSON.parse(buffer);
    } catch {
      continue;
    }
    sawJson = true;
    buffer = '';
    if (payload.type === 'thread.started' && payload.thread_id) {
      threadId = payload.thread_id;
      continue;
    }
    if (payload.type === 'item.completed' && payload.item && typeof payload.item.text === 'string') {
      const itemType = String(payload.item.type || '');
      if (itemType.includes('message')) {
        const text = String(payload.item.text || '');
        if (!text.trim()) continue;
        allMessages.push(text);
        const channel = String(
          payload.item.channel ||
            payload.item.message?.channel ||
            payload.item.metadata?.channel ||
            ''
        ).toLowerCase();
        if (channel === 'final') {
          finalMessages.push(text);
        }
      }
    }
  }
  const selected = finalMessages.length > 0 ? finalMessages : allMessages.slice(-1);
  const text = selected.join('\n').trim();
  return { text, threadId, sawJson };
}

function stripAnsi(value) {
  return String(value || '').replace(ANSI_PATTERN, '');
}

function parseInteractiveOutput(output) {
  const stripped = stripAnsi(output).replace(/\r/g, '\n');
  const resumeMatch = stripped.match(INTERACTIVE_RESUME_ID_REGEX);
  const threadId = resumeMatch ? String(resumeMatch[1] || '').trim() : '';
  const cleaned = stripped
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('WARNING: proceeding'))
    .filter((line) => !line.includes('interactive TUI may not work'))
    .filter((line) => !line.startsWith('Continue anyway?'))
    .filter((line) => !/^Error: Operation not permitted/.test(line))
    .filter((line) => !/^Tip:/i.test(line))
    .filter((line) => !/^Usage:/i.test(line))
    .filter((line) => !/^For more information/i.test(line))
    .filter((line) => !/^https?:\/\//i.test(line))
    .filter((line) => !/^[?[\]0-9;<>uhtlrmc\\]+$/.test(line))
    .filter((line) => !/^TUI/i.test(line))
    .filter((line) => line.length >= 8);

  if (cleaned.length === 0) return { text: '', threadId, sawText: false };
  const lastMeaningful = cleaned[cleaned.length - 1];
  return {
    text: lastMeaningful,
    threadId,
    sawText: Boolean(lastMeaningful),
  };
}

module.exports = {
  id: 'codex',
  label: 'codex',
  needsPty: false,
  mergeStderr: false,
  transport: 'sdk',
  buildCommand,
  buildInteractiveNewSessionCommand,
  parseOutput,
  parseInteractiveOutput,
};
