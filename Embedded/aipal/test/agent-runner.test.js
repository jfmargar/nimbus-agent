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
  let execWithPtyCalls = 0;
  let lastExecWithPtyOptions = null;
  let bootstrapCalls = 0;
  let retrievalCalls = 0;
  let lastBuildSharedPromptArgs = null;

  const codexAgent = {
    id: 'codex',
    label: 'codex',
    mergeStderr: false,
    transport: 'sdk',
    buildCommand: () => 'codex exec resume thread-id',
    buildInteractiveNewSessionCommand: () => 'codex interactive new',
    parseOutput: (output) => {
      if (typeof overrides.parseOutput === 'function') {
        return overrides.parseOutput(output);
      }
      return { text: 'respuesta resume', threadId: 'thread-id', sawJson: true };
    },
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
    listLocalCodexSessions: async (...args) => {
      if (typeof overrides.listLocalCodexSessions === 'function') {
        return overrides.listLocalCodexSessions(...args);
      }
      return [];
    },
    listLocalCodexSessionsSince: async (...args) => {
      if (typeof overrides.listLocalCodexSessionsSince === 'function') {
        return overrides.listLocalCodexSessionsSince(...args);
      }
      return [];
    },
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
    getExecWithPtyCalls: () => execWithPtyCalls,
    getLastBuildSharedPromptArgs: () => lastBuildSharedPromptArgs,
    getLastExecWithPtyOptions: () => lastExecWithPtyOptions,
    getRetrievalCalls: () => retrievalCalls,
  };
}

test('runAgentForChat creates visible codex sessions with interactive CLI when no thread exists', async () => {
  const harness = createRunnerHarness();

  const text = await harness.runner.runAgentForChat(1, 'Hola');

  assert.equal(text, 'respuesta nueva');
  assert.equal(harness.getExecCalls(), 0);
  assert.equal(harness.getExecWithPtyCalls(), 1);
  assert.equal(harness.sdkRequests.length, 0);
  assert.equal(harness.threads.get('chat:root:codex'), 'thread-cli');
  assert.equal(harness.setProjectCalls.length, 1);
  assert.equal(harness.getLastExecWithPtyOptions().timeout, 1000);
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
  assert.equal(harness.getExecWithPtyCalls(), 0);
});

test('runAgentForChat fails clearly when interactive creation does not resolve a visible session id', async () => {
  const harness = createRunnerHarness({
    findNewestSessionDiff: async () => [],
    listLocalCodexSessions: async () => [],
  });

  await assert.rejects(
    () => harness.runner.runAgentForChat(1, 'Hola'),
    /No pude crear una sesion visible de Codex/
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
    `Sesion creada y conectada en ${path.basename(
      harness.projectDir
    )}.\nA partir del proximo mensaje continuare esa sesion.`
  );
  assert.equal(harness.threads.get('chat:root:codex'), 'thread-cli');
});

test('runAgentForChat can wait for interactive completion when requested', async () => {
  const harness = createRunnerHarness({
    execLocalWithPty: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return 'Sesion lista.';
    },
    parseInteractiveOutput: () => ({ text: 'Sesion lista.', sawText: true }),
  });

  const text = await harness.runner.runAgentForChat(1, 'Nombrar sesion', {
    waitForInteractiveCompletion: true,
  });

  assert.equal(text, 'Sesion lista.');
  assert.equal(harness.threads.get('chat:root:codex'), 'thread-cli');
  assert.equal(harness.getLastExecWithPtyOptions().signal.aborted, false);
});

test('runAgentForChat does not abort interactive completion when the seed turn takes longer than the early-abort grace', async () => {
  const harness = createRunnerHarness({
    execLocalWithPty: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1700));
      return 'Sesion lista.';
    },
    parseInteractiveOutput: () => ({ text: 'Sesion lista.', sawText: true }),
  });

  const text = await harness.runner.runAgentForChat(1, 'Nombrar sesion', {
    waitForInteractiveCompletion: true,
  });

  assert.equal(text, 'Sesion lista.');
  assert.equal(harness.threads.get('chat:root:codex'), 'thread-cli');
  assert.equal(harness.getLastExecWithPtyOptions().signal.aborted, false);
});

test('runAgentTurnForChat can attach a visible session before interactive cleanup finishes', async () => {
  const harness = createRunnerHarness({
    execLocalWithPty: async (_command, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener(
          'abort',
          () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          },
          { once: true }
        );
      }),
    parseInteractiveOutput: () => ({ text: '', sawText: false }),
  });

  const startedAt = Date.now();
  const result = await harness.runner.runAgentTurnForChat(1, 'Nombrar sesion', {
    waitForInteractiveCompletion: true,
    backgroundInteractiveCleanup: true,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(
    result.text,
    `Sesion creada y conectada en ${path.basename(
      harness.projectDir
    )}.\nA partir del proximo mensaje continuare esa sesion.`
  );
  assert.equal(result.threadId, 'thread-cli');
  assert.equal(typeof result.cleanupPromise?.then, 'function');
  assert.equal(harness.threads.get('chat:root:codex'), 'thread-cli');
  assert.ok(elapsedMs < 1000);
  await result.cleanupPromise;
});

test('runAgentTurnForChat still detects a newly created local codex session when diff misses it', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aipal-agent-runner-project-'));
  const harness = createRunnerHarness({
    projectDir,
    findNewestSessionDiff: async () => [],
    listLocalCodexSessions: async () => [],
    listLocalCodexSessionsSince: async () => [
      {
        id: 'thread-fallback',
        cwd: projectDir,
        source: 'cli',
        timestamp: '2026-02-27T10:00:00.000Z',
      },
    ],
    execLocalWithPty: async (_command, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener(
          'abort',
          () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          },
          { once: true }
        );
      }),
    parseInteractiveOutput: () => ({ text: '', sawText: false }),
  });

  const result = await harness.runner.runAgentTurnForChat(1, 'Nombrar sesion', {
    waitForInteractiveCompletion: true,
    backgroundInteractiveCleanup: true,
  });

  assert.equal(result.threadId, 'thread-fallback');
  assert.equal(harness.threads.get('chat:root:codex'), 'thread-fallback');
  await result.cleanupPromise;
});

test('runAgentTurnForChat warns when it must reattach a previous codex session', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aipal-agent-runner-project-'));
  const harness = createRunnerHarness({
    projectDir,
    findNewestSessionDiff: async () => [],
    listLocalCodexSessions: async () => [
      {
        id: 'thread-existing',
        cwd: projectDir,
        source: 'cli',
        timestamp: '2026-02-26T10:00:00.000Z',
      },
    ],
    listLocalCodexSessionsSince: async () => [],
    execLocalWithPty: async (_command, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener(
          'abort',
          () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          },
          { once: true }
        );
      }),
    parseInteractiveOutput: () => ({ text: '', sawText: false }),
  });

  const result = await harness.runner.runAgentTurnForChat(1, 'Nombrar sesion', {
    waitForInteractiveCompletion: true,
    backgroundInteractiveCleanup: true,
  });

  assert.equal(
    result.text,
    `No pude confirmar la creacion de una sesion nueva en ${path.basename(
      harness.projectDir
    )}.\nHe vuelto a conectar la sesion anterior del proyecto y seguire trabajando ahi.`
  );
  assert.equal(result.threadId, 'thread-existing');
  assert.equal(result.reusedExistingSession, true);
  assert.equal(harness.threads.get('chat:root:codex'), 'thread-existing');
});

test('runAgentTurnForChat uses interactive output thread id when session diff misses the new codex session', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aipal-agent-runner-project-'));
  const harness = createRunnerHarness({
    projectDir,
    findNewestSessionDiff: async () => [],
    listLocalCodexSessions: async () => [],
    listLocalCodexSessionsSince: async () => [],
    execLocalWithPty: async () => `
Token usage: total=7215 input=7146 output=69
To continue this session, run codex resume 019ca828-c4e9-7cc1-9be5-0a5f110110ce
`,
    parseInteractiveOutput: (output) => ({
      text: '',
      sawText: false,
      threadId: output.includes('codex resume')
        ? '019ca828-c4e9-7cc1-9be5-0a5f110110ce'
        : '',
    }),
  });

  const result = await harness.runner.runAgentTurnForChat(1, 'Nombrar sesion', {
    waitForInteractiveCompletion: true,
    backgroundInteractiveCleanup: true,
  });

  assert.equal(result.threadId, '019ca828-c4e9-7cc1-9be5-0a5f110110ce');
  assert.equal(result.reusedExistingSession, false);
  assert.equal(harness.threads.get('chat:root:codex'), '019ca828-c4e9-7cc1-9be5-0a5f110110ce');
});

test('runAgentForChat waits for the interactive timeout instead of aborting when completion is explicitly requested', async () => {
  const harness = createRunnerHarness({
    execLocalWithPty: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const err = new Error('Command timed out after 1000ms');
      err.code = 'ETIMEDOUT';
      err.stdout = 'Tip: Use /help for commands';
      throw err;
    },
    parseInteractiveOutput: () => ({ text: '', sawText: false }),
  });

  const startedAt = Date.now();
  const text = await harness.runner.runAgentForChat(1, 'Nombrar sesion', {
    waitForInteractiveCompletion: true,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(
    text,
    `Sesion creada y conectada en ${path.basename(
      harness.projectDir
    )}.\nA partir del proximo mensaje continuare esa sesion.`
  );
  assert.equal(harness.threads.get('chat:root:codex'), 'thread-cli');
  assert.equal(harness.getLastExecWithPtyOptions().signal.aborted, false);
  assert.ok(elapsedMs < 10000);
});

test('runAgentForChat uses confirmation reply when interactive output is suspicious', async () => {
  const harness = createRunnerHarness({
    execLocalWithPty: async () => 'Tip: Use /help for commands',
    parseInteractiveOutput: () => ({ text: 'Tip: Use /help for commands', sawText: true }),
  });

  const text = await harness.runner.runAgentForChat(1, 'Hola');

  assert.equal(
    text,
    `Sesion creada y conectada en ${path.basename(
      harness.projectDir
    )}.\nA partir del proximo mensaje continuare esa sesion.`
  );
  assert.equal(harness.threads.get('chat:root:codex'), 'thread-cli');
});

test('runAgentForChat forwards sdk events to onEvent callback', async () => {
  const seen = [];
  const harness = createRunnerHarness({
    resolveThreadId: () => ({
      threadKey: 'chat:root:codex',
      threadId: 'thread-existing',
      migrated: false,
    }),
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

  assert.deepEqual(harness.getLastBuildSharedPromptArgs(), [
    'Revisa esto',
    ['/tmp/image.png'],
    'salida comando',
    ['/tmp/doc.pdf'],
  ]);
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
