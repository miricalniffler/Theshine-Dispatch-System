import AVFoundation
import AppKit
import Foundation

guard CommandLine.arguments.count >= 3 else {
    fputs("Usage: extract_frames <video> <output-directory>\n", stderr)
    exit(1)
}

let videoURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)

let asset = AVURLAsset(url: videoURL)
let duration = try await asset.load(.duration)
let seconds = CMTimeGetSeconds(duration)
let track = try await asset.loadTracks(withMediaType: .video).first
let size = try await track?.load(.naturalSize)
print("duration=\(seconds), size=\(String(describing: size))")

let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.maximumSize = CGSize(width: 1280, height: 1280)
let count = max(8, min(30, Int(ceil(seconds / 20))))
for index in 0..<count {
    let timeSeconds = seconds * Double(index) / Double(max(1, count - 1))
    let time = CMTime(seconds: timeSeconds, preferredTimescale: 600)
    do {
        let image = try generator.copyCGImage(at: time, actualTime: nil)
        let bitmap = NSBitmapImageRep(cgImage: image)
        let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.78])!
        let file = outputURL.appendingPathComponent(String(format: "%03d_%.1fs.jpg", index, timeSeconds))
        try data.write(to: file)
    } catch {
        print("frame failure at \(timeSeconds): \(error)")
    }
}
