import AppKit
import SwiftUI

struct DiagnosticsView: View {
    @ObservedObject var model: NimbusAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            GroupBox("Resumen") {
                HStack(spacing: 12) {
                    ForEach(NimbusBot.allCases) { bot in
                        summaryCard(for: bot)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            TabView {
                ForEach(NimbusBot.allCases) { bot in
                    diagnosticsPane(for: bot)
                        .tabItem { Label(bot.label, systemImage: bot == .codex ? "bolt.circle" : "sparkles") }
                }
            }
        }
        .padding(16)
        .frame(minWidth: 760, minHeight: 560)
    }

    private func summaryCard(for bot: NimbusBot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: model.statusIconName(for: bot))
                    .foregroundStyle(model.statusColor(for: bot))
                Text(bot.label)
                    .font(.headline)
            }
            Text(model.runState(for: bot).label)
                .font(.subheadline)
            Text(model.preflightSummary(for: bot))
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(model.hasToken(bot) ? "Token configurado" : "Falta token")
                .font(.caption2)
                .foregroundStyle(model.hasToken(bot) ? .green : .orange)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func diagnosticsPane(for bot: NimbusBot) -> some View {
        let report = model.preflight(for: bot)

        return VStack(alignment: .leading, spacing: 12) {
            GroupBox("Estado") {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Proceso: \(model.runState(for: bot).label)")
                    Text("Última línea: \(model.latestLogLine(for: bot))")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if !report.errors.isEmpty {
                        Text("Errores preflight:")
                            .font(.headline)
                        ForEach(report.errors, id: \.self) { item in
                            Text("• \(item)")
                                .foregroundStyle(.red)
                        }
                    }

                    if !report.warnings.isEmpty {
                        Text("Warnings:")
                            .font(.headline)
                        ForEach(report.warnings, id: \.self) { item in
                            Text("• \(item)")
                                .foregroundStyle(.orange)
                        }
                    }

                    if !report.details.isEmpty {
                        Text("Detalles:")
                            .font(.headline)
                        ForEach(report.details, id: \.self) { item in
                            Text("• \(item)")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            GroupBox("Logs") {
                ScrollView {
                    Text(model.logs(for: bot).joined(separator: "\n"))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .font(.system(.caption, design: .monospaced))
                        .padding(8)
                }
            }

            HStack {
                Button("Refrescar preflight") {
                    model.refreshPreflight(for: bot)
                }
                Spacer()
                Button("Copiar diagnóstico") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(model.diagnosticsText(for: bot), forType: .string)
                }
            }
        }
    }
}
