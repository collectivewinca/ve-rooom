import { getRecordingRefs } from "../../../lib/kv";
import { jsonResponse } from "../../../lib/response";
import { checkRateLimit } from "../../../lib/rate-limit";
import type { AppEnv } from "../../../lib/env";

type Env = Pick<AppEnv, "MEETING_CACHE" | "RECORDINGS_BUCKET">;

export const onRequestGet: PagesFunction<Env> = async ({ params, request, env }) => {
	const rl = await checkRateLimit(env.MEETING_CACHE, request);
	if (!rl.allowed) return jsonResponse(429, { error: "Too many requests. Please slow down." });

	const key = params.key as string;
	if (!key) return jsonResponse(400, { error: "Recording key is required" });

	if (!env.RECORDINGS_BUCKET) {
		return jsonResponse(500, { error: "R2 storage not configured" });
	}

	const decodedKey = decodeURIComponent(key);

	try {
		const object = await env.RECORDINGS_BUCKET.get(decodedKey);
		if (!object) {
			console.log("[recording/[key]] Object not found:", decodedKey);
			return jsonResponse(404, { error: "Recording not found in R2 storage" });
		}

		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
		headers.set("Content-Length", object.size.toString());
		headers.set("Cache-Control", "public, max-age=86400");

		console.log("[recording/[key]] Serving:", decodedKey, "size:", object.size);
		return new Response(object.body, { headers });
	} catch (e) {
		console.log("[recording/[key]] Error:", e instanceof Error ? e.message : String(e));
		return jsonResponse(500, { error: "Failed to retrieve recording" });
	}
};