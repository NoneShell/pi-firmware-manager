import type {
	ApiCapabilities,
	DownloadResult,
	ExtractionPage,
	ExtractionRun,
	FirmwareArchiveView,
	FirmwareSearchPage,
	FirmwareUploadResult,
	FirmwareView,
	WaitResult,
} from "./types.ts";

function text(value: unknown, fallback = "—"): string {
	return value === null || value === undefined || value === "" ? fallback : String(value);
}

function bytes(value: unknown): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return "—";
	const units = ["B", "KiB", "MiB", "GiB"];
	let current = value;
	let unit = 0;
	while (current >= 1024 && unit < units.length - 1) {
		current /= 1024;
		unit++;
	}
	return `${current.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatStatus(capabilities: ApiCapabilities, baseUrl: string): string {
	return [
		"FirmEE is healthy.",
		`Endpoint: ${baseUrl}`,
		`API: ${capabilities.api_version}`,
		`Service: ${capabilities.service_version}`,
		`Contract: ${capabilities.contract_revision}`,
		`Authentication: ${capabilities.authentication}`,
	].join("\n");
}

export function formatFirmwareSearch(page: FirmwareSearchPage): string {
	const lines = [`Found ${page.total} firmware records. Page ${page.page}/${Math.max(page.page_count, 1)}.`];
	for (const [index, item] of page.items.entries()) {
		const identity = item.service_firmware_id ?? item.id;
		lines.push(
			`${index + 1}. ${item.brand} ${item.product} ${item.version}`,
			`   ID: ${identity} | ${item.original_filename} | ${bytes(item.size_bytes)}`,
			`   Catalog: ${item.catalog_source} | operational: ${item.operational} | FirmEE IID: ${item.firmee_iid ?? "—"}`,
			`   Extraction: ${item.latest_extraction_status} | validated rootfs: ${item.has_validated_rootfs} | FirmEE rootfs: ${item.firmee_rootfs_extracted}`,
			...(!item.operational ? ["   Next action: adopt this FirmEE IID before details, extraction, or simulation."] : []),
		);
	}
	return lines.join("\n");
}

export function formatFirmware(value: FirmwareView | FirmwareArchiveView): string {
	const firmware = "firmware" in value ? value.firmware : value;
	const lines = [
		`${firmware.brand} ${firmware.product} ${firmware.version}`,
		`ID: ${firmware.id}`,
		`File: ${firmware.original_filename} (${bytes(firmware.size_bytes)})`,
		`SHA-256: ${firmware.sha256}`,
		`MD5: ${firmware.md5}`,
		`Updated: ${firmware.updated_at}`,
	];
	if ("firmware" in value) {
		lines.push(
			`Validated rootfs: ${value.has_validated_rootfs}`,
			`Extractions: ${value.extraction_pagination.total}`,
			`Active extraction: ${value.active_extraction?.id ?? "none"}`,
		);
	}
	return lines.join("\n");
}

export function formatUpload(result: FirmwareUploadResult, localSha256: string): string {
	const conflicts = Object.keys(result.metadata_conflicts ?? {});
	return [
		result.reused ? "FirmEE reused an existing firmware record." : "Firmware uploaded successfully.",
		`ID: ${result.firmware.id}`,
		`SHA-256: ${result.firmware.sha256}`,
		`Local SHA-256: ${localSha256}`,
		`Metadata conflicts: ${conflicts.length ? conflicts.join(", ") : "none"}`,
		...("firmee_iid" in result && result.firmee_iid ? [`FirmEE IID: ${result.firmee_iid}`] : []),
	].join("\n");
}

export function formatExtractionPage(page: ExtractionPage): string {
	const lines = [`Found ${page.total} extraction tasks. Page ${page.page}/${Math.max(page.page_count, 1)}.`];
	for (const [index, item] of page.items.entries()) {
		lines.push(
			`${index + 1}. ${item.status} / ${item.phase}`,
			`   Extraction: ${item.id}`,
			`   Firmware: ${item.firmware_id}`,
		);
	}
	return lines.join("\n");
}

export function formatExtraction(run: ExtractionRun): string {
	const lines = [
		`Extraction ${run.id}`,
		`Firmware: ${run.firmware_id}`,
		`Status: ${run.status}`,
		`Phase: ${run.phase}`,
		`Agent attempts: ${run.agent_attempts}`,
	];
	if (run.failure_code) lines.push(`Failure: ${run.failure_code} — ${text(run.failure_detail)}`);
	return lines.join("\n");
}

export function formatWait(result: WaitResult): string {
	return [
		formatExtraction(result.extraction),
		`Events received: ${result.events.length}`,
		`Last sequence: ${result.lastSequence}`,
		`Timed out: ${result.timedOut}`,
		...(result.streamWarning ? [`Stream warning: ${result.streamWarning}`] : []),
	].join("\n");
}

export function formatDownload(result: DownloadResult): string {
	return [
		result.reused ? "Artifact already exists locally." : "Artifact downloaded successfully.",
		`Path: ${result.path}`,
		`Size: ${bytes(result.sizeBytes)}`,
		`SHA-256: ${result.sha256}`,
		`Resumed: ${result.resumed}`,
	].join("\n");
}
