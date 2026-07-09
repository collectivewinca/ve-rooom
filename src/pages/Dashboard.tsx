import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMeetings, type MeetingWithSessions, type MeetingSession, type MeetingParticipant } from "../lib/api";

function formatDate(dateStr?: string): string {
	if (!dateStr) return "—";
	const d = new Date(dateStr);
	if (isNaN(d.getTime())) return dateStr;
	return d.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatDuration(start?: string, end?: string): string {
	if (!start || !end) return "—";
	const ms = new Date(end).getTime() - new Date(start).getTime();
	if (isNaN(ms) || ms < 0) return "—";
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function sessionStatusInfo(status: string): { label: string; cls: string } {
	const s = (status || "").toUpperCase();
	if (s === "LIVE" || s === "ACTIVE") return { label: "Live", cls: "live" };
	if (s === "ENDED") return { label: "Ended", cls: "ended" };
	if (s === "INIT" || s === "NEW") return { label: "Init", cls: "init" };
	return { label: s || "Unknown", cls: "init" };
}

function recordingStatusIcon(status: string): string {
	const s = (status || "").toUpperCase();
	if (s === "UPLOADED") return "✓ Uploaded";
	if (s === "RECORDING") return "● Recording";
	if (s === "INVOKED") return "⟳ Starting";
	if (s === "STOPPED" || s === "STOPPING") return "■ Stopped";
	if (s === "FAILED") return "✕ Failed";
	return s || "—";
}

export default function Dashboard() {
	const [meetings, setMeetings] = useState<MeetingWithSessions[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	console.log("[Dashboard] Render — loading:", loading, "meetings:", meetings.length);

	useEffect(() => {
		console.log("[Dashboard] Fetching /api/meetings");
		fetchMeetings()
			.then((data) => {
				setMeetings(data);
				setLoading(false);
			})
			.catch((e) => {
				console.log("[Dashboard] Error:", e);
				setError(e instanceof Error ? e.message : "Failed to load meetings");
				setLoading(false);
			});
	}, []);

	const toggleExpand = (id: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const activeCount = meetings.filter((m) => m.status === "ACTIVE").length;
	const endedCount = meetings.filter((m) => m.status !== "ACTIVE").length;
	const totalSessions = meetings.reduce((sum, m) => sum + m.sessions.length, 0);
	const totalRecordings = meetings.reduce(
		(sum, m) => sum + m.sessions.reduce((s, sess) => s + sess.recordings.length, 0),
		0
	);

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
						<div className="stat-label">Meetings</div>
					</div>
					<div className="stat-card">
						<div className="stat-value">{totalSessions}</div>
						<div className="stat-label">Sessions</div>
					</div>
					<div className="stat-card">
						<div className="stat-value">{totalRecordings}</div>
						<div className="stat-label">Recordings</div>
					</div>
					<div className="stat-card">
						<div className="stat-value">{activeCount}</div>
						<div className="stat-label">Active Now</div>
					</div>
				</div>
			)}

			<h2>Meetings</h2>

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
					{meetings.map((m) => {
						const isExpanded = expanded.has(m.id);
						const sessionCount = m.sessions.length;
						const recordingCount = m.sessions.reduce((s, sess) => s + sess.recordings.length, 0);
						const hasEndedSession = m.sessions.some((s) => s.status === "ENDED");
						const isLive = m.status === "ACTIVE";

					return (
						<div key={m.id} className={`meeting-card ${isExpanded ? "expanded" : ""}`}>
							<div className="meeting-card-header" onClick={() => toggleExpand(m.id)}>
								<div className="meeting-card-info">
									<div className="meeting-card-title-row">
										<h3>{m.title || "Untitled Meeting"}</h3>
										<span className={`meeting-status-badge ${isLive ? "active" : "ended"}`}>
											{isLive ? "● Active" : "Ended"}
										</span>
										{m.hasCachedSummary && (
											<span className="cache-badge" title="Summary cached in KV">✓ Cached</span>
										)}
									</div>
									<div className="meeting-card-meta">
										<span className="meta-date">{formatDate(m.created_at)}</span>
										<span className="meta-sep">·</span>
										<span className="meta-id">{m.id.slice(0, 8)}</span>
										{m.createdBy && (
											<>
												<span className="meta-sep">·</span>
												<span className="meta-creator" title={m.createdBy.email}>by {m.createdBy.name}</span>
											</>
										)}
										{sessionCount > 0 && (
											<>
												<span className="meta-sep">·</span>
												<span className="meta-sessions">{sessionCount} session{sessionCount !== 1 ? "s" : ""}</span>
											</>
										)}
										{recordingCount > 0 && (
											<>
												<span className="meta-sep">·</span>
												<span className="meta-recordings">{recordingCount} recording{recordingCount !== 1 ? "s" : ""}</span>
											</>
										)}
										{m.participants && m.participants.length > 0 && (
											<>
												<span className="meta-sep">·</span>
												<span className="meta-participants">{m.participants.length} participant{m.participants.length !== 1 ? "s" : ""}</span>
											</>
										)}
									</div>
								</div>
									<div className="meeting-card-actions" onClick={(e) => e.stopPropagation()}>
										{hasEndedSession && (
											<Link to={`/summary/${m.id}`} className="btn-link">
												View Summary
											</Link>
										)}
										{isLive && (
											<Link to={`/meeting/${m.id}`} className="btn-link btn-join">
												Join
											</Link>
										)}
										<button className="expand-toggle" aria-label={isExpanded ? "Collapse" : "Expand"}>
											<svg width="16" height="16" viewBox="0 0 16 16" fill="none"
												style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
												<path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
											</svg>
										</button>
									</div>
								</div>

							{isExpanded && (
								<div className="meeting-card-body">
									{m.createdBy && (
										<div className="meeting-creator">
											<span className="creator-label">Created by</span>
											<span className="creator-name">{m.createdBy.name}</span>
											<span className="creator-email">{m.createdBy.email}</span>
										</div>
									)}

									{m.participants && m.participants.length > 0 && (
										<div className="meeting-participants">
											<span className="participants-label">Participants</span>
											<div className="participant-chips">
												{m.participants.map((p, i) => (
													<span key={i} className="participant-chip" title={p.email}>
														{p.name}
													</span>
												))}
											</div>
										</div>
									)}

									{m.sessions.length === 0 ? (
											<div className="no-sessions">
												<p>No sessions yet. {isLive ? "Meeting is live — join and talk to create a session." : "Meeting has not been joined yet."}</p>
											</div>
										) : (
											<div className="session-list">
												{m.sessions.map((sess) => (
													<SessionRow key={sess.id} session={sess} meetingId={m.id} />
												))}
											</div>
										)}

										<div className="meeting-config">
											<span className={`config-tag ${m.transcribe_on_end ? "on" : "off"}`}>
												{m.transcribe_on_end ? "✓" : "✕"} Transcribe
											</span>
											<span className={`config-tag ${m.summarize_on_end ? "on" : "off"}`}>
												{m.summarize_on_end ? "✓" : "✕"} Summarize
											</span>
											<span className={`config-tag ${m.record_on_start ? "on" : "off"}`}>
												{m.record_on_start ? "✓" : "✕"} Auto-record
											</span>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function SessionRow({ session, meetingId }: { session: MeetingSession; meetingId: string }) {
	const statusInfo = sessionStatusInfo(session.status);
	const duration = formatDuration(session.created_at, session.ended_at);
	const compositeRecs = session.recordings.filter((r) => r.type === "composite");
	const trackRecs = session.recordings.filter((r) => r.type === "track");
	const hasUploaded = session.recordings.some((r) => r.status === "UPLOADED");
	const totalRecDuration = session.recordings.reduce((sum, r) => sum + (r.recording_duration || 0), 0);
	const recDurationStr = totalRecDuration > 0 ? formatDuration(undefined, new Date(totalRecDuration * 1000).toISOString()) : "";

	return (
		<div className={`session-row ${statusInfo.cls}`}>
			<div className="session-row-main">
				<div className="session-row-header">
					<span className={`session-status-badge ${statusInfo.cls}`}>{statusInfo.label}</span>
					<span className="session-id">{session.id.slice(0, 8)}</span>
				</div>
				<div className="session-row-details">
					<span className="session-detail">
						<span className="session-detail-label">Started</span>
						{formatDate(session.created_at)}
					</span>
					{session.ended_at && (
						<span className="session-detail">
							<span className="session-detail-label">Ended</span>
							{formatDate(session.ended_at)}
						</span>
					)}
					<span className="session-detail">
						<span className="session-detail-label">Duration</span>
						{duration}
					</span>
					{session.participant_count != null && session.participant_count > 0 && (
						<span className="session-detail">
							<span className="session-detail-label">Participants</span>
							{session.participant_count}
						</span>
					)}
					{recDurationStr && (
						<span className="session-detail">
							<span className="session-detail-label">Recording</span>
							{recDurationStr}
						</span>
					)}
				</div>
				{session.transcription_minutes != null && session.transcription_minutes > 0 ? (
					<div className="session-transcription-status">
						<span className="transcription-badge transcribed">✓ Transcribed ({session.transcription_minutes.toFixed(1)} min)</span>
					</div>
				) : session.recording_minutes != null && session.recording_minutes > 0 ? (
					<div className="session-transcription-status">
						<span className="transcription-badge not-transcribed">✕ Not transcribed</span>
					</div>
				) : null}
			</div>

			<div className="session-row-recordings">
				{session.recordings.length === 0 ? (
					<span className="no-recordings">No recordings</span>
				) : (
					<>
						{compositeRecs.length > 0 && (
							<div className="recording-group">
								<span className="recording-type">Composite</span>
								{compositeRecs.map((r) => (
									<span key={r.id} className={`recording-badge ${r.status.toLowerCase()}`}>
										{recordingStatusIcon(r.status)}
									</span>
								))}
							</div>
						)}
						{trackRecs.length > 0 && (
							<div className="recording-group">
								<span className="recording-type">Track</span>
								{trackRecs.map((r) => (
									<span key={r.id} className={`recording-badge ${r.status.toLowerCase()}`}>
										{recordingStatusIcon(r.status)}
									</span>
								))}
							</div>
						)}
					</>
				)}
			</div>

			{session.status === "ENDED" && (
				<div className="session-row-action">
					<Link to={`/summary/${meetingId}`} className="btn-link btn-small">
						Summary →
					</Link>
				</div>
			)}
			{session.status !== "ENDED" && hasUploaded && (
				<div className="session-row-action">
					<span className="recording-ready">Recordings ready</span>
				</div>
			)}
		</div>
	);
}