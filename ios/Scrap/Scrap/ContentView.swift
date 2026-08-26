import SwiftUI

struct ContentView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Capture") {
                    HStack(spacing: 12) {
                        Image(systemName: "square.and.arrow.down")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                            .frame(width: 30)

                        VStack(alignment: .leading, spacing: 3) {
                            Text("Share Extension")
                            Text("Ready")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                }

                Section {
                    Link(destination: URL(string: "http://Priyaas-MacBook-Pro.local:8790")!) {
                        Label("Open Museum", systemImage: "safari")
                    }
                }
            }
            .navigationTitle("Scrap")
        }
    }
}
