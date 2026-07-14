export interface MeetingMeta {
	createdBy: { email: string; name: string };
	title: string;
	createdAt: string;
}

export interface ParticipantRecord {
	email: string;
	name: string;
	joinedAt: string;
}

export interface CachedResult {
	transcript: string;
	summary: string;
	cachedAt: string;
}

export interface SummaryVersion {
	summary: string;
	prompt?: string;
	createdAt: string;
}

export interface RecordingRef {
	key: string;
	url: string;
	type: "composite" | "audio";
	size?: number;
	uploadedAt?: string;
}

export async function saveRecordingRefs(kv: KVNamespace, meetingId: string, refs: RecordingRef[]): Promise<void> {
	try {
		await kv.put(`meeting:${meetingId}:recordings`, JSON.stringify(refs));
		console.log("[kv] Saved", refs.length, "recording refs for meeting", meetingId);
	} catch (e) {
		console.log("[kv] Save recording refs error:", e);
	}
}

export async function getRecordingRefs(kv: KVNamespace, meetingId: string): Promise<RecordingRef[]> {
	try {
		const raw = await kv.get(`meeting:${meetingId}:recordings`);
		if (!raw) return [];
		return JSON.parse(raw) as RecordingRef[];
	} catch {
		return [];
	}
}

export async function saveMeetingMeta(kv: KVNamespace, meetingId: string, meta: MeetingMeta): Promise<void> {
	try {
		await kv.put(`meeting:${meetingId}:meta`, JSON.stringify(meta));
		console.log("[kv] Saved meeting meta for", meetingId);
	} catch (e) {
		console.log("[kv] Save meta error:", e);
	}
}

export async function getMeetingMeta(kv: KVNamespace, meetingId: string): Promise<MeetingMeta | null> {
	try {
		const raw = await kv.get(`meeting:${meetingId}:meta`);
		if (!raw) return null;
		return JSON.parse(raw) as MeetingMeta;
	} catch {
		return null;
	}
}

export async function addParticipant(kv: KVNamespace, meetingId: string, participant: ParticipantRecord): Promise<void> {
	try {
		const key = `meeting:${meetingId}:participants`;
		const existing = await kv.get(key);
		const list: ParticipantRecord[] = existing ? JSON.parse(existing) : [];
		// Don't add duplicate emails
		if (!list.some((p) => p.email === participant.email)) {
			list.push(participant);
			await kv.put(key, JSON.stringify(list));
			console.log("[kv] Added participant", participant.email, "to meeting", meetingId);
		}
	} catch (e) {
		console.log("[kv] Add participant error:", e);
	}
}

export async function getParticipants(kv: KVNamespace, meetingId: string): Promise<ParticipantRecord[]> {
	try {
		const raw = await kv.get(`meeting:${meetingId}:participants`);
		if (!raw) return [];
		return JSON.parse(raw) as ParticipantRecord[];
	} catch {
		return [];
	}
}

export async function saveCachedResult(kv: KVNamespace, meetingId: string, result: CachedResult, sessionId?: string): Promise<void> {
	try {
		const key = sessionId ? `meeting:${meetingId}:session:${sessionId}:result` : `meeting:${meetingId}:result`;
		await kv.put(key, JSON.stringify(result));
		console.log("[kv] Cached result for meeting", meetingId, sessionId ? `session ${sessionId}` : "(meeting-level)");
	} catch (e) {
		console.log("[kv] Save result error:", e);
	}
}

export async function getCachedResult(kv: KVNamespace, meetingId: string, sessionId?: string): Promise<CachedResult | null> {
	try {
		const key = sessionId ? `meeting:${meetingId}:session:${sessionId}:result` : `meeting:${meetingId}:result`;
		const raw = await kv.get(key);
		if (!raw) return null;
		return JSON.parse(raw) as CachedResult;
	} catch {
		return null;
	}
}

export async function addUserMeeting(kv: KVNamespace, email: string, meetingId: string): Promise<void> {
	try {
		const key = `user:${email}:meetings`;
		const existing = await kv.get(key);
		const list: string[] = existing ? JSON.parse(existing) : [];
		if (!list.includes(meetingId)) {
			list.push(meetingId);
			await kv.put(key, JSON.stringify(list));
		}
	} catch (e) {
		console.log("[kv] Add user meeting error:", e);
	}
}

export async function getUserMeetings(kv: KVNamespace, email: string): Promise<string[]> {
	try {
		const raw = await kv.get(`user:${email}:meetings`);
		if (!raw) return [];
		return JSON.parse(raw) as string[];
	} catch {
		return [];
	}
}

export async function getUserPrompt(kv: KVNamespace, email: string): Promise<string | null> {
	try {
		const raw = await kv.get(`user:${email}:prompt`);
		return raw || null;
	} catch {
		return null;
	}
}

export async function saveUserPrompt(kv: KVNamespace, email: string, prompt: string): Promise<void> {
	try {
		await kv.put(`user:${email}:prompt`, prompt);
		console.log("[kv] Saved user prompt for", email, `(${prompt.length} chars)`);
	} catch (e) {
		console.log("[kv] Save user prompt error:", e);
	}
}

export async function getMeetingPrompt(kv: KVNamespace, meetingId: string): Promise<string | null> {
	try {
		const raw = await kv.get(`meeting:${meetingId}:prompt`);
		return raw || null;
	} catch {
		return null;
	}
}

export async function saveMeetingPrompt(kv: KVNamespace, meetingId: string, prompt: string): Promise<void> {
	try {
		await kv.put(`meeting:${meetingId}:prompt`, prompt);
		console.log("[kv] Saved meeting prompt for", meetingId, `(${prompt.length} chars)`);
	} catch (e) {
		console.log("[kv] Save meeting prompt error:", e);
	}
}

export async function addSummaryVersion(kv: KVNamespace, meetingId: string, version: SummaryVersion, sessionId?: string): Promise<void> {
	try {
		const key = sessionId ? `meeting:${meetingId}:session:${sessionId}:history` : `meeting:${meetingId}:history`;
		const raw = await kv.get(key);
		const list: SummaryVersion[] = raw ? JSON.parse(raw) : [];
		list.push(version);
		if (list.length > 50) list.shift();
		await kv.put(key, JSON.stringify(list));
		console.log("[kv] Added summary version for", meetingId, sessionId ? `session ${sessionId}` : "(meeting-level)", "— total:", list.length);
	} catch (e) {
		console.log("[kv] Add summary version error:", e);
	}
}

export async function getSummaryHistory(kv: KVNamespace, meetingId: string, sessionId?: string): Promise<SummaryVersion[]> {
	try {
		const key = sessionId ? `meeting:${meetingId}:session:${sessionId}:history` : `meeting:${meetingId}:history`;
		const raw = await kv.get(key);
		if (!raw) return [];
		return JSON.parse(raw) as SummaryVersion[];
	} catch {
		return [];
	}
}

export async function markEmailSent(kv: KVNamespace, meetingId: string): Promise<void> {
	try {
		await kv.put(`meeting:${meetingId}:email-sent`, new Date().toISOString());
	} catch (e) {
		console.log("[kv] markEmailSent error:", e);
	}
}

export async function isEmailSent(kv: KVNamespace, meetingId: string): Promise<boolean> {
	try {
		const raw = await kv.get(`meeting:${meetingId}:email-sent`);
		return !!raw;
	} catch {
		return false;
	}
}