import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface Meeting {
	id: string;
	title?: string;
	status?: string;
	created_at: string;
	updated_at: string;
}

export default function Dashboard() {
	const [meetings, setMeetings] = useState<Meeting[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	console.log("[Dashboard] Render — loading:", loading, "meetings count:", meetings.length);

	useEffect(() => {
		console.log("[Dashboard] Fetching /api/meetings");
		fetch("/api/meetings")
			.then((res) => {
				console.log("[Dashboard] Response status:", res.status);
				if (!res.ok) throw new Error("Failed to fetch meetings");
				return res.json();
			})
			.then((data) => {
				const meetings = (data as { meetings: Meeting[] }).meetings || [];
				console.log("[Dashboard] Meetings received:", meetings.length, meetings.map((m) => ({ id: m.id, title: m.title, status: m.status })));
				setMeetings(meetings);
				setLoading(false);
			})
			.catch((e) => {
				console.log("[Dashboard] Error:", e);
				setError(e instanceof Error ? e.message : "Failed to load meetings");
				setLoading(false);
			});
	}, []);

	return (
		<div className="dashboard-page">
			<div className="dashboard-header">
				<h1>VE-Call</h1>
				<div className="dashboard-actions">
					<Link to="/" className="btn-link">New Meeting</Link>
				</div>
			</div>

			<h2>Past Meetings</h2>

			{loading && <p className="status-info">Loading meetings...</p>}
			{error && <p className="error">{error}</p>}

			{!loading && meetings.length === 0 && (
				<p className="status-info">No meetings yet. Create one to get started.</p>
			)}

			{meetings.length > 0 && (
				<div className="meeting-list">
					{meetings.map((m) => (
						<div key={m.id} className="meeting-item">
							<div className="meeting-item-info">
								<h3>{m.title || "Untitled Meeting"}</h3>
								<p className="meeting-meta">
									{new Date(m.created_at).toLocaleString()}
								</p>
							</div>
							<div className="meeting-item-actions">
								<Link to={`/summary/${m.id}`} className="btn-link">
									Summary
								</Link>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}