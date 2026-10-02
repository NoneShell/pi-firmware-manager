import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, normalizeBaseUrl } from "../src/config.ts";

test("normalizeBaseUrl accepts HTTP and removes trailing slash", () => {
	assert.equal(normalizeBaseUrl("http://example.test:8000/"), "http://example.test:8000");
	assert.throws(() => normalizeBaseUrl("file:///tmp/firmee"), /http/);
});

test("config merges user, project, and environment values", async () => {
	const root = await mkdtemp(join(tmpdir(), "firmee-config-"));
	const userPath = join(root, "user.json");
	const cwd = join(root, "project");
	await mkdir(join(cwd, ".pi"), { recursive: true });
	await writeFile(userPath, JSON.stringify({ baseUrl: "http://user.test:8000", requestTimeoutMs: 1000 }));
	await writeFile(join(cwd, ".pi", "firmee.json"), JSON.stringify({ requestTimeoutMs: 2000 }));
	const config = await loadConfig({
		cwd,
		userConfigPath: userPath,
		env: { FIRMEE_BASE_URL: "http://env.test:9000" },
	});
	assert.equal(config.baseUrl, "http://env.test:9000");
	assert.equal(config.requestTimeoutMs, 2000);
});
