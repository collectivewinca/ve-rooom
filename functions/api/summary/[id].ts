interface Env {
	CF_ACCOUNT_ID: string;
	CF_API_TOKEN: string;
	RTK_APP_ID: string;
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

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
	const meetingId = params.id as string;
	console.log("[summary.ts] GET /api/summary/:id — start, meetingId:", meetingId);

	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.RTK_APP_ID) {
		console.log("[summary.ts] Missing Cloudflare config");
		return jsonResponse(500, { status: "error", error: "Server missing Cloudflare configuration" });
	}

	const authHeaders = {
		Authorization: `Bearer ${env.CF_API_TOKEN}`,
		"Content-Type": "application/json",
	};

	// 1. Find the latest ended session for this meeting
	console.log("[summary.ts] Step 1: Fetching ended sessions for meeting:", meetingId);
	const sessionsRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions?meeting_id=${meetingId}`,
		{ headers: authHeaders }
	);

	console.log("[summary.ts] Sessions response status:", sessionsRes.status);

	if (!sessionsRes.ok) {
		const errText = await sessionsRes.text();
		console.log("[summary.ts] Sessions fetch failed:", errText);
		return jsonResponse(sessionsRes.status, { status: "error", error: "Failed to fetch sessions" });
	}

	const sessionsJson = await sessionsRes.json() as {
		success: boolean;
		data?: { sessions?: { id: string; associated_id: string; status: string; recording_status?: string }[] };
	};
	const allSessions = sessionsJson.data?.sessions || [];
	const endedSessions = allSessions.filter((s) => s.associated_id === meetingId && s.status === "ENDED");
	const session = endedSessions[0];
	console.log("[summary.ts] Total sessions:", allSessions.length, "Ended sessions for this meeting:", endedSessions.length, "— using session:", session?.id);

	if (!session) {
		console.log("[summary.ts] No ended session yet — returning no_ended_session");
		return jsonResponse(200, { status: "no_ended_session" });
	}

	// 1.5. Check session details for recording status
	console.log("[summary.ts] Step 1.5: Fetching session details for:", session.id);
	try {
		const sessionDetailRes = await fetch(
			`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions/${session.id}`,
			{ headers: authHeaders }
		);
		if (sessionDetailRes.ok) {
			const sessionDetail = await sessionDetailRes.json() as Record<string, unknown>;
			console.log("[summary.ts] Session details:", JSON.stringify(sessionDetail));
		} else {
			console.log("[summary.ts] Session details fetch failed:", sessionDetailRes.status);
		}
	} catch (e) {
		console.log("[summary.ts] Session details fetch error:", e);
	}

	// 2. Fetch transcript URL
	console.log("[summary.ts] Step 2: Fetching transcript for session:", session.id);
	const transcriptRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions/${session.id}/transcript`,
		{ headers: authHeaders }
	);

	console.log("[summary.ts] Transcript response status:", transcriptRes.status);

	if (!transcriptRes.ok) {
		const errText = await transcriptRes.text();
		console.log("[summary.ts] Transcript endpoint failed — status:", transcriptRes.status, "body:", errText);
		// If 4xx (not found / not configured), transcription likely won't ever arrive
		if (transcriptRes.status >= 400 && transcriptRes.status < 500) {
			return jsonResponse(200, { status: "no_summary", error: `Transcription not available (HTTP ${transcriptRes.status}). Recording exists — download the audio to transcribe manually.` });
		}
		return jsonResponse(200, { status: "processing" });
	}

	const transcriptJson = await transcriptRes.json() as {
		success: boolean;
		data?: { transcript_download_url?: string; transcript_download_url_expiry?: string; downloadUrl?: string; downloadUrlExpiry?: string };
	};
	const transcriptUrl = transcriptJson.data?.transcript_download_url || transcriptJson.data?.downloadUrl;
	console.log("[summary.ts] Transcript downloadUrl:", transcriptUrl ? transcriptUrl.slice(0, 60) + "..." : "none");

	if (!transcriptUrl) {
		console.log("[summary.ts] No transcript URL — returning processing");
		return jsonResponse(200, { status: "processing" });
	}

	// 3. Download the transcript file
	console.log("[summary.ts] Step 3: Downloading transcript file");
	const transcriptFileRes = await fetch(transcriptUrl);
	console.log("[summary.ts] Transcript file response status:", transcriptFileRes.status);
	if (!transcriptFileRes.ok) {
		console.log("[summary.ts] Transcript file download failed — returning processing");
		return jsonResponse(200, { status: "processing" });
	}
	const transcriptText = await transcriptFileRes.text();
	console.log("[summary.ts] Transcript text length:", transcriptText.length, "chars");
	console.log("[summary.ts] Transcript preview (first 200 chars):", transcriptText.slice(0, 200));

	// If transcript is empty (no speech detected), return early
	const trimmedTranscript = transcriptText.trim();
	const transcriptLines = trimmedTranscript.split("\n").filter((l) => l.trim());
	if (transcriptLines.length === 0) {
		console.log("[summary.ts] Transcript is empty or too short — no speech detected in meeting");
		return jsonResponse(200, {
			status: "ok",
			summary: "## Meeting Summary\n\nNo speech was detected in this meeting. The transcript is empty, so no summary could be generated.\n\n## Key Topics Discussed\n\n- No topics were discussed (no speech detected in the recording)\n\n## Decisions Made\n\n- No decisions were made (no conversation recorded)\n\n## Action Items\n\n- [ ] **N/A** — No action items (no speech detected)\n\n## Open Questions\n\n- No open questions\n\n## Participants\n\n- No participants spoke during this meeting\n\n## Sentiment & Engagement\n\nNo assessment available — no speech was detected.",
			transcriptUrl,
			recordingUrl: undefined,
			audioRecordingUrl: undefined,
			sessionId: session.id,
		});
	}

	// 4. Call Ollama Cloud
	let summary: string | undefined;
	const ollamaModel = env.OLLAMA_MODEL || "gpt-oss:120b";

	if (env.OLLAMA_BASE_URL && env.OLLAMA_API_KEY && env.OLLAMA_API_KEY !== "placeholder") {
		console.log("[summary.ts] Step 4: Calling Ollama Cloud at:", env.OLLAMA_BASE_URL, "model:", ollamaModel);
		try {
			const ollamaRes = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${env.OLLAMA_API_KEY}`,
				},
				body: JSON.stringify({
					model: ollamaModel,
					stream: false,
					messages: [
						{ role: "system", content: SUMMARY_SYSTEM_PROMPT },
						{ role: "user", content: `Here is the meeting transcript:\n\n${transcriptText}` },
					],
				}),
			});

			console.log("[summary.ts] Ollama response status:", ollamaRes.status);

			if (ollamaRes.ok) {
				const ollamaJson = await ollamaRes.json() as {
					message?: { content?: string };
				};
				summary = ollamaJson.message?.content;
				console.log("[summary.ts] Ollama summary received, length:", summary?.length || 0, "chars");
				if (summary) {
					console.log("[summary.ts] Summary preview (first 300 chars):", summary.slice(0, 300));
				}
			} else {
				const errText = await ollamaRes.text();
				console.log("[summary.ts] Ollama call failed:", errText);
			}
		} catch (e) {
			console.log("[summary.ts] Ollama call threw error:", e instanceof Error ? e.message : String(e));
		}
	} else {
		console.log("[summary.ts] Step 4: Ollama not configured (or placeholder key) — skipping");
	}

	// 5. Fallback: try Cloudflare's built-in summary if Ollama didn't produce one
	if (!summary) {
		console.log("[summary.ts] Step 5: Falling back to Cloudflare built-in summary for session:", session.id);
		const summaryRes = await fetch(
			`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions/${session.id}/summary`,
			{ headers: authHeaders }
		);
		console.log("[summary.ts] CF summary response status:", summaryRes.status);
		if (summaryRes.ok) {
			const summaryJson = await summaryRes.json() as {
				data?: { summary?: string };
			};
			summary = summaryJson.data?.summary;
			console.log("[summary.ts] CF summary received, length:", summary?.length || 0, "chars");
		} else {
			const errText = await summaryRes.text();
			console.log("[summary.ts] CF summary fetch failed:", errText);
		}
	}

	// 6. Fetch recording URL (best-effort)
	console.log("[summary.ts] Step 6: Fetching recording URL (best-effort)");
	let recordingUrl: string | undefined;
	let audioRecordingUrl: string | undefined;
	try {
		const recRes = await fetch(
			`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/recordings?meeting_id=${meetingId}`,
			{ headers: authHeaders }
		);
		console.log("[summary.ts] Recordings response status:", recRes.status);
		if (recRes.ok) {
			const recJson = await recRes.json() as {
				success: boolean;
				data?: { meeting_id: string; download_url: string; audio_download_url?: string; status: string }[];
			};
			const rec = recJson.data?.find((r) => r.meeting_id === meetingId);
			recordingUrl = rec?.download_url;
			audioRecordingUrl = rec?.audio_download_url;
			console.log("[summary.ts] Recording URL:", recordingUrl ? recordingUrl.slice(0, 60) + "..." : "none");
			console.log("[summary.ts] Audio recording URL:", audioRecordingUrl ? audioRecordingUrl.slice(0, 60) + "..." : "none");
		}
	} catch (e) {
		console.log("[summary.ts] Recording fetch threw error:", e instanceof Error ? e.message : String(e));
	}

	console.log("[summary.ts] Done — status:", summary ? "ok" : "no_summary");

	return jsonResponse(200, {
		status: summary ? "ok" : "no_summary",
		summary,
		transcriptUrl,
		recordingUrl,
		audioRecordingUrl,
		sessionId: session.id,
	});
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}