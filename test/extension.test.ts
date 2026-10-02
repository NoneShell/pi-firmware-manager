import assert from "node:assert/strict";
import test from "node:test";
import firmeeExtension from "../src/index.ts";

test("extension registers the first-version commands and tools", () => {
	const tools: string[] = [];
	const commands: string[] = [];
	const events: string[] = [];
	const mock = {
		registerTool(tool: { name: string }) {
			tools.push(tool.name);
		},
		registerCommand(name: string) {
			commands.push(name);
		},
		on(name: string) {
			events.push(name);
			return () => {};
		},
	};
	firmeeExtension(mock as never);
	assert.deepEqual(commands, ["firmee"]);
	assert.deepEqual(tools, [
		"firmee_status",
		"firmee_firmware_search",
		"firmee_firmware_get",
		"firmee_firmware_upload",
		"firmee_firmware_update",
		"firmee_extraction_start",
		"firmee_extraction_list",
		"firmee_extraction_get",
		"firmee_extraction_wait",
		"firmee_extraction_cancel",
		"firmee_artifact_download",
	]);
	assert.deepEqual(events, ["session_start", "session_shutdown"]);
});
