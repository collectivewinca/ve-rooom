export interface AuthUser {
	token: string;
	record: Record<string, unknown>;
	meta: Record<string, unknown>;
	email: string;
	name: string;
	avatarURL: string;
	id: string;
	googleProfile: Record<string, unknown> | null;
}

export default class FormsDBAuth {
	constructor(opts?: {
		pbUrl?: string;
		collection?: string;
		redirectPath?: string;
		storeKey?: string;
	});
	onAuthChange(cb: (user: AuthUser | null) => void): () => void;
	getUser(): AuthUser | null;
	signInWithGoogle(): Promise<AuthUser>;
	signOut(): Promise<void>;
	refresh(): Promise<AuthUser | null>;
	api(path: string, opts?: RequestInit): Promise<Response>;
}