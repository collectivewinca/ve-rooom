# Contributing to VE Rooom

## Development Setup

### Prerequisites

- Node.js 18+
- A Cloudflare account
- A RealtimeKit app (create one in the [Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/realtime))

### Getting Started

```sh
git clone https://github.com/collectivewinca/ve-rooom.git
cd ve-rooom
npm install
cp .dev.vars.example .dev.vars
# Fill in .dev.vars with your Cloudflare + RealtimeKit credentials
npm run build
npx wrangler pages dev dist --port 8787
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787).

### Development Workflow

1. Create a branch: `git checkout -b feat/your-feature`
2. Make changes
3. Run checks:
   ```sh
   npm run typecheck   # TypeScript
   npm run build       # Vite production build
   ```
4. Test locally with `npx wrangler pages dev dist --port 8787`
5. Commit with a clear message (see Commit Convention below)
6. Push and open a PR

### Commit Convention

Use [conventional commits](https://www.conventionalcommits.org/):

```
feat: add screen share toggle
fix: stop infinite polling on empty transcript
deploy: update production secrets
docs: update README with API reference
```

### Hot Reload During Development

The current setup requires a manual rebuild for frontend changes:

```sh
# Terminal 1: Watch + rebuild frontend on save
npx vite build --watch

# Terminal 2: Run Pages dev server
npx wrangler pages dev dist --port 8787
```

For Pages Functions changes (anything in `functions/`), the dev server auto-reloads — just refresh the browser.

### Console Logs

All files include tagged console logs for debugging:

- **Frontend (browser console):** `[Home]`, `[Meeting]`, `[MeetingView]`, `[Summary]`, `[Dashboard]`, `[api.ts]`, `[auth]`
- **Backend (wrangler output):** `[rooms.ts]`, `[participants.ts]`, `[summary.ts]`, `[meetings.ts]`

## Code Style

- **TypeScript** — All new code must pass `tsc --noEmit --skipLibCheck`
- **No comments** — Unless explicitly requested or the code is genuinely non-obvious
- **CSS** — Use CSS custom properties (variables) defined in `:root` in `src/pages.css`
- **Naming** — `camelCase` for variables/functions, `PascalCase` for components/types, `kebab-case` for CSS classes
- **Imports** — Group: (1) external packages, (2) internal modules, (3) relative imports

## Project Conventions

### Pages Functions Routing

Cloudflare Pages uses **folder-based** dynamic routes. Do NOT use flat `[id]` in filenames:

```
✅ functions/api/rooms/[id]/participants.ts   → POST /api/rooms/:id/participants
✅ functions/api/summary/[id].ts               → GET /api/summary/:id
❌ functions/api/rooms.[id].participants.ts    → Does NOT work on Pages
```

### RealtimeKit API

- Base URL: `https://api.cloudflare.com/client/v4/accounts/{account_id}/realtime/kit/{app_id}/...`
- Auth: `Authorization: Bearer {CF_API_TOKEN}`
- Sessions are **top-level**: `GET /sessions?meeting_id={meetingId}` (not nested under meetings)
- Recordings are **top-level**: `GET /recordings?meeting_id={meetingId}`
- Field names use `snake_case`: `transcript_download_url`, `download_url`, `audio_download_url`
- Preset names use `snake_case`: `group_call_host` (not `group-call-host`)
- Participants require `custom_participant_id` (use `crypto.randomUUID()`)

### Frontend

- Use `useAuth()` hook for auth state (not the raw `FormsDBAuth` class directly)
- Use the fetch helpers in `src/lib/api.ts` for all API calls
- The `Layout` component wraps all non-meeting pages with the navbar
- Meeting pages render full-screen (no navbar) — the Layout skips itself for `/meeting/*` routes

### Auth

- Auth is handled by the central PocketBase gateway at `formsdb.exe.xyz`
- The `formsdb-auth.js` module is a drop-in with zero dependencies
- Session is stored in `localStorage` key `formsdb_auth_session`
- Do not modify `formsdb-auth.js` unless the auth protocol changes

## Deployment

### Via CLI (manual)

```sh
npm run build
npx wrangler pages deploy dist --project-name ve-rooom --branch main
```

### Via GitHub (auto-deploy)

The project is connected to GitHub for automatic deployments:

1. Push to `main` branch
2. Cloudflare Pages builds automatically (`npm run build` → `dist/`)
3. Deploys to [ve-rooom.pages.dev](https://ve-rooom.pages.dev)

Secrets are managed via `wrangler pages secret put` — they are NOT in the repo.

## Testing

There is no test framework set up yet. For now:

- Test manually in two browsers (create + join)
- Verify the API endpoints with curl:
  ```sh
  curl -X POST http://127.0.0.1:8787/api/rooms -H "Content-Type: application/json" -d '{"name":"Test"}'
  ```
- Check the wrangler log output for backend errors
- Check browser DevTools console for frontend errors

## Common Issues

### `405 Method Not Allowed` on API routes
Pages Functions route mismatch. Ensure dynamic routes use folder-based `[id]` directories, not flat `[id]` in filenames.

### `Cannot read "downloadUrl" of undefined`
The RealtimeKit API uses `transcript_download_url` and `download_url` (snake_case), not `downloadUrl` (camelCase).

### Meeting UI doesn't fill the screen
Ensure `.meeting-container rtk-meeting` has `width: 100% !important; height: 100% !important` and do NOT override `display` (the Stencil shadow DOM uses `display: flex` internally).

### Infinite "Transcription is still processing"
If nobody spoke during the meeting, the transcript is empty. The code now detects this and returns a "no speech detected" summary instead of polling forever.

### Broken avatar image
The Google profile picture URL is in `meta.rawUser.picture`. If the PocketBase record doesn't have `avatarURL` set, the navbar shows a placeholder circle instead.