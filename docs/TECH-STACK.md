# Tech Stack

## Overview

VE Rooom is a zero-setup video conferencing app with AI-powered recording, transcription, and summarization. Every meeting is automatically captured and summarized — no plugins, no configuration.

## Non-Technical Summary

| Layer | What It Is |
|---|---|
| **Frontend UI** | React + TypeScript — the interactive pages you see and click |
| **Build tool** | Vite — compiles the code fast during development |
| **Video engine** | Cloudflare RealtimeKit — manages cameras, mics, screen sharing, and recording |
| **Video UI** | RealtimeKit React UI Kit — provides the in-call controls and participant grid |
| **Backend API** | Cloudflare Pages Functions — serverless code that creates meetings and fetches summaries |
| **Transcription** | Whisper Large v3 Turbo on Workers AI — converts speech to text after the meeting ends |
| **Summary AI** | Ollama Cloud — generates the meeting recap (key topics, decisions, action items) |
| **Auth** | Google Sign-in via PocketBase — optional login to remember your name |
| **Hosting** | Cloudflare Pages — deploys the app globally on Cloudflare's edge network |

---

## Frontend

### React 18 + TypeScript
- **Runtime:** React 18.3 with concurrent features
- **Entry:** `src/main.tsx` mounts `<BrowserRouter>` → `<App>` → `<Layout>` → page routes
- **Routing:** `react-router-dom` v6 with four routes (`/`, `/dashboard`, `/meeting/:roomId`, `/summary/:roomId`)

### Vite 5 (Build Tool)
- **Plugin:** `@vitejs/plugin-react` for fast HMR and JSX transform
- **Dev server:** port 5173 with instant module reload
- **Build output:** static SPA in `dist/` served by Cloudflare Pages

### UI Components
- **`@cloudflare/realtimekit-react-ui`** — Provides `<RtkMeeting>`, a Web Component wrapping the full video conferencing UI (camera, mic, screen share, participant grid, device selection). Configurable via `designTokens` for theming.
- **`react-markdown`** v9 — Renders AI-generated meeting summaries as formatted Markdown with headings, lists, bold, and code blocks.
- **Custom CSS design system** (`src/pages.css`, ~1400 lines) — Dark theme with golden gradient accents, glassmorphic navbar, responsive breakpoints (820px, 640px, 380px), safe-area support, and touch-friendly targets.

### State & Auth
- **`useAuth()`** hook wrapping `formsdb-auth.js` — PocketBase Google OAuth via popup
- **`useRealtimeKitClient()`** / **`useRealtimeKitMeeting()`** hooks from `@cloudflare/realtimekit-react` — manage meeting lifecycle
- **No state management library** — local state with React hooks is sufficient for the SPA

---

## Backend (Cloudflare Pages Functions)

Cloudflare Pages Functions (Worker runtime) serve as the trusted server-side intermediary. The frontend cannot directly call RealtimeKit's REST API because the API token must remain secret.

### Functions (4 endpoints)

| File | Method | Purpose |
|---|---|---|
| `functions/api/rooms.ts` | `POST` | Create a RealtimeKit meeting with recording/transcription/summary config, add the host participant, return `roomId` + `authToken` |
| `functions/api/rooms/[id]/participants.ts` | `POST` | Join an existing meeting as a participant, return `authToken` |
| `functions/api/summary/[id].ts` | `GET` | Find the ended session, download the transcript CSV, call Ollama Cloud (or CF built-in) for summary, return Markdown + download URLs |
| `functions/api/meetings.ts` | `GET` | List all RealtimeKit meetings for the dashboard view |

### Why not a pure SPA?
The `authToken` for each participant must be minted server-side using the Cloudflare API token (`CF_API_TOKEN`). That token is a secret and can never live in the browser. The Worker is the trusted intermediary between the browser and RealtimeKit.

### Auth Middleware
- `functions/auth.ts` — `verifyAuthToken()` validates the user's PocketBase session token against `formsdb.exe.xyz` before allowing room creation or joining.

---

## Video Infrastructure (Cloudflare RealtimeKit)

Cloudflare RealtimeKit is a managed WebRTC infrastructure platform (SFU — Selective Forwarding Unit). It handles everything media-related:

| Capability | Implementation |
|---|---|
| SFU media routing | Audio, video, and screen-share between 5+ participants |
| Recording | Composite MP4 video + separate MP3 audio, stored in Cloudflare R2 |
| Transcription | Post-meeting via Whisper Large v3 Turbo on Workers AI (~47 Neurons/min) |
| Summary (built-in) | CF's own summary engine (optional, used as fallback) |
| Presets | `group_call_host` or `group_call_participant` for role-based permissions |
| Token auth | Each participant gets a scoped `authToken` on join |

RealtimeKit is configured at meeting creation:
- `record_on_start: true` — recording begins when first participant joins
- `transcribe_on_end: true` — Whisper processes audio after the session ends
- `summarize_on_end: true` — built-in summary (can be overridden by Ollama)
- Recording config: MP3 audio with `realtimekit_bucket_config` to store in CF R2

---

## AI Summarization (Ollama Cloud)

The summary endpoint calls Ollama Cloud's `/api/chat` with a detailed system prompt:

- **System prompt** (~600 words) instructs the LLM to produce a structured Markdown summary with sections: Meeting Summary, Key Topics, Decisions, Action Items, Open Questions, Participants, Sentiment & Engagement.
- **Model:** Configurable via `OLLAMA_MODEL` (default: `gpt-oss:120b` in production, `llama3.1:8b` in template)
- **Auth:** `Bearer {OLLAMA_API_KEY}`
- **Fallback:** If Ollama is not configured or fails, the function falls back to Cloudflare's built-in summary engine (`GET /sessions/{id}/summary`)

---

## Authentication (PocketBase Gateway)

Google OAuth is handled by a central PocketBase instance at `formsdb.exe.xyz`. This is a cross-project auth gateway pattern:

| Layer | Technology |
|---|---|
| OAuth provider | Google (one client for all projects) |
| Auth server | PocketBase v0.22+ |
| Client module | `formsdb-auth.js` — zero-dependency drop-in |
| Client types | `formsdb-auth.d.ts` — TypeScript declarations |
| React integration | `useAuth()` hook exposing `{ user, loading, signInWithGoogle, signOut }` |
| Session storage | `localStorage` key `formsdb_auth_session` |

The auth flow:
1. User clicks "Sign in with Google" → popup opens to `formsdb.exe.xyz`
2. PocketBase handles the Google OAuth redirect
3. On success, the popup sends the session token via `postMessage`
4. `formsdb-auth.js` stores it in `localStorage`
5. Server-side (Pages Functions) validates the token on every room create/join via `verifyAuthToken()`

This avoids per-domain Google Console configuration — one OAuth client serves all projects.

---

## Deployment (Cloudflare Pages)

| Property | Value |
|---|---|
| Hosting | Cloudflare Pages (edge network) |
| Project name | `ve-rooom` |
| Build command | `npm run build` (`tsc -b && vite build`) |
| Output dir | `dist/` |
| Framework preset | None (manual SPA) |
| Auto-deploy | GitHub-connected, pushes to `main` deploy to production |
| Secrets | Set via `wrangler pages secret put` for production env vars |

### wrangler.toml
```toml
name = "ve-rooom"
compatibility_date = "2024-09-01"
pages_build_output_dir = "dist"
```

### Environment variables
| Variable | Required | Source |
|---|---|---|
| `CF_ACCOUNT_ID` | Yes | Cloudflare dashboard |
| `CF_API_TOKEN` | Yes | Cloudflare API tokens (Realtime admin) |
| `RTK_APP_ID` | Yes | RealtimeKit app from Cloudflare dashboard |
| `OLLAMA_API_KEY` | No | Ollama Cloud |
| `OLLAMA_BASE_URL` | No | Default: `https://ollama.com` |
| `OLLAMA_MODEL` | No | Default: `gpt-oss:120b` |

---

## TypeScript Configuration

Two tsconfig files:
- **`tsconfig.json`** — Main config targeting ES2020, includes `src/` and `functions/`, uses `@cloudflare/workers-types` and `vite/client` types
- **`tsconfig.node.json`** — Composite config for `vite.config.ts` (Node runtime)

---

## Dependencies

### Production
| Package | Version | Purpose |
|---|---|---|
| `react` | ^18.3.1 | UI framework |
| `react-dom` | ^18.3.1 | React DOM renderer |
| `react-router-dom` | ^6.26.0 | Client-side routing |
| `react-markdown` | ^9.0.1 | Renders AI summary Markdown |
| `@cloudflare/realtimekit-react` | ^2.0.0 | RealtimeKit React hooks |
| `@cloudflare/realtimekit-react-ui` | ^2.0.0 | `<RtkMeeting>` web component |

### Dev
| Package | Version | Purpose |
|---|---|---|
| `typescript` | ^5.5.4 | Type checking |
| `vite` | ^5.4.0 | Build tool + dev server |
| `@vitejs/plugin-react` | ^4.3.1 | Vite React plugin |
| `@types/react` | ^18.3.3 | React type defs |
| `@types/react-dom` | ^18.3.0 | React DOM type defs |
| `wrangler` | ^3.78.12 | Cloudflare Pages CLI |
| `@cloudflare/workers-types` | ^4.20240806.0 | Workers type defs |

---

## Architecture Diagram

```
Browser (React SPA)
    │
    ├── fetch() ──► Cloudflare Pages Functions (Worker)
    │                       │
    │                       ├──► RealtimeKit REST API (create meeting, add participant)
    │                       ├──► Ollama Cloud API (generate summary)
    │                       └──► PocketBase auth validation (formsdb.exe.xyz)
    │
    ├── WebRTC ──► RealtimeKit SFU (audio/video/screen-share)
    │
    └── popup ──► formsdb.exe.xyz (Google OAuth)
```

---

## Key Design Rationales

| Decision | Rationale |
|---|---|
| RealtimeKit over raw SFU | Days-to-weeks MVP — built-in recording, transcription, summary |
| Post-meeting transcription | 18x cheaper than real-time (~47 vs ~836 Neurons/min) |
| Poll-based summary | No webhook infrastructure needed for MVP |
| Ollama Cloud + CF fallback | Better summaries than CF built-in; graceful degradation |
| Central PocketBase auth | One Google OAuth client for all projects, zero per-domain config |
| Folder-based Pages Functions | Cloudflare requires `rooms/[id]/participants.ts` not dotted routes |
| Custom CSS over Tailwind/DaisyUI | Full control over dark golden theme; no framework overhead |
