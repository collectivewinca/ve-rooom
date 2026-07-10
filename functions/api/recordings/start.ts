import { verifyAuthToken } from "../../auth";
import { jsonResponse } from "../../lib/response";
import { checkRateLimit } from "../../lib/rate-limit";
import type { AppEnv } from "../../lib/env";

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

type Env = Pick<AppEnv, "CF_ACCOUNT_ID" | "CF_API_TOKEN" | "RTK_APP_ID" | "OLLAMA_API_KEY" | "OLLAMA_BASE_URL" | "FORMSDB_URL" | "MEETING_CACHE">;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	const rl = await checkRateLimit(env.MEETING_CACHE, request);
	if (!rl.allowed) return jsonResponse(429, { error: "Too many requests. Please slow down." });

	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.RTK_APP_ID) {
		return jsonResponse(500, { error: "Server missing configuration" });
	}

	let body: { meetingId?: string; authToken?: string };
	try {
		body = await request.json();
		console.log("[recordings/start.ts] Request body:", body);
	} catch {
		return jsonResponse(400, { error: "Invalid JSON body" });
	}

	const user = await verifyAuthToken(body.authToken, env);
	if (!user) {
		console.log("[recordings/start.ts] Auth verification failed");
		return jsonResponse(401, { error: "Authentication required" });
	}

	const meetingId = body.meetingId?.trim();
	if (!meetingId) {
		return jsonResponse(400, { error: "meetingId is required" });
	}

	const authHeaders = {
		Authorization: `Bearer ${env.CF_API_TOKEN}`,
		"Content-Type": "application/json",
	};

	console.log("[recordings/start.ts] Checking for existing active recordings for meeting:", meetingId);
	const existingRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/recordings?meeting_id=${meetingId}`,
		{ headers: authHeaders }
	);

	if (existingRes.ok) {
		const existingJson = await existingRes.json() as {
			success: boolean;
			data?: { status: string; type?: string }[];
		};
		const recordings = existingJson.data || [];
		const activeComposite = recordings.find(
			(r) => (r.status === "INVOKED" || r.status === "RECORDING") && r.type !== "TRACK"
		);
		if (activeComposite) {
			console.log("[recordings/start.ts] Active composite recording already exists — skipping");
			return jsonResponse(200, { alreadyStarted: true, status: activeComposite.status });
		}
		console.log("[recordings/start.ts] No active composite recording found — starting new one");
	} else {
		console.log("[recordings/start.ts] Existing recordings check failed, status:", existingRes.status, "— proceeding to start");
	}

	console.log("[recordings/start.ts] Starting composite recording with allow_multiple_recordings: true");
	const startRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/recordings`,
		{
			method: "POST",
			headers: authHeaders,
			body: JSON.stringify({
				meeting_id: meetingId,
				allow_multiple_recordings: true,
				realtimekit_bucket_config: { enabled: true },
				audio_config: { codec: "MP3", export_file: true },
			}),
		}
	);

	console.log("[recordings/start.ts] Start recording response status:", startRes.status);

	if (!startRes.ok) {
		const errText = await startRes.text();
		console.log("[recordings/start.ts] Start recording failed:", errText);
		return jsonResponse(startRes.status, { error: "Failed to start recording", detail: errText });
	}

	const startJson = await startRes.json() as {
		success: boolean;
		data: { id: string; status: string };
	};

	console.log("[recordings/start.ts] Composite recording started, id:", startJson.data.id, "status:", startJson.data.status);

	return jsonResponse(200, {
		recordingId: startJson.data.id,
		status: startJson.data.status,
	});
};

