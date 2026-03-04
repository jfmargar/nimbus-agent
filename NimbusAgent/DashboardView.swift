import AppKit
import SwiftUI

struct DashboardView: View {
    @ObservedObject var model: NimbusAppModel
    @Environment(\.openURL) private var openURL
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header

            HStack(alignment: .top, spacing: 16) {
                issuesPane
                logsPane
            }
        }
        .padding(16)
        .frame(minWidth: 1180, minHeight: 720)
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Orchestrator")
                    .font(.largeTitle.weight(.semibold))
                Text(model.dashboardStatusMessage)
                    .foregroundStyle(.secondary)
                Text(summaryLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 8) {
                Button(model.dashboardIsRefreshing ? "Escaneando..." : "Refrescar") {
                    model.refreshDashboardIssues()
                }
                .disabled(model.dashboardIsRefreshing)

                Button("Abrir configuración") {
                    openWindow(id: "settings")
                }
            }
        }
    }

    private var issuesPane: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Issues detectados")
                .font(.headline)

            if model.dashboardIssues.isEmpty {
                ContentUnavailableView(
                    "Sin issues",
                    systemImage: "tray",
                    description: Text("Configura los targets y labels del dashboard, luego ejecuta un refresco.")
                )
            } else {
                List(model.dashboardIssues) { issue in
                    issueRow(issue)
                        .padding(.vertical, 6)
                }
                .listStyle(.inset)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var logsPane: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Ejecuciones")
                    .font(.headline)
                Spacer()
                Button("Copiar logs") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(model.dashboardLogs.joined(separator: "\n"), forType: .string)
                }
            }

            ScrollView {
                Text(model.dashboardLogs.joined(separator: "\n"))
                    .font(.system(.caption, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding(10)
            }
            .background(Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .frame(width: 420)
        .frame(maxHeight: .infinity)
    }

    @ViewBuilder
    private func issueRow(_ issue: DashboardIssue) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("#\(issue.number) \(issue.title)")
                        .font(.headline)
                    Text("\(issue.platform.label) · \(issue.repository)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let localPath = issue.localPath, !localPath.isEmpty {
                        Text(localPath)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    } else {
                        Text("Sin checkout local resuelto")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                }

                Spacer()

                if let updatedAt = issue.updatedAt {
                    Text(relativeDate(updatedAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if !issue.labels.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(issue.labels, id: \.self) { label in
                            Text(label)
                                .font(.caption2.weight(.medium))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.accentColor.opacity(0.12))
                                .clipShape(Capsule())
                        }
                    }
                }
            }

            HStack(spacing: 8) {
                Button("Abrir issue") {
                    if let url = URL(string: issue.url) {
                        openURL(url)
                    }
                }

                Button("Abrir repo") {
                    if let localPath = issue.localPath, !localPath.isEmpty {
                        NSWorkspace.shared.open(URL(fileURLWithPath: localPath, isDirectory: true))
                    }
                }
                .disabled(issue.localPath?.isEmpty != false)

                actionButton("Codex", status: model.dashboardActionStatus(for: issue, actionID: "codex")) {
                    model.runCodex(for: issue)
                }
                .disabled(issue.localPath?.isEmpty != false)

                ForEach(model.dashboardAutomationActions()) { action in
                    actionButton(action.label, status: model.dashboardActionStatus(for: issue, actionID: action.id)) {
                        model.runAutomation(action, for: issue)
                    }
                    .disabled(issue.localPath?.isEmpty != false)
                }
            }
        }
        .padding(12)
        .background(Color.secondary.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func actionButton(
        _ title: String,
        status: DashboardActionStatus,
        action: @escaping () -> Void
    ) -> some View {
        Button(title, action: action)
            .disabled({
                if case .running = status {
                    return true
                }
                return false
            }())
            .help(status.label)
            .overlay(alignment: .topTrailing) {
                switch status {
                case .idle:
                    EmptyView()
                case .running:
                    ProgressView()
                        .controlSize(.small)
                        .offset(x: 10, y: -10)
                case .succeeded:
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .offset(x: 10, y: -10)
                case .failed:
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .offset(x: 10, y: -10)
                }
            }
    }

    private var summaryLine: String {
        let targetCount = model.dashboardLocalRepositories.count
        let labels = model.settings.dashboardIssueLabelsList
        let refreshedAt = model.dashboardLastRefresh.map(relativeDate) ?? "sin refresco"
        return "\(targetCount) repo(s) local(es) · labels: \(labels.joined(separator: ", ")) · último refresco: \(refreshedAt)"
    }

    private func relativeDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
