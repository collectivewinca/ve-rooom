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
		console.log("[recordings/track.ts] Request body:", body);
	} catch {
		return jsonResponse(400, { error: "Invalid JSON body" });
	}

	const user = await verifyAuthToken(body.authToken, env);
	if (!user) {
		console.log("[recordings/track.ts] Auth verification failed");
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

	console.log("[recordings/track.ts] Checking for existing active TRACK recordings for meeting:", meetingId);
	const existingRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/recordings?meeting_id=${meetingId}`,
		{ headers: authHeaders }
	);

	if (existingRes.ok) {
		const existingJson = (await existingRes.json()) as {
			success: boolean;
			data?: { id?: string; status: string; type?: string; output_file_name?: string }[];
		};
		const recordings = existingJson.data || [];
		const activeTrack = recordings.find(
			(r) =>
				(r.status === "INVOKED" || r.status === "RECORDING") &&
				(r.type === "TRACK" || (r.output_file_name || "").endsWith(".webm"))
		);
		if (activeTrack) {
			console.log("[recordings/track.ts] Active TRACK recording already exists — skipping", activeTrack.id);
			return jsonResponse(200, { alreadyStarted: true, status: activeTrack.status, recordingId: activeTrack.id });
		}
		console.log("[recordings/track.ts] No active TRACK recording found — starting new one");
	} else {
		console.log("[recordings/track.ts] Existing recordings check failed, status:", existingRes.status, "— proceeding to start");
	}

	console.log("[recordings/track.ts] Starting track recording (all participants)");
	const startRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/recordings/track`,
		{
			method: "POST",
			headers: authHeaders,
			body: JSON.stringify({
				meeting_id: meetingId,
				layers: {
					default: {
						file_name_prefix: "participant",
						outputs: [
							{
								type: "REALTIMEKIT_BUCKET",
							},
						],
					},
				},
			}),
		}
	);

	console.log("[recordings/track.ts] Start track recording response status:", startRes.status);

	if (!startRes.ok) {
		let errText = "";
		try {
			errText = await startRes.text();
		} catch {
			errText = "(could not read error body)";
		}
		console.log("[recordings/track.ts] Start track recording failed:", startRes.status, errText);
		if (startRes.status === 409) {
			return jsonResponse(200, { alreadyStarted: true, status: "RECORDING", note: "Track recording already active (409 from CF)" });
		}
		return jsonResponse(startRes.status, { error: "Failed to start track recording", detail: errText });
	}

	const startJson = await startRes.json() as {
		success: boolean;
		data?: { recording?: { id?: string; status?: string }; id?: string; status?: string };
	};

	console.log("[recordings/track.ts] Track recording response:", JSON.stringify(startJson).substring(0, 500));

	const recording = startJson.data?.recording || startJson.data;
	if (!recording?.id) {
		return jsonResponse(500, { error: "Track recording started but response missing recording id", detail: JSON.stringify(startJson).substring(0, 500) });
	}

	console.log("[recordings/track.ts] Track recording started, id:", recording.id, "status:", recording.status);

	return jsonResponse(200, {
		recordingId: recording.id,
		status: recording.status || "RECORDING",
		type: "TRACK",
	});
};

