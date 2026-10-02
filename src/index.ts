import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { FirmeeClient, describeError } from "./client.ts";
import { defaultUserConfigPath, loadConfig, saveUserConfig } from "./config.ts";
import { formatStatus } from "./format.ts";
import { registerFirmeeTools } from "./tools.ts";

async function showStatus(ctx: ExtensionCommandContext): Promise<void> {
	try {
		const config = await loadConfig({ cwd: ctx.cwd });
		const client = new FirmeeClient(config);
		const [health, capabilities] = await Promise.all([client.health(), client.capabilities()]);
		if (health.status !== "ok") throw new Error(`FirmEE health status is ${health.status}`);
		ctx.ui.notify(formatStatus(capabilities, config.baseUrl), "info");
		ctx.ui.setStatus("firmee", `FirmEE ${capabilities.api_version} · ${new URL(config.baseUrl).host}`);
	} catch (error) {
		ctx.ui.notify(describeError(error), "error");
		ctx.ui.setStatus("firmee", "FirmEE unavailable");
	}
}

async function configure(ctx: ExtensionCommandContext, providedUrl: string | undefined): Promise<void> {
	const current = await loadConfig({ cwd: ctx.cwd });
	const baseUrl =
		providedUrl?.trim() ||
		(await ctx.ui.input("FirmEE Service URL", current.baseUrl));
	if (!baseUrl) return;
	const downloadDirectory = await ctx.ui.input("Default artifact download directory", current.downloadDirectory);
	if (!downloadDirectory) return;
	try {
		const saved = await saveUserConfig({ baseUrl, downloadDirectory });
		ctx.ui.notify(`Saved FirmEE config to ${defaultUserConfigPath()}\nEndpoint: ${saved.baseUrl}`, "info");
		await showStatus(ctx);
	} catch (error) {
		ctx.ui.notify(describeError(error), "error");
	}
}

export default function firmeeExtension(pi: ExtensionAPI): void {
	registerFirmeeTools(pi);

	pi.registerCommand("firmee", {
		description: "Configure FirmEE or inspect service status: /firmee [status|config|show|docs]",
		handler: async (args, ctx) => {
			const [subcommand = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			switch (subcommand) {
				case "status":
					await showStatus(ctx);
					break;
				case "config":
					await configure(ctx, rest[0]);
					break;
				case "show": {
					const config = await loadConfig({ cwd: ctx.cwd });
					ctx.ui.notify(
						[
							`Endpoint: ${config.baseUrl}`,
							`Downloads: ${config.downloadDirectory}`,
							`Request timeout: ${config.requestTimeoutMs} ms`,
							`Task wait timeout: ${config.taskWaitTimeoutMs} ms`,
						].join("\n"),
						"info",
					);
					break;
				}
				case "docs": {
					const config = await loadConfig({ cwd: ctx.cwd });
					ctx.ui.notify(`${config.baseUrl}/docs`, "info");
					break;
				}
				default:
					ctx.ui.notify("Usage: /firmee [status|config [URL]|show|docs]", "warning");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const config = await loadConfig({ cwd: ctx.cwd });
		ctx.ui.setStatus("firmee", `FirmEE · ${new URL(config.baseUrl).host}`);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus("firmee", undefined);
	});
}
