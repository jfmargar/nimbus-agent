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
}
