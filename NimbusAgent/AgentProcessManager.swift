import Foundation
import Darwin

enum AgentRunState: Equatable {
    case idle
    case starting
    case running(pid: Int32)
    case stopping
    case failed(message: String)

    var label: String {
        switch self {
        case .idle:
            return "Detenido"
        case .starting:
            return "Iniciando"
        case .running(let pid):
            return "Activo (pid \(pid))"
        case .stopping:
            return "Deteniendo"
        case .failed(let message):
            return "Error: \(message)"
        }
    }

    var iconName: String {
        switch self {
        case .idle:
            return "bolt.slash"
        case .starting, .stopping:
            return "hourglass"
        case .running:
            return "bolt.circle.fill"
        case .failed:
            return "exclamationmark.triangle.fill"
        }
    }
}

final class AgentProcessManager {
    private var process: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?

    var onOutput: ((String) -> Void)?
    var onTermination: ((Int32) -> Void)?

    func isRunning() -> Bool {
        guard let process else { return false }
        return process.isRunning
    }

    func start(
        executableURL: URL,
        arguments: [String],
        environment: [String: String],
        currentDirectoryURL: URL
    ) throws -> Int32 {
        if isRunning() {
            throw NSError(domain: "NimbusProcess", code: 1, userInfo: [NSLocalizedDescriptionKey: "El agente ya está en ejecución."])
        }

        let process = Process()
        process.executableURL = executableURL
        process.arguments = arguments
        process.environment = environment
        process.currentDirectoryURL = currentDirectoryURL

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            let text = String(decoding: data, as: UTF8.self)
            self?.onOutput?(text)
        }

        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            let text = String(decoding: data, as: UTF8.self)
            self?.onOutput?("[stderr] \(text)")
        }

        process.terminationHandler = { [weak self] task in
            stdoutPipe.fileHandleForReading.readabilityHandler = nil
            stderrPipe.fileHandleForReading.readabilityHandler = nil
            self?.process = nil
            self?.stdoutPipe = nil
            self?.stderrPipe = nil
            self?.onTermination?(task.terminationStatus)
        }

        try process.run()

        self.process = process
        self.stdoutPipe = stdoutPipe
        self.stderrPipe = stderrPipe

        return process.processIdentifier
    }

    func stop(gracePeriod: TimeInterval = 4.0) {
        guard let process else { return }

        if process.isRunning {
            process.terminate()

            DispatchQueue.global().asyncAfter(deadline: .now() + gracePeriod) { [weak self] in
                guard let self, let process = self.process, process.isRunning else { return }
                kill(process.processIdentifier, SIGKILL)
            }
        }
    }
}
