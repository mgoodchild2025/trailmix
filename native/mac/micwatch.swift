// trailmix-micwatch: reports which apps are using a microphone, as one JSON line per
// change on stdout, e.g. {"active":true,"apps":[{"pid":123,"bundleId":"us.zoom.xos","name":"zoom.us"}]}
//
// macOS 14+: Core Audio's per-process objects say which processes are capturing input.
// Older macOS: only whether the default input device is in use by anything ("apps": []).
// Reading these properties needs no permission; nothing is recorded.
// With --audio-capture-status it instead prints the system-audio permission and exits.
import AppKit
import CoreAudio
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

// `trailmix-micwatch --audio-capture-status` prints whether Trailmix may record system
// audio ("System Audio Recording Only" in Privacy & Security): granted, denied or
// unknown. macOS has no public API for this one, so ask TCC's preflight (read-only; it
// never shows a prompt). The helper runs inside Trailmix, so TCC answers for Trailmix.
if CommandLine.arguments.contains("--audio-capture-status") {
  typealias Preflight = @convention(c) (CFString, CFDictionary?) -> Int
  var status = "unknown"
  if let tcc = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW),
     let sym = dlsym(tcc, "TCCAccessPreflight") {
    let preflight = unsafeBitCast(sym, to: Preflight.self)
    switch preflight("kTCCServiceAudioCapture" as CFString, nil) {
    case 0: status = "granted"
    case 1: status = "denied"
    default: status = "not-determined"
    }
  }
  print(status)
  exit(0)
}

func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}

func readUInt32(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
  var addr = address(selector)
  var value: UInt32 = 0
  var size = UInt32(MemoryLayout<UInt32>.size)
  return AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &value) == noErr ? value : nil
}

func readPid(_ obj: AudioObjectID) -> pid_t? {
  var addr = address(kAudioProcessPropertyPID)
  var value: pid_t = 0
  var size = UInt32(MemoryLayout<pid_t>.size)
  return AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &value) == noErr ? value : nil
}

func readString(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
  var addr = address(selector)
  var value: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  guard AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &value) == noErr, let s = value?.takeRetainedValue() else { return nil }
  return s as String
}

func objectList(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector) -> [AudioObjectID] {
  var addr = address(selector)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(obj, &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &ids) == noErr else { return [] }
  return ids
}

struct App: Encodable, Equatable { let pid: Int32; let bundleId: String; let name: String }
struct Snapshot: Encodable, Equatable { let active: Bool; let apps: [App] }

func defaultInputInUse() -> Bool {
  var addr = address(kAudioHardwarePropertyDefaultInputDevice)
  var device = AudioObjectID(0)
  var size = UInt32(MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &device) == noErr, device != 0 else { return false }
  return (readUInt32(device, kAudioDevicePropertyDeviceIsRunningSomewhere) ?? 0) != 0
}

func snapshot() -> Snapshot {
  if #available(macOS 14.0, *) {
    var apps: [App] = []
    for obj in objectList(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyProcessObjectList) {
      guard (readUInt32(obj, kAudioProcessPropertyIsRunningInput) ?? 0) != 0, let pid = readPid(obj) else { continue }
      let bundle = readString(obj, kAudioProcessPropertyBundleID) ?? ""
      let running = NSRunningApplication(processIdentifier: pid)
      apps.append(App(pid: pid, bundleId: bundle.isEmpty ? (running?.bundleIdentifier ?? "") : bundle, name: running?.localizedName ?? ""))
    }
    apps.sort { $0.pid < $1.pid }
    return Snapshot(active: !apps.isEmpty || defaultInputInUse(), apps: apps)
  }
  return Snapshot(active: defaultInputInUse(), apps: [])
}

let encoder = JSONEncoder()
var last: Snapshot? = nil
var sinceEmit = 0
while true {
  let now = snapshot()
  sinceEmit += 1
  // Emit on change, and every 30 s so the app knows the helper is alive.
  if now != last || sinceEmit >= 30 {
    if let data = try? encoder.encode(now), let line = String(data: data, encoding: .utf8) { print(line) }
    last = now
    sinceEmit = 0
  }
  // Parent gone (Trailmix quit): stop.
  if getppid() == 1 { exit(0) }
  Thread.sleep(forTimeInterval: 1.0)
}
