import { saveRecordingRefs, getRecordingRefs, type RecordingRef } from "../../lib/kv";
import { jsonResponse } from "../../lib/response";
import { checkRateLimit } from "../../lib/rate-limit";
import type { AppEnv } from "../../lib/env";

type Env = Pick<AppEnv, "CF_ACCOUNT_ID" | "CF_API_TOKEN" | "RTK_APP_ID" | "MEETING_CACHE" | "RECORDINGS_BUCKET">;

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	const rl = await checkRateLimit(env.MEETING_CACHE, request);
	if (!rl.allowed) return jsonResponse(429, { error: "Too many requests. Please slow down." });

	const body = await request.json() as { meetingId?: string };
	const meetingId = body.meetingId?.trim();
	if (!meetingId) return jsonResponse(400, { error: "meetingId is required" });

	if (!env.RECORDINGS_BUCKET) {
		return jsonResponse(500, { error: "R2 storage not configured" });
	}

	const existing = await getRecordingRefs(env.MEETING_CACHE, meetingId);
	if (existing.length > 0) {
		console.log("[scan-r2] Found", existing.length, "existing recording refs for", meetingId);
		return jsonResponse(200, { refs: existing, cached: true });
	}

	const refs: RecordingRef[] = [];

	// R2 recordings arrive in two naming schemes depending on RTK config:
	//   - Nested:  <meetingId>/<sessionId>/composite.mp3   (older)
	//   - Flat:    <meetingId>_<timestamp>.mp3 / .mp4        (newer, Jul 17+)
	// Both share the meeting ID as a literal string prefix, so a single
	// list call with prefix=meetingId covers both. We then filter out any
	// keys from unrelated meetings that share a UUID prefix.
	const listed = await env.RECORDINGS_BUCKET.list({ prefix: meetingId, limit: 500 });
	console.log("[scan-r2] Listing R2 with prefix:", meetingId, "— found", listed.objects.length, "objects");

	for (const obj of listed.objects) {
		// Require the char after the meetingId to be "/" (nested) or "_" (flat).
		// This prevents matching a longer UUID that happens to start with meetingId.
		const afterId = obj.key.slice(meetingId.length);
		if (afterId !== "" && afterId[0] !== "/" && afterId[0] !== "_") continue;

		const ext = obj.key.split(".").pop()?.toLowerCase() || "";
		// Composite video = mp4; audio-only = mp3. Skip anything else.
		if (ext !== "mp3" && ext !== "mp4") continue;
		const type: "composite" | "audio" = ext === "mp3" ? "audio" : "composite";
		refs.push({
			key: obj.key,
			url: `/api/recording/${encodeURIComponent(obj.key)}`,
			type,
			size: obj.size,
			uploadedAt: obj.uploaded?.toISOString(),
		});
	}

	const deduped = refs.filter((r, i, arr) => arr.findIndex((x) => x.key === r.key) === i);
	console.log("[scan-r2] Found", deduped.length, "recordings for meeting", meetingId);

	if (deduped.length > 0) {
		await saveRecordingRefs(env.MEETING_CACHE, meetingId, deduped);
	}

	return jsonResponse(200, { refs: deduped, cached: false });
};