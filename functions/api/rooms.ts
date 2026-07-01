interface Env {
	CF_ACCOUNT_ID: string;
	CF_API_TOKEN: string;
	RTK_APP_ID: string;
}

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.RTK_APP_ID) {
		return jsonResponse(500, { error: "Server missing configuration. Set CF_ACCOUNT_ID, CF_API_TOKEN, RTK_APP_ID in .dev.vars" });
	}

	let body: { name?: string; roomTitle?: string };
	try {
		body = await request.json();
	} catch {
		return jsonResponse(400, { error: "Invalid JSON body" });
	}

	const name = body.name?.trim();
	if (!name) {
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
			transcription: { language: "en" },
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

	const meetingRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/meetings`,
		{ method: "POST", headers: authHeaders, body: JSON.stringify(meetingBody) }
	);

	if (!meetingRes.ok) {
		const errText = await meetingRes.text();
		return jsonResponse(meetingRes.status, { error: "Failed to create meeting", detail: errText });
	}

	const meetingJson = await meetingRes.json() as {
		success: boolean;
		data: { id: string };
	};
	const meetingId = meetingJson.data.id;

	const participantRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/meetings/${meetingId}/participants`,
		{
			method: "POST",
			headers: authHeaders,
			body: JSON.stringify({ name, preset_name: "group-call-host" }),
		}
	);

	if (!participantRes.ok) {
		const errText = await participantRes.text();
		return jsonResponse(participantRes.status, { error: "Failed to add participant", detail: errText });
	}

	const participantJson = await participantRes.json() as {
		success: boolean;
		data: { token: string };
	};

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