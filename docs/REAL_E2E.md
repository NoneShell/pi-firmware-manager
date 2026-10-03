# Real FirmEE end-to-end validation

Date: 2026-10-03  
Service: `http://10.211.55.17:8000`  
API: `v1`  
Contract revision: `2026-10-03.1`

The following workflow was executed through the extension implementation against a real FirmEE
service and real Belkin F9K1115 firmware. No database connection was used.

## Platform and catalog

- Detailed readiness returned `ready`.
- Unified catalog search returned FirmEE CLI entry `firmee:local-firmee:62` as non-operational.
- Adoption of IID 62 correctly returned `firmee_original_unavailable` because no server-side original
  path was exposed.
- Idempotent adoption of existing IID 241 succeeded and returned Service firmware
  `d219e633-30fa-4c38-b527-7a5b01c99d02` with MD5 verification.

## Extraction and artifacts

- Extraction: `8f162b76-8235-425b-8f35-a1921adc7c3e`
- Result: `extracted / succeeded`
- SSE events received: 7
- RootFS size: 13,905,161 bytes
- RootFS SHA-256: `793c021264be359a50f9c3f9ab2f9a93d361ee3076cc010049a3d74f113f2123`
- The plugin downloaded the RootFS with ETag/Range support and verified the recorded SHA-256.
- The task diagnostic workflow collected 7 events, 4 checkpoints, and 1 deterministic attempt.

## Simulation and Runtime

- Simulation: `dfd5b066-b973-4d6a-8687-ad8ad710b04a`
- Target: `guest_executable`
- Result: `succeeded`, published Runtime reached `web_ready`
- Runtime: `b88de012-8cf3-4a1a-aab5-ae019325373e`
- Runtime guest command returned MIPS Linux `uname -a` successfully.
- Serial logs were read through the plugin.
- A 58-byte fixture was uploaded to the guest and downloaded back; SHA-256 was recorded.
- Runtime was stopped and verified as `stopped`.

## Export and Recipe

- Local export job: `367f2f81-db30-4719-8b9f-9a5ff491a1da`
- Export status: `succeeded / complete`
- Export size: 95,851,821 bytes
- Export SHA-256: `a403faf8174082fc2d76fe3e6d4e67a1fac439a84a2820ca3e9f6e63a1ab17ce`
- The plugin downloaded the export and verified its SHA-256.
- Runtime Recipe `373179c3-f4ce-4383-be01-ad15a65db83a` was listed and idempotently activated.
- Simulation diagnostics collected 43 events and 9 checkpoints from the real successful task.

## Runtime control and terminal

- Runtime reset created replacement simulation `4654492d-39c0-44f5-9797-376c9eb36a06`.
- The simulation wait consumed 42 SSE events and returned its published Runtime.
- A second reset produced Runtime `3507e252-da09-423a-a97a-5500fafc5d1f`.
- The WebSocket terminal executed `id` as root and returned exit code 0.
- Every Runtime created by this validation was stopped afterward:
  - `b88de012-8cf3-4a1a-aab5-ae019325373e`
  - `309559df-38b5-4f34-9e6c-4398ddf893fa`
  - `3507e252-da09-423a-a97a-5500fafc5d1f`

## Pi model loop

Pi was started with the extension and a natural-language request to search for `nf1adv`. The model
selected `firmee_firmware_search`, correctly reported catalog source `firmee`, IID 62,
`operational: false`, and recommended adoption without performing a write.
