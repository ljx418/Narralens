# IT-A06 MEDIA production module

Base and contract ca5b67a8285b130c79055317c6202f73cfbb99c8. Upstream e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3 verified by git rev-parse. Exact hashes/session in ReleaseAssignment.json.

Implement snapshot-bound native pinned OpenFilm renderer, preflight, full decode QC, exact DeliveryManifest DTO, no-clobber atomic package and secure range download. Old EnginePort/adapter, server, Job/DDL/contracts protected. No second DB or persistent job state machine. MAIN supplies SnapshotReadPort and attempt fence plus durable receipt/ready/outbox transaction. Inputs must be immutable and rights-checked local bytes, never current project or client paths. Native editable source must remain native; MP4 does not replace it.

Allowed writes only src/host/render,preflight,delivery and tests/agent-driven/media,tools/agent-driven/media,docs/parallel/lane-media. No Comfy, Hypit fresh render, TTS, paid calls, downloads, external writes, J drive, reset/stash/push.

Read AGENTS and cp-a0 01/02/03/04, implementation-design 01/04/07/08 and parallel-plan before coding. Read native render.mjs and trusted upstream seam before designing. Native module can be used via pinned no-shell worker; do not bypass pin or silently fallback to simplistic concat. Paths and options controlled, network impossible.

Acceptance T20-A ENOSPC, B nonzero/truncate/corrupt decode, C concurrent no-clobber/preexisting output, D cancellation awaited and late fenced, E actual owned child exit at encode/QC/publish/DB/events boundaries with MAIN callbacks, F rights/QC/supplement tampering, G revision immutable snapshot, H repeated reads/restart stable bytes. Unit boundary checks are not real process crash acceptance; label NOT_RUN honestly.

MAIN A-BASELINE-CHECK exec62928 RUNNING: source edits and reads ONLY; no install/tsc/tests/browser/ffmpeg until explicit release. Later isolated node_modules via offline frozen lock only, one-worker module tests; heavy ffmpeg/crash tests await resource reservation. Commands proposed: pnpm install --offline --frozen-lockfile; pnpm exec vitest run tests/agent-driven/media --maxWorkers=1; production tool under tools/agent-driven/media.

Rollback by reverting lane commit, retaining published packages and durable receipt; never remove other staging or published data. Do not commit: Codex freezes after review. Record files/commands/results including NOT_RUN and exact dependency requests.

Exact trusted upstream root: /mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm. Native renderer packages/openfilm/src/render.mjs exports render(args,opts), uses shared.mjs/host.mjs/timeline.mjs/film-doc.mjs/seekable.mjs/overrides.mjs/media-links.mjs. Read ONLY exact allowed roots; no filesystem-wide find, no J drive.
