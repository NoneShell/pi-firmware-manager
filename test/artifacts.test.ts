import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { downloadExtractionArtifact } from "../src/artifacts.ts";
import { FirmeeClient } from "../src/client.ts";
import type { FirmeeConfig } from "../src/config.ts";

test("artifact download resumes a partial file and verifies rootfs SHA-256", async () => {
	const payload = Buffer.from("mock-rootfs-payload-for-range-resume");
	const sha256 = createHash("sha256").update(payload).digest("hex");
	let observedRange = "";
	const server = createServer((request, response) => {
		if (request.url === "/api/v1/extractions/run-1") {
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify({
					id: "run-1",
					firmware_id: "firmware-1",
					status: "extracted",
					phase: "succeeded",
					recovery_provider: "pi",
					agent_attempts: 0,
					failure_code: null,
					failure_detail: null,
					result: { rootfs_sha256: sha256 },
					cancel_requested: false,
					created_at: "2026-10-02T00:00:00Z",
					started_at: "2026-10-02T00:00:00Z",
					finished_at: "2026-10-02T00:00:01Z",
				}),
			);
			return;
		}
		if (request.url === "/api/v1/extractions/run-1/artifacts/rootfs") {
			const range = request.headers.range ?? "";
			response.setHeader("accept-ranges", "bytes");
			response.setHeader("etag", '"rootfs-etag"');
			response.setHeader("content-disposition", 'attachment; filename="rootfs.tar.gz"');
			if (range === "bytes=0-0") {
				response.statusCode = 206;
				response.setHeader("content-range", `bytes 0-0/${payload.length}`);
				response.end(payload.subarray(0, 1));
				return;
			}
			observedRange = range;
			const offset = Number(range.slice("bytes=".length, -1));
			response.statusCode = 206;
			response.setHeader("content-range", `bytes ${offset}-${payload.length - 1}/${payload.length}`);
			response.end(payload.subarray(offset));
			return;
		}
		response.statusCode = 404;
		response.end();
	});
	await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("mock server did not bind");
	const directory = await mkdtemp(join(tmpdir(), "firmee-artifact-"));
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, ".run-1-rootfs.part"), payload.subarray(0, 7));
	await writeFile(
		join(directory, ".run-1-rootfs.part.json"),
		JSON.stringify({ etag: '"rootfs-etag"', filename: "rootfs.tar.gz", totalBytes: payload.length }),
	);
	const config: FirmeeConfig = {
		baseUrl: `http://127.0.0.1:${address.port}`,
		requestTimeoutMs: 5000,
		taskWaitTimeoutMs: 5000,
		transferTimeoutMs: 5000,
		downloadDirectory: directory,
	};
	try {
		const result = await downloadExtractionArtifact({
			client: new FirmeeClient(config),
			config,
			extractionId: "run-1",
			kind: "rootfs",
		});
		assert.equal(observedRange, "bytes=7-");
		assert.equal(result.resumed, true);
		assert.equal(result.sha256, sha256);
		assert.deepEqual(await readFile(result.path), payload);
	} finally {
		await new Promise<void>((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())));
	}
});
