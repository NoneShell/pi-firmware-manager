import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatFirmware } from "../format.ts";
import { clientFor, firmeeNamespace, runTool, ToolOutput } from "../toolkit.ts";

export function registerFirmwareWorkflowTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "firmee_firmware_adopt",
		label: "Adopt FirmEE Firmware",
		description: "Adopt a FirmEE CLI catalog IID into Service storage so it can be inspected, extracted, and simulated.",
		parameters: Type.Object({
			firmee_iid: Type.Integer({ minimum: 1 }),
			source_path: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
			notes: Type.Optional(Type.String({ maxLength: 4000 })),
		}),
		outputSchema: ToolOutput,
		namespace: firmeeNamespace,
		executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
		async execute(_id, params, signal, _update, ctx) {
			return runTool("firmware_adopt", async () => {
				const { client } = await clientFor(ctx);
				const result = await client.adoptFirmware(
					params.firmee_iid,
					{
						...(params.source_path ? { source_path: params.source_path } : {}),
						...(params.notes ? { notes: params.notes } : {}),
					},
					signal,
				);
				return {
					summary: `${result.reused ? "Reused" : "Adopted"} FirmEE IID ${result.firmee_iid}.\n${formatFirmware(result.firmware)}`,
					data: result,
				};
			});
		},
	});
}
