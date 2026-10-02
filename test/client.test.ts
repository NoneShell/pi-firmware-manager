import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { FirmeeApiError, FirmeeClient } from "../src/client.ts";
import type { FirmeeConfig } from "../src/config.ts";

async function mockServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
	const server = createServer((request, response) => {
		if (request.url === "/health") {
			response.setHeader("content-type", "application/json");
			response.end('{"status":"ok"}');
			return;
		}
		if (request.url?.startsWith("/api/v1/firmwares/search")) {
			response.setHeader("content-type", "application/json");
			response.end('{"items":[],"total":0,"page":1,"page_size":25,"page_count":0}');
			return;
		}
		if (request.url === "/api/v1/firmwares/missing") {
			response.statusCode = 404;
			response.setHeader("content-type", "application/json");
			response.setHeader("x-request-id", "request-1");
			response.end('{"code":"firmware_not_found","detail":"firmware not found","request_id":"request-1","errors":[],"context":{}}');
			return;
		}
		if (request.url?.startsWith("/api/v1/extractions/run-1/events/stream")) {
			response.setHeader("content-type", "text/event-stream");
			response.end('id: 3\nevent: workflow.transition\ndata: {"sequence":3,"event_type":"workflow.transition","payload":{"to":"succeeded"},"created_at":"2026-10-02T00:00:00Z"}\n\n');
			return;
		}
		response.statusCode = 404;
		response.end();
	});
	await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("mock server did not bind");
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: () => new Promise<void>((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise()))),
	};
}

function config(baseUrl: string): FirmeeConfig {
	return {
		baseUrl,
		requestTimeoutMs: 5000,
		taskWaitTimeoutMs: 5000,
		transferTimeoutMs: 5000,
		downloadDirectory: "/tmp",
	};
}

test("client handles JSON, query parameters, API errors, and SSE", async () => {
	const server = await mockServer();
	try {
		const client = new FirmeeClient(config(server.baseUrl));
		assert.deepEqual(await client.health(), { status: "ok" });
		assert.equal((await client.searchFirmware({ page: 1, page_size: 25 })).total, 0);
		await assert.rejects(
			client.getFirmware("missing", false),
			(error: unknown) =>
				error instanceof FirmeeApiError &&
				error.status === 404 &&
				error.code === "firmware_not_found" &&
				error.requestId === "request-1",
		);
		const events: unknown[] = [];
		const last = await client.streamExtractionEvents("run-1", 0, new AbortController().signal, (event) => {
			events.push(event);
		});
		assert.equal(last, 3);
		assert.equal(events.length, 1);
	} finally {
		await server.close();
	}
});
