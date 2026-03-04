import Foundation

struct CommandExecutionResult {
    let terminationStatus: Int32
    let stdout: String
    let stderr: String
}

enum CommandExecutionError: LocalizedError {
    case failedToLaunch(String)

    var errorDescription: String? {
        switch self {
        case .failedToLaunch(let message):
            return message
        }
    }
}

enum CommandExecutor {
    static func runProcess(
        executablePath: String,
        arguments: [String],
        environment: [String: String],
        currentDirectoryURL: URL? = nil,
        outputHandler: ((String) -> Void)? = nil
    ) throws -> CommandExecutionResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = arguments
        process.environment = environment
        process.currentDirectoryURL = currentDirectoryURL

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        let lock = NSLock()
        var stdout = ""
        var stderr = ""

        func append(_ text: String, toStdErr: Bool) {
            guard !text.isEmpty else { return }
            lock.lock()
            if toStdErr {
                stderr += text
            } else {
                stdout += text
            }
            lock.unlock()
            outputHandler?(text)
        }

        stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            append(String(decoding: data, as: UTF8.self), toStdErr: false)
        }

        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            append(String(decoding: data, as: UTF8.self), toStdErr: true)
        }

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            stdoutPipe.fileHandleForReading.readabilityHandler = nil
            stderrPipe.fileHandleForReading.readabilityHandler = nil
            throw CommandExecutionError.failedToLaunch(error.localizedDescription)
        }

        stdoutPipe.fileHandleForReading.readabilityHandler = nil
        stderrPipe.fileHandleForReading.readabilityHandler = nil

        let trailingStdout = String(
            decoding: stdoutPipe.fileHandleForReading.readDataToEndOfFile(),
            as: UTF8.self
        )
        let trailingStderr = String(
            decoding: stderrPipe.fileHandleForReading.readDataToEndOfFile(),
            as: UTF8.self
        )
        append(trailingStdout, toStdErr: false)
        append(trailingStderr, toStdErr: true)

        lock.lock()
        let result = CommandExecutionResult(
            terminationStatus: process.terminationStatus,
            stdout: stdout,
            stderr: stderr
        )
        lock.unlock()

        return result
    }

    static func runShellCommand(
        _ command: String,
        environment: [String: String],
        currentDirectoryURL: URL? = nil,
        outputHandler: ((String) -> Void)? = nil
    ) throws -> CommandExecutionResult {
        try runProcess(
            executablePath: "/bin/zsh",
            arguments: ["-lc", command],
            environment: environment,
            currentDirectoryURL: currentDirectoryURL,
            outputHandler: outputHandler
        )
    }

    static func runShellCommandWithPTY(
        _ command: String,
        environment: [String: String],
        currentDirectoryURL: URL? = nil,
        outputHandler: ((String) -> Void)? = nil
    ) throws -> CommandExecutionResult {
        let snippet = """
import errno
import os
import pty
import select
import signal
import sys

COMMAND = sys.argv[1]
TERM_RESPONSES = [
    (b"\\x1b[6n", b"\\x1b[1;1R"),
    (b"\\x1b[?1;2c", b"\\x1b[?1;0c"),
    (b"\\x1b[c", b"\\x1b[?1;0c")
]

def forward_and_exit(sig, frame):
    try:
        if 'CHILD_PID' in globals():
            os.kill(CHILD_PID, sig)
    except OSError:
        pass
    sys.exit(128 + sig)

for forwarded_signal in [signal.SIGINT, signal.SIGTERM, signal.SIGHUP]:
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
                break
            raise
        if not chunk:
            break
        
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()
        
        recent_output.extend(chunk)
        if len(recent_output) > 256:
            recent_output = recent_output[-256:]
            
        for seq, resp in TERM_RESPONSES:
            if seq in recent_output:
                try:
                    os.write(master_fd, resp)
                except OSError:
                    pass
                recent_output = bytearray()

    pid_status, status = os.waitpid(pid, os.WNOHANG)
    if pid_status == pid:
        if os.WIFEXITED(status):
            sys.exit(os.WEXITSTATUS(status))
        if os.WIFSIGNALED(status):
            sig = os.WTERMSIG(status)
            signal.signal(sig, signal.SIG_DFL)
            os.kill(os.getpid(), sig)
        sys.exit(1)
"""
        let pythonCommand = "/usr/bin/python3"
        return try runProcess(
            executablePath: pythonCommand,
            arguments: ["-c", snippet, command],
            environment: environment,
            currentDirectoryURL: currentDirectoryURL,
            outputHandler: outputHandler
        )
    }
}
