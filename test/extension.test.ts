import assert from "node:assert/strict";
import test from "node:test";
import firmeeExtension from "../src/index.ts";

test("extension registers core and deferred workflow tools", () => {
	const tools: string[] = [];
	const exposures = new Map<string, string>();
	const commands: string[] = [];
	const events: string[] = [];
	const mock = {
		registerTool(tool: { name: string; exposure?: string }) {
			tools.push(tool.name);
			exposures.set(tool.name, tool.exposure ?? "direct");
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
		"firmee_firmware_adopt",
		"firmee_platform_diagnose",
		"firmee_simulation",
		"firmee_simulation_wait",
		"firmee_simulation_cancel",
		"firmee_runtime",
		"firmee_runtime_control",
		"firmee_runtime_exec",
		"firmee_runtime_file",
		"firmee_export",
		"firmee_recipe",
		"firmee_recipe_control",
	]);
	assert.equal([...exposures.values()].filter((value) => value === "direct").length, 14);
	assert.equal([...exposures.values()].filter((value) => value === "deferred").length, 9);
	assert.deepEqual(events, ["session_start", "session_shutdown"]);
});
