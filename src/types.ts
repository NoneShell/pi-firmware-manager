import type { components } from "./generated/firmee-api.ts";

export type JsonRecord = Record<string, unknown>;
export type ApiCapabilities = components["schemas"]["ApiCapabilitiesView"];
export type ApiErrorPayload = components["schemas"]["ApiError"];
export type FirmwareView = components["schemas"]["FirmwareView"];
export type FirmwareSearchPage = components["schemas"]["FirmwareSearchPage"];
export type FirmwareArchiveView = components["schemas"]["FirmwareArchiveView"];
export type FirmwareUploadResult = components["schemas"]["FirmwareUploadResult"];
export type ExtractionPage = components["schemas"]["ExtractionPage"];
export type ExtractionRun = components["schemas"]["RunView"];
export type ExtractionEvent = components["schemas"]["EventView"];

export interface HealthView {
	status: "ok";
}

export interface WaitResult {
	extraction: ExtractionRun;
	events: ExtractionEvent[];
	lastSequence: number;
	timedOut: boolean;
	streamWarning?: string;
}

export interface DownloadResult {
	path: string;
	filename: string;
	sizeBytes: number;
	sha256: string;
	etag?: string;
	resumed: boolean;
	reused: boolean;
}
