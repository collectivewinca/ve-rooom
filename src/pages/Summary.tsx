import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	getSummary, transcribeAudio, generateSummaryFromTranscript, scanR2Recordings,
	getMeetingPrompt, saveMeetingPrompt, saveUserDefaultPrompt, getUserDefaultPrompt,
	type SummaryResponse, type SummaryVersion,
} from "../lib/api";

const DEFAULT_PROMPT = `You are an expert meeting analyst and executive assistant. Your job is to analyze a meeting transcript and produce a comprehensive, well-structured Markdown summary.

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

function generateTranscriptCsvUrl(text: string): string {
	const lines = text.split("\n");
	const csvLines = ['"Line","Text"'];
	lines.forEach((line, i) => {
		if (!line.trim()) return;
		const escaped = line.replace(/"/g, '""');
		csvLines.push(`${i + 1},"${escaped}"`);
	});
	return `data:text/csv;charset=utf-8,${encodeURIComponent(csvLines.join("\n"))}`;
}

export default function Summary() {
	const { roomId } = useParams<{ roomId: string }>();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const showDebug = searchParams.get("debug") === "true";
	const [data, setData] = useState<SummaryResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [pollCount, setPollCount] = useState(0);
	const pollRef = useRef(0);
	const [pollTimedOut, setPollTimedOut] = useState(false);
	const [transcribing, setTranscribing] = useState(false);
	const [transcribeStatus, setTranscribeStatus] = useState("");
	const transcribingRef = useRef(false);
	const [resummarizing, setResummarizing] = useState(false);
	const [resummarizeStatus, setResummarizeStatus] = useState("");

	const [promptText, setPromptText] = useState("");
	const [showPromptEditor, setShowPromptEditor] = useState(false);
	const [promptDirty, setPromptDirty] = useState(false);
	const [savingPrompt, setSavingPrompt] = useState(false);
	const [promptSaveStatus, setPromptSaveStatus] = useState("");
	const [versionIndex, setVersionIndex] = useState(-1);

	const history = data?.history || [];
	const totalVersions = history.length;
	const currentVersion = versionIndex >= 0 && versionIndex < totalVersions ? versionIndex : totalVersions - 1;
	const displayedSummary = currentVersion >= 0 ? history[currentVersion]?.summary : data?.summary;

	const hasTranscript = !!data?.transcript_text && data.transcript_text.trim().length > 0;

	const regenerateSummary = useCallback(async (overridePrompt?: string) => {
		if (!roomId || !data?.transcript_text || resummarizing) return;
		setResummarizing(true);
		setResummarizeStatus("Generating AI summary...");
		try {
			const promptToSend = overridePrompt !== undefined ? overridePrompt : (promptDirty ? promptText : undefined);
			const result = await generateSummaryFromTranscript(data.transcript_text, roomId, promptToSend);
			if (result.status === "ok" && result.summary) {
				setResummarizeStatus("Summary generated!");
				const newVersion: SummaryVersion = { summary: result.summary, prompt: promptToSend, createdAt: new Date().toISOString() };
				setData((prev) => {
					if (!prev) return prev;
					const prevHistory = prev.history || [];
					const updated = { ...prev, status: "ok" as const, summary: result.summary, history: [...prevHistory, newVersion] };
					return updated;
				});
				setVersionIndex(-1);
			} else {
				setResummarizeStatus(result.message || "Summary generation failed. Please try again.");
			}
		} catch (e) {
			setResummarizeStatus("Failed: " + (e instanceof Error ? e.message : String(e)));
		} finally {
			setResummarizing(false);
		}
	}, [roomId, data, resummarizing, promptDirty, promptText]);

	const handleSaveMeetingPrompt = useCallback(async () => {
		if (!roomId || !promptText.trim()) return;
		setSavingPrompt(true);
		setPromptSaveStatus("");
		const ok = await saveMeetingPrompt(roomId, promptText.trim());
		if (ok) {
			setPromptDirty(false);
			setPromptSaveStatus("Saved as meeting prompt");
		} else {
			setPromptSaveStatus("Failed to save (only the meeting creator can set this)");
		}
		setSavingPrompt(false);
		setTimeout(() => setPromptSaveStatus(""), 3000);
	}, [roomId, promptText]);

	const handleSaveUserPrompt = useCallback(async () => {
		if (!promptText.trim()) return;
		setSavingPrompt(true);
		setPromptSaveStatus("");
		const ok = await saveUserDefaultPrompt(promptText.trim());
		if (ok) {
			setPromptDirty(false);
			setPromptSaveStatus("Saved as your default prompt");
		} else {
			setPromptSaveStatus("Failed to save");
		}
		setSavingPrompt(false);
		setTimeout(() => setPromptSaveStatus(""), 3000);
	}, [promptText]);

	const handleResetPrompt = useCallback(() => {
		setPromptText(DEFAULT_PROMPT);
		setPromptDirty(true);
	}, []);

	useEffect(() => {
		if (!roomId) return;
		let cancelled = false;
		let timerId: ReturnType<typeof setTimeout> | undefined;
		const MAX_POLLS = 60;

		async function poll() {
			pollRef.current += 1;
			const currentPoll = pollRef.current;
			setPollCount(currentPoll);
			try {
				const res = await getSummary(roomId!);
				if (cancelled) return;
				setData(res);

				if (res.status === "processing") {
					if (currentPoll >= MAX_POLLS) {
						setPollTimedOut(true);
						setLoading(false);
						return;
					}
					timerId = setTimeout(poll, 5000);
				} else if (res.status === "needs_transcription") {
					setLoading(false);
					if (!transcribingRef.current && res.audioRecordingUrl) {
						triggerTranscription(res);
					}
				} else if (res.status === "no_ended_session") {
					setLoading(true);
					if (currentPoll >= MAX_POLLS) {
						setPollTimedOut(true);
						setLoading(false);
						return;
					}
					timerId = setTimeout(poll, 5000);
				} else {
					setLoading(false);
					if (!res.recordingUrl && !res.audioRecordingUrl) {
						scanR2Recordings(roomId!).then((refs) => {
							if (refs.length > 0 && !cancelled) {
								setData((prev) => prev ? {
									...prev,
									recordingUrl: prev.recordingUrl || refs.find((r) => r.type === "composite")?.url,
									audioRecordingUrl: prev.audioRecordingUrl || refs.find((r) => r.type === "audio")?.url,
									r2Recordings: refs,
								} : prev);
							}
						}).catch(() => {});
					}
				}
			} catch (e) {
				if (cancelled) return;
				setError(e instanceof Error ? e.message : "Failed to load summary");
				setLoading(false);
			}
		}

		poll();
		return () => {
			cancelled = true;
			if (timerId) clearTimeout(timerId);
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [roomId]);

	useEffect(() => {
		if (!roomId) return;
		let cancelled = false;
		async function loadPrompt() {
			const mp = await getMeetingPrompt(roomId!);
			if (cancelled) return;
			if (mp) {
				setPromptText(mp);
				return;
			}
			if (data?.prompt) {
				setPromptText(data.prompt);
				return;
			}
			const up = await getUserDefaultPrompt();
			if (cancelled) return;
			if (up) {
				setPromptText(up);
			} else {
				setPromptText(DEFAULT_PROMPT);
			}
		}
		loadPrompt();
		return () => { cancelled = true; };
	}, [roomId, data?.prompt]);

	async function triggerTranscription(summaryData: SummaryResponse) {
		if (!roomId || transcribingRef.current) return;
		transcribingRef.current = true;
		setTranscribing(true);

		if (summaryData.transcript_text) {
			setTranscribeStatus("Transcript cached! Generating AI summary...");
			try {
				const summaryResult = await generateSummaryFromTranscript(summaryData.transcript_text, roomId);
				if (summaryResult.status === "ok" && summaryResult.summary) {
					setTranscribeStatus("Summary generated!");
					setData({ ...summaryData, status: "ok", summary: summaryResult.summary });
				} else {
					setTranscribeStatus("Summary generation failed. Transcript is available below.");
					setData({ ...summaryData, status: "ok", summary: "## Meeting Summary\n\nAI summary generation failed, but the transcript is available below.\n\nDownload the full transcript to read the meeting content." });
				}
			} catch (e) {
				setTranscribeStatus("Summary generation failed: " + (e instanceof Error ? e.message : String(e)));
			}
			setTranscribing(false);
			transcribingRef.current = false;
			return;
		}

		setTranscribeStatus("Downloading audio and running Whisper transcription...");
		try {
			const result = await transcribeAudio(roomId, summaryData.audioRecordingUrl || "");

			if (result.status === "transcribed" && result.transcript) {
				setTranscribeStatus("Transcript ready! Generating AI summary...");
				setData({ ...summaryData, transcript_text: result.transcript });

				const summaryResult = await generateSummaryFromTranscript(result.transcript, roomId);

				if (summaryResult.status === "ok" && summaryResult.summary) {
					setTranscribeStatus("Summary generated!");
					setData({
						...summaryData,
						status: "ok",
						summary: summaryResult.summary,
						transcript_text: result.transcript,
					});
				} else {
					setTranscribeStatus("Transcript ready but summary generation failed. You can read the transcript below.");
					setData({
						...summaryData,
						status: "ok",
						summary: "## Meeting Summary\n\nAI summary generation failed, but the transcript is available below.\n\nDownload the full transcript to read the meeting content.",
						transcript_text: result.transcript,
					});
				}
			} else if (result.status === "processing") {
				setTranscribeStatus(`Processing audio... ${result.chunksDone || 0}/${result.totalChunks || "?"} chunks done. Retrying...`);
				setTimeout(() => {
					transcribingRef.current = false;
					triggerTranscription(summaryData);
				}, 3000);
				return;
			} else if (result.status === "silent") {
				setTranscribeStatus(result.message || "The recording appears to be silent. No speech was detected.");
				setData({ ...summaryData, status: "silent", summary: `## Silent Recording\n\n${result.message || "No speech was detected in this meeting recording."}\n\nThis usually means the microphone was muted or not connected during the meeting. Download the recording below to verify.` });
			} else if (result.status === "too_large") {
				setTranscribeStatus(result.message || "Audio too large for automatic transcription. Download manually.");
			} else if (result.status === "no_speech") {
				setTranscribeStatus("No speech detected in the audio.");
				setData({ ...summaryData, status: "silent", summary: "## Silent Recording\n\nNo speech was detected in this meeting.\n\nDownload the recording below to verify." });
			} else if (result.status === "whisper_failed") {
				setTranscribeStatus(result.message || "Whisper transcription failed.");
			} else {
				setTranscribeStatus("Transcription failed. Download the recording to transcribe manually.");
			}
		} catch (e) {
			setTranscribeStatus("Transcription failed: " + (e instanceof Error ? e.message : String(e)));
		} finally {
			setTranscribing(false);
			transcribingRef.current = false;
		}
	}

	const hasDownloads = data?.transcriptUrl || data?.transcript_text || data?.recordingUrl || data?.audioRecordingUrl;
	const showSummary = !!displayedSummary && ((data?.status === "ok") || (data?.status === "silent"));
	const showLoadingState = data && (data.status === "processing" || data.status === "needs_transcription") && !showSummary;
	const showNoSummary = data?.status === "no_summary" || (data?.status === "ok" && (!data.summary || data.summary.trim().length < 50) && totalVersions === 0);
	const showRegenerateBar = hasTranscript && data && data.status !== "no_ended_session" && data.status !== "processing";

	return (
		<div className="summary-page">
			<div className="summary-header">
				<h1>Meeting Summary</h1>
				<button className="btn-secondary" onClick={() => navigate("/")} style={{ width: "auto", margin: 0 }}>
					New Meeting
				</button>
			</div>

			{showRegenerateBar && (
				<div className="summary-toolbar">
					<button
						className="btn-secondary"
						onClick={() => regenerateSummary()}
						disabled={resummarizing || transcribing}
						style={{ width: "auto", margin: 0 }}
					>
						{resummarizing ? "Generating..." : "Re-generate Summary"}
					</button>
					<button
						className="btn-outline"
						onClick={() => setShowPromptEditor((v) => !v)}
						style={{ width: "auto", margin: 0 }}
					>
						{showPromptEditor ? "Hide Prompt" : "Customize Prompt"}
					</button>
					{resummarizeStatus && (
						<span className="toolbar-status">{resummarizeStatus}</span>
					)}
				</div>
			)}

			{showRegenerateBar && showPromptEditor && (
				<div className="prompt-editor">
					<div className="prompt-editor-header">
						<span className="prompt-editor-label">Summary Prompt</span>
						<span className="prompt-editor-hint">{promptDirty ? "Unsaved changes" : "Saved"}</span>
					</div>
					<textarea
						className="prompt-textarea"
						value={promptText}
						onChange={(e) => { setPromptText(e.target.value); setPromptDirty(true); }}
						rows={12}
						placeholder="Enter your custom summary prompt..."
					/>
					<div className="prompt-editor-actions">
						<button
							className="btn-secondary"
							onClick={() => regenerateSummary(promptText)}
							disabled={resummarizing || !promptText.trim()}
							style={{ width: "auto", margin: 0 }}
						>
							{resummarizing ? "Generating..." : "Generate with this prompt"}
						</button>
						<button
							className="btn-outline"
							onClick={handleSaveMeetingPrompt}
							disabled={savingPrompt || !promptDirty}
							style={{ width: "auto", margin: 0 }}
						>
							{savingPrompt ? "Saving..." : "Save for this meeting"}
						</button>
						<button
							className="btn-outline"
							onClick={handleSaveUserPrompt}
							disabled={savingPrompt || !promptDirty}
							style={{ width: "auto", margin: 0 }}
						>
							{savingPrompt ? "Saving..." : "Save as my default"}
						</button>
						<button
							className="btn-outline"
							onClick={handleResetPrompt}
							style={{ width: "auto", margin: 0 }}
						>
							Reset to default
						</button>
						{promptSaveStatus && <span className="prompt-save-status">{promptSaveStatus}</span>}
					</div>
				</div>
			)}

			{loading && !data && (
				<>
					<div className="skeleton" style={{ height: 24, width: "60%", marginBottom: "1.5rem" }} />
					<div className="skeleton" style={{ height: 16, width: "90%", marginBottom: "0.75rem" }} />
					<div className="skeleton" style={{ height: 16, width: "75%", marginBottom: "0.75rem" }} />
					<div className="skeleton" style={{ height: 16, width: "85%", marginBottom: "2rem" }} />
					<div className="skeleton" style={{ height: 200 }} />
				</>
			)}

			{pollTimedOut && (
				<div className="status-info">
					Transcription is taking longer than expected. The audio recording is available below — you can transcribe it manually.
				</div>
			)}

			{data?.status === "no_ended_session" && (
				<div className="empty-state">
					<img src="/favicon.svg" alt="VE Rooom" className="empty-state-icon" />
					<h3>No ended session yet</h3>
					<p>This meeting hasn't ended or no session was found. Start a meeting, talk, then come back after it ends.</p>
					<Link to="/" className="btn-outline" style={{ display: "inline-flex" }}>Go Home</Link>
				</div>
			)}

			{transcribeStatus && (
				<div className="transcribe-status">
					{transcribing && <div className="spinner" style={{ width: 20, height: 20, display: "inline-block", marginRight: 8, border: "2px solid rgba(251,191,36,0.2)", borderTopColor: "var(--color-primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite", verticalAlign: "middle" }} />}
					{transcribeStatus}
				</div>
			)}

			{showDebug && data && data.status !== "ok" && data.status !== "no_ended_session" && (
				<div className="summary-debug">
					<h4>Summary Flow Status</h4>
					<div className="debug-row"><span className="debug-label">API Status</span><span className="debug-value">{data.status}</span></div>
					{data.sessionId && <div className="debug-row"><span className="debug-label">Session ID</span><span className="debug-value mono">{data.sessionId.slice(0, 12)}</span></div>}
					{data.transcriptUrl && <div className="debug-row"><span className="debug-label">CF Transcript</span><span className="debug-value ok">URL found</span></div>}
					{!data.transcriptUrl && <div className="debug-row"><span className="debug-label">CF Transcript</span><span className="debug-value warn">empty</span></div>}
					{data.recordingUrl && <div className="debug-row"><span className="debug-label">Composite Recording</span><span className="debug-value ok">UPLOADED</span></div>}
				{data.audioRecordingUrl && <div className="debug-row"><span className="debug-label">Audio MP3</span><span className="debug-value ok">available</span></div>}
				{data.transcript_text && <div className="debug-row"><span className="debug-label">Transcript Text</span><span className="debug-value ok">{data.transcript_text.length} chars</span></div>}
					{!data.transcript_text && <div className="debug-row"><span className="debug-label">Transcript Text</span><span className="debug-value warn">empty</span></div>}
					{data.error && <div className="debug-row"><span className="debug-label">Error</span><span className="debug-value err">{data.error}</span></div>}
				</div>
			)}

			{data?.status === "error" && (
				<div className="error">{data.error || "Failed to load summary"}</div>
			)}

			{error && <div className="error">{error}</div>}

			{hasDownloads && (
				<div className="download-section">
					<h3>Downloads</h3>
					<div className="download-grid">
						{data?.transcript_text && data.transcript_text.trim().length > 0 ? (
							<>
								<a href={generateTranscriptCsvUrl(data.transcript_text)} download="transcript.csv" className="download-card">
									<div className="download-card-icon" style={{ background: "rgba(34, 197, 94, 0.15)" }}>
										<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
											<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
											<polyline points="14 2 14 8 20 8"/>
										</svg>
									</div>
									<div className="download-card-info">
										<div className="download-card-title">Transcript</div>
										<div className="download-card-subtitle">CSV file</div>
									</div>
								</a>
								<a href={`data:text/plain;charset=utf-8,${encodeURIComponent(data.transcript_text)}`} download="transcript.txt" className="download-card">
									<div className="download-card-icon" style={{ background: "rgba(34, 197, 94, 0.15)" }}>
										<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
											<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
											<polyline points="14 2 14 8 20 8"/>
										</svg>
									</div>
									<div className="download-card-info">
										<div className="download-card-title">Transcript</div>
										<div className="download-card-subtitle">Text file</div>
									</div>
								</a>
							</>
						) : data?.transcriptUrl && (
							<a href={data.transcriptUrl} target="_blank" rel="noreferrer" className="download-card">
								<div className="download-card-icon" style={{ background: "rgba(34, 197, 94, 0.15)" }}>
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
										<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
										<polyline points="14 2 14 8 20 8"/>
									</svg>
								</div>
								<div className="download-card-info">
									<div className="download-card-title">Transcript</div>
									<div className="download-card-subtitle">CSV file</div>
								</div>
							</a>
						)}
						{data?.recordingUrl && (
							<a href={data.recordingUrl} target="_blank" rel="noreferrer" className="download-card">
								<div className="download-card-icon" style={{ background: "rgba(99, 102, 241, 0.15)" }}>
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
										<polygon points="23 7 16 12 23 17 23 7"/>
										<rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
									</svg>
								</div>
								<div className="download-card-info">
									<div className="download-card-title">Recording</div>
									<div className="download-card-subtitle">MP4 video</div>
								</div>
							</a>
						)}
						{data?.audioRecordingUrl && (
							<a href={data.audioRecordingUrl} target="_blank" rel="noreferrer" className="download-card">
								<div className="download-card-icon" style={{ background: "rgba(236, 72, 153, 0.15)" }}>
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
										<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
										<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
									</svg>
								</div>
								<div className="download-card-info">
									<div className="download-card-title">Audio Only</div>
									<div className="download-card-subtitle">MP3 file</div>
								</div>
							</a>
						)}
					</div>
				</div>
			)}

			<div className="summary-body-wrap">
				{showSummary && (
					<>
					{totalVersions >= 1 && (
						<div className="version-nav">
							<button
								className="version-arrow"
								onClick={() => setVersionIndex((i) => Math.max(0, i < 0 ? totalVersions - 2 : i - 1))}
								disabled={currentVersion <= 0}
								aria-label="Previous version"
							>
								<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
							</button>
							<span className="version-label">
								Version {currentVersion + 1} / {totalVersions}
							</span>
							<button
								className="version-arrow"
								onClick={() => setVersionIndex((i) => Math.min(totalVersions - 1, i < 0 ? totalVersions - 1 : i + 1))}
								disabled={currentVersion >= totalVersions - 1}
								aria-label="Next version"
							>
								<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
							</button>
							{currentVersion < totalVersions - 1 && (
								<button className="version-latest" onClick={() => setVersionIndex(-1)}>
									Jump to latest
								</button>
							)}
						</div>
					)}
						<div className="summary-content">
							<ReactMarkdown remarkPlugins={[remarkGfm]}>{displayedSummary}</ReactMarkdown>
						</div>
					</>
				)}

				{showLoadingState && (
					<div className="summary-loading-state">
						<div className="summary-loading-spinner" />
						<h2>Summary coming soon</h2>
						{data?.status === "processing" && (
							<p className="summary-loading-sub">Transcription in progress (poll #{pollCount})...</p>
						)}
						{data?.status === "needs_transcription" && (
							<p className="summary-loading-sub">Auto-transcription running. If the recording is silent, you'll see a message below. Otherwise, download the audio from the Downloads section.</p>
						)}
					</div>
				)}

				{showNoSummary && (
					<div className="empty-state">
						<img src="/favicon.svg" alt="VE Rooom" className="empty-state-icon" />
						<h3>No summary available</h3>
						<p>{data?.error || "The transcript exists but no summary could be generated."} You can still download the transcript and recording below.</p>
					</div>
				)}

			</div>
		</div>
	);
}