# Trailmix

AI meeting notes for CG Technologies staff, modelled on how Granola works. No bot joins the call. Trailmix listens to your mic and your computer's audio, transcribes both live, and when the meeting ends Claude turns your rough notes plus the transcript into clean, structured notes.

## How it works (Granola deconstructed)

| Granola feature | How Trailmix does it |
|---|---|
| Captures both sides with no meeting bot | Mic through `getUserMedia`; system audio through Electron's display-media loopback (Core Audio tap on macOS 14.2+, WASAPI loopback on Windows). The video track is discarded. |
| "Me" vs "Them" in the transcript | The two sources are mixed into one **2-channel** PCM stream (ch0 = mic, ch1 = system) and sent to Deepgram with `multichannel=true`. Channel = who's speaking; diarisation splits "Them" into Speaker 1, 2… |
| Live transcript | Deepgram streaming (`nova-3`, interim results). The WebSocket runs in the main process so keys never touch the UI. Reconnects with backoff and buffers audio during blips. |
| Notepad during the meeting | Plain notes editor that autosaves. |
| "Enhance" | Claude (Opus 5.5 by default) gets your notes, the transcript and a template. Your own points come back highlighted; detail added from the transcript is in grey. |
| Templates | 7 built-in templates (General, Client meeting/QBR, Sales discovery, Technical/support call with a ticket note, 1:1, Team stand-up, Interview), plus your own in Settings. |
| Chat with a meeting / across meetings | Ask about one meeting, or across every meeting on this computer. Meeting material is prompt-cached so follow-up questions are cheap. |
| No audio stored | Audio is streamed and discarded. Only text is saved. |
| Echo without headphones | Mic lines that repeat what came through system audio at the same moment are filtered out (`shared/transcript.js`). |

Not in v1 (by choice): calendar integration, shared team workspace, mobile app.

## Setup

```bash
npm install
npm run dev        # Electron + hot reload
npm run web        # UI only in a browser with demo data (no keys/mic needed)
npm test           # unit tests
```

In the app, open **Settings** and add:
- a **Deepgram** API key (console.deepgram.com)
- an **Anthropic** API key (platform.claude.com)

Keys are encrypted with the OS keychain (`safeStorage`). For a managed rollout you can instead set `DEEPGRAM_API_KEY` and `ANTHROPIC_API_KEY` as environment variables on staff machines.

Add client names, vendors and product names under **Settings → Custom vocabulary** so the transcript spells them correctly.

### macOS permissions
On first recording macOS asks for **Microphone** and **Screen & System Audio Recording**. Electron needs the second one to tap system audio; nothing on screen is recorded. If the "Them" meter never moves, check System Settings → Privacy & Security. Settings in the app links straight there.

> In `npm run dev` the permission belongs to the Electron binary that starts the app. For the most realistic test of system audio, use a packaged build.

## Building installers

```bash
npm run dist:mac   # → release/*.dmg (build on a Mac)
npm run dist:win   # → release/*.exe (build on Windows, or CI)
```

To hand this to staff without security warnings you'll need:
- **macOS:** an Apple Developer ID certificate plus notarisation (`CSC_LINK`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for electron-builder). Unsigned apps won't get system-audio permission reliably.
- **Windows:** a code-signing certificate to avoid SmartScreen prompts.
- Or deploy through your RMM/Intune.

## Releasing an update

Installed copies check [GitHub Releases](https://github.com/mgoodchild2025/trailmix/releases) at launch and every 4 hours. They download new versions in the background and offer **Restart to update** (never mid-recording), or install on the next quit.

1. Bump `"version"` in `package.json` (e.g. `0.2.0` → `0.2.1`), commit and push.
2. `git tag v0.2.1 && git push --tags`. GitHub Actions builds Windows and uploads it to a **draft** release.
3. `npm run release:mac`. This builds, signs and notarises on your Mac, waits for the Windows draft to appear, then adds the Mac files to it. It can run while CI is still going. It uses your `gh` login and the `trailmix-notary` keychain profile.
4. `npm run release:publish`. This checks both platforms are attached, then publishes. Staff only see published releases.

Releases must be published, not drafts or pre-releases, for the app to see them, and the repo must stay public. Updates are off when running with `npm run dev`.

## Where data lives

- macOS: `~/Library/Application Support/Trailmix/`
- Windows: `%APPDATA%\Trailmix\`

There is one JSON file per meeting in `meetings/`. Deleted meetings move to `trash/`. Set `TRAILMIX_DATA_DIR` to override the location.

## Code map

```
electron/main.js      window, system-audio handler, IPC, AI calls
electron/deepgram.js  live transcription client
electron/llm.js       Claude streaming (+ server-side refusal fallback)
electron/prompts.js   enhance / chat prompts
electron/store.js     meeting files + encrypted settings
electron/preload.cjs  the API the UI is allowed to call
shared/               templates and transcript helpers (used by both sides)
src/audio/recorder.js mic + system audio → 2-channel 16 kHz PCM (AudioWorklet)
src/                  React UI
```

## Costs (rough)
- Deepgram bills streaming per audio minute. Multichannel audio is billed per channel, so one meeting hour counts as about two hours of audio. Check your Deepgram plan.
- Claude: enhancing a one-hour meeting is roughly 15–25k input tokens, which is a few cents on Opus 5.5. Sonnet and Haiku can be chosen in Settings.
