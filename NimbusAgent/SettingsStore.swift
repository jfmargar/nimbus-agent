import Foundation

struct NimbusSettings: Codable, Equatable {
    var allowedUsers: String
    var agentCwd: String
    var dropPendingUpdates: Bool
    var whisperCmd: String
    var scriptTimeoutMs: Int
    var agentTimeoutMs: Int
    var agentMaxBuffer: Int
    var memoryCurateEvery: Int
    var memoryRetrievalLimit: Int
    var shutdownDrainTimeoutMs: Int

    static let `default` = NimbusSettings(
        allowedUsers: "",
        agentCwd: "",
        dropPendingUpdates: true,
        whisperCmd: "parakeet-mlx",
        scriptTimeoutMs: 120000,
        agentTimeoutMs: 600000,
        agentMaxBuffer: 10 * 1024 * 1024,
        memoryCurateEvery: 20,
        memoryRetrievalLimit: 8,
        shutdownDrainTimeoutMs: 120000
    )

    func validationErrors() -> [String] {
        var errors: [String] = []

        if scriptTimeoutMs <= 0 { errors.append("AIPAL_SCRIPT_TIMEOUT_MS debe ser > 0.") }
        if agentTimeoutMs <= 0 { errors.append("AIPAL_AGENT_TIMEOUT_MS debe ser > 0.") }
        if agentMaxBuffer <= 0 { errors.append("AIPAL_AGENT_MAX_BUFFER debe ser > 0.") }
        if memoryCurateEvery <= 0 { errors.append("AIPAL_MEMORY_CURATE_EVERY debe ser > 0.") }
        if memoryRetrievalLimit <= 0 { errors.append("AIPAL_MEMORY_RETRIEVAL_LIMIT debe ser > 0.") }
        if shutdownDrainTimeoutMs <= 0 { errors.append("AIPAL_SHUTDOWN_DRAIN_TIMEOUT_MS debe ser > 0.") }

        let trimmedCwd = agentCwd.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedCwd.isEmpty {
            var isDirectory: ObjCBool = false
            let exists = FileManager.default.fileExists(atPath: trimmedCwd, isDirectory: &isDirectory)
            if !exists || !isDirectory.boolValue {
                errors.append("AIPAL_AGENT_CWD debe apuntar a una carpeta existente.")
            }
        }

        return errors
    }
}

final class SettingsStore {
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    func load() -> NimbusSettings {
        let fileURL = settingsURL()
        guard let data = try? Data(contentsOf: fileURL) else {
            return .default
        }

        do {
            return try decoder.decode(NimbusSettings.self, from: data)
        } catch {
            return .default
        }
    }

    func save(_ settings: NimbusSettings) throws {
        let directoryURL = appSupportDirectory()
        try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true, attributes: nil)

        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(settings)
        try data.write(to: settingsURL(), options: .atomic)
    }

    func settingsURL() -> URL {
        appSupportDirectory().appendingPathComponent("settings.json", isDirectory: false)
    }

    private func appSupportDirectory() -> URL {
        let baseURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support", isDirectory: true)
        return baseURL.appendingPathComponent("NimbusAgent", isDirectory: true)
    }
}

struct EnvAssembler {
    static func build(settings: NimbusSettings, token: String) -> [String: String] {
        var env = ProcessInfo.processInfo.environment

        env["PATH"] = ShellResolver.mergedPathValue()
        env["TELEGRAM_BOT_TOKEN"] = token
        env["ALLOWED_USERS"] = settings.allowedUsers.trimmingCharacters(in: .whitespacesAndNewlines)
        env["AIPAL_DROP_PENDING_UPDATES"] = settings.dropPendingUpdates ? "true" : "false"

        let trimmedCwd = settings.agentCwd.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedCwd.isEmpty {
            env.removeValue(forKey: "AIPAL_AGENT_CWD")
        } else {
            env["AIPAL_AGENT_CWD"] = trimmedCwd
        }

        let trimmedWhisper = settings.whisperCmd.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedWhisper.isEmpty {
            env.removeValue(forKey: "AIPAL_WHISPER_CMD")
        } else {
            env["AIPAL_WHISPER_CMD"] = trimmedWhisper
        }

        env["AIPAL_SCRIPT_TIMEOUT_MS"] = String(settings.scriptTimeoutMs)
        env["AIPAL_AGENT_TIMEOUT_MS"] = String(settings.agentTimeoutMs)
        env["AIPAL_AGENT_MAX_BUFFER"] = String(settings.agentMaxBuffer)
        env["AIPAL_MEMORY_CURATE_EVERY"] = String(settings.memoryCurateEvery)
        env["AIPAL_MEMORY_RETRIEVAL_LIMIT"] = String(settings.memoryRetrievalLimit)
        env["AIPAL_SHUTDOWN_DRAIN_TIMEOUT_MS"] = String(settings.shutdownDrainTimeoutMs)

        return env
    }
}
