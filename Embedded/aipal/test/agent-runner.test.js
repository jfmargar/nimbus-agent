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
  const sdkRequests = [];
  let execCalls = 0;
  let bootstrapCalls = 0;
  let retrievalCalls = 0;
  let lastBuildSharedPromptArgs = null;

  const codexAgent = {
    id: 'codex',
    label: 'codex',
    mergeStderr: false,
    transport: 'sdk',
    buildCommand: () => 'codex exec resume thread-id',
    parseOutput: () => ({ text: 'respuesta resume', threadId: 'thread-id', sawJson: true }),
  };

  const runner = createAgentRunner({
    agentMaxBuffer: 1024 * 1024,
    agentTimeoutMs: 1000,
    buildBootstrapContext: async () => {
      bootstrapCalls += 1;
      return 'bootstrap';
    },
    buildMemoryRetrievalContext: async () => {
      retrievalCalls += 1;
      return '';
    },
    buildPrompt: (prompt) => prompt,
    buildSharedSessionPrompt: (...args) => {
      lastBuildSharedPromptArgs = args;
      if (typeof overrides.buildSharedSessionPrompt === 'function') {
        return overrides.buildSharedSessionPrompt(...args);
      }
      return args[0];
    },
    codexApprovalMode: 'never',
    codexSandboxMode: 'workspace-write',
    createCodexSdkClient: () => ({
      runTurn: async (request) => {
        sdkRequests.push(request);
        if (typeof overrides.runSdkTurn === 'function') {
          return overrides.runSdkTurn(request);
        }
        if (typeof request.onEvent === 'function') {
          await request.onEvent({
            type: 'status',
            phase: 'starting',
            message: 'Codex: iniciando sesion...',
          });
        }
        return {
          text: 'respuesta sdk',
          threadId: 'thread-sdk',
          conversationId: 'thread-sdk',
          events: [],
        };
      },
    }),
    documentDir: '/tmp',
    execLocal: async () => {
      execCalls += 1;
      if (typeof overrides.execLocal === 'function') {
        return overrides.execLocal();
      }
      return '{"type":"thread.started","thread_id":"thread-id"}';
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
    wrapCommandWithPty: (value) => value,
  });

  return {
    projectDir,
    runner,
    sdkRequests,
    setProjectCalls,
    threads,
    getBootstrapCalls: () => bootstrapCalls,
    getExecCalls: () => execCalls,
    getLastBuildSharedPromptArgs: () => lastBuildSharedPromptArgs,
    getRetrievalCalls: () => retrievalCalls,
  };
}

test('runAgentForChat creates visible codex sessions with sdk when no thread exists', async () => {
  const harness = createRunnerHarness();

  const text = await harness.runner.runAgentForChat(1, 'Hola');

  assert.equal(text, 'respuesta sdk');
  assert.equal(harness.getExecCalls(), 0);
  assert.equal(harness.sdkRequests.length, 1);
  assert.equal(harness.sdkRequests[0].threadId, '');
  assert.equal(harness.threads.get('chat:root:codex'), 'thread-sdk');
  assert.equal(harness.setProjectCalls.length, 1);
  assert.equal(harness.getBootstrapCalls(), 0);
  assert.equal(harness.getRetrievalCalls(), 0);
  assert.deepEqual(harness.getLastBuildSharedPromptArgs(), ['Hola', [], undefined, []]);
});

test('runAgentForChat reuses existing codex session through sdk', async () => {
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
    runSdkTurn: async (request) => ({
      text: 'respuesta reanudada',
      threadId: request.threadId,
      conversationId: request.threadId,
      events: [],
    }),
  });

  const text = await harness.runner.runAgentForChat(1, 'Continua');

  assert.equal(text, 'respuesta reanudada');
  assert.equal(harness.sdkRequests.length, 1);
  assert.equal(harness.sdkRequests[0].threadId, 'thread-existing');
  assert.equal(harness.getExecCalls(), 0);
});

test('runAgentForChat fails clearly when sdk does not resolve a visible session id', async () => {
  const harness = createRunnerHarness({
    findNewestSessionDiff: async () => [],
    runSdkTurn: async () => ({
      text: 'sin thread',
      threadId: '',
      conversationId: '',
      events: [],
    }),
  });

  await assert.rejects(
    () => harness.runner.runAgentForChat(1, 'Hola'),
    /No pude crear una sesion visible de Codex/
  );
  assert.equal(harness.threads.size, 0);
});

test('runAgentForChat forwards sdk events to onEvent callback', async () => {
  const seen = [];
  const harness = createRunnerHarness({
    runSdkTurn: async (request) => {
      await request.onEvent({
        type: 'status',
        phase: 'running',
        message: 'Codex: razonando...',
      });
      await request.onEvent({
        type: 'tool_activity',
        tool: 'git status',
        state: 'started',
        message: 'Codex: ejecutando comando: git status',
      });
      return {
        text: 'respuesta sdk',
        threadId: 'thread-sdk',
        conversationId: 'thread-sdk',
        events: [],
      };
    },
  });

  await harness.runner.runAgentForChat(1, 'Hola', {
    onEvent: async (event) => {
      seen.push(event.message || event.type);
    },
  });

  assert.deepEqual(seen, [
    'Codex: razonando...',
    'Codex: ejecutando comando: git status',
  ]);
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

  const promptPayload = JSON.parse(harness.sdkRequests[0].prompt);
  assert.equal(promptPayload.prompt, 'Revisa esto');
  assert.deepEqual(promptPayload.imagePaths, ['/tmp/image.png']);
  assert.deepEqual(promptPayload.documentPaths, ['/tmp/doc.pdf']);
  assert.equal(promptPayload.scriptContext, 'salida comando');
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
    codexApprovalMode: 'never',
    codexSandboxMode: 'workspace-write',
    createCodexSdkClient: () => ({
      runTurn: async () => {
        throw new Error('should not use sdk');
      },
    }),
    documentDir: '/tmp',
    execLocal: async () => 'salida final',
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
    wrapCommandWithPty: (value) => value,
  });

  const text = await runner.runAgentForChat(1, 'Hola');

  assert.equal(text, 'salida final');
});
