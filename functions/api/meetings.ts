interface Env {
	CF_ACCOUNT_ID: string;
	CF_API_TOKEN: string;
	RTK_APP_ID: string;
}

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN || !env.RTK_APP_ID) {
		return jsonResponse(500, { error: "Server missing configuration" });
	}

	const res = await fetch(
		`${RTK_BASE}/${env.CF_ACCOUNT_ID}/realtime/kit/${env.RTK_APP_ID}/meetings`,
		{
			headers: {
				Authorization: `Bearer ${env.CF_API_TOKEN}`,
				"Content-Type": "application/json",
			},
		}
	);

	if (!res.ok) {
		return jsonResponse(res.status, { error: "Failed to fetch meetings" });
	}

	const json = await res.json() as {
		success: boolean;
		data?: Meeting[];
		paging?: { total_count: number };
	};

	return jsonResponse(200, { meetings: json.data || [] });
};

interface Meeting {
	id: string;
	title?: string;
	status?: string;
	created_at: string;
	updated_at: string;
	record_on_start?: boolean;
	transcribe_on_end?: boolean;
	summarize_on_end?: boolean;
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}