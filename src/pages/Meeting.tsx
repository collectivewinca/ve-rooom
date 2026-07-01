import { useEffect, useRef } from "react";
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

	useEffect(() => {
		if (!authToken || initialized.current) return;
		initialized.current = true;
		initMeeting({ authToken });
	}, [authToken, initMeeting]);

	if (!authToken) {
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
		return (
			<div className="meeting-loading">
				<p>Loading meeting...</p>
			</div>
		);
	}

	return (
		<RealtimeKitProvider value={meeting}>
			<MeetingView roomId={roomId!} />
		</RealtimeKitProvider>
	);
}

function MeetingView({ roomId }: { roomId: string }) {
	const { meeting } = useRealtimeKitMeeting();

	return (
		<div className="meeting-container">
			<RtkMeeting
				mode="fill"
				meeting={meeting}
				showSetupScreen={true}
			/>
			<a href={`/summary/${roomId}`} className="summary-link">
				View Summary &amp; Transcript
			</a>
		</div>
	);
}