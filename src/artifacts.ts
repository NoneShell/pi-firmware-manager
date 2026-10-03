import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FirmeeConfig } from "./config.ts";
import { FirmeeClient } from "./client.ts";
import type { DownloadResult, ExtractionRun, JsonRecord } from "./types.ts";

export type ExtractionArtifactKind = "rootfs" | "extraction_report" | "extraction_analysis_report";

const ARTIFACT_PATHS: Record<ExtractionArtifactKind, string> = {
	rootfs: "rootfs",
	extraction_report: "extraction-report",
	extraction_analysis_report: "extraction-analysis-report",
};

interface PartialMetadata {
	etag?: string;
	filename: string;
	totalBytes: number;
}

function sanitizeFilename(value: string): string {
	const safe = basename(value.replaceAll("\\", "/"))
		.replace(/[\u0000-\u001f\u007f]/g, "_")
		.replace(/^\.+$/, "artifact.bin");
	return safe || "artifact.bin";
}

function dispositionFilename(header: string | null, fallback: string): string {
	if (!header) return fallback;
	const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
	if (encoded) {
		try {
			return sanitizeFilename(decodeURIComponent(encoded));
		} catch {
			// Fall through to the plain filename.
		}
	}
	const plain = /filename="([^"]+)"/i.exec(header)?.[1] ?? /filename=([^;]+)/i.exec(header)?.[1];
	return sanitizeFilename(plain?.trim() ?? fallback);
}

function totalFromResponse(response: Response): number {
	const range = response.headers.get("content-range");
	const total = range ? Number(range.split("/").at(-1)) : Number(response.headers.get("content-length"));
	if (!Number.isSafeInteger(total) || total < 0) throw new Error("FirmEE artifact response has no valid size");
	return total;
}

async function existingSize(path: string): Promise<number> {
	try {
		return (await stat(path)).size;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
		throw error;
	}
}

async function sha256File(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
	return hash.digest("hex");
}

function expectedRootfsSha(run: ExtractionRun): string | undefined {
	const result = run.result as JsonRecord;
	return typeof result.rootfs_sha256 === "string" ? result.rootfs_sha256 : undefined;
}

function transferSignal(parent: AbortSignal | undefined, timeoutMs: number): {
	signal: AbortSignal;
	cleanup: () => void;
} {
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(new DOMException(`FirmEE transfer timed out after ${timeoutMs} ms`, "TimeoutError")),
		timeoutMs,
	);
	const abort = () => controller.abort(parent?.reason);
	if (parent?.aborted) abort();
	else parent?.addEventListener("abort", abort, { once: true });
	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timer);
			parent?.removeEventListener("abort", abort);
		},
	};
}

interface RangedArtifactOptions {
	client: FirmeeClient;
	config: FirmeeConfig;
	apiPath: string;
	artifactKey: string;
	fallbackFilename: string;
	expectedSha256?: string | undefined;
	destinationDirectory?: string;
	signal?: AbortSignal;
}

export async function downloadRangedArtifact(options: RangedArtifactOptions): Promise<DownloadResult> {
	const { client, config, apiPath, artifactKey } = options;
	const directory = resolve(options.destinationDirectory ?? config.downloadDirectory);
	await mkdir(directory, { recursive: true });
	const { signal, cleanup } = transferSignal(options.signal, config.transferTimeoutMs);
	try {
		const probe = await client.fetchResponse("GET", apiPath, {
			headers: { Range: "bytes=0-0", Accept: "*/*" },
			signal,
			timeoutMs: config.transferTimeoutMs,
		});
		if (!probe.ok) throw await client.errorFromResponse(probe);
		const totalBytes = totalFromResponse(probe);
		const filename = dispositionFilename(
			probe.headers.get("content-disposition"),
			options.fallbackFilename,
		);
		const etag = probe.headers.get("etag") ?? undefined;
		await probe.body?.cancel();

		const finalPath = join(directory, filename);
		if ((await existingSize(finalPath)) === totalBytes) {
			const sha256 = await sha256File(finalPath);
			if (!options.expectedSha256 || options.expectedSha256 === sha256) {
				return {
					path: finalPath,
					filename,
					sizeBytes: totalBytes,
					sha256,
					...(etag ? { etag } : {}),
					resumed: false,
					reused: true,
				};
			}
		}

		const prefix = `.${artifactKey}`;
		const partialPath = join(directory, `${prefix}.part`);
		const metadataPath = `${partialPath}.json`;
		let metadata: PartialMetadata | undefined;
		try {
			metadata = JSON.parse(await readFile(metadataPath, "utf8")) as PartialMetadata;
		} catch {
			metadata = undefined;
		}
		let offset = await existingSize(partialPath);
		if (
			offset > totalBytes ||
			metadata?.filename !== filename ||
			metadata?.totalBytes !== totalBytes ||
			metadata?.etag !== etag
		) {
			await rm(partialPath, { force: true });
			offset = 0;
		}
		const nextMetadata: PartialMetadata = { filename, totalBytes, ...(etag ? { etag } : {}) };
		await writeFile(metadataPath, JSON.stringify(nextMetadata));

		const headers: Record<string, string> = { Accept: "*/*" };
		if (offset > 0) {
			headers.Range = `bytes=${offset}-`;
			if (etag) headers["If-Range"] = etag;
		}
		let response = await client.fetchResponse("GET", apiPath, {
			headers,
			signal,
			timeoutMs: config.transferTimeoutMs,
		});
		if (!response.ok) throw await client.errorFromResponse(response);
		if (!response.body) throw new Error("FirmEE artifact response has no body");
		if (offset > 0 && response.status !== 206) {
			await rm(partialPath, { force: true });
			offset = 0;
		}
		await pipeline(
			Readable.fromWeb(response.body as never),
			createWriteStream(partialPath, { flags: offset > 0 ? "a" : "w", mode: 0o600 }),
			{ signal },
		);

		const sizeBytes = await existingSize(partialPath);
		if (sizeBytes !== totalBytes) {
			throw new Error(`Incomplete FirmEE artifact: expected ${totalBytes} bytes, received ${sizeBytes}`);
		}
		const sha256 = await sha256File(partialPath);
		if (options.expectedSha256 && options.expectedSha256 !== sha256) {
			throw new Error(`Artifact SHA-256 mismatch: expected ${options.expectedSha256}, received ${sha256}`);
		}
		await rename(partialPath, finalPath);
		await rm(metadataPath, { force: true });
		return {
			path: finalPath,
			filename,
			sizeBytes,
			sha256,
			...(etag ? { etag } : {}),
			resumed: offset > 0,
			reused: false,
		};
	} finally {
		cleanup();
	}
}

export async function downloadExtractionArtifact(options: {
	client: FirmeeClient;
	config: FirmeeConfig;
	extractionId: string;
	kind: ExtractionArtifactKind;
	destinationDirectory?: string;
	signal?: AbortSignal;
}): Promise<DownloadResult> {
	const expectedSha256 =
		options.kind === "rootfs"
			? expectedRootfsSha(await options.client.getExtraction(options.extractionId, options.signal))
			: undefined;
	return downloadRangedArtifact({
		client: options.client,
		config: options.config,
		apiPath: `/api/v1/extractions/${encodeURIComponent(options.extractionId)}/artifacts/${ARTIFACT_PATHS[options.kind]}`,
		artifactKey: `${options.extractionId}-${options.kind}`,
		fallbackFilename: `${options.extractionId}-${ARTIFACT_PATHS[options.kind]}`,
		...(expectedSha256 ? { expectedSha256 } : {}),
		...(options.destinationDirectory ? { destinationDirectory: options.destinationDirectory } : {}),
		...(options.signal ? { signal: options.signal } : {}),
	});
}

export async function downloadSimulationExport(options: {
	client: FirmeeClient;
	config: FirmeeConfig;
	simulationId: string;
	kind: "local" | "docker";
	expectedSha256?: string | undefined;
	destinationDirectory?: string;
	signal?: AbortSignal;
}): Promise<DownloadResult> {
	return downloadRangedArtifact({
		client: options.client,
		config: options.config,
		apiPath: `/api/v1/simulations/${encodeURIComponent(options.simulationId)}/exports/${options.kind}`,
		artifactKey: `${options.simulationId}-export-${options.kind}`,
		fallbackFilename: `${options.simulationId}-${options.kind}.tar.gz`,
		...(options.expectedSha256 ? { expectedSha256: options.expectedSha256 } : {}),
		...(options.destinationDirectory ? { destinationDirectory: options.destinationDirectory } : {}),
		...(options.signal ? { signal: options.signal } : {}),
	});
}

export async function sha256LocalFile(path: string): Promise<string> {
	return sha256File(path);
}
