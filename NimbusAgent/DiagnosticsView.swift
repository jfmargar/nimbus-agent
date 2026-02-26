import AppKit
import SwiftUI

struct DiagnosticsView: View {
    @ObservedObject var model: NimbusAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            GroupBox("Estado") {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Proceso: \(model.runState.label)")

                    if !model.preflight.errors.isEmpty {
                        Text("Errores preflight:")
                            .font(.headline)
                        ForEach(model.preflight.errors, id: \.self) { item in
                            Text("• \(item)")
                                .foregroundStyle(.red)
                        }
                    }

                    if !model.preflight.warnings.isEmpty {
                        Text("Warnings:")
                            .font(.headline)
                        ForEach(model.preflight.warnings, id: \.self) { item in
                            Text("• \(item)")
                                .foregroundStyle(.orange)
                        }
                    }

                    if !model.preflight.details.isEmpty {
                        Text("Detalles:")
                            .font(.headline)
                        ForEach(model.preflight.details, id: \.self) { item in
                            Text("• \(item)")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            GroupBox("Logs") {
                ScrollView {
                    Text(model.logs.joined(separator: "\n"))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .font(.system(.caption, design: .monospaced))
                        .padding(8)
                }
            }

            HStack {
                Button("Refrescar preflight") {
                    model.refreshPreflight()
                }
                Spacer()
                Button("Copiar diagnóstico") {
                    let payload = (["Estado: \(model.runState.label)"] + model.preflight.errors + model.preflight.warnings + model.preflight.details + model.logs)
                        .joined(separator: "\n")
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(payload, forType: .string)
                }
            }
        }
        .padding(16)
        .frame(minWidth: 700, minHeight: 520)
    }
}
