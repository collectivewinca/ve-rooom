import { verifyAuthToken } from "../auth";

interface Env {
	CF_ACCOUNT_ID: string;
	CF_API_TOKEN: string;
	RTK_APP_ID: string;
	OLLAMA_API_KEY: string;
	OLLAMA_BASE_URL: string;
	FORMSDB_URL?: string;
}

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	console.log("[rooms.ts] POST /api/rooms — start");

	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.RTK_APP_ID) {
		console.log("[rooms.ts] Missing config:", { hasAccountId: !!env.CF_ACCOUNT_ID, hasApiToken: !!env.CF_API_TOKEN, hasAppId: !!env.RTK_APP_ID });
		return jsonResponse(500, { error: "Server missing configuration. Set CF_ACCOUNT_ID, CF_API_TOKEN, RTK_APP_ID in .dev.vars" });
	}

	let body: { name?: string; roomTitle?: string; authToken?: string };
	try {
		body = await request.json();
		console.log("[rooms.ts] Request body:", body);
	} catch {
		console.log("[rooms.ts] Invalid JSON body");
		return jsonResponse(400, { error: "Invalid JSON body" });
	}

	const user = await verifyAuthToken(body.authToken, env);
	if (!user) {
		console.log("[rooms.ts] Auth verification failed");
		return jsonResponse(401, { error: "Authentication required. Please sign in with Google." });
	}

	const name = body.name?.trim() || user.name;
	if (!name) {
		console.log("[rooms.ts] Missing name");
		return jsonResponse(400, { error: "name is required" });
	}

	const authHeaders = {
		Authorization: `Bearer ${env.CF_API_TOKEN}`,
		"Content-Type": "application/json",
	};

	const meetingBody = {
		title: body.roomTitle?.trim() || "VE-Call",
		record_on_start: true,
		transcribe_on_end: true,
		summarize_on_end: true,
		ai_config: {
			transcription: { language: "en-US" },
			summarization: {
				summary_type: "general",
				text_format: "markdown",
				word_limit: 500,
			},
		},
		recording_config: {
			realtimekit_bucket_config: { enabled: true },
			audio_config: { codec: "MP3", export_file: true },
		},
	};

	console.log("[rooms.ts] Creating meeting with title:", meetingBody.title);

	const meetingRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/meetings`,
		{ method: "POST", headers: authHeaders, body: JSON.stringify(meetingBody) }
	);

	console.log("[rooms.ts] Create meeting response status:", meetingRes.status);

	if (!meetingRes.ok) {
		const errText = await meetingRes.text();
		console.log("[rooms.ts] Create meeting failed:", errText);
		return jsonResponse(meetingRes.status, { error: "Failed to create meeting", detail: errText });
	}

	const meetingJson = await meetingRes.json() as {
		success: boolean;
		data: { id: string };
	};
	const meetingId = meetingJson.data.id;
	console.log("[rooms.ts] Meeting created, id:", meetingId, "full response:", JSON.stringify(meetingJson));

	console.log("[rooms.ts] Adding participant:", name, "to meeting:", meetingId);

	const participantRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/meetings/${meetingId}/participants`,
		{
			method: "POST",
			headers: authHeaders,
			body: JSON.stringify({ name, preset_name: "group_call_host", custom_participant_id: crypto.randomUUID() }),
		}
	);

	console.log("[rooms.ts] Add participant response status:", participantRes.status);

	if (!participantRes.ok) {
		const errText = await participantRes.text();
		console.log("[rooms.ts] Add participant failed:", errText);
		return jsonResponse(participantRes.status, { error: "Failed to add participant", detail: errText });
	}

	const participantJson = await participantRes.json() as {
		success: boolean;
		data: { token: string };
	};

	console.log("[rooms.ts] Participant added, token received (truncated):", participantJson.data.token?.slice(0, 30) + "...");
	console.log("[rooms.ts] Done — returning roomId + authToken");

	return jsonResponse(200, {
		roomId: meetingId,
		authToken: participantJson.data.token,
	});
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}