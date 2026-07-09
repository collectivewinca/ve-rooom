interface Env {
	OPENROUTER_API_KEY: string;
	OPENROUTER_MODEL?: string;
	OPENROUTER_FREE_MODEL?: string;
	OLLAMA_API_KEY: string;
	OLLAMA_BASE_URL: string;
	OLLAMA_MODEL?: string;
}

const SUMMARY_SYSTEM_PROMPT = `You are an expert meeting analyst and executive assistant. Your job is to analyze a meeting transcript and produce a comprehensive, well-structured Markdown summary.

Here is the format you MUST follow:

## Meeting Summary
Write a detailed overview paragraph (4-8 sentences) explaining what the meeting was about, its purpose, the overall tone, and the main themes discussed. Include who was present if identifiable from the transcript.

## Key Topics Discussed
List every distinct topic that was discussed during the meeting. For each topic, write 2-4 sentences explaining what was said about it. Use bullet points. Be specific — reference actual points, numbers, or details mentioned.

## Decisions Made
List every decision that was reached during the meeting. Each decision should be a bullet point with the decision in **bold** followed by a brief explanation of the rationale. If no formal decisions were made, note that.

## Action Items
Extract every action item, task, or follow-up mentioned. Format as a checklist:
- [ ] **Owner Name** — Task description (deadline if mentioned)
If an owner is not identifiable, use **Unassigned**. Include any deadlines or timelines mentioned.

## Open Questions
List any questions that were raised but not resolved during the meeting. Format as bullet points. If none, note "No open questions."

## Participants
List the participants who spoke during the meeting (identifiable from the transcript). If you can tell from the transcript, note who seemed to be leading the meeting.

## Sentiment & Engagement
Provide a brief assessment (2-3 sentences) of the meeting's energy, engagement level, and any notable dynamics (e.g., disagreements, enthusiasm, confusion, urgency).

Rules:
- Be thorough and detailed — this summary should be useful for someone who did NOT attend the meeting.
- Use the actual words and names from the transcript. Do NOT invent information.
- If the transcript is unclear or fragmented, do your best and note any gaps.
- Keep it professional, clear, and skimmable with proper Markdown formatting.
- Use timestamps from the transcript to reference when key moments occurred, if available.`;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	const body = await request.json() as { transcript: string };
	console.log("[generate-summary.ts] POST — transcript length:", body.transcript?.length || 0);

	if (!body.transcript || body.transcript.trim().length === 0) {
		return jsonResponse(400, { error: "transcript is required" });
	}

	// OpenRouter
	const openrouterModels = [
		env.OPENROUTER_MODEL || "openrouter/free",
		env.OPENROUTER_FREE_MODEL || "openrouter/free",
	].filter((m, i, arr) => arr.indexOf(m) === i);

	for (const model of openrouterModels) {
		if (!env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY === "placeholder") continue;
		console.log("[generate-summary.ts] Calling OpenRouter:", model);
		try {
			const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
				},
				body: JSON.stringify({
					model,
					messages: [
						{ role: "system", content: SUMMARY_SYSTEM_PROMPT },
						{ role: "user", content: `Here is the meeting transcript:\n\n${body.transcript}` },
					],
				}),
			});
			if (orRes.ok) {
				const oj = await orRes.json() as { choices?: { message?: { content?: string } }[] };
				const summary = oj.choices?.[0]?.message?.content;
				if (summary) {
					console.log("[generate-summary.ts] OpenRouter summary:", summary.length, "chars");
					return jsonResponse(200, { status: "ok", summary });
				}
			} else {
				console.log("[generate-summary.ts] OpenRouter failed:", orRes.status);
			}
		} catch (e) {
			console.log("[generate-summary.ts] OpenRouter error:", e);
		}
	}

	// Ollama fallback
	if (env.OLLAMA_BASE_URL && env.OLLAMA_API_KEY && env.OLLAMA_API_KEY !== "placeholder") {
		const ollamaModel = env.OLLAMA_MODEL || "gpt-oss:120b";
		console.log("[generate-summary.ts] Falling back to Ollama:", ollamaModel);
		try {
			const ollamaRes = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${env.OLLAMA_API_KEY}`,
				},
				body: JSON.stringify({
					model: ollamaModel,
					stream: false,
					messages: [
						{ role: "system", content: SUMMARY_SYSTEM_PROMPT },
						{ role: "user", content: `Here is the meeting transcript:\n\n${body.transcript}` },
					],
				}),
			});
			if (ollamaRes.ok) {
				const oj = await ollamaRes.json() as { message?: { content?: string } };
				const summary = oj.message?.content;
				if (summary) {
					console.log("[generate-summary.ts] Ollama summary:", summary.length, "chars");
					return jsonResponse(200, { status: "ok", summary });
				}
			}
		} catch (e) {
			console.log("[generate-summary.ts] Ollama error:", e);
		}
	}

	return jsonResponse(200, { status: "no_summary", message: "Could not generate summary with any LLM provider." });
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}