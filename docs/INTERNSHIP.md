# VE Rooom — Internship Project Documentation

## Project Goal
Build a Google Meet–style video conferencing app with meeting recording, full-meeting transcription, and AI-generated summaries using Cloudflare RealtimeKit.

## Project Info
- **Repo:** https://github.com/collectivewinca/ve-rooom
- **Live:** https://ve-rooom.pages.dev
- **Started:** July 2026
- **Intern:** Labh Khanna
- **Stack:** Cloudflare RealtimeKit, React, Vite, TypeScript, Cloudflare Pages Functions

## What Was Built

### Phase 1-3: Core App
- Vite + React + TypeScript scaffold
- RealtimeKit integration with `<RtkMeeting>` component
- Home page (create/join meeting with tab toggle)
- Meeting page (full-screen video with copy link + summary link overlay)
- Pages Functions backend: create rooms, join rooms, add participants

### Phase 4: Recording
- **Dual recording**: composite (MP4 + MP3) + track (per-participant WebM audio)
- `record_on_start: false` in meeting creation; frontend auto-starts both 5s after join
- Server-side dedup: `GET /recordings?meeting_id=` check before starting, prevents N recordings from N participants
- `allow_multiple_recordings: true` on composite POST (enables composite + track concurrently)
- Track recording: `POST /recordings/track` with `layers.default.outputs: [{ type: "REALTIMEKIT_BUCKET" }]`
- Recording indicator UI (red pulsing dot + status text)
- `meetingRef` pattern in useEffect to survive React.StrictMode double-mount
- Download cards: Transcript CSV, Full Transcript text, Recording MP4, Audio MP3, per-participant WebM

### Phase 5: Transcription + Summary
- `transcribe_on_end: true` + `summarize_on_end: true` at meeting creation
- **3-source transcription pipeline**:
  1. CF built-in transcript (primary) — CSV from `transcribe_on_end`
  2. Workers AI Whisper on per-participant WebM track files (fallback A) — no diarization needed
  3. Workers AI Whisper on composite MP3 (fallback B) — ≤25MB limit
- **3-tier summary generation**:
  1. OpenRouter (`openrouter/free`, auto-routes to free models) — primary
  2. Ollama Cloud (`gpt-oss:120b`) — fallback
  3. CF built-in summary — last resort
- Summary page: polls every 5s (max 60 polls / 5 min), blur overlay, renders Markdown + download cards
- Empty transcript detection (no speech → "no speech detected" summary)
- `language: "en"` forced in Whisper requests (prevents misdetection on silence-heavy audio)

### Phase 6: Dashboard
- Stats cards (total/active/completed meetings)
- Meeting list with status badges and summary links
- Empty state with CTA

### UI/UX Redesign
- Dark theme with golden gradient on black background
- Glassmorphic navbar with blur backdrop
- Custom SVG favicon (golden camera lens)
- Feature badges on home page
- Download cards with icons on summary page
- Responsive design (mobile breakpoints, hamburger menu at 640px, tablet breakpoint)
- Recording indicator (red pulsing dot + status text)
- Blur overlay on summary page when no summary yet (processing/polling)
- SVG attribute fixes (`stroke-width` → `strokeWidth`, etc. for React JSX compliance)

### Google Auth
- Central Google OAuth via PocketBase (`formsdb.exe.xyz`)
- Drop-in `formsdb-auth.js` module (zero dependencies)
- `useAuth()` React hook with auto session restore
- Navbar: sign-in button / avatar + name / sign-out

### Deployment
- Cloudflare Pages project: `ve-rooom`
- GitHub-connected for auto-deploy on push to `main`
- All secrets set via `wrangler pages secret put`
- Live at [ve-rooom.pages.dev](https://ve-rooom.pages.dev)

## Key Technical Decisions

| Decision | Rationale |
|---|---|
| RealtimeKit over raw SFU fork | Built-in recording/transcript/summary, days not weeks |
| Dual recording (composite + track) | Composite for video + mixed audio; track for per-participant audio (no diarization needed) |
| `record_on_start: false` + manual 5s auto-start | Server-side dedup prevents N recordings from N participants |
| `allow_multiple_recordings: true` | Allows composite + track to run concurrently |
| Post-meeting Whisper only | 47 Neurons/min vs 836 for real-time Deepgram |
| Poll on demand for summary | No webhook infrastructure needed for MVP |
| OpenRouter as primary LLM | Free models, auto-routed, no rate limit issues with `openrouter/free` |
| Ollama Cloud as fallback | Configurable model, better summary quality than CF built-in |
| Folder-based dynamic routes | Cloudflare Pages doesn't support flat `[id]` in filenames |
| Top-level sessions/recordings API | `/sessions?meeting_id=` not `/meetings/{id}/sessions` |
| Central PocketBase auth | One Google OAuth client for all projects |
| Track dedup by `.webm` extension | `type` field is always empty in list response |
| `language: "en"` forced in Whisper | Prevents misdetection on silence-heavy audio |

## API Issues Discovered & Fixed

| Issue | Fix |
|---|---|
| `custom_participant_id` required | Added `crypto.randomUUID()` to participant creation |
| Preset name `group-call-host` → `group_call_host` | Underscores not hyphens |
| Pages Functions `[id]` flat filenames don't work | Restructured to folder-based `rooms/[id]/participants.ts` |
| Sessions API 404 at `/meetings/{id}/sessions` | Use top-level `/sessions?meeting_id={id}` |
| Transcript field `downloadUrl` doesn't exist | Actual field: `transcript_download_url` |
| Recordings at `/meetings/{id}/recordings` → 404 | Use top-level `/recordings?meeting_id={id}` |
| Recording field `downloadUrl` doesn't exist | Actual field: `download_url` + `audio_download_url` |
| Infinite polling on empty transcripts | Detect empty transcript → return "no speech" summary |
| `display: block` on `rtk-meeting` breaks video layout | Use `!important` on width/height, don't override display |
| Track recording 422: `"layers" is required` | Docs say optional but API requires `layers` field |
| Track recording 422: `"layers.default.outputs" is required` | Must include `outputs` array in layer config |
| Track recording 422: `"outputs" must be an array` | `outputs` must be array, not object |
| Track recording 422: `"outputs[0].type" is required` | Each output must have `type` field |
| Track recording 422: `"type" must be one of [REALTIMEKIT_BUCKET, ...]` | Use `type: "REALTIMEKIT_BUCKET"` |
| Track recording 422: `"layers.default.media_kind" is not allowed` | Remove `media_kind` from layer (track is audio-only by default) |
| Track recording 500: `Cannot read properties of undefined (reading 'id')` | Response shape is `data.id`, not `data.recording.id` (unlike composite) |
| Track recording `type` field always empty in list response | Detect by `.webm` extension in `output_file_name` or `Array.isArray(download_url)` |
| Track recording `file_size` always 0 | CF quirk — actual size in storage, not in API response |
| Workers AI Whisper 401 | CF API token needed `Workers AI:Run` scope added |
| Whisper misdetects language on silence-heavy audio | Force `language: "en"` in request body |
| Whisper hallucinates on silence | Returns "Thank you" repeated — expected behavior on silent audio |
| Ollama Cloud API 401 | Key expired — switched to OpenRouter as primary LLM |
| useEffect timer cleared before 5s | `meeting` object new reference each render → use `meetingRef` + `[roomId]` deps |
| SVG `stroke-width` warnings in React | Use camelCase: `strokeWidth`, `strokeLinecap`, `strokeLinejoin` |
| Room ID trailing-slash 405 error | Trim + remove trailing slash in `api.ts` `joinRoom` |
| Vite dev can't reach Functions | Add `server.proxy["/api"]` → `http://localhost:8788` in vite.config.ts |

## Commits (Chronological)

1. `feat: scaffold VE-Call with RealtimeKit (home, meeting, summary, backend Workers)`
2. `feat: add dashboard, meetings API, configurable Ollama model`
3. `fix: add custom_participant_id + use group_call_host preset name`
4. `fix: routing, API field names, share link, download links, console logs`
5. `feat: complete UI/UX redesign with VE Rooom branding`
6. `deploy: rename project to ve-rooom for Cloudflare Pages`
7. `feat: add Google auth via central PocketBase (formsdb.exe.xyz)`
8. `fix: avatar URL from Google rawUser.picture + onError fallback`
9. `fix: stop infinite polling when transcript is empty or summary unavailable`
10. `cd6bba3` — All source + public changes (JSSA-amply summary, responsive, recording config)
11. *(pending)* — Track recording + OpenRouter + SVG fixes + README updates

## What's Not Done (Future Work)

- [ ] End-to-end test with real conversation (current test audio is silence-heavy, Whisper hallucinates)
- [ ] Ollama Cloud API key renewal (using OpenRouter as primary for now)
- [ ] Custom domain (e.g. `ve-rooom.com`)
- [ ] Live captions (real-time transcription)
- [ ] Meeting deletion (not supported by RealtimeKit API)
- [ ] Test framework setup
- [ ] Mobile app (React Native / Flutter)
- [ ] Webhook for summary-ready notifications (instead of polling)
- [ ] Audio downsampling (243MB @ 320kbps → 32kbps mono to fit Workers AI 25MB limit without splitting)
- [ ] Participant name lookup for track files (currently shows userId, not human name)