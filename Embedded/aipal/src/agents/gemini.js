const { shellQuote, resolvePromptValue } = require('./utils');

const GEMINI_CMD = 'gemini';
const GEMINI_OUTPUT_FORMAT = 'json';
const SESSION_ID_REGEX = /\[([0-9a-f-]{16,})\]/i;
const CAPACITY_MESSAGE_REGEX = /"message"\s*:\s*"([^"]+)"|No capacity available for model ([^\s"]+)/i;

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stripAnsi(value) {
  return String(value || '')
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '');
}

function extractJsonPayloadFromLines(value) {
  const lines = String(value || '').split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    const payload = safeJsonParse(trimmed);
    if (payload && typeof payload === 'object') {
      return payload;
    }
  }
  return null;
}

function normalizeErrorText(value) {
  const cleaned = stripAnsi(value);
  const trimmed = cleaned.trim();
  if (!trimmed) return '';

  const capacityMatch = trimmed.match(CAPACITY_MESSAGE_REGEX);
  if (capacityMatch) {
    return capacityMatch[1] || `No capacity available for model ${capacityMatch[2]}`;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const preferredLine =
    lines.find((line) => /RESOURCE_EXHAUSTED|rateLimitExceeded|permission|approval/i.test(line)) ||
    lines.find((line) => /failed with status \d+/i.test(line)) ||
    lines[0];

  return preferredLine || trimmed;
}

function buildCommand({ prompt, promptExpression, threadId, model }) {
  const promptValue = resolvePromptValue(prompt, promptExpression);
  const args = [
    '-p',
    promptValue,
    '--output-format',
    GEMINI_OUTPUT_FORMAT,
    '--approval-mode',
    'default',
  ];
  if (model) {
    args.push('--model', shellQuote(model));
  }
  if (threadId) {
    args.push('--resume', shellQuote(threadId));
  }
  return `${GEMINI_CMD} ${args.join(' ')}`.trim();
}

function parseOutput(output) {
  const trimmed = stripAnsi(output).trim();
  if (!trimmed) return { text: '', threadId: undefined, sawJson: false };
  const payload = safeJsonParse(trimmed) || extractJsonPayloadFromLines(trimmed);
  if (!payload || typeof payload !== 'object') {
    return { text: normalizeErrorText(trimmed), threadId: undefined, sawJson: false };
  }
  if (payload.error?.message) {
    return { text: String(payload.error.message), threadId: undefined, sawJson: true };
  }
  const response = typeof payload.response === 'string' ? payload.response.trim() : '';
  return { text: response, threadId: undefined, sawJson: true };
}

function listSessionsCommand() {
  return `${GEMINI_CMD} --list-sessions`;
}

function parseSessionList(output) {
  const lines = String(output || '').split(/\r?\n/);
  let lastId;
  for (const line of lines) {
    const match = line.match(SESSION_ID_REGEX);
    if (match) {
      lastId = match[1];
    }
  }
  return lastId;
}

module.exports = {
  id: 'gemini',
  label: 'gemini',
  needsPty: true,
  mergeStderr: false,
  buildCommand,
  parseOutput,
  listSessionsCommand,
  parseSessionList,
};
