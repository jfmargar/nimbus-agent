const test = require('node:test');
const assert = require('node:assert/strict');

const { execLocalWithPty } = require('../src/services/process');

test('execLocalWithPty resolves stdout for a successful PTY command', async () => {
  const output = await execLocalWithPty('printf "hola desde pty\\n"', {
    timeout: 1000,
    maxBuffer: 1024 * 1024,
  });

  assert.match(output, /hola desde pty/);
});

test('execLocalWithPty aborts via signal and preserves partial stdout', async () => {
  const controller = new AbortController();
  const promise = execLocalWithPty('printf "parcial\\n"; sleep 60', {
    signal: controller.signal,
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });

  setTimeout(() => controller.abort(new Error('cancelled by test')), 100);

  await assert.rejects(
    promise,
    (err) => {
      assert.equal(err.name, 'AbortError');
      assert.equal(err.code, 'ABORT_ERR');
      assert.match(String(err.stdout || ''), /parcial/);
      return true;
    }
  );
});

test('execLocalWithPty times out and preserves partial stdout', async () => {
  const promise = execLocalWithPty('printf "antes del timeout\\n"; sleep 60', {
    timeout: 100,
    maxBuffer: 1024 * 1024,
  });

  await assert.rejects(
    promise,
    (err) => {
      assert.equal(err.code, 'ETIMEDOUT');
      assert.match(String(err.stdout || ''), /antes del timeout/);
      return true;
    }
  );
});

test('execLocalWithPty stops when stdout exceeds maxBuffer', async () => {
  const promise = execLocalWithPty(
    'python3 -c "import sys; sys.stdout.write(\'x\' * 4096); sys.stdout.flush(); import time; time.sleep(1)"',
    {
      timeout: 5000,
      maxBuffer: 256,
    }
  );

  await assert.rejects(
    promise,
    (err) => {
      assert.equal(err.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
      assert.ok(String(err.stdout || '').length > 256);
      return true;
    }
  );
});
