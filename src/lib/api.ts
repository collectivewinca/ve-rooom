export interface CreateRoomResponse {
	roomId: string;
	authToken: string;
}

export interface JoinRoomResponse {
	authToken: string;
}

export interface SummaryResponse {
	status: "ok" | "processing" | "no_ended_session" | "no_summary" | "error";
	summary?: string;
	transcriptUrl?: string;
	recordingUrl?: string;
	audioRecordingUrl?: string;
	sessionId?: string;
	error?: string;
}

export async function createRoom(name: string, roomTitle?: string): Promise<CreateRoomResponse> {
	console.log("[api.ts] createRoom — name:", name, "roomTitle:", roomTitle || "(none)");
	const res = await fetch("/api/rooms", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name, roomTitle }),
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
	console.log("[api.ts] joinRoom — roomId:", roomId, "name:", name);
	const res = await fetch(`/api/rooms/${roomId}/participants`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
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