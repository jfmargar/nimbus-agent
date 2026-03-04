import Foundation

struct LocalRepositoryDiscovery {
    func discoverRepositoryPaths(under roots: [String]) -> [String] {
        var results = Set<String>()
        for root in roots {
            let normalizedRoot = ShellResolver.expandHome(root)
            if isGitRepositoryPath(normalizedRoot) {
                results.insert(normalizedRoot)
                continue
            }

            let url = URL(fileURLWithPath: normalizedRoot, isDirectory: true)
            guard let enumerator = FileManager.default.enumerator(
                at: url,
                includingPropertiesForKeys: [.isDirectoryKey, .nameKey],
                options: [.skipsPackageDescendants, .skipsHiddenFiles],
                errorHandler: { _, _ in true }
            ) else {
                continue
            }

            for case let candidateURL as URL in enumerator {
                guard let resourceValues = try? candidateURL.resourceValues(forKeys: [.isDirectoryKey, .nameKey]),
                      resourceValues.isDirectory == true else {
                    continue
                }

                let candidatePath = candidateURL.path
                if isGitRepositoryPath(candidatePath) {
                    results.insert(candidatePath)
                    enumerator.skipDescendants()
                }
            }
        }

        return results.sorted()
    }

    private func isGitRepositoryPath(_ path: String) -> Bool {
        var isDirectory: ObjCBool = false
        let gitDir = URL(fileURLWithPath: path, isDirectory: true).appendingPathComponent(".git").path
        if FileManager.default.fileExists(atPath: gitDir, isDirectory: &isDirectory) {
            return isDirectory.boolValue || FileManager.default.isReadableFile(atPath: gitDir)
        }
        return false
    }
}
