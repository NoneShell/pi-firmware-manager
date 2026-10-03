# Pi Firmware Manager

A Pi extension that exposes complete FirmEE firmware laboratory workflows as model-callable tools.

Version `0.2.0` supports:

- liveness, readiness, backend, worker, and storage diagnostics
- unified Service/FirmEE catalog search and legacy IID adoption
- firmware details, upload, and optimistic metadata updates
- extraction start, paginated listing, status, resumable waiting, and cancellation
- rootfs and extraction-report downloads with Range resume, ETag handling, atomic files, and SHA-256 validation
- simulation start/list/get/wait/cancel with Runtime endpoint discovery
- Runtime inspection, logs, stop/restart/reset, command execution, and file transfer
- local and Docker export creation, waiting, integrity verification, and download
- extraction and Runtime Recipe inspection, activation, and disable workflows
- an interactive WebSocket Runtime terminal

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
/firmee diagnose
/firmee terminal <runtime_id>
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

Pi uses an environment-aware HTTP proxy dispatcher. For localhost, private IPv4 ranges, `.local`
names, and private IPv6 addresses, the extension adds the exact FirmEE hostname to `NO_PROXY`.
This handles environments whose existing `NO_PROXY` uses CIDR entries that Undici does not match.

## Tools

| Tool | Purpose |
|---|---|
| `firmee_status` | Health, API version, contract revision |
| `firmee_firmware_search` | Filtered, paginated firmware search |
| `firmee_firmware_get` | Firmware metadata or full dossier |
| `firmee_firmware_upload` | Streaming multipart firmware upload |
| `firmee_firmware_update` | Optimistic metadata update |
| `firmee_firmware_adopt` | Adopt a FirmEE catalog IID into Service storage |
| `firmee_extraction_start` | Start or reuse extraction |
| `firmee_extraction_list` | Filtered, paginated extraction list |
| `firmee_extraction_get` | Full extraction status and result |
| `firmee_extraction_wait` | Resumable SSE wait with polling fallback |
| `firmee_extraction_cancel` | Cancel an extraction |
| `firmee_artifact_download` | Download rootfs or reports |
| `firmee_simulation` | Start, list, or inspect simulations |
| `firmee_simulation_wait` | Resumable simulation SSE wait |

Advanced tools are registered with deferred exposure, so they do not consume the normal model
tool prompt until they are needed:

| Tool | Purpose |
|---|---|
| `firmee_platform_diagnose` | Readiness, backend, storage, and worker diagnostics |
| `firmee_simulation_cancel` | Cancel a simulation |
| `firmee_runtime` | List/get Runtimes and read logs |
| `firmee_runtime_control` | Stop, restart, or reset a Runtime |
| `firmee_runtime_exec` | Execute one guest command with an automatic session |
| `firmee_runtime_file` | Upload or download a Runtime file with an automatic session |
| `firmee_export` | Create, inspect, wait for, and download local/Docker exports |
| `firmee_recipe` | List extraction or Runtime Recipe revisions |
| `firmee_recipe_control` | Activate or disable an exact Recipe revision |

Example requests:

```text
Search FirmEE for ASUS RT-AC1200 firmware.
Adopt this FirmEE catalog entry using its server-side original source path.
Show the complete dossier for the first result.
Upload ./firmware.bin as ASUS RT-AC1200 version 3.0.0.4.
Start extraction for this firmware and wait up to one minute.
Download the validated rootfs into the current project's artifacts directory.
Simulate this firmware until its web interface is ready, then show the proxy URL.
Run `uname -a` in this Runtime.
Export the successful simulation as a local archive and download it.
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

The generated client types currently target FirmEE API `v1`, contract revision `2026-10-03.1`.
See [docs/REAL_E2E.md](docs/REAL_E2E.md) for the real firmware, Pi model-loop, Runtime, and export
validation performed for version `0.2.0`.
