import AppKit
import Combine
import Foundation
import SwiftUI

struct BotStatus {
    var runState: AgentRunState = .idle
    var preflight: PreflightReport = .empty
    var logs: [String] = []
}

@MainActor
final class NimbusAppModel: ObservableObject {
    @Published var settings: NimbusSettings
    @Published var codexToken: String
    @Published var geminiToken: String
    @Published var settingsStatusMessage: String = ""
    @Published private var botStatuses: [NimbusBot: BotStatus]

    private let settingsStore = SettingsStore()
    private let secretsStore = SecretsStore()
    private let preflightService = PreflightService()
    private let processManagers: [NimbusBot: AgentProcessManager]
    private let maxLogLines = 500

    init() {
        self.settings = settingsStore.load()
        self.botStatuses = Dictionary(uniqueKeysWithValues: NimbusBot.allCases.map { ($0, BotStatus()) })
        self.processManagers = Dictionary(uniqueKeysWithValues: NimbusBot.allCases.map { ($0, AgentProcessManager()) })

        do {
            try secretsStore.migrateLegacyCodexTokenIfNeeded()
        } catch {
            settingsStatusMessage = "No se pudo migrar el token heredado de Codex: \(error.localizedDescription)"
        }

        self.codexToken = secretsStore.readTelegramToken(for: .codex)
        self.geminiToken = secretsStore.readTelegramToken(for: .gemini)

        for bot in NimbusBot.allCases {
            processManagers[bot]?.onOutput = { [weak self] chunk in
                Task { @MainActor in
                    self?.appendLog(chunk, for: bot)
                }
            }

            processManagers[bot]?.onTermination = { [weak self] code in
                Task { @MainActor in
                    self?.handleTermination(code: code, for: bot)
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
            try secretsStore.saveTelegramToken(codexToken, for: .codex)
            try secretsStore.saveTelegramToken(geminiToken, for: .gemini)
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

    func startBot(_ bot: NimbusBot) {
        guard let processManager = processManagers[bot], !processManager.isRunning() else {
            return
        }

        let token = token(for: bot)
        let report = preflightService.run(
            bot: bot,
            settings: settings,
            token: token,
            nodeURL: bundledNodeURL(),
            entryURL: bundledAipalEntryURL()
        )
        updateBotStatus(bot) { status in
            status.preflight = report
        }

        guard report.isOK else {
            updateBotStatus(bot) { status in
                status.runState = .failed(message: report.errors.joined(separator: " | "))
            }
            appendLog("Preflight falló: \(report.errors.joined(separator: " | "))", for: bot)
            return
        }

        guard let nodeURL = bundledNodeURL(), let entryURL = bundledAipalEntryURL() else {
            updateBotStatus(bot) { status in
                status.runState = .failed(message: "No se encontraron recursos embebidos.")
            }
            return
        }

        let env = EnvAssembler.build(settings: settings, token: token, bot: bot)
        let cwdURL = resolveWorkingDirectory(for: bot)

        updateBotStatus(bot) { status in
            status.runState = .starting
        }

        do {
            let pid = try processManager.start(
                executableURL: nodeURL,
                arguments: [entryURL.path],
                environment: env,
                currentDirectoryURL: cwdURL
            )
            updateBotStatus(bot) { status in
                status.runState = .running(pid: pid)
            }
            appendLog("Aipal \(bot.label) arrancado (pid \(pid)).", for: bot)
        } catch {
            updateBotStatus(bot) { status in
                status.runState = .failed(message: error.localizedDescription)
            }
            appendLog("No se pudo arrancar Aipal \(bot.label): \(error.localizedDescription)", for: bot)
        }
    }

    func stopBot(_ bot: NimbusBot) {
        guard let processManager = processManagers[bot], processManager.isRunning() else {
            updateBotStatus(bot) { status in
                status.runState = .idle
            }
            return
        }

        updateBotStatus(bot) { status in
            status.runState = .stopping
        }
        processManager.stop()
    }

    func startAllBots() {
        for bot in NimbusBot.allCases {
            startBot(bot)
        }
    }

    func stopAllBots() {
        for bot in NimbusBot.allCases {
            stopBot(bot)
        }
    }

    func refreshPreflight(for bot: NimbusBot) {
        let report = preflightService.run(
            bot: bot,
            settings: settings,
            token: token(for: bot),
            nodeURL: bundledNodeURL(),
            entryURL: bundledAipalEntryURL()
        )
        updateBotStatus(bot) { status in
            status.preflight = report
        }
    }

    func refreshAllPreflight() {
        for bot in NimbusBot.allCases {
            refreshPreflight(for: bot)
        }
    }

    func token(for bot: NimbusBot) -> String {
        switch bot {
        case .codex:
            return codexToken
        case .gemini:
            return geminiToken
        }
    }

    func runState(for bot: NimbusBot) -> AgentRunState {
        botStatuses[bot]?.runState ?? .idle
    }

    func preflight(for bot: NimbusBot) -> PreflightReport {
        botStatuses[bot]?.preflight ?? .empty
    }

    func logs(for bot: NimbusBot) -> [String] {
        botStatuses[bot]?.logs ?? []
    }

    func canStart(_ bot: NimbusBot) -> Bool {
        guard let processManager = processManagers[bot] else { return false }
        return !processManager.isRunning() && !token(for: bot).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func canStop(_ bot: NimbusBot) -> Bool {
        switch runState(for: bot) {
        case .running, .starting:
            return true
        case .idle, .stopping, .failed:
            return false
        }
    }

    func hasToken(_ bot: NimbusBot) -> Bool {
        !token(for: bot).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func latestLogLine(for bot: NimbusBot) -> String {
        logs(for: bot).last ?? "Sin actividad reciente."
    }

    func statusColor(for bot: NimbusBot) -> Color {
        switch runState(for: bot) {
        case .idle:
            return .secondary
        case .starting, .stopping:
            return .orange
        case .running:
            return .green
        case .failed:
            return .red
        }
    }

    func statusIconName(for bot: NimbusBot) -> String {
        switch runState(for: bot) {
        case .idle:
            return "pause.circle"
        case .starting:
            return "arrow.triangle.2.circlepath.circle"
        case .running:
            return "checkmark.circle.fill"
        case .stopping:
            return "stop.circle"
        case .failed:
            return "xmark.octagon.fill"
        }
    }

    func preflightSummary(for bot: NimbusBot) -> String {
        let report = preflight(for: bot)
        if !report.errors.isEmpty {
            return "\(report.errors.count) error(es)"
        }
        if !report.warnings.isEmpty {
            return "\(report.warnings.count) warning(s)"
        }
        return "Preflight OK"
    }

    var canStartAnyBot: Bool {
        NimbusBot.allCases.contains(where: canStart(_:))
    }

    var canStopAnyBot: Bool {
        NimbusBot.allCases.contains(where: canStop(_:))
    }

    var overallRunStateLabel: String {
        NimbusBot.allCases
            .map { "\($0.label): \(runState(for: $0).label)" }
            .joined(separator: " · ")
    }

    var overallIconName: String {
        if NimbusBot.allCases.contains(where: {
            if case .failed = runState(for: $0) { return true }
            return false
        }) {
            return "exclamationmark.triangle.fill"
        }
        if NimbusBot.allCases.contains(where: { canStop($0) || runState(for: $0) == .stopping }) {
            return "bolt.circle.fill"
        }
        return "bolt.slash"
    }

    func diagnosticsText(for bot: NimbusBot) -> String {
        let report = preflight(for: bot)
        return (["Bot: \(bot.label)", "Estado: \(runState(for: bot).label)"] + report.errors + report.warnings + report.details + logs(for: bot))
            .joined(separator: "\n")
    }

    private func updateBotStatus(_ bot: NimbusBot, mutate: (inout BotStatus) -> Void) {
        var next = botStatuses
        var status = next[bot] ?? BotStatus()
        mutate(&status)
        next[bot] = status
        botStatuses = next
    }

    private func handleTermination(code: Int32, for bot: NimbusBot) {
        switch runState(for: bot) {
        case .stopping:
            updateBotStatus(bot) { status in
                status.runState = .idle
            }
            appendLog("Proceso \(bot.label) detenido correctamente.", for: bot)
        default:
            if code == 0 {
                updateBotStatus(bot) { status in
                    status.runState = .idle
                }
                appendLog("Proceso \(bot.label) finalizado (exit 0).", for: bot)
            } else {
                updateBotStatus(bot) { status in
                    status.runState = .failed(message: "Aipal terminó con código \(code).")
                }
                appendLog("Aipal \(bot.label) terminó con código \(code).", for: bot)
            }
        }
    }

    private func resolveWorkingDirectory(for bot: NimbusBot) -> URL {
        let runtimeURL = settingsStore
            .settingsURL()
            .deletingLastPathComponent()
            .appendingPathComponent("Runtime", isDirectory: true)
            .appendingPathComponent(bot.rawValue, isDirectory: true)

        try? FileManager.default.createDirectory(at: runtimeURL, withIntermediateDirectories: true, attributes: nil)
        return runtimeURL
    }

    private func bundledNodeURL() -> URL? {
        Bundle.main.resourceURL?.appendingPathComponent("runtime/node", isDirectory: false)
    }

    private func bundledAipalEntryURL() -> URL? {
        Bundle.main.resourceURL?.appendingPathComponent("aipal/src/index.js", isDirectory: false)
    }

    private func appendLog(_ chunk: String, for bot: NimbusBot) {
        let lines = chunk
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .map { line in "[\(Self.timestamp())] \(line)" }

        guard !lines.isEmpty else { return }

        updateBotStatus(bot) { status in
            status.logs.append(contentsOf: lines)
            if status.logs.count > maxLogLines {
                status.logs.removeFirst(status.logs.count - maxLogLines)
            }
        }
    }

    private static func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: Date())
    }
}
