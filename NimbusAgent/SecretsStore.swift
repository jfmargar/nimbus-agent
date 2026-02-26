import Foundation
import Security

final class SecretsStore {
    private let service = "com.jfmargar.nimbus.NimbusAgent"
    private let account = "TELEGRAM_BOT_TOKEN"

    func readTelegramToken() -> String {
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

    func saveTelegramToken(_ token: String) throws {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            _ = deleteTelegramToken()
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
    func deleteTelegramToken() -> Bool {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account
        ]

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
