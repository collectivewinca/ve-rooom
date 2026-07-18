export interface AppEnv {
	CF_ACCOUNT_ID: string;
	CF_API_TOKEN: string;
	RTK_APP_ID: string;
	OPENROUTER_API_KEY: string;
	OPENROUTER_MODEL?: string;
	OPENROUTER_FREE_MODEL?: string;
	OLLAMA_API_KEY: string;
	OLLAMA_BASE_URL: string;
	OLLAMA_MODEL?: string;
	FORMSDB_URL?: string;
	SMTP_API_URL: string;
	ALWAYS_EMAIL?: string;
	R2_ACCESS_KEY?: string;
	R2_SECRET_KEY?: string;
	R2_BUCKET?: string;
	MEETING_CACHE: KVNamespace;
	RECORDINGS_BUCKET: R2Bucket;
}