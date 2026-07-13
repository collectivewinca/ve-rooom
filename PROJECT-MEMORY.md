# VE Rooom — Project Memory File

> **Purpose:** This is the canonical project memory for the VE Rooom (ve-call) project. It captures the full journey from idea to deployed product, every decision, every bug, and the current state — so any future session (human or AI) can pick up where we left off without re-reading 10 sessions of chat history.
>
> **Generated:** July 8, 2026 — after reviewing all 10 opencode chat sessions (134 user messages) for this project.

---

## 1. Project Identity

| Field | Value |
|---|---|
| **Name** | VE Rooom (3 o's) |
| **Repo** | https://github.com/collectivewinca/ve-rooom |
| **Live** | https://ve-rooom.pages.dev |
| **Local path** | `D:\Internship\Projects\ve-call` |
| **Started** | July 2026 |
| **Intern** | Labh Khanna (labh.k18@gmail.com) |
| **Goal** | Google Meet–style video conferencing with automatic recording, transcription, and AI summaries |
| **Status** | Deployed and working. Dual recording confirmed working. Transcription pipeline tested with real audio. Summary generation working with OpenRouter. |

---

## 2. The Journey (Chronological Narrative)

### How it started

The user came with a strategy from ChatGPT: don't build WebRTC from scratch — fork Cloudflare's existing `cloudflare/meet` repo (formerly Orange Meets) and strip it down. Three options were on the table:
1. Fork `cloudflare/meet` (Remix + CF Calls + Durable Objects)
2. Use RealtimeKit React UI Kit (`@cloudflare/realtimekit-react-ui`)
3. Build from scratch

### The fork attempt (Session 1)

Cloned `cloudflare/meet` into `D:\Internship\Projects\ve-call`. Installed deps. Explored the Remix app structure — routes, components, Durable Objects. Started rebranding "Orange Meets" → "VE Call", stripping RaiseHandButton, AiButton, etc.

**Then the user said: "delete everything lets restart."**

### The pivot to RealtimeKit (Session 1)

The user provided a fresh context summary explaining the real goal: a Google Meet clone with recording + transcription + AI summaries. The key insight: **RealtimeKit has built-in recording, transcription, and summary engines** — forking `cloudflare/meet` (which uses the lower-level SFU) would mean building all those features ourselves.

**Decision: Use RealtimeKit UI Kit, not the fork.** Fresh git repo, Vite + React + TypeScript.

### Phase-by-phase build (Sessions 1-3)

| Phase | What was built |
|---|---|
| **0 (user)** | Created RealtimeKit app in CF dashboard, got credentials, checked presets |
| **1** | Vite + React + TS scaffold with git |
| **2** | `functions/api/rooms.ts` — creates meeting + adds host participant, returns authToken |
| **3** | `Home.tsx` (create/join), `Meeting.tsx` (`<RtkMeeting>` wrapper), `participants.ts` (join room) |
| **4** | Recording config: `record_on_start: true` initially, later changed to `false` + manual 5s auto-start |
| **5** | `summary/[id].ts` (transcript + summary), `Summary.tsx` (polls + Markdown render) |
| **6** | `Dashboard.tsx` + `meetings.ts` (list all meetings) |
| **UI** | Full redesign: dark theme, golden gradient on black, glassmorphic navbar, custom favicon, responsive |
| **Auth** | Google OAuth via central PocketBase (`formsdb.exe.xyz`) |
| **Deploy** | CF Pages project `ve-rooom`, GitHub-connected auto-deploy |

### The transcription battle (Sessions 1-2)

This was the hardest part. The problem: **CF's `transcribe_on_end` was producing empty transcripts** even for meetings with real conversation.

Root cause investigation:
- `ai_config.transcription.language` only accepts Deepgram-style codes (`"en-US"`, `"en-IN"`) — sending `"en"` may have silently rejected the entire `ai_config` block
- `transcribe_on_end` processes **intermediate participant audio tracks** (not the composite recording) — if those tracks are empty/silent, Whisper produces nothing
- The composite recording (MP3) captures mixed audio fine, but it's a separate pipeline

**Solution: Dual recording (composite + track) + 3-source transcription pipeline**

### The track recording saga (Session 2)

Adding track recording (`POST /recordings/track`) was a multi-error debugging journey:

| Error | Fix |
|---|---|
| `422: "layers" is required` | Docs say optional, but API requires `layers` field |
| `422: "layers.default.outputs" is required` | Must include `outputs` array in layer config |
| `422: "outputs[0].type" is required` | Each output needs a `type` field |
| `422: "type" must be one of [REALTIMEKIT_BUCKET, ...]` | Use `type: "REALTIMEKIT_BUCKET"` |
| `422: "layers.default.media_kind" is not allowed` | Remove `media_kind` (track is audio-only by default) |
| `500: Cannot read properties of undefined (reading 'id')` | Response shape is `data.id`, not `data.recording.id` (unlike composite) |
| `type` field always empty in list response | Detect track recordings by `.webm` extension or `Array.isArray(download_url)` |

**The user got frustrated:** "are these error making sense or we just looping from error to error??" — but we pushed through and got it working.

### The summary LLM evolution

1. **Ollama Cloud** — first LLM wired up. API key stored in `.dev.vars`.
2. **OpenRouter** — added as primary after Ollama key expired/returned 401. Uses `openrouter/free` (auto-routes to free models). API key stored in `.dev.vars`.
3. **CF built-in summary** — last resort fallback

### Real conversation test (Session 2)

The user did a real test meeting with actual conversation. Results:
- **Local Whisper `base.en`**: Transcribed background video audio (Mid-Journey Medical tech news) — missed the actual conversation
- **Workers AI `whisper-large-v3-turbo`**: Correctly transcribed the actual meeting conversation about testing the app, Cloudflare RealtimeKit, auto-recording features
- **Issue found**: The worker was picking up the wrong recording session (an older one, not the latest). This needed fixing.
- **Resolution**: Real speech was successfully transcribed — 2,108 chars of actual content

### The JSSA-amply test

A 106-minute recording (`jssa-amply.mp3`, 243MB) was used to test the transcription pipeline at scale. Since it exceeded the 25MB Workers AI limit, it was split into 10-minute segments:
- `transcribe_all.py` / `run_all_segments.py` — Python scripts to chunk and transcribe
- `segments/` — directory with chunked audio files
- `jssa-amply-summary.md` — the final summary
- `jssa-amply-transcript-clean.txt` / `jssa-amply-transcript-final.txt` — cleaned transcripts

### Session 3-4: Polish

- Mobile responsiveness fixes (header, hamburger menu at 640px)
- Required Google sign-in to create/join meetings
- Track recording confirmed working with dedup
- Per-participant WebM files downloaded and verified
- Recording length comparison: composite 209s vs track 137s (participant left early — correct behavior)
- Track files are time-aligned (silence preserved, not concatenated speech)

### Session 5: Stop recording fix

- Recording was starting before the user clicked join (during the setup/config screen)
- Fixed to only start after meeting is actually joined
- Recording indicator simplified: just red blinking dot, no extra messages

### Session 6: Refactor + auth token security (commit aa344f1, Jul 10)

- DRY utils: `functions/lib/env.ts`, `response.ts`, `rate-limit.ts`, `recordings.ts`, `summarizer.ts`
- Rate limiting via KV (30 req/60s per IP)
- CSS split into `src/styles/*.css` (dashboard, home, meeting, navbar, shared, summary, variables)
- Dashboard search + skeletons
- ErrorBoundary component
- **Critical regression**: `record_on_start` changed to `false`, `recording_config` removed from meeting creation → recordings became client-side API-triggered only

### Session 7: Recording + transcription deep analytics fix (commit 6d80cb1, Jul 13)

**Investigation:** Alet's meeting (yuga-v2, Jul 13) had no transcription. Deep analysis revealed:

1. **RTK native transcription never worked** — `transcription_minutes_consumed: 0` for ALL sessions, `transcript_download_url` returns 0-byte CSV for every meeting including older "working" ones
2. **Whisper on Alet's audio produced hallucination** — "Thank you. Thank you. Thank you." (219 chars) across all chunks. ffmpeg volumedetect showed `mean_volume: -91.0 dB, max_volume: -91.0 dB` — **digital silence**. Video was a frozen frame for 591/599s. Alet likely had mic muted or stayed on setup screen.
3. **Hallucination filter had a bug** — `wt.length < 200` threshold let the 219-char "Thank you" repetition through
4. **Track recordings produce empty files** — `file_size: 0` for ALL recent meetings (both Alet's and Garvit's). The `realtimekit_bucket_config` was removed from meeting creation in the refactor.
5. **Root cause of recording regression**: Commit `00d5328` (Jul 7) changed `record_on_start: true → false` and removed `recording_config` from `rooms.ts`. Older meetings (JSSA, ve-room-july4) had `start_reason: RECORD_ON_START` and real audio. New meetings had `start_reason: API_CALL` with timing gaps.

**Fixes applied (6 files, commit 6d80cb1):**

| File | Fix |
|---|---|
| `functions/api/rooms.ts` | Reverted `record_on_start: true`, restored `recording_config` (bucket + MP3 codec) |
| `src/pages/Meeting.tsx` | Removed manual `startCompositeRecording`/`startTrackRecording` calls, kept `stopAllRecordings` as fallback, `isRecording` starts `true` |
| `functions/api/transcribe.ts` | 10 MB chunks with 25s time budget, partial progress saved to KV + resumes on retry, silent detection via hallucination repetition ratio, 200 MB max file size |
| `functions/api/summary/[id].ts` | Generates summary server-side when transcript cached but no summary, returns `needs_transcription` for empty RTK transcript |
| `src/pages/Summary.tsx` | Handles `silent` status (clear "microphone muted" message), `processing` status (auto-retry with progress), removed blur for silent meetings |
| `src/lib/api.ts` | Added `silent` + `processing` status types, `numChunks`/`chunksDone`/`totalChunks` fields |

**Hallucination filter (new algorithm):**
- Word repetition ratio: `uniqueWords / totalWords < 0.15` → hallucination
- Sentence repetition ratio: `uniqueSentences / totalSentences < 0.2` → hallucination
- Applied to both track-file and composite-chunk Whisper paths

**Large recording flow (1hr+ = ~140 MB at 320 kb/s):**
- 10 MB chunks = 14 chunks for 1-hour meeting
- 25s time budget per Worker invocation = ~2 chunks per call
- Partial progress saved to KV key `meeting:{id}:partial`
- Frontend receives `processing` status, auto-retries after 3s
- Worker reads partial from KV, resumes from last chunk
- Final chunk: saves full transcript to KV, deletes partial key, returns `transcribed`
- ~7 Worker invocations for 1-hour meeting (~140s total, each under 30s limit)

**Track recording issue:** Track recordings return `file_size: 0` and `download_url.links: []` for ALL meetings. This is a pre-existing RTK issue, not caused by our code changes. **Decision (Jul 13): removed track recording entirely.** Deleted `functions/api/recordings/track.ts`, removed `TrackFile` types from `functions/lib/recordings.ts` and `src/lib/api.ts`, removed track file Whisper block from `functions/api/transcribe.ts`, removed `trackFiles` from all `summary/[id].ts` responses, removed track debug rows + download cards from `Summary.tsx`. The composite MP3 fallback in `transcribe.ts` is the sole transcription source. Speaker diarization on composite audio is a future feature (WhisperX/Deepgram/SarvamAI).

---

## 3. Architecture Summary

```
Browser (React SPA)
    │
    ├── Home (/) — create or join meeting
    ├── Dashboard (/dashboard) — past meetings list
    ├── Meeting (/meeting/:roomId) — <RtkMeeting> + recording indicator (RTK auto-records)
    └── Summary (/summary/:roomId) — polls API, renders Markdown + downloads
    │
    │ fetch() →
    │
Cloudflare Pages Functions (Workers)
    ├── POST /api/rooms — create meeting (record_on_start: true + recording_config)
    ├── POST /api/rooms/:id/participants — join meeting
    ├── POST /api/recordings/stop — stop recordings (fallback; RTK auto-stops on ALL_PEERS_LEFT)
    ├── POST /api/transcribe — Whisper chunked transcription (10MB chunks, 25s time budget, KV partial resume)
    ├── POST /api/generate-summary — LLM summary from transcript
    ├── GET  /api/recording/[key] — Serve recording file from R2 (long-term storage, works after RTK 7-day expiry)
    ├── POST /api/recording/scan — List R2 objects for a meeting, cache refs in KV
    ├── GET  /api/summary/:id — RTK transcript → LLM summary, or needs_transcription → frontend triggers /api/transcribe. Falls back to R2 URLs when RTK recording URLs are missing.
    └── GET  /api/meetings — list all meetings
    │
    │ REST API →
    │
Cloudflare RealtimeKit (managed SFU)
    ├── WebRTC media routing
    ├── Composite recording (MP4 + MP3) → R2 (via RTK auto-transfer) + RTK bucket (7-day expiry) — auto-starts on session start
    ├── Track recording (WebM per participant) → REMOVED (RTK produced 0-byte files)
    ├── Transcription (transcribe_on_end) — returns 0-byte CSV (not working)
    └── Summary engine (summarize_on_end) — not producing summaries
    │
External services:
    ├── OpenRouter (openrouter/free) — primary summary LLM
    ├── Ollama Cloud (gpt-oss:120b) — fallback summary LLM
    ├── Cloudflare Workers AI (whisper-large-v3-turbo) — transcription
    └── PocketBase (formsdb.exe.xyz) — Google OAuth gateway
```

---

## 4. Key Technical Decisions

| # | Decision | Why |
|---|---|---|
| 1 | RealtimeKit over forking cloudflare/meet | Built-in recording/transcript/summary = days not weeks |
| 2 | `record_on_start: true` (reverted Jul 13) | RTK auto-records when session starts — more reliable than client-side API calls. Commit 00d5328 changed it to false which caused silent/empty recordings. |
| 3 | `recording_config` on meeting creation | Bucket config + MP3 codec must be set at meeting creation time, not at API-triggered recording start |
| 4 | `allow_multiple_recordings: true` | Required for composite + track to run concurrently |
| 5 | Post-meeting Whisper only (no live captions) | 47 Neurons/min vs 836 for real-time Deepgram — 18x cheaper |
| 6 | Poll on demand for summary (no webhooks) | Simpler, no public URL needed for MVP |
| 7 | OpenRouter as primary LLM | Free models, auto-routed, no rate limit issues |
| 8 | Ollama Cloud as fallback | Configurable model, better than CF built-in |
| 9 | Folder-based dynamic routes in Pages Functions | `[id]` flat filenames don't work in CF Pages |
| 10 | Top-level sessions/recordings API | `/sessions?meeting_id=` not `/meetings/{id}/sessions` |
| 11 | Central PocketBase auth | One Google OAuth client for all projects |
| 12 | Track dedup by `.webm` extension | `type` field is always empty in CF list response |
| 13 | 10 MB Whisper chunks (reduced from 20 MB) | Faster per-chunk processing (~7s), more chunks fit in 25s time budget |
| 14 | 25s time budget per Worker invocation | CF Pages Functions have 30s wall-clock limit — stay under it |
| 15 | Partial progress in KV for large files | `meeting:{id}:partial` key stores chunk index + transcript parts, resumes on retry |
| 16 | Hallucination filter via repetition ratio | Word ratio < 0.15 or sentence ratio < 0.2 = hallucination. Old filter (`wt.length < 200`) let 219-char "Thank you" through |
| 17 | Silent recording detection | All chunks hallucinated → return `silent` status with "mic muted" message |
| 18 | `stopAllRecordings` kept as fallback | RTK auto-stops on ALL_PEERS_LEFT, but client-side stop ensures clean shutdown |
| 19 | RTK native transcription is non-functional | `transcription_minutes_consumed: 0` for ALL sessions. Whisper on composite MP3 is the actual transcription path |
| 20 | Track recordings removed (Jul 13) | `file_size: 0` for all track recordings. Track endpoint, types, and transcription logic removed. Composite MP3 is the sole transcription source. Diarization on composite audio is a future feature. |

---

## 5. API Issues Discovered & Fixed

| Issue | Fix |
|---|---|
| `custom_participant_id` required | Added `crypto.randomUUID()` |
| Preset `group-call-host` → `group_call_host` | Underscores not hyphens |
| Pages Functions `[id]` flat filenames don't work | Restructured to `rooms/[id]/participants.ts` |
| Sessions API 404 at `/meetings/{id}/sessions` | Use top-level `/sessions?meeting_id={id}` |
| Transcript field `downloadUrl` doesn't exist | Actual field: `transcript_download_url` |
| Recordings 404 at `/meetings/{id}/recordings` | Use top-level `/recordings?meeting_id={id}` |
| Recording field `downloadUrl` doesn't exist | Actual field: `download_url` + `audio_download_url` |
| Infinite polling on empty transcripts | Detect empty → return "no speech detected" summary |
| `display: block` on `rtk-meeting` breaks layout | Use `!important` on width/height |
| Track 422: `"layers" is required` | Docs say optional but API requires it |
| Track 422: `"layers.default.outputs" is required` | Must be array with `type: "REALTIMEKIT_BUCKET"` |
| Track 422: `"layers.default.media_kind" is not allowed` | Remove `media_kind` |
| Track 500: `Cannot read properties of undefined` | Response shape is `data.id`, not `data.recording.id` |
| Workers AI Whisper 401 | CF API token needs `Workers AI:Run` scope |
| Whisper misdetects language on silence | Force `language: "en"` in request body |
| Ollama Cloud 401 | Key expired → switched to OpenRouter as primary |
| useEffect timer cleared before 5s | Use `meetingRef` + `[roomId]` deps |
| SVG `stroke-width` warnings in React | Use camelCase: `strokeWidth`, `strokeLinecap` |
| Room ID trailing-slash 405 | Trim + remove trailing slash in `joinRoom` |
| Vite dev can't reach Functions | Add `server.proxy["/api"]` → `localhost:8788` |
| Recording starts during setup screen | Moved auto-start to after `initMeeting` resolves |
| Summary page picks wrong recording session | Filter sessions by `associated_id` + latest `ENDED` |

---

## 6. File Map

### Source code
```
src/
├── App.tsx                      # Routes: /, /dashboard, /meeting/:roomId, /summary/:roomId
├── main.tsx                     # React entry point
├── components/
│   ├── Layout.tsx               # Glassmorphic navbar with auth controls (skips /meeting/*)
│   └── ErrorBoundary.tsx        # React error boundary
├── lib/
│   ├── api.ts                   # Frontend fetch helpers + types (silent/processing status)
│   ├── formsdb-auth.js          # Central Google auth via PocketBase (drop-in, zero deps)
│   ├── formsdb-auth.d.ts        # TS declarations for auth module
│   └── useAuth.ts               # React hook for auth state
├── pages/
│   ├── Home.tsx                 # Create/join meeting with tab toggle + feature badges
│   ├── Meeting.tsx              # RtkMeeting + recording indicator (RTK auto-records) + stop fallback
│   ├── Summary.tsx              # Polls, handles silent/processing/needs_transcription, Markdown + downloads
│   └── Dashboard.tsx            # Past meetings with stats cards + search
└── styles/
    ├── variables.css            # CSS custom properties (colors, spacing)
    ├── shared.css               # Base styles, buttons, forms
    ├── navbar.css               # Glassmorphic navbar
    ├── home.css                 # Home page styles
    ├── meeting.css              # Meeting page + recording indicator
    ├── dashboard.css            # Dashboard grid + cards
    └── summary.css              # Summary page + download cards + blur overlay
```

### Backend (Pages Functions)
```
functions/
├── env.d.ts                     # Env interface for Workers
├── auth.ts                      # verifyAuthToken via PocketBase
├── lib/
│   ├── env.ts                   # AppEnv interface
│   ├── kv.ts                    # MeetingMeta, ParticipantRecord, CachedResult helpers
│   ├── response.ts              # jsonResponse() helper
│   ├── rate-limit.ts            # checkRateLimit() via KV (30 req/60s)
│   ├── recordings.ts            # parseSessionRecordings() + TrackFile types
│   └── summarizer.ts            # generateSummary() — OpenRouter → Ollama fallback
└── api/
    ├── rooms.ts                 # POST → create meeting (record_on_start: true + recording_config)
    ├── rooms/[id]/participants.ts # POST → join existing room
    ├── recordings/
    │   ├── start.ts             # POST → composite recording (kept for manual start if needed)
    │   └── stop.ts              # POST → stop all recordings (fallback on roomLeft)
    ├── recording/
    │   ├── [key]/index.ts       # GET → serve recording file from R2 by object key
    │   └── scan.ts              # POST → list R2 objects for a meeting, cache refs in KV
    ├── transcribe.ts            # POST → chunked Whisper (10MB chunks, 25s budget, KV partial resume, silent detection)
    ├── generate-summary.ts      # POST → LLM summary from transcript text
    ├── summary/[id].ts          # GET → RTK transcript → summary, or needs_transcription
    └── meetings.ts              # GET → list all meetings for dashboard
```

### Config
```
wrangler.toml                    # Cloudflare Pages config
vite.config.ts                   # Vite config with /api proxy to localhost:8788
tsconfig.json                    # TypeScript config
.dev.vars.example                 # Environment variable template
```

### Docs
```
docs/
├── README.md                    # Docs index
├── ARCHITECTURE.md               # System design, data flows, dual recording pipeline
├── RECORDINGS.md                 # Composite + track recording, API schema, dedup logic
├── TRANSCRIPTION.md              # 3-source pipeline, 3-tier summary, Whisper API
├── CLOUDFLARE-REALTIMEKIT.md     # RTK overview, API reference, free/paid limits
├── TECH-STACK.md                 # All technologies used (with non-tech summary)
├── AUTH.md                       # Google OAuth via PocketBase
└── INTERNSHIP.md                 # Project history, decisions, future work
```

### Test/transcription artifacts (root)
```
jssa-amply.mp3                   # 106-min test recording (243MB)
jssa-amply-summary.md            # AI summary of JSSA-amply meeting
jssa-amply-transcript-clean.txt   # Cleaned transcript
jssa-amply-transcript-final.txt   # Final transcript
transcribe.py / transcribe_all.py # Python transcription scripts
run_all_segments.py / run_seg0.py
generate_summary.py / resume_transcribe.py
segments/                         # Chunked audio segments
segment_000_meta.json / segment_000_transcript.txt
transcription_log.txt
test_ollama.py / test_whisper.py  # Local test scripts
```

---

## 7. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CF_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `CF_API_TOKEN` | Yes | CF API token — needs Realtime admin **+ Workers AI:Run** scope |
| `RTK_APP_ID` | Yes | RealtimeKit app ID |
| `RECORDINGS_BUCKET` | Auto | R2 bucket binding (`ve-room`) — auto-configured via wrangler.toml, no secret needed |
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key (free models available) |
| `OPENROUTER_MODEL` | No | Primary model (default: `openrouter/free`) |
| `OPENROUTER_FREE_MODEL` | No | Fallback model (default: `openrouter/free`) |
| `OLLAMA_API_KEY` | No | Ollama Cloud API key — fallback LLM |
| `OLLAMA_BASE_URL` | No | Ollama Cloud base URL (default: `https://ollama.com`) |
| `OLLAMA_MODEL` | No | Ollama model (default: `gpt-oss:120b`) |

> ⚠️ **Note:** Never commit credentials to git. Always check `.dev.vars` for current values.

---

## 8. How to Run

### Local development
```sh
npm install
cp .dev.vars.example .dev.vars   # Fill in credentials
npm run build
npx wrangler pages dev dist --port 8787
```
Open http://127.0.0.1:8787

### Deploy
```sh
npm run build
npx wrangler pages deploy dist --project-name ve-rooom --branch main
```

Set production secrets:
```sh
echo "value" | npx wrangler pages secret put VAR_NAME --project-name ve-rooom
```

---

## 9. The Full Meeting Flow (End to End)

### Join → Record → End → Summarize

```
1. User opens ve-rooom.pages.dev
   → Google sign-in (optional but enforced for create/join)
   → Home page shows: "New Meeting" tab + "Join Meeting" tab

2. User clicks "New Meeting" with a room title
   → POST /api/rooms { name, roomTitle }
   → Worker calls CF: POST /realtime/kit/{app}/meetings
     { record_on_start: true, transcribe_on_end: true, summarize_on_end: true,
       recording_config: { realtimekit_bucket_config: { enabled: true },
                            audio_config: { codec: "MP3", export_file: true } },
       ai_config: { transcription: { language: "en-US" }, summarization: {...} } }
   → Worker calls CF: POST /realtime/kit/{app}/meetings/{id}/participants
     { name, preset_name: "group_call_host", custom_participant_id: uuid }
   → Returns { roomId, authToken }
   → Navigate to /meeting/{roomId} (token stored in sessionStorage)

3. Meeting page mounts
   → useRealtimeKitClient({ authToken }) → initMeeting()
   → <RtkMeeting> renders (camera, mic, screen share, participant grid)
   → User sees device setup screen first (camera/mic selection)
   → RTK auto-starts recording on session start (record_on_start: true)
   → Red pulsing recording indicator shows immediately
   → "Copy Join Link" button → copies /?room={roomId} to clipboard

4. User clicks Join (enters actual meeting)
   → RTK session starts, composite recording captures audio + video
   → stopAllRecordings is wired to roomLeft event as a safety fallback

5. Other participants join via shared link
   → Home page auto-fills room ID from ?room= param
   → POST /api/rooms/{id}/participants { name } → returns authToken
   → Navigate to /meeting/{roomId} (token stored in sessionStorage)

6. Meeting ends (all participants leave)
   → RTK stops recording (ALL_PEERS_LEFT)
   → roomLeft event fires → client calls POST /api/recordings/stop (fallback)
   → "Summary" link appears in meeting overlay

7. User visits /summary/{roomId}
   → GET /api/summary/{roomId}
   → Worker: GET /sessions?meeting_id={roomId} → find latest ENDED session
   → Worker: GET /sessions/{sessionId}/transcript → transcript_download_url
   → Worker: fetch(transcript_download_url) → transcriptText (usually 0 bytes — RTK native transcription not working)

   → IF transcriptText is empty:
     → Returns { status: "needs_transcription", audioRecordingUrl, trackFiles }
     → Frontend calls POST /api/transcribe { meetingId, audioUrl, trackFiles }

   → transcribe.ts (Whisper fallback):
     → IF cached transcript in KV → return it immediately
     → IF track files exist → try Whisper on each (usually empty, skipped)
     → IF composite audio URL → chunked Whisper:
       → Probe audio size via Range header
       → 10 MB chunks, 25s time budget per Worker invocation
       → For each chunk: fetch Range → Workers AI whisper-large-v3-turbo
       → Hallucination filter: word repetition ratio < 0.15, sentence ratio < 0.2
       → IF time budget exceeded → save partial to KV, return { status: "processing" }
       → Frontend auto-retries after 3s, Worker resumes from KV partial
       → IF all chunks hallucinated → return { status: "silent" }
       → IF transcript produced → save to KV, return { status: "transcribed" }

   → IF transcribed:
     → Frontend calls POST /api/generate-summary { transcript, meetingId }
     → Worker: generateSummary() → OpenRouter (openrouter/free) → Ollama fallback
     → Save transcript + summary to KV
     → Return { status: "ok", summary }

   → IF silent:
     → Display "Silent Recording" message: "No speech detected. Microphone may have been muted."
     → Show recording download links for manual verification

   → Renders Markdown summary + download cards:
     - Transcript CSV / TXT
     - Recording MP4 (composite video)
     - Audio MP3 (composite audio)
     - Per-participant WebM files (if any)

8. User visits /dashboard
   → GET /api/meetings → list all meetings with status
   → Click any meeting → go to summary page
```

---

## 10. Cloudflare RealtimeKit API Reference (what we learned)

### Base URL
```
https://api.cloudflare.com/client/v4/accounts/{account_id}/realtime/kit/{app_id}/...
```

### Endpoints used
| Method | Path | Purpose |
|---|---|---|
| POST | `/meetings` | Create meeting |
| GET | `/meetings?status=ACTIVE` | List meetings |
| PATCH | `/meetings/{id}` | Update (e.g., set INACTIVE) |
| POST | `/meetings/{id}/participants` | Add participant → returns token |
| GET | `/sessions?meeting_id={id}` | List sessions (top-level, not nested) |
| GET | `/sessions/{id}/transcript` | Get transcript download URL |
| GET | `/sessions/{id}/summary` | Get CF built-in summary |
| GET | `/recordings?meeting_id={id}` | Get recording download URLs |
| POST | `/recordings` | Start composite recording |
| POST | `/recordings/track` | Start track recording |
| PUT | `/recordings/{id}` | Stop/pause/resume recording |

### Field name gotchas
| API field | Type | Notes |
|---|---|---|
| `transcript_download_url` | string | NOT `downloadUrl` |
| `download_url` | string or array | Composite: string; Track: array of `{ layer_name, download_urls }` |
| `audio_download_url` | string | MP3 URL (composite only) |
| `associated_id` | string | Meeting ID on session objects |
| `custom_participant_id` | string | Required when adding participants |
| `preset_name` | string | Uses underscores: `group_call_host` |
| `type` | string | **Empty in list response** — detect track by `.webm` extension |
| `file_size` | number | Always `0` for track recordings (CF quirk) |

### Track recording layers schema (REQUIRED despite docs saying optional)
```json
{
  "meeting_id": "...",
  "layers": {
    "default": {
      "file_name_prefix": "participant",
      "outputs": [
        { "type": "REALTIMEKIT_BUCKET" }
      ]
    }
  }
}
```

### No DELETE endpoints
RealtimeKit REST API does NOT support deleting meetings, recordings, or sessions. Only:
- Participants can be deleted
- Presets can be deleted
- Webhooks can be deleted
- Meetings can be set to `INACTIVE` (not deleted)
- Recordings/sessions auto-expire from R2 after 7 days

---

## 11. Cost Analysis

| Service | Free Tier | Beyond |
|---|---|---|
| Cloudflare Pages | 500 builds/mo, unlimited requests | — |
| Workers | 100,000 requests/day | $5/mo Paid plan |
| Workers AI (Whisper) | 10,000 Neurons/day (~215 min/day @ 46.4 Neurons/min) | $0.011 / 1,000 Neurons |
| RealtimeKit | Beta (free) | Usage-based at GA |
| OpenRouter | Free models available via `openrouter/free` | Per-model pricing |
| Ollama Cloud | Free tier | Per-model pricing |

**MVP cost on Free plan:** $0, as long as daily meeting audio stays under ~3.6 hours (Whisper batch) or ~12 minutes (live Deepgram).

---

## 12. What's Done vs What's Not

### ✅ Done
- Video conferencing with 5+ participants
- Composite recording (MP4 video + MP3 audio) — auto-starts via `record_on_start: true`
- Track recording endpoint exists but produces empty files (RTK issue)
- `stopAllRecordings` fallback on roomLeft
- Chunked Whisper transcription (10 MB chunks, 25s time budget, KV partial resume)
- Hallucination filter (word + sentence repetition ratio)
- Silent recording detection with clear user message
- Summary generation (OpenRouter → Ollama fallback)
- 7-section Markdown summary format
- Google OAuth via central PocketBase
- Dashboard with meeting history
- Mobile-responsive UI (golden gradient on black)
- Recording indicator (red pulsing dot, shown immediately)
- Copy join link button
- Download cards (CSV, transcript, MP4, MP3, WebM)
- Deployed to Cloudflare Pages (GitHub auto-deploy)
- Full docs suite (7 doc files)
- JSSA-amply 106-min meeting transcribed and summarized (manual pipeline)

### ❌ Not Done / Known Issues
- [ ] RTK native transcription (`transcribe_on_end`) not working — returns 0-byte CSV for all sessions
- [ ] Track recordings produce empty files (`file_size: 0`) — RTK issue, not our code
- [x] **Track recording code removed (Jul 13)** — endpoint, types, transcription logic all deleted. Composite MP3 is sole transcription source.
- [x] **R2 long-term recording storage (Jul 13)** — `ve-room` R2 bucket bound via wrangler.toml. RTK dashboard configured for auto-transfer. `/api/recording/[key]` serves from R2. `/api/recording/scan` lists R2 objects by meeting ID prefix and caches refs in KV. `summary/[id].ts` falls back to R2 URLs when RTK URLs expire (7 days). `Summary.tsx` auto-scans R2 when RTK recording URLs are missing.
- [ ] End-to-end test with real multi-person conversation (current tests were solo or 2-person)
- [ ] Ollama Cloud API key renewal (using OpenRouter as primary)
- [ ] Custom domain (e.g., `ve-rooom.com`)
- [ ] Live captions (real-time transcription)
- [ ] Meeting deletion (not supported by RTK API — can only set INACTIVE)
- [ ] Test framework setup
- [ ] Mobile app (React Native / Flutter)
- [ ] Webhook for summary-ready notifications (instead of polling)
- [ ] Audio downsampling (243MB @ 320kbps → 32kbps mono to fit 25MB limit)
- [ ] Participant name lookup for track files (currently shows userId)
- [ ] exe.dev VM fallback for transcription (if CF daily limit hit)
- [ ] Calendar integration
- [ ] AI meeting participant/bot

---

## 13. Important Context for Future Sessions

### The user's working style
- **Labh Khanna** — the intern building this. Likes to move fast, test in two browsers, debug from console logs.
- Prefers **console.log** at each step to see what's going on.
- Gets frustrated when going in circles on errors — wants root-cause fixes, not trial-and-error.
- Often pastes console output + errors directly into chat.
- Tests meetings by opening the app in two browser windows simultaneously.
- Tests with Google accounts: `labh.k18@gmail.com` and `hello@collectivewin.ca`.

### Key non-obvious things
1. **The Vite dev proxy** (`vite.config.ts`) proxies `/api` → `http://localhost:8788` so the frontend on port 5173 can reach Pages Functions on 8788. Run both `vite` and `wrangler pages dev` for local dev.
2. **`record_on_start: true`** — RTK auto-records when session starts. This was changed to `false` in commit 00d5328 (Jul 7) which broke recordings. Reverted in commit 6d80cb1 (Jul 13). Do NOT change this back to `false`.
3. **`recording_config` must be on meeting creation** — `realtimekit_bucket_config` + `audio_config` (MP3 codec) set at meeting creation time. Removing this caused empty track files.
4. **RTK native transcription is NOT working** — `transcription_minutes_consumed: 0` for ALL sessions. The `transcript_download_url` exists but returns 0-byte CSV. Whisper on composite MP3 is the actual transcription path.
5. **Track recordings are empty** — `file_size: 0` for all track recordings on all meetings. This is an RTK issue, not our code. Composite MP3 is the primary audio source.
6. **Whisper hallucinates on silence** — returns "Thank you. Thank you. Thank you." repetitively. The hallucination filter catches this via word repetition ratio (< 0.15 unique words) and sentence repetition ratio (< 0.2 unique sentences).
7. **Workers AI 25 MB limit per request** — but we chunk at 10 MB for faster processing. A 1-hour meeting (~140 MB) takes ~14 chunks across ~7 Worker invocations with KV-based partial resume.
8. **CF Pages Functions 30s wall-clock limit** — transcribe.ts uses a 25s time budget, saves partial progress to KV, and returns `processing` so the frontend can retry.
9. **`type` field is always empty** in CF's list recordings response. Detect track recordings by `.webm` extension in `output_file_name` or `Array.isArray(download_url)`.
10. **Track response shape differs from composite** — `data.id` (not `data.recording.id`).
11. **CF API token needs `Workers AI:Run` scope** — without it, Whisper returns 401.
12. **Google profile image** may break — use `onError` fallback to initials avatar.
13. **Room ID trailing slash** causes 405 — trim in `joinRoom`.
14. **SVG attributes in React** must be camelCase: `strokeWidth` not `stroke-width`.
15. **KV partial progress key** — `meeting:{id}:partial` stores `{ chunkIndex, transcriptParts, totalChunks, totalSize }`. Deleted on completion.
16. **Silent recording detection** — if all Whisper chunks produce hallucinations, the audio is silent. Returns `silent` status with a clear message about muted microphone.

### The JSSA-amply test artifacts
The root directory has Python scripts and audio segments from testing the transcription pipeline on a 106-minute recording. These are test artifacts, not production code:
- `jssa-amply.mp3` — the original 106-min recording (243MB)
- `transcribe.py`, `transcribe_all.py`, `run_all_segments.py`, `run_seg0.py` — Python transcription scripts
- `segments/` — chunked audio segments
- `jssa-amply-summary.md`, `jssa-amply-transcript-*.txt` — results
- `test_ollama.py`, `test_whisper.py` — local model tests
- `generate_summary.py`, `resume_transcribe.py` — summary generation scripts

These can be cleaned up if the repo is getting cluttered, but they serve as reference for future transcription work.

---

## 14. Commits (Chronological)

1. `feat: scaffold VE-Call with RealtimeKit (home, meeting, summary, backend Workers)`
2. `feat: add dashboard, meetings API, configurable Ollama model`
3. `fix: add custom_participant_id + use group_call_host preset name`
4. `fix: routing, API field names, share link, download links, console logs`
5. `feat: complete UI/UX redesign with VE Rooom branding`
6. `deploy: rename project to ve-rooom for Cloudflare Pages`
7. `feat: add Google auth via central PocketBase (formsdb.exe.xyz)`
8. `fix: avatar URL from Google rawUser.picture + onError fallback`
9. `fix: stop infinite polling when transcript is empty or summary unavailable`
10. `cd6bba3` — JSSA-amply summary, responsive, recording config
11. `00d5328` — Start recording on join, stop on leave, track recording + OpenRouter (⚠️ introduced record_on_start: false regression)
12. `bd5cdaa` — Transcription pipeline: latest session, language en-US, composite Whisper fallback, dashboard with sessions
13. `3e80027` — Audio chunking for long meetings (HTTP Range splitting), dashboard session details
14. `4515892` — KV caching: transcript+summary persisted, user tracking, dashboard shows who joined
15. `727740c` — Large meeting transcription via Range requests, deduplicate hallucinated repetition
16. `c355c42` — Dedup+truncate to 60K for single-call summary, download buttons always visible
17. `c75ee8d` — Persist raw transcript to KV immediately after Whisper, pass meetingId to generate-summary
18. `aa344f1` — Refactor: auth token security, rate limiting, DRY utils, CSS split, dashboard search, skeletons
19. `6d80cb1` — Fix: revert to record_on_start, fix hallucination filter, silent recording detection, chunked transcription with time budget

---

## 15. Quick Reference

### Run locally
```sh
npm install
npm run build
npx wrangler pages dev dist --port 8787
# Open http://127.0.0.1:8787
```

### Run with hot reload (two terminals)
```sh
# Terminal 1:
npx wrangler pages dev dist --port 8788

# Terminal 2:
npx vite  # serves on 5173, proxies /api to 8788
# Open http://localhost:5173
```

### Deploy
```sh
npm run build
npx wrangler pages deploy dist --project-name ve-rooom --branch main
```

### Check logs
```sh
npx wrangler pages deployment tail --project-name ve-rooom
```

### Key URLs
- **Live:** https://ve-rooom.pages.dev
- **GitHub:** https://github.com/collectivewinca/ve-rooom
- **CF Dashboard:** https://dash.cloudflare.com/?to=/:account/realtime/kit
- **RTK App ID:** `cbe3c6da-77fb-4c9c-95df-fa092896f8be`
- **Auth gateway:** https://formsdb.exe.xyz

---

*This memory file is the single source of truth for the VE Rooom project. If anything in here is wrong or outdated, fix it — don't create a new file.*