const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildActiveTurnKey,
  clearActiveTurn,
  getActiveTurn,
  setActiveTurn,
} = require('../src/active-turn-store');

test('active-turn-store sets and gets an active turn by chat/topic/agent', () => {
  const activeTurns = new Map();

  const stored = setActiveTurn(activeTurns, 10, 20, 'codex', {
    threadId: 'thread-1',
    startedAt: '2026-03-03T12:00:00.000Z',
    status: 'running',
    sessionFilePath: '/tmp/session.jsonl',
  });

  assert.equal(buildActiveTurnKey(10, 20, 'codex'), '10:20:codex');
  assert.equal(stored.threadId, 'thread-1');
  assert.deepEqual(getActiveTurn(activeTurns, 10, 20, 'codex'), stored);
});

test('active-turn-store keeps topic entries isolated', () => {
  const activeTurns = new Map();

  setActiveTurn(activeTurns, 10, 20, 'codex', {
    threadId: 'thread-topic-a',
    startedAt: '2026-03-03T12:00:00.000Z',
    status: 'running',
  });
  setActiveTurn(activeTurns, 10, 21, 'codex', {
    threadId: 'thread-topic-b',
    startedAt: '2026-03-03T12:01:00.000Z',
    status: 'running',
  });

  assert.equal(getActiveTurn(activeTurns, 10, 20, 'codex').threadId, 'thread-topic-a');
  assert.equal(getActiveTurn(activeTurns, 10, 21, 'codex').threadId, 'thread-topic-b');
});

test('active-turn-store clears a stored entry', () => {
  const activeTurns = new Map();

  setActiveTurn(activeTurns, 10, 20, 'codex', {
    threadId: 'thread-1',
    startedAt: '2026-03-03T12:00:00.000Z',
    status: 'running',
  });

  assert.equal(clearActiveTurn(activeTurns, 10, 20, 'codex'), true);
  assert.equal(getActiveTurn(activeTurns, 10, 20, 'codex'), null);
});
