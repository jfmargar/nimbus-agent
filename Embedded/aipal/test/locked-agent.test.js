const test = require('node:test');
const assert = require('node:assert/strict');

const { registerHelpCommands } = require('../src/commands/help');
const { registerSettingsCommands } = require('../src/commands/settings');

function createFakeBot() {
  const commands = new Map();
  return {
    commands,
    command(name, handler) {
      commands.set(name, handler);
    },
    hears() {},
    on() {},
    action() {},
  };
}

function createSettingsOptions(bot, overrides = {}) {
  return {
    allowedUsers: new Set(),
    beginProgress: () => ({ finish() {} }),
    bot,
    buildMemoryThreadKey: () => 'thread-key',
    buildTopicKey: () => 'topic-key',
    captureMemoryEvent: async () => {},
    clearAgentOverride: () => {},
    codexProgressUpdatesEnabled: true,
    clearProjectForAgent: () => {},
    clearModelOverride: (models) => ({ nextModels: models || {}, hadOverride: false }),
    clearThreadForAgent: () => {},
    curateMemory: async () => {},
    execLocal: async () => '',
    extractCommandValue: (text) => String(text || '').trim().split(/\s+/).slice(1).join(' ').trim(),
    extractMemoryText: () => '',
    getAgent: (id) => ({ id, label: id }),
    getAgentLabel: (id) => id,
    getAgentOverride: () => undefined,
    getGlobalAgent: () => 'codex',
    getGlobalAgentCwd: () => '',
    getGlobalModels: () => ({}),
    getGlobalThinking: () => '',
    getProjectForAgent: () => '',
    getThreads: () => new Map(),
    getLocalCodexSessionMeta: async () => null,
    getLocalCodexSessionLastMessage: async () => '',
    getTopicId: () => undefined,
    isKnownAgent: () => true,
    isModelResetCommand: () => false,
    lockedAgentId: '',
    normalizeAgent: (value) => String(value || '').trim().toLowerCase(),
    normalizeTopicId: (value) => value || 'root',
    resolveThreadId: () => ({ threadId: '' }),
    persistAgentOverrides: async () => {},
    persistMemory: async (task) => task?.(),
    persistProjectOverrides: async () => {},
    persistThreads: async () => {},
    listLocalCodexSessions: async () => [],
    replyWithError: async () => {},
    replyWithResponse: async () => {},
    renderProgressEvent: () => '',
    resolveAgentProjectCwd: async () => '',
    setAgentOverride: () => {},
    setGlobalAgent: () => {},
    setGlobalAgentCwd: () => {},
    setGlobalModels: () => {},
    setGlobalThinking: () => {},
    setMemoryEventsSinceCurate: () => {},
    setProjectForAgent: () => {},
    setThreadForAgent: () => {},
    startTyping: () => () => {},
    threadTurns: new Map(),
    runAgentForChat: async () => ({ text: '' }),
    runAgentTurnForChat: async () => ({ text: '' }),
    updateConfig: async () => ({}),
    wrapCommandWithPty: (value) => value,
    isValidSessionId: () => true,
    ...overrides,
  };
}

test('locked agent disables /agent switching', async () => {
  const bot = createFakeBot();
  registerSettingsCommands(
    createSettingsOptions(bot, {
      lockedAgentId: 'gemini',
      getGlobalAgent: () => 'gemini',
      getAgentLabel: (id) => id,
    })
  );

  const replies = [];
  await bot.commands.get('agent')({
    chat: { id: 1 },
    message: { text: '/agent codex' },
    reply: async (message) => {
      replies.push(message);
    },
  });

  assert.deepEqual(replies, ['This bot is locked to gemini. `/agent` is disabled here.']);
});

test('locked agent reports current fixed agent on /agent', async () => {
  const bot = createFakeBot();
  registerSettingsCommands(
    createSettingsOptions(bot, {
      lockedAgentId: 'gemini',
      getGlobalAgent: () => 'gemini',
      getAgentLabel: (id) => id,
    })
  );

  const replies = [];
  await bot.commands.get('agent')({
    chat: { id: 1 },
    message: { text: '/agent' },
    reply: async (message) => {
      replies.push(message);
    },
  });

  assert.deepEqual(replies, ['Current agent (root): gemini. This bot is locked to gemini.']);
});

test('help reflects locked agent mode', async () => {
  const bot = createFakeBot();
  registerHelpCommands({
    allowedUsers: new Set(),
    bot,
    enqueue: () => {},
    extractCommandValue: () => '',
    lockedAgentId: 'gemini',
    markdownToTelegramHtml: (value) => value,
    replyWithError: async () => {},
    runAgentOneShot: async () => '',
    scriptManager: { listScripts: async () => [] },
    startTyping: () => () => {},
  });

  const replies = [];
  await bot.commands.get('help')({
    reply: async (message) => {
      replies.push(message);
    },
  });

  assert.match(replies[0], /\/agent - Locked to gemini/);
});
