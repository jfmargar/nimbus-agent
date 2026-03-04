import SwiftUI
import AppKit

struct NimbusMenuView: View {
    @ObservedObject var model: NimbusAppModel
    @Environment(\.openWindow) private var openWindow

    private func bringAppToFrontAndOpenWindow(id: String) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        openWindow(id: id)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Nimbus")
                .font(.headline)

            Text(model.overallRunStateLabel)
                .font(.caption)
                .foregroundStyle(.secondary)

            ForEach(NimbusBot.allCases) { bot in
                GroupBox {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .center, spacing: 8) {
                            Image(systemName: model.statusIconName(for: bot))
                                .foregroundStyle(model.statusColor(for: bot))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(bot.label)
                                    .font(.subheadline.weight(.semibold))
                                Text(model.runState(for: bot).label)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(model.hasToken(bot) ? "Token OK" : "Sin token")
                                .font(.caption2.weight(.medium))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background((model.hasToken(bot) ? Color.green : Color.secondary).opacity(0.12))
                                .foregroundStyle(model.hasToken(bot) ? .green : .secondary)
                                .clipShape(Capsule())
                        }

                        Text(model.preflightSummary(for: bot))
                            .font(.caption)
                            .foregroundStyle(model.statusColor(for: bot))

                        HStack {
                            Button("Iniciar") {
                                model.startBot(bot)
                            }
                            .disabled(!model.canStart(bot))

                            Button("Detener") {
                                model.stopBot(bot)
                            }
                            .disabled(!model.canStop(bot))
                        }
                    }
                }
            }

            Divider()

            HStack {
                Button("Iniciar ambos") {
                    model.startAllBots()
                }
                .disabled(!model.canStartAnyBot)

                Button("Detener ambos") {
                    model.stopAllBots()
                }
                .disabled(!model.canStopAnyBot)
            }

            Button("Configuración") {
                bringAppToFrontAndOpenWindow(id: "settings")
            }

            Button("Dashboard") {
                bringAppToFrontAndOpenWindow(id: "dashboard")
            }

            Button("Ver diagnóstico") {
                bringAppToFrontAndOpenWindow(id: "diagnostics")
            }

            Divider()

            Button("Salir Nimbus") {
                NSApplication.shared.terminate(nil)
            }
        }
        .padding(12)
        .frame(minWidth: 300)
    }
}

@main
struct NimbusAgentApp: App {
    @StateObject private var model = NimbusAppModel()

    var body: some Scene {
        MenuBarExtra("Nimbus", systemImage: model.overallIconName) {
            NimbusMenuView(model: model)
        }
        .menuBarExtraStyle(.window)

        Window("Configuración", id: "settings") {
            SettingsView(model: model)
                .onAppear {
                    NSApp.setActivationPolicy(.regular)
                    NSApp.activate(ignoringOtherApps: true)
                }
        }
        .defaultSize(width: 700, height: 560)

        Window("Dashboard", id: "dashboard") {
            DashboardView(model: model)
                .onAppear {
                    NSApp.setActivationPolicy(.regular)
                    NSApp.activate(ignoringOtherApps: true)
                }
        }
        .defaultSize(width: 1180, height: 720)

        Window("Diagnóstico", id: "diagnostics") {
            DiagnosticsView(model: model)
                .onAppear {
                    NSApp.setActivationPolicy(.regular)
                    NSApp.activate(ignoringOtherApps: true)
                }
        }
        .defaultSize(width: 760, height: 560)
    }
}
