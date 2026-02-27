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
    var codexApprovalMode: String
    var codexSandboxMode: String
    var codexProgressUpdates: Bool

    enum CodingKeys: String, CodingKey {
        case allowedUsers
        case agentCwd
        case dropPendingUpdates
        case whisperCmd
        case scriptTimeoutMs
        case agentTimeoutMs
        case agentMaxBuffer
        case memoryCurateEvery
        case memoryRetrievalLimit
        case shutdownDrainTimeoutMs
        case codexApprovalMode
        case codexSandboxMode
        case codexProgressUpdates
    }

    init(
        allowedUsers: String,
        agentCwd: String,
        dropPendingUpdates: Bool,
        whisperCmd: String,
        scriptTimeoutMs: Int,
        agentTimeoutMs: Int,
        agentMaxBuffer: Int,
        memoryCurateEvery: Int,
        memoryRetrievalLimit: Int,
        shutdownDrainTimeoutMs: Int,
        codexApprovalMode: String,
        codexSandboxMode: String,
        codexProgressUpdates: Bool
    ) {
        self.allowedUsers = allowedUsers
        self.agentCwd = agentCwd
        self.dropPendingUpdates = dropPendingUpdates
        self.whisperCmd = whisperCmd
        self.scriptTimeoutMs = scriptTimeoutMs
        self.agentTimeoutMs = agentTimeoutMs
        self.agentMaxBuffer = agentMaxBuffer
        self.memoryCurateEvery = memoryCurateEvery
        self.memoryRetrievalLimit = memoryRetrievalLimit
        self.shutdownDrainTimeoutMs = shutdownDrainTimeoutMs
        self.codexApprovalMode = codexApprovalMode
        self.codexSandboxMode = codexSandboxMode
        self.codexProgressUpdates = codexProgressUpdates
    }

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
        shutdownDrainTimeoutMs: 120000,
        codexApprovalMode: "never",
        codexSandboxMode: "workspace-write",
        codexProgressUpdates: true
    )

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let defaults = NimbusSettings.default
        allowedUsers = try container.decodeIfPresent(String.self, forKey: .allowedUsers) ?? defaults.allowedUsers
        agentCwd = try container.decodeIfPresent(String.self, forKey: .agentCwd) ?? defaults.agentCwd
        dropPendingUpdates = try container.decodeIfPresent(Bool.self, forKey: .dropPendingUpdates) ?? defaults.dropPendingUpdates
        whisperCmd = try container.decodeIfPresent(String.self, forKey: .whisperCmd) ?? defaults.whisperCmd
        scriptTimeoutMs = try container.decodeIfPresent(Int.self, forKey: .scriptTimeoutMs) ?? defaults.scriptTimeoutMs
        agentTimeoutMs = try container.decodeIfPresent(Int.self, forKey: .agentTimeoutMs) ?? defaults.agentTimeoutMs
        agentMaxBuffer = try container.decodeIfPresent(Int.self, forKey: .agentMaxBuffer) ?? defaults.agentMaxBuffer
        memoryCurateEvery = try container.decodeIfPresent(Int.self, forKey: .memoryCurateEvery) ?? defaults.memoryCurateEvery
        memoryRetrievalLimit = try container.decodeIfPresent(Int.self, forKey: .memoryRetrievalLimit) ?? defaults.memoryRetrievalLimit
        shutdownDrainTimeoutMs = try container.decodeIfPresent(Int.self, forKey: .shutdownDrainTimeoutMs) ?? defaults.shutdownDrainTimeoutMs
        codexApprovalMode = try container.decodeIfPresent(String.self, forKey: .codexApprovalMode) ?? defaults.codexApprovalMode
        codexSandboxMode = try container.decodeIfPresent(String.self, forKey: .codexSandboxMode) ?? defaults.codexSandboxMode
        codexProgressUpdates = try container.decodeIfPresent(Bool.self, forKey: .codexProgressUpdates) ?? defaults.codexProgressUpdates
    }

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

        let validApprovalModes = ["never", "on-request", "on-failure", "untrusted"]
        if !validApprovalModes.contains(codexApprovalMode.trimmingCharacters(in: .whitespacesAndNewlines)) {
            errors.append("AIPAL_CODEX_APPROVAL_MODE no es válido.")
        }

        let validSandboxModes = ["read-only", "workspace-write", "danger-full-access"]
        if !validSandboxModes.contains(codexSandboxMode.trimmingCharacters(in: .whitespacesAndNewlines)) {
            errors.append("AIPAL_CODEX_SANDBOX_MODE no es válido.")
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
    static func effectiveCodexHome(from environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
        if let value = environment["CODEX_HOME"]?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
            return value
        }
        return "\(NSHomeDirectory())/.codex"
    }

    static func build(settings: NimbusSettings, token: String) -> [String: String] {
        var env = ProcessInfo.processInfo.environment

        env["PATH"] = ShellResolver.mergedPathValue()
        if env["HOME"]?.isEmpty ?? true {
            env["HOME"] = NSHomeDirectory()
        }
        env["CODEX_HOME"] = effectiveCodexHome(from: env)
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
            env["AIPAL_WHISPER_CMD"] = ShellResolver.resolveCommandPath(trimmedWhisper) ?? ShellResolver.expandHome(trimmedWhisper)
        }

        env["AIPAL_SCRIPT_TIMEOUT_MS"] = String(settings.scriptTimeoutMs)
        env["AIPAL_AGENT_TIMEOUT_MS"] = String(settings.agentTimeoutMs)
        env["AIPAL_AGENT_MAX_BUFFER"] = String(settings.agentMaxBuffer)
        env["AIPAL_MEMORY_CURATE_EVERY"] = String(settings.memoryCurateEvery)
        env["AIPAL_MEMORY_RETRIEVAL_LIMIT"] = String(settings.memoryRetrievalLimit)
        env["AIPAL_SHUTDOWN_DRAIN_TIMEOUT_MS"] = String(settings.shutdownDrainTimeoutMs)
        env["AIPAL_CODEX_APPROVAL_MODE"] = settings.codexApprovalMode
        env["AIPAL_CODEX_SANDBOX_MODE"] = settings.codexSandboxMode
        env["AIPAL_CODEX_PROGRESS_UPDATES"] = settings.codexProgressUpdates ? "true" : "false"

        return env
    }
}
