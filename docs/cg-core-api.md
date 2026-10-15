# Trailmix ↔ CG Core API (v1)

CG Core signs Trailmix users in (Microsoft 365 via Core's existing login) and holds the Anthropic and Deepgram keys. Trailmix never stores a provider key when connected to Core.

- Production base URL: `https://core.cgtechnologies.com`
- Staging base URL: `https://core-staging.cgtechnologies.com`

## 1. Pairing (device sign-in)

Same shape as NetMon probe pairing: a short-lived one-time code is swapped for a per-device token.

1. Trailmix makes a random `state` (32 hex chars) and opens the system browser at:
   `GET {core}/trailmix/connect?state=<state>&device=<urlencoded device name>&platform=<darwin|win32>`
2. That Core page requires a normal staff session (the proxy sends signed-out users to `/login` and back). Portal users and inactive staff are refused. The page shows "Connect Trailmix on <device>?" and a **Connect** button.
3. **Connect** (a server action) creates a pairing code:
   - one-time and random (at least 128 bits), stored hashed
   - expires after 5 minutes
   - bound to the staff member and `state`

   It then redirects the browser to `trailmix://connect?code=<code>&state=<state>`. The page also shows a "If Trailmix didn't open, copy this code" fallback with the code.
4. Trailmix checks that `state` matches what it sent, then calls:

```
POST {core}/api/trailmix/v1/pair
Content-Type: application/json
{ "code": "<code>", "state": "<state>", "deviceName": "Matt's MacBook Air", "platform": "darwin", "appVersion": "0.3.0" }

200 { "token": "cgt_<prefix>_<secret>", "staff": { "id": "<uuid>", "name": "Matt Goodchild", "email": "..." }, "device": { "id": "<uuid>", "name": "..." } }
400 { "error": "...", "code": "invalid_code" }   // unknown, used, expired, or state mismatch
```

- The code is consumed on first use, whether or not that use succeeds.
- The token is shown once. Core stores only its SHA-256 hash and the prefix.

## 2. Authenticating requests

Every other endpoint takes `Authorization: Bearer cgt_<prefix>_<secret>`. Core looks the device up by prefix, compares hashes in constant time, and checks that:

- the device is not revoked
- the staff member is `active`
- the staff member is not a portal user

It updates `last_used_at` at most once a minute.

Errors are JSON with HTTP 401: `{ "error": "...", "code": "unauthorized" | "revoked" | "inactive" }`. When Trailmix gets a 401 it signs out locally and asks the user to connect again.

## 3. Endpoints

### `GET /api/trailmix/v1/me`

```
200 {
  "staff":  { "id", "name", "email" },
  "device": { "id", "name" },
  "features": { "claude": true, "deepgram": true },   // false when that key isn't configured in Core
  "config": {
    "deepgramModel": "nova-3",
    "language": "en",
    "keyterms": ["CG Technologies", "..."],          // org-wide custom vocabulary, may be []
    "claudeModels": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    "defaultClaudeModel": "claude-opus-5-5"
  }
}
```

### `POST /api/trailmix/v1/deepgram-token`

Core calls Deepgram's token grant API with its stored key and returns a short-lived token that is only good for opening a live-transcription connection. Audio goes straight from the laptop to Deepgram.

```
200 { "accessToken": "<jwt>", "expiresIn": 60 }
503 { "error": "Deepgram is not set up in CG Core", "code": "not_configured" }
```

Trailmix opens `wss://api.deepgram.com/v1/listen?...` with `Authorization: Bearer <accessToken>`, and requests a fresh token for every connect and reconnect.

### `POST /api/trailmix/v1/claude`

A streaming Claude proxy, built the same way as `/api/help/ask` (NDJSON).

Request:
```
{
  "purpose": "enhance" | "chat",
  "model": "claude-opus-5-5",          // optional; must be in config.claudeModels, else Core's default
  "system": "..." | [ { "type": "text", "text": "...", "cache_control"?: { "type": "ephemeral" } } ],
  "messages": [ { "role": "user" | "assistant", "content": "..." } ],
  "effort": "low" | "medium" | "high",  // optional, default "medium"
  "maxTokens": 32000                    // optional, capped at 32000
}
```

Limits:
- 413 if the body is over 3 MB
- 429 with `Retry-After` over a per-staff rate limit (suggested: 60 requests/hour, burst 10)
- 503 `not_configured` when there is no Anthropic key

Core adds the server-side refusal fallback where the model supports it.

Response: `Content-Type: application/x-ndjson`, one JSON object per line:
```
{"t":"d","text":"..."}                                   // text delta, many
{"t":"done","stopReason":"end_turn","usage":{"input":N,"output":N,"cacheRead":N,"cacheWrite":N}}
{"t":"error","message":"...","code":"refusal"|"upstream"|"rate_limited"}
```
Core aborts the upstream request when the client disconnects. It records one row per call:
- staff, device, purpose, model, token counts and `cost_usd`
- never the prompt or response text

### `POST /api/trailmix/v1/signout`

Revokes the calling device. `204`.

## 4. CG Core admin UI

- **Settings → Integrations:** a Deepgram card, permission `manage_ai`. It stores the key encrypted like the Anthropic key, has a test button, and its config holds the model, language and org vocabulary.
- **Trailmix devices:** each staff member sees and can revoke their own devices. Holders of `manage_ai` see and can revoke all devices, plus usage per person.

## 5. Meeting sync (v2: desktop and mobile)

CG Core stores each staff member's meetings so they appear on every device they sign in on. Meetings are **private to their owner**: only that staff member's own devices can read them, and nothing in Core's UI lists them for anyone else. Audio is never sent.

`GET /api/trailmix/v1/me` adds `"features": { ..., "sync": true }` once these endpoints exist.

### Meeting document

The document is the same JSON the desktop app keeps per meeting. Core stores it as an opaque `jsonb` document, plus a few columns copied out for ordering:

```
{
  "id": "mv8x55g8-db8464",           // client-generated, 1-64 chars [A-Za-z0-9-]
  "title": "...", "createdAt": 1792000000000, "updatedAt": 1792000000000,   // ms since epoch
  "notes": "...", "enhanced": "...", "templateId": "client-review",
  "transcript": [ { "id", "channel", "speaker", "text", "start", "end", "mono"? } ],
  "chat": [ { "role", "content" } ],
  "source": "desktop" | "mobile"
}
```

### `GET /api/trailmix/v1/meetings?since=<cursor>&limit=100`

Lists the caller's meetings that changed after `cursor`. `cursor` is an opaque string, and the first sync omits it.

```
200 {
  "meetings": [ { "id": "...", "version": 7, "deleted": false, "doc": { ...meeting... } },
                { "id": "...", "version": 3, "deleted": true,  "doc": null } ],
  "cursor": "<opaque>",     // pass back next time
  "more": false             // true: call again straight away with the new cursor
}
```

### `PUT /api/trailmix/v1/meetings/{id}`

Creates or replaces one meeting.

```
{ "ifVersion": 6, "doc": { ...meeting... } }   // ifVersion omitted or null when creating
200 { "id": "...", "version": 7 }
409 { "error": "...", "code": "conflict", "current": { "id", "version", "deleted", "doc" } }
```

- **Versions:** `version` is a per-meeting counter that Core increments on every write. A `PUT` whose `ifVersion` doesn't match the stored version gets `409` with the current copy. The client merges the two (see `shared/sync.js`) and retries with the new version.
- **Validation:** `doc.id` must equal `{id}`. A deleted meeting can be revived by a `PUT` with its current version.
- **Limits:** a `doc` over 5 MB gets `413 too_large`. Requests are rate limited per staff member, generously, because sync sends a write per edited meeting.

### `DELETE /api/trailmix/v1/meetings/{id}?ifVersion=<n>`

Marks the meeting deleted and **erases its document**, keeping only the id and version as a tombstone so other devices learn about the deletion. Returns `200 { "id", "version" }`, or `409 conflict` as for `PUT`.

### CG Core admin UI

My profile > Trailmix shows "Meetings synced: N" and a **Delete all my synced meetings** button. Core doesn't show meeting contents anywhere.
