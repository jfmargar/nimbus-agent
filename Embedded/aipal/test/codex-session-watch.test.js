const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createCodexSessionWatcher } = require('../src/services/codex-session-watch');

async function createSessionFile(lines = []) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aipal-session-watch-'));
  const filePath = path.join(dir, 'session.jsonl');
  await fs.writeFile(filePath, lines.join('\n'));
  return { dir, filePath };
}

test('codex-session-watch emits persisted agent_reasoning progress', async () => {
  const { dir, filePath } = await createSessionFile([
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-03-03T12:00:01.000Z',
      payload: { type: 'agent_reasoning', text: 'Voy a revisar App.kt.' },
    }),
  ]);
  const progressEvents = [];
  let completed = null;
  const watcher = createCodexSessionWatcher({
    threadId: 'thread-1',
    sessionFilePath: filePath,
    startedAt: '2026-03-03T12:00:00.000Z',
    getLocalCodexSessionTurnState: async () => ({
      assistantMessage: '',
      assistantTimestamp: '',
      taskComplete: false,
      taskCompleteTimestamp: '',
    }),
    onProgressEvent: async (event) => {
      progressEvents.push(event);
    },
    onCompleted: async (event) => {
      completed = event;
    },
  });

  try {
    await watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(progressEvents.length, 1);
    assert.equal(progressEvents[0].source, 'session_feedback');
    assert.equal(progressEvents[0].message, 'Voy a revisar App.kt.');
    assert.equal(completed, null);
  } finally {
    await watcher.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('codex-session-watch resolves session file path later and completes on taskComplete', async () => {
  const { dir, filePath } = await createSessionFile();
  const progressEvents = [];
  const completions = [];
  let metadataCalls = 0;
  let turnStateCalls = 0;
  const watcher = createCodexSessionWatcher({
    threadId: 'thread-2',
    startedAt: '2026-03-03T12:00:00.000Z',
    getLocalCodexSessionMeta: async () => {
      metadataCalls += 1;
      return metadataCalls >= 2 ? { filePath } : {};
    },
    getLocalCodexSessionTurnState: async () => {
      turnStateCalls += 1;
      return turnStateCalls >= 2
        ? {
            assistantMessage: 'Resultado final',
            assistantTimestamp: '2026-03-03T12:00:02.000Z',
            taskComplete: true,
            taskCompleteTimestamp: '2026-03-03T12:00:02.100Z',
          }
        : {
            assistantMessage: '',
            assistantTimestamp: '',
            taskComplete: false,
            taskCompleteTimestamp: '',
          };
    },
    onProgressEvent: async (event) => {
      progressEvents.push(event);
    },
    onCompleted: async (event) => {
      completions.push(event);
    },
  });

  try {
    await watcher.start();
    await fs.appendFile(
      filePath,
      `${JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-03-03T12:00:01.000Z',
        payload: { type: 'agent_reasoning', text: 'Checking repository layout' },
      })}\n`
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(progressEvents.length, 1);
    assert.equal(completions.length, 1);
    assert.equal(completions[0].assistantMessage, 'Resultado final');
  } finally {
    await watcher.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
