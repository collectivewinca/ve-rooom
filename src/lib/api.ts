export interface CreateRoomResponse {
	roomId: string;
	authToken: string;
}

export interface JoinRoomResponse {
	authToken: string;
}

export interface TrackFile {
	filename: string;
	downloadUrl: string;
	userId: string;
	peerId: string;
}

export interface SummaryResponse {
	status: "ok" | "processing" | "no_ended_session" | "no_summary" | "error";
	summary?: string;
	transcriptUrl?: string;
	recordingUrl?: string;
	audioRecordingUrl?: string;
	trackFiles?: TrackFile[];
	sessionId?: string;
	error?: string;
	transcript_text?: string;
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

export async function startTrackRecording(meetingId: string): Promise<RecordingStartResponse> {
	console.log("[api.ts] startTrackRecording — meetingId:", meetingId);
	const authToken = getAuthToken();
	if (!authToken) throw new Error("You must be signed in");

	const res = await fetch("/api/recordings/track", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ meetingId, authToken }),
	});
	console.log("[api.ts] startTrackRecording response status:", res.status);
	if (!res.ok) {
		const errText = await res.text();
		console.log("[api.ts] startTrackRecording failed:", errText);
		throw new Error(`Failed to start track recording: ${res.status}`);
	}
	const data = await res.json() as RecordingStartResponse;
	console.log("[api.ts] startTrackRecording result:", data);
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