import { saveCachedResult } from "../lib/kv";

interface Env {
	OPENROUTER_API_KEY: string;
	OPENROUTER_MODEL?: string;
	OPENROUTER_FREE_MODEL?: string;
	OLLAMA_API_KEY: string;
	OLLAMA_BASE_URL: string;
	OLLAMA_MODEL?: string;
	MEETING_CACHE: KVNamespace;
}

const MAX_CHARS = 60000;

const PROMPT = `You are an expert meeting analyst and executive assistant. Analyze a meeting transcript and produce a comprehensive Markdown summary.

## Meeting Summary
Detailed overview paragraph (4-8 sentences): meeting purpose, tone, main themes, who was present.

## Key Topics Discussed
Bullet points — each topic with 2-4 sentences of specifics.

## Decisions Made
Bullet points — **decision** followed by rationale.

## Action Items
- [ ] **Owner Name** — Task description (deadline)

## Open Questions
Bullet points. If none, write "No open questions."

## Participants
Who spoke and who seemed to lead.

## Sentiment & Engagement
2-3 sentences on energy, engagement, dynamics.

Rules: Be thorough. Use actual names/words. Don't invent. Note gaps if unclear. Professional Markdown.`;

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

async function callLm(env: Env, content: string): Promise<string | null> {
	const models = [
		env.OPENROUTER_MODEL || "openrouter/free",
		env.OPENROUTER_FREE_MODEL || "openrouter/free",
	].filter((m, i, arr) => arr.indexOf(m) === i);

	for (const model of models) {
		if (!env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY === "placeholder") continue;
		try {
			const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
				body: JSON.stringify({ model, messages: [{ role: "system", content: PROMPT }, { role: "user", content }] }),
			});
			if (res.ok) {
				const oj = await res.json() as { choices?: { message?: { content?: string } }[] };
				const c = oj.choices?.[0]?.message?.content;
				if (c && c.length > 50) return c;
			} else {
				const err = await res.text();
				console.log(`[gs] OR ${res.status}: ${err.slice(0, 200)}`);
			}
		} catch (e) {
			console.log(`[gs] OR error: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	if (env.OLLAMA_BASE_URL && env.OLLAMA_API_KEY && env.OLLAMA_API_KEY !== "placeholder") {
		const model = env.OLLAMA_MODEL || "gpt-oss:120b";
		try {
			const res = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OLLAMA_API_KEY}` },
				body: JSON.stringify({ model, stream: false, messages: [{ role: "system", content: PROMPT }, { role: "user", content }] }),
			});
			if (res.ok) {
				const oj = await res.json() as { message?: { content?: string } };
				const c = oj.message?.content;
				if (c && c.length > 50) return c;
			}
		} catch (e) {
			console.log("[gs] Ollama error:", e instanceof Error ? e.message : String(e));
		}
	}
	return null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	const body = await request.json() as { transcript: string; meetingId?: string };
	console.log("[gs] POST — length:", body.transcript?.length || 0, "meetingId:", body.meetingId);

	if (!body.transcript || body.transcript.trim().length === 0) {
		return jsonResponse(400, { error: "transcript is required" });
	}

	let input = dedupe(body.transcript);
	if (input.length > MAX_CHARS) {
		input = input.slice(0, MAX_CHARS) + "\n\n[...]";
	}

	const summary = await callLm(env, `Here is the meeting transcript:\n\n${input}`);
	if (summary) {
		await saveCachedResult(env.MEETING_CACHE, body.meetingId || "", { transcript: body.transcript, summary, cachedAt: new Date().toISOString() });
		return jsonResponse(200, { status: "ok", summary });
	}
	return jsonResponse(200, { status: "no_summary", message: "Could not generate summary." });
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}