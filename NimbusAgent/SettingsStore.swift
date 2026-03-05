import Foundation

enum NimbusBot: String, CaseIterable, Identifiable {
    case codex
    case gemini

    var id: String { rawValue }

    var label: String {
        switch self {
        case .codex:
            return "Codex"
        case .gemini:
            return "Gemini"
        }
    }

    var lockedAgentId: String {
        switch self {
        case .codex:
            return "codex"
        case .gemini:
            return "gemini"
        }
    }

    var tokenKeychainAccount: String {
        "TELEGRAM_BOT_TOKEN_\(rawValue.uppercased())"
    }

    var configHomeComponent: String {
        rawValue
    }
}

struct NimbusSettings: Codable, Equatable {
    static let legacyDashboardCodexPromptTemplate = """
Resuelve la incidencia #{issue_number}: {issue_title}

Repositorio: {repo}
Issue URL: {issue_url}
Labels: {issue_labels}

Trabaja en el repositorio local y deja cambios listos para revisión. Si falta contexto, inspecciona el código y documenta cualquier limitación.
"""

    static let dashboardCodexPromptTemplateDefault = """
Revisar issue #{issue_number}: {issue_title}

Repositorio: {repo}
Ruta local: {repo_path}
Issue URL: {issue_url}
Labels: {issue_labels}

Tu objetivo es resolver este issue. Por favor, sigue estos pasos:
1. Crea una nueva rama (por ejemplo, `codex/issue-{issue_number}`) usando git.
2. Explora el código fuente para entender el problema.
3. Elabora un plan de acción para resolver el issue.
4. Intenta resolver el issue implementando los cambios en el código.
5. Mantén tus mensajes claros para que la sesión sea útil y legible en la app de Codex.
"""

    static let legacyDashboardCodexCommandTemplate = "codex exec --skip-git-repo-check --yolo {codex_prompt}"
    static let dashboardCodexCommandTemplateDefault = "codex exec -s workspace-write -C {repo_path} {codex_prompt}"

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
    var dashboardRootDirectories: String
    var dashboardScanTargets: String
    var dashboardGitHubOwners: String
    var dashboardGitLabGroups: String
    var dashboardAILabels: String
    var dashboardCodexPromptTemplate: String
    var dashboardCodexCommandTemplate: String
    var dashboardAutomationActions: String

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
        case dashboardRootDirectories
        case dashboardScanTargets
        case dashboardGitHubOwners
        case dashboardGitLabGroups
        case dashboardAILabels
        case dashboardCodexPromptTemplate
        case dashboardCodexCommandTemplate
        case dashboardAutomationActions
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
        codexProgressUpdates: Bool,
        dashboardRootDirectories: String,
        dashboardScanTargets: String,
        dashboardGitHubOwners: String,
        dashboardGitLabGroups: String,
        dashboardAILabels: String,
        dashboardCodexPromptTemplate: String,
        dashboardCodexCommandTemplate: String,
        dashboardAutomationActions: String
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
        self.dashboardRootDirectories = dashboardRootDirectories
        self.dashboardScanTargets = dashboardScanTargets
        self.dashboardGitHubOwners = dashboardGitHubOwners
        self.dashboardGitLabGroups = dashboardGitLabGroups
        self.dashboardAILabels = dashboardAILabels
        self.dashboardCodexPromptTemplate = dashboardCodexPromptTemplate
        self.dashboardCodexCommandTemplate = dashboardCodexCommandTemplate
        self.dashboardAutomationActions = dashboardAutomationActions
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
        codexProgressUpdates: true,
        dashboardRootDirectories: "",
        dashboardScanTargets: "",
        dashboardGitHubOwners: "",
        dashboardGitLabGroups: "",
        dashboardAILabels: "ai, codex, agent",
        dashboardCodexPromptTemplate: dashboardCodexPromptTemplateDefault,
        dashboardCodexCommandTemplate: dashboardCodexCommandTemplateDefault,
        dashboardAutomationActions: ""
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
        dashboardRootDirectories = try container.decodeIfPresent(String.self, forKey: .dashboardRootDirectories) ?? defaults.dashboardRootDirectories
        dashboardScanTargets = try container.decodeIfPresent(String.self, forKey: .dashboardScanTargets) ?? defaults.dashboardScanTargets
        dashboardGitHubOwners = try container.decodeIfPresent(String.self, forKey: .dashboardGitHubOwners) ?? defaults.dashboardGitHubOwners
        dashboardGitLabGroups = try container.decodeIfPresent(String.self, forKey: .dashboardGitLabGroups) ?? defaults.dashboardGitLabGroups
        dashboardAILabels = try container.decodeIfPresent(String.self, forKey: .dashboardAILabels) ?? defaults.dashboardAILabels
        dashboardCodexPromptTemplate = try container.decodeIfPresent(String.self, forKey: .dashboardCodexPromptTemplate) ?? defaults.dashboardCodexPromptTemplate
        dashboardCodexCommandTemplate = try container.decodeIfPresent(String.self, forKey: .dashboardCodexCommandTemplate) ?? defaults.dashboardCodexCommandTemplate
        dashboardAutomationActions = try container.decodeIfPresent(String.self, forKey: .dashboardAutomationActions) ?? defaults.dashboardAutomationActions
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

        if dashboardCodexPromptTemplate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("La plantilla del prompt de Codex para el dashboard no puede estar vacía.")
        }

        if dashboardCodexCommandTemplate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("La plantilla de comando de Codex para el dashboard no puede estar vacía.")
        }

        for path in dashboardRootDirectoryPathsList() {
            var isDirectory: ObjCBool = false
            let exists = FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory)
            if !exists || !isDirectory.boolValue {
                errors.append("La carpeta raíz del dashboard no existe o no es carpeta: \(path)")
            }
        }

        do {
            let targets = try dashboardScanTargetsList()
            for target in targets {
                var isDirectory: ObjCBool = false
                let exists = FileManager.default.fileExists(atPath: target.localPath, isDirectory: &isDirectory)
                if !exists || !isDirectory.boolValue {
                    errors.append("El path local del dashboard no existe o no es carpeta: \(target.localPath)")
                }
            }
        } catch {
            errors.append(error.localizedDescription)
        }

        do {
            _ = try dashboardAutomationActionsList()
        } catch {
            errors.append(error.localizedDescription)
        }

        return errors
    }

    mutating func migrateDashboardCodexDefaultsIfNeeded() {
        let previousDefaultPrompt = """
Revisar issue #{issue_number}: {issue_title}

Repositorio: {repo}
Ruta local: {repo_path}
Issue URL: {issue_url}
Labels: {issue_labels}

Trabaja en este checkout local y resuelve la issue. Mantén la sesión útil y legible en Codex app. Si hace falta contexto, inspecciona el código, ejecuta verificaciones razonables y deja claros los siguientes pasos.
"""
        let intermediateDefaultPrompt = """
Revisar issue #{issue_number}: {issue_title}

Repositorio: {repo}
Ruta local: {repo_path}
Issue URL: {issue_url}
Labels: {issue_labels}

Tu objetivo es resolver este issue. Por favor, sigue estos pasos:
1. Crea una nueva rama (por ejemplo, `issue-{issue_number}`) usando git.
2. Explora el código fuente para entender el problema.
3. Elabora un plan de acción para resolver el issue.
4. Intenta resolver el issue implementando los cambios en el código.
5. Mantén tus mensajes claros para que la sesión sea útil y legible en la app de Codex.
"""
        if dashboardCodexPromptTemplate == Self.legacyDashboardCodexPromptTemplate ||
           dashboardCodexPromptTemplate == previousDefaultPrompt ||
           dashboardCodexPromptTemplate == intermediateDefaultPrompt {
            dashboardCodexPromptTemplate = Self.dashboardCodexPromptTemplateDefault
        }

        if dashboardCodexCommandTemplate == Self.legacyDashboardCodexCommandTemplate || 
           dashboardCodexCommandTemplate == "codex --no-alt-screen -a never -s workspace-write -C {repo_path} {codex_prompt}" {
            dashboardCodexCommandTemplate = Self.dashboardCodexCommandTemplateDefault
        }
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
    private static let codexShellVariables = [
        "PATH",
        "HOME",
        "SSH_AUTH_SOCK",
        "SSH_AGENT_PID",
        "GIT_ASKPASS",
        "GITLAB_TOKEN",
        "GLAB_TOKEN",
        "GITLAB_HOST",
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "GH_HOST",
        "GLAB_CONFIG_DIR",
        "XDG_CONFIG_HOME",
        "XDG_CACHE_HOME",
        "XDG_STATE_HOME",
        "LANG",
        "LC_ALL"
    ]

    private static let geminiShellVariables = [
        "PATH",
        "HOME",
        "SSH_AUTH_SOCK",
        "SSH_AGENT_PID",
        "GIT_ASKPASS",
        "GITLAB_TOKEN",
        "GLAB_TOKEN",
        "GITLAB_HOST",
        "GLAB_CONFIG_DIR",
        "XDG_CONFIG_HOME",
        "XDG_CACHE_HOME",
        "XDG_STATE_HOME",
        "LANG",
        "LC_ALL"
    ]

    static func effectiveCodexHome(from environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
        if let value = environment["CODEX_HOME"]?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
            return value
        }
        return "\(NSHomeDirectory())/.codex"
    }

    static func configHome(for bot: NimbusBot) -> URL {
        let baseURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support", isDirectory: true)
        return baseURL
            .appendingPathComponent("NimbusAgent", isDirectory: true)
            .appendingPathComponent("BotConfig", isDirectory: true)
            .appendingPathComponent(bot.configHomeComponent, isDirectory: true)
    }

    static func aipalStateHome(for bot: NimbusBot) -> URL {
        configHome(for: bot).appendingPathComponent("aipal", isDirectory: true)
    }

    static func build(settings: NimbusSettings, token: String, bot: NimbusBot) -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        if bot == .gemini {
            env.merge(ShellResolver.interactiveShellEnvironment(variableNames: geminiShellVariables)) { _, new in new }
        } else {
            env.merge(ShellResolver.interactiveShellEnvironment(variableNames: codexShellVariables)) { _, new in new }
            env["PATH"] = ShellResolver.mergedPathValue()
        }

        if env["PATH"]?.isEmpty ?? true {
            env["PATH"] = ShellResolver.mergedPathValue()
        }
        if env["HOME"]?.isEmpty ?? true {
            env["HOME"] = NSHomeDirectory()
        }
        env["CODEX_HOME"] = effectiveCodexHome(from: env)
        if bot == .codex {
            env["XDG_CONFIG_HOME"] = configHome(for: bot).path
            let glabConfigDir = env["GLAB_CONFIG_DIR"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if glabConfigDir.isEmpty {
                env["GLAB_CONFIG_DIR"] = "\(NSHomeDirectory())/.config/glab-cli"
            }
        } else {
            env["AIPAL_STATE_HOME"] = aipalStateHome(for: bot).path
            env.removeValue(forKey: "AIPAL_GEMINI_APPROVAL_MODE")
        }
        env["TELEGRAM_BOT_TOKEN"] = token
        env["ALLOWED_USERS"] = settings.allowedUsers.trimmingCharacters(in: .whitespacesAndNewlines)
        env["AIPAL_DROP_PENDING_UPDATES"] = settings.dropPendingUpdates ? "true" : "false"
        env["AIPAL_LOCKED_AGENT"] = bot.lockedAgentId

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

    static func buildDashboardEnvironment(settings: NimbusSettings) -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        env.merge(ShellResolver.interactiveShellEnvironment(variableNames: geminiShellVariables + ["GH_TOKEN", "GITHUB_TOKEN"])) { _, new in new }

        if env["PATH"]?.isEmpty ?? true {
            env["PATH"] = ShellResolver.mergedPathValue()
        } else {
            env["PATH"] = ShellResolver.mergedPathValue()
        }

        if env["HOME"]?.isEmpty ?? true {
            env["HOME"] = NSHomeDirectory()
        }

        env["CODEX_HOME"] = effectiveCodexHome(from: env)

        let trimmedCwd = settings.agentCwd.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedCwd.isEmpty {
            env.removeValue(forKey: "AIPAL_AGENT_CWD")
        } else {
            env["AIPAL_AGENT_CWD"] = trimmedCwd
        }

        env["AIPAL_AGENT_TIMEOUT_MS"] = String(settings.agentTimeoutMs)
        env["AIPAL_AGENT_MAX_BUFFER"] = String(settings.agentMaxBuffer)
        env["AIPAL_CODEX_APPROVAL_MODE"] = settings.codexApprovalMode
        env["AIPAL_CODEX_SANDBOX_MODE"] = settings.codexSandboxMode
        env["AIPAL_CODEX_PROGRESS_UPDATES"] = settings.codexProgressUpdates ? "true" : "false"

        return env
    }
}
