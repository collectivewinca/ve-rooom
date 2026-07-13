export interface ParsedRecordings {
	recordingUrl: string | undefined;
	audioRecordingUrl: string | undefined;
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

export async function parseSessionRecordings(
	recRes: Response | null,
	meetingId: string,
	sessionId: string
): Promise<ParsedRecordings> {
	let recordingUrl: string | undefined;
	let audioRecordingUrl: string | undefined;

	if (!recRes || !recRes.ok) return { recordingUrl, audioRecordingUrl };

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
			if (isTrack) continue;
			if (rec.status !== "UPLOADED") continue;
			if (typeof rec.download_url === "string") recordingUrl = rec.download_url;
			if (rec.audio_download_url) audioRecordingUrl = rec.audio_download_url;
		}
	} catch (e) {
		console.log("[recordings] Parse error:", e);
	}

	return { recordingUrl, audioRecordingUrl };
}