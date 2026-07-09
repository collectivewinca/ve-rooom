interface Env {
	CF_ACCOUNT_ID: string;
	CF_API_TOKEN: string;
	RTK_APP_ID: string;
}

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

interface RTKMeeting {
	id: string;
	title?: string;
	status?: string;
	created_at: string;
	updated_at: string;
	record_on_start?: boolean;
	transcribe_on_end?: boolean;
	summarize_on_end?: boolean;
}

interface RTKSession {
	id: string;
	associated_id: string;
	status: string;
	recording_status?: string;
	created_at?: string;
	updated_at?: string;
	started_at?: string;
	ended_at?: string;
	participant_count?: number;
}

interface RTKRecording {
	id: string;
	meeting_id: string;
	session_id?: string;
	status: string;
	type?: string;
	output_file_name?: string;
	download_url?: unknown;
	audio_download_url?: string;
	invoked_time?: string;
}

interface MeetingWithSessions extends RTKMeeting {
	sessions: {
		id: string;
		status: string;
		recording_status?: string;
		created_at?: string;
		ended_at?: string;
		participant_count?: number;
		recordings: {
			id: string;
			status: string;
			type: string;
			invoked_time?: string;
			has_video: boolean;
			has_audio: boolean;
			has_track: boolean;
		}[];
	}[];
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
	console.log("[meetings.ts] GET /api/meetings — start");

	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.RTK_APP_ID) {
		console.log("[meetings.ts] Missing config");
		return jsonResponse(500, { error: "Server missing configuration" });
	}

	const authHeaders = {
		Authorization: `Bearer ${env.CF_API_TOKEN}`,
		"Content-Type": "application/json",
	};

	console.log("[meetings.ts] Fetching meetings from RealtimeKit");

	const res = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/meetings`,
		{ headers: authHeaders }
	);

	console.log("[meetings.ts] Response status:", res.status);

	if (!res.ok) {
		const errText = await res.text();
		console.log("[meetings.ts] Fetch failed:", errText);
		return jsonResponse(res.status, { error: "Failed to fetch meetings" });
	}

	const json = await res.json() as {
		success: boolean;
		data?: RTKMeeting[];
		paging?: { total_count: number };
	};

	const meetings = json.data || [];
	console.log("[meetings.ts] Meetings found:", meetings.length);

	const allRecordingsRes = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/recordings`,
		{ headers: authHeaders }
	).catch((e) => {
		console.log("[meetings.ts] Recordings fetch error:", e);
		return null;
	});

	let recordingsByMeeting: Record<string, RTKRecording[]> = {};
	if (allRecordingsRes && allRecordingsRes.ok) {
		const recJson = await allRecordingsRes.json() as { success: boolean; data?: RTKRecording[] };
		for (const rec of recJson.data || []) {
			const mid = rec.meeting_id;
			if (!recordingsByMeeting[mid]) recordingsByMeeting[mid] = [];
			recordingsByMeeting[mid].push(rec);
		}
		console.log("[meetings.ts] Recordings loaded for", Object.keys(recordingsByMeeting).length, "meetings");
	}

	const sessionsResults = await Promise.all(
		meetings.map((m) =>
			fetch(
				`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/sessions?meeting_id=${m.id}`,
				{ headers: authHeaders }
			)
			.then((r) => r.json() as Promise<{ success: boolean; data?: { sessions?: RTKSession[] } }>)
			.then((j) => ({ meetingId: m.id, sessions: j.data?.sessions || [] }))
			.catch((e) => {
				console.log("[meetings.ts] Sessions fetch failed for", m.id, ":", e);
				return { meetingId: m.id, sessions: [] as RTKSession[] };
			})
		)
	);

	const sessionsByMeeting: Record<string, RTKSession[]> = {};
	for (const sr of sessionsResults) {
		sessionsByMeeting[sr.meetingId] = sr.sessions.filter((s) => s.associated_id === sr.meetingId);
	}
	console.log("[meetings.ts] Sessions loaded for", Object.keys(sessionsByMeeting).length, "meetings");

	const meetingsWithSessions: MeetingWithSessions[] = meetings.map((m) => {
		const meetingSessions = sessionsByMeeting[m.id] || [];
		const meetingRecordings = recordingsByMeeting[m.id] || [];

		const sessions = meetingSessions.map((s) => {
			const sessionRecordings = meetingRecordings.filter((r) => r.session_id === s.id);
			const recordings = sessionRecordings.map((r) => {
				const isTrack = (r.output_file_name || "").includes(".webm") || typeof r.download_url !== "string";
				return {
					id: r.id,
					status: r.status,
					type: isTrack ? "track" : "composite",
					invoked_time: r.invoked_time,
					has_video: !isTrack && typeof r.download_url === "string",
					has_audio: !isTrack && !!r.audio_download_url,
					has_track: isTrack,
				};
			});

			return {
				id: s.id,
				status: s.status,
				recording_status: s.recording_status,
				created_at: s.created_at || s.started_at,
				ended_at: s.ended_at,
				participant_count: s.participant_count,
				recordings,
			};
		});

		return { ...m, sessions };
	});

	console.log("[meetings.ts] Returning", meetingsWithSessions.length, "meetings with sessions");

	return jsonResponse(200, { meetings: meetingsWithSessions });
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}