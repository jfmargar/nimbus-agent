const { execFile, spawn } = require('child_process');

const PTY_PYTHON_SNIPPET = `
import errno
import os
import pty
import select
import signal
import sys

COMMAND = sys.argv[1]
TERM_RESPONSES = [
    (b"\\x1b[6n", b"\\x1b[1;1R"),
    (b"\\x1b[c", b"\\x1b[?1;2c"),
    (b"\\x1b]10;?", b"\\x1b]10;rgb:ffff/ffff/ffff\\x1b\\\\"),
    (b"\\x1b]11;?", b"\\x1b]11;rgb:0000/0000/0000\\x1b\\\\"),
]
RESPONDED = set()
CHILD_PID = None


def forward_and_exit(sig, _frame):
    global CHILD_PID
    if CHILD_PID:
        try:
            os.kill(CHILD_PID, sig)
        except ProcessLookupError:
            pass
    signal.signal(sig, signal.SIG_DFL)
    os.kill(os.getpid(), sig)


for forwarded_signal in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    signal.signal(forwarded_signal, forward_and_exit)


pid, master_fd = pty.fork()
if pid == 0:
    os.execvp("bash", ["bash", "-lc", COMMAND])

CHILD_PID = pid
recent_output = bytearray()

while True:
    try:
        readable, _, _ = select.select([master_fd], [], [], 0.1)
    except InterruptedError:
        continue

    if master_fd in readable:
        try:
            chunk = os.read(master_fd, 4096)
        except OSError as exc:
            if exc.errno == errno.EIO:
                chunk = b""
            else:
                raise
        if not chunk:
            break
        os.write(sys.stdout.fileno(), chunk)
        recent_output.extend(chunk)
        if len(recent_output) > 8192:
            del recent_output[:-8192]
        snapshot = bytes(recent_output)
        for pattern, response in TERM_RESPONSES:
            if pattern in snapshot and pattern not in RESPONDED:
                try:
                    os.write(master_fd, response)
                except OSError:
                    pass
                RESPONDED.add(pattern)

    try:
        done_pid, status = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        done_pid, status = pid, 0

    if done_pid == pid:
        if os.WIFEXITED(status):
            sys.exit(os.WEXITSTATUS(status))
        if os.WIFSIGNALED(status):
            sig = os.WTERMSIG(status)
            signal.signal(sig, signal.SIG_DFL)
            os.kill(os.getpid(), sig)
        sys.exit(1)
`;
const PTY_INTERRUPT_GRACE_MS = 400;
const PTY_KILL_GRACE_MS = 1000;

function shellQuote(value) {
  const escaped = String(value).replace(/'/g, String.raw`'\''`);
  return `'${escaped}'`;
}

function wrapCommandWithPty(command) {
  return `python3 -c ${shellQuote(PTY_PYTHON_SNIPPET)} ${shellQuote(command)}`;
}

function createProcessError(message, extra = {}) {
  const err = new Error(message);
  Object.assign(err, extra);
  return err;
}

function killProcessGroup(child, signal) {
  if (!child?.pid) return false;
  try {
    process.kill(-child.pid, signal);
    console.info(`pty_kill_sent pid=${child.pid} signal=${signal}`);
    return true;
  } catch (err) {
    if (err?.code !== 'ESRCH') {
      console.warn(`pty_kill_failed pid=${child.pid} signal=${signal}`, err);
    }
    return false;
  }
}

function resolveAbortSignalSequence(reason) {
  const normalizedReason = String(reason || '').trim().toLowerCase();
  if (
    normalizedReason.includes('grace_elapsed') ||
    normalizedReason.includes('turn_complete_detected')
  ) {
    return [
      { signal: 'SIGINT', delayMs: PTY_INTERRUPT_GRACE_MS },
      { signal: 'SIGTERM', delayMs: PTY_KILL_GRACE_MS },
      { signal: 'SIGKILL', delayMs: 0 },
    ];
  }
  return [
    { signal: 'SIGTERM', delayMs: PTY_KILL_GRACE_MS },
    { signal: 'SIGKILL', delayMs: 0 },
  ];
}

function execLocalWithPty(command, options = {}) {
  const {
    timeout,
    maxBuffer,
    signal,
    env: extraEnv,
    cwd,
  } = options;
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    ...(extraEnv || {}),
  };

  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-c', PTY_PYTHON_SNIPPET, command], {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.info(`pty_spawned pid=${child.pid} detached=true`);

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let forceKillTimers = [];
    let timeoutTimer = null;
    let abortListener = null;
    let exitCode = null;
    let exitSignal = null;
    let stopError = null;

    function cleanup() {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (forceKillTimers.length) {
        for (const timer of forceKillTimers) {
          clearTimeout(timer);
        }
        forceKillTimers = [];
      }
      if (abortListener && signal) {
        signal.removeEventListener('abort', abortListener);
        abortListener = null;
      }
    }

    function finish(err, output = stdout) {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) {
        if (typeof err.stdout !== 'string') err.stdout = stdout;
        if (typeof err.stderr !== 'string') err.stderr = stderr;
        reject(err);
        return;
      }
      resolve(output || '');
    }

    function requestGroupStop(reason, errorFactory) {
      if (settled || stopError) return;
      if (reason === 'timeout') {
        console.info(`pty_timeout pid=${child.pid} timeoutMs=${timeout}`);
      } else if (reason === 'abort') {
        console.info(`pty_abort_requested pid=${child.pid} reason=${String(signal?.reason?.message || signal?.reason || 'signal')}`);
      } else if (reason === 'max_buffer') {
        console.info(`pty_abort_requested pid=${child.pid} reason=max_buffer`);
      }
      stopError = errorFactory();
      const signalSequence =
        reason === 'abort'
          ? resolveAbortSignalSequence(signal?.reason?.message || signal?.reason)
          : [
              { signal: 'SIGTERM', delayMs: PTY_KILL_GRACE_MS },
              { signal: 'SIGKILL', delayMs: 0 },
            ];

      let accumulatedDelayMs = 0;
      for (let index = 0; index < signalSequence.length; index += 1) {
        const entry = signalSequence[index];
        if (index === 0) {
          killProcessGroup(child, entry.signal);
          accumulatedDelayMs += entry.delayMs;
          continue;
        }
        const timer = setTimeout(() => {
          killProcessGroup(child, entry.signal);
        }, accumulatedDelayMs);
        forceKillTimers.push(timer);
        accumulatedDelayMs += entry.delayMs;
      }
    }

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (settled) return;
        const value = String(chunk);
        stdout += value;
        stdoutBytes += Buffer.byteLength(value, 'utf8');
        if (Number.isFinite(maxBuffer) && maxBuffer > 0 && stdoutBytes > maxBuffer) {
          requestGroupStop('max_buffer', () =>
            createProcessError(
              `stdout maxBuffer length exceeded: ${maxBuffer}`,
              { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }
            )
          );
        }
      });
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        if (settled) return;
        const value = String(chunk);
        stderr += value;
        stderrBytes += Buffer.byteLength(value, 'utf8');
        if (Number.isFinite(maxBuffer) && maxBuffer > 0 && stderrBytes > maxBuffer) {
          requestGroupStop('max_buffer', () =>
            createProcessError(
              `stderr maxBuffer length exceeded: ${maxBuffer}`,
              { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }
            )
          );
        }
      });
    }

    child.on('error', (err) => {
      finish(err);
    });

    child.on('exit', (code, receivedSignal) => {
      exitCode = code;
      exitSignal = receivedSignal;
      console.info(`pty_exit pid=${child.pid} code=${code ?? 'null'} signal=${receivedSignal || 'null'}`);
    });

    child.on('close', (code, receivedSignal) => {
      if (settled) return;
      cleanup();
      if (stopError) {
        finish(stopError);
        return;
      }
      if (code === 0) {
        settled = true;
        resolve(stdout || '');
        return;
      }
      const normalizedCode = exitCode ?? code;
      const normalizedSignal = exitSignal ?? receivedSignal;
      finish(
        createProcessError(
          normalizedSignal
            ? `Command terminated by signal ${normalizedSignal}`
            : `Command exited with code ${normalizedCode}`,
          {
            code: normalizedCode,
            signal: normalizedSignal,
          }
        )
      );
    });

    if (Number.isFinite(timeout) && timeout > 0) {
      timeoutTimer = setTimeout(() => {
        requestGroupStop('timeout', () =>
          createProcessError(`Command timed out after ${timeout}ms`, {
            code: 'ETIMEDOUT',
          })
        );
      }, timeout);
    }

    if (signal) {
      if (signal.aborted) {
        requestGroupStop('abort', () =>
          createProcessError('Command aborted', {
            code: 'ABORT_ERR',
            name: 'AbortError',
            cause: signal.reason,
          })
        );
        return;
      }
      abortListener = () => {
        requestGroupStop('abort', () =>
          createProcessError('Command aborted', {
            code: 'ABORT_ERR',
            name: 'AbortError',
            cause: signal.reason,
          })
        );
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }
  });
}

function execLocal(cmd, args, options = {}) {
  const { timeout, maxBuffer, ...rest } = options;
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { encoding: 'utf8', timeout, maxBuffer, ...rest },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          err.stdout = stdout;
          if (timeout && err.killed) {
            const timeoutErr = new Error(`Command timed out after ${timeout}ms`);
            timeoutErr.code = 'ETIMEDOUT';
            timeoutErr.stderr = stderr;
            timeoutErr.stdout = stdout;
            return reject(timeoutErr);
          }
          return reject(err);
        }
        resolve(stdout || '');
      }
    );
  });
}

module.exports = {
  execLocal,
  execLocalWithPty,
  shellQuote,
  wrapCommandWithPty,
};
