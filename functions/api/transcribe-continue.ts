import { transcribeCompositeAudio, generateMeetingSummary, maybeSendAutoEmail, resolvePrompt } from "../lib/transcribe-core";
import { getCachedResult } from "../lib/kv";
import { jsonResponse } from "../lib/response";
import type { AppEnv } from "../lib/env";

type Env = AppEnv;

/**
 * Self-continuing transcription endpoint.
 * Called by the webhook (and itself) to keep transcription going for long meetings.
 * Each call gets a fresh 30s request budget, processes one batch of chunks,
 * then fires the next fetch() to itself if more chunks remain.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
	const body = await request.json() as { meetingId: string; audioUrl: string; sessionId?: string; owner: string };
	const { meetingId, audioUrl, sessionId, owner } = body;

	if (!meetingId || !audioUrl) {
		return jsonResponse(400, { error: "meetingId and audioUrl required" });
	}

	const origin = new URL(request.url).origin;

	// Skip if already done
	const cached = await getCachedResult(env.MEETING_CACHE, meetingId, sessionId);
	if (cached?.summary) {
		console.log("[transcribe-continue] Already have summary — done");
		return jsonResponse(200, { ok: true, done: true });
	}

	console.log("[transcribe-continue] Continuing transcription for", meetingId, "owner:", owner);

	const tr = await transcribeCompositeAudio(env, meetingId, audioUrl, sessionId, owner);
	console.log("[transcribe-continue] Transcription result:", tr.status);

	if (tr.status === "processing") {
		// More chunks to go — fire next fetch in chain
		waitUntil(selfContinue(env, meetingId, audioUrl, origin, sessionId, owner));
		return jsonResponse(200, { ok: true, processing: true, message: tr.message });
	}

	if (tr.status === "transcribed") {
		// Transcription done — generate summary + send email
		const transcript = tr.transcript;
		const customPrompt = await resolvePrompt(env, meetingId);
		const summaryResult = await generateMeetingSummary(env, meetingId, transcript, customPrompt, sessionId);

		if (summaryResult.status === "ok") {
			await maybeSendAutoEmail(env, meetingId, summaryResult.summary, origin, sessionId);
			console.log("[transcribe-continue] Pipeline complete for", meetingId);
			return jsonResponse(200, { ok: true, done: true });
		}
		console.log("[transcribe-continue] Summary failed:", summaryResult.message);
		return jsonResponse(200, { ok: false, error: summaryResult.message });
	}

	console.log("[transcribe-continue] Transcription stopped:", tr.status);
	return jsonResponse(200, { ok: true, done: true, status: tr.status });
};

async function selfContinue(env: Env, meetingId: string, audioUrl: string, origin: string, sessionId: string | undefined, owner: string): Promise<void> {
	try {
		// Small delay to avoid hammering the API
		await new Promise((r) => setTimeout(r, 2000));

		const url = new URL("/api/transcribe-continue", origin);
		const res = await fetch(url.toString(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ meetingId, audioUrl, sessionId, owner }),
		});
		console.log("[transcribe-continue] self-continue fetch status:", res.status);
	} catch (e) {
		console.log("[transcribe-continue] self-continue error:", e instanceof Error ? e.message : String(e));
	}
}