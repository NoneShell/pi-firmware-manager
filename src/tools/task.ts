import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FirmeeApiError } from "../client.ts";
import { clientFor, firmeeNamespace, runTool, ToolOutput } from "../toolkit.ts";

export function registerTaskTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "firmee_task_diagnose",
		label: "Diagnose FirmEE Task",
		description: "Collect the bounded workflow, events, checkpoints, attempts, and available analysis needed to diagnose one extraction or simulation task.",
		exposure: "deferred",
		parameters: Type.Object({
			kind: StringEnum(["extraction", "simulation"] as const),
			task_id: Type.String({ minLength: 1 }),
			event_limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
		}),
		outputSchema: ToolOutput,
		namespace: firmeeNamespace,
		annotations: { readOnlyHint: true, openWorldHint: true },
		async execute(_id, params, signal, _update, ctx) {
			return runTool("task_diagnose", async () => {
				const { client } = await clientFor(ctx);
				if (params.kind === "simulation") {
					const [task, workflow, events, checkpoints] = await Promise.all([
						client.getSimulation(params.task_id, signal),
						client.simulationWorkflow(params.task_id, signal),
						client.listSimulationEvents(params.task_id, 0, params.event_limit ?? 100, signal),
						client.simulationCheckpoints(params.task_id, signal),
					]);
					return {
						summary: `Simulation ${task.id}: ${task.status}/${task.current_phase}; ${events.length} events and ${checkpoints.length} checkpoints collected.`,
						data: { task, workflow, events, checkpoints },
					};
				}
				const [task, workflow, events, checkpoints, attempts] = await Promise.all([
					client.getExtraction(params.task_id, signal),
					client.extractionWorkflow(params.task_id, signal),
					client.listExtractionEvents(params.task_id, 0, params.event_limit ?? 100, signal),
					client.extractionCheckpoints(params.task_id, signal),
					client.extractionAttempts(params.task_id, signal),
				]);
				let analysis: unknown = null;
				try {
					analysis = await client.extractionAnalysis(params.task_id, signal);
				} catch (error) {
					if (!(error instanceof FirmeeApiError) || ![404, 409].includes(error.status)) throw error;
				}
				return {
					summary: `Extraction ${task.id}: ${task.status}/${task.phase}; ${events.length} events, ${checkpoints.length} checkpoints, and ${attempts.length} attempts collected.`,
					data: { task, workflow, events, checkpoints, attempts, analysis },
				};
			});
		},
	});
}
