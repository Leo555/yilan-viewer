// 把指定字体中的汉字轮廓导出为 SVG path（用于 logo，避免依赖用户机器上的字体）
// 用法：swift scripts/glyph-path.swift 览 PingFangSC-Semibold 30
import CoreGraphics
import CoreText
import Foundation

let args = CommandLine.arguments
let text = args.count > 1 ? args[1] : "览"
let fontName = args.count > 2 ? args[2] : "PingFangSC-Semibold"
let size = CGFloat(Double(args.count > 3 ? args[3] : "30") ?? 30)

let font = CTFontCreateWithName(fontName as CFString, size, nil)
var chars = Array(text.utf16)
var glyphs = [CGGlyph](repeating: 0, count: chars.count)
CTFontGetGlyphsForCharacters(font, &chars, &glyphs, chars.count)
var advances = [CGSize](repeating: .zero, count: glyphs.count)
CTFontGetAdvancesForGlyphs(font, .horizontal, glyphs, &advances, glyphs.count)

var d = ""
var bounds = CGRect.null
var x: CGFloat = 0
let f = { (v: CGFloat) in String(format: "%.2f", v).replacingOccurrences(of: ".00", with: "") }
for (i, g) in glyphs.enumerated() {
  // CoreText 的 y 轴向上，SVG 向下：翻转
  var t = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: x, ty: 0)
  if let path = CTFontCreatePathForGlyph(font, g, &t) {
    bounds = bounds.union(path.boundingBoxOfPath)
    path.applyWithBlock { el in
      let p = el.pointee.points
      switch el.pointee.type {
      case .moveToPoint: d += "M\(f(p[0].x)) \(f(p[0].y))"
      case .addLineToPoint: d += "L\(f(p[0].x)) \(f(p[0].y))"
      case .addQuadCurveToPoint: d += "Q\(f(p[0].x)) \(f(p[0].y)) \(f(p[1].x)) \(f(p[1].y))"
      case .addCurveToPoint: d += "C\(f(p[0].x)) \(f(p[0].y)) \(f(p[1].x)) \(f(p[1].y)) \(f(p[2].x)) \(f(p[2].y))"
      case .closeSubpath: d += "Z"
      @unknown default: break
      }
    }
  }
  x += advances[i].width
}
print("bounds: x=\(f(bounds.minX)) y=\(f(bounds.minY)) w=\(f(bounds.width)) h=\(f(bounds.height))")
print(d)
