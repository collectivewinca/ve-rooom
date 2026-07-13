import { getCachedResult, getMeetingMeta, getParticipants, saveCachedResult, getRecordingRefs, getMeetingPrompt, getUserPrompt, addSummaryVersion, getSummaryHistory, type SummaryVersion } from "../../lib/kv";
import { jsonResponse } from "../../lib/response";
import { checkRateLimit } from "../../lib/rate-limit";
import { parseSessionRecordings } from "../../lib/recordings";
import { generateSummary } from "../../lib/summarizer";
import { sendSummaryEmails } from "../../lib/summary-email";
import type { AppEnv } from "../../lib/env";

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

type Env = AppEnv;

async function resolvePrompt(env: Env, meetingId: string): Promise<string | undefined> {
	let prompt = await getMeetingPrompt(env.MEETING_CACHE, meetingId);
	if (!prompt) {
		const meta = await getMeetingMeta(env.MEETING_CACHE, meetingId);
		if (meta?.createdBy?.email) {
			prompt = await getUserPrompt(env.MEETING_CACHE, meta.createdBy.email);
		}
	}
	return prompt || undefined;
}

export const onRequestGet: PagesFunction<Env> = async ({ params, request, env, waitUntil }) => {
	const rl = await checkRateLimit(env.MEETING_CACHE, request);
	if (!rl.allowed) return jsonResponse(429, { error: "Too many requests. Please slow down." });

	const meetingId = params.id as string;

	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.RTK_APP_ID) {
		return jsonResponse(500, { status: "error", error: "Server missing Cloudflare configuration" });
	}

	const authHeaders = {
		Authorization: `Bearer ${env.CF_API_TOKEN}`,
		"Content-Type": "application/json",
	};

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

	const cached = await getCachedResult(env.MEETING_CACHE, meetingId);
	const r2Refs = await getRecordingRefs(env.MEETING_CACHE, meetingId);
	let history = await getSummaryHistory(env.MEETING_CACHE, meetingId);
	const hasR2 = r2Refs.length > 0;
	const customPrompt = await resolvePrompt(env, meetingId);
	if (customPrompt) console.log("[summary.ts] Using custom prompt for", meetingId, `(${customPrompt.length} chars)`);
	if (hasR2) console.log("[summary.ts] R2 recording refs:", r2Refs.length, "for meeting", meetingId);

	// Seed history with existing cached summary if history is empty
	if (history.length === 0 && cached?.summary) {
		const seeded: SummaryVersion = { summary: cached.summary, prompt: customPrompt || undefined, createdAt: cached.cachedAt || new Date().toISOString() };
		await addSummaryVersion(env.MEETING_CACHE, meetingId, seeded);
		history = [seeded];
		console.log("[summary.ts] Seeded history from cached summary for", meetingId);
	}
	if (history.length > 0) console.log("[summary.ts] Summary history:", history.length, "versions");

	const r2RecordingUrl = r2Refs.find((r) => r.type === "composite")?.url;
	const r2AudioUrl = r2Refs.find((r) => r.type === "audio")?.url;

	async function fetchRecordings() {
		return fetch(
			`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/recordings?meeting_id=${meetingId}`,
			{ headers: authHeaders }
		).catch(() => null);
	}

	async function fetchTranscriptUrl() {
		try {
			const res = await fetch(
				`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions/${session.id}/transcript`,
				{ headers: authHeaders }
			);
			if (res.ok) {
				const tj = await res.json() as { success: boolean; data?: { transcript_download_url?: string; downloadUrl?: string } };
				return tj.data?.transcript_download_url || tj.data?.downloadUrl;
			}
		} catch (e) {
			console.log("[summary.ts] Transcript fetch error:", e);
		}
		return undefined;
	}

	// Cache hit: full summary + transcript
	if (cached && cached.summary && cached.transcript) {
		const [transcriptUrl, recRes] = await Promise.all([fetchTranscriptUrl(), fetchRecordings()]);
		const parsed = await parseSessionRecordings(recRes, meetingId, session.id);
		const meta = await getMeetingMeta(env.MEETING_CACHE, meetingId);
		const participants = await getParticipants(env.MEETING_CACHE, meetingId);

		return jsonResponse(200, {
			status: "ok",
			summary: cached.summary,
			transcriptUrl,
			recordingUrl: parsed.recordingUrl || r2RecordingUrl,
			audioRecordingUrl: parsed.audioRecordingUrl || r2AudioUrl,
			r2Recordings: hasR2 ? r2Refs : undefined,
			sessionId: session.id,
			transcript_text: cached.transcript,
			cachedAt: cached.cachedAt,
			meetingMeta: meta || undefined,
			participants: participants.length > 0 ? participants : undefined,
			prompt: customPrompt,
			history: history.length > 0 ? history : undefined,
		});
	}

	// Cache hit: transcript only (no summary yet) — generate summary server-side
	if (cached && cached.transcript && !cached.summary) {
		const recRes = await fetchRecordings();
		const parsed = await parseSessionRecordings(recRes, meetingId, session.id);

		const summary = await generateSummary(cached.transcript, env, customPrompt);
		let updatedHistory = history;
		if (summary) {
			await saveCachedResult(env.MEETING_CACHE, meetingId, { transcript: cached.transcript, summary, cachedAt: cached.cachedAt });
			const newVersion: SummaryVersion = { summary, prompt: customPrompt, createdAt: new Date().toISOString() };
			await addSummaryVersion(env.MEETING_CACHE, meetingId, newVersion);
			updatedHistory = [...history, newVersion];
			if (env.SMTP_API_URL) {
				waitUntil(sendAutoEmails(env, meetingId, summary, request.url));
			}
		}

		return jsonResponse(200, {
			status: summary ? "ok" : "no_summary",
			summary,
			recordingUrl: parsed.recordingUrl || r2RecordingUrl,
			audioRecordingUrl: parsed.audioRecordingUrl || r2AudioUrl,
			r2Recordings: hasR2 ? r2Refs : undefined,
			sessionId: session.id,
			transcript_text: cached.transcript,
			prompt: customPrompt,
			history: updatedHistory.length > 0 ? updatedHistory : undefined,
		});
	}

	// No cache: fetch RTK transcript URL + recordings
	const [transcriptUrl, recRes] = await Promise.all([fetchTranscriptUrl(), fetchRecordings()]);
	const parsed = await parseSessionRecordings(recRes, meetingId, session.id);

	let transcriptText = "";
	if (transcriptUrl) {
		try {
			const tfRes = await fetch(transcriptUrl);
			if (tfRes.ok) transcriptText = await tfRes.text();
		} catch (e) {
			console.log("[summary.ts] Transcript download error:", e);
		}
	}

	const transcriptLines = transcriptText.trim().split("\n").filter((l) => l.trim());
	if (transcriptLines.length > 0) {
		const summary = await generateSummary(transcriptText, env, customPrompt);
		await saveCachedResult(env.MEETING_CACHE, meetingId, { transcript: transcriptText, summary: summary || "", cachedAt: new Date().toISOString() });
		let updatedHistory = history;
		if (summary) {
			const newVersion: SummaryVersion = { summary, prompt: customPrompt, createdAt: new Date().toISOString() };
			await addSummaryVersion(env.MEETING_CACHE, meetingId, newVersion);
			updatedHistory = [...history, newVersion];
			if (env.SMTP_API_URL) {
				waitUntil(sendAutoEmails(env, meetingId, summary, request.url));
			}
		}
		return jsonResponse(200, {
			status: summary ? "ok" : "no_summary",
			summary,
			transcriptUrl,
			recordingUrl: parsed.recordingUrl || r2RecordingUrl,
			audioRecordingUrl: parsed.audioRecordingUrl || r2AudioUrl,
			r2Recordings: hasR2 ? r2Refs : undefined,
			sessionId: session.id,
			transcript_text: transcriptText,
			prompt: customPrompt,
			history: updatedHistory.length > 0 ? updatedHistory : undefined,
			sessionInfo: {
				total_participants: session.total_participants,
				recording_minutes: session.recording_minutes_consumed,
				transcription_minutes: session.transcription_minutes_consumed,
				ended_at: session.ended_at,
			},
		});
	}

	// RTK transcript empty — return needs_transcription so frontend triggers /api/transcribe
	console.log("[summary.ts] RTK transcript empty — returning needs_transcription for client-side Whisper");
	return jsonResponse(200, {
		status: "needs_transcription",
		transcriptUrl,
		recordingUrl: parsed.recordingUrl || r2RecordingUrl,
		audioRecordingUrl: parsed.audioRecordingUrl || r2AudioUrl,
		r2Recordings: hasR2 ? r2Refs : undefined,
		sessionId: session.id,
		transcript_text: transcriptText,
		prompt: customPrompt,
		history: history.length > 0 ? history : undefined,
		sessionInfo: {
			total_participants: session.total_participants,
			recording_minutes: session.recording_minutes_consumed,
			transcription_minutes: session.transcription_minutes_consumed,
			ended_at: session.ended_at,
		},
	});
};

async function sendAutoEmails(env: Env, meetingId: string, summary: string, requestUrl: string): Promise<void> {
	try {
		const [meta, participants] = await Promise.all([
			getMeetingMeta(env.MEETING_CACHE, meetingId),
			getParticipants(env.MEETING_CACHE, meetingId),
		]);
		if (meta && participants.length > 0) {
			const url = new URL(requestUrl);
			await sendSummaryEmails(env.SMTP_API_URL, {
				participants,
				meetingTitle: meta.title || "Untitled Meeting",
				creatorName: meta.createdBy?.name || "Someone",
				summary,
				meetingId,
				appUrl: url.origin,
			});
		}
	} catch (e) {
		console.log("[summary.ts] Auto email error:", e);
	}
}

