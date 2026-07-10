import { getCachedResult, getMeetingMeta, getParticipants, saveCachedResult } from "../../lib/kv";
import { jsonResponse } from "../../lib/response";
import { checkRateLimit } from "../../lib/rate-limit";
import { parseSessionRecordings } from "../../lib/recordings";
import { generateSummary } from "../../lib/summarizer";
import type { AppEnv } from "../../lib/env";

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

type Env = AppEnv;

export const onRequestGet: PagesFunction<Env> = async ({ params, request, env }) => {
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

	const cached = await getCachedResult(env.MEETING_CACHE, meetingId);

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
			recordingUrl: parsed.recordingUrl,
			audioRecordingUrl: parsed.audioRecordingUrl,
			trackFiles: parsed.trackFiles.length > 0 ? parsed.trackFiles : undefined,
			sessionId: session.id,
			transcript_text: cached.transcript,
			cachedAt: cached.cachedAt,
			meetingMeta: meta || undefined,
			participants: participants.length > 0 ? participants : undefined,
		});
	}

	// Cache hit: transcript only (no summary yet)
	if (cached && cached.transcript && !cached.summary) {
		const recRes = await fetchRecordings();
		const parsed = await parseSessionRecordings(recRes, meetingId, session.id);

		return jsonResponse(200, {
			status: "needs_transcription",
			transcriptUrl: undefined,
			recordingUrl: parsed.recordingUrl,
			audioRecordingUrl: parsed.audioRecordingUrl,
			trackFiles: parsed.trackFiles.length > 0 ? parsed.trackFiles : undefined,
			sessionId: session.id,
			transcript_text: cached.transcript,
		});
	}

	// No cache: fetch transcript URL + recordings + download transcript
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
		const summary = await generateSummary(transcriptText, env);
		await saveCachedResult(env.MEETING_CACHE, meetingId, { transcript: transcriptText, summary: summary || "", cachedAt: new Date().toISOString() });
		return jsonResponse(200, {
			status: summary ? "ok" : "no_summary",
			summary,
			transcriptUrl,
			recordingUrl: parsed.recordingUrl,
			audioRecordingUrl: parsed.audioRecordingUrl,
			trackFiles: parsed.trackFiles.length > 0 ? parsed.trackFiles : undefined,
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

	return jsonResponse(200, {
		status: "needs_transcription",
		transcriptUrl,
		recordingUrl: parsed.recordingUrl,
		audioRecordingUrl: parsed.audioRecordingUrl,
		trackFiles: parsed.trackFiles.length > 0 ? parsed.trackFiles : undefined,
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

