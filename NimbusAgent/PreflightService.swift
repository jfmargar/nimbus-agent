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
            if let version = Self.readCommandOutput(executablePath: commandPath, arguments: ["--version"]) {
                details.append("\(requiredCommand) version: \(version)")
            }
        } else {
            errors.append("No se encontró `\(requiredCommand)` en PATH. Si lo tienes instalado, reinicia Nimbus o verifica tu PATH en zsh.")
        }

        details.append("Locked agent: \(bot.lockedAgentId)")
        details.append("XDG_CONFIG_HOME: \(effectiveEnv["XDG_CONFIG_HOME"] ?? "(unset)")")
        if bot == .codex {
            details.append("Codex integration: SDK")
            details.append("CODEX_HOME: \(effectiveCodexHome)")
            details.append("Codex approval: \(settings.codexApprovalMode)")
            details.append("Codex sandbox: \(settings.codexSandboxMode)")
            details.append("Codex progress updates: \(settings.codexProgressUpdates ? "enabled" : "disabled")")
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

    private static func readCommandOutput(executablePath: String, arguments: [String]) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = arguments
        process.environment = ["PATH": ShellResolver.mergedPathValue()]

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return nil
        }

        guard process.terminationStatus == 0 else {
            return nil
        }

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return output.isEmpty ? nil : output
    }
}
