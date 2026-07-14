# Future Features

## Conversation Flow Chart on Summary Page

**Status:** Not started (reverted from a draft implementation on 2026-07-14)

**Goal:** Add a graph at the end of the Summary page showing meeting conversation over time.
- X axis = total time of the meeting
- Y axis = conversation activity over the meeting

**Where it goes:** End of `src/pages/Summary.tsx`, after the `.summary-body-wrap` block. Only render when `showSummary && hasTranscript`.

### Known blocker — real timestamps

A draft was implemented and reverted because the data is too imprecise to be useful:

- The current transcript (`transcript_text` from `functions/lib/transcribe-core.ts:93`) is **plain text** — Cloudflare's `@cf/openai/whisper-large-v3-turbo` returns only `result.text`, no per-segment timestamps.
- The draft approximation bucketed words by count and mapped them onto `sessionInfo.recording_minutes` (from `functions/api/summary/[id].ts:238`). This gives word *density*, not real activity over time, so "peak at 12m" is a guess and can be misleading.

### To make it accurate, pick one of these first

1. **Use timestamped transcript segments.** Either:
   - Switch the Whisper call to a model/API that returns word/segment-level timestamps (e.g. OpenAI Whisper API with `response_format=verbose_json`, or `@cf/openai/whisper-large-v3-turbo` if/when Cloudflare exposes segments). Parse `segments[].start/end` on the server and pass them through `SummaryResponse`.
   - Or parse the Cloudflare RTK transcript CSV at `transcriptUrl` (see `functions/api/summary/[id].ts:228`) if it contains per-line timestamps, and expose those to the frontend.

2. **Derive activity from those timestamps** (e.g. words-per-second, or talking-turns density) so the x-axis reflects real elapsed time.

### Suggested implementation once timestamps are available

- Pure-SVG area chart (no new deps) keeps the bundle small.
- X axis: 0 → `recording_minutes`, tick labels in minutes.
- Y axis: 0–100% activity (normalized words/sec or talk-density), with an "avg" dashed line and a labeled "peak" marker.
- Theme: use CSS vars from `src/styles/variables.css` (`--color-primary-light`, `--gradient-card`, `--color-border`).
- Add a `ConversationChart` component inside `Summary.tsx` and styles in `src/styles/summary.css` under a `.conversation-chart` section.

### Files to touch
- `src/pages/Summary.tsx` — add component + render it at end of page.
- `src/styles/summary.css` — `.conversation-chart*` styles.
- `functions/lib/transcribe-core.ts` — return timestamped segments.
- `src/lib/api.ts` — extend `SummaryResponse` with segment data (or a new endpoint).