const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_MAX = 30;

function getClientIp(request: Request): string {
	const forwarded = request.headers.get("cf-connecting-ip");
	if (forwarded) return forwarded;
	const xff = request.headers.get("x-forwarded-for");
	if (xff) return xff.split(",")[0].trim();
	return "unknown";
}

export async function checkRateLimit(kv: KVNamespace, request: Request): Promise<{ allowed: boolean; remaining: number }> {
	const ip = getClientIp(request);
	const key = `ratelimit:${ip}`;
	const now = Math.floor(Date.now() / 1000);

	try {
		const raw = await kv.get(key);
		let window = raw ? JSON.parse(raw) as { start: number; count: number } : { start: now, count: 0 };

		if (now - window.start > RATE_LIMIT_WINDOW) {
			window = { start: now, count: 1 };
			await kv.put(key, JSON.stringify(window), { expirationTtl: RATE_LIMIT_WINDOW });
			return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
		}

		window.count += 1;
		const remaining = RATE_LIMIT_MAX - window.count;
		if (window.count > RATE_LIMIT_MAX) {
			await kv.put(key, JSON.stringify(window), { expirationTtl: RATE_LIMIT_WINDOW - (now - window.start) });
			return { allowed: false, remaining: 0 };
		}

		await kv.put(key, JSON.stringify(window), { expirationTtl: RATE_LIMIT_WINDOW - (now - window.start) });
		return { allowed: true, remaining };
	} catch {
		return { allowed: true, remaining: RATE_LIMIT_MAX };
	}
}