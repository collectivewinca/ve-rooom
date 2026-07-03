const FORMSDB_DEFAULT = "https://formsdb.exe.xyz";

export async function verifyAuthToken(authToken: string | undefined, env: Env): Promise<{ email: string; name: string } | null> {
	if (!authToken) return null;

	const pbUrl = (env.FORMSDB_URL || FORMSDB_DEFAULT).replace(/\/+$/, "");

	try {
		const res = await fetch(`${pbUrl}/api/collections/users/auth-refresh`, {
			method: "POST",
			headers: { Authorization: authToken },
		});

		if (!res.ok) return null;

		const data = await res.json() as {
			record?: { email?: string; name?: string };
		};

		if (!data.record) return null;

		return {
			email: data.record.email || "",
			name: data.record.name || data.record.email || "",
		};
	} catch {
		return null;
	}
}
