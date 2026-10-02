import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface FirmeeConfig {
	baseUrl: string;
	requestTimeoutMs: number;
	taskWaitTimeoutMs: number;
	transferTimeoutMs: number;
	downloadDirectory: string;
}

export interface LoadConfigOptions {
	cwd?: string;
	userConfigPath?: string;
	env?: NodeJS.ProcessEnv;
}

export const DEFAULT_BASE_URL = "http://10.211.55.17:8000";

export function defaultUserConfigPath(): string {
	return join(homedir(), ".pi", "agent", "firmee.json");
}

export function defaultConfig(): FirmeeConfig {
	return {
		baseUrl: DEFAULT_BASE_URL,
		requestTimeoutMs: 30_000,
		taskWaitTimeoutMs: 60_000,
		transferTimeoutMs: 30 * 60_000,
		downloadDirectory: join(homedir(), "Downloads", "FirmEE"),
	};
}

export function normalizeBaseUrl(value: string): string {
	const url = new URL(value.trim());
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("FirmEE base URL must use http:// or https://");
	}
	url.pathname = url.pathname.replace(/\/+$/, "");
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/$/, "");
}

function positiveInteger(value: unknown, fallback: number): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw new Error(`Cannot read FirmEE config ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function applyConfig(base: FirmeeConfig, value: Record<string, unknown>): FirmeeConfig {
	const next = { ...base };
	if (typeof value.baseUrl === "string") next.baseUrl = normalizeBaseUrl(value.baseUrl);
	if (typeof value.downloadDirectory === "string" && value.downloadDirectory.trim()) {
		next.downloadDirectory = resolve(value.downloadDirectory);
	}
	next.requestTimeoutMs = positiveInteger(value.requestTimeoutMs, next.requestTimeoutMs);
	next.taskWaitTimeoutMs = positiveInteger(value.taskWaitTimeoutMs, next.taskWaitTimeoutMs);
	next.transferTimeoutMs = positiveInteger(value.transferTimeoutMs, next.transferTimeoutMs);
	return next;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<FirmeeConfig> {
	const env = options.env ?? process.env;
	const userPath = options.userConfigPath ?? defaultUserConfigPath();
	let config = applyConfig(defaultConfig(), await readJson(userPath));

	if (options.cwd) {
		config = applyConfig(config, await readJson(join(options.cwd, ".pi", "firmee.json")));
	}

	if (env.FIRMEE_BASE_URL) config.baseUrl = normalizeBaseUrl(env.FIRMEE_BASE_URL);
	if (env.FIRMEE_DOWNLOAD_DIR) config.downloadDirectory = resolve(env.FIRMEE_DOWNLOAD_DIR);
	config.requestTimeoutMs = positiveInteger(env.FIRMEE_REQUEST_TIMEOUT_MS, config.requestTimeoutMs);
	config.taskWaitTimeoutMs = positiveInteger(env.FIRMEE_TASK_WAIT_TIMEOUT_MS, config.taskWaitTimeoutMs);
	config.transferTimeoutMs = positiveInteger(env.FIRMEE_TRANSFER_TIMEOUT_MS, config.transferTimeoutMs);
	return config;
}

export async function saveUserConfig(
	patch: Partial<FirmeeConfig>,
	configPath = defaultUserConfigPath(),
): Promise<FirmeeConfig> {
	const current = applyConfig(defaultConfig(), await readJson(configPath));
	const next = applyConfig(current, patch as Record<string, unknown>);
	await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
	const temporaryPath = `${configPath}.${process.pid}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
	await rename(temporaryPath, configPath);
	return next;
}
