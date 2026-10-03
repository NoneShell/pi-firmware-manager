import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { describeError, type FirmeeClient } from "./client.ts";
import { sleep, type ToolEnvelope } from "./toolkit.ts";
import type { ExportWaitResult, SimulationEvent, SimulationView, SimulationWaitResult } from "./types.ts";

function simulationTerminal(value: SimulationView): boolean {
	return value.status === "succeeded" || value.status === "failed" || value.status === "cancelled" || value.status === "stopped";
}

export async function waitForSimulation(options: {
	client: FirmeeClient;
	simulationId: string;
	afterSequence: number;
	timeoutSeconds: number;
	parentSignal?: AbortSignal;
	onUpdate?: AgentToolUpdateCallback<ToolEnvelope>;
}): Promise<SimulationWaitResult> {
	let simulation = await options.client.getSimulation(options.simulationId, options.parentSignal);
	if (simulationTerminal(simulation)) {
		return { simulation, events: [], lastSequence: options.afterSequence, timedOut: false };
	}
	const deadline = Date.now() + options.timeoutSeconds * 1000;
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort(new DOMException("FirmEE simulation wait interval elapsed", "TimeoutError"));
	}, options.timeoutSeconds * 1000);
	const abort = () => controller.abort(options.parentSignal?.reason);
	if (options.parentSignal?.aborted) abort();
	else options.parentSignal?.addEventListener("abort", abort, { once: true });
	const events: SimulationEvent[] = [];
	let lastSequence = options.afterSequence;
	let streamWarning: string | undefined;
	let terminalEvent = false;
	try {
		lastSequence = await options.client.streamSimulationEvents(
			options.simulationId,
			lastSequence,
			controller.signal,
			async (event) => {
				events.push(event);
				if (events.length > 50) events.shift();
				lastSequence = Math.max(lastSequence, event.sequence);
				options.onUpdate?.({
					content: [{ type: "text", text: `FirmEE simulation event ${event.sequence}: ${event.event_type}` }],
					details: { ok: true, operation: "simulation_wait", summary: event.event_type, data: event },
				});
				const payload = event.payload as Record<string, unknown>;
				if (
					(event.event_type === "workflow.transition" && ["succeeded", "failed", "cancelled"].includes(String(payload.to))) ||
					["simulation.succeeded", "simulation.failed", "simulation.cancelled"].includes(event.event_type)
				) {
					terminalEvent = true;
					controller.abort(new DOMException("FirmEE simulation reached a terminal state", "AbortError"));
				}
			},
		);
	} catch (error) {
		if (options.parentSignal?.aborted) throw error;
		if (!timedOut && !terminalEvent) streamWarning = describeError(error);
	} finally {
		clearTimeout(timer);
		options.parentSignal?.removeEventListener("abort", abort);
	}
	simulation = await options.client.getSimulation(options.simulationId, options.parentSignal);
	while (!simulationTerminal(simulation) && !timedOut && Date.now() < deadline) {
		await sleep(Math.min(2000, Math.max(1, deadline - Date.now())), options.parentSignal);
		const additions = await options.client.listSimulationEvents(options.simulationId, lastSequence, 100, options.parentSignal);
		for (const event of additions) {
			events.push(event);
			if (events.length > 50) events.shift();
			lastSequence = Math.max(lastSequence, event.sequence);
		}
		simulation = await options.client.getSimulation(options.simulationId, options.parentSignal);
	}
	return {
		simulation,
		events,
		lastSequence,
		timedOut: !simulationTerminal(simulation),
		...(streamWarning ? { streamWarning } : {}),
	};
}

export async function waitForExport(options: {
	client: FirmeeClient;
	jobId: string;
	timeoutSeconds: number;
	signal?: AbortSignal;
}): Promise<ExportWaitResult> {
	const deadline = Date.now() + options.timeoutSeconds * 1000;
	let job = await options.client.getExportJob(options.jobId, options.signal);
	while (job.status !== "succeeded" && job.status !== "failed" && Date.now() < deadline) {
		await sleep(Math.min(2000, Math.max(1, deadline - Date.now())), options.signal);
		job = await options.client.getExportJob(options.jobId, options.signal);
	}
	return { job, timedOut: job.status !== "succeeded" && job.status !== "failed" };
}
