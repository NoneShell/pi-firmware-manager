import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { FirmeeConfig } from "./config.ts";
import type {
	ApiCapabilities,
	ApiErrorPayload,
	ExtractionEvent,
	ExtractionPage,
	ExtractionRun,
	FirmwareArchiveView,
	FirmwareSearchPage,
	FirmwareUploadResult,
	FirmwareView,
	HealthView,
	JsonRecord,
} from "./types.ts";

type QueryValue = string | number | boolean | null | undefined;

interface RequestOptions {
	query?: Record<string, QueryValue> | undefined;
	body?: BodyInit | JsonRecord | undefined;
	headers?: HeadersInit | undefined;
	signal?: AbortSignal | undefined;
	timeoutMs?: number | undefined;
}

function isBodyInit(value: unknown): value is BodyInit {
	return (
		typeof value === "string" ||
		value instanceof Blob ||
		value instanceof FormData ||
		value instanceof URLSearchParams ||
		value instanceof ArrayBuffer ||
		ArrayBuffer.isView(value)
	);
}

function composeSignal(parent: AbortSignal | undefined, timeoutMs: number): {
	signal: AbortSignal;
	cleanup: () => void;
} {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new DOMException(`FirmEE request timed out after ${timeoutMs} ms`, "TimeoutError")),
		timeoutMs,
	);
	const abortFromParent = () => controller.abort(parent?.reason);
	if (parent?.aborted) abortFromParent();
	else parent?.addEventListener("abort", abortFromParent, { once: true });
	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timeout);
			parent?.removeEventListener("abort", abortFromParent);
		},
	};
}

function isRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPrivateServiceHost(hostname: string): boolean {
	const normalized = hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
	if (normalized === "localhost" || normalized.endsWith(".local")) return true;
	const ipVersion = isIP(normalized);
	if (ipVersion === 6) return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
	if (ipVersion !== 4) return false;
	const octets = normalized.split(".").map(Number);
	const [first = -1, second = -1] = octets;
	return (
		first === 10 ||
		first === 127 ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168) ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 198 && (second === 18 || second === 19))
	);
}

function appendNoProxy(value: string | undefined, hostname: string): string {
	const entries = (value ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (!entries.includes(hostname)) entries.push(hostname);
	return entries.join(",");
}

/**
 * Pi uses Undici's EnvHttpProxyAgent. It does not understand CIDR entries such as 10.0.0.0/8,
 * so add the exact configured private host to NO_PROXY before the first request.
 */
export function ensureNoProxyForLocalService(baseUrl: string, env: NodeJS.ProcessEnv = process.env): boolean {
	const hostname = new URL(baseUrl).hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
	if (!isPrivateServiceHost(hostname)) return false;
	env.NO_PROXY = appendNoProxy(env.NO_PROXY, hostname);
	env.no_proxy = appendNoProxy(env.no_proxy, hostname);
	return true;
}

export class FirmeeApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly requestId: string | undefined;
	readonly context: JsonRecord | undefined;

	constructor(
		message: string,
		options: {
			status: number;
			code?: string | undefined;
			requestId?: string | undefined;
			context?: JsonRecord | undefined;
		},
	) {
		super(message);
		this.name = "FirmeeApiError";
		this.status = options.status;
		this.code = options.code ?? `http_${options.status}`;
		this.requestId = options.requestId;
		this.context = options.context;
	}
}

export class FirmeeClient {
	readonly config: FirmeeConfig;

	constructor(config: FirmeeConfig) {
		this.config = config;
		ensureNoProxyForLocalService(config.baseUrl);
	}

	url(path: string, query?: Record<string, QueryValue>): URL {
		const url = new URL(path.startsWith("/") ? path : `/${path}`, `${this.config.baseUrl}/`);
		for (const [key, value] of Object.entries(query ?? {})) {
			if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
		}
		return url;
	}

	async fetchResponse(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
		const requestId = randomUUID();
		const headers = new Headers(options.headers);
		headers.set("Accept", headers.get("Accept") ?? "application/json");
		headers.set("X-Request-ID", headers.get("X-Request-ID") ?? requestId);
		let body: BodyInit | undefined;
		if (options.body !== undefined) {
			if (isBodyInit(options.body)) body = options.body;
			else {
				headers.set("Content-Type", "application/json");
				body = JSON.stringify(options.body);
			}
		}
		const { signal, cleanup } = composeSignal(
			options.signal,
			options.timeoutMs ?? this.config.requestTimeoutMs,
		);
		try {
			return await fetch(this.url(path, options.query), {
				method,
				headers,
				...(body === undefined ? {} : { body }),
				signal,
			});
		} finally {
			cleanup();
		}
	}

	async errorFromResponse(response: Response): Promise<FirmeeApiError> {
		let payload: ApiErrorPayload | undefined;
		try {
			const parsed: unknown = await response.json();
			if (isRecord(parsed) && typeof parsed.code === "string" && typeof parsed.detail === "string") {
				payload = parsed as unknown as ApiErrorPayload;
			}
		} catch {
			// The response may be an upstream HTML/plain-text failure.
		}
		return new FirmeeApiError(payload?.detail ?? `${response.status} ${response.statusText}`, {
			status: response.status,
			code: payload?.code,
			requestId: payload?.request_id ?? response.headers.get("x-request-id") ?? undefined,
			context: isRecord(payload?.context) ? payload.context : undefined,
		});
	}

	async requestJson<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
		const response = await this.fetchResponse(method, path, options);
		if (!response.ok) throw await this.errorFromResponse(response);
		return (await response.json()) as T;
	}

	health(signal?: AbortSignal): Promise<HealthView> {
		return this.requestJson("GET", "/health", { signal });
	}

	capabilities(signal?: AbortSignal): Promise<ApiCapabilities> {
		return this.requestJson("GET", "/api/v1/capabilities", { signal });
	}

	searchFirmware(query: Record<string, QueryValue>, signal?: AbortSignal): Promise<FirmwareSearchPage> {
		return this.requestJson("GET", "/api/v1/firmwares/search", { query, signal });
	}

	getFirmware(id: string, includeArchive: boolean, signal?: AbortSignal): Promise<FirmwareView | FirmwareArchiveView> {
		return this.requestJson("GET", `/api/v1/firmwares/${encodeURIComponent(id)}${includeArchive ? "/archive" : ""}`, {
			signal,
		});
	}

	uploadFirmware(form: FormData, signal?: AbortSignal): Promise<FirmwareUploadResult> {
		return this.requestJson("POST", "/api/v1/firmwares", {
			body: form,
			signal,
			timeoutMs: this.config.transferTimeoutMs,
		});
	}

	updateFirmware(id: string, patch: JsonRecord, signal?: AbortSignal): Promise<FirmwareView> {
		return this.requestJson("PATCH", `/api/v1/firmwares/${encodeURIComponent(id)}`, { body: patch, signal });
	}

	startExtraction(firmwareId: string, signal?: AbortSignal): Promise<ExtractionRun> {
		return this.requestJson("POST", `/api/v1/firmwares/${encodeURIComponent(firmwareId)}/extractions`, { signal });
	}

	listExtractions(query: Record<string, QueryValue>, signal?: AbortSignal): Promise<ExtractionPage> {
		return this.requestJson("GET", "/api/v1/extractions", { query, signal });
	}

	getExtraction(id: string, signal?: AbortSignal): Promise<ExtractionRun> {
		return this.requestJson("GET", `/api/v1/extractions/${encodeURIComponent(id)}`, { signal });
	}

	listExtractionEvents(
		id: string,
		after: number,
		limit = 100,
		signal?: AbortSignal,
	): Promise<ExtractionEvent[]> {
		return this.requestJson("GET", `/api/v1/extractions/${encodeURIComponent(id)}/events`, {
			query: { after, limit },
			signal,
		});
	}

	cancelExtraction(id: string, signal?: AbortSignal): Promise<ExtractionRun> {
		return this.requestJson("POST", `/api/v1/extractions/${encodeURIComponent(id)}/cancel`, { signal });
	}

	async streamExtractionEvents(
		id: string,
		after: number,
		signal: AbortSignal,
		onEvent: (event: ExtractionEvent) => void | Promise<void>,
	): Promise<number> {
		const response = await fetch(this.url(`/api/v1/extractions/${encodeURIComponent(id)}/events/stream`, { after }), {
			headers: { Accept: "text/event-stream", "X-Request-ID": randomUUID() },
			signal,
		});
		if (!response.ok) throw await this.errorFromResponse(response);
		if (!response.body) throw new Error("FirmEE SSE response has no body");

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let lastSequence = after;
		while (true) {
			const { value, done } = await reader.read();
			buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
			let boundary = buffer.indexOf("\n\n");
			while (boundary >= 0) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const lines = frame.split("\n");
				if (!lines.some((line) => line.startsWith("data:"))) {
					boundary = buffer.indexOf("\n\n");
					continue;
				}
				const data = lines
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trimStart())
					.join("\n");
				const parsed: unknown = JSON.parse(data);
				const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
				if (eventName === "error" && isRecord(parsed)) {
					throw new FirmeeApiError(
						typeof parsed.detail === "string" ? parsed.detail : "FirmEE event stream failed",
						{
							status: 500,
							code: typeof parsed.code === "string" ? parsed.code : "stream_error",
							requestId: typeof parsed.request_id === "string" ? parsed.request_id : undefined,
							context: isRecord(parsed.context) ? parsed.context : undefined,
						},
					);
				}
				if (isRecord(parsed) && typeof parsed.sequence === "number" && typeof parsed.event_type === "string") {
					const event = parsed as unknown as ExtractionEvent;
					lastSequence = Math.max(lastSequence, event.sequence);
					await onEvent(event);
				}
				boundary = buffer.indexOf("\n\n");
			}
			if (done) break;
		}
		return lastSequence;
	}
}

export function describeError(error: unknown): string {
	if (error instanceof FirmeeApiError) {
		const request = error.requestId ? ` Request ID: ${error.requestId}.` : "";
		return `${error.code}: ${error.message}.${request}`;
	}
	if (error instanceof Error) {
		const cause = error.cause;
		if (isRecord(cause)) {
			const details = [cause.code, cause.address, cause.port].filter((value) => value !== undefined).join(" ");
			if (details) return `${error.message} (${details})`;
			if (typeof cause.message === "string") return `${error.message}: ${cause.message}`;
		}
		return error.message;
	}
	return String(error);
}
