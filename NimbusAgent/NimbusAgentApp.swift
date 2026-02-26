import SwiftUI

struct NimbusMenuView: View {
    @ObservedObject var model: NimbusAppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Nimbus")
                .font(.headline)

            Text(model.runState.label)
                .font(.caption)
                .foregroundStyle(.secondary)

            Divider()

            Button("Iniciar agente") {
                model.startAgent()
            }
            .disabled(!model.canStart)

            Button("Detener agente") {
                model.stopAgent()
            }
            .disabled({
                if case .running = model.runState { return false }
                if case .starting = model.runState { return false }
                return true
            }())

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
        .frame(minWidth: 250)
    }
}

@main
struct NimbusAgentApp: App {
    @StateObject private var model = NimbusAppModel()

    var body: some Scene {
        MenuBarExtra("Nimbus", systemImage: model.runState.iconName) {
            NimbusMenuView(model: model)
        }
        .menuBarExtraStyle(.window)

        Window("Configuración", id: "settings") {
            SettingsView(model: model)
        }
        .defaultSize(width: 680, height: 520)

        Window("Diagnóstico", id: "diagnostics") {
            DiagnosticsView(model: model)
        }
        .defaultSize(width: 760, height: 560)
    }
}
