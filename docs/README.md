# VE Rooom

Video conferencing with AI-powered transcription and meeting summaries.

[![Live](https://img.shields.io/badge/live-ve--rooom.pages.dev-fbbf24?style=flat-square)](https://ve-rooom.pages.dev)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Pages-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev)

## What is this?

VE Rooom is a Google Meet–style video conferencing app where every meeting is automatically recorded, transcribed, and summarized with AI. No setup, no plugins — just enter your name and start a meeting.

## Features

- Instant meetings (no signup required)
- Automatic recording (MP4 + MP3)
- AI transcription (Whisper Large v3 Turbo)
- AI summary with action items (Ollama Cloud)
- Google Sign-in (optional)
- Dashboard with meeting history
- 5+ participants supported

## Tech

- **Frontend:** React + Vite + TypeScript
- **Backend:** Cloudflare Pages Functions (Workers)
- **Media:** Cloudflare RealtimeKit (SFU + recording + transcription)
- **Auth:** Google OAuth via PocketBase
- **Deploy:** Cloudflare Pages

## Quick Start

```sh
git clone https://github.com/collectivewinca/ve-rooom.git
cd ve-rooom
npm install
cp .dev.vars.example .dev.vars  # Fill in your credentials
npm run build
npx wrangler pages dev dist --port 8787
```

Open http://127.0.0.1:8787

## Docs

- [Full README](README.md) — Setup, API reference, environment variables
- [Architecture](docs/ARCHITECTURE.md) — System design, data flows, RealtimeKit API reference
- [Contributing](CONTRIBUTING.md) — Development setup, code style, common issues
- [Auth](docs/AUTH.md) — Google OAuth via PocketBase
- [Internship Notes](docs/INTERNSHIP.md) — Project history, decisions, future work

## License

MIT