const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCodexSdkClient,
  normalizeSdkError,
} = require('../src/services/codex-sdk-client');

test('runTurn starts a new sdk thread and normalizes streamed events', async () => {
  const seen = [];
  const client = createCodexSdkClient({
    loadCodexSdkModule: async () => ({
      Codex: class Codex {
        startThread(options) {
          return {
            id: null,
            runStreamed: async (input) => {
              assert.equal(options.workingDirectory, '/tmp/project');
              assert.equal(options.model, 'gpt-5-codex');
              assert.equal(options.approvalPolicy, 'never');
              assert.equal(options.sandboxMode, 'workspace-write');
              assert.equal(input[0].text, 'Hola');
              assert.equal(input[1].path, '/tmp/image.png');
              return {
                events: (async function* events() {
                  yield { type: 'thread.started', thread_id: 'thread-sdk' };
                  yield { type: 'turn.started' };
                  yield {
                    type: 'item.started',
                    item: {
                      id: 'cmd-1',
                      type: 'command_execution',
                      command: 'git status',
                      aggregated_output: '',
                      status: 'in_progress',
                    },
                  };
                  yield {
                    type: 'item.completed',
                    item: {
                      id: 'msg-1',
                      type: 'agent_message',
                      text: 'respuesta final',
                    },
                  };
                  yield {
                    type: 'turn.completed',
                    usage: {
                      input_tokens: 10,
                      cached_input_tokens: 0,
                      output_tokens: 20,
                    },
                  };
                })(),
              };
            },
          };
        }
      },
    }),
  });

  const result = await client.runTurn({
    cwd: '/tmp/project',
    imagePaths: ['/tmp/image.png'],
    model: 'gpt-5-codex',
    onEvent: async (event) => {
      seen.push(event.message || event.text || event.type);
    },
    prompt: 'Hola',
    thinking: 'medium',
  });

  assert.equal(result.text, 'respuesta final');
  assert.equal(result.threadId, 'thread-sdk');
  assert.equal(result.conversationId, 'thread-sdk');
  assert.deepEqual(seen, [
    'Codex: sesion iniciada.',
    'Codex: iniciando sesion...',
    'Codex: enviando turno...',
    'Codex: ejecutando comando: git status',
    'respuesta final',
    'Codex: finalizando respuesta...',
  ]);
});

test('runTurn resumes an existing sdk thread', async () => {
  let resumedId = '';
  const client = createCodexSdkClient({
    loadCodexSdkModule: async () => ({
      Codex: class Codex {
        resumeThread(id) {
          resumedId = id;
          return {
            id,
            runStreamed: async () => ({
              events: (async function* events() {
                yield {
                  type: 'item.completed',
                  item: {
                    id: 'msg-1',
                    type: 'agent_message',
                    text: 'continuado',
                  },
                };
                yield {
                  type: 'turn.completed',
                  usage: {
                    input_tokens: 1,
                    cached_input_tokens: 0,
                    output_tokens: 1,
                  },
                };
              })(),
            }),
          };
        }
      },
    }),
  });

  const result = await client.runTurn({
    prompt: 'Sigue',
    threadId: 'thread-existing',
  });

  assert.equal(resumedId, 'thread-existing');
  assert.equal(result.text, 'continuado');
  assert.equal(result.threadId, 'thread-existing');
});

test('runTurn ignores stale pre-turn assistant output when resuming a thread', async () => {
  const client = createCodexSdkClient({
    loadCodexSdkModule: async () => ({
      Codex: class Codex {
        resumeThread(id) {
          return {
            id,
            runStreamed: async () => ({
              events: (async function* events() {
                yield {
                  type: 'item.completed',
                  item: {
                    id: 'msg-seed',
                    type: 'agent_message',
                    text: '.',
                  },
                };
                yield { type: 'turn.started' };
                yield {
                  type: 'item.completed',
                  item: {
                    id: 'msg-current',
                    type: 'agent_message',
                    text: 'respuesta actual',
                  },
                };
                yield {
                  type: 'turn.completed',
                  usage: {
                    input_tokens: 1,
                    cached_input_tokens: 0,
                    output_tokens: 2,
                  },
                };
              })(),
            }),
          };
        }
      },
    }),
  });

  const result = await client.runTurn({
    prompt: 'Sigue',
    threadId: 'thread-existing',
  });

  assert.equal(result.text, 'respuesta actual');
  assert.equal(result.threadId, 'thread-existing');
});

test('normalizeSdkError classifies common failure modes', () => {
  assert.equal(
    normalizeSdkError({ message: 'spawn codex ENOENT' }).errorKind,
    'cli_missing'
  );
  assert.equal(
    normalizeSdkError({ message: 'thread not found' }).errorKind,
    'session_not_found'
  );
  assert.equal(
    normalizeSdkError({ message: 'approval required to continue' }).errorKind,
    'approval_required'
  );
  assert.equal(
    normalizeSdkError({ message: 'operation not permitted by sandbox' }).errorKind,
    'sandbox_denied'
  );
  assert.equal(
    normalizeSdkError({ message: 'Command timed out after 1000ms', code: 'ETIMEDOUT' }).errorKind,
    'timeout'
  );
});
