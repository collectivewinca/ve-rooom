import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface Meeting {
	id: string;
	title?: string;
	status?: string;
	created_at: string;
	updated_at: string;
	record_on_start?: boolean;
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

	const activeCount = meetings.filter((m) => m.status === "ACTIVE").length;
	const endedCount = meetings.filter((m) => m.status !== "ACTIVE").length;

	return (
		<div className="dashboard-page">
			<div className="dashboard-header">
				<h1>Dashboard</h1>
				<Link to="/" className="btn-primary" style={{ width: "auto", textDecoration: "none" }}>
					+ New Meeting
				</Link>
			</div>

			{!loading && meetings.length > 0 && (
				<div className="dashboard-stats">
					<div className="stat-card">
						<div className="stat-value">{meetings.length}</div>
						<div className="stat-label">Total Meetings</div>
					</div>
					<div className="stat-card">
						<div className="stat-value">{activeCount}</div>
						<div className="stat-label">Active Now</div>
					</div>
					<div className="stat-card">
						<div className="stat-value">{endedCount}</div>
						<div className="stat-label">Completed</div>
					</div>
				</div>
			)}

			<h2>Past Meetings</h2>

			{loading && (
				<div className="empty-state">
					<div className="spinner" style={{ width: 40, height: 40, margin: "0 auto 1rem", border: "3px solid rgba(99, 102, 241, 0.2)", borderTopColor: "var(--color-primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
					<p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>Loading meetings...</p>
				</div>
			)}

			{error && <div className="error">{error}</div>}

			{!loading && meetings.length === 0 && !error && (
				<div className="empty-state">
					<img src="/favicon.svg" alt="VE Rooom" className="empty-state-icon" />
					<h3>No meetings yet</h3>
					<p>Create your first meeting to get started with AI-powered transcription and summaries.</p>
					<Link to="/" className="btn-primary" style={{ display: "inline-flex", textDecoration: "none", width: "auto" }}>
						Start Your First Meeting
					</Link>
				</div>
			)}

			{meetings.length > 0 && (
				<div className="meeting-list">
					{meetings.map((m) => (
						<div key={m.id} className="meeting-item">
							<div className="meeting-item-info">
								<h3>{m.title || "Untitled Meeting"}</h3>
								<div className="meeting-item-meta">
									<span>{new Date(m.created_at).toLocaleString()}</span>
									<span className={`meeting-status-badge ${m.status === "ACTIVE" ? "active" : "ended"}`}>
										{m.status === "ACTIVE" ? "● Active" : "Ended"}
									</span>
								</div>
							</div>
							<div className="meeting-item-actions">
								<Link to={`/summary/${m.id}`} className="btn-link">
									View Summary
								</Link>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}