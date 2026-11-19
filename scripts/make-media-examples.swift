// 生成图片 / 视频示例到 examples/media/{images,videos}/（仅 macOS，依赖系统自带的 CoreGraphics 与 AVFoundation）
// 用法：swift scripts/make-media-examples.swift
import AVFoundation
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let mediaDir = URL(fileURLWithPath: CommandLine.arguments[0])
  .deletingLastPathComponent().deletingLastPathComponent()
  .appendingPathComponent("examples/media")
let outDir = mediaDir.appendingPathComponent("images")
let videoDir = mediaDir.appendingPathComponent("videos")
for d in [outDir, videoDir] { try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true) }

let space = CGColorSpaceCreateDeviceRGB()
func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor { CGColor(colorSpace: space, components: [r, g, b, a])! }

func makeContext(_ w: Int, _ h: Int) -> CGContext {
  CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
}

func drawText(_ ctx: CGContext, _ text: String, _ size: CGFloat, _ x: CGFloat, _ y: CGFloat, _ color: CGColor) {
  let font = CTFontCreateWithName("PingFangSC-Semibold" as CFString, size, nil)
  let attr = NSAttributedString(string: text, attributes: [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
  ])
  let line = CTLineCreateWithAttributedString(attr)
  ctx.textPosition = CGPoint(x: x, y: y)
  CTLineDraw(line, ctx)
}

/// 一张“日落山景”插画，t 用于视频动画（0...1）
func drawScene(_ ctx: CGContext, _ w: CGFloat, _ h: CGFloat, t: CGFloat, title: String?) {
  let sky = CGGradient(colorsSpace: space, colors: [rgb(0.99, 0.62, 0.42), rgb(0.55, 0.36, 0.86), rgb(0.16, 0.18, 0.45)] as CFArray, locations: [0, 0.5, 1])!
  ctx.drawLinearGradient(sky, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 0, y: h), options: [])
  // 太阳：随 t 上升
  let sunY = h * (0.25 + 0.35 * t)
  ctx.setFillColor(rgb(1, 0.86, 0.55, 0.95))
  ctx.fillEllipse(in: CGRect(x: w * 0.62, y: sunY, width: h * 0.22, height: h * 0.22))
  // 远山、近山
  for (i, color) in [rgb(0.36, 0.27, 0.6), rgb(0.2, 0.16, 0.42)].enumerated() {
    ctx.setFillColor(color)
    ctx.move(to: CGPoint(x: 0, y: 0))
    let base = h * (i == 0 ? 0.38 : 0.24)
    let amp = h * (i == 0 ? 0.12 : 0.1)
    let shift = t * w * (i == 0 ? 0.05 : 0.12)
    stride(from: 0, through: w, by: 8).forEach { x in
      let y = base + amp * sin((x + shift) / w * .pi * CGFloat(3 + i)) + amp * 0.4 * sin((x + shift) / w * .pi * 11)
      ctx.addLine(to: CGPoint(x: x, y: y))
    }
    ctx.addLine(to: CGPoint(x: w, y: 0))
    ctx.closePath()
    ctx.fillPath()
  }
  if let title {
    drawText(ctx, title, h * 0.09, w * 0.06, h * 0.82, rgb(1, 1, 1, 0.95))
    drawText(ctx, "示例视频 · 由脚本生成", h * 0.045, w * 0.06, h * 0.74, rgb(1, 1, 1, 0.75))
  }
}

func save(_ image: CGImage, _ name: String, _ type: UTType, _ props: [CFString: Any] = [:]) {
  let url = outDir.appendingPathComponent(name)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, type.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, props as CFDictionary)
  CGImageDestinationFinalize(dest)
}

// 图片：PNG（插画）、JPEG（照片风格压缩）、GIF（动图）、BMP、ICO
do {
  let ctx = makeContext(1200, 675)
  drawScene(ctx, 1200, 675, t: 0.4, title: "一览 · 日落")
  let img = ctx.makeImage()!
  save(img, "sunset.png", .png)
  save(img, "sunset.jpg", .jpeg, [kCGImageDestinationLossyCompressionQuality: 0.8])
}
do {
  let ctx = makeContext(64, 64)
  ctx.setFillColor(rgb(0.31, 0.27, 0.9))
  ctx.addPath(CGPath(roundedRect: CGRect(x: 0, y: 0, width: 64, height: 64), cornerWidth: 14, cornerHeight: 14, transform: nil))
  ctx.fillPath()
  ctx.setFillColor(rgb(1, 1, 1))
  ctx.fillEllipse(in: CGRect(x: 20, y: 20, width: 24, height: 24))
  let img = ctx.makeImage()!
  save(img, "icon.ico", .ico)
  save(img, "icon.bmp", .bmp)
}
do {
  let frames = 24
  let url = outDir.appendingPathComponent("loading.gif")
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.gif.identifier as CFString, frames, nil)!
  CGImageDestinationSetProperties(dest, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
  for i in 0..<frames {
    let ctx = makeContext(160, 160)
    ctx.setFillColor(rgb(1, 1, 1))
    ctx.fill(CGRect(x: 0, y: 0, width: 160, height: 160))
    for k in 0..<8 {
      let angle = CGFloat(k) / 8 * 2 * .pi - CGFloat(i) / CGFloat(frames) * 2 * .pi
      let alpha = 0.15 + 0.85 * CGFloat(k) / 7
      ctx.setFillColor(rgb(0.31, 0.27, 0.9, alpha))
      ctx.fillEllipse(in: CGRect(x: 80 + 48 * cos(angle) - 10, y: 80 + 48 * sin(angle) - 10, width: 20, height: 20))
    }
    CGImageDestinationAddImage(dest, ctx.makeImage()!, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 0.05]] as CFDictionary)
  }
  CGImageDestinationFinalize(dest)
}

// 视频：4 秒 640×360 H.264 MP4
func makeVideo() throws {
  let url = videoDir.appendingPathComponent("sunrise.mp4")
  try? FileManager.default.removeItem(at: url)
  let (w, h, fps, seconds) = (640, 360, 24, 4)
  let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
  let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 600_000],
  ])
  let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: w, kCVPixelBufferHeightKey as String: h,
  ])
  writer.add(input)
  writer.startWriting()
  writer.startSession(atSourceTime: .zero)
  let total = fps * seconds
  for i in 0..<total {
    while !input.isReadyForMoreMediaData { usleep(1000) }
    var pb: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
    guard let buffer = pb else { continue }
    CVPixelBufferLockBaseAddress(buffer, [])
    let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: w, height: h, bitsPerComponent: 8,
                        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: space,
                        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
    drawScene(ctx, CGFloat(w), CGFloat(h), t: CGFloat(i) / CGFloat(total - 1), title: "日出 · \(i / fps + 1)s")
    CVPixelBufferUnlockBaseAddress(buffer, [])
    adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(i), timescale: CMTimeScale(fps)))
  }
  input.markAsFinished()
  let done = DispatchSemaphore(value: 0)
  writer.finishWriting { done.signal() }
  done.wait()
  if writer.status != .completed { throw writer.error ?? NSError(domain: "video", code: 1) }
}
try makeVideo()
print("已生成图片 / 视频示例到 \(mediaDir.path)")
