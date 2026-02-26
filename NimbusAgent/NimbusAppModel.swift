import AppKit
import Combine
import Foundation

@MainActor
final class NimbusAppModel: ObservableObject {
    @Published var settings: NimbusSettings
    @Published var telegramToken: String
    @Published var runState: AgentRunState = .idle
    @Published var preflight: PreflightReport = .empty
    @Published var logs: [String] = []
    @Published var settingsStatusMessage: String = ""

    private let settingsStore = SettingsStore()
    private let secretsStore = SecretsStore()
    private let preflightService = PreflightService()
    private let processManager = AgentProcessManager()
    private let maxLogLines = 500

    init() {
        self.settings = settingsStore.load()
        self.telegramToken = secretsStore.readTelegramToken()

        processManager.onOutput = { [weak self] chunk in
            Task { @MainActor in
                self?.appendLog(chunk)
            }
        }

        processManager.onTermination = { [weak self] code in
            Task { @MainActor in
                guard let self else { return }
                if case .stopping = self.runState {
                    self.runState = .idle
                    self.appendLog("Proceso detenido correctamente.")
                } else if code == 0 {
                    self.runState = .idle
                    self.appendLog("Proceso finalizado (exit 0).")
                } else {
                    self.runState = .failed(message: "Aipal terminó con código \(code).")
                    self.appendLog("Aipal terminó con código \(code).")
                }
            }
        }
    }

    func saveConfiguration() {
        let errors = settings.validationErrors()
        if !errors.isEmpty {
            settingsStatusMessage = errors.joined(separator: "\n")
            return
        }

        do {
            try settingsStore.save(settings)
            try secretsStore.saveTelegramToken(telegramToken)
            settingsStatusMessage = "Configuración guardada."
        } catch {
            settingsStatusMessage = "No se pudo guardar la configuración: \(error.localizedDescription)"
        }
    }

    func pickAgentDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Seleccionar"

        let response = panel.runModal()
        guard response == .OK, let url = panel.url else { return }
        settings.agentCwd = url.path
    }

    func startAgent() {
        if processManager.isRunning() {
            return
        }

        let report = preflightService.run(
            settings: settings,
            token: telegramToken,
            nodeURL: bundledNodeURL(),
            entryURL: bundledAipalEntryURL()
        )

        self.preflight = report

        guard report.isOK else {
            runState = .failed(message: report.errors.joined(separator: " | "))
            appendLog("Preflight falló: \(report.errors.joined(separator: " | "))")
            return
        }

        guard let nodeURL = bundledNodeURL(), let entryURL = bundledAipalEntryURL() else {
            runState = .failed(message: "No se encontraron recursos embebidos.")
            return
        }

        let env = EnvAssembler.build(settings: settings, token: telegramToken)
        let cwdURL = resolveWorkingDirectory()

        runState = .starting

        do {
            let pid = try processManager.start(
                executableURL: nodeURL,
                arguments: [entryURL.path],
                environment: env,
                currentDirectoryURL: cwdURL
            )
            runState = .running(pid: pid)
            appendLog("Aipal arrancado (pid \(pid)).")
        } catch {
            runState = .failed(message: error.localizedDescription)
            appendLog("No se pudo arrancar Aipal: \(error.localizedDescription)")
        }
    }

    func stopAgent() {
        guard processManager.isRunning() else {
            runState = .idle
            return
        }

        runState = .stopping
        processManager.stop()
    }

    func refreshPreflight() {
        preflight = preflightService.run(
            settings: settings,
            token: telegramToken,
            nodeURL: bundledNodeURL(),
            entryURL: bundledAipalEntryURL()
        )
    }

    var canStart: Bool {
        !processManager.isRunning() && telegramToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    private func resolveWorkingDirectory() -> URL {
        let trimmed = settings.agentCwd.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            return URL(fileURLWithPath: trimmed, isDirectory: true)
        }

        let defaultPath = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .appendingPathComponent(".config", isDirectory: true)
            .appendingPathComponent("aipal", isDirectory: true)

        try? FileManager.default.createDirectory(at: defaultPath, withIntermediateDirectories: true, attributes: nil)
        return defaultPath
    }

    private func bundledNodeURL() -> URL? {
        Bundle.main.resourceURL?.appendingPathComponent("runtime/node", isDirectory: false)
    }

    private func bundledAipalEntryURL() -> URL? {
        Bundle.main.resourceURL?.appendingPathComponent("aipal/src/index.js", isDirectory: false)
    }

    private func appendLog(_ chunk: String) {
        let lines = chunk
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .map { line in "[\(Self.timestamp())] \(line)" }

        guard !lines.isEmpty else { return }

        logs.append(contentsOf: lines)
        if logs.count > maxLogLines {
            logs.removeFirst(logs.count - maxLogLines)
        }
    }

    private static func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: Date())
    }
}
