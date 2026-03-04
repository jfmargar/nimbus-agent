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

            dashboardTab
                .tabItem { Label("Dashboard", systemImage: "square.grid.2x2") }

            diagnosticsTab
                .tabItem { Label("Diagnóstico", systemImage: "stethoscope") }
        }
        .padding(16)
        .frame(minWidth: 620, minHeight: 460)
    }

    private var generalTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    tokenStatusCard(for: .codex)
                    tokenStatusCard(for: .gemini)
                }

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
    }

    private var advancedTab: some View {
        ScrollView {
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

    private var dashboardTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Form {
                    Section("Targets de escaneo") {
                        Text("Selecciona una o varias carpetas raíz. Nimbus descubrirá repos git dentro de ellas, resolverá GitHub o GitLab desde `origin` y usará esos checkouts para escanear y ejecutar acciones.")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        HStack {
                            Button("Añadir raíces") {
                                model.pickDashboardRootDirectories()
                            }

                            Button("Añadir repos") {
                                model.pickDashboardRepositories()
                            }

                            Button("Refrescar lista") {
                                model.refreshDashboardRepositoryCatalog()
                            }
                        }

                        if model.settings.dashboardRootDirectoryPathsList().isEmpty {
                            Text("No hay carpetas raíz seleccionadas.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(model.settings.dashboardRootDirectoryPathsList(), id: \.self) { path in
                                HStack(alignment: .top) {
                                    Text(path)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .textSelection(.enabled)
                                        .lineLimit(2)
                                    Spacer()
                                    Button("Quitar") {
                                        model.removeDashboardRootDirectory(path)
                                    }
                                }
                            }
                        }

                        dashboardRepositorySummary
                    }

                    Section("Labels IA") {
                        TextField("ai, codex, agent", text: $model.settings.dashboardAILabels)
                            .textFieldStyle(.roundedBorder)
                        Text("El escáner hace unión por label: si una issue tiene cualquiera de estas etiquetas, aparece en el panel.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Section("Codex") {
                        TextField("Comando Codex", text: $model.settings.dashboardCodexCommandTemplate)
                            .textFieldStyle(.roundedBorder)
                        TextEditor(text: $model.settings.dashboardCodexPromptTemplate)
                            .font(.system(.body, design: .monospaced))
                            .frame(minHeight: 140)
                        Text("Placeholders: `{repo}`, `{repo_path}`, `{issue_number}`, `{issue_title}`, `{issue_url}`, `{issue_labels}`, `{codex_prompt}`.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Section("Automatizaciones") {
                        Text("Una línea por acción: `Etiqueta::comando`. Los comandos aceptan `{repo}`, `{repo_path}`, `{issue_number}`, `{issue_title}`, `{issue_url}` y `{issue_labels}`.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextEditor(text: $model.settings.dashboardAutomationActions)
                            .font(.system(.body, design: .monospaced))
                            .frame(minHeight: 120)
                    }
                }

                HStack {
                    Button("Probar escaneo") {
                        model.saveConfiguration()
                        model.refreshDashboardIssues()
                    }

                    Spacer()
                }

                actionRow
            }
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

    private var dashboardRepositorySummary: some View {
        let manualPaths = Set(model.settings.dashboardLocalRepositoryPathsList())
        let manualRepositories = model.dashboardLocalRepositories.filter { manualPaths.contains($0.localPath) }
        let detectedCount = model.dashboardLocalRepositories.count

        return VStack(alignment: .leading, spacing: 6) {
            Text("Repos disponibles para escaneo: \(detectedCount)")
                .font(.caption.weight(.medium))

            if !manualRepositories.isEmpty {
                Text("Repos añadidos manualmente: \(manualRepositories.count)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if detectedCount > 0 {
                Text("Los repos autodetectados bajo las raíces no se listan aquí para mantener la ventana compacta.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func tokenStatusCard(for bot: NimbusBot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: model.statusIconName(for: bot))
                    .foregroundStyle(model.statusColor(for: bot))
                Text(bot.label)
                    .font(.headline)
            }
            Text(model.hasToken(bot) ? "Token configurado" : "Token pendiente")
                .font(.subheadline)
            Text(model.preflightSummary(for: bot))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
