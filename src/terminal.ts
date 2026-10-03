import { randomUUID } from "node:crypto";
import type { FirmeeClient } from "./client.ts";
import type { RuntimeSessionView } from "./types.ts";

export interface TerminalExecResult {
	type: "result";
	request_id: string;
	operation_id: string;
	exit_code: number | null;
	stdout: string;
	stderr: string;
	stdout_truncated: boolean;
	stderr_truncated: boolean;
	duration_ms: number;
	channel: string;
}

interface TerminalErrorMessage {
	type: "error";
	request_id?: string | null;
	code: string;
	detail: string;
}

function websocketUrl(baseUrl: string, runtimeId: string, sessionId: string): string {
	const url = new URL(`/api/v1/runtimes/${encodeURIComponent(runtimeId)}/terminal`, `${baseUrl}/`);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("session_id", sessionId);
	return url.toString();
}

function waitForJson<T>(
	websocket: WebSocket,
	predicate: (value: Record<string, unknown>) => value is Record<string, unknown> & T,
	timeoutMs: number,
): Promise<T> {
	return new Promise((resolvePromise, reject) => {
		const timer = setTimeout(() => finish(new Error(`FirmEE terminal message timed out after ${timeoutMs} ms`)), timeoutMs);
		const onMessage = (event: MessageEvent) => {
			try {
				const parsed: unknown = JSON.parse(String(event.data));
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					const value = parsed as Record<string, unknown>;
					if (value.type === "error") {
						const error = value as unknown as TerminalErrorMessage;
						finish(new Error(`${error.code}: ${error.detail}`));
					} else if (predicate(value)) {
						finish(undefined, value as T);
					}
				}
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		};
		const onError = () => finish(new Error("FirmEE terminal WebSocket failed"));
		const onClose = () => finish(new Error("FirmEE terminal WebSocket closed"));
		function finish(error?: Error, value?: T) {
			clearTimeout(timer);
			websocket.removeEventListener("message", onMessage);
			websocket.removeEventListener("error", onError);
			websocket.removeEventListener("close", onClose);
			if (error) reject(error);
			else resolvePromise(value as T);
		}
		websocket.addEventListener("message", onMessage);
		websocket.addEventListener("error", onError);
		websocket.addEventListener("close", onClose);
	});
}

export class RuntimeTerminal {
	readonly client: FirmeeClient;
	readonly runtimeId: string;
	readonly session: RuntimeSessionView;
	readonly websocket: WebSocket;

	private constructor(client: FirmeeClient, runtimeId: string, session: RuntimeSessionView, websocket: WebSocket) {
		this.client = client;
		this.runtimeId = runtimeId;
		this.session = session;
		this.websocket = websocket;
	}

	static async connect(client: FirmeeClient, runtimeId: string, ttlSeconds = 3600): Promise<RuntimeTerminal> {
		const session = await client.createRuntimeSession(runtimeId, ttlSeconds);
		const websocket = new WebSocket(websocketUrl(client.config.baseUrl, runtimeId, session.id));
		const ready = waitForJson(
			websocket,
			(value): value is Record<string, unknown> & { type: "ready" } => value.type === "ready",
			client.config.requestTimeoutMs,
		);
		try {
			await ready;
			return new RuntimeTerminal(client, runtimeId, session, websocket);
		} catch (error) {
			websocket.close();
			await client.releaseRuntimeSession(runtimeId, session.id).catch(() => undefined);
			throw error;
		}
	}

	async execute(command: string, options: { timeoutSeconds?: number; workingDirectory?: string } = {}): Promise<TerminalExecResult> {
		const requestId = randomUUID();
		const result = waitForJson(
			this.websocket,
			(value): value is Record<string, unknown> & TerminalExecResult =>
				value.type === "result" && value.request_id === requestId,
			(options.timeoutSeconds ?? 30) * 1000 + 5000,
		);
		this.websocket.send(
			JSON.stringify({
				type: "exec",
				request_id: requestId,
				command,
				timeout_seconds: options.timeoutSeconds ?? 30,
				...(options.workingDirectory ? { working_directory: options.workingDirectory } : {}),
				environment: {},
			}),
		);
		return result;
	}

	async close(): Promise<void> {
		this.websocket.close(1000, "normal client close");
		await this.client.releaseRuntimeSession(this.runtimeId, this.session.id).catch(() => undefined);
	}
}
