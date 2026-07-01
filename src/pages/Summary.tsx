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

	useEffect(() => {
		if (!roomId) return;
		let cancelled = false;

		async function poll() {
			try {
				const res = await getSummary(roomId!);
				if (cancelled) return;
				setData(res);
				if (res.status === "processing") {
					setTimeout(poll, 5000);
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
		};
	}, [roomId]);

	return (
		<div className="summary-page">
			<div className="summary-header">
				<h1>Meeting Summary</h1>
				<button className="btn-secondary" onClick={() => navigate("/")}>
					New Meeting
				</button>
			</div>

			{loading && data?.status === "processing" && (
				<p className="status-processing">Transcription is still processing. Retrying in 5s...</p>
			)}

			{data?.status === "no_ended_session" && (
				<p className="status-info">No ended session found for this meeting yet.</p>
			)}

			{error && <p className="error">{error}</p>}

			{data?.status === "ok" && data.summary && (
				<div className="summary-content">
					<ReactMarkdown>{data.summary}</ReactMarkdown>
					<div className="summary-links">
						{data.transcriptUrl && (
							<a href={data.transcriptUrl} target="_blank" rel="noreferrer" className="btn-link">
								Download Transcript (JSON)
							</a>
						)}
						{data.recordingUrl && (
							<a href={data.recordingUrl} target="_blank" rel="noreferrer" className="btn-link">
								Download Recording
							</a>
						)}
					</div>
				</div>
			)}
		</div>
	);
}