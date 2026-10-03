import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clientFor, firmeeNamespace, runTool, ToolOutput } from "../toolkit.ts";

export function registerPlatformTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "firmee_platform_diagnose",
		label: "Diagnose FirmEE Platform",
		description: "Inspect FirmEE readiness, dependency backends, storage capacity, or worker heartbeats.",
		exposure: "deferred",
		parameters: Type.Object({
			action: StringEnum(["readiness", "backends", "storage", "workers", "all"] as const),
		}),
		outputSchema: ToolOutput,
		namespace: firmeeNamespace,
		annotations: { readOnlyHint: true, openWorldHint: true },
		async execute(_id, params, signal, _update, ctx) {
			return runTool("platform_diagnose", async () => {
				const { client } = await clientFor(ctx);
				const data =
					params.action === "readiness"
						? await client.readiness(signal)
						: params.action === "backends"
							? await client.platformBackends(signal)
							: params.action === "storage"
								? await client.platformStorage(signal)
								: params.action === "workers"
									? await client.platformWorkers(signal)
									: {
										readiness: await client.readiness(signal),
										storage: await client.platformStorage(signal),
										workers: await client.platformWorkers(signal),
									};
				const summary =
					params.action === "storage" && !Array.isArray(data) && "free_bytes" in data
						? `FirmEE storage is ${data.writable ? "writable" : "not writable"}; ${data.free_bytes} bytes free.`
						: `FirmEE platform diagnostic completed: ${params.action}.`;
				return { summary, data };
			});
		},
	});
}
