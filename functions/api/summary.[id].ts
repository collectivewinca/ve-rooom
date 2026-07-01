interface Env {
	CF_ACCOUNT_ID: string;
	CF_API_TOKEN: string;
	RTK_APP_ID: string;
	OLLAMA_API_KEY: string;
	OLLAMA_BASE_URL: string;
	OLLAMA_MODEL?: string;
}

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

const SUMMARY_SYSTEM_PROMPT = `You are a meeting assistant. Given a meeting transcript, produce a well-structured Markdown summary with these sections:

## Summary
A concise paragraph (3-5 sentences) capturing what the meeting was about.

## Key Decisions
Bullet list of decisions made.

## Action Items
A checklist with the owner's name in **bold** and a brief task description. If no owner is identifiable, use "Unassigned".

Keep it clear, professional, and skimmable. Do not invent information not in the transcript.`;

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
	const meetingId = params.id as string;

	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.RTK_APP_ID) {
		return jsonResponse(500, { status: "error", error: "Server missing Cloudflare configuration" });
	}

	const authHeaders = {
		Authorization: `Bearer ${env.CF_API_TOKEN}`,
		"Content-Type": "application/json",
	};

	// 1. Find the latest ended session for this meeting
	const sessionsRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/meetings/${meetingId}/sessions?status=ENDED`,
		{ headers: authHeaders }
	);

	if (!sessionsRes.ok) {
		return jsonResponse(sessionsRes.status, { status: "error", error: "Failed to fetch sessions" });
	}

	const sessionsJson = await sessionsRes.json() as {
		success: boolean;
		data?: { sessions?: { id: string }[] };
	};
	const session = sessionsJson.data?.sessions?.[0];
	if (!session) {
		return jsonResponse(200, { status: "no_ended_session" });
	}

	// 2. Fetch transcript URL
	const transcriptRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions/${session.id}/transcript`,
		{ headers: authHeaders }
	);

	if (!transcriptRes.ok) {
		return jsonResponse(200, { status: "processing" });
	}

	const transcriptJson = await transcriptRes.json() as {
		success: boolean;
		data?: { downloadUrl?: string; downloadUrlExpiry?: string };
	};
	const transcriptUrl = transcriptJson.data?.downloadUrl;

	if (!transcriptUrl) {
		return jsonResponse(200, { status: "processing" });
	}

	// 3. Download the transcript file
	const transcriptFileRes = await fetch(transcriptUrl);
	if (!transcriptFileRes.ok) {
		return jsonResponse(200, { status: "processing" });
	}
	const transcriptText = await transcriptFileRes.text();

	// 4. Call Ollama Cloud (if configured)
	let summary: string | undefined;
	if (env.OLLAMA_BASE_URL && env.OLLAMA_API_KEY) {
		try {
			const ollamaRes = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${env.OLLAMA_API_KEY}`,
				},
				body: JSON.stringify({
					model: env.OLLAMA_MODEL || "llama3.1:8b",
					stream: false,
					messages: [
						{ role: "system", content: SUMMARY_SYSTEM_PROMPT },
						{ role: "user", content: transcriptText },
					],
				}),
			});

			if (ollamaRes.ok) {
				const ollamaJson = await ollamaRes.json() as {
					message?: { content?: string };
				};
				summary = ollamaJson.message?.content;
			}
		} catch {
			// Ollama failed — fall through to Cloudflare built-in summary below
		}
	}

	// 5. Fallback: try Cloudflare's built-in summary if Ollama didn't produce one
	if (!summary) {
		const summaryRes = await fetch(
			`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions/${session.id}/summary`,
			{ headers: authHeaders }
		);
		if (summaryRes.ok) {
			const summaryJson = await summaryRes.json() as {
				data?: { summary?: string };
			};
			summary = summaryJson.data?.summary;
		}
	}

	// 6. Fetch recording URL (best-effort)
	let recordingUrl: string | undefined;
	try {
		const recRes = await fetch(
			`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/meetings/${meetingId}/recordings`,
			{ headers: authHeaders }
		);
		if (recRes.ok) {
			const recJson = await recRes.json() as {
				data?: { recordings?: { downloadUrl?: string }[] };
			};
			recordingUrl = recJson.data?.recordings?.[0]?.downloadUrl;
		}
	} catch {
		// recording fetch is best-effort
	}

	return jsonResponse(200, {
		status: summary ? "ok" : "processing",
		summary,
		transcriptUrl,
		recordingUrl,
		sessionId: session.id,
	});
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}