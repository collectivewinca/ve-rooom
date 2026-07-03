import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { getSummary, type SummaryResponse } from "../lib/api";

export default function Summary() {
	const { roomId } = useParams<{ roomId: string }>();
	const navigate = useNavigate();
	const [data, setData] = useState<SummaryResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [pollCount, setPollCount] = useState(0);

	console.log("[Summary] Render — roomId:", roomId, "status:", data?.status, "loading:", loading, "pollCount:", pollCount);

	useEffect(() => {
		if (!roomId) return;
		let cancelled = false;

		async function poll() {
			console.log("[Summary] Poll #", pollCount + 1, "— fetching summary for:", roomId);
			setPollCount((c) => c + 1);
			try {
				const res = await getSummary(roomId!);
				if (cancelled) return;
				console.log("[Summary] Poll result — status:", res.status, "hasTranscript:", !!res.transcriptUrl, "hasRecording:", !!res.recordingUrl);
				setData(res);
				if (res.status === "processing") {
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

	const hasDownloads = data?.transcriptUrl || data?.recordingUrl;

	return (
		<div className="summary-page">
			<div className="summary-header">
				<h1>Meeting Summary</h1>
				<button className="btn-secondary" onClick={() => navigate("/")}>
					New Meeting
				</button>
			</div>

			{loading && data?.status === "processing" && (
				<p className="status-processing">Transcription is still processing (poll #{pollCount}). Retrying in 5s...</p>
			)}

			{data?.status === "no_ended_session" && (
				<p className="status-info">No ended session found for this meeting yet.</p>
			)}

			{data?.status === "error" && (
				<p className="error">{data.error || "Failed to load summary"}</p>
			)}

			{error && <p className="error">{error}</p>}

			{data?.status === "ok" && data.summary && (
				<div className="summary-content">
					<ReactMarkdown>{data.summary}</ReactMarkdown>
				</div>
			)}

			{data?.status === "processing" && !data.summary && hasDownloads && (
				<div className="summary-content">
					<p className="status-info">Summary is still being generated. Downloads are available below.</p>
				</div>
			)}

			{hasDownloads && (
				<div className="summary-links">
					{data?.transcriptUrl && (
						<a href={data.transcriptUrl} target="_blank" rel="noreferrer" className="btn-link">
							Download Transcript (CSV)
						</a>
					)}
					{data?.recordingUrl && (
						<a href={data.recordingUrl} target="_blank" rel="noreferrer" className="btn-link">
							Download Recording (MP4)
						</a>
					)}
					{data?.audioRecordingUrl && (
						<a href={data.audioRecordingUrl} target="_blank" rel="noreferrer" className="btn-link">
							Download Audio (MP3)
						</a>
					)}
				</div>
			)}
		</div>
	);
}