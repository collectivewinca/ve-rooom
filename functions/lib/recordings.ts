export interface TrackFile {
	filename: string;
	downloadUrl: string;
	userId: string;
	peerId: string;
}

export interface ParsedRecordings {
	recordingUrl: string | undefined;
	audioRecordingUrl: string | undefined;
	trackFiles: TrackFile[];
}

interface RTKRecordingData {
	meeting_id: string;
	session_id?: string;
	download_url: unknown;
	audio_download_url?: string;
	status: string;
	type?: string;
	output_file_name?: string;
	invoked_time?: string;
}

function extractTrackFiles(recording: RTKRecordingData): TrackFile[] {
	const result: TrackFile[] = [];
	let trackLayers: { layer_name?: string; download_urls?: Record<string, { download_url?: string }> }[] = [];
	const du = recording.download_url as Record<string, unknown>;
	if (Array.isArray(du)) trackLayers = du;
	else if (du && typeof du === "object" && Array.isArray(du.links)) trackLayers = du.links as typeof trackLayers;
	else if (du && typeof du === "object") trackLayers = [du] as unknown as typeof trackLayers;

	for (const layer of trackLayers) {
		for (const [filename, info] of Object.entries(layer.download_urls || {})) {
			const parts = filename.replace(/\.webm$/, "").split("_");
			result.push({ filename, downloadUrl: info.download_url || "", userId: parts[1] || "unknown", peerId: parts[2] || "unknown" });
		}
	}
	return result;
}

export async function parseSessionRecordings(
	recRes: Response | null,
	meetingId: string,
	sessionId: string
): Promise<ParsedRecordings> {
	let recordingUrl: string | undefined;
	let audioRecordingUrl: string | undefined;
	const trackFiles: TrackFile[] = [];

	if (!recRes || !recRes.ok) return { recordingUrl, audioRecordingUrl, trackFiles };

	try {
		const recJson = await recRes.json() as {
			success: boolean;
			data?: RTKRecordingData[];
		};
		const sessionRecordings = (recJson.data || [])
			.filter((r) => r.meeting_id === meetingId && r.session_id === sessionId)
			.sort((a, b) => (a.invoked_time || "").localeCompare(b.invoked_time || ""));

		for (const rec of sessionRecordings) {
			const isTrack = (rec.output_file_name || "").includes(".webm") || typeof rec.download_url !== "string";
			if (isTrack) {
				if (rec.status !== "UPLOADED") continue;
				trackFiles.push(...extractTrackFiles(rec));
			} else {
				if (rec.status !== "UPLOADED") continue;
				if (typeof rec.download_url === "string") recordingUrl = rec.download_url;
				if (rec.audio_download_url) audioRecordingUrl = rec.audio_download_url;
			}
		}
	} catch (e) {
		console.log("[recordings] Parse error:", e);
	}

	return { recordingUrl, audioRecordingUrl, trackFiles };
}