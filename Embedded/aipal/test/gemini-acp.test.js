const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const { EventEmitter } = require('events');

const { createGeminiAcpRunner } = require('../src/services/gemini-acp');

function createChildProcess() {
  const child = new EventEmitter();
  child.pid = 4321;
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.exitCode = 0;
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.emit('exit', 0, null);
    return true;
  };
  return child;
}

test('gemini ACP runner handles approval requests and returns session output', async () => {
  delete process.env.AIPAL_GEMINI_APPROVAL_MODE;
  const child = createChildProcess();
  const spawned = [];
  let approvalRequest = null;

  const runner = createGeminiAcpRunner({
    timeoutMs: 5000,
    spawnImpl: (cmd, args) => {
      spawned.push({ cmd, args });
      return child;
    },
    loadSdk: () => ({
      PROTOCOL_VERSION: '1',
      ndJsonStream: () => ({}),
      ClientSideConnection: class {
        constructor(createClient) {
          this.client = createClient();
        }
        async initialize() {}
        async newSession() {
          return { sessionId: 'session-1' };
        }
        async loadSession() {}
        async cancel() {}
        async prompt() {
          await this.client.sessionUpdate({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Primera parte. ' },
            },
          });
          await this.client.requestPermission({
            sessionId: 'session-1',
            options: [
              { optionId: 'proceed_once', kind: 'allow_once' },
              { optionId: 'cancel', kind: 'reject_once' },
            ],
            toolCall: {
              toolCallId: 'tool-1',
              title: 'Run shell command',
              kind: 'execute',
              content: [],
            },
          });
          await this.client.sessionUpdate({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Segunda parte.' },
            },
          });
          return { stopReason: 'end_turn' };
        }
      },
    }),
  });

  const result = await runner.runTurn({
    cwd: process.cwd(),
    prompt: 'hola',
    onApprovalRequest: async (request) => {
      approvalRequest = request;
      return { optionId: 'proceed_once' };
    },
  });

  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0], {
    cmd: 'gemini',
    args: ['--experimental-acp', '--approval-mode', 'default'],
  });
  assert.equal(approvalRequest.toolCall.title, 'Run shell command');
  assert.deepEqual(result, {
    text: 'Primera parte. Segunda parte.',
    threadId: 'session-1',
  });
});

test('gemini ACP runner honors AIPAL_GEMINI_APPROVAL_MODE=yolo', async () => {
  process.env.AIPAL_GEMINI_APPROVAL_MODE = 'yolo';
  const child = createChildProcess();
  const spawned = [];

  const runner = createGeminiAcpRunner({
    timeoutMs: 5000,
    spawnImpl: (cmd, args) => {
      spawned.push({ cmd, args });
      return child;
    },
    loadSdk: () => ({
      PROTOCOL_VERSION: '1',
      ndJsonStream: () => ({}),
      ClientSideConnection: class {
        constructor() {}
        async initialize() {}
        async newSession() {
          return { sessionId: 'session-1' };
        }
        async prompt() {
          return { stopReason: 'end_turn' };
        }
      },
    }),
  });

  await runner.runTurn({
    cwd: process.cwd(),
    prompt: 'hola',
  });

  assert.deepEqual(spawned[0], {
    cmd: 'gemini',
    args: ['--experimental-acp', '--approval-mode', 'yolo'],
  });
  delete process.env.AIPAL_GEMINI_APPROVAL_MODE;
});

test('gemini ACP runner emits progress events while processing', async () => {
  delete process.env.AIPAL_GEMINI_APPROVAL_MODE;
  const child = createChildProcess();
  const events = [];

  const runner = createGeminiAcpRunner({
    timeoutMs: 5000,
    spawnImpl: () => child,
    loadSdk: () => ({
      PROTOCOL_VERSION: '1',
      ndJsonStream: () => ({}),
      ClientSideConnection: class {
        constructor(createClient) {
          this.client = createClient();
        }
        async initialize() {}
        async newSession() {
          return { sessionId: 'session-1' };
        }
        async prompt() {
          await this.client.sessionUpdate({
            update: {
              sessionUpdate: 'tool_call',
              title: 'Run shell command',
              status: 'in_progress',
            },
          });
          await this.client.sessionUpdate({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Hola' },
            },
          });
          return { stopReason: 'end_turn' };
        }
      },
    }),
  });

  await runner.runTurn({
    cwd: process.cwd(),
    prompt: 'hola',
    onEvent: async (event) => {
      events.push(event.message);
    },
  });

  assert.deepEqual(events, [
    'Gemini: iniciando sesión...',
    'Gemini: creando sesión...',
    'Gemini: procesando solicitud...',
    'Gemini: ejecutando Run shell command.',
    'Gemini: preparando respuesta...',
  ]);
});

test('gemini ACP runner emits keepalive updates for long-running tools', async () => {
  delete process.env.AIPAL_GEMINI_APPROVAL_MODE;
  const child = createChildProcess();
  const events = [];

  const runner = createGeminiAcpRunner({
    timeoutMs: 5000,
    toolHeartbeatMs: 1100,
    spawnImpl: () => child,
    loadSdk: () => ({
      PROTOCOL_VERSION: '1',
      ndJsonStream: () => ({}),
      ClientSideConnection: class {
        constructor(createClient) {
          this.client = createClient();
        }
        async initialize() {}
        async newSession() {
          return { sessionId: 'session-1' };
        }
        async prompt() {
          await this.client.sessionUpdate({
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'tool-1',
              title: 'Shell',
              status: 'in_progress',
            },
          });
          await new Promise((resolve) => setTimeout(resolve, 1250));
          await this.client.sessionUpdate({
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: 'tool-1',
              status: 'completed',
              content: [],
            },
          });
          await this.client.sessionUpdate({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Hola' },
            },
          });
          return { stopReason: 'end_turn' };
        }
      },
    }),
  });

  await runner.runTurn({
    cwd: process.cwd(),
    prompt: 'hola',
    onEvent: async (event) => {
      events.push(event.message);
    },
  });

  assert.equal(events.includes('Gemini: ejecutando Shell.'), true);
  assert.equal(events.includes('Gemini: completó Shell.'), true);
  assert.equal(
    events.some((message) => /^Gemini: Shell sigue en curso \(\d+ s\)\.$/.test(message)),
    true
  );
});

test('gemini ACP runner ignores replayed history when resuming a session', async () => {
  delete process.env.AIPAL_GEMINI_APPROVAL_MODE;
  const child = createChildProcess();

  const runner = createGeminiAcpRunner({
    timeoutMs: 5000,
    spawnImpl: () => child,
    loadSdk: () => ({
      PROTOCOL_VERSION: '1',
      ndJsonStream: () => ({}),
      ClientSideConnection: class {
        constructor(createClient) {
          this.client = createClient();
        }
        async initialize() {}
        async loadSession() {
          await this.client.sessionUpdate({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Respuesta vieja. ' },
            },
          });
        }
        async prompt() {
          await this.client.sessionUpdate({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Respuesta nueva.' },
            },
          });
          return { stopReason: 'end_turn' };
        }
      },
    }),
  });

  const result = await runner.runTurn({
    cwd: process.cwd(),
    prompt: 'hola',
    threadId: 'session-1',
  });

  assert.deepEqual(result, {
    text: 'Respuesta nueva.',
    threadId: 'session-1',
  });
});

test('gemini ACP runner handles cumulative chunks within the same turn', async () => {
  delete process.env.AIPAL_GEMINI_APPROVAL_MODE;
  const child = createChildProcess();

  const runner = createGeminiAcpRunner({
    timeoutMs: 5000,
    spawnImpl: () => child,
    loadSdk: () => ({
      PROTOCOL_VERSION: '1',
      ndJsonStream: () => ({}),
      ClientSideConnection: class {
        constructor(createClient) {
          this.client = createClient();
        }
        async initialize() {}
        async loadSession() {}
        async prompt() {
          await this.client.sessionUpdate({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: {
                type: 'text',
                text: 'Hola',
              },
            },
          });
          await this.client.sessionUpdate({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: {
                type: 'text',
                text: 'Hola mundo',
              },
            },
          });
          return { stopReason: 'end_turn' };
        }
      },
    }),
  });

  const result = await runner.runTurn({
    cwd: process.cwd(),
    prompt: 'hola',
    threadId: 'session-1',
  });

  assert.deepEqual(result, {
    text: 'Hola mundo',
    threadId: 'session-1',
  });
});

test('gemini ACP runner does not trim valid short repeated openings', async () => {
  delete process.env.AIPAL_GEMINI_APPROVAL_MODE;
  const child = createChildProcess();
  let turn = 0;

  const runner = createGeminiAcpRunner({
    timeoutMs: 5000,
    spawnImpl: () => child,
    loadSdk: () => ({
      PROTOCOL_VERSION: '1',
      ndJsonStream: () => ({}),
      ClientSideConnection: class {
        constructor(createClient) {
          this.client = createClient();
        }
        async initialize() {}
        async loadSession() {}
        async prompt() {
          turn += 1;
          const text =
            turn === 1
              ? 'Hola'
              : 'Hola, aqui va una respuesta nueva que no debe perder el inicio.';
          await this.client.sessionUpdate({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text },
            },
          });
          return { stopReason: 'end_turn' };
        }
      },
    }),
  });

  const first = await runner.runTurn({
    cwd: process.cwd(),
    prompt: 'hola',
    threadId: 'session-2',
  });
  const second = await runner.runTurn({
    cwd: process.cwd(),
    prompt: 'hola',
    threadId: 'session-2',
  });

  assert.deepEqual(first, {
    text: 'Hola',
    threadId: 'session-2',
  });
  assert.deepEqual(second, {
    text: 'Hola, aqui va una respuesta nueva que no debe perder el inicio.',
    threadId: 'session-2',
  });
});
