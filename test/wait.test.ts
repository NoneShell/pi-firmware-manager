import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import firmeeExtension from "../src/index.ts";

test("extraction wait follows SSE to a terminal state", async () => {
	let terminal = false;
	const server = createServer((request, response) => {
		if (request.url === "/api/v1/extractions/run-1") {
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify({
					id: "run-1",
					firmware_id: "firmware-1",
					status: terminal ? "extracted" : "extracting",
					phase: terminal ? "succeeded" : "artifact_validation",
					recovery_provider: "pi",
					agent_attempts: 0,
					failure_code: null,
					failure_detail: null,
					result: {},
					cancel_requested: false,
					created_at: "2026-10-02T00:00:00Z",
					started_at: "2026-10-02T00:00:00Z",
					finished_at: terminal ? "2026-10-02T00:00:01Z" : null,
				}),
			);
			return;
		}
		if (request.url?.startsWith("/api/v1/extractions/run-1/events/stream")) {
			terminal = true;
			response.setHeader("content-type", "text/event-stream");
			response.end('id: 7\nevent: workflow.transition\ndata: {"sequence":7,"event_type":"workflow.transition","payload":{"to":"succeeded"},"created_at":"2026-10-02T00:00:01Z"}\n\n');
			return;
		}
		response.statusCode = 404;
		response.end();
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
		const result = await tools.get("firmee_extraction_wait")?.execute(
			"wait-1",
			{ extraction_id: "run-1", timeout_seconds: 5 },
			undefined,
			undefined,
			{ cwd: process.cwd() },
		);
		assert.equal(result.isError ?? false, false);
		assert.equal(result.structuredContent.data.extraction.status, "extracted");
		assert.equal(result.structuredContent.data.lastSequence, 7);
		assert.equal(result.structuredContent.data.timedOut, false);
	} finally {
		if (previousUrl === undefined) delete process.env.FIRMEE_BASE_URL;
		else process.env.FIRMEE_BASE_URL = previousUrl;
		await new Promise<void>((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())));
	}
});
