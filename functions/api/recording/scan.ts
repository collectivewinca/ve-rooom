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

	const prefixes = [
		`${meetingId}/`,
		`recordings/${meetingId}/`,
		`${env.RTK_APP_ID}/${meetingId}/`,
	];

	for (const prefix of prefixes) {
		console.log("[scan-r2] Listing R2 with prefix:", prefix);
		const listed = await env.RECORDINGS_BUCKET.list({ prefix, limit: 100 });
		for (const obj of listed.objects) {
			const ext = obj.key.split(".").pop()?.toLowerCase() || "";
			const type: "composite" | "audio" = ext === "mp3" || ext === "mp4" ? (ext === "mp3" ? "audio" : "composite") : "composite";
			refs.push({
				key: obj.key,
				url: `/api/recording/${encodeURIComponent(obj.key)}`,
				type,
				size: obj.size,
				uploadedAt: obj.uploaded?.toISOString(),
			});
		}
		if (refs.length > 0) break;
	}

	const deduped = refs.filter((r, i, arr) => arr.findIndex((x) => x.key === r.key) === i);
	console.log("[scan-r2] Found", deduped.length, "recordings for meeting", meetingId);

	if (deduped.length > 0) {
		await saveRecordingRefs(env.MEETING_CACHE, meetingId, deduped);
	}

	return jsonResponse(200, { refs: deduped, cached: false });
};