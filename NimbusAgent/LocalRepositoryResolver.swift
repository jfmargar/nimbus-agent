import Foundation

enum LocalRepositoryResolverError: LocalizedError {
    case notGitRepository(String)
    case missingOriginRemote(String)
    case unsupportedRemote(String)

    var errorDescription: String? {
        switch self {
        case .notGitRepository(let path):
            return "La carpeta no parece un repositorio git: \(path)"
        case .missingOriginRemote(let path):
            return "No se encontró `remote.origin.url` en \(path)"
        case .unsupportedRemote(let value):
            return "No pude inferir GitHub/GitLab desde el remoto: \(value)"
        }
    }
}

struct LocalRepositoryResolver {
    func resolveRepositories(
        from paths: [String],
        environment: [String: String],
        onError: ((String) -> Void)? = nil
    ) -> [DashboardLocalRepository] {
        var repositories: [DashboardLocalRepository] = []
        var seen = Set<String>()

        for path in paths {
            let repository: DashboardLocalRepository
            do {
                repository = try resolveRepository(at: path, environment: environment)
            } catch {
                onError?("[repo] \(path) -> \(error.localizedDescription)")
                continue
            }
            if seen.insert(repository.id).inserted {
                repositories.append(repository)
            }
        }

        return repositories.sorted { lhs, rhs in
            lhs.repository.localizedCaseInsensitiveCompare(rhs.repository) == .orderedAscending
        }
    }

    func resolveRepository(at path: String, environment: [String: String]) throws -> DashboardLocalRepository {
        let localPath = ShellResolver.expandHome(path)
        guard isGitRepository(localPath, environment: environment) else {
            throw LocalRepositoryResolverError.notGitRepository(localPath)
        }

        let remoteURL = try originRemoteURL(localPath, environment: environment)
        let resolved = try parseRemoteURL(remoteURL)
        return DashboardLocalRepository(
            platform: resolved.platform,
            repository: resolved.repository,
            localPath: localPath
        )
    }

    private func isGitRepository(_ path: String, environment: [String: String]) -> Bool {
        guard let result = try? CommandExecutor.runProcess(
            executablePath: "/usr/bin/git",
            arguments: ["rev-parse", "--is-inside-work-tree"],
            environment: environment,
            currentDirectoryURL: URL(fileURLWithPath: path, isDirectory: true)
        ) else {
            return false
        }

        return result.terminationStatus == 0 &&
            result.stdout.trimmingCharacters(in: .whitespacesAndNewlines) == "true"
    }

    private func originRemoteURL(_ path: String, environment: [String: String]) throws -> String {
        let result = try CommandExecutor.runProcess(
            executablePath: "/usr/bin/git",
            arguments: ["config", "--get", "remote.origin.url"],
            environment: environment,
            currentDirectoryURL: URL(fileURLWithPath: path, isDirectory: true)
        )

        let output = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        guard result.terminationStatus == 0, !output.isEmpty else {
            throw LocalRepositoryResolverError.missingOriginRemote(path)
        }
        return output
    }

    private func parseRemoteURL(_ value: String) throws -> (platform: IssuePlatform, repository: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)

        if let components = URLComponents(string: trimmed), let host = components.host {
            let path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let repository = normalizedRepositoryPath(path)
            if host.contains("github") {
                return (.github, repository)
            }
            if host.contains("gitlab") {
                return (.gitlab, repository)
            }
        }

        if let atIndex = trimmed.lastIndex(of: "@") {
            let suffix = trimmed[trimmed.index(after: atIndex)...]
            let parts = suffix.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: true)
            if parts.count == 2 {
                let host = String(parts[0])
                let repository = normalizedRepositoryPath(String(parts[1]))
                if host.contains("github") {
                    return (.github, repository)
                }
                if host.contains("gitlab") {
                    return (.gitlab, repository)
                }
            }
        }

        throw LocalRepositoryResolverError.unsupportedRemote(trimmed)
    }

    private func normalizedRepositoryPath(_ value: String) -> String {
        var path = value.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if path.hasSuffix(".git") {
            path.removeLast(4)
        }
        return path
    }
}
