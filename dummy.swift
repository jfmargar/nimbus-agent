import Foundation
let pattern = "(?i)session id.*?([0-9a-fA-F-]{36})"
let regex = try! NSRegularExpression(pattern: pattern)
let chunk = "\u{1b}[38;5;2m✔ session id\u{1b}[0m \u{1b}[38;5;8m8f86f87d-419b-4394-bb9f-aba942159114\u{1b}[0m"
if let match = regex.firstMatch(in: chunk, range: NSRange(chunk.startIndex..., in: chunk)),
   let range = Range(match.range(at: 1), in: chunk) {
    print("MATCH: \(String(chunk[range]))")
} else {
    print("NO MATCH")
}
