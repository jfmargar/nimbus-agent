const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  findNewestSessionDiff,
  getLocalCodexSessionMeta,
  listLocalCodexSessions,
  listLocalCodexSessionsSince,
} = require('../src/services/codex-sessions');

async function writeSessionFile(rootDir, relativePath, payloadLines) {
  const filePath = path.join(rootDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${payloadLines.join('\n')}\n`, 'utf8');
  return filePath;
}

test('listLocalCodexSessions and getLocalCodexSessionMeta read session metadata', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aipal-codex-sessions-'));
  const sessionId = '019be543-b9f4-7e30-9b99-198434bc1f0c';
  const cwd = '/Users/test/workspace/project-a';

  try {
    await writeSessionFile(tempRoot, '2026/02/27/session-a.jsonl', [
      JSON.stringify({
        timestamp: '2026-02-27T09:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: sessionId,
          timestamp: '2026-02-27T09:00:00.000Z',
          cwd,
          source: 'cli',
        },
      }),
      JSON.stringify({
        timestamp: '2026-02-27T09:01:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Revisar el login' }],
        },
      }),
    ]);

    const sessions = await listLocalCodexSessions({
      sessionsDir: tempRoot,
      limit: 10,
      cwd,
    });

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, sessionId);
    assert.equal(sessions[0].cwd, cwd);
    assert.equal(sessions[0].source, 'cli');
    assert.match(sessions[0].displayName, /Revisar el login/);

    const meta = await getLocalCodexSessionMeta(sessionId, {
      sessionsDir: tempRoot,
    });
    assert.ok(meta);
    assert.equal(meta.id, sessionId);
    assert.equal(meta.cwd, cwd);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('findNewestSessionDiff prefers new cli sessions after snapshot timestamp', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aipal-codex-sessions-'));
  const cwd = '/Users/test/workspace/project-a';

  try {
    await writeSessionFile(tempRoot, '2026/02/27/session-old.jsonl', [
      JSON.stringify({
        timestamp: '2026-02-27T09:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: '019be543-b9f4-7e30-9b99-198434bc1f0c',
          timestamp: '2026-02-27T09:00:00.000Z',
          cwd,
          source: 'exec',
        },
      }),
    ]);
    await writeSessionFile(tempRoot, '2026/02/27/session-new.jsonl', [
      JSON.stringify({
        timestamp: '2026-02-27T09:05:00.000Z',
        type: 'session_meta',
        payload: {
          id: '019be543-b9f4-7e30-9b99-198434bc1f0d',
          timestamp: '2026-02-27T09:05:00.000Z',
          cwd,
          source: 'cli',
        },
      }),
    ]);

    const recent = await listLocalCodexSessionsSince({
      sessionsDir: tempRoot,
      cwd,
      sinceTs: '2026-02-27T09:01:00.000Z',
      limit: 10,
    });
    assert.equal(recent.length, 1);
    assert.equal(recent[0].id, '019be543-b9f4-7e30-9b99-198434bc1f0d');

    const diff = await findNewestSessionDiff({
      sessionsDir: tempRoot,
      cwd,
      sinceTs: '2026-02-27T09:01:00.000Z',
      previousIds: ['019be543-b9f4-7e30-9b99-198434bc1f0c'],
      limit: 10,
    });
    assert.equal(diff.length, 1);
    assert.equal(diff[0].id, '019be543-b9f4-7e30-9b99-198434bc1f0d');
    assert.equal(diff[0].source, 'cli');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
