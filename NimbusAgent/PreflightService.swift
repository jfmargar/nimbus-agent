import Foundation

struct PreflightReport {
    let errors: [String]
    let warnings: [String]
    let details: [String]

    var isOK: Bool { errors.isEmpty }

    static let empty = PreflightReport(errors: [], warnings: [], details: [])
}

final class PreflightService {
    func run(bot: NimbusBot, settings: NimbusSettings, token: String, nodeURL: URL?, entryURL: URL?) -> PreflightReport {
        var errors: [String] = []
        var warnings: [String] = []
        var details: [String] = []
        let effectiveEnv = EnvAssembler.build(settings: settings, token: token, bot: bot)
        let effectiveCodexHome = effectiveEnv["CODEX_HOME"] ?? EnvAssembler.effectiveCodexHome()
        let defaultCodexHome = "\(NSHomeDirectory())/.codex"
        let requiredCommand = bot == .codex ? "codex" : "gemini"

        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedToken.isEmpty {
            errors.append("Falta TELEGRAM_BOT_TOKEN para \(bot.label). Configúralo en Ajustes > General.")
        }

        errors.append(contentsOf: settings.validationErrors())

        if let nodeURL {
            let nodePath = nodeURL.path
            var isDirectory: ObjCBool = false
            if !FileManager.default.fileExists(atPath: nodePath, isDirectory: &isDirectory) || isDirectory.boolValue {
                errors.append("No se encontró runtime Node embebido en \(nodePath).")
            } else if !FileManager.default.isExecutableFile(atPath: nodePath) {
                errors.append("El runtime Node embebido no es ejecutable en \(nodePath).")
            } else {
                details.append("Node runtime: \(nodePath)")
            }
        } else {
            errors.append("No se pudo resolver la ruta del runtime Node embebido.")
        }

        if let entryURL {
            let entryPath = entryURL.path
            var isDirectory: ObjCBool = false
            if !FileManager.default.fileExists(atPath: entryPath, isDirectory: &isDirectory) || isDirectory.boolValue {
                errors.append("No se encontró entrypoint de Aipal en \(entryPath).")
            } else {
                details.append("Aipal entrypoint: \(entryPath)")
            }
        } else {
            errors.append("No se pudo resolver la ruta del entrypoint de Aipal.")
        }

        if let commandPath = ShellResolver.resolveCommandPath(requiredCommand) {
            details.append("\(requiredCommand): \(commandPath)")
            if let version = Self.readCommandOutput(
                executablePath: commandPath,
                arguments: ["--version"],
                environment: effectiveEnv
            ) {
                details.append("\(requiredCommand) version: \(version)")
            }
        } else {
            errors.append("No se encontró `\(requiredCommand)` en PATH. Si lo tienes instalado, reinicia Nimbus o verifica tu PATH en zsh.")
        }

        details.append("Locked agent: \(bot.lockedAgentId)")
        if bot == .codex {
            details.append("XDG_CONFIG_HOME: \(effectiveEnv["XDG_CONFIG_HOME"] ?? "(unset)")")
            details.append("Codex integration: SDK")
            details.append("CODEX_HOME: \(effectiveCodexHome)")
            details.append("Codex approval: \(settings.codexApprovalMode)")
            details.append("Codex sandbox: \(settings.codexSandboxMode)")
            details.append("Codex progress updates: \(settings.codexProgressUpdates ? "enabled" : "disabled")")
        } else {
            details.append("AIPAL_STATE_HOME: \(effectiveEnv["AIPAL_STATE_HOME"] ?? "(unset)")")
            details.append("XDG_CONFIG_HOME: \(effectiveEnv["XDG_CONFIG_HOME"] ?? "(unset)")")
            details.append("Gemini approval mode: \(effectiveEnv["AIPAL_GEMINI_APPROVAL_MODE"] ?? "default")")
            details.append("GLAB_CONFIG_DIR: \(effectiveEnv["GLAB_CONFIG_DIR"] ?? "(unset)")")
            details.append("SSH_AUTH_SOCK: \((effectiveEnv["SSH_AUTH_SOCK"]?.isEmpty == false) ? "present" : "missing")")
            Self.appendGlabDiagnostics(
                warnings: &warnings,
                details: &details,
                environment: effectiveEnv,
                workingDirectory: effectiveEnv["AIPAL_AGENT_CWD"]
            )
        }
        if bot == .codex, effectiveCodexHome != defaultCodexHome {
            warnings.append("CODEX_HOME efectivo no apunta a \(defaultCodexHome). Nimbus compartirá sesiones con esa ruta alternativa.")
        }

        let whisperCommand = settings.whisperCmd.trimmingCharacters(in: .whitespacesAndNewlines)
        if whisperCommand.isEmpty {
            warnings.append("AIPAL_WHISPER_CMD está vacío; se usará el valor por defecto de Aipal.")
        } else if let whisperPath = ShellResolver.resolveCommandPath(whisperCommand) {
            details.append("whisper cmd: \(whisperPath)")
        } else {
            warnings.append("No se encontró \(whisperCommand) en PATH. La transcripción de audio puede fallar.")
        }

        if settings.allowedUsers.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            warnings.append("ALLOWED_USERS está vacío: el bot quedará abierto a cualquier usuario de Telegram.")
        }

        return PreflightReport(errors: errors, warnings: warnings, details: details)
    }

    private static func appendGlabDiagnostics(
        warnings: inout [String],
        details: inout [String],
        environment: [String: String],
        workingDirectory: String?
    ) {
        guard let glabPath = ShellResolver.resolveCommandPath("glab") else {
            warnings.append("No se encontró `glab` en PATH. El acceso a GitLab desde Gemini puede fallar.")
            return
        }

        details.append("glab: \(glabPath)")
        if let version = readCommandOutput(
            executablePath: glabPath,
            arguments: ["--version"],
            environment: environment
        ) {
            details.append("glab version: \(version)")
        }

        let gitlabHost = resolveGitLabHost(
            workingDirectory: workingDirectory,
            environment: environment
        )
        if let gitlabHost {
            details.append("GitLab host: \(gitlabHost)")
        } else {
            details.append("GitLab host: (no detectado)")
        }

        var arguments = ["auth", "status"]
        if let gitlabHost {
            arguments.append(contentsOf: ["--hostname", gitlabHost])
        }

        guard let result = runCommand(
            executablePath: glabPath,
            arguments: arguments,
            environment: environment,
            currentDirectory: workingDirectory
        ) else {
            warnings.append("No se pudo ejecutar `glab auth status` con el entorno de Gemini.")
            return
        }

        let summary = summarizeAuthStatus(result.stdout, fallback: result.stderr)
        if result.terminationStatus == 0 {
            details.append("glab auth status: \(summary)")
        } else {
            warnings.append("`glab auth status` falló para Gemini: \(summary)")
            details.append("glab auth status raw: \(summary)")
        }
    }

    private static func resolveGitLabHost(
        workingDirectory: String?,
        environment: [String: String]
    ) -> String? {
        guard let workingDirectory = workingDirectory?.trimmingCharacters(in: .whitespacesAndNewlines),
              !workingDirectory.isEmpty else {
            return nil
        }

        guard let result = runCommand(
            executablePath: "/usr/bin/git",
            arguments: ["config", "--get-regexp", #"^remote\..*\.url$"#],
            environment: environment,
            currentDirectory: workingDirectory
        ), result.terminationStatus == 0 else {
            return nil
        }

        let hosts = result.stdout
            .split(whereSeparator: \.isNewline)
            .compactMap { line -> String? in
                let parts = line.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
                guard parts.count == 2 else { return nil }
                return parseHost(fromRemoteURL: String(parts[1]))
            }

        return hosts.first(where: { $0.caseInsensitiveCompare("github.com") != .orderedSame })
    }

    private static func parseHost(fromRemoteURL remoteURL: String) -> String? {
        let trimmed = remoteURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let components = URLComponents(string: trimmed), let host = components.host, !host.isEmpty {
            return host
        }

        if !trimmed.contains("://"), let atIndex = trimmed.lastIndex(of: "@") {
            let suffix = trimmed[trimmed.index(after: atIndex)...]
            let host = suffix.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: true).first
                ?? suffix.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: true).first
            if let host, !host.isEmpty {
                return String(host)
            }
        }

        return nil
    }

    private static func summarizeAuthStatus(_ stdout: String, fallback stderr: String) -> String {
        let source = stdout.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? stderr
            : stdout
        let lines = source
            .split(whereSeparator: \.isNewline)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return lines.first ?? "sin salida"
    }

    private static func readCommandOutput(
        executablePath: String,
        arguments: [String],
        environment: [String: String],
        currentDirectory: String? = nil
    ) -> String? {
        guard let result = runCommand(
            executablePath: executablePath,
            arguments: arguments,
            environment: environment,
            currentDirectory: currentDirectory
        ), result.terminationStatus == 0 else {
            return nil
        }

        let output = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        return output.isEmpty ? nil : output
    }

    private static func runCommand(
        executablePath: String,
        arguments: [String],
        environment: [String: String],
        currentDirectory: String? = nil
    ) -> CommandResult? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = arguments
        process.environment = environment
        if let currentDirectory,
           !currentDirectory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            process.currentDirectoryURL = URL(fileURLWithPath: currentDirectory, isDirectory: true)
        }

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return nil
        }

        let stdout = String(
            decoding: stdoutPipe.fileHandleForReading.readDataToEndOfFile(),
            as: UTF8.self
        )
        let stderr = String(
            decoding: stderrPipe.fileHandleForReading.readDataToEndOfFile(),
            as: UTF8.self
        )
        return CommandResult(
            terminationStatus: process.terminationStatus,
            stdout: stdout,
            stderr: stderr
        )
    }
}

private struct CommandResult {
    let terminationStatus: Int32
    let stdout: String
    let stderr: String
}
