import Foundation

enum IssuePlatform: String, Codable, CaseIterable, Identifiable {
    case github
    case gitlab

    var id: String { rawValue }

    var label: String {
        switch self {
        case .github:
            return "GitHub"
        case .gitlab:
            return "GitLab"
        }
    }

    var cliName: String {
        switch self {
        case .github:
            return "gh"
        case .gitlab:
            return "glab"
        }
    }
}

struct IssueScanTarget: Identifiable, Hashable {
    let platform: IssuePlatform
    let repository: String
    let localPath: String

    var id: String { "\(platform.rawValue):\(repository)" }
}

struct DashboardIssue: Identifiable, Hashable {
    let platform: IssuePlatform
    let repository: String
    let localPath: String?
    let number: Int
    let title: String
    let url: String
    let labels: [String]
    let createdAt: Date?
    let updatedAt: Date?

    var id: String { "\(platform.rawValue):\(repository):\(number)" }
}

struct DashboardAutomationAction: Identifiable, Hashable {
    let label: String
    let commandTemplate: String

    var id: String {
        label
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
    }
}

struct DashboardLocalRepository: Identifiable, Hashable {
    let platform: IssuePlatform
    let repository: String
    let localPath: String

    var id: String { "\(platform.rawValue):\(repository):\(localPath)" }
}

enum DashboardActionStatus: Equatable {
    case idle
    case running
    case succeeded
    case failed(String)

    var label: String {
        switch self {
        case .idle:
            return "Listo"
        case .running:
            return "Ejecutando"
        case .succeeded:
            return "OK"
        case .failed(let message):
            return "Error: \(message)"
        }
    }
}

enum DashboardConfigurationError: LocalizedError {
    case invalidScanTargetLine(String)
    case invalidAutomationActionLine(String)

    var errorDescription: String? {
        switch self {
        case .invalidScanTargetLine(let line):
            return "Línea de target inválida: \(line). Usa `github::owner/repo::/ruta/local` o `gitlab::group/proj::/ruta/local`."
        case .invalidAutomationActionLine(let line):
            return "Línea de automatización inválida: \(line). Usa `Etiqueta::comando`."
        }
    }
}

extension NimbusSettings {
    func dashboardRootDirectoryPathsList() -> [String] {
        dashboardRootDirectories
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && !$0.hasPrefix("#") }
            .map(ShellResolver.expandHome)
    }

    func dashboardLocalRepositoryPathsList() -> [String] {
        dashboardLocalRepositories
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && !$0.hasPrefix("#") }
            .map(ShellResolver.expandHome)
    }

    var dashboardGitHubOwnersList: [String] {
        dashboardGitHubOwners
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    var dashboardGitLabGroupsList: [String] {
        dashboardGitLabGroups
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    var dashboardIssueLabelsList: [String] {
        dashboardAILabels
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    func dashboardScanTargetsList() throws -> [IssueScanTarget] {
        try dashboardScanTargets
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && !$0.hasPrefix("#") }
            .map { line in
                let parts = line.components(separatedBy: "::")
                guard parts.count >= 3 else {
                    throw DashboardConfigurationError.invalidScanTargetLine(line)
                }
                let platformRaw = parts[0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                let repository = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
                let localPath = parts.dropFirst(2).joined(separator: "::").trimmingCharacters(in: .whitespacesAndNewlines)
                guard let platform = IssuePlatform(rawValue: platformRaw),
                      !repository.isEmpty,
                      !localPath.isEmpty else {
                    throw DashboardConfigurationError.invalidScanTargetLine(line)
                }
                return IssueScanTarget(platform: platform, repository: repository, localPath: ShellResolver.expandHome(localPath))
            }
    }

    func dashboardAutomationActionsList() throws -> [DashboardAutomationAction] {
        try dashboardAutomationActions
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && !$0.hasPrefix("#") }
            .map { line in
                let parts = line.components(separatedBy: "::")
                guard parts.count >= 2 else {
                    throw DashboardConfigurationError.invalidAutomationActionLine(line)
                }
                let label = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)
                let command = parts.dropFirst().joined(separator: "::").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !label.isEmpty, !command.isEmpty else {
                    throw DashboardConfigurationError.invalidAutomationActionLine(line)
                }
                return DashboardAutomationAction(label: label, commandTemplate: command)
            }
    }
}
