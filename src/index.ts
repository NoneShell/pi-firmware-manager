import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { FirmeeClient, describeError } from "./client.ts";
import { defaultUserConfigPath, loadConfig, saveUserConfig } from "./config.ts";
import { formatStatus } from "./format.ts";
import { RuntimeTerminal } from "./terminal.ts";
import { registerFirmeeTools } from "./tools.ts";

async function showStatus(ctx: ExtensionCommandContext): Promise<void> {
	try {
		const config = await loadConfig({ cwd: ctx.cwd });
		const client = new FirmeeClient(config);
		const [health, capabilities] = await Promise.all([client.liveness(), client.capabilities()]);
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

async function openTerminal(ctx: ExtensionCommandContext, runtimeId: string | undefined): Promise<void> {
	if (!runtimeId) {
		ctx.ui.notify("Usage: /firmee terminal <runtime_id>", "warning");
		return;
	}
	const config = await loadConfig({ cwd: ctx.cwd });
	const terminal = await RuntimeTerminal.connect(new FirmeeClient(config), runtimeId);
	ctx.ui.notify(`FirmEE terminal connected to ${runtimeId}. Submit a blank command or 'exit' to close.`, "info");
	try {
		while (true) {
			const command = await ctx.ui.input(`FirmEE terminal · ${runtimeId}`, "command, blank, or exit");
			if (!command || command.trim().toLowerCase() === "exit") break;
			const result = await terminal.execute(command);
			const output = [
				`exit: ${result.exit_code ?? "—"} · ${result.duration_ms} ms · ${result.channel}`,
				result.stdout ? `stdout:\n${result.stdout.slice(0, 12000)}` : "",
				result.stderr ? `stderr:\n${result.stderr.slice(0, 12000)}` : "",
			].filter(Boolean);
			ctx.ui.notify(output.join("\n"), result.exit_code === 0 ? "info" : "warning");
		}
	} finally {
		await terminal.close();
		ctx.ui.notify("FirmEE terminal closed.", "info");
	}
}

export default function firmeeExtension(pi: ExtensionAPI): void {
	registerFirmeeTools(pi);

	pi.registerCommand("firmee", {
		description: "Configure FirmEE, inspect status, or open a Runtime terminal: /firmee [status|diagnose|terminal|config|show|docs]",
		handler: async (args, ctx) => {
			const [subcommand = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			switch (subcommand) {
				case "status":
					await showStatus(ctx);
					break;
				case "diagnose": {
					try {
						const config = await loadConfig({ cwd: ctx.cwd });
						const readiness = await new FirmeeClient(config).readiness();
						ctx.ui.notify(
							[
								`FirmEE readiness: ${readiness.status}`,
								...readiness.checks.map(
									(check) => `${check.required ? "required" : "optional"} ${check.name}: ${check.status} (${check.latency_ms} ms) — ${check.detail}`,
								),
							].join("\n"),
							readiness.status === "ready" ? "info" : "warning",
						);
					} catch (error) {
						ctx.ui.notify(describeError(error), "error");
					}
					break;
				}
				case "terminal":
					try {
						await openTerminal(ctx, rest[0]);
					} catch (error) {
						ctx.ui.notify(describeError(error), "error");
					}
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
					ctx.ui.notify("Usage: /firmee [status|diagnose|terminal <runtime_id>|config [URL]|show|docs]", "warning");
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
