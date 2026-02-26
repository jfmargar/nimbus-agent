import Foundation

enum ShellResolver {
    private static let commonPaths = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin"
    ]

    static func resolveCommandPath(_ command: String) -> String? {
        if let found = searchInPath(command, pathValue: ProcessInfo.processInfo.environment["PATH"] ?? "") {
            return found
        }

        if let shellFound = runShellCommand(["-lc", "command -v \(command)"]) {
            return shellFound
        }

        return searchInPath(command, pathValue: commonPaths.joined(separator: ":"))
    }

    static func mergedPathValue() -> String {
        let current = splitPath(ProcessInfo.processInfo.environment["PATH"] ?? "")
        let shellPath = splitPath(runShellCommand(["-lc", "echo -n $PATH"]) ?? "")
        let merged = deduplicate(current + shellPath + commonPaths)
        return merged.joined(separator: ":")
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
            let candidate = URL(fileURLWithPath: directory, isDirectory: true)
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
