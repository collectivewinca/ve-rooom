import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createRoom, joinRoom } from "../lib/api";

export default function Home() {
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [roomTitle, setRoomTitle] = useState("");
	const [joinRoomId, setJoinRoomId] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

	async function handleCreate() {
		if (!name.trim()) {
			setError("Please enter your name");
			return;
		}
		setLoading(true);
		setError("");
		try {
			const { roomId, authToken } = await createRoom(name.trim(), roomTitle.trim() || undefined);
			navigate(`/meeting/${roomId}?authToken=${encodeURIComponent(authToken)}`);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to create room");
		} finally {
			setLoading(false);
		}
	}

	async function handleJoin() {
		if (!name.trim() || !joinRoomId.trim()) {
			setError("Please enter your name and room ID");
			return;
		}
		setLoading(true);
		setError("");
		try {
			const { authToken } = await joinRoom(joinRoomId.trim(), name.trim());
			navigate(`/meeting/${joinRoomId.trim()}?authToken=${encodeURIComponent(authToken)}`);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to join room");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="home">
			<div className="home-card">
				<h1>VE-Call</h1>
				<p className="subtitle">Video conferencing with AI transcription</p>

				<div className="dashboard-link-row">
					<Link to="/dashboard" className="text-link">View past meetings →</Link>
				</div>

				<div className="form-group">
					<label htmlFor="name">Your name</label>
					<input
						id="name"
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Enter your name"
						disabled={loading}
					/>
				</div>

				<div className="form-group">
					<label htmlFor="title">Room title (optional)</label>
					<input
						id="title"
						type="text"
						value={roomTitle}
						onChange={(e) => setRoomTitle(e.target.value)}
						placeholder="e.g. Weekly Standup"
						disabled={loading}
					/>
				</div>

				<button className="btn-primary" onClick={handleCreate} disabled={loading}>
					{loading ? "Creating..." : "New Meeting"}
				</button>

				<hr className="divider" />

				<div className="form-group">
					<label htmlFor="joinId">Room ID</label>
					<input
						id="joinId"
						type="text"
						value={joinRoomId}
						onChange={(e) => setJoinRoomId(e.target.value)}
						placeholder="Paste room ID"
						disabled={loading}
					/>
				</div>

				<button className="btn-secondary" onClick={handleJoin} disabled={loading}>
					Join Meeting
				</button>

				{error && <p className="error">{error}</p>}
			</div>
		</div>
	);
}