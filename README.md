# VE Rooom

Video conferencing with AI-powered transcription and meeting summaries. Built on Cloudflare RealtimeKit.

**Live:** [ve-rooom.pages.dev](https://ve-rooom.pages.dev)

## Features

- **Instant meetings** — No signup required. Enter your name, click New Meeting, share the link.
- **Dual auto-recording** — Every meeting starts **both** composite (MP4 video + MP3 audio) **and** per-participant track recording (WebM audio) automatically 5s after join.
- **Server-side dedup** — Multiple participants joining triggers only one composite + one track recording (dedup via `GET /recordings?meeting_id=` check).
- **AI transcription** — 3-source pipeline: CF built-in transcript (primary) → Workers AI Whisper on per-participant WebM tracks (fallback A) → Workers AI Whisper on composite MP3 (fallback B).
- **AI summary** — OpenRouter (free models, auto-routed) as primary, Ollama Cloud + CF built-in summary as fallbacks. 7-section Markdown format (Summary, Topics, Decisions, Action Items, Open Questions, Participants, Sentiment).
- **Google Sign-in** — Optional Google auth via central PocketBase auth gateway.
- **Dashboard** — View all past meetings with one-click access to summaries and downloads.
- **5+ participants** — Powered by RealtimeKit SFU, scales natively.
- **Recording indicator** — Red pulsing dot + status text shows when recording is active.
- **Download cards** — Summary page shows download links for Transcript CSV, Full Transcript text, Recording MP4, Audio MP3, and per-participant WebM files.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript |
| UI Components | `@cloudflare/realtimekit-react-ui` (136 Web Components) |
| Backend | Cloudflare Pages Functions (Workers) |
| Video/Media | Cloudflare RealtimeKit (managed SFU + recording + transcription) |
| Auth | Google OAuth via PocketBase (`formsdb.exe.xyz`) |
| Summary LLM | OpenRouter (`openrouter/free` auto-router, free) → Ollama Cloud → CF built-in |
| Deployment | Cloudflare Pages (GitHub-connected auto-deploy) |

## Quick Start

### Prerequisites

- Node.js 18+
- A Cloudflare account with RealtimeKit enabled
- A RealtimeKit app created in the [Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/realtime)

### 1. Clone & Install

```sh
git clone https://github.com/collectivewinca/ve-rooom.git
cd ve-rooom
npm install
```

### 2. Configure Environment

Create `.dev.vars` from the template:

```sh
cp .dev.vars.example .dev.vars
```

Fill in your values:

```sh
CF_ACCOUNT_ID=your_cloudflare_account_id
CF_API_TOKEN=your_cloudflare_api_token        # Needs: Realtime admin + Workers AI:Run
RTK_APP_ID=your_realtimekit_app_id
OPENROUTER_API_KEY=your_openrouter_key         # Free models, auto-routed
OPENROUTER_MODEL=openrouter/free
OPENROUTER_FREE_MODEL=openrouter/free
OLLAMA_API_KEY=your_ollama_cloud_key           # Fallback (use "placeholder" to skip)
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_MODEL=gpt-oss:120b
```

### 3. Run Locally

```sh
npm run build
npx wrangler pages dev dist --port 8787
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787).

### 4. Deploy

```sh
npm run build
npx wrangler pages deploy dist --project-name ve-rooom --branch main
```

Set production secrets:

```sh
echo "your_value" | npx wrangler pages secret put CF_ACCOUNT_ID --project-name ve-rooom
echo "your_value" | npx wrangler pages secret put CF_API_TOKEN --project-name ve-rooom
echo "your_value" | npx wrangler pages secret put RTK_APP_ID --project-name ve-rooom
echo "your_value" | npx wrangler pages secret put OPENROUTER_API_KEY --project-name ve-rooom
echo "your_value" | npx wrangler pages secret put OPENROUTER_MODEL --project-name ve-rooom
echo "your_value" | npx wrangler pages secret put OPENROUTER_FREE_MODEL --project-name ve-rooom
echo "your_value" | npx wrangler pages secret put OLLAMA_API_KEY --project-name ve-rooom
echo "your_value" | npx wrangler pages secret put OLLAMA_BASE_URL --project-name ve-rooom
echo "your_value" | npx wrangler pages secret put OLLAMA_MODEL --project-name ve-rooom
```

## Project Structure

```
ve-rooom/
├── functions/                      # Cloudflare Pages Functions (serverless API)
│   └── api/
│       ├── rooms.ts                 # POST → create meeting (transcribe_on_end, summarize_on_end)
│       ├── rooms/[id]/
│       │   └── participants.ts      # POST → join existing room as participant
│       ├── recordings/
│       │   ├── start.ts             # POST → start composite recording (dedup + allow_multiple)
│       │   └── track.ts             # POST → start track recording (per-participant WebM)
│       ├── summary/
│       │   └── [id].ts              # GET → 3-source transcript → OpenRouter → Ollama → CF summary
│       └── meetings.ts             # GET → list all meetings for dashboard
├── src/
│   ├── components/
│   │   └── Layout.tsx               # Navbar with Google auth (sign-in/avatar/sign-out)
│   ├── lib/
│   │   ├── api.ts                   # Frontend fetch helpers + types (trackFiles, recording start)
│   │   ├── formsdb-auth.js          # Central Google auth via PocketBase (drop-in module)
│   │   ├── formsdb-auth.d.ts        # TypeScript declarations for auth module
│   │   └── useAuth.ts               # React hook for auth state
│   ├── pages/
│   │   ├── Home.tsx                 # Create/join meeting with tab toggle
│   │   ├── Meeting.tsx              # RtkMeeting + 5s auto-start recordings + recording indicator
│   │   ├── Summary.tsx              # Polls 5s, blur overlay, Markdown + download cards
│   │   └── Dashboard.tsx            # Past meetings list with stats
│   ├── App.tsx                      # Routes: /, /dashboard, /meeting/:roomId, /summary/:roomId
│   ├── main.tsx                     # React entry point
│   ├── index.css                    # Global resets + dark theme base
│   └── pages.css                    # Full design system (golden gradient + recording indicator)
├── public/
│   ├── favicon.svg                  # Custom SVG icon (golden camera lens)
│   └── jssa-amply-summary.md        # Sample After Meeting Report (MoM)
├── index.html                       # SPA shell with preconnect to auth hosts
├── wrangler.toml                    # Cloudflare Pages config
├── vite.config.ts                   # Vite config with /api proxy to localhost:8788
├── .dev.vars.example               # Environment variable template
└── package.json
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/rooms` | Create a new meeting + add host participant. Body: `{ name, roomTitle? }` → `{ roomId, authToken }` |
| `POST` | `/api/rooms/:id/participants` | Join existing meeting. Body: `{ name }` → `{ authToken }` |
| `POST` | `/api/recordings/start` | Start composite recording (server-side dedup). Body: `{ meetingId, authToken }` → `{ recordingId, status }` |
| `POST` | `/api/recordings/track` | Start track recording (per-participant WebM, server-side dedup). Body: `{ meetingId, authToken }` → `{ recordingId, status, type }` |
| `GET` | `/api/summary/:id` | Fetch transcript + summary + recordings. → `{ status, summary?, transcriptUrl?, recordingUrl?, audioRecordingUrl?, trackFiles?, transcript_text? }` |
| `GET` | `/api/meetings` | List all meetings. → `{ meetings: [...] }` |

### Summary Status Values

| Status | Meaning |
|---|---|
| `ok` | Summary is ready |
| `processing` | Transcript or summary still being generated (poll again in 5s) |
| `no_ended_session` | Meeting hasn't ended yet or no session found |
| `no_summary` | Transcript exists but no summary could be generated (Ollama not configured + CF summary unavailable) |
| `error` | Server error |

## How It Works

### Meeting Flow

1. User enters name on Home page → clicks **New Meeting**
2. `POST /api/rooms` creates a RealtimeKit meeting with `transcribe_on_end`, `summarize_on_end` enabled
3. Server adds the user as a participant with `group_call_host` preset → returns `authToken`
4. Frontend navigates to `/meeting/:roomId?authToken=...`
5. `useRealtimeKitClient` initializes the meeting → `<RtkMeeting>` renders the full video UI
6. **5s after meeting ready**: frontend auto-starts composite + track recordings (`POST /api/recordings/start` + `POST /api/recordings/track`)
7. Server-side dedup prevents duplicate recordings when multiple participants join
8. Recording indicator (red pulsing dot) shows in UI
9. User clicks **Copy Join Link** to share `/?room=<roomId>` with others

### Post-Meeting Flow

1. After all participants leave, RealtimeKit ends the session
2. CF's internal `transcribe_on_end` runs Whisper on the composite audio → generates transcript CSV in R2
3. User visits `/summary/:roomId`
4. `GET /api/summary/:id` executes a 3-source transcription pipeline:
   - **Source 1 (primary):** Download CF transcript CSV → if non-empty, use it
   - **Source 2 (fallback A):** If CF transcript empty → download per-participant WebM track files → run Workers AI Whisper (`@cf/openai/whisper-large-v3-turbo`) on each → merge with `[Participant {userId}]:` prefix
   - **Source 3 (fallback B):** If no track files → download composite MP3 → run Workers AI Whisper
5. Transcript → OpenRouter (`openrouter/free`) for 7-section Markdown summary
6. If OpenRouter fails → Ollama Cloud fallback
7. If Ollama fails → CF built-in summary
8. Fetch all recording download URLs (MP4, MP3, per-participant WebM)
9. Frontend polls every 5s (max 60 polls / 5 min), then renders Markdown + download cards

## Authentication

Google Sign-in is optional and handled by a central PocketBase auth gateway at `formsdb.exe.xyz`.

- One Google OAuth client serves all projects (no per-domain Google Console config)
- Session stored in `localStorage` — persists across refreshes
- Auth state exposed via `useAuth()` hook
- Navbar shows avatar + name when logged in, sign-in button when not
- Home page auto-fills the name field from the logged-in user

See [`docs/AUTH.md`](docs/AUTH.md) for details.

## Customization

### Theme

Edit CSS custom properties in `src/pages.css`:

```css
:root {
  --gradient-primary: linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%);
  --color-bg: #0a0805;
  --color-primary: #f59e0b;
  /* ... */
}
```

### RealtimeKit UI

The `<RtkMeeting>` component accepts a `config` prop with `designTokens` for theming the built-in video UI (colors, fonts, border radius). See the [RealtimeKit UI Kit docs](https://developers.cloudflare.com/realtimekit/ui-kit/) for full reference.

### Summary Prompt

Edit `SUMMARY_SYSTEM_PROMPT` in `functions/api/summary/[id].ts` to customize the AI summary format.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CF_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `CF_API_TOKEN` | Yes | Cloudflare API token (needs Realtime admin **+ Workers AI:Run** scope) |
| `RTK_APP_ID` | Yes | RealtimeKit app ID |
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key (free models available) |
| `OPENROUTER_MODEL` | No | Primary model (default: `openrouter/free`) |
| `OPENROUTER_FREE_MODEL` | No | Fallback model (default: `openrouter/free`) |
| `OLLAMA_API_KEY` | No | Ollama Cloud API key (fallback, use `placeholder` to skip) |
| `OLLAMA_BASE_URL` | No | Ollama Cloud base URL (default: `https://ollama.com`) |
| `OLLAMA_MODEL` | No | Ollama model name (default: `gpt-oss:120b`) |

## Limitations

- **No meeting deletion** — The RealtimeKit REST API doesn't support deleting meetings, recordings, or sessions. Meetings can be set to `INACTIVE` to prevent joins. Recordings and sessions auto-expire from R2 after 7 days.
- **Transcription is post-meeting only** — No live captions in the MVP.
- **Summary depends on speech** — If nobody speaks during the meeting, the transcript is empty and no meaningful summary is generated.
- **Workers AI 25MB limit** — Audio files larger than 25MB can't be transcribed via Workers AI Whisper. The summary page returns download links for manual transcription in this case.
- **Track recording is audio-only** — Video track recording is in development per CF docs.
- **Track files are time-aligned to meeting start** — Silence is preserved (not concatenated speech). Files may be shorter than the composite if a participant leaves early.

## Cost

| Resource | Free Tier | Beyond |
|---|---|---|
| Cloudflare Pages | 500 builds/month, unlimited requests | — |
| Workers | 100,000 requests/day | $5/mo Paid plan |
| Workers AI (Whisper) | ~47 Neurons/audio-min | $0.011 / 1,000 Neurons |
| RealtimeKit recording | Beta — pricing TBA | Usage-based at GA |

**MVP cost on Free plan:** $0, as long as daily meeting audio stays under ~3.5 hours.

## License

MIT

## Links

- [Live demo](https://ve-rooom.pages.dev)
- [GitHub repo](https://github.com/collectivewinca/ve-rooom)
- [Cloudflare RealtimeKit docs](https://developers.cloudflare.com/realtime/realtimekit/)
- [RealtimeKit REST API](https://developers.cloudflare.com/api/resources/realtime_kit/)