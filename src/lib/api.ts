export interface CreateRoomResponse {
	roomId: string;
	authToken: string;
}

export interface JoinRoomResponse {
	authToken: string;
}

export interface SummaryResponse {
	status: "ok" | "processing" | "no_ended_session" | "error";
	summary?: string;
	transcriptUrl?: string;
	recordingUrl?: string;
	sessionId?: string;
	error?: string;
}

export async function createRoom(name: string, roomTitle?: string): Promise<CreateRoomResponse> {
	const res = await fetch("/api/rooms", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name, roomTitle }),
	});
	if (!res.ok) throw new Error(`Failed to create room: ${res.status}`);
	return res.json();
}

export async function joinRoom(roomId: string, name: string): Promise<JoinRoomResponse> {
	const res = await fetch(`/api/rooms/${roomId}/participants`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});
	if (!res.ok) throw new Error(`Failed to join room: ${res.status}`);
	return res.json();
}

export async function getSummary(roomId: string): Promise<SummaryResponse> {
	const res = await fetch(`/api/summary/${roomId}`);
	if (!res.ok) throw new Error(`Failed to fetch summary: ${res.status}`);
	return res.json();
}