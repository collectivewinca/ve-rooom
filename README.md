# VE Rooom

Video conferencing with AI-powered transcription and meeting summaries. Built on Cloudflare RealtimeKit.

**Live:** [ve-rooom.pages.dev](https://ve-rooom.pages.dev)

## Features

- **Instant meetings** — No signup required. Enter your name, click New Meeting, share the link.
- **Auto-recording** — Every meeting is recorded automatically (MP4 video + MP3 audio).
- **AI transcription** — Post-meeting transcription via Whisper Large v3 Turbo on Cloudflare Workers AI.
- **AI summary** — Meeting summary with key decisions and action items (Ollama Cloud or Cloudflare built-in).
- **Google Sign-in** — Optional Google auth via central PocketBase auth gateway.
- **Dashboard** — View all past meetings with one-click access to summaries and downloads.
- **5+ participants** — Powered by RealtimeKit SFU, scales natively.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript |
| UI Components | `@cloudflare/realtimekit-react-ui` (136 Web Components) |
| Backend | Cloudflare Pages Functions (Workers) |
| Video/Media | Cloudflare RealtimeKit (managed SFU + recording + transcription) |
| Auth | Google OAuth via PocketBase (`formsdb.exe.xyz`) |
| Summary LLM | Ollama Cloud API (configurable, falls back to CF built-in) |
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
CF_API_TOKEN=your_cloudflare_api_token
RTK_APP_ID=your_realtimekit_app_id
OLLAMA_API_KEY=your_ollama_cloud_key      # optional, use "placeholder" to skip
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_MODEL=llama3.1:8b
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
echo "your_value" | npx wrangler pages secret put OLLAMA_API_KEY --project-name ve-rooom
echo "your_value" | npx wrangler pages secret put OLLAMA_BASE_URL --project-name ve-rooom
echo "your_value" | npx wrangler pages secret put OLLAMA_MODEL --project-name ve-rooom
```

## Project Structure

```
ve-rooom/
├── functions/                      # Cloudflare Pages Functions (serverless API)
│   └── api/
│       ├── rooms.ts                 # POST → create meeting + host participant
│       ├── rooms/[id]/
│       │   └── participants.ts      # POST → join existing room as participant
│       ├── summary/
│       │   └── [id].ts              # GET → fetch transcript, generate summary, return downloads
│       └── meetings.ts             # GET → list all meetings for dashboard
├── src/
│   ├── components/
│   │   └── Layout.tsx               # Navbar with Google auth (sign-in/avatar/sign-out)
│   ├── lib/
│   │   ├── api.ts                   # Frontend fetch helpers + TypeScript types
│   │   ├── formsdb-auth.js          # Central Google auth via PocketBase (drop-in module)
│   │   ├── formsdb-auth.d.ts        # TypeScript declarations for auth module
│   │   └── useAuth.ts               # React hook for auth state
│   ├── pages/
│   │   ├── Home.tsx                 # Create/join meeting with tab toggle
│   │   ├── Meeting.tsx              # RtkMeeting wrapper + copy link + summary link
│   │   ├── Summary.tsx              # Polls for summary, renders Markdown, download links
│   │   └── Dashboard.tsx            # Past meetings list with stats
│   ├── App.tsx                      # Routes: /, /dashboard, /meeting/:roomId, /summary/:roomId
│   ├── main.tsx                     # React entry point
│   ├── index.css                    # Global resets + dark theme base
│   └── pages.css                    # Full design system (golden gradient on black)
├── public/
│   └── favicon.svg                  # Custom SVG icon (golden camera lens)
├── index.html                       # SPA shell with preconnect to auth hosts
├── wrangler.toml                    # Cloudflare Pages config
├── .dev.vars.example               # Environment variable template
└── package.json
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/rooms` | Create a new meeting + add host participant. Body: `{ name, roomTitle? }` → `{ roomId, authToken }` |
| `POST` | `/api/rooms/:id/participants` | Join existing meeting. Body: `{ name }` → `{ authToken }` |
| `GET` | `/api/summary/:id` | Fetch transcript + summary for a meeting. → `{ status, summary?, transcriptUrl?, recordingUrl?, audioRecordingUrl? }` |
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
2. `POST /api/rooms` creates a RealtimeKit meeting with `record_on_start`, `transcribe_on_end`, `summarize_on_end` enabled
3. Server adds the user as a participant with `group_call_host` preset → returns `authToken`
4. Frontend navigates to `/meeting/:roomId?authToken=...`
5. `useRealtimeKitClient` initializes the meeting → `<RtkMeeting>` renders the full video UI
6. User clicks **Copy Join Link** to share `/?room=<roomId>` with others

### Post-Meeting Flow

1. After all participants leave, RealtimeKit ends the session
2. Whisper Large v3 Turbo processes the audio → generates transcript (CSV in R2)
3. User visits `/summary/:roomId`
4. `GET /api/summary/:id`:
   - Fetches ended sessions via `/sessions?meeting_id=...`
   - Downloads transcript from R2 presigned URL
   - If transcript is empty → returns "no speech detected" summary
   - Calls Ollama Cloud API with transcript (if configured)
   - Falls back to Cloudflare built-in summary
   - Fetches recording download URLs (MP4 + MP3)
5. Frontend polls every 5s until summary is ready, then renders Markdown + download links

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
| `CF_API_TOKEN` | Yes | Cloudflare API token with Realtime admin permissions |
| `RTK_APP_ID` | Yes | RealtimeKit app ID |
| `OLLAMA_API_KEY` | No | Ollama Cloud API key (use `placeholder` to skip) |
| `OLLAMA_BASE_URL` | No | Ollama Cloud base URL (default: `https://ollama.com`) |
| `OLLAMA_MODEL` | No | Ollama model name (default: `llama3.1:8b`) |

## Limitations

- **No meeting deletion** — The RealtimeKit REST API doesn't support deleting meetings, recordings, or sessions. Meetings can be set to `INACTIVE` to prevent joins. Recordings and sessions auto-expire from R2 after 7 days.
- **Transcription is post-meeting only** — No live captions in the MVP.
- **Summary depends on speech** — If nobody speaks during the meeting, the transcript is empty and no meaningful summary is generated.

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