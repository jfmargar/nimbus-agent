const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createAgentRunner,
  isSessionCompatibleWithProject,
} = require('../src/services/agent-runner');

test('isSessionCompatibleWithProject matches equal project cwd', () => {
  assert.equal(
    isSessionCompatibleWithProject(
      { cwd: '/Users/test/workspace/project-a' },
      '/Users/test/workspace/project-a'
    ),
    true
  );
});

test('isSessionCompatibleWithProject rejects mismatched cwd', () => {
  assert.equal(
    isSessionCompatibleWithProject(
      { cwd: '/Users/test/workspace/project-a' },
      '/Users/test/workspace/project-b'
    ),
    false
  );
});

test('isSessionCompatibleWithProject accepts nested cwd under project root', () => {
  assert.equal(
    isSessionCompatibleWithProject(
      { cwd: '/Users/test/workspace/project-a/submodule' },
      '/Users/test/workspace/project-a'
    ),
    true
  );
});

function createRunnerHarness(overrides = {}) {
  const projectDir =
    overrides.projectDir ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'aipal-agent-runner-project-'));
  const threads = new Map();
  const threadTurns = new Map();
  const setProjectCalls = [];
  let execCalls = 0;
  let execWithPtyCalls = 0;
  let lastExecWithPtyOptions = null;
  let bootstrapCalls = 0;
  let retrievalCalls = 0;
  let lastBuildPromptArgs = null;
  let lastBuildSharedPromptArgs = null;

  const codexAgent = {
    id: 'codex',
    label: 'codex',
    mergeStderr: false,
    buildCommand: () => 'codex exec resume thread-id',
    buildInteractiveNewSessionCommand: () => 'codex interactive new',
    parseOutput: () => ({ text: 'respuesta resume', threadId: 'thread-id', sawJson: true }),
    parseInteractiveOutput: (output) => {
      if (typeof overrides.parseInteractiveOutput === 'function') {
        return overrides.parseInteractiveOutput(output);
      }
      return { text: 'respuesta nueva', sawText: true };
    },
  };

  const runner = createAgentRunner({
    agentMaxBuffer: 1024 * 1024,
    agentTimeoutMs: 1000,
    buildBootstrapContext: async (...args) => {
      bootstrapCalls += 1;
      if (typeof overrides.buildBootstrapContext === 'function') {
        return overrides.buildBootstrapContext(...args);
      }
      return 'bootstrap';
    },
    buildMemoryRetrievalContext: async (...args) => {
      retrievalCalls += 1;
      if (typeof overrides.buildMemoryRetrievalContext === 'function') {
        return overrides.buildMemoryRetrievalContext(...args);
      }
      return '';
    },
    buildPrompt: (...args) => {
      lastBuildPromptArgs = args;
      if (typeof overrides.buildPrompt === 'function') {
        return overrides.buildPrompt(...args);
      }
      return args[0];
    },
    buildSharedSessionPrompt: (...args) => {
      lastBuildSharedPromptArgs = args;
      if (typeof overrides.buildSharedSessionPrompt === 'function') {
        return overrides.buildSharedSessionPrompt(...args);
      }
      return args[0];
    },
    documentDir: '/tmp',
    execLocal: async () => {
      execCalls += 1;
      if (typeof overrides.execLocal === 'function') {
        return overrides.execLocal();
      }
      return '{"type":"thread.started","thread_id":"thread-id"}';
    },
    execLocalWithPty: async (...args) => {
      execWithPtyCalls += 1;
      lastExecWithPtyOptions = args[1] || null;
      if (typeof overrides.execLocalWithPty === 'function') {
        return overrides.execLocalWithPty(...args);
      }
      return 'respuesta nueva';
    },
    fileInstructionsEvery: 3,
    findNewestSessionDiff: async () => {
      if (typeof overrides.findNewestSessionDiff === 'function') {
        return overrides.findNewestSessionDiff();
      }
      return [
        {
          id: 'thread-cli',
          cwd: projectDir,
          source: 'cli',
          timestamp: '2026-02-27T10:00:00.000Z',
        },
      ];
    },
    getAgent: () => codexAgent,
    getAgentLabel: () => 'codex',
    getGlobalAgent: () => 'codex',
    getGlobalModels: () => ({ codex: 'gpt-5-codex' }),
    getGlobalThinking: () => 'medium',
    getDefaultAgentCwd: () => projectDir,
    getLocalCodexSessionMeta: async (threadId) => {
      if (typeof overrides.getLocalCodexSessionMeta === 'function') {
        return overrides.getLocalCodexSessionMeta(threadId);
      }
      return {
        id: threadId,
        cwd: projectDir,
        source: 'cli',
      };
    },
    getThreads: () => threads,
    imageDir: '/tmp',
    listLocalCodexSessions: async () => [],
    listLocalCodexSessionsSince: async () => [],
    listSqliteCodexThreads: async () => [],
    memoryRetrievalLimit: 5,
    persistProjectOverrides: async () => {},
    persistThreads: async () => {},
    prefixTextWithTimestamp: (text) => text,
    resolveAgentProjectCwd: async () => projectDir,
    resolveEffectiveAgentId: () => 'codex',
    resolveThreadId: () => {
      if (typeof overrides.resolveThreadId === 'function') {
        return overrides.resolveThreadId(threads);
      }
      return {
        threadKey: 'chat:root:codex',
        threadId: '',
        migrated: false,
      };
    },
    shellQuote: (value) => `'${String(value)}'`,
    setProjectForAgent: (...args) => {
      setProjectCalls.push(args);
      return args[3];
    },
    threadTurns,
    defaultTimeZone: 'Europe/Madrid',
  });

  return {
    projectDir,
    runner,
    threads,
    threadTurns,
    setProjectCalls,
    getExecCalls: () => execCalls,
    getExecWithPtyCalls: () => execWithPtyCalls,
    getLastExecWithPtyOptions: () => lastExecWithPtyOptions,
    getBootstrapCalls: () => bootstrapCalls,
    getRetrievalCalls: () => retrievalCalls,
    getLastBuildPromptArgs: () => lastBuildPromptArgs,
    getLastBuildSharedPromptArgs: () => lastBuildSharedPromptArgs,
  };
}

test('runAgentForChat creates visible codex sessions with interactive CLI when no thread exists', async () => {
  const harness = createRunnerHarness();

  const text = await harness.runner.runAgentForChat(1, 'Hola');

  assert.equal(text, 'respuesta nueva');
  assert.equal(harness.getExecWithPtyCalls(), 1);
  assert.equal(harness.getExecCalls(), 0);
  assert.equal(harness.threads.get('chat:root:codex'), 'thread-cli');
  assert.equal(harness.setProjectCalls.length, 1);
  assert.equal(harness.getLastExecWithPtyOptions().timeout, 1000);
  assert.equal(harness.getBootstrapCalls(), 0);
  assert.equal(harness.getRetrievalCalls(), 0);
  assert.deepEqual(harness.getLastBuildSharedPromptArgs(), ['Hola', [], undefined, []]);
});

test('runAgentForChat keeps using exec resume when thread exists', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aipal-agent-runner-project-'));
  const harness = createRunnerHarness({
    projectDir,
    resolveThreadId: () => ({
      threadKey: 'chat:root:codex',
      threadId: 'thread-existing',
      migrated: false,
    }),
    getLocalCodexSessionMeta: async () => ({
      id: 'thread-existing',
      cwd: projectDir,
      source: 'cli',
    }),
  });

  const text = await harness.runner.runAgentForChat(1, 'Continua');

  assert.equal(text, 'respuesta resume');
  assert.equal(harness.getExecCalls(), 1);
  assert.equal(harness.getExecWithPtyCalls(), 0);
  assert.equal(harness.getBootstrapCalls(), 0);
  assert.equal(harness.getRetrievalCalls(), 0);
});

test('runAgentForChat fails clearly when interactive creation does not resolve a visible session', async () => {
  const harness = createRunnerHarness({
    findNewestSessionDiff: async () => [],
  });

  await assert.rejects(
    () => harness.runner.runAgentForChat(1, 'Hola'),
    /No pude crear una sesión visible de Codex/
  );
  assert.equal(harness.threads.size, 0);
});

test('runAgentForChat treats interactive timeout as success when a visible cli session is detected', async () => {
  const harness = createRunnerHarness({
    execLocalWithPty: async () => {
      const err = new Error('Command timed out after 1000ms');
      err.code = 'ETIMEDOUT';
      err.stdout = '\u001b[32mTip: Use /help for commands\u001b[0m';
      throw err;
    },
  });

  const text = await harness.runner.runAgentForChat(1, 'Hola');

  assert.equal(
    text,
    `Sesión creada y conectada en ${path.basename(
      harness.projectDir
    )}.\nA partir del próximo mensaje continuaré esa sesión.`
  );
  assert.equal(harness.threads.get('chat:root:codex'), 'thread-cli');
});

test('runAgentForChat uses confirmation reply when interactive output is suspicious', async () => {
  const harness = createRunnerHarness({
    execLocalWithPty: async () => 'Tip: Use /help for commands',
    parseInteractiveOutput: () => ({ text: 'Tip: Use /help for commands', sawText: true }),
  });

  const text = await harness.runner.runAgentForChat(1, 'Hola');

  assert.equal(
    text,
    `Sesión creada y conectada en ${path.basename(
      harness.projectDir
    )}.\nA partir del próximo mensaje continuaré esa sesión.`
  );
  assert.equal(harness.threads.get('chat:root:codex'), 'thread-cli');
});

test('runAgentForChat uses minimal shared prompt for codex attachments and script context', async () => {
  const harness = createRunnerHarness({
    buildSharedSessionPrompt: (prompt, imagePaths, scriptContext, documentPaths) =>
      JSON.stringify({ prompt, imagePaths, scriptContext, documentPaths }),
  });

  await harness.runner.runAgentForChat(1, 'Revisa esto', {
    topicId: 42,
    imagePaths: ['/tmp/image.png'],
    documentPaths: ['/tmp/doc.pdf'],
    scriptContext: 'salida comando',
  });

  const promptPayload = JSON.parse(harness.getLastBuildSharedPromptArgs()[0] ? JSON.stringify({
    prompt: harness.getLastBuildSharedPromptArgs()[0],
    imagePaths: harness.getLastBuildSharedPromptArgs()[1],
    scriptContext: harness.getLastBuildSharedPromptArgs()[2],
    documentPaths: harness.getLastBuildSharedPromptArgs()[3],
  }) : '{}');
  assert.equal(promptPayload.prompt, 'Revisa esto');
  assert.deepEqual(promptPayload.imagePaths, ['/tmp/image.png']);
  assert.deepEqual(promptPayload.documentPaths, ['/tmp/doc.pdf']);
  assert.equal(promptPayload.scriptContext, 'salida comando');
  assert.equal(harness.getBootstrapCalls(), 0);
  assert.equal(harness.getRetrievalCalls(), 0);
});

test('runAgentForChat keeps enriched prompt path for non-codex agents', async () => {
  const threads = new Map();
  const runner = createAgentRunner({
    agentMaxBuffer: 1024 * 1024,
    agentTimeoutMs: 1000,
    buildBootstrapContext: async () => 'bootstrap',
    buildMemoryRetrievalContext: async () => 'retrieval',
    buildPrompt: (prompt) => prompt,
    buildSharedSessionPrompt: () => {
      throw new Error('should not use shared prompt');
    },
    documentDir: '/tmp',
    execLocal: async () => 'salida final',
    execLocalWithPty: async () => {
      throw new Error('should not use pty');
    },
    fileInstructionsEvery: 3,
    findNewestSessionDiff: async () => [],
    getAgent: () => ({
      id: 'claude',
      label: 'claude',
      mergeStderr: false,
      buildCommand: ({ prompt }) => `claude ${JSON.stringify(prompt)}`,
      parseOutput: () => ({ text: 'salida final', threadId: '', sawJson: true }),
    }),
    getAgentLabel: () => 'claude',
    getGlobalAgent: () => 'claude',
    getGlobalModels: () => ({}),
    getGlobalThinking: () => 'medium',
    getDefaultAgentCwd: () => '',
    getLocalCodexSessionMeta: async () => null,
    getThreads: () => threads,
    imageDir: '/tmp',
    listLocalCodexSessions: async () => [],
    listLocalCodexSessionsSince: async () => [],
    listSqliteCodexThreads: async () => [],
    memoryRetrievalLimit: 5,
    persistProjectOverrides: async () => {},
    persistThreads: async () => {},
    prefixTextWithTimestamp: (text) => `ts:${text}`,
    resolveAgentProjectCwd: async () => '',
    resolveEffectiveAgentId: () => 'claude',
    resolveThreadId: () => ({ threadKey: 'chat:root:claude', threadId: '', migrated: false }),
    shellQuote: (value) => `'${String(value)}'`,
    setProjectForAgent: () => '',
    threadTurns: new Map(),
    defaultTimeZone: 'Europe/Madrid',
  });

  const text = await runner.runAgentForChat(1, 'Hola');

  assert.equal(text, 'salida final');
});

test('runAgentForChat caps interactive new-session timeout to 45 seconds', async () => {
  const harness = createRunnerHarness({
    execLocalWithPty: async () => 'respuesta nueva',
  });

  const longTimeoutHarness = createRunnerHarness({
    projectDir: harness.projectDir,
  });

  const runner = createAgentRunner({
    agentMaxBuffer: 1024 * 1024,
    agentTimeoutMs: 600000,
    buildBootstrapContext: async () => 'bootstrap',
    buildMemoryRetrievalContext: async () => '',
    buildPrompt: (prompt) => prompt,
    buildSharedSessionPrompt: (prompt) => prompt,
    documentDir: '/tmp',
    execLocal: async () => '{"type":"thread.started","thread_id":"thread-id"}',
    execLocalWithPty: async (...args) => {
      longTimeoutHarness.execArgs = args[1];
      return 'respuesta nueva';
    },
    fileInstructionsEvery: 3,
    findNewestSessionDiff: async () => [
      {
        id: 'thread-cli',
        cwd: harness.projectDir,
        source: 'cli',
        timestamp: '2026-02-27T10:00:00.000Z',
      },
    ],
    getAgent: () => ({
      id: 'codex',
      label: 'codex',
      mergeStderr: false,
      buildCommand: () => 'codex exec resume thread-id',
      buildInteractiveNewSessionCommand: () => 'codex interactive new',
      parseOutput: () => ({ text: 'respuesta resume', threadId: 'thread-id', sawJson: true }),
      parseInteractiveOutput: () => ({ text: 'respuesta nueva', sawText: true }),
    }),
    getAgentLabel: () => 'codex',
    getGlobalAgent: () => 'codex',
    getGlobalModels: () => ({ codex: 'gpt-5-codex' }),
    getGlobalThinking: () => 'medium',
    getDefaultAgentCwd: () => harness.projectDir,
    getLocalCodexSessionMeta: async () => ({ cwd: harness.projectDir, source: 'cli' }),
    getThreads: () => new Map(),
    imageDir: '/tmp',
    listLocalCodexSessions: async () => [],
    listLocalCodexSessionsSince: async () => [],
    listSqliteCodexThreads: async () => [],
    memoryRetrievalLimit: 5,
    persistProjectOverrides: async () => {},
    persistThreads: async () => {},
    prefixTextWithTimestamp: (text) => text,
    resolveAgentProjectCwd: async () => harness.projectDir,
    resolveEffectiveAgentId: () => 'codex',
    resolveThreadId: () => ({ threadKey: 'chat:root:codex', threadId: '', migrated: false }),
    shellQuote: (value) => `'${String(value)}'`,
    setProjectForAgent: () => harness.projectDir,
    threadTurns: new Map(),
    defaultTimeZone: 'Europe/Madrid',
  });

  await runner.runAgentForChat(1, 'Hola');
  assert.equal(longTimeoutHarness.execArgs.timeout, 45000);
});
