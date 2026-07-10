import { saveCachedResult } from "../lib/kv";
import { jsonResponse } from "../lib/response";
import { checkRateLimit } from "../lib/rate-limit";
import { generateSummary } from "../lib/summarizer";
import type { AppEnv } from "../lib/env";

type Env = Pick<AppEnv, "OPENROUTER_API_KEY" | "OPENROUTER_MODEL" | "OPENROUTER_FREE_MODEL" | "OLLAMA_API_KEY" | "OLLAMA_BASE_URL" | "OLLAMA_MODEL" | "MEETING_CACHE">;

const MAX_CHARS = 60000;

function dedupe(text: string): string {
	const lines = text.split("\n");
	const seen = new Set<string>();
	const out: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 50);
		if (!trimmed) continue;
		const key = trimmed;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(line);
	}
	return out.join("\n");
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	const rl = await checkRateLimit(env.MEETING_CACHE, request);
	if (!rl.allowed) return jsonResponse(429, { error: "Too many requests. Please slow down." });

	const body = await request.json() as { transcript: string; meetingId?: string };

	if (!body.transcript || body.transcript.trim().length === 0) {
		return jsonResponse(400, { error: "transcript is required" });
	}

	let input = dedupe(body.transcript);
	if (input.length > MAX_CHARS) {
		input = input.slice(0, MAX_CHARS) + "\n\n[...]";
	}

	const summary = await generateSummary(input, env);
	if (summary) {
		await saveCachedResult(env.MEETING_CACHE, body.meetingId || "", { transcript: body.transcript, summary, cachedAt: new Date().toISOString() });
		return jsonResponse(200, { status: "ok", summary });
	}
	return jsonResponse(200, { status: "no_summary", message: "Could not generate summary." });
};

