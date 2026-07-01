# VE-Call

A Google Meet–style video conferencing app with built-in **meeting recording**, **full-meeting transcription**, and **AI-generated summaries + action items** — built on Cloudflare RealtimeKit.

> **Status:** Planning / pre-implementation
> **Stack:** Cloudflare RealtimeKit · Cloudflare Pages Functions · React + Vite · Ollama Cloud API
> **Goal:** Anyone with a room link joins by entering a name. The full meeting is recorded, transcribed, and summarized automatically. Supports 5+ participants.

---

## Why RealtimeKit (not a raw SFU fork)

There are two ways to build on Cloudflare Realtime:

| | cloudflare/meet (Orange Meets) | **RealtimeKit** ← we use this |
|---|---|---|
| Layer | Raw Realtime SFU | High-level SDK on top of SFU |
| You build | Signaling, tracks, rooms, recording, transcript — all from scratch | Just the app shell + branding |
| Recording | Build yourself (MediaRecorder → R2) | Built-in (`record_on_start`, `rtk-recording-toggle`) |
| Transcription | Build yourself (stream audio → STT) | Built-in (`transcribe_on_end`, Whisper on Workers AI) |
| Speaker diarization | Build yourself | Built-in (per-participant audio tracks) |
| Summary | Build yourself | Built-in (`summarize_on_end`) + Ollama enrichment |
| Auth tokens | Your own | Per-participant `authToken` via REST API |
| Roles | Your own | Presets system |
| Effort to MVP | Weeks | Days |

RealtimeKit handles the recording engine, transcription engine, and summary engine. Our code is a thin auth-token-minting Worker + a React shell around `<RtkMeeting>`.

---

## Architecture

```
┌─────────────────┐    authToken     ┌──────────────────────────┐
│  React (Vite)   │ ◀──────────────▶ │  Cloudflare Pages       │
│  @cloudflare/   │                   │  Functions (Worker)     │
│  realtimekit-   │                   │                          │
│  react + -ui    │                   │  POST /api/rooms         │
│                  │                   │   → Create meeting        │
│  <RtkMeeting/>  │                   │   → Add participant       │
│  rtk-recording-  │                   │   → Return authToken      │
│  toggle          │                   │                          │
│                  │                   │  GET  /api/summary/:id   │
│                  │                   │   → Fetch transcript       │
│                  │                   │   → Call Ollama Cloud     │
│                  │                   │   → Return summary        │
└─────────────────┘                   └──────────────────────────┘
        ▲ WebRTC ▲                              │ REST
        │       │                              ▼
        ▼       ▼                  ┌─────────────────────────┐
┌──────────────────────────────────┐│  Ollama Cloud API      │
│  Cloudflare RealtimeKit (managed) ││  (LLM for summary)     │
│  • Media routing (SFU)            │└─────────────────────────┘
│  • Recording engine                │
│  • Transcription engine (Whisper) │
│  • Summary engine (built-in)      │
└──────────────────────────────────┘
```

**Why a Worker (not a pure SPA)?** The `authToken` for each participant must be minted server-side using the Cloudflare API token — that token can never live in the browser. The Worker is the trusted intermediary. Everything else (media, recording, transcription) is handled by RealtimeKit's managed infrastructure.

---

## How Transcription Works

RealtimeKit provides **two transcription modes**, both powered by Cloudflare Workers AI.

### Mode 1 — Real-time transcription (live captions) — *not in MVP*

| | |
|---|---|
| Model | Deepgram Nova-3 on Workers AI |
| When | During the meeting |
| Enable | `permissions.transcription_enabled: true` in preset |
| Cost | ~836 Neurons/min (12 min free/day on Free plan) |
| UI | `rtk-transcripts` component (live captions in sidebar) |

### Mode 2 — Post-meeting transcription — **used in MVP**

| | |
|---|---|
| Model | Whisper Large v3 Turbo on Workers AI |
| When | After the meeting ends |
| Enable | `transcribe_on_end: true` at meeting creation |
| Cost | ~47 Neurons/min (3.5 hrs free/day on Free plan) |
| Output | CSV, JSON, SRT, VTT |
| Retention | 7 days in R2 (presigned URLs) |
| Retrieval | `GET /sessions/{sessionId}/transcript` |

**How it works:**
1. RealtimeKit records each participant's audio as a separate track during the meeting.
2. After the session ends, Whisper Large v3 Turbo processes each track.
3. RealtimeKit assembles a final transcript with **speaker diarization** (because tracks are per-participant).
4. Transcript files are stored in R2 for 7 days.
5. URL is delivered via webhook (`meeting.transcript` event) or REST API.
6. Our Worker polls the REST API on demand (no webhook receiver needed for MVP).

### The Full Pipeline

```
Meeting created with:
  transcribe_on_end: true
  record_on_start: true
  summarize_on_end: true
  ai_config.transcription.language: "en"
        │
        ▼
During meeting ──── RealtimeKit SFU records each participant's audio track
        │
        ▼
Meeting ends ──── Whisper Large v3 Turbo processes each track
        │                          (speaker diarization built-in)
        ▼
Transcript files (CSV/JSON/SRT/VTT) stored in R2, 7-day retention
        │
        ▼
User visits /summary/:roomId
        │
        ▼
Our Worker: GET /sessions/{id}/transcript → fetch JSON transcript
        │
        ▼
Our Worker: POST to Ollama Cloud API with transcript
        │
        ▼
Richer summary + action items (Markdown) rendered in browser
```

### What Cloudflare Handles vs What We Build

| Concern | Who |
|---|---|
| Audio capture per participant | RealtimeKit SFU (managed) |
| STT inference (Whisper) | Workers AI (managed) |
| Speaker diarization | RealtimeKit (per-track processing) |
| Transcript storage (R2, 7 days) | RealtimeKit (managed) |
| Transcript retrieval (REST) | Our Worker |
| Live transcript UI | (skipped in MVP — post-meeting only) |
| Summary generation | Ollama Cloud (our Worker calls it) |
| Summary display | Our React app |

**For transcription specifically, we write ~0 lines of custom STT code.** The only transcription-adjacent code is the Worker endpoint that fetches the already-generated transcript and forwards it to Ollama.

---

## How Recording Works

RealtimeKit records meetings as composite recordings or separate participant audio tracks — all managed.

| | |
|---|---|
| Enable | `record_on_start: true` at meeting creation |
| UI | `rtk-recording-toggle` + `rtk-recording-indicator` (built-in to `<RtkMeeting>`) |
| Storage | RealtimeKit-managed R2 bucket (`realtimekit_bucket_config.enabled: true`) |
| Config | Audio codec (MP3/AAC), video codec (H264/VP8), resolution, watermark, max duration |
| Retrieval | `GET /meetings/{meetingId}/recordings` REST API |
| Retention | 7 days (presigned URLs) |

No MediaRecorder, no R2 upload plumbing, no recording bot. RealtimeKit does it all.

---

## Phased Implementation

### Phase 0 — Cloudflare Setup (manual, ~15 min)
1. Sign in to [Cloudflare dashboard](https://dash.cloudflare.com)
2. Go to **Realtime → Realtime Kit → Create App** → name it `ve-call`
3. Note the **App ID** (`RTK_APP_ID`)
4. Note the **Account ID** (`CF_ACCOUNT_ID`)
5. Create an API token at [profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) with **Realtime → Realtime Admin** permission (`CF_API_TOKEN`)
6. Check the default **presets** in the dashboard — confirm one allows group-call host (camera/mic/screen-share). If not, create one named `group-call-host`.
7. Get an **Ollama Cloud API key** + base URL (`OLLAMA_API_KEY`, `OLLAMA_BASE_URL`) — can be wired later.

> ✅ Milestone: All secrets ready to paste into `.dev.vars`

### Phase 1 — Scaffold the Project (~30 min)
```
ve-call/
├── functions/                 # Cloudflare Pages Functions (Worker backend)
│   └── api/
│       ├── rooms.ts             # POST → create meeting + host participant
│       ├── rooms.[id].participants.ts  # POST → join existing room
│       ├── summary.[id].ts     # GET  → fetch transcript + Ollama summary
│       └── recordings.ts        # GET  → list recordings (dashboard data)
├── src/
│   ├── main.tsx
│   ├── App.tsx                 # Routes: "/" and "/meeting/:roomId" and "/summary/:roomId"
│   ├── lib/
│   │   └── api.ts              # fetch helpers for /api/*
│   └── pages/
│       ├── Home.tsx            # Create/join room form
│       ├── Meeting.tsx         # <RtkMeeting> with authToken
│       ├── Summary.tsx         # Post-meeting summary view
│       └── Dashboard.tsx       # List past meetings
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── .dev.vars                  # local secrets (gitignored)
├── .dev.vars.example          # documented secrets template
└── .gitignore
```

Commands:
```sh
git init
npm create vite@latest . -- --template react-ts
npm i @cloudflare/realtimekit-react @cloudflare/realtimekit-react-ui
npm i -D wrangler @cloudflare/workers-types
```

> ✅ Milestone: Empty app runs at `localhost:8787`

### Phase 2 — Backend Worker: Create Room + Mint AuthToken (~1 hr)

**`functions/api/rooms.ts`** — single POST endpoint:
```ts
POST /api/rooms
  body: { name: string, roomTitle?: string }
  1. POST /accounts/$CF_ACCOUNT_ID/realtime/kit/$RTK_APP_ID/meetings
     body: {
       title: roomTitle || "VE-Call",
       record_on_start: true,
       transcribe_on_end: true,
       summarize_on_end: true,
       ai_config: {
         transcription: { language: "en" },
         summarization: { summary_type: "general", text_format: "markdown" }
       },
       recording_config: {
         realtimekit_bucket_config: { enabled: true },
         audio_config: { codec: "MP3", export_file: true }
       }
     }
  2. POST /accounts/$CF_ACCOUNT_ID/realtime/kit/$RTK_APP_ID/meetings/$meetingId/participants
     body: { name, preset_name: "group-call-host" }
  3. Return { roomId: meetingId, authToken }
```

Store nothing locally — RealtimeKit is the source of truth for meetings, participants, recordings, transcripts.

> ✅ Milestone: `curl -X POST localhost:8787/api/rooms -d '{"name":"Alice"}'` returns `{ roomId, authToken }`

### Phase 3 — Frontend: Home + Meeting UI (~1 hr)

**`src/pages/Home.tsx`**
- Form: name input + optional room title
- "New Room" button → `POST /api/rooms` → navigate to `/meeting/:roomId?authToken=...`
- "Join Room" — reuses an existing `roomId`; calls `POST /api/rooms/:id/participants` returning a fresh authToken

**`src/pages/Meeting.tsx`**
```tsx
const [meeting, initMeeting] = useRealtimeKitClient()
useEffect(() => { initMeeting({ authToken }) }, [authToken])
return (
  <RealtimeKitProvider value={meeting}>
    <RtkMeeting mode="fill" meeting={meeting} showSetupScreen={true} />
  </RealtimeKitProvider>
)
```

The default `<RtkMeeting>` already includes:
- ✅ Video grid (handles 5+ participants out of the box)
- ✅ Mic/camera/screen-share toggles
- ✅ Participant list
- ✅ Recording toggle + indicator (because `record_on_start` is on)

> ✅ Milestone: **Two browsers in a call. 5+ participants join. Recording indicator shows.** 🎯

### Phase 4 — Verify Recording (~30 min)
- After a short call ends, call:
  ```
  GET /accounts/$CF_ACCOUNT_ID/realtime/kit/$RTK_APP_ID/meetings/$meetingId/recordings
  ```
- Confirm a recording object comes back with `download_url` (audio MP3 + video).
- Add a tiny `/recordings/:roomId` debug page to list/download recordings.

> ✅ Milestone: Download an MP4/MP3 of a test call

### Phase 5 — Transcript Display + Ollama Summary (~1.5 hrs)

**`functions/api/summary.[id].ts`** — concrete implementation:
```ts
export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const meetingId = params.id as string

  // 1. Find the latest ended session for this meeting
  const sessionsRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}` +
    `/realtime/kit/${env.RTK_APP_ID}/meetings/${meetingId}/sessions?status=ENDED`,
    { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } }
  )
  const sessions = await sessionsRes.json()
  const session = sessions.data?.sessions?.[0]
  if (!session) return json({ status: "no_ended_session" })

  // 2. Fetch transcript URL
  const tRes = await fetch(
    `.../sessions/${session.id}/transcript`,
    { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } }
  )
  const transcript = await tRes.json()
  if (!transcript.downloadUrl) return json({ status: "processing" })

  // 3. Download the JSON transcript file
  const transcriptText = await (await fetch(transcript.downloadUrl)).text()

  // 4. Call Ollama Cloud
  const ollamaRes = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OLLAMA_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama3.1",
      stream: false,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: transcriptText },
      ],
    }),
  })

  // 5. Return summary + links
  const { message } = await ollamaRes.json()
  return json({
    summary: message.content,
    transcriptUrl: transcript.downloadUrl,
    recordingUrl: recording.downloadUrl,
    sessionId: session.id,
  })
}
```

**`src/pages/Summary.tsx`** — calls `GET /api/summary/:roomId` and renders the Markdown summary.

> ✅ Milestone: Visit `/summary/<roomId>` after a call → see Markdown summary + action items

### Phase 6 — Dashboard + Polish (~1 hr, optional)
- `src/pages/Dashboard.tsx` (`/`) → `GET /api/recordings` → list all meetings (title, date, participants, recording link, summary link)
- Replace Vite default branding with VE-Call logo/colors
- Add a "Copy join link" button on Home
- Handle loading + error states

> ✅ Milestone: Polished home → meeting → summary flow

---

## Environment Variables

Create `.dev.vars` (gitignored) from this template:

```sh
# Cloudflare account
CF_ACCOUNT_ID=your_account_id
CF_API_TOKEN=your_api_token_with_realtime_admin

# RealtimeKit app
RTK_APP_ID=your_realtimekit_app_id

# Ollama Cloud (wire later — not needed for Phases 0-4)
OLLAMA_API_KEY=your_ollama_cloud_key
OLLAMA_BASE_URL=https://your-ollama-cloud-endpoint
```

---

## File Build Order

| # | File | Phase |
|---|---|---|
| 1 | `package.json` | 1 |
| 2 | `vite.config.ts` | 1 |
| 3 | `index.html` | 1 |
| 4 | `tsconfig.json` | 1 |
| 5 | `tsconfig.node.json` | 1 |
| 6 | `.dev.vars.example` | 1 |
| 7 | `.gitignore` | 1 |
| 8 | `src/main.tsx` | 1 |
| 9 | `src/App.tsx` | 1 |
| 10 | `src/lib/api.ts` | 1 |
| 11 | `src/pages/Home.tsx` | 3 |
| 12 | `src/pages/Meeting.tsx` | 3 |
| 13 | `functions/api/rooms.ts` | 2 |
| 14 | `functions/api/rooms.[id].participants.ts` | 3 |
| 15 | `src/pages/Summary.tsx` | 5 |
| 16 | `functions/api/summary.[id].ts` | 5 |
| 17 | `src/pages/Dashboard.tsx` | 6 |
| 18 | `functions/api/recordings.ts` | 6 |

---

## Cost Notes

| Resource | Free tier | Beyond |
|---|---|---|
| Cloudflare Pages | 500 builds/month, unlimited requests | — |
| Workers | 100,000 requests/day | $5/mo Paid plan |
| Workers AI (transcription) | 10,000 Neurons/day | $0.011 / 1,000 Neurons |
| Whisper (post-meeting) | ~47 Neurons/audio-min | ~3.5 hrs meeting/day free |
| Deepgram (real-time) | ~836 Neurons/audio-min | ~12 min meeting/day free |
| RealtimeKit recording | Beta — pricing TBA at GA | Usage-based at GA |
| Ollama Cloud | Per Ollama's plan | — |

**MVP cost on Free plan:** $0, as long as daily meeting audio stays under ~3.5 hours.

---

## Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Platform | RealtimeKit (not raw SFU fork) | Built-in recording, transcript, summary; days not weeks |
| Deployment | Decide later | Start local; pick after MVP works |
| Auth | No auth for MVP | Anyone with room link joins by name; fastest to value |
| Summary LLM | Ollama Cloud API | Coded to env-vars; wired when keys available |
| Transcription mode | Post-meeting only (Whisper) | Cheaper, simpler, covers "transcript full meeting" |
| Summary trigger | Poll on demand | User visits /summary/:id; Worker fetches transcript; no webhook infra needed |
| Repo strategy | Fresh git repo | Cleanest history |
| Participant count | 5+ | SFU scales natively; default presets allow it |

---

## References

- [Cloudflare Realtime overview](https://developers.cloudflare.com/realtime/)
- [RealtimeKit docs](https://developers.cloudflare.com/realtime/realtimekit/)
- [RealtimeKit quickstart](https://developers.cloudflare.com/realtime/realtimekit/quickstart/)
- [UI Kit guide](https://developers.cloudflare.com/realtime/realtimekit/ui-kit/)
- [Transcription docs](https://developers.cloudflare.com/realtime/realtimekit/ai/transcription/)
- [Summary docs](https://developers.cloudflare.com/realtime/realtimekit/ai/summary/)
- [Recording docs](https://developers.cloudflare.com/realtime/realtimekit/recording-guide/)
- [REST API reference](https://developers.cloudflare.com/api/resources/realtime_kit/)
- [realtimekit-web-examples](https://github.com/cloudflare/realtimekit-web-examples)
- [default-meeting-ui example](https://github.com/cloudflare/realtimekit-web-examples/tree/staging/react-examples/examples/default-meeting-ui)

---

## Next Step

Say **"go"** and I'll start Phase 1: `git init` + Vite scaffold + RealtimeKit install.