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
- **Dual auto-recording** — composite (MP4 + MP3) + per-participant track (WebM audio)
- AI transcription (3-source: CF transcript → Whisper on WebM tracks → Whisper on composite MP3)
- AI summary with action items (OpenRouter free models → Ollama → CF built-in)
- Google Sign-in (optional)
- Dashboard with meeting history
- 5+ participants supported
- Recording indicator + download cards (CSV, transcript text, MP4, MP3, WebM)

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

- [Full README](../README.md) — Setup, API reference, environment variables
- [Architecture](ARCHITECTURE.md) — System design, data flows, dual recording pipeline, 3-source transcription
- [Recordings](RECORDINGS.md) — Composite + track recording architecture, API schema, dedup logic
- [Transcription](TRANSCRIPTION.md) — 3-source pipeline (CF transcript, Whisper WebM, Whisper MP3)
- [Cloudflare RealtimeKit](CLOUDFLARE-REALTIMEKIT.md) — API reference, track recording layers/outputs schema
- [Contributing](../CONTRIBUTING.md) — Development setup, code style, common issues
- [Auth](AUTH.md) — Google OAuth via PocketBase
- [Internship Notes](INTERNSHIP.md) — Project history, decisions, future work

## License

MIT