import type { AppEnv } from "./env";

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

export const DEFAULT_SUMMARY_PROMPT = SUMMARY_SYSTEM_PROMPT;

export async function generateSummary(
	transcriptText: string,
	env: Pick<AppEnv, "OPENROUTER_API_KEY" | "OPENROUTER_MODEL" | "OPENROUTER_FREE_MODEL" | "OLLAMA_API_KEY" | "OLLAMA_BASE_URL" | "OLLAMA_MODEL">,
	customPrompt?: string,
): Promise<string | undefined> {
	const systemPrompt = customPrompt && customPrompt.trim().length > 0 ? customPrompt.trim() : SUMMARY_SYSTEM_PROMPT;
	return callLLM(transcriptText, systemPrompt, env);
}

const CHUNK_SUMMARY_PROMPT = `You are summarizing a portion (chunk) of a long meeting transcript. This is one of several chunks that will be combined later, so focus ONLY on this section.

Produce a structured summary of THIS chunk:
- Key topics discussed (with specifics)
- Any decisions made
- Any action items or follow-ups
- Notable quotes or important points
- Any open questions raised

Do NOT write a general meeting overview — that will be done in the final combine step. Just extract the substance of THIS chunk. Use bullet points and be specific with names, numbers, and details.`;

const COMBINE_PROMPT = `You are given summaries of several chunks from a long meeting. Each chunk summary covers a portion of the meeting in order. Combine them into one comprehensive, well-structured Markdown summary.

Here is the format you MUST follow:

## Meeting Summary
Write a detailed overview paragraph (4-8 sentences) explaining what the meeting was about, its purpose, the overall tone, and the main themes discussed. Include who was present if identifiable.

## Key Topics Discussed
List every distinct topic that was discussed during the meeting. For each topic, write 2-4 sentences explaining what was said about it. Use bullet points. Be specific — reference actual points, numbers, or details mentioned.

## Decisions Made
List every decision that was reached during the meeting. Each decision should be a bullet point with the decision in **bold** followed by a brief explanation.

## Action Items
Extract every action item, task, or follow-up mentioned. Format as a checklist:
- [ ] **Owner Name** — Task description (deadline if mentioned)

## Open Questions
List any questions that were raised but not resolved. If none, note "No open questions."

## Participants
List the participants who spoke (identifiable from the summaries). Note who seemed to be leading the meeting.

## Sentiment & Engagement
Brief assessment (2-3 sentences) of the meeting's energy and dynamics.

Rules:
- Be thorough — useful for someone who did NOT attend.
- Use actual words and names. Do NOT invent information.
- Merge duplicate topics across chunks. Order by importance, not by chunk order.
- Keep it professional with proper Markdown.`;

export async function summarizeChunk(
	chunkText: string,
	env: Pick<AppEnv, "OPENROUTER_API_KEY" | "OPENROUTER_MODEL" | "OPENROUTER_FREE_MODEL" | "OLLAMA_API_KEY" | "OLLAMA_BASE_URL" | "OLLAMA_MODEL">,
): Promise<string | undefined> {
	return callLLM(chunkText, CHUNK_SUMMARY_PROMPT, env);
}

export async function combineChunkSummaries(
	combinedText: string,
	env: Pick<AppEnv, "OPENROUTER_API_KEY" | "OPENROUTER_MODEL" | "OPENROUTER_FREE_MODEL" | "OLLAMA_API_KEY" | "OLLAMA_BASE_URL" | "OLLAMA_MODEL">,
	customPrompt?: string,
): Promise<string | undefined> {
	const prompt = customPrompt && customPrompt.trim().length > 0 ? customPrompt.trim() : COMBINE_PROMPT;
	return callLLM(combinedText, prompt, env);
}

async function callLLM(
	userContent: string,
	systemPrompt: string,
	env: Pick<AppEnv, "OPENROUTER_API_KEY" | "OPENROUTER_MODEL" | "OPENROUTER_FREE_MODEL" | "OLLAMA_API_KEY" | "OLLAMA_BASE_URL" | "OLLAMA_MODEL">,
): Promise<string | undefined> {
	const openrouterModels = [
		env.OPENROUTER_MODEL || "openrouter/free",
		env.OPENROUTER_FREE_MODEL || "openrouter/free",
	].filter((m, i, arr) => arr.indexOf(m) === i);

	const allProviders: { label: string; run: () => Promise<string | undefined> }[] = [];

	for (const model of openrouterModels) {
		if (!env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY === "placeholder") continue;
		allProviders.push({
			label: `OpenRouter ${model}`,
			run: async () => {
				try {
					const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
						},
						body: JSON.stringify({
							model,
							messages: [
								{ role: "system", content: systemPrompt },
								{ role: "user", content: userContent },
							],
						}),
					});
					if (res.ok) {
						const oj = await res.json() as { choices?: { message?: { content?: string } }[] };
						const c = oj.choices?.[0]?.message?.content;
						if (c) return c;
					} else {
						const err = await res.text();
						console.log(`[summarizer] OpenRouter ${model} ${res.status}: ${err.slice(0, 200)}`);
					}
				} catch (e) {
					console.log(`[summarizer] OpenRouter ${model} error: ${e instanceof Error ? e.message : String(e)}`);
				}
				return undefined;
			},
		});
	}

	if (env.OLLAMA_BASE_URL && env.OLLAMA_API_KEY && env.OLLAMA_API_KEY !== "placeholder") {
		const model = env.OLLAMA_MODEL || "gpt-oss:120b";
		allProviders.push({
			label: `Ollama ${model}`,
			run: async () => {
				try {
					const res = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${env.OLLAMA_API_KEY}`,
						},
						body: JSON.stringify({
							model,
							stream: false,
							messages: [
								{ role: "system", content: systemPrompt },
								{ role: "user", content: userContent },
							],
						}),
					});
					if (res.ok) {
						const oj = await res.json() as { message?: { content?: string } };
						return oj.message?.content;
					}
				} catch (e) {
					console.log(`[summarizer] Ollama error: ${e instanceof Error ? e.message : String(e)}`);
				}
				return undefined;
			},
		});
	}

	for (const provider of allProviders) {
		const result = await provider.run();
		if (result && isValidSummary(result)) {
			return result;
		}
		if (result) {
			console.log(`[summarizer] ${provider.label} produced invalid summary (${result.length} chars), trying next provider`);
		}
	}

	return undefined;
}

function isValidSummary(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length < 100) return false;
	const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
	if (words.length < 30) return false;
	if (!trimmed.includes("##") && !trimmed.includes("# ")) return false;
	return true;
}