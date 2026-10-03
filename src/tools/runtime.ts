import { openAsBlob } from "node:fs";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sha256LocalFile } from "../artifacts.ts";
import { clientFor, firmeeNamespace, runTool, ToolOutput } from "../toolkit.ts";
import type { RuntimePage, RuntimeView } from "../types.ts";

function formatRuntime(value: RuntimeView): string {
	const lines = [
		`Runtime ${value.id}`,
		`Status: ${value.status}`,
		`Readiness: ${value.readiness_level}`,
		`Firmware: ${value.firmware_id}`,
		`Backend: ${value.runtime_backend ?? "—"}`,
		`IP: ${value.primary_ip ?? "—"}`,
		`Expires: ${value.expires_at ?? "—"}`,
	];
	for (const endpoint of value.endpoints) lines.push(`${endpoint.protocol.toUpperCase()}: ${endpoint.proxy_url}`);
	return lines.join("\n");
}

function formatRuntimePage(page: RuntimePage): string {
	const lines = [`Found ${page.total} Runtimes. Page ${page.page}/${Math.max(page.page_count, 1)}.`];
	for (const [index, item] of page.items.entries()) {
		lines.push(`${index + 1}. ${item.status} / ${item.readiness_level}`, `   Runtime: ${item.id}`, `   Firmware: ${item.firmware_id}`);
	}
	return lines.join("\n");
}

function boundedOutput(value: string, limit = 8000): string {
	return value.length <= limit ? value : `${value.slice(0, limit)}\n… truncated by pi-firmware-manager …`;
}

const RuntimeReadAction = Type.Union([
	Type.Object({
		action: Type.Literal("list"),
		firmware_id: Type.Optional(Type.String()),
		status: Type.Optional(StringEnum(["starting", "running", "degraded", "stopping", "stopped", "failed"] as const)),
		published_only: Type.Optional(Type.Boolean()),
		created_from: Type.Optional(Type.String({ format: "date-time" })),
		created_to: Type.Optional(Type.String({ format: "date-time" })),
		sort: Type.Optional(StringEnum(["created_desc", "created_asc"] as const)),
		page: Type.Optional(Type.Integer({ minimum: 1 })),
		page_size: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	}),
	Type.Object({ action: Type.Literal("get"), runtime_id: Type.String({ minLength: 1 }) }),
	Type.Object({
		action: Type.Literal("logs"),
		runtime_id: Type.String({ minLength: 1 }),
		kind: Type.Optional(StringEnum(["serial", "emulation", "qemu", "cmd", "all"] as const)),
		tail: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
	}),
]);

export function registerRuntimeTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "firmee_runtime",
		label: "Inspect FirmEE Runtime",
		description: "List Runtimes, inspect one Runtime and its proxy endpoints, or read bounded Runtime logs.",
		exposure: "deferred",
		parameters: RuntimeReadAction,
		outputSchema: ToolOutput,
		namespace: firmeeNamespace,
		annotations: { readOnlyHint: true, openWorldHint: true },
		async execute(_id, params, signal, _update, ctx) {
			return runTool(`runtime_${params.action}`, async () => {
				const { client } = await clientFor(ctx);
				if (params.action === "get") {
					const value = await client.getRuntime(params.runtime_id, signal);
					return { summary: formatRuntime(value), data: value };
				}
				if (params.action === "logs") {
					const value = await client.runtimeLogs(params.runtime_id, params.kind ?? "all", params.tail ?? 200, signal);
					return { summary: `Read Runtime ${params.runtime_id} logs (${params.kind ?? "all"}).`, data: value };
				}
				const { action: _action, ...query } = params;
				const page = await client.listRuntimes(query, signal);
				return { summary: formatRuntimePage(page), data: page };
			});
		},
	});

	pi.registerTool({
		name: "firmee_runtime_control",
		label: "Control FirmEE Runtime",
		description: "Stop a Runtime or queue a clean restart/reset replacement. Use only with an explicit Runtime ID and action.",
		exposure: "deferred",
		parameters: Type.Object({
			action: StringEnum(["stop", "restart", "reset"] as const),
			runtime_id: Type.String({ minLength: 1 }),
			ttl_seconds: Type.Optional(Type.Integer({ minimum: 300, maximum: 86400 })),
		}),
		outputSchema: ToolOutput,
		namespace: firmeeNamespace,
		executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
		async execute(_id, params, signal, _update, ctx) {
			return runTool(`runtime_${params.action}`, async () => {
				const { client } = await clientFor(ctx);
				const value =
					params.action === "stop"
						? await client.stopRuntime(params.runtime_id, signal)
						: await client.relaunchRuntime(params.runtime_id, params.action, params.ttl_seconds, signal);
				return { summary: `FirmEE Runtime ${params.action} accepted for ${params.runtime_id}.`, data: value };
			});
		},
	});

	pi.registerTool({
		name: "firmee_runtime_exec",
		label: "Execute in FirmEE Runtime",
		description: "Create a temporary writable Runtime session, execute one guest command, and release the session unless keep_session is true.",
		exposure: "deferred",
		parameters: Type.Object({
			runtime_id: Type.String({ minLength: 1 }),
			command: Type.String({ minLength: 1, maxLength: 65536 }),
			timeout_seconds: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 300 })),
			working_directory: Type.Optional(Type.String({ maxLength: 4096 })),
			environment: Type.Optional(Type.Record(Type.String(), Type.String(), { maxProperties: 64 })),
			session_ttl_seconds: Type.Optional(Type.Integer({ minimum: 60, maximum: 86400 })),
		}),
		outputSchema: ToolOutput,
		namespace: firmeeNamespace,
		executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
		async execute(_id, params, signal, _update, ctx) {
			return runTool("runtime_exec", async () => {
				const { client } = await clientFor(ctx);
				const session = await client.createRuntimeSession(params.runtime_id, params.session_ttl_seconds ?? 600, signal);
				try {
					const result = await client.execRuntime(
						params.runtime_id,
						{
							session_id: session.id,
							command: params.command,
							timeout_seconds: params.timeout_seconds ?? 30,
							...(params.working_directory ? { working_directory: params.working_directory } : {}),
							...(params.environment ? { environment: params.environment } : {}),
						},
						signal,
					);
					return {
						summary: `Runtime command exited with ${result.exit_code ?? "no exit code"}.\nstdout:\n${boundedOutput(result.stdout)}\nstderr:\n${boundedOutput(result.stderr)}`,
						data: { result },
					};
				} finally {
					await client.releaseRuntimeSession(params.runtime_id, session.id).catch(() => undefined);
				}
			});
		},
	});

	pi.registerTool({
		name: "firmee_runtime_file",
		label: "Transfer FirmEE Runtime File",
		description: "Upload one local file into a Runtime or download one guest file using a temporary writable session.",
		exposure: "deferred",
		parameters: Type.Union([
			Type.Object({
				action: Type.Literal("upload"),
				runtime_id: Type.String({ minLength: 1 }),
				local_path: Type.String({ minLength: 1 }),
				destination_path: Type.String({ minLength: 1 }),
			}),
			Type.Object({
				action: Type.Literal("download"),
				runtime_id: Type.String({ minLength: 1 }),
				source_path: Type.String({ minLength: 1 }),
				destination_directory: Type.Optional(Type.String({ minLength: 1 })),
			}),
		]),
		outputSchema: ToolOutput,
		namespace: firmeeNamespace,
		executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
		async execute(_id, params, signal, _update, ctx) {
			return runTool(`runtime_file_${params.action}`, async () => {
				const { client, config } = await clientFor(ctx);
				const session = await client.createRuntimeSession(params.runtime_id, 600, signal);
				try {
					if (params.action === "upload") {
						const localPath = resolve(ctx.cwd, params.local_path);
						if (!(await stat(localPath)).isFile()) throw new Error(`${localPath} is not a regular file`);
						const form = new FormData();
						form.append("file", await openAsBlob(localPath), basename(localPath));
						form.append("session_id", session.id);
						form.append("destination_path", params.destination_path);
						const result = await client.uploadRuntimeFile(params.runtime_id, form, signal);
						return { summary: `Uploaded ${localPath} to ${params.destination_path}.`, data: result };
					}
					const response = await client.downloadRuntimeFile(params.runtime_id, session.id, params.source_path, signal);
					if (!response.ok) throw await client.errorFromResponse(response);
					if (!response.body) throw new Error("Runtime file response has no body");
					const directory = resolve(ctx.cwd, params.destination_directory ?? config.downloadDirectory);
					await mkdir(directory, { recursive: true });
					const filename = basename(params.source_path.replaceAll("\\", "/")) || "runtime-file.bin";
					const temporary = join(directory, `.${params.runtime_id}-${filename}.part`);
					const finalPath = join(directory, filename);
					await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temporary, { mode: 0o600 }), {
						signal,
					});
					await rename(temporary, finalPath);
					return {
						summary: `Downloaded Runtime file to ${finalPath}.`,
						data: { path: finalPath, sha256: await sha256LocalFile(finalPath) },
					};
				} finally {
					await client.releaseRuntimeSession(params.runtime_id, session.id).catch(() => undefined);
				}
			});
		},
	});
}
