import type {
  CapabilityEntry, CapabilityMap, CapabilityState, EngineKind,
} from "../../contracts/engine-types.js";
import { NATIVE_MUTATION_REGISTRY, type NativeMutationEntry } from "./native-mutation-registry.js";
import { FPS_30 } from "./time-model.js";

/**
 * Complete capability maps, one per engine (M-01).
 *
 * `03_M2_M4_MODULE_DESIGN.md:11` requires every registered operation to carry an explicit
 * state and forbids `unverified` on a production write path. An absent entry used to mean
 * "nothing reported", which the gateway then read as permission to translate — so a
 * missing OpenFilm capability could inherit Hypit's translated policy. These maps cover
 * every engine-owned operation, and a missing entry now means unverified.
 */

const ENGINE_OWNED = NATIVE_MUTATION_REGISTRY.filter((entry) => entry.policy !== "translated_host_service");

const OPENFILM_NO_WRITE_PATH = "OpenFilm has no translated write path in M2.1";

function mapFor(engine: EngineKind): CapabilityMap {
  const entries: Record<string, CapabilityEntry> = {};
  for (const entry of ENGINE_OWNED) entries[entry.entry_id] = stateFor(engine, entry);
  return { entries, fps: FPS_30, fps_verified: true };
}

function stateFor(engine: EngineKind, entry: NativeMutationEntry): CapabilityEntry {
  if (entry.policy === "read_only") return { state: "read_only", reason: entry.reason };
  if (engine === "openfilm") return { state: "blocked", reason: OPENFILM_NO_WRITE_PATH };
  // Hypit already owns the two typed edits the Host commits; everything else stays blocked.
  return entry.policy === "translated"
    ? { state: "supported", reason: entry.reason }
    : { state: "blocked", reason: entry.reason };
}

export function hypitCapabilityMap(): CapabilityMap { return mapFor("hypit"); }
export function openFilmCapabilityMap(): CapabilityMap { return mapFor("openfilm"); }
export function capabilityMapFor(engine: EngineKind): CapabilityMap { return mapFor(engine); }

/**
 * Host service capabilities, kept separate from engine capabilities on purpose.
 *
 * `asset.import` translates to the Host's AssetImportService, which writes the asset
 * manifest and never the film revision. Reporting it inside an engine's capability map
 * would present a Host service as an engine write capability, which is exactly what M-01
 * forbids.
 */
export function hostServiceCapabilityMap(): { entries: Record<string, CapabilityEntry> } {
  const entries: Record<string, CapabilityEntry> = {};
  for (const entry of NATIVE_MUTATION_REGISTRY.filter((candidate) => candidate.policy === "translated_host_service")) {
    entries[entry.entry_id.replace(".", "_")] = { state: "supported", reason: entry.reason };
  }
  return { entries };
}

/** Operations whose capability a map fails to report, i.e. unverified by definition. */
export function unreportedOperations(map: CapabilityMap | undefined): string[] {
  if (!map) return ENGINE_OWNED.map((entry) => entry.entry_id);
  return ENGINE_OWNED.filter((entry) => map.entries[entry.entry_id] === undefined).map((entry) => entry.entry_id);
}

export const ENGINE_OWNED_OPERATION_IDS: readonly string[] = ENGINE_OWNED.map((entry) => entry.entry_id);

export type { CapabilityState };
