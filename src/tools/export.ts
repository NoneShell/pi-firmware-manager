import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { downloadSimulationExport } from "../artifacts.ts";
import { clientFor, firmeeNamespace, runTool, ToolOutput } from "../toolkit.ts";
import { waitForExport } from "../waits.ts";

const ExportAction = Type.Union([
	Type.Object({
		action: Type.Literal("create"),
		simulation_id: Type.String({ minLength: 1 }),
		kind: StringEnum(["local", "docker"] as const),
	}),
	Type.Object({
		action: Type.Literal("latest"),
		simulation_id: Type.String({ minLength: 1 }),
		kind: StringEnum(["local", "docker"] as const),
	}),
	Type.Object({ action: Type.Literal("get"), job_id: Type.String({ minLength: 1 }) }),
	Type.Object({
		action: Type.Literal("wait"),
		job_id: Type.String({ minLength: 1 }),
		timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 1800 })),
	}),
	Type.Object({
		action: Type.Literal("download"),
		simulation_id: Type.String({ minLength: 1 }),
		kind: StringEnum(["local", "docker"] as const),
		destination_directory: Type.Optional(Type.String({ minLength: 1 })),
	}),
]);

export function registerExportTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "firmee_export",
		label: "FirmEE Runtime Export",
		description: "Create, inspect, wait for, or download integrity-verified local and Docker Runtime exports.",
		exposure: "deferred",
		parameters: ExportAction,
		outputSchema: ToolOutput,
		namespace: firmeeNamespace,
		executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
		async execute(_id, params, signal, _update, ctx) {
			return runTool(`export_${params.action}`, async () => {
				const { client, config } = await clientFor(ctx);
				if (params.action === "get") {
					const job = await client.getExportJob(params.job_id, signal);
					return { summary: `Export ${job.id}: ${job.status}, ${job.progress}% (${job.phase}).`, data: job };
				}
				if (params.action === "wait") {
					const result = await waitForExport({
						client,
						jobId: params.job_id,
						timeoutSeconds: params.timeout_seconds ?? 300,
						...(signal ? { signal } : {}),
					});
					return {
						summary: `Export ${result.job.id}: ${result.job.status}, ${result.job.progress}% (${result.job.phase}). Timed out: ${result.timedOut}.`,
						data: result,
					};
				}
				if (params.action === "download") {
					const job = await client.getLatestExport(params.simulation_id, params.kind, signal);
					if (job.status !== "succeeded") throw new Error(`Latest ${params.kind} export is ${job.status}; wait for job ${job.id} first`);
					const result = await downloadSimulationExport({
						client,
						config,
						simulationId: params.simulation_id,
						kind: params.kind,
						...(job.sha256 ? { expectedSha256: job.sha256 } : {}),
						...(params.destination_directory ? { destinationDirectory: resolve(ctx.cwd, params.destination_directory) } : {}),
						...(signal ? { signal } : {}),
					});
					return { summary: `Downloaded ${params.kind} export to ${result.path}.\nSHA-256: ${result.sha256}`, data: result };
				}
				const job =
					params.action === "latest"
						? await client.getLatestExport(params.simulation_id, params.kind, signal)
						: await client.createExport(params.simulation_id, params.kind, signal);
				return { summary: `Export ${job.id}: ${job.status}, ${job.progress}% (${job.phase}).`, data: job };
			});
		},
	});
}
