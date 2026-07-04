import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { getSummary, type SummaryResponse } from "../lib/api";

export default function Summary() {
	const { roomId } = useParams<{ roomId: string }>();
	const navigate = useNavigate();
	const [data, setData] = useState<SummaryResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [pollCount, setPollCount] = useState(0);
	const [pollTimedOut, setPollTimedOut] = useState(false);

	console.log("[Summary] Render — roomId:", roomId, "status:", data?.status, "loading:", loading, "pollCount:", pollCount);

	useEffect(() => {
		if (!roomId) return;
		let cancelled = false;
		const MAX_POLLS = 60;

		async function poll() {
			console.log("[Summary] Poll #", pollCount + 1, "— fetching summary for:", roomId);
			setPollCount((c) => c + 1);
			try {
				const res = await getSummary(roomId!);
				if (cancelled) return;
				console.log("[Summary] Poll result — status:", res.status, "hasTranscript:", !!res.transcriptUrl, "hasRecording:", !!res.recordingUrl);
				setData(res);
				if (res.status === "processing") {
					if (pollCount + 1 >= MAX_POLLS) {
						console.log("[Summary] Max polls reached — giving up");
						setPollTimedOut(true);
						setLoading(false);
						return;
					}
					console.log("[Summary] Status is processing — will retry in 5s");
					setTimeout(poll, 5000);
				} else {
					console.log("[Summary] Status is final — stopping poll");
					setLoading(false);
				}
			} catch (e) {
				if (cancelled) return;
				console.log("[Summary] Poll error:", e);
				setError(e instanceof Error ? e.message : "Failed to load summary");
				setLoading(false);
			}
		}

		poll();
		return () => {
			cancelled = true;
		};
	}, [roomId]);

	const hasDownloads = data?.transcriptUrl || data?.transcript_text || data?.recordingUrl || data?.audioRecordingUrl;

	return (
		<div className="summary-page">
			<div className="summary-header">
				<h1>Meeting Summary</h1>
				<button className="btn-secondary" onClick={() => navigate("/")} style={{ width: "auto", margin: 0 }}>
					New Meeting
				</button>
			</div>

			{loading && data?.status === "processing" && !pollTimedOut && (
				<div className="status-processing">
					Transcription is still processing (poll #{pollCount}). Retrying in 5s...
				</div>
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

			{data?.status === "no_summary" && (
				<div className="empty-state">
					<img src="/favicon.svg" alt="VE Rooom" className="empty-state-icon" />
					<h3>No summary available</h3>
					<p>{data.error || "The transcript exists but no summary could be generated."} You can still download the transcript and recording below.</p>
				</div>
			)}

			{data?.status === "error" && (
				<div className="error">{data.error || "Failed to load summary"}</div>
			)}

			{error && <div className="error">{error}</div>}

			{data?.status === "ok" && data.summary && (
				<div className="summary-content">
					<ReactMarkdown>{data.summary}</ReactMarkdown>
				</div>
			)}

			{data?.status === "processing" && !data.summary && hasDownloads && (
				<div className="summary-content">
					<p className="status-info" style={{ marginBottom: 0 }}>
						Summary is still being generated. Downloads are available below.
					</p>
				</div>
			)}

			{hasDownloads && (
				<div className="download-section">
					<h3>Downloads</h3>
					<div className="download-grid">
						{data?.transcriptUrl && (
							<a href={data.transcriptUrl} target="_blank" rel="noreferrer" className="download-card">
								<div className="download-card-icon" style={{ background: "rgba(34, 197, 94, 0.15)" }}>
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
						{data?.transcript_text && (
							<a
								href={`data:text/plain;charset=utf-8,${encodeURIComponent(data.transcript_text)}`}
								download="transcript.txt"
								className="download-card"
							>
								<div className="download-card-icon" style={{ background: "rgba(34, 197, 94, 0.15)" }}>
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
										<polyline points="14 2 14 8 20 8"/>
									</svg>
								</div>
								<div className="download-card-info">
									<div className="download-card-title">Full Transcript</div>
									<div className="download-card-subtitle">Text file</div>
								</div>
							</a>
						)}
						{data?.recordingUrl && (
							<a href={data.recordingUrl} target="_blank" rel="noreferrer" className="download-card">
								<div className="download-card-icon" style={{ background: "rgba(99, 102, 241, 0.15)" }}>
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
		</div>
	);
}