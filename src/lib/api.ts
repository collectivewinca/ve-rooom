export interface CreateRoomResponse {
	roomId: string;
	authToken: string;
}

export interface JoinRoomResponse {
	authToken: string;
}

export interface RecordingRef {
	key: string;
	url: string;
	type: "composite" | "audio";
	size?: number;
	uploadedAt?: string;
}

export interface SummaryVersion {
	summary: string;
	prompt?: string;
	createdAt: string;
}

export interface SummaryResponse {
	status: "ok" | "processing" | "no_ended_session" | "no_summary" | "error" | "needs_transcription" | "silent";
	summary?: string;
	transcriptUrl?: string;
	recordingUrl?: string;
	audioRecordingUrl?: string;
	r2Recordings?: RecordingRef[];
	sessionId?: string;
	error?: string;
	transcript_text?: string;
	prompt?: string;
	history?: SummaryVersion[];
	sessionInfo?: {
		total_participants?: number;
		recording_minutes?: number;
		transcription_minutes?: number;
		ended_at?: string;
	};
	cachedAt?: string;
	meetingMeta?: { createdBy: { email: string; name: string }; title: string; createdAt: string };
	participants?: MeetingParticipant[];
}

export interface TranscribeResponse {
	status: "transcribed" | "no_speech" | "too_large" | "whisper_failed" | "error" | "silent" | "processing";
	transcript?: string;
	message?: string;
	sizeMb?: string;
	numChunks?: number;
	chunksDone?: number;
	totalChunks?: number;
}

export interface GenerateSummaryResponse {
	status: "ok" | "no_summary";
	summary?: string;
	message?: string;
}

export interface SessionRecording {
	id: string;
	status: string;
	type: "composite";
	invoked_time?: string;
	recording_duration?: number;
	has_video: boolean;
	has_audio: boolean;
}

export interface MeetingSession {
	id: string;
	status: string;
	recording_status?: string;
	created_at?: string;
	ended_at?: string;
	participant_count?: number;
	recording_minutes?: number;
	transcription_minutes?: number;
	recordings: SessionRecording[];
}

export interface MeetingParticipant {
	email: string;
	name: string;
	joinedAt: string;
}

export interface MeetingWithSessions {
	id: string;
	title?: string;
	status?: string;
	created_at: string;
	updated_at: string;
	record_on_start?: boolean;
	transcribe_on_end?: boolean;
	summarize_on_end?: boolean;
	sessions: MeetingSession[];
	createdBy?: { email: string; name: string };
	participants?: MeetingParticipant[];
	hasCachedSummary?: boolean;
}

export interface MeetingsResponse {
	meetings: MeetingWithSessions[];
}

export interface RecordingStartResponse {
	recordingId?: string;
	status: string;
	alreadyStarted?: boolean;
	error?: string;
}

export interface RecordingStopResponse {
	stopped: { id: string; status: string }[];
	failed: { id: string; error: string }[];
	stoppedCount: number;
	failedCount: number;
}

function getAuthToken(): string | null {
	try {
		const raw = localStorage.getItem("formsdb_auth_session");
		if (!raw) return null;
		const session = JSON.parse(raw);
		return session?.token || null;
	} catch {
		return null;
	}
}

export async function createRoom(name: string, roomTitle?: string): Promise<CreateRoomResponse> {
	console.log("[api.ts] createRoom — name:", name, "roomTitle:", roomTitle || "(none)");
	const authToken = getAuthToken();
	if (!authToken) throw new Error("You must be signed in to create a meeting");

	const res = await fetch("/api/rooms", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name, roomTitle, authToken }),
	});
	console.log("[api.ts] createRoom response status:", res.status);
	if (!res.ok) {
		const errText = await res.text();
		console.log("[api.ts] createRoom failed:", errText);
		throw new Error(`Failed to create room: ${res.status}`);
	}
	const data = await res.json() as CreateRoomResponse;
	console.log("[api.ts] createRoom success — roomId:", data.roomId);
	return data;
}

export async function joinRoom(roomId: string, name: string): Promise<JoinRoomResponse> {
	roomId = roomId.trim().replace(/\/+$/, "");
	console.log("[api.ts] joinRoom — roomId:", roomId, "name:", name);
	const authToken = getAuthToken();
	if (!authToken) throw new Error("You must be signed in to join a meeting");

	const res = await fetch(`/api/rooms/${roomId}/participants`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name, authToken }),
	});
	console.log("[api.ts] joinRoom response status:", res.status);
	if (!res.ok) {
		const errText = await res.text();
		console.log("[api.ts] joinRoom failed:", errText);
		throw new Error(`Failed to join room: ${res.status}`);
	}
	const data = await res.json() as JoinRoomResponse;
	console.log("[api.ts] joinRoom success — token received");
	return data;
}

export async function getSummary(roomId: string): Promise<SummaryResponse> {
	console.log("[api.ts] getSummary — roomId:", roomId);
	const res = await fetch(`/api/summary/${roomId}`);
	console.log("[api.ts] getSummary response status:", res.status);
	if (!res.ok) {
		const errText = await res.text();
		console.log("[api.ts] getSummary failed:", errText);
		throw new Error(`Failed to fetch summary: ${res.status}`);
	}
	const data = await res.json() as SummaryResponse;
	console.log("[api.ts] getSummary result status:", data.status);
	return data;
}

export async function fetchMeetings(): Promise<MeetingWithSessions[]> {
	console.log("[api.ts] fetchMeetings");
	const res = await fetch("/api/meetings");
	console.log("[api.ts] fetchMeetings response status:", res.status);
	if (!res.ok) {
		const errText = await res.text();
		console.log("[api.ts] fetchMeetings failed:", errText);
		throw new Error(`Failed to fetch meetings: ${res.status}`);
	}
	const data = await res.json() as MeetingsResponse;
	console.log("[api.ts] fetchMeetings — got", data.meetings?.length || 0, "meetings");
	return data.meetings || [];
}

export async function transcribeAudio(meetingId: string, audioUrl: string): Promise<TranscribeResponse> {
	console.log("[api.ts] transcribeAudio — meetingId:", meetingId, "audioUrl:", !!audioUrl);
	const res = await fetch("/api/transcribe", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ meetingId, audioUrl }),
	});
	console.log("[api.ts] transcribeAudio response status:", res.status);
	if (!res.ok) {
		const errText = await res.text();
		console.log("[api.ts] transcribeAudio failed:", errText);
		throw new Error(`Transcribe failed: ${res.status}`);
	}
	const data = await res.json() as TranscribeResponse;
	console.log("[api.ts] transcribeAudio result:", data.status, "transcript:", data.transcript?.length || 0, "chars");
	return data;
}

export async function generateSummaryFromTranscript(transcript: string, meetingId?: string, prompt?: string): Promise<GenerateSummaryResponse> {
	console.log("[api.ts] generateSummaryFromTranscript — transcript:", transcript.length, "chars", "meetingId:", meetingId, "customPrompt:", !!prompt);
	const res = await fetch("/api/generate-summary", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ transcript, meetingId, prompt }),
	});
	console.log("[api.ts] generateSummary response status:", res.status);
	if (!res.ok) {
		const errText = await res.text();
		console.log("[api.ts] generateSummary failed:", errText);
		throw new Error(`Generate summary failed: ${res.status}`);
	}
	const data = await res.json() as GenerateSummaryResponse;
	console.log("[api.ts] generateSummary result:", data.status, "summary:", data.summary?.length || 0, "chars");
	return data;
}

export async function startCompositeRecording(meetingId: string): Promise<RecordingStartResponse> {
	console.log("[api.ts] startCompositeRecording — meetingId:", meetingId);
	const authToken = getAuthToken();
	if (!authToken) throw new Error("You must be signed in");

	const res = await fetch("/api/recordings/start", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ meetingId, authToken }),
	});
	console.log("[api.ts] startCompositeRecording response status:", res.status);
	if (!res.ok) {
		const errText = await res.text();
		console.log("[api.ts] startCompositeRecording failed:", errText);
		throw new Error(`Failed to start composite recording: ${res.status}`);
	}
	const data = await res.json() as RecordingStartResponse;
	console.log("[api.ts] startCompositeRecording result:", data);
	return data;
}

export async function stopAllRecordings(meetingId: string): Promise<RecordingStopResponse> {
	console.log("[api.ts] stopAllRecordings — meetingId:", meetingId);
	const authToken = getAuthToken();
	if (!authToken) throw new Error("You must be signed in");

	const res = await fetch("/api/recordings/stop", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ meetingId, authToken }),
	});
	console.log("[api.ts] stopAllRecordings response status:", res.status);
	if (!res.ok) {
		const errText = await res.text();
		console.log("[api.ts] stopAllRecordings failed:", errText);
		throw new Error(`Failed to stop recordings: ${res.status}`);
	}
	const data = await res.json() as RecordingStopResponse;
	console.log("[api.ts] stopAllRecordings result:", data);
	return data;
}

export async function scanR2Recordings(meetingId: string): Promise<RecordingRef[]> {
	console.log("[api.ts] scanR2Recordings — meetingId:", meetingId);
	const res = await fetch("/api/recording/scan", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ meetingId }),
	});
	console.log("[api.ts] scanR2Recordings response status:", res.status);
	if (!res.ok) {
		console.log("[api.ts] scanR2Recordings failed:", res.status);
		return [];
	}
	const data = await res.json() as { refs: RecordingRef[]; cached: boolean };
	console.log("[api.ts] scanR2Recordings found:", data.refs.length, "cached:", data.cached);
	return data.refs || [];
}

export async function getUserDefaultPrompt(): Promise<string> {
	try {
		const authToken = getAuthToken();
		if (!authToken) return "";
		const res = await fetch("/api/prompt", {
			headers: { Authorization: `Bearer ${authToken}` },
		});
		if (!res.ok) return "";
		const data = await res.json() as { prompt?: string };
		return data.prompt || "";
	} catch {
		return "";
	}
}

export async function saveUserDefaultPrompt(prompt: string): Promise<boolean> {
	try {
		const authToken = getAuthToken();
		if (!authToken) throw new Error("Not authenticated");
		const res = await fetch("/api/prompt", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
			body: JSON.stringify({ prompt }),
		});
		return res.ok;
	} catch {
		return false;
	}
}

export async function getMeetingPrompt(meetingId: string): Promise<string> {
	try {
		const res = await fetch(`/api/prompt/${meetingId}`);
		if (!res.ok) return "";
		const data = await res.json() as { prompt?: string };
		return data.prompt || "";
	} catch {
		return "";
	}
}

export async function saveMeetingPrompt(meetingId: string, prompt: string): Promise<boolean> {
	try {
		const authToken = getAuthToken();
		if (!authToken) throw new Error("Not authenticated");
		const res = await fetch(`/api/prompt/${meetingId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
			body: JSON.stringify({ prompt }),
		});
		return res.ok;
	} catch {
		return false;
	}
}