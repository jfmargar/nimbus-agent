const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function resolveDefaultSessionsDir() {
  const codexHome = String(process.env.CODEX_HOME || '').trim();
  if (codexHome) {
    return path.join(codexHome, 'sessions');
  }
  return path.join(os.homedir(), '.codex', 'sessions');
}

function resolveDefaultStateSqlitePath() {
  const codexHome = String(process.env.CODEX_HOME || '').trim();
  if (codexHome) {
    return path.join(codexHome, 'state_5.sqlite');
  }
  return path.join(os.homedir(), '.codex', 'state_5.sqlite');
}

const DEFAULT_SESSIONS_DIR = resolveDefaultSessionsDir();
const DEFAULT_STATE_SQLITE_PATH = resolveDefaultStateSqlitePath();
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 500;
const SESSION_ID_REGEX = /^[0-9a-f][0-9a-f-]{15,}$/i;

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeCwd(value) {
  if (!value) return '';
  try {
    return path.resolve(String(value));
  } catch {
    return '';
  }
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value;
  }
}

async function readHead(filePath, size = 24 * 1024) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readTail(filePath, size = 64 * 1024) {
  const stat = await fs.stat(filePath);
  const start = Math.max(0, stat.size - size);
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(stat.size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

function extractMetaFromHead(filePath, head, fallbackTimestamp) {
  const idMatch = head.match(/"type":"session_meta".*?"id":"([^"]+)"/s);
  const fileIdMatch = filePath.match(/([0-9a-f]{8,}-[0-9a-f-]{10,})\.jsonl$/i);
  const id = (idMatch && idMatch[1]) || (fileIdMatch && fileIdMatch[1]) || '';
  if (!SESSION_ID_REGEX.test(id)) return null;

  const timestampMatch = head.match(
    /"type":"session_meta","payload":\{"id":"[^"]+","timestamp":"([^"]+)"/
  );
  const cwdMatch = head.match(/"type":"session_meta".*?"cwd":"((?:\\.|[^"\\])*)"/s);
  const sourceMatch = head.match(/"type":"session_meta".*?"source":"((?:\\.|[^"\\])*)"/s);
  const cwd = cwdMatch ? decodeJsonString(cwdMatch[1]) : '';
  const source = sourceMatch ? decodeJsonString(sourceMatch[1]) : '';
  const displayName = extractSessionDisplayNameFromHead(head);

  return {
    id,
    timestamp: (timestampMatch && timestampMatch[1]) || fallbackTimestamp,
    cwd,
    source,
    displayName,
    filePath,
  };
}

async function collectSessionFiles(rootDir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      await collectSessionFiles(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(fullPath);
    }
  }
  return out;
}

function byNewestPath(a, b) {
  return b.localeCompare(a);
}

function cwdMatches(sessionCwd, targetCwd) {
  if (!targetCwd) return true;
  const normalizedSession = normalizeCwd(sessionCwd);
  if (!normalizedSession) return false;
  return (
    normalizedSession === targetCwd ||
    normalizedSession.startsWith(`${targetCwd}${path.sep}`)
  );
}

function extractTextFromContent(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extractTextFromContent(item))
      .filter(Boolean);
    return parts.join(' ').trim();
  }
  if (typeof value !== 'object') return '';

  if (typeof value.text === 'string' && value.text.trim()) {
    return value.text.trim();
  }
  if (typeof value.output_text === 'string' && value.output_text.trim()) {
    return value.output_text.trim();
  }
  if (value.content) {
    const nested = extractTextFromContent(value.content);
    if (nested) return nested;
  }
  return '';
}

function extractEntryMessageText(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const type = String(entry.type || '').toLowerCase();
  if (type === 'session_meta') return '';

  const candidates = [entry.item, entry.payload, entry.data, entry];
  for (const candidate of candidates) {
    const text = extractTextFromContent(candidate);
    if (text) return text;
  }
  return '';
}

function extractSessionDisplayNameFromHead(headContent) {
  const lines = String(headContent || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    try {
      const entry = JSON.parse(lines[i]);
      const text = extractEntryMessageText(entry);
      if (!text) continue;
      const compact = text.replace(/\s+/g, ' ').trim();
      if (!compact) continue;
      if (compact.length <= 96) return compact;
      return `${compact.slice(0, 93)}...`;
    } catch {
      // Ignore malformed line.
    }
  }
  return '';
}

function extractLastSessionMessageFromTail(tailContent) {
  const lines = String(tailContent || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const entry = JSON.parse(lines[i]);
      const text = extractEntryMessageText(entry);
      if (text) return text;
    } catch {
      // Ignore malformed line.
    }
  }
  return '';
}

function extractSessionTurnStateFromTail(tailContent, options = {}) {
  const sinceTs = normalizeDateInput(options.sinceTs);
  const state = {
    assistantMessage: '',
    assistantTimestamp: '',
    taskComplete: false,
    taskCompleteTimestamp: '',
  };
  const lines = String(tailContent || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i += 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const entryTs = normalizeDateInput(entry?.timestamp);
    if (sinceTs > 0 && entryTs > 0 && entryTs < sinceTs) {
      continue;
    }

    const type = String(entry?.type || '').trim().toLowerCase();
    const payload = entry?.payload;
    if (
      type === 'response_item' &&
      String(payload?.type || '').trim().toLowerCase() === 'message' &&
      String(payload?.role || '').trim().toLowerCase() === 'assistant'
    ) {
      const text = extractTextFromContent(payload);
      if (text) {
        state.assistantMessage = text;
        state.assistantTimestamp = String(entry?.timestamp || '').trim();
      }
      continue;
    }

    if (
      type === 'event_msg' &&
      String(payload?.type || '').trim().toLowerCase() === 'task_complete'
    ) {
      state.taskComplete = true;
      state.taskCompleteTimestamp = String(entry?.timestamp || '').trim();
      if (!state.assistantMessage && typeof payload?.last_agent_message === 'string') {
        const text = String(payload.last_agent_message || '').trim();
        if (text) {
          state.assistantMessage = text;
          state.assistantTimestamp = String(entry?.timestamp || '').trim();
        }
      }
    }
  }

  return state;
}

async function listLocalCodexSessions(options = {}) {
  const sessionsDir = options.sessionsDir || DEFAULT_SESSIONS_DIR;
  const limit = normalizeLimit(options.limit);
  const targetCwd = normalizeCwd(options.cwd);
  const files = await collectSessionFiles(sessionsDir);
  files.sort(byNewestPath);

  const sessions = [];
  for (const filePath of files) {
    if (sessions.length >= limit) break;
    try {
      const stat = await fs.stat(filePath);
      const fallbackTimestamp = stat.mtime.toISOString();
      const head = await readHead(filePath);
      const meta = extractMetaFromHead(filePath, head, fallbackTimestamp);
      if (!meta) continue;
      if (!cwdMatches(meta.cwd, targetCwd)) continue;
      sessions.push(meta);
    } catch {
      // Ignore malformed/rotated files.
    }
  }
  return sessions;
}

function normalizeDateInput(value) {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function listLocalCodexSessionsSince(options = {}) {
  const sinceTs = normalizeDateInput(options.sinceTs);
  const sessions = await listLocalCodexSessions(options);
  if (!sinceTs) return sessions;
  return sessions.filter((session) => normalizeDateInput(session.timestamp) >= sinceTs);
}

async function findNewestSessionDiff(options = {}) {
  const previousIds = new Set(
    Array.isArray(options.previousIds)
      ? options.previousIds.map((value) => String(value || '').trim()).filter(Boolean)
      : []
  );
  const candidates = await listLocalCodexSessionsSince(options);
  const filtered = candidates.filter((session) => !previousIds.has(String(session.id || '').trim()));
  filtered.sort((a, b) => {
    const sourceA = String(a?.source || '').toLowerCase() === 'cli' ? 1 : 0;
    const sourceB = String(b?.source || '').toLowerCase() === 'cli' ? 1 : 0;
    if (sourceA !== sourceB) return sourceB - sourceA;
    return normalizeDateInput(b?.timestamp) - normalizeDateInput(a?.timestamp);
  });
  return filtered;
}

function isValidSessionId(value) {
  if (!value) return false;
  return SESSION_ID_REGEX.test(String(value).trim());
}

async function getLocalCodexSessionMeta(sessionId, options = {}) {
  const id = String(sessionId || '').trim();
  if (!isValidSessionId(id)) return null;
  const sessionsDir = options.sessionsDir || DEFAULT_SESSIONS_DIR;
  const sessions = await listLocalCodexSessions({
    sessionsDir,
    limit: MAX_LIMIT,
  });
  const fromFiles = sessions.find((session) => session.id === id);
  if (fromFiles) return fromFiles;

  const fromSqlite = await listSqliteCodexThreads({
    sqlitePath: options.sqlitePath,
    sessionId: id,
    limit: 1,
  });
  return fromSqlite[0] || null;
}

async function getLocalCodexSessionLastMessage(sessionId, options = {}) {
  const id = String(sessionId || '').trim();
  if (!isValidSessionId(id)) return '';
  const sessionsDir = options.sessionsDir || DEFAULT_SESSIONS_DIR;

  let filePath = '';
  if (typeof options.filePath === 'string' && options.filePath.trim()) {
    filePath = options.filePath.trim();
  } else {
    const found = await getLocalCodexSessionMeta(id, {
      sessionsDir,
    });
    filePath = found?.filePath || '';
  }
  if (!filePath) return '';

  try {
    const tail = await readTail(filePath);
    return extractLastSessionMessageFromTail(tail);
  } catch {
    return '';
  }
}

async function getLocalCodexSessionTurnState(sessionId, options = {}) {
  const id = String(sessionId || '').trim();
  if (!isValidSessionId(id)) {
    return {
      assistantMessage: '',
      assistantTimestamp: '',
      taskComplete: false,
      taskCompleteTimestamp: '',
    };
  }
  const sessionsDir = options.sessionsDir || DEFAULT_SESSIONS_DIR;

  let filePath = '';
  if (typeof options.filePath === 'string' && options.filePath.trim()) {
    filePath = options.filePath.trim();
  } else {
    const found = await getLocalCodexSessionMeta(id, {
      sessionsDir,
    });
    filePath = found?.filePath || '';
  }
  if (!filePath) {
    return {
      assistantMessage: '',
      assistantTimestamp: '',
      taskComplete: false,
      taskCompleteTimestamp: '',
    };
  }

  try {
    const tail = await readTail(filePath);
    return extractSessionTurnStateFromTail(tail, {
      sinceTs: options.sinceTs,
    });
  } catch {
    return {
      assistantMessage: '',
      assistantTimestamp: '',
      taskComplete: false,
      taskCompleteTimestamp: '',
    };
  }
}

function normalizeSqliteRows(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, source, cwd, title, createdAt, updatedAt] = line.split('\t');
      return {
        id: String(id || '').trim(),
        source: String(source || '').trim(),
        cwd: String(cwd || '').trim(),
        displayName: String(title || '').trim(),
        timestamp: createdAt
          ? new Date(Number.parseInt(createdAt, 10) * 1000).toISOString()
          : '',
        updatedTimestamp: updatedAt
          ? new Date(Number.parseInt(updatedAt, 10) * 1000).toISOString()
          : '',
        filePath: '',
      };
    })
    .filter((row) => isValidSessionId(row.id));
}

async function listSqliteCodexThreads(options = {}) {
  const sqlitePath = options.sqlitePath || DEFAULT_STATE_SQLITE_PATH;
  const limit = normalizeLimit(options.limit);
  const targetCwd = normalizeCwd(options.cwd);
  const targetSource = String(options.source || '').trim();
  const sessionId = String(options.sessionId || '').trim();
  const sinceSeconds = Math.floor(normalizeDateInput(options.sinceTs) / 1000);
  const clauses = ['1=1'];
  if (targetCwd) {
    clauses.push(`cwd = '${targetCwd.replace(/'/g, "''")}'`);
  }
  if (targetSource) {
    clauses.push(`source = '${targetSource.replace(/'/g, "''")}'`);
  }
  if (sessionId) {
    clauses.push(`id = '${sessionId.replace(/'/g, "''")}'`);
  }
  if (sinceSeconds > 0) {
    clauses.push(`created_at >= ${sinceSeconds}`);
  }
  const query = [
    'SELECT id, source, cwd, title, created_at, updated_at',
    'FROM threads',
    `WHERE ${clauses.join(' AND ')}`,
    'ORDER BY created_at DESC, id DESC',
    `LIMIT ${limit};`,
  ].join(' ');

  try {
    const output = await new Promise((resolve, reject) => {
      execFile(
        'sqlite3',
        ['-tabs', sqlitePath, query],
        { encoding: 'utf8', timeout: 5000 },
        (err, stdout) => {
          if (err) return reject(err);
          resolve(stdout || '');
        }
      );
    });
    return normalizeSqliteRows(output);
  } catch {
    return [];
  }
}

module.exports = {
  DEFAULT_SESSIONS_DIR,
  DEFAULT_STATE_SQLITE_PATH,
  findNewestSessionDiff,
  getLocalCodexSessionMeta,
  getLocalCodexSessionLastMessage,
  getLocalCodexSessionTurnState,
  isValidSessionId,
  listLocalCodexSessions,
  listLocalCodexSessionsSince,
  listSqliteCodexThreads,
};
