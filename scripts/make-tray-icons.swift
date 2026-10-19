// Draws the menu bar / system tray icons from the Trailmix brand mark (a rounded square
// with a dot in the middle). Run: swift scripts/make-tray-icons.swift
// macOS idle icons are "template" images (black + alpha) so macOS tints them for light and
// dark menu bars. Recording icons are red on both platforms; Windows idle is grey.
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "electron/assets/tray")
let red = NSColor(srgbRed: 0xe9 / 255.0, green: 0x3e / 255.0, blue: 0x3f / 255.0, alpha: 1)
// Mid grey reads on both light and dark Windows taskbars; red is kept for "recording".
let grey = NSColor(srgbRed: 0x7a / 255.0, green: 0x7f / 255.0, blue: 0x88 / 255.0, alpha: 1)

enum Style { case template, idle, recording }

func draw(_ style: Style, px: Int, canvas: CGFloat, mark: CGFloat) -> Data {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                             samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                             colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  let ctx = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.current = ctx
  let s = CGFloat(px) / canvas
  ctx.cgContext.scaleBy(x: s, y: s)
  let o = (canvas - mark) / 2
  let square = NSBezierPath(roundedRect: NSRect(x: o, y: o, width: mark, height: mark), xRadius: mark * 0.3, yRadius: mark * 0.3)
  let dotR = mark * (style == .recording ? 0.27 : 0.21)
  let dot = NSBezierPath(ovalIn: NSRect(x: canvas / 2 - dotR, y: canvas / 2 - dotR, width: dotR * 2, height: dotR * 2))
  switch style {
  case .template:
    // Black square with the dot knocked out.
    NSColor.black.setFill()
    square.append(dot.reversed)
    square.fill()
  case .idle, .recording:
    (style == .recording ? red : grey).setFill(); square.fill()
    NSColor.white.setFill(); dot.fill()
  }
  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

func write(_ name: String, _ data: Data) {
  try! data.write(to: out.appendingPathComponent(name))
  print("wrote \(name)")
}

try! FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
// macOS menu bar: 16pt canvas, 14pt mark (@1x and @2x).
for (suffix, px) in [("", 16), ("@2x", 32)] {
  write("trayTemplate\(suffix).png", draw(.template, px: px, canvas: 16, mark: 14))
  write("trayRecording\(suffix).png", draw(.recording, px: px, canvas: 16, mark: 14))
}
// Windows notification area: 16px at 100%, 32px at 200% (Electron picks by DPI).
for (suffix, px) in [("", 16), ("@2x", 32)] {
  write("trayWin\(suffix).png", draw(.idle, px: px, canvas: 16, mark: 15))
  write("trayWinRecording\(suffix).png", draw(.recording, px: px, canvas: 16, mark: 15))
}
