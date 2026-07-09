interface Env {
	CF_ACCOUNT_ID: string;
	CF_API_TOKEN: string;
	RTK_APP_ID: string;
	OPENROUTER_API_KEY: string;
	OPENROUTER_MODEL?: string;
	OPENROUTER_FREE_MODEL?: string;
	OLLAMA_API_KEY: string;
	OLLAMA_BASE_URL: string;
	OLLAMA_MODEL?: string;
}

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

const SUMMARY_SYSTEM_PROMPT = `You are an expert meeting analyst and executive assistant. Your job is to analyze a meeting transcript and produce a comprehensive, well-structured Markdown summary.

Here is the format you MUST follow:

## Meeting Summary
Write a detailed overview paragraph (4-8 sentences) explaining what the meeting was about, its purpose, the overall tone, and the main themes discussed. Include who was present if identifiable from the transcript.

## Key Topics Discussed
List every distinct topic that was discussed during the meeting. For each topic, write 2-4 sentences explaining what was said about it. Use bullet points. Be specific — reference actual points, numbers, or details mentioned.

## Decisions Made
List every decision that was reached during the meeting. Each decision should be a bullet point with the decision in **bold** followed by a brief explanation of the rationale. If no formal decisions were made, note that.

## Action Items
Extract every action item, task, or follow-up mentioned. Format as a checklist:
- [ ] **Owner Name** — Task description (deadline if mentioned)
If an owner is not identifiable, use **Unassigned**. Include any deadlines or timelines mentioned.

## Open Questions
List any questions that were raised but not resolved during the meeting. Format as bullet points. If none, note "No open questions."

## Participants
List the participants who spoke during the meeting (identifiable from the transcript). If you can tell from the transcript, note who seemed to be leading the meeting.

## Sentiment & Engagement
Provide a brief assessment (2-3 sentences) of the meeting's energy, engagement level, and any notable dynamics (e.g., disagreements, enthusiasm, confusion, urgency).

Rules:
- Be thorough and detailed — this summary should be useful for someone who did NOT attend the meeting.
- Use the actual words and names from the transcript. Do NOT invent information.
- If the transcript is unclear or fragmented, do your best and note any gaps.
- Keep it professional, clear, and skimmable with proper Markdown formatting.
- Use timestamps from the transcript to reference when key moments occurred, if available.`;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	const body = await request.json() as { meetingId: string; audioUrl: string; trackFiles?: { filename: string; downloadUrl: string; userId: string; peerId: string }[] };
	console.log("[transcribe.ts] POST — meetingId:", body.meetingId, "audioUrl:", body.audioUrl ? "found" : "none", "trackFiles:", body.trackFiles?.length || 0);

	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
		return jsonResponse(500, { error: "Server missing configuration" });
	}

	const authHeaders = {
		Authorization: `Bearer ${env.CF_API_TOKEN}`,
	};

	let transcriptText = "";

	// Try track files first (per-participant)
	if (body.trackFiles && body.trackFiles.length > 0) {
		console.log("[transcribe.ts] Trying Whisper on", body.trackFiles.length, "track files");
		const participantTranscripts: string[] = [];

		for (const track of body.trackFiles) {
			try {
				const audioRes = await fetch(track.downloadUrl);
				if (!audioRes.ok) continue;

				const cl = audioRes.headers.get("content-length");
				const sizeMb = cl ? parseInt(cl) / (1024 * 1024) : 0;
				console.log("[transcribe.ts] Track", track.userId, "size:", sizeMb.toFixed(1), "MB");
				if (sizeMb > 25) continue;

				const audioBuffer = await audioRes.arrayBuffer();
				const whisperRes = await fetch(
					`${RTK_BASE}/${env.CF_ACCOUNT_ID}/ai/run/@cf/openai/whisper`,
					{
						method: "POST",
						headers: { ...authHeaders, "Content-Type": "audio/webm" },
						body: audioBuffer,
					}
				);

				if (whisperRes.ok) {
					const wj = await whisperRes.json() as { result?: { text?: string } };
					const wt = wj.result?.text?.trim();
					console.log("[transcribe.ts] Track", track.userId, "transcript:", wt?.length || 0, "chars");
					if (wt && wt.length > 50) {
						const fp = wt.split(".")[0];
						const pc = (wt.match(new RegExp(fp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.?", "g")) || []).length;
						if (!(pc > 3 && wt.length < 200)) {
							participantTranscripts.push(`[Participant ${track.userId}]: ${wt}`);
						}
					}
				}
			} catch (e) {
				console.log("[transcribe.ts] Track error:", e instanceof Error ? e.message : String(e));
			}
		}
		if (participantTranscripts.length > 0) {
			transcriptText = participantTranscripts.join("\n\n");
		}
	}

	// If no track transcript, try composite audio
	if (transcriptText.trim().length === 0 && body.audioUrl) {
		console.log("[transcribe.ts] Trying Whisper on composite MP3");
		try {
			const audioRes = await fetch(body.audioUrl);
			if (audioRes.ok) {
				const cl = audioRes.headers.get("content-length");
				const sizeMb = cl ? parseInt(cl) / (1024 * 1024) : 0;
				console.log("[transcribe.ts] Composite size:", sizeMb.toFixed(1), "MB");

				if (sizeMb > 25) {
					return jsonResponse(200, {
						status: "too_large",
						sizeMb: sizeMb.toFixed(1),
						message: `Audio file is ${sizeMb.toFixed(1)} MB, exceeds 25 MB Workers AI limit. Download and transcribe manually.`,
					});
				}

				const audioBuffer = await audioRes.arrayBuffer();
				const whisperRes = await fetch(
					`${RTK_BASE}/${env.CF_ACCOUNT_ID}/ai/run/@cf/openai/whisper-large-v3-turbo`,
					{
						method: "POST",
						headers: { ...authHeaders, "Content-Type": "audio/mpeg" },
						body: audioBuffer,
					}
				);

				if (whisperRes.ok) {
					const wj = await whisperRes.json() as { result?: { text?: string } };
					const wt = wj.result?.text;
					console.log("[transcribe.ts] Composite transcript:", wt?.length || 0, "chars");
					if (wt && wt.trim()) {
						const trimmed = wt.trim();
						const fp = trimmed.split(".")[0];
						const pc = (trimmed.match(new RegExp(fp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\.?", "g")) || []).length;
						if (!(pc > 3 && trimmed.length < 200)) {
							transcriptText = trimmed;
						}
					}
				} else {
					const errText = await whisperRes.text();
					console.log("[transcribe.ts] Whisper failed:", whisperRes.status, errText.slice(0, 200));
					return jsonResponse(200, {
						status: "whisper_failed",
						httpStatus: whisperRes.status,
						message: `Whisper transcription failed (HTTP ${whisperRes.status}).`,
					});
				}
			}
		} catch (e) {
			console.log("[transcribe.ts] Composite error:", e instanceof Error ? e.message : String(e));
			return jsonResponse(200, { status: "error", error: e instanceof Error ? e.message : String(e) });
		}
	}

	if (transcriptText.trim().length === 0) {
		return jsonResponse(200, { status: "no_speech", message: "No speech detected in any audio source." });
	}

	// Return transcript immediately — frontend will call /api/generate-summary separately
	console.log("[transcribe.ts] Done — transcript:", transcriptText.length, "chars");
	return jsonResponse(200, {
		status: "transcribed",
		transcript: transcriptText,
	});
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
	// Re-transcribe with existing data (not used, but needed for Pages Functions routing)
	return jsonResponse(200, { status: "ok" });
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}