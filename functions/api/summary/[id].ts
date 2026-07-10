import { getCachedResult, getMeetingMeta, getParticipants, saveCachedResult } from "../../lib/kv";

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
	MEETING_CACHE: KVNamespace;
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

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
	const meetingId = params.id as string;
	console.log("[summary.ts] GET /api/summary/:id — start, meetingId:", meetingId);

	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.RTK_APP_ID) {
		return jsonResponse(500, { status: "error", error: "Server missing Cloudflare configuration" });
	}

	const authHeaders = {
		Authorization: `Bearer ${env.CF_API_TOKEN}`,
		"Content-Type": "application/json",
	};

	// 1. Find the LATEST ended session for this meeting
	const sessionsRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions?meeting_id=${meetingId}`,
		{ headers: authHeaders }
	);

	if (!sessionsRes.ok) {
		return jsonResponse(sessionsRes.status, { status: "error", error: "Failed to fetch sessions" });
	}

	const sessionsJson = await sessionsRes.json() as {
		success: boolean;
		data?: { sessions?: { id: string; associated_id: string; status: string; ended_at?: string; recording_status?: string; total_participants?: number; recording_minutes_consumed?: number; transcription_minutes_consumed?: number }[] };
	};
	const allSessions = sessionsJson.data?.sessions || [];
	const endedSessions = allSessions.filter((s) => s.associated_id === meetingId && s.status === "ENDED");
	endedSessions.sort((a, b) => (b.ended_at || "").localeCompare(a.ended_at || ""));
	const session = endedSessions[0];

	console.log("[summary.ts] Ended sessions:", endedSessions.length, "Latest:", session?.id, "ended_at:", session?.ended_at);

	if (!session) {
		return jsonResponse(200, { status: "no_ended_session" });
	}

	// 1.5. Check KV cache — if we already have a transcript + summary, return immediately
	const cached = await getCachedResult(env.MEETING_CACHE, meetingId);
	if (cached && cached.summary && cached.transcript) {
		console.log("[summary.ts] KV cache hit — returning cached result, summary:", cached.summary.length, "chars");

		// Fetch transcript URL + recording URLs for download cards (in parallel)
		const [transcriptUrlRes, recRes] = await Promise.all([
			fetch(`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions/${session.id}/transcript`, { headers: authHeaders }).catch(() => null),
			fetch(`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/recordings?meeting_id=${meetingId}`, { headers: authHeaders }).catch(() => null),
		]);

		let cachedTranscriptUrl: string | undefined;
		if (transcriptUrlRes && transcriptUrlRes.ok) {
			const tj = await transcriptUrlRes.json() as { data?: { transcript_download_url?: string; downloadUrl?: string } };
			cachedTranscriptUrl = tj.data?.transcript_download_url || tj.data?.downloadUrl;
		}

		let recordingUrl: string | undefined;
		let audioRecordingUrl: string | undefined;
		let trackFiles: { filename: string; downloadUrl: string; userId: string; peerId: string }[] = [];
		if (recRes && recRes.ok) {
			try {
				const recJson = await recRes.json() as { success: boolean; data?: { meeting_id: string; session_id?: string; download_url: unknown; audio_download_url?: string; status: string; output_file_name?: string }[] };
				const sessionRecordings = (recJson.data || []).filter((r) => r.meeting_id === meetingId && r.session_id === session.id);
				for (const rec of sessionRecordings) {
					if (rec.status !== "UPLOADED") continue;
					const isTrack = (rec.output_file_name || "").includes(".webm") || typeof rec.download_url !== "string";
					if (isTrack) {
						let trackLayers: { layer_name?: string; download_urls?: Record<string, { download_url?: string }> }[] = [];
						const du = rec.download_url as Record<string, unknown>;
						if (Array.isArray(du)) trackLayers = du;
						else if (du && typeof du === "object" && Array.isArray(du.links)) trackLayers = du.links as typeof trackLayers;
						else if (du && typeof du === "object") trackLayers = [du] as unknown as typeof trackLayers;
						for (const layer of trackLayers) {
							for (const [filename, info] of Object.entries(layer.download_urls || {})) {
								const parts = filename.replace(/\.webm$/, "").split("_");
								trackFiles.push({ filename, downloadUrl: info.download_url || "", userId: parts[1] || "unknown", peerId: parts[2] || "unknown" });
							}
						}
					} else {
						if (typeof rec.download_url === "string") recordingUrl = rec.download_url;
						if (rec.audio_download_url) audioRecordingUrl = rec.audio_download_url;
					}
				}
			} catch (e) {
				console.log("[summary.ts] Cache hit but recording parse error:", e);
			}
		}

		const meta = await getMeetingMeta(env.MEETING_CACHE, meetingId);
		const participants = await getParticipants(env.MEETING_CACHE, meetingId);

		return jsonResponse(200, {
			status: "ok",
			summary: cached.summary,
			transcriptUrl: cachedTranscriptUrl,
			recordingUrl,
			audioRecordingUrl,
			trackFiles: trackFiles.length > 0 ? trackFiles : undefined,
			sessionId: session.id,
			transcript_text: cached.transcript,
			cachedAt: cached.cachedAt,
			meetingMeta: meta || undefined,
			participants: participants.length > 0 ? participants : undefined,
		});
	}
	// 1.75. Transcript-only cache hit — return cached transcript so frontend can skip re-transcribing
	if (cached && cached.transcript && !cached.summary) {
		console.log("[summary.ts] KV cache hit — transcript only (no summary), returning needs_transcription with cached transcript");
		const recRes = await fetch(
			`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/recordings?meeting_id=${meetingId}`,
			{ headers: authHeaders }
		).catch(() => null);
		let recordingUrl: string | undefined;
		let audioRecordingUrl: string | undefined;
		let trackFiles: { filename: string; downloadUrl: string; userId: string; peerId: string }[] = [];
		if (recRes && recRes.ok) {
			try {
				const recJson = await recRes.json() as { success: boolean; data?: { meeting_id: string; session_id?: string; download_url: unknown; audio_download_url?: string; status: string; output_file_name?: string }[] };
				const sessionRecordings = (recJson.data || []).filter((r) => r.meeting_id === meetingId && r.session_id === session.id);
				for (const rec of sessionRecordings) {
					if (rec.status !== "UPLOADED") continue;
					const isTrack = (rec.output_file_name || "").includes(".webm") || typeof rec.download_url !== "string";
					if (isTrack) {
						let trackLayers: { layer_name?: string; download_urls?: Record<string, { download_url?: string }> }[] = [];
						const du = rec.download_url as Record<string, unknown>;
						if (Array.isArray(du)) trackLayers = du;
						else if (du && typeof du === "object" && Array.isArray(du.links)) trackLayers = du.links as typeof trackLayers;
						else if (du && typeof du === "object") trackLayers = [du] as unknown as typeof trackLayers;
						for (const layer of trackLayers) {
							for (const [filename, info] of Object.entries(layer.download_urls || {})) {
								const parts = filename.replace(/\.webm$/, "").split("_");
								trackFiles.push({ filename, downloadUrl: info.download_url || "", userId: parts[1] || "unknown", peerId: parts[2] || "unknown" });
							}
						}
					} else {
						if (typeof rec.download_url === "string") recordingUrl = rec.download_url;
						if (rec.audio_download_url) audioRecordingUrl = rec.audio_download_url;
					}
				}
			} catch (e) {
				console.log("[summary.ts] Transcript-only cache — recording parse error:", e);
			}
		}
		return jsonResponse(200, {
			status: "needs_transcription",
			transcriptUrl: undefined,
			recordingUrl,
			audioRecordingUrl,
			trackFiles: trackFiles.length > 0 ? trackFiles : undefined,
			sessionId: session.id,
			transcript_text: cached.transcript,
		});
	}

	console.log("[summary.ts] No KV cache — proceeding with full flow");

	// 2. Fetch transcript URL (fast — just the URL, don't download yet)
	let transcriptUrl: string | undefined;
	try {
		const transcriptRes = await fetch(
			`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions/${session.id}/transcript`,
			{ headers: authHeaders }
		);
		if (transcriptRes.ok) {
			const tj = await transcriptRes.json() as { success: boolean; data?: { transcript_download_url?: string; downloadUrl?: string } };
			transcriptUrl = tj.data?.transcript_download_url || tj.data?.downloadUrl;
		}
	} catch (e) {
		console.log("[summary.ts] Transcript fetch error:", e);
	}

	// 3. Fetch recordings (fast — just metadata + URLs)
	let recordingUrl: string | undefined;
	let audioRecordingUrl: string | undefined;
	let trackFiles: { filename: string; downloadUrl: string; userId: string; peerId: string }[] = [];

	try {
		const recRes = await fetch(
			`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/recordings?meeting_id=${meetingId}`,
			{ headers: authHeaders }
		);
		if (recRes.ok) {
			const recJson = await recRes.json() as {
				success: boolean;
				data?: { meeting_id: string; session_id?: string; download_url: unknown; audio_download_url?: string; status: string; type?: string; output_file_name?: string; invoked_time?: string }[];
			};
			const sessionRecordings = (recJson.data || []).filter((r) => r.meeting_id === meetingId && r.session_id === session.id);
			sessionRecordings.sort((a, b) => (a.invoked_time || "").localeCompare(b.invoked_time || ""));

			for (const rec of sessionRecordings) {
				const isTrack = (rec.output_file_name || "").includes(".webm") || typeof rec.download_url !== "string";
				if (isTrack) {
					if (rec.status !== "UPLOADED") continue;
					let trackLayers: { layer_name?: string; download_urls?: Record<string, { download_url?: string }> }[] = [];
					const du = rec.download_url as Record<string, unknown>;
					if (Array.isArray(du)) trackLayers = du;
					else if (du && typeof du === "object" && Array.isArray(du.links)) trackLayers = du.links as typeof trackLayers;
					else if (du && typeof du === "object") trackLayers = [du] as unknown as typeof trackLayers;

					for (const layer of trackLayers) {
						for (const [filename, info] of Object.entries(layer.download_urls || {})) {
							const parts = filename.replace(/\.webm$/, "").split("_");
							trackFiles.push({ filename, downloadUrl: info.download_url || "", userId: parts[1] || "unknown", peerId: parts[2] || "unknown" });
						}
					}
				} else {
					if (rec.status !== "UPLOADED") continue;
					if (typeof rec.download_url === "string") recordingUrl = rec.download_url;
					if (rec.audio_download_url) audioRecordingUrl = rec.audio_download_url;
				}
			}
		}
	} catch (e) {
		console.log("[summary.ts] Recording fetch error:", e);
	}

	// 4. Download CF transcript (small file, fast)
	let transcriptText = "";
	if (transcriptUrl) {
		try {
			const tfRes = await fetch(transcriptUrl);
			if (tfRes.ok) {
				transcriptText = await tfRes.text();
			}
		} catch (e) {
			console.log("[summary.ts] Transcript download error:", e);
		}
	}
	console.log("[summary.ts] CF transcript length:", transcriptText.length, "| recordings:", recordingUrl ? "yes" : "no", audioRecordingUrl ? "yes" : "no", "| tracks:", trackFiles.length);

	// 5. If CF transcript is non-empty, generate summary directly (no Whisper needed)
	const transcriptLines = transcriptText.trim().split("\n").filter((l) => l.trim());

	if (transcriptLines.length > 0) {
		// CF transcript exists — generate summary with OpenRouter/Ollama
		const summary = await generateSummary(transcriptText, env);
		await saveCachedResult(env.MEETING_CACHE, meetingId, { transcript: transcriptText, summary: summary || "", cachedAt: new Date().toISOString() });
		console.log("[summary.ts] Summary from CF transcript:", summary?.length || 0, "chars");
		return jsonResponse(200, {
			status: summary ? "ok" : "no_summary",
			summary,
			transcriptUrl,
			recordingUrl,
			audioRecordingUrl,
			trackFiles: trackFiles.length > 0 ? trackFiles : undefined,
			sessionId: session.id,
			transcript_text: transcriptText,
			sessionInfo: {
				total_participants: session.total_participants,
				recording_minutes: session.recording_minutes_consumed,
				transcription_minutes: session.transcription_minutes_consumed,
				ended_at: session.ended_at,
			},
		});
	}

	// 6. CF transcript is empty — return recordings so frontend can trigger /api/transcribe
	// Check if we already have a cached summary (from a previous transcribe call)
	// For now, just return the recording URLs and let the frontend call /api/transcribe
	return jsonResponse(200, {
		status: "needs_transcription",
		transcriptUrl,
		recordingUrl,
		audioRecordingUrl,
		trackFiles: trackFiles.length > 0 ? trackFiles : undefined,
		sessionId: session.id,
		transcript_text: transcriptText,
		sessionInfo: {
			total_participants: session.total_participants,
			recording_minutes: session.recording_minutes_consumed,
			transcription_minutes: session.transcription_minutes_consumed,
			ended_at: session.ended_at,
		},
	});
};

async function generateSummary(transcriptText: string, env: Env): Promise<string | undefined> {
	// OpenRouter
	const openrouterModels = [
		env.OPENROUTER_MODEL || "openrouter/free",
		env.OPENROUTER_FREE_MODEL || "openrouter/free",
	].filter((m, i, arr) => arr.indexOf(m) === i);

	for (const model of openrouterModels) {
		if (!env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY === "placeholder") continue;
		console.log("[summary.ts] Calling OpenRouter:", model);
		try {
			const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
				},
				body: JSON.stringify({
					model,
					messages: [
						{ role: "system", content: SUMMARY_SYSTEM_PROMPT },
						{ role: "user", content: `Here is the meeting transcript:\n\n${transcriptText}` },
					],
				}),
			});
			if (orRes.ok) {
				const oj = await orRes.json() as { choices?: { message?: { content?: string } }[] };
				const s = oj.choices?.[0]?.message?.content;
				if (s) return s;
			}
		} catch (e) {
			console.log("[summary.ts] OpenRouter error:", e);
		}
	}

	// Ollama fallback
	if (env.OLLAMA_BASE_URL && env.OLLAMA_API_KEY && env.OLLAMA_API_KEY !== "placeholder") {
		const ollamaModel = env.OLLAMA_MODEL || "gpt-oss:120b";
		console.log("[summary.ts] Falling back to Ollama:", ollamaModel);
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
			if (ollamaRes.ok) {
				const oj = await ollamaRes.json() as { message?: { content?: string } };
				return oj.message?.content;
			}
		} catch (e) {
			console.log("[summary.ts] Ollama error:", e);
		}
	}

	return undefined;
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}