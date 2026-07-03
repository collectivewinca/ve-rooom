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
- `record_on_start: true` baked into meeting creation
- `realtimekit_bucket_config.enabled: true` for R2 storage
- Audio codec: MP3, video codec: H264
- Recording downloads (MP4 + MP3) available on summary page

### Phase 5: Transcription + Summary
- `transcribe_on_end: true` + `summarize_on_end: true` at meeting creation
- Whisper Large v3 Turbo post-meeting transcription
- Summary Worker: fetches transcript → calls Ollama Cloud → falls back to CF built-in
- Summary page: polls every 5s, renders Markdown, shows download links
- Empty transcript detection (no speech → "no speech detected" summary)
- `no_summary` status when neither Ollama nor CF summary produces a result

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
- Responsive design (mobile breakpoints)

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
| Post-meeting Whisper only | 47 Neurons/min vs 836 for real-time Deepgram |
| Poll on demand for summary | No webhook infrastructure needed for MVP |
| Folder-based dynamic routes | Cloudflare Pages doesn't support flat `[id]` in filenames |
| Top-level sessions/recordings API | `/sessions?meeting_id=` not `/meetings/{id}/sessions` |
| Central PocketBase auth | One Google OAuth client for all projects |

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

## What's Not Done (Future Work)

- [ ] GitHub auto-deploy connection (requires manual dashboard authorization)
- [ ] Ollama Cloud API key (currently using `placeholder`)
- [ ] Custom domain (e.g. `ve-rooom.com`)
- [ ] Live captions (real-time transcription)
- [ ] Meeting deletion (not supported by RealtimeKit API)
- [ ] Test framework setup
- [ ] Mobile app (React Native / Flutter)