# Pi Firmware Manager

A Pi extension that exposes FirmEE firmware management and extraction workflows as model-callable tools.

Version `0.1.0` supports:

- FirmEE configuration and health checks
- firmware search, details, upload, and metadata updates
- extraction start, paginated listing, status, resumable waiting, and cancellation
- rootfs and extraction-report downloads with Range resume, ETag handling, atomic files, and SHA-256 validation

The extension talks only to the FirmEE Web API. It does not connect to PostgreSQL.

## Install

From this directory:

```bash
pi install .
```

For development without installing:

```bash
pi --extension ./src/index.ts
```

## Configure

Inside Pi:

```text
/firmee config http://10.211.55.17:8000
/firmee status
/firmee show
/firmee docs
```

User configuration is saved at `~/.pi/agent/firmee.json`. A project can override it with `.pi/firmee.json`.

Environment overrides:

```text
FIRMEE_BASE_URL
FIRMEE_DOWNLOAD_DIR
FIRMEE_REQUEST_TIMEOUT_MS
FIRMEE_TASK_WAIT_TIMEOUT_MS
FIRMEE_TRANSFER_TIMEOUT_MS
```

The default endpoint is `http://10.211.55.17:8000` and the default artifact directory is `~/Downloads/FirmEE`.

## Tools

| Tool | Purpose |
|---|---|
| `firmee_status` | Health, API version, contract revision |
| `firmee_firmware_search` | Filtered, paginated firmware search |
| `firmee_firmware_get` | Firmware metadata or full dossier |
| `firmee_firmware_upload` | Streaming multipart firmware upload |
| `firmee_firmware_update` | Optimistic metadata update |
| `firmee_extraction_start` | Start or reuse extraction |
| `firmee_extraction_list` | Filtered, paginated extraction list |
| `firmee_extraction_get` | Full extraction status and result |
| `firmee_extraction_wait` | Resumable SSE wait with polling fallback |
| `firmee_extraction_cancel` | Cancel an extraction |
| `firmee_artifact_download` | Download rootfs or reports |

Example requests:

```text
Search FirmEE for ASUS RT-AC1200 firmware.
Show the complete dossier for the first result.
Upload ./firmware.bin as ASUS RT-AC1200 version 3.0.0.4.
Start extraction for this firmware and wait up to one minute.
Download the validated rootfs into the current project's artifacts directory.
```

## Development

Generate TypeScript API types from a running FirmEE service:

```bash
npm run generate:api
```

Override the schema URL when needed:

```bash
FIRMEE_OPENAPI_URL=http://host:8000/openapi.json npm run generate:api
```

Run checks:

```bash
npm run check
```

The generated client types currently target FirmEE API `v1`, contract revision `2026-10-01.3`.
