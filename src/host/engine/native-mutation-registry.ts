
/**
 * NativeMutationRegistry (AC-003, `03_M2_M4_MODULE_DESIGN.md` §1.4).
 *
 * Every native entry point that could touch author source is registered here with an
 * explicit policy. `unknown` is not a valid production policy: an unregistered operation
 * is denied by the gateway by default and recorded as a security event.
 *
 * The entry set is the row set of the verified OpenFilm inventory
 * (`spikes/openfilm-m1b/native-mutation-inventory.md`) plus the subtitle/audio dimension
 * the module design requires. A fitness test fails if any inventory row loses coverage.
 */

export type NativeTransport = "http" | "websocket" | "cli" | "filesystem" | "ipc" | "provider" | "ui";

export type NativePolicy = "translated" | "translated_host_service" | "blocked" | "read_only";

export type TypedEditOperation = "set_visual_fit" | "replace_visual_asset";

export type NativeImpactClass =
  | "picture" | "narration" | "subtitle" | "audio" | "settings" | "markers" | "project_lifecycle" | "none";

export type NativeLockClass = "visual" | "narration" | "duration" | "none";

export interface NativeMutationEntry {
  readonly entry_id: string;
  readonly transport: NativeTransport;
  readonly native_operation: string;
  /** Which `TypedEdit` operation this entry translates to, or null when there is no translation. */
  readonly typed_intent: TypedEditOperation | null;
  readonly impact_class: NativeImpactClass;
  readonly lock_class: NativeLockClass;
  readonly policy: NativePolicy;
  readonly reason: string;
  readonly test_id: string;
}

export const NATIVE_MUTATION_REGISTRY: readonly NativeMutationEntry[] = Object.freeze([
  // ── timeline / inspector ────────────────────────────────────────────────────────────
  { entry_id: "timeline.set_visual_fit", transport: "http", native_operation: "parameter.set_visual_fit",
    typed_intent: "set_visual_fit", impact_class: "picture", lock_class: "visual",
    policy: "translated", reason: "Already a D3/D4.0 typed edit committed by ProjectWriteActor", test_id: "EN-01" },
  { entry_id: "timeline.replace_visual_asset", transport: "http", native_operation: "media.replace",
    typed_intent: "replace_visual_asset", impact_class: "picture", lock_class: "visual",
    policy: "translated", reason: "Already a D4.0 typed edit committed by ProjectWriteActor", test_id: "EN-01" },
  { entry_id: "timeline.trim", transport: "http", native_operation: "clip.trim", typed_intent: null,
    impact_class: "picture", lock_class: "duration", policy: "blocked",
    reason: "No integer half-open frame range typed edit exists before M2.2", test_id: "EN-02" },
  { entry_id: "timeline.move", transport: "http", native_operation: "clip.move", typed_intent: null,
    impact_class: "picture", lock_class: "visual", policy: "blocked",
    reason: "No typed edit exists; a native move bypasses the project write queue", test_id: "EN-02" },
  { entry_id: "timeline.split", transport: "http", native_operation: "clip.split", typed_intent: null,
    impact_class: "picture", lock_class: "duration", policy: "blocked",
    reason: "Split creates clip identity; no typed edit or stable id mapping exists yet", test_id: "EN-02" },
  { entry_id: "timeline.speed", transport: "http", native_operation: "clip.speed", typed_intent: null,
    impact_class: "narration", lock_class: "duration", policy: "blocked",
    reason: "Speed affects shared narration consumers; requires the M4 lock closure", test_id: "EN-02" },
  { entry_id: "inspector.field.set", transport: "ui", native_operation: "inspector.field.set", typed_intent: null,
    impact_class: "picture", lock_class: "visual", policy: "blocked",
    reason: "Arbitrary inspector fields have no typed translation and no impact classifier", test_id: "EN-02" },
  { entry_id: "inspector.style.set", transport: "ui", native_operation: "inspector.style.set", typed_intent: null,
    impact_class: "picture", lock_class: "visual", policy: "blocked",
    reason: "Arbitrary style writes are unclassified for digest, locks and impact", test_id: "EN-02" },

  // ── subtitle ───────────────────────────────────────────────────────────────────────
  { entry_id: "subtitle.line.set", transport: "http", native_operation: "captions.line.put", typed_intent: null,
    impact_class: "subtitle", lock_class: "narration", policy: "blocked",
    reason: "Subtitle writes are not yet wired to digest, locks and narration impact", test_id: "EN-02" },
  { entry_id: "subtitle.style.set", transport: "http", native_operation: "subtitles.style.put", typed_intent: null,
    impact_class: "subtitle", lock_class: "narration", policy: "blocked",
    reason: "Subtitle style writes are not yet wired to digest, locks and narration impact", test_id: "EN-02" },
  { entry_id: "subtitle.transcribe", transport: "http", native_operation: "subtitles.transcribe", typed_intent: null,
    impact_class: "subtitle", lock_class: "narration", policy: "blocked",
    reason: "Transcription needs provider approval, cost and receipt handling (M7B)", test_id: "EN-02" },
  { entry_id: "subtitle.translate", transport: "http", native_operation: "subtitles.translate", typed_intent: null,
    impact_class: "subtitle", lock_class: "narration", policy: "blocked",
    reason: "Translation is an egress operation requiring per-task approval (M7C)", test_id: "EN-02" },

  // ── audio ───────────────────────────────────────────────────────────────────────────
  { entry_id: "audio.track.replace", transport: "http", native_operation: "audio.track.replace", typed_intent: null,
    impact_class: "audio", lock_class: "narration", policy: "blocked",
    reason: "Audio track writes are not yet covered by the narration lock model", test_id: "EN-02" },
  { entry_id: "audio.mix.set", transport: "http", native_operation: "audio.mix.set", typed_intent: null,
    impact_class: "audio", lock_class: "narration", policy: "blocked",
    reason: "Mix changes are not yet covered by the narration lock model", test_id: "EN-02" },

  // ── asset import / file ────────────────────────────────────────────────────────────
  { entry_id: "asset.import", transport: "http", native_operation: "files.bring", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "translated_host_service",
    reason: "Routes to the Host AssetImportService, which writes the manifest and never the film revision",
    test_id: "EN-02" },
  { entry_id: "asset.relink", transport: "http", native_operation: "files.relink", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "blocked",
    reason: "Native relink accepts arbitrary paths; only Host asset tokens are accepted", test_id: "EN-02" },
  { entry_id: "asset.collect", transport: "http", native_operation: "files.collect", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "blocked",
    reason: "Native collect moves arbitrary files; only the Host install path is allowed", test_id: "EN-02" },
  { entry_id: "asset.delete", transport: "http", native_operation: "files.delete", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "blocked",
    reason: "Deletion is not revertible inside M2.1", test_id: "EN-02" },

  // ── history ────────────────────────────────────────────────────────────────────────
  { entry_id: "history.commit", transport: "http", native_operation: "history.commit", typed_intent: null,
    impact_class: "picture", lock_class: "none", policy: "blocked",
    reason: "Commit is owned exclusively by the Host", test_id: "EN-02" },
  { entry_id: "history.discard", transport: "http", native_operation: "history.discard", typed_intent: null,
    impact_class: "picture", lock_class: "none", policy: "blocked",
    reason: "Discard destroys authored content", test_id: "EN-02" },
  { entry_id: "history.restore", transport: "http", native_operation: "history.restore", typed_intent: null,
    impact_class: "picture", lock_class: "none", policy: "blocked",
    reason: "Restore must produce a new Narralens revision; that is M4B", test_id: "EN-02" },
  { entry_id: "history.checkout", transport: "http", native_operation: "history.checkout", typed_intent: null,
    impact_class: "picture", lock_class: "none", policy: "blocked",
    reason: "Checkout would move the active pointer without a revision", test_id: "EN-02" },
  { entry_id: "history.merge", transport: "http", native_operation: "history.merge", typed_intent: null,
    impact_class: "picture", lock_class: "none", policy: "blocked",
    reason: "Merge writes source without a Narralens transaction", test_id: "EN-02" },
  { entry_id: "history.undo", transport: "http", native_operation: "history.undo", typed_intent: null,
    impact_class: "picture", lock_class: "none", policy: "blocked",
    reason: "Native undo bypasses revision monotonicity until M4B", test_id: "EN-02" },
  { entry_id: "history.redo", transport: "http", native_operation: "history.redo", typed_intent: null,
    impact_class: "picture", lock_class: "none", policy: "blocked",
    reason: "Native redo bypasses revision monotonicity until M4B", test_id: "EN-02" },
  { entry_id: "history.branch.delete", transport: "http", native_operation: "branch.delete", typed_intent: null,
    impact_class: "project_lifecycle", lock_class: "none", policy: "blocked",
    reason: "Branch deletion is not revertible", test_id: "EN-02" },

  // ── project / library lifecycle ────────────────────────────────────────────────────
  { entry_id: "project.rename", transport: "http", native_operation: "projects.rename", typed_intent: null,
    impact_class: "project_lifecycle", lock_class: "none", policy: "blocked",
    reason: "Project lifecycle is managed by the Host", test_id: "EN-02" },
  { entry_id: "project.delete", transport: "http", native_operation: "projects.delete", typed_intent: null,
    impact_class: "project_lifecycle", lock_class: "none", policy: "blocked",
    reason: "Deletion is not revertible and bypasses the migration backup discipline", test_id: "EN-02" },
  { entry_id: "project.move", transport: "http", native_operation: "projects.move", typed_intent: null,
    impact_class: "project_lifecycle", lock_class: "none", policy: "blocked",
    reason: "Moving a project would move the author source outside the Host root", test_id: "EN-02" },
  { entry_id: "project.fetch_remote", transport: "http", native_operation: "projects.fetch", typed_intent: null,
    impact_class: "project_lifecycle", lock_class: "none", policy: "blocked",
    reason: "Remote fetch is disabled by default", test_id: "EN-02" },
  { entry_id: "project.open_picker", transport: "http", native_operation: "projects.open", typed_intent: null,
    impact_class: "project_lifecycle", lock_class: "none", policy: "blocked",
    reason: "A system picker cannot be governed or automated", test_id: "EN-02" },
  { entry_id: "project.import_template", transport: "http", native_operation: "projects.import_template", typed_intent: null,
    impact_class: "project_lifecycle", lock_class: "none", policy: "blocked",
    reason: "Template writes are not covered by a typed edit or an impact classification", test_id: "EN-02" },
  { entry_id: "project.template_apply", transport: "http", native_operation: "projects.template_apply", typed_intent: null,
    impact_class: "project_lifecycle", lock_class: "none", policy: "blocked",
    reason: "Template application is unclassified for locks and impact", test_id: "EN-02" },

  // ── markers / settings ─────────────────────────────────────────────────────────────
  { entry_id: "markers.put", transport: "http", native_operation: "markers.put", typed_intent: null,
    impact_class: "markers", lock_class: "none", policy: "read_only",
    reason: "Markers are a derived view and never change film content", test_id: "EN-02" },
  { entry_id: "settings.patch", transport: "http", native_operation: "settings.patch", typed_intent: null,
    impact_class: "settings", lock_class: "none", policy: "blocked",
    reason: "Settings are inside the digest closure but have no typed edit translation yet", test_id: "EN-02" },

  // ── provider ───────────────────────────────────────────────────────────────────────
  { entry_id: "provider.generate", transport: "provider", native_operation: "provider.generate", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "blocked",
    reason: "Default deny: generation needs per-task cost, egress approval and a receipt", test_id: "EN-02" },
  { entry_id: "provider.ask", transport: "provider", native_operation: "provider.ask", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "blocked",
    reason: "Default deny: egress requires an explicit data manifest and approval", test_id: "EN-02" },
  { entry_id: "provider.get", transport: "provider", native_operation: "provider.get", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "blocked",
    reason: "Default deny: retrieval requires a rights-checked provider gateway", test_id: "EN-02" },
  { entry_id: "provider.key.set", transport: "provider", native_operation: "provider.key.put", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "blocked",
    reason: "Credentials must never travel through a Host route", test_id: "EN-02" },
  { entry_id: "provider.key.delete", transport: "provider", native_operation: "provider.key.delete", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "blocked",
    reason: "Credentials must never travel through a Host route", test_id: "EN-02" },

  // ── CLI ────────────────────────────────────────────────────────────────────────────
  { entry_id: "cli.open", transport: "cli", native_operation: "openfilm open", typed_intent: null,
    impact_class: "project_lifecycle", lock_class: "none", policy: "blocked",
    reason: "Opening a project directly is a write surface outside the Host", test_id: "EN-02" },
  { entry_id: "cli.look", transport: "cli", native_operation: "openfilm look", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "read_only",
    reason: "Observation only; no side effect on author source", test_id: "EN-02" },
  { entry_id: "cli.render", transport: "cli", native_operation: "openfilm render", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "read_only",
    reason: "Snapshot-bound export is an M6 capability; M2.1 exposes no render entry", test_id: "EN-02" },
  { entry_id: "cli.get", transport: "cli", native_operation: "openfilm get", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "blocked",
    reason: "Retrieval goes through a provider gate that does not exist yet", test_id: "EN-02" },

  // ── export / autosave ──────────────────────────────────────────────────────────────
  { entry_id: "export.create", transport: "http", native_operation: "exports.post", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "blocked",
    reason: "Exports must bind a committed snapshot; that capability opens in M6", test_id: "EN-02" },
  { entry_id: "export.delete", transport: "http", native_operation: "exports.delete", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "blocked",
    reason: "Export artifacts belong to a frozen snapshot, not to an ad-hoc route", test_id: "EN-02" },
  { entry_id: "export.reveal", transport: "filesystem", native_operation: "exports.reveal", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "read_only",
    reason: "A human explicit action that never enters headless automation", test_id: "EN-02" },
  { entry_id: "autosave.trigger", transport: "ui", native_operation: "autosave", typed_intent: null,
    impact_class: "picture", lock_class: "none", policy: "blocked",
    reason: "Autosave must not change the Narralens revision outside a transaction", test_id: "EN-02" },

  // ── filesystem watch ───────────────────────────────────────────────────────────────
  { entry_id: "filewatch.external_change", transport: "filesystem", native_operation: "fs.watch", typed_intent: null,
    impact_class: "none", lock_class: "none", policy: "read_only",
    reason: "Detects an external change and raises attention; never accepts it automatically", test_id: "EN-04" },
]);

export const NATIVE_ENTRY_IDS: readonly string[] = NATIVE_MUTATION_REGISTRY.map((entry) => entry.entry_id);

export class NativeMutationRegistry {
  readonly #byId = new Map(NATIVE_MUTATION_REGISTRY.map((entry) => [entry.entry_id, entry] as const));

  /** `undefined` means unknown, which the gateway denies by default. */
  find(entryId: string): NativeMutationEntry | undefined { return this.#byId.get(entryId); }

  has(entryId: string): boolean { return this.#byId.has(entryId); }

  entries(): readonly NativeMutationEntry[] { return NATIVE_MUTATION_REGISTRY; }

  entriesForOperations(operations: readonly string[]): NativeMutationEntry[] {
    return operations.map((operation) => this.#byId.get(operation)).filter((entry): entry is NativeMutationEntry => entry !== undefined);
  }
}

/**
 * Coverage of the verified OpenFilm native inventory
 * (`spikes/openfilm-m1b/native-mutation-inventory.md`), row by row. A fitness test fails
 * if any registered entry is not reachable from exactly one row, or if a row is empty.
 */
export const NATIVE_INVENTORY_COVERAGE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "timeline / inspector": ["timeline.set_visual_fit", "timeline.replace_visual_asset", "timeline.trim", "timeline.move",
    "timeline.split", "timeline.speed", "inspector.field.set", "inspector.style.set"],
  "subtitle": ["subtitle.line.set", "subtitle.style.set", "subtitle.transcribe", "subtitle.translate"],
  "history": ["history.commit", "history.discard", "history.restore", "history.checkout", "history.merge",
    "history.undo", "history.redo", "history.branch.delete"],
  "asset import / file": ["asset.import", "asset.relink", "asset.collect", "asset.delete"],
  "marker / settings": ["markers.put", "settings.patch"],
  "provider": ["provider.generate", "provider.ask", "provider.get", "provider.key.set", "provider.key.delete"],
  "export": ["export.create", "export.delete", "export.reveal", "autosave.trigger"],
  "project / library": ["project.rename", "project.delete", "project.move", "project.fetch_remote",
    "project.open_picker", "project.import_template", "project.template_apply"],
  "CLI / filesystem": ["cli.open", "cli.look", "cli.render", "cli.get", "filewatch.external_change"],
  // The inventory's tenth row (WebSocket / callback) yields no writable entry: events are
  // projection refreshes and must never trigger a commit.
  "WebSocket / callback": [],
});

/**
 * Entries required by a `03_M2_M4_MODULE_DESIGN.md:24` dimension that the M1B inventory rows
 * do not name on their own. Together with `NATIVE_INVENTORY_COVERAGE` these two maps must
 * account for every registered entry exactly once.
 */
export const NATIVE_DIMENSION_COVERAGE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "subtitle / audio (03:24)": ["audio.track.replace", "audio.mix.set"],
});

export const AUDIO_ENTRY_IDS: readonly string[] = NATIVE_DIMENSION_COVERAGE["subtitle / audio (03:24)"] ?? [];
