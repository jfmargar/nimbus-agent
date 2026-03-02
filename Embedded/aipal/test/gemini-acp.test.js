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
