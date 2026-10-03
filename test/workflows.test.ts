import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import firmeeExtension from "../src/index.ts";

const firmware = {
	id: "firmware-1",
	sha256: "1".repeat(64),
	md5: "2".repeat(32),
	original_filename: "firmware.bin",
	size_bytes: 123,
	brand: "test",
	product: "router",
	version: "1.0",
	source_type: "firmee_cli",
	source_name: "FirmEE CLI",
	source_url: null,
	source_page_url: null,
	hardware_revision: null,
	region: null,
	language: null,
	build: null,
	release_date: null,
	notes: null,
	created_at: "2026-10-03T00:00:00Z",
	updated_at: "2026-10-03T00:00:00Z",
};

function simulation(terminal: boolean) {
	return {
		id: "simulation-1",
		firmware_id: "firmware-1",
		extraction_run_id: "extraction-1",
		binding_id: terminal ? "binding-1" : null,
		status: terminal ? "succeeded" : "running",
		current_phase: terminal ? "succeeded" : "start_qemu",
		target: "guest_executable",
		control_source_runtime_id: null,
		control_action: null,
		policy_snapshot: {},
		result: {},
		failure_code: null,
		failure_detail: null,
		cancel_requested: false,
		runtime: terminal
			? {
				id: "runtime-1",
				simulation_run_id: "simulation-1",
				firmware_id: "firmware-1",
				status: "running",
				readiness_level: "guest_executable",
				legacy_iid: 62,
				runtime_backend: "rescue",
				primary_ip: "198.18.0.2",
				ips: ["198.18.0.2"],
				guest_exec: {},
				firmware_root: "/firmware",
				ping_probe: {},
				rescue_tools: {},
				ping_ok: true,
				web_ok: false,
				endpoints: [],
				published_at: "2026-10-03T00:00:01Z",
				expires_at: "2026-10-03T01:00:01Z",
				heartbeat_at: "2026-10-03T00:00:01Z",
				stopped_at: null,
				created_at: "2026-10-03T00:00:00Z",
				updated_at: "2026-10-03T00:00:01Z",
			}
			: null,
		created_at: "2026-10-03T00:00:00Z",
		started_at: "2026-10-03T00:00:00Z",
		finished_at: terminal ? "2026-10-03T00:00:01Z" : null,
	};
}

test("adoption, simulation wait, Runtime exec, export, and Recipe workflows compose API calls", async () => {
	let simulationTerminal = false;
	let released = false;
	let exportReads = 0;
	const server = createServer(async (request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.method === "POST" && request.url === "/api/v1/firmwares/imports/firmee/62") {
			response.statusCode = 201;
			response.end(JSON.stringify({ firmware, firmee_iid: 62, reused: false, source_path: "/legacy/fw.bin", md5_verified: true }));
			return;
		}
		if (request.method === "POST" && request.url === "/api/v1/firmwares/firmware-1/simulations") {
			response.statusCode = 202;
			response.end(JSON.stringify(simulation(false)));
			return;
		}
		if (request.method === "GET" && request.url === "/api/v1/simulations/simulation-1") {
			response.end(JSON.stringify(simulation(simulationTerminal)));
			return;
		}
		if (request.method === "GET" && request.url?.startsWith("/api/v1/simulations/simulation-1/events/stream")) {
			simulationTerminal = true;
			response.setHeader("content-type", "text/event-stream");
			response.write('id: 4\nevent: workflow.transition\ndata: {"sequence":4,"event_type":"workflow.transition","payload":{"to":"succeeded"},"created_at":"2026-10-03T00:00:01Z"}\n\n');
			return;
		}
		if (request.method === "POST" && request.url === "/api/v1/runtimes/runtime-1/sessions") {
			response.statusCode = 201;
			response.end(JSON.stringify({ id: "session-1", runtime_id: "runtime-1", client_label: "pi-firmware-manager", created_at: "2026-10-03T00:00:00Z", expires_at: "2026-10-03T00:10:00Z", last_activity_at: "2026-10-03T00:00:00Z", released_at: null }));
			return;
		}
		if (request.method === "POST" && request.url === "/api/v1/runtimes/runtime-1/exec") {
			response.end(JSON.stringify({ operation_id: "op-1", exit_code: 0, stdout: "Linux mock", stderr: "", stdout_truncated: false, stderr_truncated: false, duration_ms: 4, channel: "guest" }));
			return;
		}
		if (request.method === "DELETE" && request.url === "/api/v1/runtimes/runtime-1/sessions/session-1") {
			released = true;
			response.statusCode = 204;
			response.end();
			return;
		}
		if (request.method === "POST" && request.url === "/api/v1/simulations/simulation-1/exports/local/jobs") {
			response.statusCode = 202;
			response.end(JSON.stringify({ id: "job-1", simulation_run_id: "simulation-1", kind: "local", status: "queued", progress: 0, phase: "queued", filename: null, size_bytes: null, sha256: null, backend: null, source_firmware: {}, verification: {}, failure_code: null, failure_detail: null, created_at: "2026-10-03T00:00:00Z", started_at: null, finished_at: null, updated_at: "2026-10-03T00:00:00Z", download_url: null }));
			return;
		}
		if (request.method === "GET" && request.url === "/api/v1/export-jobs/job-1") {
			exportReads++;
			response.end(JSON.stringify({ id: "job-1", simulation_run_id: "simulation-1", kind: "local", status: "succeeded", progress: 100, phase: "complete", filename: "export.tar.gz", size_bytes: 10, sha256: "3".repeat(64), backend: "local", source_firmware: {}, verification: {}, failure_code: null, failure_detail: null, created_at: "2026-10-03T00:00:00Z", started_at: "2026-10-03T00:00:00Z", finished_at: "2026-10-03T00:00:01Z", updated_at: "2026-10-03T00:00:01Z", download_url: "/download" }));
			return;
		}
		if (request.method === "GET" && request.url === "/api/v1/firmwares/firmware-1/runtime-recipes") {
			response.end("[]");
			return;
		}
		response.statusCode = 404;
		response.end(JSON.stringify({ code: "not_found", detail: request.url, request_id: "test", errors: [], context: {} }));
	});
	await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("mock server did not bind");
	const previousUrl = process.env.FIRMEE_BASE_URL;
	process.env.FIRMEE_BASE_URL = `http://127.0.0.1:${address.port}`;
	try {
		const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
		firmeeExtension({
			registerTool(tool: { name: string; execute: (...args: any[]) => Promise<any> }) {
				tools.set(tool.name, tool);
			},
			registerCommand() {},
			on() {
				return () => {};
			},
		} as never);
		const call = (name: string, params: unknown) => tools.get(name)?.execute(name, params, undefined, undefined, { cwd: process.cwd() });
		const adopted = await call("firmee_firmware_adopt", { firmee_iid: 62 });
		assert.equal(adopted.structuredContent.data.firmware.id, "firmware-1");
		const started = await call("firmee_simulation", { action: "start", firmware_id: "firmware-1", target: "guest_executable", recovery_policy: "disabled" });
		assert.equal(started.structuredContent.data.id, "simulation-1");
		const waited = await call("firmee_simulation_wait", { simulation_id: "simulation-1", timeout_seconds: 5 });
		assert.equal(waited.structuredContent.data.simulation.status, "succeeded");
		const executed = await call("firmee_runtime_exec", { runtime_id: "runtime-1", command: "uname -a" });
		assert.match(executed.structuredContent.summary, /Linux mock/);
		assert.equal(released, true);
		const exportCreated = await call("firmee_export", { action: "create", simulation_id: "simulation-1", kind: "local" });
		assert.equal(exportCreated.structuredContent.data.id, "job-1");
		const exportWaited = await call("firmee_export", { action: "wait", job_id: "job-1", timeout_seconds: 5 });
		assert.equal(exportWaited.structuredContent.data.job.status, "succeeded");
		assert.equal(exportReads, 1);
		const recipes = await call("firmee_recipe", { kind: "runtime", firmware_id: "firmware-1" });
		assert.deepEqual(recipes.structuredContent.data, []);
	} finally {
		if (previousUrl === undefined) delete process.env.FIRMEE_BASE_URL;
		else process.env.FIRMEE_BASE_URL = previousUrl;
		await new Promise<void>((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())));
	}
});
