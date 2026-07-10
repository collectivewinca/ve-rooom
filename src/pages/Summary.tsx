import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { getSummary, transcribeAudio, generateSummaryFromTranscript, type SummaryResponse } from "../lib/api";

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
				} else {
					setLoading(false);
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
			const result = await transcribeAudio(roomId, summaryData.audioRecordingUrl || "", summaryData.trackFiles);

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
			} else if (result.status === "too_large") {
				setTranscribeStatus(result.message || "Audio too large for Workers AI (25MB limit). Download manually.");
			} else if (result.status === "no_speech") {
				setTranscribeStatus("No speech detected in the audio.");
				setData({ ...summaryData, status: "ok", summary: "## Meeting Summary\n\nNo speech was detected in this meeting.\n\nDownload the recording below to verify." });
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

	const hasDownloads = data?.transcriptUrl || data?.transcript_text || data?.recordingUrl || data?.audioRecordingUrl || (data?.trackFiles && data.trackFiles.length > 0);
	const showSummary = (data?.status === "ok" && !!data.summary) || (data?.status === "needs_transcription" && !!data.summary);
	const showBlur = data && data.status !== "no_ended_session" && data.status !== "error" && !showSummary;

	return (
		<div className="summary-page">
			<div className="summary-header">
				<h1>Meeting Summary</h1>
				<button className="btn-secondary" onClick={() => navigate("/")} style={{ width: "auto", margin: 0 }}>
					New Meeting
				</button>
			</div>

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
					{data.trackFiles && data.trackFiles.length > 0 && <div className="debug-row"><span className="debug-label">Track Files</span><span className="debug-value ok">{data.trackFiles.length} files</span></div>}
					{!data.trackFiles && <div className="debug-row"><span className="debug-label">Track Files</span><span className="debug-value warn">none</span></div>}
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
						{data?.trackFiles?.map((track, i) => (
							<a key={i} href={track.downloadUrl} target="_blank" rel="noreferrer" className="download-card">
								<div className="download-card-icon" style={{ background: "rgba(251, 191, 36, 0.15)" }}>
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
										<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
										<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
									</svg>
								</div>
								<div className="download-card-info">
									<div className="download-card-title">Participant {i + 1}</div>
									<div className="download-card-subtitle">{track.userId.slice(0, 8)}… · WebM</div>
								</div>
							</a>
						))}
					</div>
				</div>
			)}

			<div className={`summary-body-wrap ${showBlur ? "blurred" : ""}`}>
				{showSummary && (
					<div className="summary-content">
						<ReactMarkdown>{data.summary}</ReactMarkdown>
					</div>
				)}

				{!showSummary && data?.status === "no_summary" && (
					<div className="empty-state">
						<img src="/favicon.svg" alt="VE Rooom" className="empty-state-icon" />
						<h3>No summary available</h3>
						<p>{data.error || "The transcript exists but no summary could be generated."} You can still download the transcript and recording below.</p>
					</div>
				)}

			</div>

			{showBlur && (
				<div className="summary-overlay">
					<div className="summary-overlay-inner">
						<h2>Summary coming soon</h2>
						{loading && data?.status === "processing" && (
							<p className="summary-overlay-sub">Transcription in progress (poll #{pollCount})...</p>
						)}
						{data?.status === "needs_transcription" && (
							<p className="summary-overlay-sub">Auto-transcription running. If it fails, download the audio from the Downloads section above.</p>
						)}
					</div>
				</div>
			)}
		</div>
	);
}