import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import firmeeExtension from "../src/index.ts";

test("firmware upload tool streams multipart metadata and returns structured content", async () => {
	const bytes = Buffer.from("mock-firmware-binary");
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	let multipartBody = "";
	const server = createServer(async (request, response) => {
		if (request.method === "POST" && request.url === "/api/v1/firmwares") {
			assert.match(request.headers["content-type"] ?? "", /^multipart\/form-data; boundary=/);
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(chunk as Buffer);
			multipartBody = Buffer.concat(chunks).toString("latin1");
			response.statusCode = 201;
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify({
					firmware: {
						id: "firmware-1",
						sha256,
						md5: "00000000000000000000000000000000",
						original_filename: "firmware.bin",
						size_bytes: bytes.length,
						brand: "ASUS",
						product: "RT-TEST",
						version: "1.0",
						source_type: null,
						source_name: null,
						source_url: null,
						source_page_url: null,
						hardware_revision: null,
						region: null,
						language: null,
						build: null,
						release_date: null,
						notes: null,
						created_at: "2026-10-02T00:00:00Z",
						updated_at: "2026-10-02T00:00:00Z",
					},
					reused: false,
					metadata_conflicts: {},
				}),
			);
			return;
		}
		response.statusCode = 404;
		response.end();
	});
	await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("mock server did not bind");
	const directory = await mkdtemp(join(tmpdir(), "firmee-upload-"));
	await writeFile(join(directory, "firmware.bin"), bytes);
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
		const tool = tools.get("firmee_firmware_upload");
		assert.ok(tool);
		const result = await tool.execute(
			"upload-1",
			{ path: "firmware.bin", brand: "ASUS", product: "RT-TEST", version: "1.0" },
			undefined,
			undefined,
			{ cwd: directory },
		);
		assert.equal(result.isError ?? false, false);
		assert.equal(result.structuredContent.data.local_sha256, sha256);
		assert.match(multipartBody, /name="brand"/);
		assert.match(multipartBody, /ASUS/);
		assert.match(multipartBody, /filename="firmware.bin"/);
	} finally {
		if (previousUrl === undefined) delete process.env.FIRMEE_BASE_URL;
		else process.env.FIRMEE_BASE_URL = previousUrl;
		await new Promise<void>((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())));
	}
});
