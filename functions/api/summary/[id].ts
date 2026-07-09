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

	// 1. Find sessions for this meeting — pick the LATEST ended one
	const sessionsRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions?meeting_id=${meetingId}`,
		{ headers: authHeaders }
	);

	if (!sessionsRes.ok) {
		const errText = await sessionsRes.text();
		console.log("[summary.ts] Sessions fetch failed:", errText);
		return jsonResponse(sessionsRes.status, { status: "error", error: "Failed to fetch sessions" });
	}

	const sessionsJson = await sessionsRes.json() as {
		success: boolean;
		data?: { sessions?: { id: string; associated_id: string; status: string; ended_at?: string; recording_status?: string }[] };
	};
	const allSessions = sessionsJson.data?.sessions || [];
	const endedSessions = allSessions.filter((s) => s.associated_id === meetingId && s.status === "ENDED");

	// Sort by ended_at descending — pick the LATEST ended session
	endedSessions.sort((a, b) => (b.ended_at || "").localeCompare(a.ended_at || ""));
	const session = endedSessions[0];

	console.log("[summary.ts] Total sessions:", allSessions.length, "Ended sessions:", endedSessions.length, "Latest session:", session?.id, "ended_at:", session?.ended_at);

	if (!session) {
		return jsonResponse(200, { status: "no_ended_session" });
	}

	// 2. Fetch transcript URL
	const transcriptRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions/${session.id}/transcript`,
		{ headers: authHeaders }
	);

	if (!transcriptRes.ok) {
		if (transcriptRes.status >= 400 && transcriptRes.status < 500) {
			return jsonResponse(200, { status: "no_summary", error: `Transcription not available (HTTP ${transcriptRes.status}).` });
		}
		return jsonResponse(200, { status: "processing" });
	}

	const transcriptJson = await transcriptRes.json() as {
		success: boolean;
		data?: { transcript_download_url?: string; downloadUrl?: string };
	};
	const transcriptUrl = transcriptJson.data?.transcript_download_url || transcriptJson.data?.downloadUrl;
	console.log("[summary.ts] Transcript URL:", transcriptUrl ? "found" : "none");

	if (!transcriptUrl) {
		return jsonResponse(200, { status: "processing" });
	}

	// 3. Download the transcript file
	const transcriptFileRes = await fetch(transcriptUrl);
	if (!transcriptFileRes.ok) {
		return jsonResponse(200, { status: "processing" });
	}
	let transcriptText = await transcriptFileRes.text();
	console.log("[summary.ts] CF transcript length:", transcriptText.length, "chars");

	// 4. Fetch recordings for this meeting — filter to THIS session only
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

			// Filter to recordings for the CURRENT session only
			const sessionRecordings = (recJson.data || []).filter((r) => r.meeting_id === meetingId && r.session_id === session.id);
			console.log("[summary.ts] Recordings for current session:", sessionRecordings.length, "of", (recJson.data || []).length, "total");

			// Sort by invoked_time so composite (usually first) is processed before track
			sessionRecordings.sort((a, b) => (a.invoked_time || "").localeCompare(b.invoked_time || ""));

			for (const rec of sessionRecordings) {
				const isTrack = (rec.output_file_name || "").includes(".webm") || typeof rec.download_url !== "string";

				if (isTrack) {
					console.log("[summary.ts] Found TRACK recording, status:", rec.status);
					if (rec.status !== "UPLOADED") continue;

					let trackLayers: { layer_name?: string; download_urls?: Record<string, { download_url?: string }> }[] = [];
					const du = rec.download_url as Record<string, unknown>;
					if (Array.isArray(du)) {
						trackLayers = du;
					} else if (du && typeof du === "object" && Array.isArray(du.links)) {
						trackLayers = du.links as typeof trackLayers;
					} else if (du && typeof du === "object") {
						trackLayers = [du] as unknown as typeof trackLayers;
					}

					for (const layer of trackLayers) {
						const urls = layer.download_urls || {};
						for (const [filename, info] of Object.entries(urls)) {
							const parts = filename.replace(/\.webm$/, "").split("_");
							const userId = parts[1] || "unknown";
							const peerId = parts[2] || "unknown";
							trackFiles.push({ filename, downloadUrl: info.download_url || "", userId, peerId });
						}
					}
				} else {
					// Composite recording
					console.log("[summary.ts] Found COMPOSITE recording, status:", rec.status);
					if (rec.status !== "UPLOADED") continue;
					if (typeof rec.download_url === "string") {
						recordingUrl = rec.download_url;
					}
					if (rec.audio_download_url) {
						audioRecordingUrl = rec.audio_download_url;
					}
				}
			}
			console.log("[summary.ts] Composite URL:", recordingUrl ? "found" : "none", "| Audio URL:", audioRecordingUrl ? "found" : "none", "| Track files:", trackFiles.length);
		}
	} catch (e) {
		console.log("[summary.ts] Recording fetch error:", e instanceof Error ? e.message : String(e));
	}

	// 5. If CF transcript is empty, try Whisper fallback
	const trimmedTranscript = transcriptText.trim();
	const transcriptLines = trimmedTranscript.split("\n").filter((l) => l.trim());

	if (transcriptLines.length === 0) {
		console.log("[summary.ts] CF transcript is empty — trying Whisper fallback");

		// Try track files first (per-participant, no diarization needed)
		if (trackFiles.length > 0) {
			console.log("[summary.ts] Trying Whisper on", trackFiles.length, "track files");
			const participantTranscripts: string[] = [];

			for (const track of trackFiles) {
				try {
					const audioRes = await fetch(track.downloadUrl);
					if (!audioRes.ok) continue;

					const contentLength = audioRes.headers.get("content-length");
					const sizeMb = contentLength ? (parseInt(contentLength) / (1024 * 1024)) : 0;
					console.log("[summary.ts] Track", track.userId, "size:", sizeMb.toFixed(1), "MB");

					if (sizeMb > 25) {
						participantTranscripts.push(`[Participant ${track.userId}]: Audio file too large (${sizeMb.toFixed(1)} MB) for automatic transcription.`);
						continue;
					}

					const audioBuffer = await audioRes.arrayBuffer();

					const whisperRes = await fetch(
						`${RTK_BASE}/${env.CF_ACCOUNT_ID}/ai/run/@cf/openai/whisper`,
						{
							method: "POST",
							headers: {
								Authorization: `Bearer ${env.CF_API_TOKEN}`,
								"Content-Type": "audio/webm",
							},
							body: audioBuffer,
						}
					);

					if (whisperRes.ok) {
						const whisperJson = await whisperRes.json() as { result?: { text?: string } };
						const whisperText = whisperJson.result?.text?.trim();
						console.log("[summary.ts] Whisper track", track.userId, "transcript length:", whisperText?.length || 0);

						if (whisperText && whisperText.length > 50) {
							// Check for hallucination (repeated short phrase)
							const firstPhrase = whisperText.split(".")[0];
							const phraseCount = (whisperText.match(new RegExp(firstPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.?", "g")) || []).length;
							if (!(phraseCount > 3 && whisperText.length < 200)) {
								participantTranscripts.push(`[Participant ${track.userId}]: ${whisperText}`);
							}
						}
					} else {
						console.log("[summary.ts] Whisper failed for track", track.userId, ":", whisperRes.status);
					}
				} catch (e) {
					console.log("[summary.ts] Track Whisper error:", e instanceof Error ? e.message : String(e));
				}
			}

			if (participantTranscripts.length > 0) {
				transcriptText = participantTranscripts.join("\n\n");
				console.log("[summary.ts] Merged transcript from tracks, length:", transcriptText.length);
			}
		}

		// If still empty, try composite audio
		if (transcriptText.trim().length === 0 && audioRecordingUrl) {
			console.log("[summary.ts] Trying Whisper on composite MP3");
			try {
				const audioRes = await fetch(audioRecordingUrl);
				if (audioRes.ok) {
					const contentLength = audioRes.headers.get("content-length");
					const sizeMb = contentLength ? (parseInt(contentLength) / (1024 * 1024)) : 0;
					console.log("[summary.ts] Composite audio size:", sizeMb.toFixed(1), "MB");

					if (sizeMb > 25) {
						console.log("[summary.ts] Composite too large for Workers AI — returning download link");
						return jsonResponse(200, {
							status: "ok",
							summary: `## Meeting Summary\n\nThe meeting recording is available, but it's too long (${sizeMb.toFixed(1)} MB) for automatic transcription via Workers AI Whisper (max 25 MB).\n\nDownload the audio recording below and transcribe it manually.`,
							transcriptUrl,
							recordingUrl,
							audioRecordingUrl,
							trackFiles: trackFiles.length > 0 ? trackFiles : undefined,
							sessionId: session.id,
						});
					}

					const audioBuffer = await audioRes.arrayBuffer();
					const audioBytes = new Uint8Array(audioBuffer);
					let binary = "";
					for (let i = 0; i < audioBytes.length; i++) {
						binary += String.fromCharCode(audioBytes[i]);
					}
					const audioBase64 = btoa(binary);

					const whisperRes = await fetch(
						`${RTK_BASE}/${env.CF_ACCOUNT_ID}/ai/run/@cf/openai/whisper-large-v3-turbo`,
						{
							method: "POST",
							headers: {
								Authorization: `Bearer ${env.CF_API_TOKEN}`,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({ audio: audioBase64, language: "en" }),
						}
					);

					if (whisperRes.ok) {
						const whisperJson = await whisperRes.json() as { result?: { text?: string } };
						const whisperText = whisperJson.result?.text;
						console.log("[summary.ts] Whisper composite transcript length:", whisperText?.length || 0);

						if (whisperText && whisperText.trim()) {
							const trimmed = whisperText.trim();
							const firstPhrase = trimmed.split(".")[0];
							const phraseCount = (trimmed.match(new RegExp(firstPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\.?", "g")) || []).length;
							if (!(phraseCount > 3 && trimmed.length < 200)) {
								transcriptText = trimmed;
								console.log("[summary.ts] Composite Whisper transcript preview:", transcriptText.slice(0, 200));
							}
						}
					} else {
						const whisperErr = await whisperRes.text();
						console.log("[summary.ts] Whisper failed:", whisperRes.status, whisperErr.slice(0, 200));
						return jsonResponse(200, {
							status: "ok",
							summary: `## Meeting Summary\n\nAutomatic transcription via Workers AI Whisper failed (HTTP ${whisperRes.status}).\n\nDownload the audio recording below and transcribe it manually.`,
							transcriptUrl,
							recordingUrl,
							audioRecordingUrl,
							trackFiles: trackFiles.length > 0 ? trackFiles : undefined,
							sessionId: session.id,
						});
					}
				}
			} catch (e) {
				console.log("[summary.ts] Composite Whisper error:", e instanceof Error ? e.message : String(e));
			}
		}

		// If still no transcript from any source
		if (transcriptText.trim().length === 0) {
			console.log("[summary.ts] No transcript from any source");
			return jsonResponse(200, {
				status: "ok",
				summary: "## Meeting Summary\n\nNo speech was detected in this meeting. The CF transcript is empty and no audio could be transcribed.\n\n## Key Topics Discussed\n\n- No topics were discussed (no speech detected)\n\n## Decisions Made\n\n- No decisions were made\n\n## Action Items\n\n- [ ] **N/A** — No action items\n\n## Open Questions\n\n- No open questions\n\n## Participants\n\n- No participants spoke during this meeting\n\n## Sentiment & Engagement\n\nNo assessment available.",
				transcriptUrl,
				recordingUrl,
				audioRecordingUrl,
				trackFiles: trackFiles.length > 0 ? trackFiles : undefined,
				sessionId: session.id,
			});
		}
	}

	// 6. Call OpenRouter (primary), then Ollama (fallback), then CF built-in
	let summary: string | undefined;

	const openrouterModels = [
		env.OPENROUTER_MODEL || "openrouter/free",
		env.OPENROUTER_FREE_MODEL || "openrouter/free",
	].filter((m, i, arr) => arr.indexOf(m) === i);

	for (const model of openrouterModels) {
		if (!env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY === "placeholder") continue;
		if (summary) break;
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
				const orJson = await orRes.json() as { choices?: { message?: { content?: string } }[] };
				summary = orJson.choices?.[0]?.message?.content;
				if (summary) {
					console.log("[summary.ts] OpenRouter summary length:", summary.length);
					break;
				}
			} else {
				console.log("[summary.ts] OpenRouter failed:", orRes.status);
			}
		} catch (e) {
			console.log("[summary.ts] OpenRouter error:", e instanceof Error ? e.message : String(e));
		}
	}

	// Ollama fallback
	const ollamaModel = env.OLLAMA_MODEL || "gpt-oss:120b";
	if (!summary && env.OLLAMA_BASE_URL && env.OLLAMA_API_KEY && env.OLLAMA_API_KEY !== "placeholder") {
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
				const ollamaJson = await ollamaRes.json() as { message?: { content?: string } };
				summary = ollamaJson.message?.content;
				console.log("[summary.ts] Ollama summary length:", summary?.length || 0);
			} else {
				console.log("[summary.ts] Ollama failed:", ollamaRes.status);
			}
		} catch (e) {
			console.log("[summary.ts] Ollama error:", e instanceof Error ? e.message : String(e));
		}
	}

	// CF built-in summary fallback
	if (!summary) {
		console.log("[summary.ts] Falling back to CF built-in summary");
		const summaryRes = await fetch(
			`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions/${session.id}/summary`,
			{ headers: authHeaders }
		);
		if (summaryRes.ok) {
			const summaryJson = await summaryRes.json() as { data?: { summary?: string } };
			summary = summaryJson.data?.summary;
			console.log("[summary.ts] CF summary length:", summary?.length || 0);
		}
	}

	console.log("[summary.ts] Done — status:", summary ? "ok" : "no_summary");

	return jsonResponse(200, {
		status: summary ? "ok" : "no_summary",
		summary,
		transcriptUrl,
		recordingUrl,
		audioRecordingUrl,
		trackFiles: trackFiles.length > 0 ? trackFiles : undefined,
		sessionId: session.id,
		transcript_text: transcriptText,
	});
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}