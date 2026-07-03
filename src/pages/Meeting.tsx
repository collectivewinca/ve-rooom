import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
	RealtimeKitProvider,
	useRealtimeKitClient,
	useRealtimeKitMeeting,
} from "@cloudflare/realtimekit-react";
import { RtkMeeting } from "@cloudflare/realtimekit-react-ui";

export default function Meeting() {
	const { roomId } = useParams<{ roomId: string }>();
	const [search] = useSearchParams();
	const authToken = search.get("authToken");
	const navigate = useNavigate();
	const [meeting, initMeeting] = useRealtimeKitClient();
	const initialized = useRef(false);

	console.log("[Meeting] Render — roomId:", roomId, "hasAuthToken:", !!authToken, "meetingReady:", !!meeting);

	useEffect(() => {
		console.log("[Meeting] useEffect — authToken:", authToken ? "present" : "missing", "initialized:", initialized.current);
		if (!authToken || initialized.current) return;
		initialized.current = true;
		console.log("[Meeting] Calling initMeeting with authToken (truncated):", authToken.slice(0, 30) + "...");
		initMeeting({ authToken }).then(() => {
			console.log("[Meeting] initMeeting resolved — meeting should be ready");
		}).catch((e) => {
			console.log("[Meeting] initMeeting error:", e);
		});
	}, [authToken, initMeeting]);

	if (!authToken) {
		console.log("[Meeting] No authToken — showing error");
		return (
			<div className="meeting-error">
				<p>Missing auth token.</p>
				<button className="btn-secondary" onClick={() => navigate("/")}>
					Back to Home
				</button>
			</div>
		);
	}

	if (!meeting) {
		console.log("[Meeting] Meeting not ready yet — showing loading");
		return (
			<div className="meeting-loading">
				<p>Loading meeting...</p>
			</div>
		);
	}

	console.log("[Meeting] Meeting ready — rendering RtkMeeting");

	return (
		<RealtimeKitProvider value={meeting}>
			<MeetingView roomId={roomId!} />
		</RealtimeKitProvider>
	);
}

function MeetingView({ roomId }: { roomId: string }) {
	const { meeting } = useRealtimeKitMeeting();
	const [copied, setCopied] = useState(false);
	console.log("[MeetingView] Render — meeting present:", !!meeting);

	const shareUrl = `${window.location.origin}/?room=${roomId}`;

	function handleCopyLink() {
		console.log("[MeetingView] Copying share link:", shareUrl);
		navigator.clipboard.writeText(shareUrl).then(() => {
			setCopied(true);
			console.log("[MeetingView] Link copied to clipboard");
			setTimeout(() => setCopied(false), 3000);
		}).catch((e) => {
			console.log("[MeetingView] Clipboard error:", e);
		});
	}

	return (
		<div className="meeting-container">
			<RtkMeeting
				mode="fill"
				meeting={meeting}
				showSetupScreen={true}
			/>
			<div className="meeting-overlay-controls">
				<button className="btn-share" onClick={handleCopyLink}>
					{copied ? "Copied!" : "Copy Join Link"}
				</button>
				<a href={`/summary/${roomId}`} className="summary-link">
					View Summary &amp; Transcript
				</a>
			</div>
		</div>
	);
}