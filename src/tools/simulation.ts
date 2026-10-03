import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clientFor, firmeeNamespace, requireOperationalFirmwareId, runTool, ToolOutput } from "../toolkit.ts";
import { waitForSimulation } from "../waits.ts";
import type { SimulationPage, SimulationView } from "../types.ts";

function formatSimulation(value: SimulationView): string {
	const runtime = value.runtime;
	const lines = [
		`Simulation ${value.id}`,
		`Firmware: ${value.firmware_id}`,
		`Status: ${value.status}`,
		`Phase: ${value.current_phase}`,
		`Target: ${value.target}`,
	];
	if (runtime) {
		lines.push(`Runtime: ${runtime.id} (${runtime.status}, ${runtime.readiness_level})`);
		if (runtime.primary_ip) lines.push(`IP: ${runtime.primary_ip}`);
		for (const endpoint of runtime.endpoints) lines.push(`${endpoint.protocol.toUpperCase()}: ${endpoint.proxy_url}`);
	}
	if (value.failure_code) lines.push(`Failure: ${value.failure_code} — ${value.failure_detail ?? ""}`);
	return lines.join("\n");
}

function formatSimulationPage(page: SimulationPage): string {
	const lines = [`Found ${page.total} simulation tasks. Page ${page.page}/${Math.max(page.page_count, 1)}.`];
	for (const [index, item] of page.items.entries()) {
		lines.push(`${index + 1}. ${item.status} / ${item.current_phase}`, `   Simulation: ${item.id}`, `   Firmware: ${item.firmware_id}`);
	}
	return lines.join("\n");
}

const SimulationAction = Type.Union([
	Type.Object({
		action: Type.Literal("start"),
		firmware_id: Type.String({ minLength: 1 }),
		target: Type.Optional(StringEnum(["guest_executable", "network_reachable", "web_ready"] as const)),
		ttl_seconds: Type.Optional(Type.Integer({ minimum: 300, maximum: 86400 })),
		extraction_run_id: Type.Optional(Type.String()),
		recovery_policy: Type.Optional(StringEnum(["disabled", "automatic", "recipe_only"] as const)),
		recovery_provider: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
		max_recovery_attempts: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
	}),
	Type.Object({
		action: Type.Literal("list"),
		firmware_id: Type.Optional(Type.String()),
		status: Type.Optional(
			StringEnum(
				["queued", "starting", "running", "waiting_agent", "waiting_recovery", "waiting_runtime_stop", "succeeded", "failed", "cancelled", "stopped"] as const,
			),
		),
		created_from: Type.Optional(Type.String({ format: "date-time" })),
		created_to: Type.Optional(Type.String({ format: "date-time" })),
		sort: Type.Optional(StringEnum(["created_desc", "created_asc"] as const)),
		page: Type.Optional(Type.Integer({ minimum: 1 })),
		page_size: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	}),
	Type.Object({ action: Type.Literal("get"), simulation_id: Type.String({ minLength: 1 }) }),
]);

export function registerSimulationTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "firmee_simulation",
		label: "FirmEE Simulation",
		description: "Start a firmware simulation, list simulation tasks, or inspect one simulation and its Runtime endpoints.",
		parameters: SimulationAction,
		outputSchema: ToolOutput,
		namespace: firmeeNamespace,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
		async execute(_id, params, signal, _update, ctx) {
			return runTool(`simulation_${params.action}`, async () => {
				const { client } = await clientFor(ctx);
				if (params.action === "get") {
					const value = await client.getSimulation(params.simulation_id, signal);
					return { summary: formatSimulation(value), data: value };
				}
				if (params.action === "list") {
					const { action: _action, ...query } = params;
					const page = await client.listSimulations(query, signal);
					return { summary: formatSimulationPage(page), data: page };
				}
				const { action: _action, firmware_id, ...request } = params;
				const value = await client.startSimulation(requireOperationalFirmwareId(firmware_id), request, signal);
				return { summary: formatSimulation(value), data: value };
			});
		},
	});

	pi.registerTool({
		name: "firmee_simulation_wait",
		label: "Wait for FirmEE Simulation",
		description: "Wait for simulation events until Runtime publication, terminal failure, cancellation, or timeout.",
		parameters: Type.Object({
			simulation_id: Type.String({ minLength: 1 }),
			after_sequence: Type.Optional(Type.Integer({ minimum: 0 })),
			timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
		}),
		outputSchema: ToolOutput,
		namespace: firmeeNamespace,
		annotations: { readOnlyHint: true, openWorldHint: true },
		async execute(_id, params, signal, onUpdate, ctx) {
			return runTool("simulation_wait", async () => {
				const { client, config } = await clientFor(ctx);
				const result = await waitForSimulation({
					client,
					simulationId: params.simulation_id,
					afterSequence: params.after_sequence ?? 0,
					timeoutSeconds: params.timeout_seconds ?? Math.max(1, Math.floor(config.taskWaitTimeoutMs / 1000)),
					...(signal ? { parentSignal: signal } : {}),
					...(onUpdate ? { onUpdate } : {}),
				});
				return {
					summary: `${formatSimulation(result.simulation)}\nEvents received: ${result.events.length}\nLast sequence: ${result.lastSequence}\nTimed out: ${result.timedOut}`,
					data: result,
				};
			});
		},
	});

	pi.registerTool({
		name: "firmee_simulation_cancel",
		label: "Cancel FirmEE Simulation",
		description: "Request cancellation for one active FirmEE simulation.",
		exposure: "deferred",
		parameters: Type.Object({ simulation_id: Type.String({ minLength: 1 }) }),
		outputSchema: ToolOutput,
		namespace: firmeeNamespace,
		executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
		async execute(_id, params, signal, _update, ctx) {
			return runTool("simulation_cancel", async () => {
				const { client } = await clientFor(ctx);
				const value = await client.cancelSimulation(params.simulation_id, signal);
				return { summary: formatSimulation(value), data: value };
			});
		},
	});
}
