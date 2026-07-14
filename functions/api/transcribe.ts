import { getCachedResult, saveCachedResult } from "../lib/kv";
import { jsonResponse } from "../lib/response";
import { checkRateLimit } from "../lib/rate-limit";
import type { AppEnv } from "../lib/env";

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

type Env = Pick<AppEnv, "CF_ACCOUNT_ID" | "CF_API_TOKEN" | "RTK_APP_ID" | "MEETING_CACHE">;

const CHUNK_SIZE = 10 * 1024 * 1024;
const TIME_BUDGET_MS = 25000;
const MAX_TOTAL_SIZE = 1024 * 1024 * 1024;

interface PartialProgress {
	chunkIndex: number;
	transcriptParts: string[];
	totalChunks: number;
	totalSize: number;
}

async function getAudioSize(url: string): Promise<number> {
	const probeRes = await fetch(url, { headers: { Range: "bytes=0-0" } });
	if (probeRes.status === 206) {
		const cr = probeRes.headers.get("content-range");
		if (cr) {
			const match = cr.match(/\/(\d+)$/);
			if (match) return parseInt(match[1]);
		}
	}
	const cl = probeRes.headers.get("content-length");
	return cl ? parseInt(cl) : 0;
}

function isHallucination(text: string): boolean {
	if (!text || text.length === 0) return true;
	const words = text.split(/\s+/).filter((w) => w.length > 0);
	if (words.length === 0) return true;
	const uniqueWords = new Set(words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "")));
	const repetitionRatio = uniqueWords.size / words.length;
	if (repetitionRatio < 0.15) {
		console.log(`[transcribe.ts] Hallucination: word repetition ${repetitionRatio.toFixed(2)} (${uniqueWords.size}/${words.length})`);
		return true;
	}
	const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
	if (sentences.length > 3) {
		const uniqueSentences = new Set(sentences.map((s) => s.trim().toLowerCase()));
		const sRatio = uniqueSentences.size / sentences.length;
		if (sRatio < 0.2) {
			console.log(`[transcribe.ts] Hallucination: sentence repetition ${sRatio.toFixed(2)} (${uniqueSentences.size}/${sentences.length})`);
			return true;
		}
	}
	return false;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	const rl = await checkRateLimit(env.MEETING_CACHE, request);
	if (!rl.allowed) return jsonResponse(429, { error: "Too many requests. Please slow down." });

	const body = await request.json() as { meetingId: string; audioUrl: string };
	console.log("[transcribe.ts] POST — meetingId:", body.meetingId, "audioUrl:", body.audioUrl ? "found" : "none");

	const existing = await getCachedResult(env.MEETING_CACHE, body.meetingId);
	if (existing && existing.transcript) {
		console.log("[transcribe.ts] Cached transcript found — returning, summary:", existing.summary?.length || 0, "chars");
		return jsonResponse(200, {
			status: existing.summary ? "ok" : "transcribed",
			transcript: existing.transcript,
			summary: existing.summary || undefined,
		});
	}

	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
		return jsonResponse(500, { error: "Server missing configuration" });
	}

	const authHeaders = { Authorization: `Bearer ${env.CF_API_TOKEN}` };
	const startTime = Date.now();

	const partialKey = `meeting:${body.meetingId}:partial`;
	let partial: PartialProgress | null = null;
	try {
		const rawPartial = await env.MEETING_CACHE.get(partialKey);
		if (rawPartial) {
			partial = JSON.parse(rawPartial) as PartialProgress;
			console.log("[transcribe.ts] Resuming from chunk", partial.chunkIndex + 1, "/", partial.totalChunks);
		}
	} catch { }

	let transcriptText = "";

	if (body.audioUrl) {
		console.log("[transcribe.ts] Trying Whisper on composite MP3");
		try {
			const totalSize = partial?.totalSize ?? await getAudioSize(body.audioUrl);
			const sizeMb = totalSize / (1024 * 1024);
			console.log("[transcribe.ts] Composite size:", sizeMb.toFixed(1), "MB");

			if (totalSize === 0) {
				return jsonResponse(200, { status: "error", error: "Could not determine audio file size" });
			}

			if (totalSize > MAX_TOTAL_SIZE) {
				return jsonResponse(200, {
					status: "too_large",
					sizeMb: sizeMb.toFixed(1),
					message: `Audio file is ${sizeMb.toFixed(1)} MB (max ${MAX_TOTAL_SIZE / 1024 / 1024} MB). Download the audio recording below and transcribe it manually.`,
				});
			}

			const numChunks = Math.ceil(totalSize / CHUNK_SIZE);
			const chunkTranscripts: string[] = [...(partial?.transcriptParts || [])];
			let startChunk = partial?.chunkIndex ?? 0;
			let chunksDone = 0;
			let hallucinationCount = 0;

			console.log("[transcribe.ts] Will process chunks", startChunk + 1, "to", numChunks, "of", CHUNK_SIZE / (1024 * 1024), "MB each");

			for (let i = startChunk; i < numChunks; i++) {
				const elapsed = Date.now() - startTime;
				if (elapsed > TIME_BUDGET_MS) {
					console.log("[transcribe.ts] Time budget exceeded at chunk", i + 1, "/", numChunks, "— saving partial progress");
					const progress: PartialProgress = {
						chunkIndex: i,
						transcriptParts: chunkTranscripts,
						totalChunks: numChunks,
						totalSize,
					};
					try {
						await env.MEETING_CACHE.put(partialKey, JSON.stringify(progress));
					} catch { }

					if (chunkTranscripts.length > 0) {
						const partialText = chunkTranscripts.join("\n\n");
						await saveCachedResult(env.MEETING_CACHE, body.meetingId, { transcript: partialText, summary: "", cachedAt: new Date().toISOString() });
						return jsonResponse(200, {
							status: "processing",
							message: `Transcribed ${i}/${numChunks} chunks so far. Continue polling for the rest.`,
							transcript: partialText,
							chunksDone: i,
							totalChunks: numChunks,
						});
					}
					return jsonResponse(200, {
						status: "processing",
						message: `Processing chunk ${i + 1}/${numChunks}. Continue polling.`,
						chunksDone: i,
						totalChunks: numChunks,
					});
				}

				const start = i * CHUNK_SIZE;
				const end = Math.min(start + CHUNK_SIZE - 1, totalSize - 1);
				const chunkMb = (end - start + 1) / (1024 * 1024);
				console.log(`[transcribe.ts] Chunk ${i + 1}/${numChunks} — bytes ${start}-${end} (${chunkMb.toFixed(1)} MB)`);

				try {
					const chunkRes = await fetch(body.audioUrl, { headers: { Range: `bytes=${start}-${end}` } });
					if (!chunkRes.ok) {
						console.log(`[transcribe.ts] Chunk ${i + 1} download failed:`, chunkRes.status);
						continue;
					}

					const chunkBuffer = await chunkRes.arrayBuffer();
					const chunkText = await transcribeChunk(env, authHeaders, chunkBuffer, `chunk ${i + 1}/${numChunks}`);

					if (chunkText) {
						chunkTranscripts.push(chunkText);
						console.log(`[transcribe.ts] Chunk ${i + 1} transcript:`, chunkText.length, "chars");
					} else {
						console.log(`[transcribe.ts] Chunk ${i + 1} produced no transcript (hallucination or silent)`);
						hallucinationCount++;
					}
					chunksDone++;
				} catch (e) {
					console.log(`[transcribe.ts] Chunk ${i + 1} error:`, e instanceof Error ? e.message : String(e));
				}
			}

			try { await env.MEETING_CACHE.delete(partialKey); } catch { }

			if (chunkTranscripts.length > 0) {
				transcriptText = chunkTranscripts.join("\n\n");
				console.log("[transcribe.ts] Merged", chunkTranscripts.length, "/", chunksDone, "chunk transcripts, total:", transcriptText.length, "chars");
			} else {
				console.log(`[transcribe.ts] All ${numChunks} chunks produced no transcript (${hallucinationCount} hallucinations) — audio is likely silent`);
				return jsonResponse(200, {
					status: "silent",
					sizeMb: sizeMb.toFixed(1),
					numChunks,
					message: `No speech detected in the recording (${sizeMb.toFixed(1)} MB, ${numChunks} chunks analyzed). The audio appears to be silent or contains only background noise. This usually means the microphone was muted or not connected during the meeting.`,
				});
			}
		} catch (e) {
			console.log("[transcribe.ts] Composite error:", e instanceof Error ? e.message : String(e));
			return jsonResponse(200, { status: "error", error: e instanceof Error ? e.message : String(e) });
		}
	}

	if (transcriptText.trim().length === 0) {
		return jsonResponse(200, { status: "silent", message: "No speech detected in any audio source. The recording may be silent." });
	}

	transcriptText = dedupeTranscript(transcriptText);

	await saveCachedResult(env.MEETING_CACHE, body.meetingId, { transcript: transcriptText, summary: "", cachedAt: new Date().toISOString() });
	try { await env.MEETING_CACHE.delete(partialKey); } catch { }

	console.log("[transcribe.ts] Done — transcript:", transcriptText.length, "chars");
	return jsonResponse(200, {
		status: "transcribed",
		transcript: transcriptText,
	});
};

async function transcribeChunk(env: Env, authHeaders: Record<string, string>, audioBuffer: ArrayBuffer, label: string): Promise<string | undefined> {
	try {
		const whisperRes = await fetch(
			`${RTK_BASE}/${env.CF_ACCOUNT_ID}/ai/run/@cf/openai/whisper-large-v3-turbo`,
			{
				method: "POST",
				headers: { ...authHeaders, "Content-Type": "audio/mpeg" },
				body: audioBuffer,
			}
		);

		if (whisperRes.ok) {
			const wj = await whisperRes.json() as { result?: { text?: string } };
			const wt = wj.result?.text?.trim();
			console.log(`[transcribe.ts] Whisper ${label}:`, wt?.length || 0, "chars");

			if (wt && wt.length > 0) {
				if (isHallucination(wt)) {
					console.log(`[transcribe.ts] ${label} — hallucination detected, skipping`);
					return undefined;
				}
				return wt;
			}
		} else {
			const errText = await whisperRes.text();
			console.log(`[transcribe.ts] Whisper ${label} failed:`, whisperRes.status, errText.slice(0, 200));
		}
	} catch (e) {
		console.log(`[transcribe.ts] Whisper ${label} error:`, e instanceof Error ? e.message : String(e));
	}
	return undefined;
}

function dedupeTranscript(text: string): string {
	const lines = text.split("\n");
	const seen = new Set<string>();
	const out: string[] = [];
	let consecutiveDupes = 0;
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			out.push(line);
			continue;
		}
		const key = trimmed.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 60);
		if (seen.has(key)) {
			consecutiveDupes++;
			if (consecutiveDupes > 2) continue;
		} else {
			consecutiveDupes = 0;
		}
		seen.add(key);
		out.push(line);
	}
	const result = out.join("\n");
	console.log("[transcribe.ts] Dedupe: removed", text.length - result.length, "chars of repetition");
	return result;
}