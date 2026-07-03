# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User's Browser                               │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Home Page   │  │ Meeting Page │  │ Summary Page │               │
│  │  Create/Join │  │ <RtkMeeting> │  │  Polls + MD  │               │
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
│  │  POST /api/rooms          → Create meeting + participant      │   │
│  │  POST /api/rooms/:id/...  → Join existing meeting             │   │
│  │  GET  /api/summary/:id    → Fetch transcript + generate summary│  │
│  │  GET  /api/meetings       → List all meetings                │   │
│  │                                                               │   │
│  │  Secrets: CF_ACCOUNT_ID, CF_API_TOKEN, RTK_APP_ID,            │   │
│  │           OLLAMA_API_KEY, OLLAMA_BASE_URL, OLLAMA_MODEL       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│         │                              │                             │
└─────────┼──────────────────────────────┼─────────────────────────────┘
          │ REST API                      │ REST API
          ▼                              ▼
┌──────────────────────┐     ┌─────────────────────────┐
│  RealtimeKit (CF)     │     │  Ollama Cloud API       │
│                       │     │                         │
│  • SFU media routing  │     │  POST /api/chat         │
│  • Recording engine   │     │  → { message: {         │
│  • Transcription      │     │      content: "..."      │
│    (Whisper on WAI)   │     │    }                    │
│  • Summary engine     │     │  }                       │
│  • R2 storage (7-day) │     └─────────────────────────┘
│                       │
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
| `functions/api/summary/[id].ts` | GET | Fetch ended session → download transcript → call Ollama → fetch recordings → return all |
| `functions/api/meetings.ts` | GET | List all RealtimeKit meetings for dashboard |

**Why a Worker (not pure SPA)?**
The `authToken` for each participant must be minted server-side using the Cloudflare API token. That token can never live in the browser. The Worker is the trusted intermediary.

### 3. RealtimeKit (Managed by Cloudflare)

Handles all media infrastructure:
- **SFU** — Routes audio/video/screen-share between participants
- **Recording** — Composite MP4 + separate MP3 audio, stored in R2
- **Transcription** — Whisper Large v3 Turbo on Workers AI, post-meeting
- **Summary** — Built-in summary engine (optional, can be overridden by Ollama)
- **Presets** — Role-based permissions (`group_call_host`, `group_call_participant`)

### 4. Ollama Cloud (External LLM)

Called by the summary Worker endpoint to generate a richer Markdown summary:
- Endpoint: `POST {OLLAMA_BASE_URL}/api/chat`
- Auth: `Bearer {OLLAMA_API_KEY}`
- Model: configurable via `OLLAMA_MODEL` (default: `llama3.1:8b`)
- Falls back to Cloudflare's built-in summary if Ollama is not configured or fails

### 5. Central Auth Gateway (PocketBase on formsdb.exe.xyz)

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
        │    { record_on_start: true, transcribe_on_end: true, summarize_on_end: true, ... }
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
```

### Summary Retrieval

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
        ├──→ If transcriptText is empty → return "no speech" summary
        │
        ├──→ POST {OLLAMA_BASE_URL}/api/chat (if configured)
        │    { model, messages: [{ system: SUMMARY_PROMPT }, { user: transcriptText }] }
        │    ← { message: { content: summary } }
        │
        ├──→ If Ollama fails → GET /sessions/{sessionId}/summary (CF built-in)
        │
        ├──→ GET /recordings?meeting_id={roomId}
        │    ← { data: [{ download_url, audio_download_url }] }
        │
        └──→ Response: { status, summary, transcriptUrl, recordingUrl, audioRecordingUrl }
                │
                ▼
        Frontend polls every 5s if status="processing"
        Renders Markdown summary when status="ok"
```

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| RealtimeKit over raw SFU | Built-in recording, transcript, summary | Days not weeks to MVP |
| Post-meeting transcription only | Whisper (47 Neurons/min) | 18x cheaper than real-time Deepgram |
| Poll on demand for summary | No webhook infrastructure | Simpler, no public URL needed for MVP |
| Ollama Cloud for summary | Configurable via env vars | Better summaries than CF built-in; falls back gracefully |
| Central PocketBase auth | Cross-domain Google OAuth | One OAuth client for all projects, zero per-domain config |
| Folder-based dynamic routes | `rooms/[id]/participants.ts` | Cloudflare Pages doesn't support flat `[id]` in filenames |
| Top-level sessions/recordings API | `/sessions?meeting_id=` | Not nested under `/meetings/{id}/` |
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
| GET | `/recordings?meeting_id={id}` | Get recording download URLs |

### Important Field Names

| API field | Type | Notes |
|---|---|---|
| `transcript_download_url` | string | NOT `downloadUrl` (snake_case) |
| `download_url` | string | Recording MP4 download URL |
| `audio_download_url` | string | Recording MP3 audio-only URL |
| `associated_id` | string | Meeting ID on session objects |
| `custom_participant_id` | string | Required when adding participants (use UUID) |
| `preset_name` | string | Uses underscores: `group_call_host` |

### Limitations

- **No DELETE** for meetings, recordings, or sessions (only participants, presets, webhooks)
- Sessions and recordings auto-expire from R2 after 7 days
- Meetings can be set to `INACTIVE` to prevent new joins
- No real-time transcription in MVP (post-meeting only)