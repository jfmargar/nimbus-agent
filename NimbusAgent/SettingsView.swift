import AppKit
import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: NimbusAppModel

    var body: some View {
        TabView {
            generalTab
                .tabItem { Label("General", systemImage: "gearshape") }

            advancedTab
                .tabItem { Label("Avanzado", systemImage: "slider.horizontal.3") }

            diagnosticsTab
                .tabItem { Label("Diagnóstico", systemImage: "stethoscope") }
        }
        .padding(16)
        .frame(minWidth: 620, minHeight: 460)
    }

    private var generalTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            Form {
                Section("Bots") {
                    SecureField("Telegram Bot Token (Codex)", text: $model.codexToken)
                    SecureField("Telegram Bot Token (Gemini)", text: $model.geminiToken)
                }

                Section("Compartido") {
                    TextField("ALLOWED_USERS (CSV)", text: $model.settings.allowedUsers)
                        .textFieldStyle(.roundedBorder)

                    Toggle("AIPAL_DROP_PENDING_UPDATES", isOn: $model.settings.dropPendingUpdates)

                    HStack {
                        TextField("AIPAL_AGENT_CWD", text: $model.settings.agentCwd)
                            .textFieldStyle(.roundedBorder)
                        Button("Seleccionar carpeta") {
                            model.pickAgentDirectory()
                        }
                    }
                }
            }

            Text("Cada token se guarda en Keychain. El resto en settings.json de Nimbus. Los bots comparten usuarios permitidos y ajustes avanzados.")
                .font(.caption)
                .foregroundStyle(.secondary)

            actionRow
        }
    }

    private var advancedTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            Form {
                TextField("AIPAL_WHISPER_CMD", text: $model.settings.whisperCmd)

                Picker("AIPAL_CODEX_APPROVAL_MODE", selection: $model.settings.codexApprovalMode) {
                    Text("never").tag("never")
                    Text("on-request").tag("on-request")
                    Text("on-failure").tag("on-failure")
                    Text("untrusted").tag("untrusted")
                }

                Picker("AIPAL_CODEX_SANDBOX_MODE", selection: $model.settings.codexSandboxMode) {
                    Text("read-only").tag("read-only")
                    Text("workspace-write").tag("workspace-write")
                    Text("danger-full-access").tag("danger-full-access")
                }

                Toggle("AIPAL_CODEX_PROGRESS_UPDATES", isOn: $model.settings.codexProgressUpdates)

                TextField("AIPAL_SCRIPT_TIMEOUT_MS", value: $model.settings.scriptTimeoutMs, format: .number)
                TextField("AIPAL_AGENT_TIMEOUT_MS", value: $model.settings.agentTimeoutMs, format: .number)
                TextField("AIPAL_AGENT_MAX_BUFFER", value: $model.settings.agentMaxBuffer, format: .number)
                TextField("AIPAL_MEMORY_CURATE_EVERY", value: $model.settings.memoryCurateEvery, format: .number)
                TextField("AIPAL_MEMORY_RETRIEVAL_LIMIT", value: $model.settings.memoryRetrievalLimit, format: .number)
                TextField("AIPAL_SHUTDOWN_DRAIN_TIMEOUT_MS", value: $model.settings.shutdownDrainTimeoutMs, format: .number)
            }

            actionRow
        }
    }

    private var diagnosticsTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.overallRunStateLabel)
                .font(.subheadline)

            ForEach(NimbusBot.allCases) { bot in
                GroupBox(bot.label) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(model.runState(for: bot).label)
                        Text(model.logs(for: bot).suffix(6).joined(separator: "\n"))
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            HStack {
                Button("Refrescar") {
                    model.refreshAllPreflight()
                }
                Spacer()
                Button("Copiar diagnóstico") {
                    let payload = NimbusBot.allCases
                        .map { model.diagnosticsText(for: $0) }
                        .joined(separator: "\n\n")
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(payload, forType: .string)
                }
            }

            actionRow
        }
    }

    private var actionRow: some View {
        HStack {
            Button("Validar") {
                model.refreshAllPreflight()
            }

            Button("Guardar") {
                model.saveConfiguration()
            }
            .keyboardShortcut("s", modifiers: [.command])

            Spacer()

            if !model.settingsStatusMessage.isEmpty {
                Text(model.settingsStatusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
