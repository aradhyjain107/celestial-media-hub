import Foundation
import PDFKit
import AppKit

// Usage: pdf-rasterizer <input.pdf> <output_directory> <prefix> <format: png|jpeg|jpg|tiff|bmp> [scale: 2.0] [quality: 0.85]
let args = CommandLine.arguments
guard args.count >= 5 else {
    fputs("Usage: pdf-rasterizer <input.pdf> <output_dir> <prefix> <format> [scale] [quality]\n", stderr)
    exit(1)
}

let inputPath = args[1]
let outputDir = args[2]
let prefix = args[3]
let format = args[4].lowercased()
let scale: CGFloat = args.count > 5 ? CGFloat(Double(args[5]) ?? 2.0) : 2.0
let quality: Float = args.count > 6 ? Float(Double(args[6]) ?? 0.85) : 0.85

let inputUrl = URL(fileURLWithPath: inputPath)
guard let doc = PDFDocument(url: inputUrl) else {
    fputs("Error: Failed to open PDF document at \(inputPath)\n", stderr)
    exit(1)
}

let pageCount = doc.pageCount
if pageCount == 0 {
    fputs("Error: PDF document has 0 pages\n", stderr)
    exit(1)
}

let fm = FileManager.default
try? fm.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

var outputFiles: [String] = []

for i in 0..<pageCount {
    guard let page = doc.page(at: i) else { continue }
    let pageBounds = page.bounds(for: .mediaBox)
    let targetSize = CGSize(width: max(1, pageBounds.width * scale), height: max(1, pageBounds.height * scale))
    let image = page.thumbnail(of: targetSize, for: .mediaBox)
    
    guard let tiffData = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiffData) else {
        continue
    }
    
    var imgData: Data? = nil
    var fileExt = format
    
    switch format {
    case "png":
        imgData = bitmap.representation(using: .png, properties: [:])
    case "jpeg", "jpg":
        fileExt = "jpg"
        imgData = bitmap.representation(using: .jpeg, properties: [.compressionFactor: NSNumber(value: quality)])
    case "tiff":
        imgData = bitmap.representation(using: .tiff, properties: [:])
    case "bmp":
        imgData = bitmap.representation(using: .bmp, properties: [:])
    default:
        imgData = bitmap.representation(using: .png, properties: [:])
        fileExt = "png"
    }
    
    guard let data = imgData else { continue }
    
    let fileName = pageCount == 1 ? "\(prefix).\(fileExt)" : "\(prefix)_page_\(i + 1).\(fileExt)"
    let fileUrl = URL(fileURLWithPath: outputDir).appendingPathComponent(fileName)
    
    do {
        try data.write(to: fileUrl)
        outputFiles.append(fileUrl.path)
    } catch {
        fputs("Error writing page \(i + 1): \(error.localizedDescription)\n", stderr)
    }
}

let json = try JSONSerialization.data(withJSONObject: outputFiles, options: [])
if let jsonStr = String(data: json, encoding: .utf8) {
    print(jsonStr)
}
