import Foundation
import Security

final class SecretsStore {
    private let service = "com.jfmargar.nimbus.NimbusAgent"
    private let legacyAccount = "TELEGRAM_BOT_TOKEN"

    func readTelegramToken(for bot: NimbusBot) -> String {
        let token = readToken(account: bot.tokenKeychainAccount)
        if !token.isEmpty {
            return token
        }
        if bot == .codex {
            return readToken(account: legacyAccount)
        }
        return ""
    }

    func migrateLegacyCodexTokenIfNeeded() throws {
        let current = readToken(account: NimbusBot.codex.tokenKeychainAccount)
        if !current.isEmpty {
            return
        }
        let legacy = readToken(account: legacyAccount)
        if legacy.isEmpty {
            return
        }
        try saveTelegramToken(legacy, for: .codex)
        _ = deleteToken(account: legacyAccount)
    }

    func saveTelegramToken(_ token: String, for bot: NimbusBot) throws {
        try saveToken(token, account: bot.tokenKeychainAccount)
    }

    @discardableResult
    func deleteTelegramToken(for bot: NimbusBot) -> Bool {
        deleteToken(account: bot.tokenKeychainAccount)
    }

    private func readToken(account: String) -> String {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8)
        else {
            return ""
        }

        return value
    }

    private func saveToken(_ token: String, account: String) throws {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            _ = deleteToken(account: account)
            return
        }

        guard let data = trimmed.data(using: .utf8) else {
            throw NSError(domain: "NimbusSecrets", code: 1, userInfo: [NSLocalizedDescriptionKey: "No se pudo codificar el token."])
        }

        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account
        ]

        let attributes: [CFString: Any] = [
            kSecValueData: data
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }

        if updateStatus == errSecItemNotFound {
            var addQuery = query
            addQuery[kSecValueData] = data
            addQuery[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlock

            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            if addStatus == errSecSuccess {
                return
            }

            throw NSError(domain: "NimbusSecrets", code: Int(addStatus), userInfo: [NSLocalizedDescriptionKey: "No se pudo guardar el token en Keychain (status=\(addStatus))."])
        }

        throw NSError(domain: "NimbusSecrets", code: Int(updateStatus), userInfo: [NSLocalizedDescriptionKey: "No se pudo actualizar el token en Keychain (status=\(updateStatus))."])
    }

    @discardableResult
    private func deleteToken(account: String) -> Bool {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account
        ]

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
