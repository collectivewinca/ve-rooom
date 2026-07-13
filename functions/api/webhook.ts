import { getCachedResult, getMeetingMeta, getParticipants, saveCachedResult, addSummaryVersion, getMeetingPrompt, getUserPrompt } from "../lib/kv";
import { jsonResponse } from "../lib/response";
import { generateSummary } from "../lib/summarizer";
import { sendSummaryEmails } from "../lib/summary-email";
import type { AppEnv } from "../lib/env";

type Env = AppEnv;

interface RTKWebhookEvent {
	event: string;
	meeting?: {
		id: string;
		sessionId?: string;
		title?: string;
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

	// Handle transcript ready → generate summary + send emails
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

async function processTranscriptAndEmail(env: Env, meetingId: string, transcriptUrl: string, requestUrl: string): Promise<void> {
	try {
		// Skip if already cached
		const cached = await getCachedResult(env.MEETING_CACHE, meetingId);
		if (cached?.summary) {
			console.log("[webhook] Already have cached summary for", meetingId);
			return;
		}

		// Download transcript
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

		// Resolve prompt hierarchy
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

		// Generate summary
		const summary = await generateSummary(transcriptText, env, customPrompt);
		if (!summary) {
			console.log("[webhook] Summary generation failed for", meetingId);
			return;
		}

		// Save to cache + history
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

		// Send emails
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
		// Skip if already cached (our own summary takes priority)
		const cached = await getCachedResult(env.MEETING_CACHE, meetingId);
		if (cached?.summary) {
			console.log("[webhook] Already have cached summary for", meetingId, "— skipping RTK summary");
			return;
		}

		// Download RTK summary
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

		// Save to cache + history
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

		// Send emails
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