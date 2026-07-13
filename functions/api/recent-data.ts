import { getMeetingMeta, getParticipants, getCachedResult } from "../lib/kv";
import { jsonResponse } from "../lib/response";
import { checkRateLimit } from "../lib/rate-limit";
import type { AppEnv } from "../lib/env";

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

type Env = Pick<AppEnv, "CF_ACCOUNT_ID" | "CF_API_TOKEN" | "RTK_APP_ID" | "MEETING_CACHE">;

interface RTKMeeting {
	id: string;
	title?: string;
	status?: string;
	created_at: string;
	updated_at: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
	const rl = await checkRateLimit(env.MEETING_CACHE, request);
	if (!rl.allowed) return jsonResponse(429, { error: "Too many requests. Please slow down." });

	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.RTK_APP_ID) {
		return jsonResponse(500, { error: "Server missing configuration" });
	}

	const url = new URL(request.url);
	const daysParam = url.searchParams.get("days") || "3";
	const days = Math.max(1, Math.min(90, parseInt(daysParam, 10) || 3));
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - days);

	const authHeaders = {
		Authorization: `Bearer ${env.CF_API_TOKEN}`,
		"Content-Type": "application/json",
	};

	const res = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/meetings`,
		{ headers: authHeaders }
	);

	if (!res.ok) {
		return jsonResponse(res.status, { error: "Failed to fetch meetings" });
	}

	const json = await res.json() as { success: boolean; data?: RTKMeeting[] };
	const allMeetings = json.data || [];

	const recentMeetings = allMeetings.filter((m) => {
		const createdAt = new Date(m.created_at);
		return createdAt >= cutoff;
	});

	const data = await Promise.all(
		recentMeetings.map(async (m) => {
			const [meta, participants, result] = await Promise.all([
				getMeetingMeta(env.MEETING_CACHE, m.id),
				getParticipants(env.MEETING_CACHE, m.id),
				getCachedResult(env.MEETING_CACHE, m.id),
			]);
			return {
				meetingId: m.id,
				title: meta?.title || m.title || "",
				status: m.status,
				createdAt: m.created_at,
				createdBy: meta?.createdBy || null,
				participants: participants || [],
				hasTranscript: !!(result?.transcript),
				hasSummary: !!(result?.summary),
				cachedAt: result?.cachedAt || null,
				summary: result?.summary || null,
			};
		})
	);

	return jsonResponse(200, { days, cutoff: cutoff.toISOString(), count: data.length, meetings: data });
};
