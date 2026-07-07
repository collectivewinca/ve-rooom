# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User's Browser                               │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Home Page   │  │ Meeting Page │  │ Summary Page │               │
│  │  Create/Join │  │ <RtkMeeting> │  │  Polls + MD  │               │
│  │              │  │ +5s auto-    │  │ +download    │               │
│  │              │  │ start recs   │  │  cards       │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                 │                  │                        │
│         └────────┬────────┴──────────┬───────┘                        │
│                  │  fetch()          │                                 │
│                  ▼                   ▼                                │
├─────────────────────────────────────────────────────────────────────┤
│                  Cloudflare Pages (edge network)                     │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Pages Functions (Workers)                                   │   │
│  │                                                               │   │
│  │  POST /api/rooms              → Create meeting + participant  │   │
│  │  POST /api/rooms/:id/...      → Join existing meeting         │   │
│  │  POST /api/recordings/start   → Composite rec (dedup + allow) │   │
│  │  POST /api/recordings/track   → Track rec (per-participant)   │   │
│  │  GET  /api/summary/:id        → 3-source transcript + summary │   │
│  │  GET  /api/meetings           → List all meetings             │   │
│  │                                                               │   │
│  │  Secrets: CF_ACCOUNT_ID, CF_API_TOKEN, RTK_APP_ID,            │   │
│  │           OPENROUTER_API_KEY, OPENROUTER_MODEL,                │   │
│  │           OPENROUTER_FREE_MODEL, OLLAMA_*                     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│         │                              │                             │
└─────────┼──────────────────────────────┼─────────────────────────────┘
          │ REST API                      │ REST API
          ▼                              ▼
┌──────────────────────┐     ┌─────────────────────────┐
│  RealtimeKit (CF)    │     │  OpenRouter (free)       │
│                      │     │                         │
│  • SFU media routing │     │  POST /v1/chat/          │
│  • Composite rec     │     │       completions        │
│    (MP4 + MP3)       │     │  model: openrouter/free  │
│  • Track rec         │     │  → { choices: [{         │
│    (WebM/audio)      │     │      message: {          │
│  • Transcription     │     │        content } }] }    │
│    (Whisper on WAI)  │     └─────────────────────────┘
│  • Summary engine    │              │ (fallback)
│  • R2 storage (7-day) │              ▼
│                      │     ┌─────────────────────────┐
│                      │     │  Ollama Cloud (fallback) │
│                      │     │  POST /api/chat          │
│                      │     └─────────────────────────┘
│                      │              │ (fallback)
│                      │              ▼
│                      │     ┌─────────────────────────┐
│                      │     │  CF built-in summary    │
│                      │     │  GET /sessions/{id}/     │
│                      │     │       summary            │
│                      │     └─────────────────────────┘
└──────────────────────┘
          ▲
          │ WebRTC (audio/video/screen)
          │
┌──────────────────────┐
│  Participant Browsers │
│  (5+ participants)    │
└──────────────────────┘


┌──────────────────────┐
│  formsdb.exe.xyz      │  ← Central Google Auth (PocketBase)
│                       │     (separate from main app)
│  • Google OAuth       │
│  • User profiles      │
│  • Login tracking     │
└──────────────────────┘
```

## Components

### 1. Frontend (React + Vite)

**Entry:** `src/main.tsx` → `<BrowserRouter>` → `<App>` → `<Layout>` → routes

**Routes:**
| Path | Component | Description |
|---|---|---|
| `/` | `Home` | Create or join meeting, tab toggle, feature badges |
| `/dashboard` | `Dashboard` | Stats + past meetings list |
| `/meeting/:roomId` | `Meeting` | Full-screen `<RtkMeeting>` with overlay controls |
| `/summary/:roomId` | `Summary` | Polls API, renders Markdown summary + download links |

**Layout Component:**
- Fixed glassmorphic navbar with logo, nav links, and auth controls
- Skips itself for `/meeting/*` routes (full-screen meeting UI)

**Auth:**
- `formsdb-auth.js` — Drop-in PocketBase OAuth module (zero deps)
- `useAuth.ts` — React hook wrapping the auth instance
- Session auto-restored from `localStorage` on page load

### 2. Backend (Cloudflare Pages Functions)

**Files:**
| File | Method | Purpose |
|---|---|---|
| `functions/api/rooms.ts` | POST | Create meeting + add host participant → return `roomId` + `authToken` |
| `functions/api/rooms/[id]/participants.ts` | POST | Join existing meeting → return `authToken` |
| `functions/api/recordings/start.ts` | POST | Start composite recording (server-side dedup + `allow_multiple_recordings: true`) |
| `functions/api/recordings/track.ts` | POST | Start track recording (per-participant WebM, server-side dedup) |
| `functions/api/summary/[id].ts` | GET | 3-source transcript → OpenRouter → Ollama → CF summary → return all downloads |
| `functions/api/meetings.ts` | GET | List all RealtimeKit meetings for dashboard |

**Why a Worker (not pure SPA)?**
The `authToken` for each participant must be minted server-side using the Cloudflare API token. That token can never live in the browser. The Worker is the trusted intermediary.

### 3. RealtimeKit (Managed by Cloudflare)

Handles all media infrastructure:
- **SFU** — Routes audio/video/screen-share between participants
- **Composite Recording** — Mixed MP4 video + separate MP3 audio, stored in R2 (7-day signed URLs)
- **Track Recording** — Per-participant WebM audio files, one per participant, stored in R2/GCS (7-day signed URLs)
- **Transcription** — Whisper Large v3 Turbo on Workers AI, post-meeting (`transcribe_on_end`)
- **Summary** — Built-in summary engine (`summarize_on_end`, optional, can be overridden)
- **Presets** — Role-based permissions (`group_call_host`, `group_call_participant`)

### 4. OpenRouter (Primary LLM)

Called by the summary Worker endpoint to generate a structured Markdown summary:
- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions`
- Auth: `Bearer {OPENROUTER_API_KEY}`
- Model: `openrouter/free` (auto-routes to available free models)
- Tries primary model first, then free model, then falls back to Ollama
- Returns OpenAI-compatible `{ choices: [{ message: { content } }] }` format

### 5. Ollama Cloud (Fallback LLM)

Called if OpenRouter fails:
- Endpoint: `POST {OLLAMA_BASE_URL}/api/chat`
- Auth: `Bearer {OLLAMA_API_KEY}`
- Model: configurable via `OLLAMA_MODEL` (default: `gpt-oss:120b`)
- Falls back to Cloudflare's built-in summary if Ollama is not configured or fails

### 6. Central Auth Gateway (PocketBase on formsdb.exe.xyz)

Separate infrastructure that handles Google OAuth:
- One Google OAuth client serves all projects
- Popup-based flow with `postMessage` cross-domain communication
- No per-domain Google Console configuration needed
- User data stored in PocketBase `users` collection

## Data Flow

### Meeting Creation

```
User clicks "New Meeting"
        │
        ▼
POST /api/rooms { name, roomTitle }
        │
        ├──→ POST /realtime/kit/{app}/meetings
        │    { record_on_start: false, transcribe_on_end: true, summarize_on_end: true, ... }
        │    ← { id: meetingId }
        │
        ├──→ POST /realtime/kit/{app}/meetings/{meetingId}/participants
        │    { name, preset_name: "group_call_host", custom_participant_id: uuid }
        │    ← { token: authToken }
        │
        └──→ Response: { roomId: meetingId, authToken }
                │
                ▼
        Navigate to /meeting/{roomId}?authToken={token}
                │
                ▼
        useRealtimeKitClient({ authToken }) → <RtkMeeting>
                │
                ▼
        5s after meeting ready:
        ├──→ POST /api/recordings/start { meetingId, authToken }
        │    └──→ GET /recordings?meeting_id= (dedup check)
        │    └──→ POST /recordings { allow_multiple_recordings: true, audio_config: { codec: "MP3" } }
        │    ← { recordingId, status: "RECORDING" }
        │
        └──→ POST /api/recordings/track { meetingId, authToken }
             └──→ GET /recordings?meeting_id= (dedup check, filter by .webm)
             └──→ POST /recordings/track { layers: { default: { outputs: [{ type: "REALTIMEKIT_BUCKET" }] } } }
             ← { recordingId, status: "INVOKED", type: "TRACK" }
```

### Summary Retrieval (3-source transcription pipeline)

```
User visits /summary/{roomId}
        │
        ▼
GET /api/summary/{roomId}
        │
        ├──→ GET /sessions?meeting_id={roomId}
        │    ← Filter for status=ENDED + associated_id match
        │
        ├──→ GET /sessions/{sessionId}/transcript
        │    ← { data: { transcript_download_url } }
        │
        ├──→ fetch(transcript_download_url) → transcriptText
        │
        ├──→ GET /recordings?meeting_id={roomId}
        │    ← Parse: composite (download_url string) + track (download_url array)
        │
        ├──→ If transcriptText is empty:
        │    ├──→ Source 2: For each track WebM file:
        │    │    fetch(downloadUrl) → base64 → Workers AI Whisper
        │    │    → "[Participant {userId}]: {text}"
        │    │
        │    └──→ Source 3: If no track files:
        │         fetch(composite MP3 url) → base64 → Workers AI Whisper
        │
        ├──→ Transcript → OpenRouter (openrouter/free)
        │    POST /v1/chat/completions { model, messages: [system, user] }
        │    ← { choices: [{ message: { content: summary } }] }
        │
        ├──→ If OpenRouter fails → Ollama Cloud fallback
        ├──→ If Ollama fails → CF built-in summary
        │
        └──→ Response: { status, summary, transcriptUrl, recordingUrl,
                         audioRecordingUrl, trackFiles, transcript_text }
                │
                ▼
        Frontend polls every 5s (max 60 polls / 5 min)
        Renders Markdown summary + download cards when status="ok"
```

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| RealtimeKit over raw SFU | Built-in recording, transcript, summary | Days not weeks to MVP |
| Dual recording (composite + track) | Both auto-start 5s after join | Composite for video + mixed audio; track for per-participant audio (no diarization needed) |
| `record_on_start: false` + manual start | Frontend auto-starts via API | Server-side dedup prevents N recordings from N participants |
| `allow_multiple_recordings: true` | Composite recording config | Allows both composite + track to run concurrently |
| Track recording `layers.default.outputs` | `[{ type: "REALTIMEKIT_BUCKET" }]` | CF API requires this (docs say optional but 422 if omitted) |
| Post-meeting transcription only | Whisper (47 Neurons/min) | 18x cheaper than real-time Deepgram |
| Poll on demand for summary | No webhook infrastructure | Simpler, no public URL needed for MVP |
| OpenRouter as primary LLM | Free models, auto-routed | No cost, no rate limit issues with `openrouter/free` |
| Ollama Cloud as fallback | Configurable via env vars | Better summaries than CF built-in; falls back gracefully |
| Central PocketBase auth | Cross-domain Google OAuth | One OAuth client for all projects, zero per-domain config |
| Folder-based dynamic routes | `rooms/[id]/participants.ts` | Cloudflare Pages doesn't support flat `[id]` in filenames |
| Top-level sessions/recordings API | `/sessions?meeting_id=` | Not nested under `/meetings/{id}/` |
| Track dedup by `.webm` extension | Not `type === "TRACK"` | CF list recordings returns `type` as empty string |
| Golden gradient theme | CSS custom properties | Easy to retheme by changing `:root` variables |

## RealtimeKit API Reference

### Base URL
```
https://api.cloudflare.com/client/v4/accounts/{account_id}/realtime/kit/{app_id}/...
```

### Key Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/meetings` | Create meeting (with recording/transcription/summary config) |
| GET | `/meetings?status=ACTIVE` | List meetings |
| PATCH | `/meetings/{id}` | Update meeting (e.g., set status to INACTIVE) |
| POST | `/meetings/{id}/participants` | Add participant → returns auth token |
| GET | `/sessions?meeting_id={id}` | List sessions (filter by meeting) |
| GET | `/sessions/{id}/transcript` | Get transcript download URL |
| GET | `/sessions/{id}/summary` | Get CF built-in summary |
| GET | `/recordings?meeting_id={id}` | Get recording download URLs (composite + track) |
| POST | `/recordings` | Start composite recording (`allow_multiple_recordings: true`) |
| POST | `/recordings/track` | Start track recording (`layers.default.outputs: [{ type: "REALTIMEKIT_BUCKET" }]`) |
| PUT | `/recordings/{id}` | Stop/pause/resume recording (`{ action: "stop" }`) |

### Important Field Names

| API field | Type | Notes |
|---|---|---|
| `transcript_download_url` | string | NOT `downloadUrl` (snake_case) |
| `download_url` | string or array | Composite: string URL; Track: array of `{ layer_name, download_urls }` |
| `audio_download_url` | string | Recording MP3 audio-only URL |
| `associated_id` | string | Meeting ID on session objects |
| `custom_participant_id` | string | Required when adding participants (use UUID) |
| `preset_name` | string | Uses underscores: `group_call_host` |
| `output_file_name` | string | Track files: `{{prefix}}_{{user_id}}_{{peer_id}}_..._audio_{{datetime}}.webm` |
| `type` | string | **Empty in list response** — detect track recordings by `.webm` extension or `Array.isArray(download_url)` |

### Limitations

- **No DELETE** for meetings, recordings, or sessions (only participants, presets, webhooks)
- Sessions and recordings auto-expire from R2 after 7 days
- Meetings can be set to `INACTIVE` to prevent new joins
- No real-time transcription in MVP (post-meeting only)