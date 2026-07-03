import { verifyAuthToken } from "../../../auth";

interface Env {
	CF_ACCOUNT_ID: string;
	CF_API_TOKEN: string;
	RTK_APP_ID: string;
	OLLAMA_API_KEY: string;
	OLLAMA_BASE_URL: string;
	FORMSDB_URL?: string;
}

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

export const onRequestPost: PagesFunction<Env> = async ({ params, request, env }) => {
	const roomId = params.id as string;
	console.log("[participants.ts] POST /api/rooms/:id/participants — start, roomId:", roomId);

	let body: { name?: string; authToken?: string };
	try {
		body = await request.json();
		console.log("[participants.ts] Request body:", body);
	} catch {
		console.log("[participants.ts] Invalid JSON body");
		return jsonResponse(400, { error: "Invalid JSON body" });
	}

	const user = await verifyAuthToken(body.authToken, env);
	if (!user) {
		console.log("[participants.ts] Auth verification failed");
		return jsonResponse(401, { error: "Authentication required. Please sign in with Google." });
	}

	const name = body.name?.trim() || user.name;
	if (!name) {
		console.log("[participants.ts] Missing name");
		return jsonResponse(400, { error: "name is required" });
	}

	console.log("[participants.ts] Adding participant:", name, "to room:", roomId);

	const res = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/meetings/${roomId}/participants`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.CF_API_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name, preset_name: "group_call_host", custom_participant_id: crypto.randomUUID() }),
		}
	);

	console.log("[participants.ts] Add participant response status:", res.status);

	if (!res.ok) {
		const errText = await res.text();
		console.log("[participants.ts] Add participant failed:", errText);
		return jsonResponse(res.status, { error: "Failed to join room", detail: errText });
	}

	const json = await res.json() as {
		success: boolean;
		data: { token: string };
	};

	console.log("[participants.ts] Participant added, token received (truncated):", json.data.token?.slice(0, 30) + "...");
	console.log("[participants.ts] Done — returning authToken");

	return jsonResponse(200, { authToken: json.data.token });
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}