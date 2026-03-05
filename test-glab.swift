import Foundation

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

let json = """
[{"iid":8195,"title":"test","web_url":"http://url","labels":["a"],"created_at":"date","updated_at":"date","references":{"full":"test/me#1"}}]
"""
let decoder = JSONDecoder()
let res = try! decoder.decode([GitLabIssue].self, from: json.data(using: .utf8)!)
print(res)
