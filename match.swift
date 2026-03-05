import Foundation
let str = "session id:\u{1b}[0m \u{1b}[36m019cb8da-bac7-71c2-835f-2efefa1027c2\u{1b}[0m"
let pattern = "session id.*?([0-9a-fA-F-]{36})"
if let regex = try? NSRegularExpression(pattern: pattern, options: []),
   let match = regex.firstMatch(in: str, range: NSRange(str.startIndex..., in: str)) {
    let range = match.range(at: 1)
    let uuid = (str as NSString).substring(with: range)
    print("UUID FOUND: \(uuid)")
} else {
    print("NOT FOUND")
}
