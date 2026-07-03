import { useEffect, useState, useCallback } from "react";
import FormsDBAuth from "./formsdb-auth.js";

export interface AuthUser {
	token: string;
	email: string;
	name: string;
	avatarURL: string;
	id: string;
}

let authInstance: FormsDBAuth | null = null;

function getAuth(): FormsDBAuth {
	if (!authInstance) {
		authInstance = new FormsDBAuth();
	}
	return authInstance;
}

export function useAuth() {
	const [user, setUser] = useState<AuthUser | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const auth = getAuth();
		const unsub = auth.onAuthChange((u: AuthUser | null) => {
			setUser(u);
			setLoading(false);
			console.log("[auth] user changed:", u?.email || "signed out");
		});
		return unsub;
	}, []);

	const signInWithGoogle = useCallback(async () => {
		const auth = getAuth();
		try {
			console.log("[auth] signInWithGoogle called");
			await auth.signInWithGoogle();
			console.log("[auth] signInWithGoogle success");
		} catch (e) {
			console.log("[auth] signInWithGoogle error:", e);
			throw e;
		}
	}, []);

	const signOut = useCallback(async () => {
		const auth = getAuth();
		await auth.signOut();
		console.log("[auth] signed out");
	}, []);

	return { user, loading, signInWithGoogle, signOut };
}