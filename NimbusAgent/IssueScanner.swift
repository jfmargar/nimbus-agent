import Foundation

enum IssueScannerError: LocalizedError {
    case missingCLI(String)
    case commandFailed(String)
    case invalidResponse(String)

    var errorDescription: String? {
        switch self {
        case .missingCLI(let name):
            return "No se encontró `\(name)` en PATH."
        case .commandFailed(let message):
            return message
        case .invalidResponse(let message):
            return message
        }
    }
}

struct IssueScanner {
    func scan(
        settings: NimbusSettings,
        environment: [String: String],
        onProgress: ((String) -> Void)? = nil,
        onResult: ((DashboardScanResult) -> Void)? = nil
    ) -> [DashboardIssue] {
        let labels = settings.dashboardIssueLabelsList
        let discoveredPaths = LocalRepositoryDiscovery().discoverRepositoryPaths(
            under: settings.dashboardRootDirectoryPathsList()
        )
        let repositoryPaths = Array(Set(discoveredPaths)).sorted()
        guard !labels.isEmpty else {
            return []
        }

        let resolver = LocalRepositoryResolver()
        var repositories: [DashboardLocalRepository] = []
        var localPathIndex: [String: String] = [:]
        for path in repositoryPaths {
            onProgress?(path)

            let repository: DashboardLocalRepository
            do {
                repository = try resolver.resolveRepository(at: path, environment: environment)
            } catch {
                onResult?(
                    DashboardScanResult(
                        path: path,
                        title: "No se pudo resolver el repositorio",
                        detail: error.localizedDescription,
                        status: .failure,
                        createdAt: Date()
                    )
                )
                continue
            }

            let key = "\(repository.platform.rawValue):\(repository.repository)"
            if let existing = localPathIndex[key], existing != repository.localPath {
                onResult?(
                    DashboardScanResult(
                        path: repository.localPath,
                        title: "Repositorio duplicado",
                        detail: "Se usa \(existing) para \(repository.repository); se omite este checkout.",
                        status: .warning,
                        createdAt: Date()
                    )
                )
                continue
            }

            localPathIndex[key] = repository.localPath
            repositories.append(repository)
        }

        var collected: [String: DashboardIssue] = [:]
        for repository in repositories {
            let issues: [DashboardIssue]
            do {
                issues = try scanRepository(
                    repository,
                    labels: labels,
                    environment: environment,
                    localPathIndex: localPathIndex
                )
            } catch {
                onResult?(
                    DashboardScanResult(
                        path: repository.localPath,
                        title: repository.repository,
                        detail: error.localizedDescription,
                        status: .failure,
                        createdAt: Date()
                    )
                )
                continue
            }
            for issue in issues {
                collected[issue.id] = issue
            }
            onResult?(
                DashboardScanResult(
                    path: repository.localPath,
                    title: repository.repository,
                    detail: issues.isEmpty ? "Sin issues asignadas con las labels configuradas." : "\(issues.count) issue(s) detectadas.",
                    status: .success,
                    createdAt: Date()
                )
            )
        }

        return collected.values.sorted {
            ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast)
        }
    }

    private func scanRepository(
        _ repository: DashboardLocalRepository,
        labels: [String],
        environment: [String: String],
        localPathIndex: [String: String]
    ) throws -> [DashboardIssue] {
        switch repository.platform {
        case .github:
            return try scanGitHub(repository, labels: labels, environment: environment, localPathIndex: localPathIndex)
        case .gitlab:
            return try scanGitLab(repository, labels: labels, environment: environment, localPathIndex: localPathIndex)
        }
    }

    private func scanGitHub(
        _ repository: DashboardLocalRepository,
        labels: [String],
        environment: [String: String],
        localPathIndex: [String: String]
    ) throws -> [DashboardIssue] {
        guard let ghPath = ShellResolver.resolveCommandPath("gh") else {
            throw IssueScannerError.missingCLI("gh")
        }

        var issuesById: [String: DashboardIssue] = [:]
        for label in labels {
            let result = try CommandExecutor.runProcess(
                executablePath: ghPath,
                arguments: [
                    "issue", "list",
                    "--state", "open",
                    "--assignee", "@me",
                    "--label", label,
                    "--json", "number,title,url,labels,createdAt,updatedAt"
                ],
                environment: environment,
                currentDirectoryURL: URL(fileURLWithPath: repository.localPath, isDirectory: true)
            )

            guard result.terminationStatus == 0 else {
                throw IssueScannerError.commandFailed(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))
            }

            let decoded = try decodeGitHubIssues(
                from: result.stdout,
                fallbackRepository: repository.repository,
                fallbackLocalPath: repository.localPath,
                localPathIndex: localPathIndex
            )
            for issue in decoded {
                issuesById[issue.id] = issue
            }
        }
        return Array(issuesById.values)
    }

    private func scanGitLab(
        _ repository: DashboardLocalRepository,
        labels: [String],
        environment: [String: String],
        localPathIndex: [String: String]
    ) throws -> [DashboardIssue] {
        guard let glabPath = ShellResolver.resolveCommandPath("glab") else {
            throw IssueScannerError.missingCLI("glab")
        }

        var issuesById: [String: DashboardIssue] = [:]

        for label in labels {
            let result = try CommandExecutor.runProcess(
                executablePath: glabPath,
                arguments: [
                    "issue", "list",
                    "--assignee", "@me",
                    "--label", label,
                    "--output", "json"
                ],
                environment: environment,
                currentDirectoryURL: URL(fileURLWithPath: repository.localPath, isDirectory: true)
            )

            guard result.terminationStatus == 0 else {
                throw IssueScannerError.commandFailed(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))
            }

            let decoded = try decodeGitLabIssues(
                from: result.stdout,
                fallbackRepository: repository.repository,
                fallbackLocalPath: repository.localPath,
                localPathIndex: localPathIndex
            )
            for issue in decoded {
                issuesById[issue.id] = issue
            }
        }
        return Array(issuesById.values)
    }

    private func decodeGitHubIssues(
        from raw: String,
        fallbackRepository: String,
        fallbackLocalPath: String?,
        localPathIndex: [String: String]
    ) throws -> [DashboardIssue] {
        struct GitHubLabel: Decodable {
            let name: String
        }

        struct GitHubIssue: Decodable {
            let number: Int
            let title: String
            let url: String
            let labels: [GitHubLabel]
            let createdAt: String?
            let updatedAt: String?
            let repository: String?
        }

        guard let data = raw.data(using: .utf8) else {
            throw IssueScannerError.invalidResponse("Respuesta inválida de GitHub.")
        }

        let decoder = JSONDecoder()
        let issues = try decoder.decode([GitHubIssue].self, from: data)
        return issues.map { issue in
            let repository = normalizedRepository(issue.repository, fallback: fallbackRepository, fromURL: issue.url)
            let localPath = resolvedLocalPath(
                platform: .github,
                repository: repository,
                localPathIndex: localPathIndex,
                fallback: fallbackLocalPath
            )
            return DashboardIssue(
                platform: .github,
                repository: repository,
                localPath: localPath,
                number: issue.number,
                title: issue.title,
                url: issue.url,
                labels: issue.labels.map(\.name).sorted(),
                createdAt: parseISODate(issue.createdAt),
                updatedAt: parseISODate(issue.updatedAt)
            )
        }
    }

    private func decodeGitLabIssues(
        from raw: String,
        fallbackRepository: String,
        fallbackLocalPath: String?,
        localPathIndex: [String: String]
    ) throws -> [DashboardIssue] {
        struct GitLabIssue: Decodable {
            let iid: Int
            let title: String
            let webURL: String
            let labels: [String]
            let createdAt: String?
            let updatedAt: String?
            let references: GitLabReferences?

            struct GitLabReferences: Decodable {
                let full: String?
            }

            enum CodingKeys: String, CodingKey {
                case iid
                case title
                case webURL = "web_url"
                case labels
                case createdAt = "created_at"
                case updatedAt = "updated_at"
                case references
            }
        }

        guard let data = raw.data(using: .utf8) else {
            throw IssueScannerError.invalidResponse("Respuesta inválida de GitLab.")
        }

        let decoder = JSONDecoder()
        let issues = try decoder.decode([GitLabIssue].self, from: data)
        return issues.map { issue in
            let repository = normalizedRepository(
                issue.references?.full,
                fallback: fallbackRepository,
                fromURL: issue.webURL
            )
            let localPath = resolvedLocalPath(
                platform: .gitlab,
                repository: repository,
                localPathIndex: localPathIndex,
                fallback: fallbackLocalPath
            )
            return DashboardIssue(
                platform: .gitlab,
                repository: repository,
                localPath: localPath,
                number: issue.iid,
                title: issue.title,
                url: issue.webURL,
                labels: issue.labels.sorted(),
                createdAt: parseISODate(issue.createdAt),
                updatedAt: parseISODate(issue.updatedAt)
            )
        }
    }

    private func parseISODate(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) {
            return date
        }

        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    private func urlEncode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
    }

    private func normalizedRepository(_ value: String?, fallback: String, fromURL urlString: String) -> String {
        let trimmed = String(value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            return sanitizeRepositoryReference(trimmed)
        }

        if let parsed = repositoryFromIssueURL(urlString), !parsed.isEmpty {
            return parsed
        }

        return sanitizeRepositoryReference(fallback)
    }

    private func sanitizeRepositoryReference(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if let hashIndex = trimmed.firstIndex(of: "#") {
            return String(trimmed[..<hashIndex])
        }
        return trimmed
    }

    private func repositoryFromIssueURL(_ value: String) -> String? {
        guard let components = URLComponents(string: value) else { return nil }
        let parts = components.path.split(separator: "/").map(String.init)
        guard let issuesIndex = parts.firstIndex(where: { $0 == "issues" }) else {
            return nil
        }

        if components.host?.contains("github") == true {
            guard issuesIndex >= 2 else { return nil }
            return parts[0...1].joined(separator: "/")
        }

        if components.host?.contains("gitlab") == true {
            if let dashIndex = parts.firstIndex(of: "-"), dashIndex >= 1 {
                return parts[..<dashIndex].joined(separator: "/")
            }
            if issuesIndex >= 1 {
                return parts[..<issuesIndex].joined(separator: "/")
            }
        }

        return nil
    }

    private func resolvedLocalPath(
        platform: IssuePlatform,
        repository: String,
        localPathIndex: [String: String],
        fallback: String?
    ) -> String? {
        if let fallback, !fallback.isEmpty {
            return fallback
        }
        return localPathIndex["\(platform.rawValue):\(repository)"]
    }
}
