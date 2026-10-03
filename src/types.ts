import type { components } from "./generated/firmee-api.ts";

export type JsonRecord = Record<string, unknown>;
export type ApiCapabilities = components["schemas"]["ApiCapabilitiesView"];
export type ApiErrorPayload = components["schemas"]["ApiError"];
export type FirmwareView = components["schemas"]["FirmwareView"];
export type FirmwareSearchPage = components["schemas"]["FirmwareSearchPage"];
export type FirmwareArchiveView = components["schemas"]["FirmwareArchiveView"];
export type FirmwareUploadResult = components["schemas"]["FirmwareUploadResult"];
export type FirmwareAdoptionResult = components["schemas"]["FirmEEAdoptionResult"];
export type ExtractionPage = components["schemas"]["ExtractionPage"];
export type ExtractionRun = components["schemas"]["RunView"];
export type ExtractionEvent = components["schemas"]["EventView"];
export type SimulationPage = components["schemas"]["SimulationPage"];
export type SimulationView = components["schemas"]["SimulationView"];
export type SimulationEvent = components["schemas"]["SimulationEventView"];
export type RuntimePage = components["schemas"]["RuntimePage"];
export type RuntimeView = components["schemas"]["RuntimeView"];
export type RuntimeSessionView = components["schemas"]["RuntimeSessionView"];
export type RuntimeExecResult = components["schemas"]["RuntimeExecResult"];
export type RuntimeLogsView = components["schemas"]["RuntimeLogsView"];
export type ExportJobView = components["schemas"]["ExportJobView"];
export type PlatformReadinessView = components["schemas"]["PlatformReadinessView"];
export type PlatformCheckView = components["schemas"]["PlatformCheckView"];
export type PlatformStorageView = components["schemas"]["PlatformStorageView"];
export type PlatformWorkerView = components["schemas"]["PlatformWorkerView"];
export type ExtractionRecipeView = components["schemas"]["RecipeRevisionView"];
export type RuntimeRecipeView = components["schemas"]["RuntimeRecipeRevisionView"];

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

export interface SimulationWaitResult {
	simulation: SimulationView;
	events: SimulationEvent[];
	lastSequence: number;
	timedOut: boolean;
	streamWarning?: string;
}

export interface ExportWaitResult {
	job: ExportJobView;
	timedOut: boolean;
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
