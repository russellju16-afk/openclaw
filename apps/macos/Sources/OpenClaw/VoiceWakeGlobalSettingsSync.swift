import Foundation
import OpenClawKit
import OSLog

@MainActor
final class VoiceWakeGlobalSettingsSync {
    static let shared = VoiceWakeGlobalSettingsSync()

    private let logger = Logger(subsystem: "ai.openclaw", category: "voicewake.sync")
    private var task: Task<Void, Never>?

    private struct VoiceWakePayload: Codable, Equatable {
        let triggers: [String]
        let triggerAgentMap: [String: String]?
    }

    func start() {
        SimpleTaskSupport.start(task: &self.task) { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                do {
                    try await GatewayConnection.shared.refresh()
                } catch {
                    // Not configured / not reachable yet.
                }

                await self.refreshFromGateway()

                let stream = await GatewayConnection.shared.subscribe(bufferingNewest: 200)
                for await push in stream {
                    if Task.isCancelled { return }
                    await self.handle(push: push)
                }

                // If the stream finishes (gateway shutdown / reconnect), loop and resubscribe.
                try? await Task.sleep(nanoseconds: 600_000_000)
            }
        }
    }

    func stop() {
        SimpleTaskSupport.stop(task: &self.task)
    }

    private func refreshFromGateway() async {
        do {
            let config = try await GatewayConnection.shared.voiceWakeGetConfig()
            AppStateStore.shared.applyGlobalVoiceWakeConfig(
                triggers: config.triggers,
                triggerAgentMap: config.triggerAgentMap ?? [:])
        } catch {
            // Best-effort only.
        }
    }

    func handle(push: GatewayPush) async {
        guard case let .event(evt) = push else { return }
        guard evt.event == "voicewake.changed" else { return }
        guard let payload = evt.payload else { return }
        do {
            let decoded = try GatewayPayloadDecoding.decode(payload, as: VoiceWakePayload.self)
            AppStateStore.shared.applyGlobalVoiceWakeConfig(
                triggers: decoded.triggers,
                triggerAgentMap: decoded.triggerAgentMap ?? [:])
        } catch {
            self.logger.error("failed to decode voicewake.changed: \(error.localizedDescription, privacy: .public)")
        }
    }
}
