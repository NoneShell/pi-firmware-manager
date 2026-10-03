import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clientFor, firmeeNamespace, runTool, ToolOutput } from "../toolkit.ts";

export function registerRecipeTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "firmee_recipe",
		label: "Inspect FirmEE Recipes",
		description: "List verified extraction or Runtime recipe revisions associated with one Service firmware.",
		exposure: "deferred",
		parameters: Type.Object({
			kind: StringEnum(["extraction", "runtime"] as const),
			firmware_id: Type.String({ minLength: 1 }),
		}),
		outputSchema: ToolOutput,
		namespace: firmeeNamespace,
		annotations: { readOnlyHint: true, openWorldHint: true },
		async execute(_id, params, signal, _update, ctx) {
			return runTool("recipe_list", async () => {
				const { client } = await clientFor(ctx);
				const recipes =
					params.kind === "runtime"
						? await client.listRuntimeRecipes(params.firmware_id, signal)
						: await client.listExtractionRecipes(params.firmware_id, signal);
				return {
					summary: `Found ${recipes.length} ${params.kind} recipe revisions for firmware ${params.firmware_id}.`,
					data: recipes,
				};
			});
		},
	});

	pi.registerTool({
		name: "firmee_recipe_control",
		label: "Control FirmEE Recipe",
		description: "Activate or disable an exact extraction/Runtime recipe revision with an explicit reason.",
		exposure: "deferred",
		parameters: Type.Object({
			kind: StringEnum(["extraction", "runtime"] as const),
			action: StringEnum(["activate", "disable"] as const),
			revision_id: Type.String({ minLength: 1 }),
			reason: Type.String({ minLength: 1, maxLength: 2000 }),
		}),
		outputSchema: ToolOutput,
		namespace: firmeeNamespace,
		executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
		async execute(_id, params, signal, _update, ctx) {
			return runTool("recipe_control", async () => {
				const { client } = await clientFor(ctx);
				const recipe = await client.recipeLifecycle(params.kind, params.revision_id, params.action, params.reason, signal);
				return {
					summary: `${params.action === "activate" ? "Activated" : "Disabled"} ${params.kind} recipe ${params.revision_id}.`,
					data: recipe,
				};
			});
		},
	});
}
