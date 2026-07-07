# Recordings

VE Rooom runs **two recording types concurrently** for every meeting: composite (mixed video+audio) and track (per-participant audio). Both auto-start 5 seconds after the meeting becomes ready, with server-side dedup to prevent duplicate recordings when multiple participants join.

## Recording Types

| Type | Endpoint | Output | Use Case |
|---|---|---|---|
| Composite | `POST /recordings` | `.mp4` (video+audio) + `.mp3` (audio-only) | Full meeting playback, mixed audio for transcription |
| Track | `POST /recordings/track` | `.webm` per participant (audio-only) | Per-speaker transcription without diarization |

## Composite Recording

**File:** `functions/api/recordings/start.ts`

### Request Body (to CF API)
```json
{
  "meeting_id": "bbbf4706-...",
  "allow_multiple_recordings": true,
  "realtimekit_bucket_config": {
    "upload_prefix": "ve-rooom"
  },
  "audio_config": {
    "codec": "MP3",
    "export_file": true
  }
}
```

### Response
```json
{
  "recordingId": "fff3c771-...",
  "status": "RECORDING",
  "type": "composite"
}
```

### Download URLs (when `status: "UPLOADED"`)
- `download_url` — string URL to `.mp4` (R2 signed, 7-day expiry)
- `audio_download_url` — string URL to `.mp3` (R2 signed, 7-day expiry)

## Track Recording

**File:** `functions/api/recordings/track.ts`

### Request Body (to CF API)
```json
{
  "meeting_id": "bbbf4706-...",
  "layers": {
    "default": {
      "file_name_prefix": "participant",
      "outputs": [
        {
          "type": "REALTIMEKIT_BUCKET"
        }
      ]
    }
  }
}
```

### ⚠️ API Schema Quirks

The CF docs say `layers` is **optional** and only shows `file_name_prefix` + `media_kind`. In practice:

1. **`layers` is required** — omitting it returns `422: "layers" is required`
2. **`layers.default.outputs` is required** — must be an array
3. **`outputs[0].type` is required** — must be one of: `REALTIMEKIT_BUCKET`, `DYTE_BUCKET`, `STORAGE_CONFIG`, `RTMP_OUT`, `WEBSOCKET`
4. **`layers.default.media_kind` is NOT allowed** — including it returns `422: "layers.default.media_kind" is not allowed` (track recording is audio-only by default)
5. **`file_name_prefix` is optional** — defaults to `"default"`

### Response
```json
{
  "recordingId": "fffe1f82-...",
  "status": "INVOKED",
  "type": "TRACK"
}
```

### Track File Format

Filename: `{{file_name_prefix}}_{{user_id}}_{{peer_id}}_{{stream_kind}}_{{media_kind}}_{{date_time}}.webm`

Example: `participant_aaa708b8-1488-4344-9a08-186457e6908f_0c2dd5dd-137d-4da4-88c0-c83b607c44ec_peer_media_kind_audio_1783406002832.webm`

Parsed fields:
- `file_name_prefix` — `"participant"` (our custom prefix)
- `user_id` — RealtimeKit user UUID
- `peer_id` — Peer connection UUID
- `stream_kind` — `"peer"`
- `media_kind` — `"audio"` (video track recording is in development)
- `date_time` — Unix timestamp in milliseconds

### Download URL Structure (when `status: "UPLOADED"`)

**Unlike composite, `download_url` is an ARRAY for track recordings:**

```json
{
  "download_url": [
    {
      "layer_name": "default",
      "download_urls": {
        "participant_aaa708b8-..._audio_1783406002832.webm": {
          "download_url": "https://storage.googleapis.com/..."
        }
      }
    }
  ]
}
```

Each participant gets one `.webm` file. Multiple participants = multiple entries in `download_urls`.

## Server-Side Dedup

Both recording endpoints check for existing active recordings before starting new ones:

### Composite Dedup (`recordings/start.ts`)
```typescript
const activeComposite = recordings.find(
  (r) => (r.status === "INVOKED" || r.status === "RECORDING") && typeof r.download_url === "string"
);
if (activeComposite) {
  return { alreadyStarted: true, status: activeComposite.status };
}
```

### Track Dedup (`recordings/track.ts`)
```typescript
const activeTrack = recordings.find(
  (r) =>
    (r.status === "INVOKED" || r.status === "RECORDING") &&
    (r.type === "TRACK" || (r.output_file_name || "").endsWith(".webm"))
);
if (activeTrack) {
  return { alreadyStarted: true, recordingId: activeTrack.id, status: activeTrack.status };
}
```

### Why dedup by `.webm` extension?

The CF list recordings endpoint (`GET /recordings?meeting_id=`) returns `type` as an **empty string** for all recordings — not `"TRACK"` as documented. The only reliable way to identify track recordings is by checking `output_file_name` for `.webm` extension, or checking if `download_url` is an array (composite = string, track = array).

## Auto-Start Flow

**File:** `src/pages/Meeting.tsx`

```
Meeting ready (RtkMeeting rendered)
        │
        ▼
5s setTimeout (meetingRef pattern, survives StrictMode double-mount)
        │
        ├──→ POST /api/recordings/start { meetingId, authToken }
        │    ← { recordingId, status } or { alreadyStarted: true }
        │
        └──→ POST /api/recordings/track { meetingId, authToken }
             ← { recordingId, status, type: "TRACK" } or { alreadyStarted: true }
        │
        ▼
Recording indicator shows (red pulsing dot + "Recording..." text)
```

### Why `record_on_start: false` in rooms.ts?

CF's built-in `record_on_start: true` starts recording immediately when the first participant joins. We set it to `false` and manually start recordings 5s after join because:

1. **Server-side dedup** — If 5 participants join, we only want 1 composite + 1 track recording, not 5
2. **`allow_multiple_recordings: true`** — Needed to run composite + track concurrently
3. **Control over timing** — 5s delay ensures the meeting UI is fully loaded before recording

## Track File Duration vs Composite Duration

Track files are **time-aligned to the meeting start** (silence is preserved, not concatenated speech). However, track files may be **shorter** than the composite recording:

- **Composite**: Records continuously from start to stop (full meeting duration)
- **Track**: Records per-participant — if a participant leaves early, their WebM file ends when they leave

Example from test meeting:
- Composite: 209s (full meeting)
- Track: 137s (participant left at ~137s)

This is correct behavior. For transcript merging, each track's timestamps are relative to the meeting start, so they can be aligned with the composite timeline.

## Storage & Expiry

- **Composite**: R2 bucket (`rtk-prod-recording.*.r2.cloudflarestorage.com`), 7-day signed URLs
- **Track**: GCS bucket (`storage.googleapis.com/prod-iad-dyte-gcp-streamline/...`), 7-day signed URLs
- **No deletion API** — recordings auto-expire after 7 days
- **`file_size` is 0 for track recordings** in the API response (CF quirk — actual size is in the storage bucket but not reflected in the API)

## API Response Shape Differences

| Field | Composite | Track |
|---|---|---|
| `download_url` | string (MP4 URL) | array of `{ layer_name, download_urls }` |
| `audio_download_url` | string (MP3 URL) | empty |
| `file_size` | actual bytes | always `0` |
| `type` | empty string | empty string (not `"TRACK"`) |
| `output_file_name` | `{meetingId}_{timestamp}.mp4` | `{{prefix}}_{{user_id}}_..._audio_{{timestamp}}.webm` |

## SDK Version Requirements

Track recording (`user_ids` for specific participants) requires:
- Web Core: `@cloudflare/realtimekit` 1.4.0+
- React UI Kit: `@cloudflare/realtimekit-react-ui` 1.1.2+

We record all participants (no `user_ids` filter), so SDK version is not a constraint.