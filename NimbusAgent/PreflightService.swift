import Foundation

struct PreflightReport {
    let errors: [String]
    let warnings: [String]
    let details: [String]

    var isOK: Bool { errors.isEmpty }

    static let empty = PreflightReport(errors: [], warnings: [], details: [])
}

final class PreflightService {
    func run(settings: NimbusSettings, token: String, nodeURL: URL?, entryURL: URL?) -> PreflightReport {
        var errors: [String] = []
        var warnings: [String] = []
        var details: [String] = []

        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedToken.isEmpty {
            errors.append("Falta TELEGRAM_BOT_TOKEN. Configúralo en Ajustes > General.")
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

        if let codexPath = ShellResolver.resolveCommandPath("codex") {
            details.append("codex: \(codexPath)")
        } else {
            errors.append("No se encontró `codex` en PATH. Si lo tienes instalado, reinicia Nimbus o verifica tu PATH en zsh.")
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
}
