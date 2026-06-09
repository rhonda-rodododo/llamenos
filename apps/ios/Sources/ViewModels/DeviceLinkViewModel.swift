import Foundation
import AVFoundation

// MARK: - ZeroizableSecret

/// A mutable byte buffer for sensitive key material that can be explicitly zeroed.
/// Swift Strings are immutable and may leave copies in memory; this wrapper uses
/// a contiguous `[UInt8]` array that is overwritten with zeros on `zeroize()`.
final class ZeroizableSecret {
    private var bytes: [UInt8]

    init(hex: String) {
        self.bytes = Array(hex.utf8)
    }

    /// The secret as a hex String. Returns a new String each time — callers should
    /// avoid caching the result and let it go out of scope quickly.
    var hexString: String {
        String(bytes: bytes, encoding: .utf8) ?? ""
    }

    /// Overwrite stored bytes with zeros to prevent memory remnants.
    func zeroize() {
        for i in bytes.indices {
            bytes[i] = 0
        }
    }

    deinit {
        zeroize()
    }
}

// MARK: - DeviceLinkStep

/// Steps in the device linking flow.
enum DeviceLinkStep: Equatable {
    /// Waiting for the user to scan a QR code.
    case scanning
    /// Connecting to the provisioning room on the relay.
    case connecting
    /// Verifying identity via SAS code.
    case verifying(sasCode: String)
    /// Importing the decrypted nsec.
    case importing
    /// Successfully linked.
    case completed
    /// An error occurred.
    case error(String)
}

// MARK: - DeviceLinkViewModel

/// View model for the device linking flow. Handles QR code scanning, Nostr relay
/// ephemeral ECDH key exchange, SAS verification, and nsec import.
///
/// Protocol flow:
/// 1. Desktop generates a provisioning room ID and relay URL, encodes in QR.
/// 2. Mobile scans QR, connects to relay, joins the provisioning room.
/// 3. Both sides generate ephemeral ECDH keypairs and exchange public keys.
/// 4. Both derive the same shared secret and SAS code for visual verification.
/// 5. User confirms SAS codes match on both devices.
/// 6. Desktop encrypts the nsec with the shared secret and sends it.
/// 7. Mobile decrypts the nsec and imports it into CryptoService.
@Observable
final class DeviceLinkViewModel {
    private let cryptoService: CryptoService
    private let authService: AuthService
    private let keychainService: KeychainService

    // MARK: - Public State

    /// Current step in the linking flow.
    var currentStep: DeviceLinkStep = .scanning

    /// Whether camera access has been granted.
    var hasCameraPermission: Bool = false

    /// Whether the user confirmed the SAS code match.
    var sasConfirmed: Bool = false

    /// Error message for the current step.
    var errorMessage: String?

    // MARK: - Private State

    /// The provisioning room ID from the QR code.
    private var provisioningRoomId: String?

    /// The relay URL from the QR code.
    private var relayURL: String?

    /// Our ephemeral keypair for this linking session.
    /// Uses ZeroizableSecret for the private key to prevent memory remnants (MS-2).
    private var ephemeralSecret: ZeroizableSecret?
    private var ephemeralPublic: String?

    /// The other device's ephemeral public key.
    private var theirEphemeralPublic: String?

    /// The derived shared secret. Zeroizable to prevent memory remnants (MS-2).
    private var sharedSecret: ZeroizableSecret?

    /// Encrypted nsec received before SAS confirmation (H4).
    /// Held pending until the user confirms SAS codes match.
    /// Zeroizable because it contains encrypted key material (MS-2).
    private var pendingEncryptedNsec: ZeroizableSecret?

    /// WebSocket task for the provisioning relay connection.
    private var webSocketTask: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var session: URLSession

    // MARK: - Initialization

    init(cryptoService: CryptoService, authService: AuthService, keychainService: KeychainService) {
        self.cryptoService = cryptoService
        self.authService = authService
        self.keychainService = keychainService
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: config)
    }

    // MARK: - Camera Permission

    /// Request camera access for QR code scanning.
    func requestCameraPermission() async {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized:
            hasCameraPermission = true
        case .notDetermined:
            hasCameraPermission = await AVCaptureDevice.requestAccess(for: .video)
        case .denied, .restricted:
            hasCameraPermission = false
        @unknown default:
            hasCameraPermission = false
        }
    }

    // MARK: - QR Code Processing

    /// Process a scanned QR code string. Expected format:
    /// `llamenos-link://<relay-url>/<room-id>`
    func processQRCode(_ code: String) {
        guard code.hasPrefix("llamenos-link://") else {
            currentStep = .error(NSLocalizedString(
                "device_link_invalid_qr",
                comment: "Invalid QR code. Scan the code shown on your desktop app."
            ))
            return
        }

        let payload = String(code.dropFirst("llamenos-link://".count))
        let parts = payload.split(separator: "/", maxSplits: 1)

        guard parts.count == 2 else {
            currentStep = .error(NSLocalizedString(
                "device_link_invalid_format",
                comment: "QR code format is invalid."
            ))
            return
        }

        // First part is the relay URL (may contain path), last component is room ID
        let fullPath = String(payload)
        guard let lastSlash = fullPath.lastIndex(of: "/") else {
            currentStep = .error(NSLocalizedString(
                "device_link_invalid_format",
                comment: "QR code format is invalid."
            ))
            return
        }

        let relayPart = String(fullPath[fullPath.startIndex..<lastSlash])
        let roomId = String(fullPath[fullPath.index(after: lastSlash)...])

        // H5: Validate the relay host to prevent SSRF to internal networks
        // Extract the host portion (strip port if present)
        let hostPart = relayPart.split(separator: "/").first.map(String.init) ?? relayPart
        let hostOnly = hostPart.split(separator: ":").first.map(String.init) ?? hostPart
        guard Self.isValidRelayHost(hostOnly) else {
            currentStep = .error(NSLocalizedString(
                "device_link_private_relay",
                comment: "The relay URL points to a private or local network address. This is not allowed for security reasons."
            ))
            return
        }

        relayURL = "wss://\(relayPart)"
        provisioningRoomId = roomId

        // Start the connection
        Task {
            await connectToProvisioningRoom()
        }
    }

    // MARK: - Provisioning Room Connection

    /// Connect to the relay and join the provisioning room for ECDH exchange.
    private func connectToProvisioningRoom() async {
        currentStep = .connecting

        guard let urlString = relayURL, let url = URL(string: urlString) else {
            currentStep = .error(NSLocalizedString(
                "device_link_invalid_relay",
                comment: "Invalid relay URL."
            ))
            return
        }

        // Generate our ephemeral keypair (MS-2: secret stored as zeroizable bytes)
        let keypair = cryptoService.generateEphemeralKeypair()
        ephemeralSecret = ZeroizableSecret(hex: keypair.secretHex)
        ephemeralPublic = keypair.publicHex

        // Connect to the relay
        let task = session.webSocketTask(with: url)
        webSocketTask = task
        task.resume()

        // Subscribe to provisioning room events
        guard let roomId = provisioningRoomId else { return }

        let subscriptionId = "link-\(UUID().uuidString.prefix(8))"
        let reqMessage = """
        ["REQ","\(subscriptionId)",{"kinds":[20001],"#t":["llamenos:provision-\(roomId)"]}]
        """

        do {
            try await task.send(.string(reqMessage))
        } catch {
            currentStep = .error(NSLocalizedString(
                "device_link_connect_failed",
                comment: "Failed to connect to relay."
            ))
            return
        }

        // Send our ephemeral public key to the room
        guard let pubKey = ephemeralPublic else { return }
        let eventContent = """
        {"type":"ephemeral-pubkey","pubkey":"\(pubKey)"}
        """
        let eventMessage = """
        ["EVENT",{"kind":20001,"content":"\(eventContent.replacingOccurrences(of: "\"", with: "\\\""))","tags":[["t","llamenos:provision-\(roomId)"]],"created_at":\(Int(Date().timeIntervalSince1970))}]
        """

        do {
            try await task.send(.string(eventMessage))
        } catch {
            currentStep = .error(NSLocalizedString(
                "device_link_send_failed",
                comment: "Failed to send key exchange data."
            ))
            return
        }

        // Start receiving messages
        receiveTask = Task { [weak self] in
            await self?.receiveProvisioningMessages()
        }
    }

    // MARK: - Message Handling

    /// Receive and process messages from the provisioning room.
    private func receiveProvisioningMessages() async {
        guard let task = webSocketTask else { return }

        while !Task.isCancelled {
            do {
                let message = try await task.receive()
                switch message {
                case .string(let text):
                    await processProvisioningMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        await processProvisioningMessage(text)
                    }
                @unknown default:
                    break
                }
            } catch {
                if !Task.isCancelled {
                    await MainActor.run {
                        currentStep = .error(NSLocalizedString(
                            "device_link_connection_lost",
                            comment: "Connection to relay lost."
                        ))
                    }
                }
                return
            }
        }
    }

    /// Parse a relay message and handle provisioning events.
    @MainActor
    private func processProvisioningMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let array = try? JSONSerialization.jsonObject(with: data) as? [Any],
              let type = array.first as? String,
              type == "EVENT",
              array.count >= 3,
              let eventDict = array[2] as? [String: Any],
              let content = eventDict["content"] as? String else {
            return
        }

        // Parse the content JSON
        guard let contentData = content.data(using: .utf8),
              let contentObj = try? JSONSerialization.jsonObject(with: contentData) as? [String: Any],
              let messageType = contentObj["type"] as? String else {
            return
        }

        switch messageType {
        case "ephemeral-pubkey":
            // Received the other device's ephemeral public key
            guard let theirPubkey = contentObj["pubkey"] as? String else { return }
            theirEphemeralPublic = theirPubkey

            // Derive shared secret (MS-2: extract hex only for the API call, then discard)
            guard let ourSecret = ephemeralSecret else { return }
            do {
                let shared = try cryptoService.deriveSharedSecret(ourSecret: ourSecret.hexString, theirPublic: theirPubkey)
                sharedSecret = ZeroizableSecret(hex: shared)

                // Derive and display SAS code
                let sas = try cryptoService.deriveSASCode(sharedSecret: shared)
                currentStep = .verifying(sasCode: sas)
            } catch {
                currentStep = .error(error.localizedDescription)
                return
            }

        case "encrypted-nsec":
            // Received the encrypted nsec from the desktop.
            // H4: Gate import on SAS confirmation — do NOT import until the user
            // has confirmed the SAS codes match. This prevents MITM attacks.
            guard let encryptedNsec = contentObj["data"] as? String,
                  let shared = sharedSecret else {
                currentStep = .error(NSLocalizedString(
                    "device_link_decrypt_failed",
                    comment: "Failed to decrypt key data."
                ))
                return
            }

            if sasConfirmed {
                // SAS already confirmed — import immediately
                Task {
                    await importEncryptedNsec(encryptedNsec, sharedSecret: shared.hexString)
                }
            } else {
                // Hold the encrypted nsec until SAS is confirmed (MS-2: zeroizable)
                pendingEncryptedNsec = ZeroizableSecret(hex: encryptedNsec)
                if case .verifying = currentStep {
                    // Already showing SAS — user just needs to confirm
                } else {
                    currentStep = .error(NSLocalizedString(
                        "device_link_sas_required",
                        comment: "Key received but SAS verification is required first."
                    ))
                }
            }

        default:
            break
        }
    }

    // MARK: - SAS Confirmation

    /// Confirm the SAS code matches the desktop display.
    /// If an encrypted nsec was received before confirmation, imports it now (H4).
    func confirmSASCode() {
        sasConfirmed = true

        // Send confirmation to the other device
        guard let task = webSocketTask, let roomId = provisioningRoomId else { return }

        let confirmContent = "{\"type\":\"sas-confirmed\"}"
        let confirmMessage = """
        ["EVENT",{"kind":20001,"content":"\(confirmContent.replacingOccurrences(of: "\"", with: "\\\""))","tags":[["t","llamenos:provision-\(roomId)"]],"created_at":\(Int(Date().timeIntervalSince1970))}]
        """

        Task {
            try? await task.send(.string(confirmMessage))
        }

        // H4: Process any pending encrypted nsec that arrived before SAS confirmation
        if let encrypted = pendingEncryptedNsec, let shared = sharedSecret {
            let encHex = encrypted.hexString
            let sharedHex = shared.hexString
            pendingEncryptedNsec?.zeroize()
            pendingEncryptedNsec = nil
            Task {
                await importEncryptedNsec(encHex, sharedSecret: sharedHex)
            }
        }
    }

    /// Reject the SAS code (possible MITM).
    func rejectSASCode() {
        cleanup()
        currentStep = .error(NSLocalizedString(
            "device_link_sas_mismatch",
            comment: "SAS codes did not match. The linking process has been aborted for security."
        ))
    }

    // MARK: - Nsec Import

    /// Decrypt and import the nsec received from the desktop.
    private func importEncryptedNsec(_ encrypted: String, sharedSecret: String) async {
        await MainActor.run {
            currentStep = .importing
        }

        do {
            let decryptedNsec = try cryptoService.decryptWithSharedSecret(
                encrypted: encrypted,
                sharedSecret: sharedSecret
            )

            // Import the nsec into CryptoService
            try cryptoService.importNsec(decryptedNsec)

            await MainActor.run {
                currentStep = .completed
            }

            cleanup()
        } catch {
            await MainActor.run {
                currentStep = .error(String(format: NSLocalizedString(
                    "device_link_import_failed",
                    comment: "Failed to import key: %@"
                ), error.localizedDescription))
            }
        }
    }

    // MARK: - Cancel / Cleanup

    /// Cancel the linking flow and clean up resources.
    func cancel() {
        cleanup()
        currentStep = .scanning
    }

    /// Reset to scanning state after an error.
    func retry() {
        cleanup()
        currentStep = .scanning
    }

    // MARK: - Relay URL Validation (H5)

    /// Validate that a relay host is not a private/internal IP address or localhost.
    /// Prevents SSRF attacks via malicious QR codes pointing to internal networks.
    ///
    /// Rejects: localhost, 127.x, ::1, 10.x, 172.16-31.x, 192.168.x, 169.254.x,
    /// fe80: (link-local), [::1], and numeric-only hosts with private ranges.
    static func isValidRelayHost(_ host: String) -> Bool {
        let lowered = host.lowercased()

        // Reject localhost and loopback
        if lowered == "localhost" || lowered == "127.0.0.1" || lowered == "::1" || lowered == "[::1]" {
            return false
        }

        // Reject loopback range 127.x.x.x
        if lowered.hasPrefix("127.") {
            return false
        }

        // Reject private IP ranges
        let blockedPrefixes = ["10.", "192.168.", "169.254.", "fe80:"]
            + (16...31).map { "172.\($0)." }

        for prefix in blockedPrefixes {
            if lowered.hasPrefix(prefix) {
                return false
            }
        }

        // Reject empty host
        if lowered.isEmpty {
            return false
        }

        return true
    }

    /// Clean up WebSocket and ephemeral key material.
    /// MS-2: Explicitly zeroizes secret bytes before releasing references.
    private func cleanup() {
        receiveTask?.cancel()
        receiveTask = nil
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil

        // MS-2: Zeroize secret material before releasing references
        ephemeralSecret?.zeroize()
        ephemeralSecret = nil
        ephemeralPublic = nil
        theirEphemeralPublic = nil
        sharedSecret?.zeroize()
        sharedSecret = nil
        pendingEncryptedNsec?.zeroize()
        pendingEncryptedNsec = nil
        sasConfirmed = false
    }

    deinit {
        cleanup()
    }
}
