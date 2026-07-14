import { getCachedResult, getMeetingMeta, getParticipants, saveCachedResult, addSummaryVersion, getMeetingPrompt, getUserPrompt } from "../lib/kv";
import { jsonResponse } from "../lib/response";
import { generateSummary } from "../lib/summarizer";
import { sendSummaryEmails } from "../lib/summary-email";
import { transcribeCompositeAudio, generateMeetingSummary, maybeSendAutoEmail, resolvePrompt } from "../lib/transcribe-core";
import type { AppEnv } from "../lib/env";

type Env = AppEnv;

interface RTKWebhookEvent {
	event: string;
	meeting?: {
		id: string;
		sessionId?: string;
		title?: string;
	};
	recording?: {
		status?: string;
		downloadUrl?: string;
		audioDownloadUrl?: string;
		meetingId?: string;
	};
	transcriptDownloadUrl?: string;
	summaryDownloadUrl?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
	const signature = request.headers.get("rtk-signature");
	if (!signature) {
		return jsonResponse(401, { error: "Missing signature" });
	}

	const body = await request.text();

	let event: RTKWebhookEvent;
	try {
		event = JSON.parse(body) as RTKWebhookEvent;
	} catch {
		return jsonResponse(400, { error: "Invalid JSON" });
	}

	console.log("[webhook] Received event:", event.event, "for meeting:", event.meeting?.id);

	// Handle recording uploaded → run full transcription + summary + email pipeline
	if (event.event === "recording.statusUpdate" && event.recording?.status === "UPLOADED") {
		const meetingId = event.recording?.meetingId || event.meeting?.id;
		const audioUrl = event.recording?.audioDownloadUrl || event.recording?.downloadUrl;
		if (meetingId && audioUrl) {
			waitUntil(runTranscriptionPipeline(env, meetingId, audioUrl, request.url));
			return jsonResponse(200, { ok: true, processing: true, event: event.event });
		}
	}

	// Handle meeting ended → fetch recording audio URL then run pipeline
	if (event.event === "meeting.ended" && event.meeting?.id) {
		const meetingId = event.meeting.id;
		waitUntil(findAudioAndProcess(env, meetingId, request.url));
		return jsonResponse(200, { ok: true, processing: true, event: event.event });
	}

	// Handle transcript ready → generate summary + send emails (RTK native transcript)
	if (event.event === "meeting.transcript" && event.meeting?.id && event.transcriptDownloadUrl) {
		const meetingId = event.meeting.id;
		waitUntil(processTranscriptAndEmail(env, meetingId, event.transcriptDownloadUrl, request.url));
		return jsonResponse(200, { ok: true, processing: true });
	}

	// Handle summary ready → download + send emails (RTK's own summary)
	if (event.event === "meeting.summary" && event.meeting?.id && event.summaryDownloadUrl) {
		const meetingId = event.meeting.id;
		waitUntil(processRtkSummaryAndEmail(env, meetingId, event.summaryDownloadUrl, request.url));
		return jsonResponse(200, { ok: true, processing: true });
	}

	return jsonResponse(200, { ok: true, event: event.event });
};

/**
 * Full pipeline: Whisper transcription → LLM summary → auto-email.
 * Triggered when the composite recording is uploaded (recording.statusUpdate UPLOADED).
 * Uses KV partial resume for long meetings — if time budget runs out, the summary
 * page poll will pick up where this left off.
 */
async function runTranscriptionPipeline(env: Env, meetingId: string, audioUrl: string, requestUrl: string): Promise<void> {
	try {
		// Skip if already fully processed
		const cached = await getCachedResult(env.MEETING_CACHE, meetingId);
		if (cached?.summary) {
			console.log("[webhook] Already have summary for", meetingId, "— skipping");
			return;
		}

		console.log("[webhook] Starting transcription pipeline for", meetingId);

		// Step 1: Whisper transcription (chunked, KV partial resume)
		const tr = await transcribeCompositeAudio(env, meetingId, audioUrl);
		console.log("[webhook] Transcription result:", tr.status);

		if (tr.status === "processing") {
			// Ran out of time budget — the summary page poll will resume this.
			// Kick off a self-retry to continue processing.
			console.log("[webhook] Transcription partial — retrying in 4s");
			await sleep(4000);
			await runTranscriptionPipeline(env, meetingId, audioUrl, requestUrl);
			return;
		}

		if (tr.status === "silent" || tr.status === "too_large" || tr.status === "error") {
			console.log("[webhook] Transcription stopped:", tr.status, ("message" in tr ? tr.message : undefined) || ("error" in tr ? tr.error : ""));
			return;
		}

		if (tr.status !== "transcribed") {
			console.log("[webhook] Unexpected transcription status:", (tr as { status: string }).status);
			return;
		}

		// Step 2: Generate summary
		const transcript = tr.transcript;
		const customPrompt = await resolvePrompt(env, meetingId);
		const summaryResult = await generateMeetingSummary(env, meetingId, transcript, customPrompt);
		console.log("[webhook] Summary result:", summaryResult.status);

		if (summaryResult.status !== "ok") {
			console.log("[webhook] Summary failed:", summaryResult.message);
			return;
		}

		// Step 3: Auto-email
		const appUrl = new URL(requestUrl).origin;
		await maybeSendAutoEmail(env, meetingId, summaryResult.summary, appUrl);
		console.log("[webhook] Pipeline complete for", meetingId);
	} catch (e) {
		console.log("[webhook] Pipeline error:", e instanceof Error ? e.message : String(e));
	}
}

/**
 * Fallback: meeting.ended fires but recording.statusUpdate didn't.
 * Fetch the recording audio URL from the RTK API and run the pipeline.
 */
async function findAudioAndProcess(env: Env, meetingId: string, requestUrl: string): Promise<void> {
	try {
		// Skip if already processed
		const cached = await getCachedResult(env.MEETING_CACHE, meetingId);
		if (cached?.summary) {
			console.log("[webhook] meeting.ended — already have summary for", meetingId);
			return;
		}

		if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.RTK_APP_ID) {
			console.log("[webhook] meeting.ended — missing config");
			return;
		}

		const authHeaders = {
			Authorization: `Bearer ${env.CF_API_TOKEN}`,
			"Content-Type": "application/json",
		};

		// Wait a few seconds for recording to finish uploading
		await sleep(5000);

		// Fetch recordings for this meeting
		const recRes = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/recordings?meeting_id=${meetingId}`,
			{ headers: authHeaders },
		);
		if (!recRes.ok) {
			console.log("[webhook] meeting.ended — failed to fetch recordings:", recRes.status);
			return;
		}

		const recJson = await recRes.json() as { success: boolean; data?: { audio_download_url?: string; download_url?: string; status?: string; output_file_name?: string }[] };
		const recordings = recJson.data || [];

		// Find the composite recording with an audio URL
		const composite = recordings.find((r) => r.audio_download_url && r.status === "UPLOADED" && !r.output_file_name?.endsWith(".webm"));
		const audioUrl = composite?.audio_download_url;

		if (!audioUrl) {
			console.log("[webhook] meeting.ended — no uploaded composite audio found for", meetingId);
			return;
		}

		console.log("[webhook] meeting.ended — found audio, running pipeline");
		await runTranscriptionPipeline(env, meetingId, audioUrl, requestUrl);
	} catch (e) {
		console.log("[webhook] findAudioAndProcess error:", e instanceof Error ? e.message : String(e));
	}
}

async function processTranscriptAndEmail(env: Env, meetingId: string, transcriptUrl: string, requestUrl: string): Promise<void> {
	try {
		const cached = await getCachedResult(env.MEETING_CACHE, meetingId);
		if (cached?.summary) {
			console.log("[webhook] Already have cached summary for", meetingId);
			return;
		}

		const tfRes = await fetch(transcriptUrl);
		if (!tfRes.ok) {
			console.log("[webhook] Failed to download transcript:", tfRes.status);
			return;
		}
		const transcriptText = await tfRes.text();
		if (!transcriptText.trim()) {
			console.log("[webhook] Empty transcript for", meetingId);
			return;
		}

		let customPrompt: string | undefined;
		const mp = await getMeetingPrompt(env.MEETING_CACHE, meetingId);
		if (mp) {
			customPrompt = mp;
		} else {
			const meta = await getMeetingMeta(env.MEETING_CACHE, meetingId);
			if (meta?.createdBy?.email) {
				customPrompt = await getUserPrompt(env.MEETING_CACHE, meta.createdBy.email) || undefined;
			}
		}

		const summary = await generateSummary(transcriptText, env, customPrompt);
		if (!summary) {
			console.log("[webhook] Summary generation failed for", meetingId);
			return;
		}

		await saveCachedResult(env.MEETING_CACHE, meetingId, {
			transcript: transcriptText,
			summary,
			cachedAt: new Date().toISOString(),
		});
		await addSummaryVersion(env.MEETING_CACHE, meetingId, {
			summary,
			prompt: customPrompt,
			createdAt: new Date().toISOString(),
		});

		console.log("[webhook] Summary generated for", meetingId);

		if (env.SMTP_API_URL) {
			const [meta, participants] = await Promise.all([
				getMeetingMeta(env.MEETING_CACHE, meetingId),
				getParticipants(env.MEETING_CACHE, meetingId),
			]);
			if (meta && participants.length > 0) {
				const appUrl = new URL(requestUrl).origin;
				await sendSummaryEmails(env.SMTP_API_URL, {
					participants,
					meetingTitle: meta.title || "Untitled Meeting",
					creatorName: meta.createdBy?.name || "Someone",
					summary,
					meetingId,
					appUrl,
				});
				console.log("[webhook] Emails sent for", meetingId);
			}
		}
	} catch (e) {
		console.log("[webhook] processTranscript error:", e);
	}
}

async function processRtkSummaryAndEmail(env: Env, meetingId: string, summaryUrl: string, requestUrl: string): Promise<void> {
	try {
		const cached = await getCachedResult(env.MEETING_CACHE, meetingId);
		if (cached?.summary) {
			console.log("[webhook] Already have cached summary for", meetingId, "— skipping RTK summary");
			return;
		}

		const sumRes = await fetch(summaryUrl);
		if (!sumRes.ok) {
			console.log("[webhook] Failed to download RTK summary:", sumRes.status);
			return;
		}
		const summaryText = await sumRes.text();
		if (!summaryText.trim()) {
			console.log("[webhook] Empty RTK summary for", meetingId);
			return;
		}

		await saveCachedResult(env.MEETING_CACHE, meetingId, {
			transcript: "",
			summary: summaryText,
			cachedAt: new Date().toISOString(),
		});
		await addSummaryVersion(env.MEETING_CACHE, meetingId, {
			summary: summaryText,
			prompt: undefined,
			createdAt: new Date().toISOString(),
		});

		console.log("[webhook] RTK summary saved for", meetingId);

		if (env.SMTP_API_URL) {
			const [meta, participants] = await Promise.all([
				getMeetingMeta(env.MEETING_CACHE, meetingId),
				getParticipants(env.MEETING_CACHE, meetingId),
			]);
			if (meta && participants.length > 0) {
				const appUrl = new URL(requestUrl).origin;
				await sendSummaryEmails(env.SMTP_API_URL, {
					participants,
					meetingTitle: meta.title || "Untitled Meeting",
					creatorName: meta.createdBy?.name || "Someone",
					summary: summaryText,
					meetingId,
					appUrl,
				});
				console.log("[webhook] Emails sent for RTK summary", meetingId);
			}
		}
	} catch (e) {
		console.log("[webhook] processRtkSummary error:", e);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}