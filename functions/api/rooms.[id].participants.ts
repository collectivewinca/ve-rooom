interface Env {
	CF_ACCOUNT_ID: string;
	CF_API_TOKEN: string;
	RTK_APP_ID: string;
}

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

export const onRequestPost: PagesFunction<Env> = async ({ params, request, env }) => {
	const roomId = params.id as string;

	let body: { name?: string };
	try {
		body = await request.json();
	} catch {
		return jsonResponse(400, { error: "Invalid JSON body" });
	}

	const name = body.name?.trim();
	if (!name) {
		return jsonResponse(400, { error: "name is required" });
	}

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

	if (!res.ok) {
		const errText = await res.text();
		return jsonResponse(res.status, { error: "Failed to join room", detail: errText });
	}

	const json = await res.json() as {
		success: boolean;
		data: { token: string };
	};

	return jsonResponse(200, { authToken: json.data.token });
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}