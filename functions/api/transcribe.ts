import { getCachedResult } from "../lib/kv";

interface Env {
	CF_ACCOUNT_ID: string;
	CF_API_TOKEN: string;
	RTK_APP_ID: string;
	MEETING_CACHE: KVNamespace;
}

const RTK_BASE = "https://api.cloudflare.com/client/v4/accounts";

const CHUNK_SIZE = 20 * 1024 * 1024;

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

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	const body = await request.json() as { meetingId: string; audioUrl: string; trackFiles?: { filename: string; downloadUrl: string; userId: string; peerId: string }[] };
	console.log("[transcribe.ts] POST — meetingId:", body.meetingId, "audioUrl:", body.audioUrl ? "found" : "none", "trackFiles:", body.trackFiles?.length || 0);

	if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
		return jsonResponse(500, { error: "Server missing configuration" });
	}

	const authHeaders = {
		Authorization: `Bearer ${env.CF_API_TOKEN}`,
	};

	let transcriptText = "";

	if (body.trackFiles && body.trackFiles.length > 0) {
		console.log("[transcribe.ts] Trying Whisper on", body.trackFiles.length, "track files");
		const participantTranscripts: string[] = [];

		for (const track of body.trackFiles) {
			try {
				const trackSize = await getAudioSize(track.downloadUrl);
				const sizeMb = trackSize / (1024 * 1024);
				console.log("[transcribe.ts] Track", track.userId, "size:", sizeMb.toFixed(1), "MB");
				if (sizeMb > 25) {
					console.log("[transcribe.ts] Track too large, skipping");
					continue;
				}

				const audioRes = await fetch(track.downloadUrl, {
					headers: { Range: `bytes=0-${trackSize - 1}` },
				});
				if (!audioRes.ok) continue;
				const audioBuffer = await audioRes.arrayBuffer();
				const whisperRes = await fetch(
					`${RTK_BASE}/${env.CF_ACCOUNT_ID}/ai/run/@cf/openai/whisper`,
					{
						method: "POST",
						headers: { ...authHeaders, "Content-Type": "audio/webm" },
						body: audioBuffer,
					}
				);

				if (whisperRes.ok) {
					const wj = await whisperRes.json() as { result?: { text?: string } };
					const wt = wj.result?.text?.trim();
					console.log("[transcribe.ts] Track", track.userId, "transcript:", wt?.length || 0, "chars");
					if (wt && wt.length > 50) {
						const fp = wt.split(".")[0];
						const pc = (wt.match(new RegExp(fp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.?", "g")) || []).length;
						if (!(pc > 3 && wt.length < 200)) {
							participantTranscripts.push(`[Participant ${track.userId}]: ${wt}`);
						}
					}
				}
			} catch (e) {
				console.log("[transcribe.ts] Track error:", e instanceof Error ? e.message : String(e));
			}
		}
		if (participantTranscripts.length > 0) {
			transcriptText = participantTranscripts.join("\n\n");
		}
	}

	if (transcriptText.trim().length === 0 && body.audioUrl) {
		console.log("[transcribe.ts] Trying Whisper on composite MP3");
		try {
			const totalSize = await getAudioSize(body.audioUrl);
			const sizeMb = totalSize / (1024 * 1024);
			console.log("[transcribe.ts] Composite size:", sizeMb.toFixed(1), "MB");

			if (totalSize === 0) {
				return jsonResponse(200, { status: "error", error: "Could not determine audio file size" });
			}

			const numChunks = Math.ceil(totalSize / CHUNK_SIZE);
			console.log("[transcribe.ts] Will fetch", numChunks, "chunks of", CHUNK_SIZE / (1024 * 1024), "MB each");

			const chunkTranscripts: string[] = [];
			let chunksDone = 0;

			for (let i = 0; i < numChunks; i++) {
				const start = i * CHUNK_SIZE;
				const end = Math.min(start + CHUNK_SIZE - 1, totalSize - 1);
				const chunkMb = (end - start + 1) / (1024 * 1024);
				console.log(`[transcribe.ts] Chunk ${i + 1}/${numChunks} — bytes ${start}-${end} (${chunkMb.toFixed(1)} MB)`);

				try {
					const chunkRes = await fetch(body.audioUrl, {
						headers: { Range: `bytes=${start}-${end}` },
					});

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
						console.log(`[transcribe.ts] Chunk ${i + 1} produced no transcript`);
					}
					chunksDone++;
				} catch (e) {
					console.log(`[transcribe.ts] Chunk ${i + 1} error:`, e instanceof Error ? e.message : String(e));
				}
			}

			if (chunkTranscripts.length > 0) {
				transcriptText = chunkTranscripts.join("\n\n");
				console.log("[transcribe.ts] Merged", chunkTranscripts.length, "/", chunksDone, "chunk transcripts, total:", transcriptText.length, "chars");
			} else {
				console.log("[transcribe.ts] All chunks failed — returning too_large");
				return jsonResponse(200, {
					status: "too_large",
					sizeMb: sizeMb.toFixed(1),
					message: `Audio file is ${sizeMb.toFixed(1)} MB (${numChunks} chunks). Chunked transcription failed — download the audio recording below and transcribe it manually.`,
				});
			}
		} catch (e) {
			console.log("[transcribe.ts] Composite error:", e instanceof Error ? e.message : String(e));
			return jsonResponse(200, { status: "error", error: e instanceof Error ? e.message : String(e) });
		}
	}

	if (transcriptText.trim().length === 0) {
		return jsonResponse(200, { status: "no_speech", message: "No speech detected in any audio source." });
	}

	transcriptText = dedupeTranscript(transcriptText);

	const cached = await getCachedResult(env.MEETING_CACHE, body.meetingId);

	console.log("[transcribe.ts] Done — transcript:", transcriptText.length, "chars, cached summary:", cached?.summary?.length || 0, "chars");
	return jsonResponse(200, {
		status: cached?.summary ? "ok" : "transcribed",
		transcript: transcriptText,
		summary: cached?.summary,
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
				const fp = wt.split(".")[0];
				if (fp && fp.length < 30) {
					const pc = (wt.match(new RegExp(fp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.?", "g")) || []).length;
					if (pc > 3 && wt.length < 200) {
						console.log(`[transcribe.ts] ${label} — hallucination detected, skipping`);
						return undefined;
					}
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

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}