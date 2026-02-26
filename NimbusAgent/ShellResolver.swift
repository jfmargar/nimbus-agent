import Foundation

enum ShellResolver {
    private static var userPaths: [String] {
        let home = NSHomeDirectory()
        return [
            "\(home)/.local/bin",
            "\(home)/.nvm/versions/node/current/bin",
            "\(home)/.cargo/bin"
        ]
    }

    private static let commonPaths = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin"
    ]

    static func resolveCommandPath(_ command: String) -> String? {
        let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // If user provides an explicit path (absolute or relative), resolve it directly.
        if trimmed.contains("/") {
            let expanded = expandHome(trimmed)
            let absolute = expanded.hasPrefix("/")
                ? expanded
                : URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                    .appendingPathComponent(expanded)
                    .path
            return FileManager.default.isExecutableFile(atPath: absolute) ? absolute : nil
        }

        if let found = searchInPath(trimmed, pathValue: ProcessInfo.processInfo.environment["PATH"] ?? "") {
            return found
        }

        if let shellFound = runShellCommand(["-ilc", "command -v \(trimmed)"]) {
            return shellFound
        }

        if let shellFound = runShellCommand(["-lc", "command -v \(trimmed)"]) {
            return shellFound
        }

        return searchInPath(trimmed, pathValue: (userPaths + commonPaths).joined(separator: ":"))
    }

    static func mergedPathValue() -> String {
        let current = splitPath(ProcessInfo.processInfo.environment["PATH"] ?? "")
        let shellInteractive = splitPath(runShellCommand(["-ilc", "echo -n $PATH"]) ?? "")
        let shellLogin = splitPath(runShellCommand(["-lc", "echo -n $PATH"]) ?? "")
        let merged = deduplicate(current + shellInteractive + shellLogin + userPaths + commonPaths)
        return merged.joined(separator: ":")
    }

    static func expandHome(_ value: String) -> String {
        NSString(string: value).expandingTildeInPath
    }

    private static func runShellCommand(_ args: [String]) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = args

        let outputPipe = Pipe()
        process.standardOutput = outputPipe
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

        let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return output.isEmpty ? nil : output
    }

    private static func searchInPath(_ command: String, pathValue: String) -> String? {
        let fm = FileManager.default
        for directory in splitPath(pathValue) {
            let expanded = expandHome(directory)
            let candidate = URL(fileURLWithPath: expanded, isDirectory: true)
                .appendingPathComponent(command, isDirectory: false)
                .path
            if fm.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        return nil
    }

    private static func splitPath(_ value: String) -> [String] {
        value
            .split(separator: ":")
            .map(String.init)
            .map(expandHome)
            .filter { !$0.isEmpty }
    }

    private static func deduplicate(_ values: [String]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for value in values {
            if seen.insert(value).inserted {
                result.append(value)
            }
        }
        return result
    }
}
