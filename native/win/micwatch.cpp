// trailmix-micwatch.exe: reports which apps are capturing from a microphone, as one JSON
// line per change on stdout, e.g. {"apps":[{"pid":1234,"exe":"ms-teams.exe","via":"msedgewebview2.exe"}]}
//
// Asks the Windows audio system directly: every active capture session on every
// microphone, and the process that owns it. Nothing is recorded, and no permission is
// needed. Browser-style apps capture audio in a helper process (Teams and Outlook use
// WebView2, Chrome its audio service), so each session is traced up to the app that
// started it.
//
//   trailmix-micwatch.exe --parent <pid>   exit when that process (Trailmix) exits
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <tlhelp32.h>
#include <cstdio>
#include <cwchar>
#include <map>
#include <set>
#include <string>
#include <vector>
#include <algorithm>

struct Proc {
  DWORD parent = 0;
  std::wstring exe;
};

static std::map<DWORD, Proc> processes() {
  std::map<DWORD, Proc> out;
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return out;
  PROCESSENTRY32W e{};
  e.dwSize = sizeof(e);
  if (Process32FirstW(snap, &e)) {
    do {
      std::wstring exe = e.szExeFile;
      std::transform(exe.begin(), exe.end(), exe.begin(), ::towlower);
      out[e.th32ProcessID] = {e.th32ParentProcessID, exe};
    } while (Process32NextW(snap, &e));
  }
  CloseHandle(snap);
  return out;
}

// Helper processes that capture audio on behalf of the app that launched them.
static bool isHelper(const std::wstring& exe) {
  return exe == L"msedgewebview2.exe" || exe == L"ms-teams_modulehost.exe";
}

struct App {
  DWORD pid;
  std::wstring exe, via;
  bool operator<(const App& o) const { return exe < o.exe || (exe == o.exe && pid < o.pid); }
  bool operator==(const App& o) const { return pid == o.pid && exe == o.exe && via == o.via; }
};

static std::vector<App> snapshot(IMMDeviceEnumerator* devices) {
  std::set<DWORD> pids;
  IMMDeviceCollection* list = nullptr;
  if (SUCCEEDED(devices->EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, &list))) {
    UINT count = 0;
    list->GetCount(&count);
    for (UINT i = 0; i < count; i++) {
      IMMDevice* device = nullptr;
      if (FAILED(list->Item(i, &device))) continue;
      IAudioSessionManager2* manager = nullptr;
      if (SUCCEEDED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void**)&manager))) {
        IAudioSessionEnumerator* sessions = nullptr;
        if (SUCCEEDED(manager->GetSessionEnumerator(&sessions))) {
          int n = 0;
          sessions->GetCount(&n);
          for (int j = 0; j < n; j++) {
            IAudioSessionControl* control = nullptr;
            if (FAILED(sessions->GetSession(j, &control))) continue;
            AudioSessionState state;
            IAudioSessionControl2* control2 = nullptr;
            if (SUCCEEDED(control->GetState(&state)) && state == AudioSessionStateActive &&
                SUCCEEDED(control->QueryInterface(__uuidof(IAudioSessionControl2), (void**)&control2))) {
              DWORD pid = 0;
              if (control2->IsSystemSoundsSession() != S_OK && SUCCEEDED(control2->GetProcessId(&pid)) && pid) pids.insert(pid);
              control2->Release();
            }
            control->Release();
          }
          sessions->Release();
        }
        manager->Release();
      }
      device->Release();
    }
    list->Release();
  }

  std::vector<App> apps;
  if (pids.empty()) return apps;
  auto procs = processes();
  for (DWORD pid : pids) {
    auto it = procs.find(pid);
    if (it == procs.end()) continue;
    App app{pid, it->second.exe, L""};
    // Walk up from a helper to the app that owns it (at most a few levels).
    DWORD cur = pid;
    for (int depth = 0; depth < 4 && isHelper(procs[cur].exe); depth++) {
      auto parent = procs.find(procs[cur].parent);
      if (parent == procs.end()) break;
      if (app.via.empty()) app.via = it->second.exe;
      cur = parent->first;
      app.pid = cur;
      app.exe = parent->second.exe;
    }
    apps.push_back(app);
  }
  std::sort(apps.begin(), apps.end());
  apps.erase(std::unique(apps.begin(), apps.end()), apps.end());
  return apps;
}

static std::string utf8(const std::wstring& w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), s.data(), n, nullptr, nullptr);
  std::string out;
  for (char c : s) {
    if (c == '"' || c == '\\') out += '\\';
    if ((unsigned char)c >= 0x20) out += c;
  }
  return out;
}

static void print(const std::vector<App>& apps) {
  std::string line = "{\"apps\":[";
  for (size_t i = 0; i < apps.size(); i++) {
    if (i) line += ",";
    line += "{\"pid\":" + std::to_string(apps[i].pid) + ",\"exe\":\"" + utf8(apps[i].exe) + "\"";
    if (!apps[i].via.empty()) line += ",\"via\":\"" + utf8(apps[i].via) + "\"";
    line += "}";
  }
  line += "]}\n";
  fputs(line.c_str(), stdout);
  fflush(stdout);
}

int wmain(int argc, wchar_t** argv) {
  HANDLE parent = nullptr;
  for (int i = 1; i + 1 < argc; i++)
    if (wcscmp(argv[i], L"--parent") == 0) parent = OpenProcess(SYNCHRONIZE, FALSE, (DWORD)_wtoi(argv[i + 1]));

  if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) return 1;
  IMMDeviceEnumerator* devices = nullptr;
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void**)&devices))) return 2;

  std::vector<App> last;
  bool first = true;
  int sinceEmit = 0;
  for (;;) {
    auto now = snapshot(devices);
    sinceEmit++;
    // Emit on change, and every 30 s so Trailmix knows the helper is alive.
    if (first || now != last || sinceEmit >= 30) {
      print(now);
      last = now;
      first = false;
      sinceEmit = 0;
    }
    if (parent && WaitForSingleObject(parent, 0) == WAIT_OBJECT_0) break; // Trailmix quit
    Sleep(1000);
  }
  devices->Release();
  CoUninitialize();
  return 0;
}
