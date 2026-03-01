import SwiftUI

struct NimbusMenuView: View {
    @ObservedObject var model: NimbusAppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Nimbus")
                .font(.headline)

            Text(model.overallRunStateLabel)
                .font(.caption)
                .foregroundStyle(.secondary)

            Divider()

            ForEach(NimbusBot.allCases) { bot in
                VStack(alignment: .leading, spacing: 6) {
                    Text(bot.label)
                        .font(.subheadline.weight(.semibold))
                    Text(model.runState(for: bot).label)
                        .font(.caption)
                        .foregroundStyle(.secondary)

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

                if bot != NimbusBot.allCases.last {
                    Divider()
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
                openWindow(id: "settings")
            }

            Button("Ver diagnóstico") {
                openWindow(id: "diagnostics")
            }

            Divider()

            Button("Salir Nimbus") {
                NSApplication.shared.terminate(nil)
            }
        }
        .padding(12)
        .frame(minWidth: 280)
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
        }
        .defaultSize(width: 700, height: 560)

        Window("Diagnóstico", id: "diagnostics") {
            DiagnosticsView(model: model)
        }
        .defaultSize(width: 760, height: 560)
    }
}
