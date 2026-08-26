import AVFoundation
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let statusLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        statusLabel.text = "Saving to Scrap"
        statusLabel.font = .preferredFont(forTextStyle: .headline)
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 2

        spinner.startAnimating()
        let stack = UIStackView(arrangedSubviews: [spinner, statusLabel])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24)
        ])

        Task { await saveSharedContent() }
    }

    private func saveSharedContent() async {
        do {
            let shared = try await SharedContent.load(from: extensionContext)
            defer {
                if let movieURL = shared.movieURL { try? FileManager.default.removeItem(at: movieURL) }
            }
            statusLabel.text = shared.movieURL == nil ? "Saving Reel" : "Reading video and audio"
            let evidence = try await MediaEvidence.build(movieURL: shared.movieURL, image: shared.image)
            statusLabel.text = "Sending to Scrap"

            let payload = ScrapPayload(
                sourceUrl: shared.sourceURL?.absoluteString,
                caption: shared.text,
                mediaUrls: evidence.frames,
                videoData: evidence.videoData
            )
            try await ScrapAPI.save(payload)

            statusLabel.text = "Saved"
            spinner.stopAnimating()
            try? await Task.sleep(for: .milliseconds(450))
            extensionContext?.completeRequest(returningItems: nil)
        } catch {
            spinner.stopAnimating()
            statusLabel.text = error.localizedDescription
            try? await Task.sleep(for: .seconds(2))
            extensionContext?.cancelRequest(withError: error)
        }
    }
}

private struct ScrapPayload: Encodable {
    let sourceUrl: String?
    let caption: String?
    let mediaUrls: [String]
    let videoData: String?
}

private enum ScrapAPI {
    static func save(_ payload: ScrapPayload) async throws {
        guard
            let base = Bundle.main.object(forInfoDictionaryKey: "ScrapAPIBaseURL") as? String,
            let url = URL(string: base)?.appending(path: "api/scraps")
        else {
            throw ShareError.invalidServerURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ShareError.uploadFailed
        }
    }
}

private struct SharedContent {
    var sourceURL: URL?
    var movieURL: URL?
    var image: UIImage?
    var text: String?

    static func load(from context: NSExtensionContext?) async throws -> SharedContent {
        let providers = context?.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] } ?? []
        guard !providers.isEmpty else {
            throw ShareError.noContent
        }

        var content = SharedContent()
        for provider in providers {
            if content.movieURL == nil, provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
                content.movieURL = try await provider.copiedFile(for: UTType.movie)
            }
            if content.sourceURL == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                content.sourceURL = await provider.loadedURL()
            }
            if content.image == nil, provider.canLoadObject(ofClass: UIImage.self) {
                content.image = await provider.loadedImage()
            }
            if content.text == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                content.text = await provider.loadedText()
                if content.sourceURL == nil, let text = content.text, let url = URL(string: text), url.scheme?.hasPrefix("http") == true {
                    content.sourceURL = url
                }
            }
        }

        guard content.sourceURL != nil || content.movieURL != nil || content.image != nil else {
            throw ShareError.noContent
        }
        return content
    }
}

private struct MediaEvidence {
    let frames: [String]
    let videoData: String?

    static func build(movieURL: URL?, image: UIImage?) async throws -> MediaEvidence {
        guard let movieURL else {
            let frames = image.flatMap(Self.dataURL).map { [$0] } ?? []
            return MediaEvidence(frames: frames, videoData: nil)
        }

        let asset = AVURLAsset(url: movieURL)
        async let frames = extractFrames(from: asset)
        async let video = exportVideo(from: asset)
        return try await MediaEvidence(frames: frames, videoData: video)
    }

    private static func extractFrames(from asset: AVAsset) async throws -> [String] {
        let duration = try await asset.load(.duration)
        let seconds = max(duration.seconds, 0.1)
        let count = min(8, max(3, Int(ceil(seconds / 3))))
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 1280, height: 1280)
        generator.requestedTimeToleranceBefore = CMTime(seconds: 0.25, preferredTimescale: 600)
        generator.requestedTimeToleranceAfter = CMTime(seconds: 0.25, preferredTimescale: 600)

        var frames: [String] = []
        for index in 0..<count {
            let position = seconds * Double(index + 1) / Double(count + 1)
            let result = try await generator.image(at: CMTime(seconds: position, preferredTimescale: 600))
            let image = UIImage(cgImage: result.image)
            if let dataURL = dataURL(image) { frames.append(dataURL) }
        }
        return frames
    }

    private static func exportVideo(from asset: AVAsset) async throws -> String? {
        guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetMediumQuality) else { return nil }
        let outputURL = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appendingPathExtension("mp4")
        try await exporter.export(to: outputURL, as: .mp4)
        defer { try? FileManager.default.removeItem(at: outputURL) }
        let data = try Data(contentsOf: outputURL)
        guard data.count <= 30_000_000 else { throw ShareError.videoTooLarge }
        return data.base64EncodedString()
    }

    private static func dataURL(_ image: UIImage) -> String? {
        image.jpegData(compressionQuality: 0.72)
            .map { "data:image/jpeg;base64,\($0.base64EncodedString())" }
    }
}

private extension NSItemProvider {
    func copiedFile(for type: UTType) async throws -> URL? {
        try await withCheckedThrowingContinuation { continuation in
            loadFileRepresentation(forTypeIdentifier: type.identifier) { url, error in
                if let error { return continuation.resume(throwing: error) }
                guard let url else { return continuation.resume(returning: nil) }
                let copy = FileManager.default.temporaryDirectory
                    .appending(path: UUID().uuidString)
                    .appendingPathExtension(url.pathExtension.isEmpty ? "mov" : url.pathExtension)
                do {
                    try FileManager.default.copyItem(at: url, to: copy)
                    continuation.resume(returning: copy)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    func loadedURL() async -> URL? {
        await withCheckedContinuation { continuation in
            loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                continuation.resume(returning: item as? URL)
            }
        }
    }

    func loadedImage() async -> UIImage? {
        await withCheckedContinuation { continuation in
            loadObject(ofClass: UIImage.self) { object, _ in
                continuation.resume(returning: object as? UIImage)
            }
        }
    }

    func loadedText() async -> String? {
        await withCheckedContinuation { continuation in
            loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
                continuation.resume(returning: item as? String)
            }
        }
    }
}

private enum ShareError: LocalizedError {
    case invalidServerURL
    case noContent
    case uploadFailed
    case videoTooLarge

    var errorDescription: String? {
        switch self {
        case .invalidServerURL: "Scrap server URL is missing"
        case .noContent: "Instagram did not provide a Reel or media file"
        case .uploadFailed: "Scrap could not receive this Reel"
        case .videoTooLarge: "This Reel is too large to share"
        }
    }
}
