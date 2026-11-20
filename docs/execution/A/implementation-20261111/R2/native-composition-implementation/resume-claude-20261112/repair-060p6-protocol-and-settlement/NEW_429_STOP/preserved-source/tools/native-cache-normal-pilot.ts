/**
 * The minimal POSITIVE pilot of the native cache custodian.
 *
 * It answers ONE question, and it answers it with a REAL process:
 *
 *   When the custodian of a draw really forks a worker, the worker really
 *   answers, and the whole process domain of the draw really disappears - does
 *   the supervisor prove it, and does the owner of the draw keep the receipt,
 *   the epochs and the failure?
 *
 * WHAT THIS TOOL IS NOT
 *
 * It is not a production path and it is not a rehearsal of one. It has exactly
 * two modes and no other configuration: there is no way to give it an
 * executable, an argument vector, a script, a signal or a process number. The
 * custodian it starts is the FIXED file of the repository, the interpreter is
 * the FIXED interpreter of this machine, and the worker is a COPY of the FIXED
 * helper of the faults, copied into the runtime root of the run and verified
 * against a digest before it is used.
 *
 * IT NEVER KILLS ANYTHING
 *
 * The custodian of a draw is the only wait owner of the group of that draw, and
 * the group may hold a worker that has already forked. This tool therefore
 * never signals a process and never signals a group: it asks the supervisor to
 * cancel the draw, and the custodian that is still alive ends the domain the
 * way it is supposed to. The capability of the nofork pilot - which may end a
 * custodian that never forked - is NOT reused here.
 *
 * THE OWNER IS REGISTERED BEFORE ANYTHING HAPPENS
 *
 * The runtime root, the supervisor, the reserved handle, the promise of the
 * start, the original failure and the state of the run are ONE registry entry,
 * and it is created SYNCHRONOUSLY and in its PARTIAL form: a failure between
 * two of those steps still has a precise owner, and the root is KEPT when the
 * end of the run is unknown. A root is never removed because a timer expired.
 *
 * THE REPORTS GO THROUGH ONE REVIEWED BOUNDARY
 *
 * The reporting boundary of this tool is the ACTUAL export of the reviewed
 * nofork pilot - not a copy of it. The entry point installs it before any
 * resource exists, and the SAME instance serves the whole run, so that a
 * destination that fails asynchronously is seen by both and may never end the
 * owner of a run.
 *
 * THE TWO MODES
 *
 *   normal              the draw really succeeds: the picture is 1024 bytes of
 *                       0x4a, and its digest is the digest of exactly those
 *                       bytes. It is a SYNTHETIC protocol, not a JPEG and not
 *                       a video: nothing here decodes a picture.
 *   assertion-failure  the same draw, but the owner waits until the worker of
 *                       the draw REALLY stated its identity, REALLY received
 *                       the authorisation and is REALLY alive, and only then
 *                       injects the deliberate failure and asks the supervisor
 *                       to cancel the very same handle. The run ends as a
 *                       failure with the complete terminal proof - and exit 1
 *                       is expected ONLY when that is exactly what happened.
 *
 * IMPORTING THIS FILE RUNS NOTHING. The entry guard is at the bottom.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CacheProcessSupervisor,
  type CacheCleanupInspection,
  type CacheDiagnosticSnapshot,
  type CacheDrawHandle,
  type CacheDrawRequest,
  type CacheDrawSettlement,
  type CacheProcessSupervisorOptions,
} from "../src/adapters/openfilm/cache-process-supervisor.js";

/** The two modes of this tool. There are no others. */
export const PILOT_MODES = Object.freeze(["normal", "assertion-failure"]);

/** The code of the DELIBERATE failure of the `assertion-failure` mode. */
export const EXPECTED_ASSERTION_FAILURE = "EXPECTED_ASSERTION_FAILURE";

/**
 * The protocol of the publication of the final record of this tool.
 *
 * It is an INTERNAL protocol of this CLI: it does not change the API of the
 * Host, its public DTOs or the EnginePort. It says what the exit code of the
 * command means:
 *
 *   0  the normal draw really succeeded AND the joint publication of its
 *      evidence is complete;
 *   1  the deliberate failure was really observed AND the joint publication
 *      of its evidence is complete - OR the run failed for an ordinary
 *      business reason, which is NEVER a pass;
 *   2  the arguments or the entry of the command were refused;
 *   3  a mandatory evidence, a report or the publication itself is not
 *      reliable - and this is NEVER an accepted fault.
 */
export const PILOT_PUBLICATION_PROTOCOL = "positive-pilot-publication-v2";

/** The exit code of a run that really succeeded. */
export const PILOT_EXIT_OK = 0;

/** The exit code of a fault, and of an ordinary business failure. */
export const PILOT_EXIT_FAULT = 1;

/** The exit code of a refusal of the arguments or of the entry. */
export const PILOT_EXIT_REFUSED = 2;

/**
 * The exit code of a run whose evidence, report or publication is not
 * reliable.
 *
 * It is DISTINCT from the exit code of the expected fault: a fault that is
 * really observed is a fact about the draw, and a publication that failed is
 * a fact about the evidence. They may never be the same code.
 */
export const PILOT_EXIT_UNRELIABLE = 3;

/**
 * The artifacts that the manifest of a run MUST name.
 *
 * They are the record of the run itself and the reviewed helper that the run
 * really used. A manifest that does not name them, or that names one of them
 * without its digest, is not a manifest of this run.
 */
export const REQUIRED_ARTIFACTS = Object.freeze([
  "candidate.json",
  "cache-worker-fixture.mjs",
]);

/**
 * The keys that the CANDIDATE always publishes.
 *
 * It is the LOCAL table of the published v2 records, and it is not a public
 * schema: it says what the writer of this tool always writes, so that a
 * record that is MISSING one of them is refused instead of being read as an
 * explicit null.
 */
const REQUIRED_CANDIDATE_KEYS = Object.freeze([
  "kind", "authoritative", "mode", "root",
  "custodian_sha256", "fixture_sha256", "copied_fixture_sha256", "scenario",
  "expected_image", "actual_image",
  "original_failure", "settlement_failure", "cleanup_facts", "terminal_proof",
  "terminal_proof_observations", "receipt_summary", "accumulator_summary",
  "raw_segments_saved", "timeline",
]);

/**
 * The keys that the MANIFEST always publishes.
 */
const REQUIRED_MANIFEST_KEYS = Object.freeze([
  "kind", "authoritative", "root", "artifacts", "listing_error",
  "excluded", "exclusion_reason", "required_artifacts",
]);

/**
 * The keys that the FINAL record always publishes.
 */
const REQUIRED_FINAL_KEYS = Object.freeze([
  "kind", "authoritative", "publication_protocol", "mode", "root",
  "exit_code", "kind_of_run", "fault_case_passed", "terminal_proof",
  "picture_sha256", "picture_bytes", "picture_is_the_exact_one",
  "original_failure", "settlement_failure", "cleanup_facts",
  "reporting_failure", "reporting_failures", "evidence_errors",
  "evidence_problems", "manifest_error", "required_artifacts",
  "candidate_sha256", "candidate_bytes", "manifest_sha256", "manifest_bytes",
  "terminal_proof_observations", "diagnostic_snapshot",
]);

/**
 * The keys that every artifact ROW always publishes.
 *
 * The `error` of a row is one of them: a row that does not carry it is not
 * an error-free row, and it may not be read as one.
 */
const REQUIRED_ARTIFACT_ROW_KEYS = Object.freeze(["name", "digest", "bytes", "error"]);

/**
 * The required keys that a record does NOT carry as its OWN property.
 *
 * `Object.hasOwn` and not `in`: an inherited property is not a published
 * field, and a missing field is not an explicit null. A value that is
 * `undefined` is missing as well: only a real `null` says "there is nothing
 * here".
 */
function missingRequiredKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): string[] {
  const missing: string[] = [];
  for (const key of keys) {
    if (!Object.hasOwn(record, key) || record[key] === undefined) missing.push(key);
  }
  return missing;
}

/**
 * The names that a published row may NEVER carry.
 *
 * The manifest may not hash itself, and the final record is written after
 * it: a row that names one of them is a self reference, and a self reference
 * is not a proof of anything.
 */
export const RESERVED_RECORD_NAMES = Object.freeze(["manifest.json", "final.json"]);

/** Whether a name is a legal, SIMPLE name of a file of the root. */
function isSimpleArtifactName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 255) return false;
  if (value === "." || value === "..") return false;
  if (value.includes("/") || value.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false;
  return true;
}

/** Whether a value is a COMPLETE lowercase digest of 64 hexadecimal digits. */
function isFullSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

/** Whether a value is a SAFE, non negative number of bytes. */
function isByteCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The problems of ONE published row of the manifest.
 *
 * EVERY published row is checked: a row that carries an error, a partial
 * digest, a partial number of bytes, a name that is not a simple file name
 * or a name that is reserved disqualifies the run. A row is never ignored
 * because its name is not one of the required ones.
 */
function artifactRowProblems(row: PilotArtifact): PilotBoundedError[] {
  const problems: PilotBoundedError[] = [];
  // A row that does not carry EVERY key is not a row of this protocol: the
  // `error` of a row that has none is an EXPLICIT null, and never a missing
  // field.
  const missing = missingRequiredKeys(row as unknown as Record<string, unknown>, REQUIRED_ARTIFACT_ROW_KEYS);
  if (missing.length > 0) {
    problems.push({
      name: "Error",
      message: `the manifest carries a row without ${missing.join(", ")}`,
      code: "ENAME",
    });
    return problems;
  }
  if (!isSimpleArtifactName(row.name)) {
    problems.push({
      name: "Error",
      message: "the manifest carries a row whose name is not a simple file name",
      code: "ENAME",
    });
    return problems;
  }
  if (RESERVED_RECORD_NAMES.includes(row.name)) {
    problems.push({
      name: "Error",
      message: `the manifest carries a row that names the reserved record ${row.name}`,
      code: "ERESERVED",
    });
  }
  if (row.error !== null) {
    if (!isBoundedErrorRecord(row.error)) {
      problems.push({
        name: "Error",
        message: `the manifest carries a row whose error is not a legal bounded failure`,
        code: "EERROR",
      });
      return problems;
    }
    problems.push(row.error);
    return problems;
  }
  if (!isFullSha256(row.digest)) {
    problems.push({
      name: "Error",
      message: `the manifest does not carry a complete digest for ${row.name}`,
      code: "EDIGEST",
    });
  }
  if (!isByteCount(row.bytes)) {
    problems.push({
      name: "Error",
      message: `the manifest does not carry a complete number of bytes for ${row.name}`,
      code: "EBYTES",
    });
  }
  return problems;
}

/**
 * The problems of the EVIDENCE of a run.
 *
 * Every one of them is a bounded fact, and every one of them disqualifies the
 * run:
 *
 *  - the LISTING of the artifacts failed;
 *  - EVERY published row is checked: its name, its error, its digest and its
 *    number of bytes. A row that carries an error is NOT ignored because its
 *    name is not one of the required ones;
 *  - a name appears twice, or a name escapes the root, or a name is one of
 *    the reserved records;
 *  - a REQUIRED artifact is not in the manifest;
 *  - the candidate could not be read, or the manifest does not name the
 *    digest AND the number of bytes of the candidate that is really on the
 *    disk;
 *  - the manifest could not be read.
 *
 * A top-level error of the listing is NOT enough: a run that could not hash
 * ONE artifact of its evidence is as disqualified as a run that could not
 * list the directory at all.
 */
function evidenceProblemsOf(
  facts: PilotArtifactFacts,
  candidateFacts: PilotFileFacts | null,
  manifestFacts: PilotFileFacts | null,
): PilotBoundedError[] {
  const problems: PilotBoundedError[] = [];
  if (facts.error !== null) problems.push(facts.error);
  const rows = new Map<string, PilotArtifact>();
  for (const artifact of facts.artifacts) {
    problems.push(...artifactRowProblems(artifact));
    if (!isSimpleArtifactName(artifact.name)) continue;
    if (rows.has(artifact.name)) {
      problems.push({
        name: "Error",
        message: `the manifest carries the row ${artifact.name} twice`,
        code: "EDUPLICATE",
      });
      continue;
    }
    rows.set(artifact.name, artifact);
  }
  for (const name of REQUIRED_ARTIFACTS) {
    if (!rows.has(name)) {
      problems.push({
        name: "Error",
        message: `the required artifact ${name} is not in the manifest`,
        code: "ENOENT",
      });
    }
  }
  // The LINK of the candidate: the manifest must name the digest AND the
  // number of bytes of the candidate that is really on the disk.
  const candidateRow = rows.get("candidate.json");
  if (candidateFacts === null) {
    problems.push({
      name: "Error",
      message: "the digest of candidate.json could not be read",
      code: "EIO",
    });
  } else if (candidateRow !== undefined) {
    if (candidateRow.digest !== candidateFacts.sha256) {
      problems.push({
        name: "Error",
        message: "the manifest does not name the digest of the candidate that is on the disk",
        code: "EIDMATCH",
      });
    }
    if (candidateRow.bytes !== candidateFacts.bytes) {
      problems.push({
        name: "Error",
        message: "the manifest does not name the number of bytes of the candidate that is on the disk",
        code: "EIBYTES",
      });
    }
  }
  if (manifestFacts === null) {
    problems.push({
      name: "Error",
      message: "the digest of manifest.json could not be read",
      code: "EIO",
    });
  }
  return problems;
}

/** Where the runtime roots of this tool live. */
export const PILOT_ROOT_RELATIVE_PATH = "var/native-cache-positive-pilot";

/** The root of the repository: the directory above `tools`. */
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The custodian, relative to the root of the repository. It is FIXED. */
export const CUSTODIAN_RELATIVE_PATH = "src/adapters/openfilm/cache-process-custodian.py";

/** The helper of the faults, relative to the root of the repository. It is FIXED. */
export const FIXTURE_RELATIVE_PATH = "tests/agent-driven/integration/helpers/cache-worker-fixture.mjs";

/** The interpreter of the custodian. It is FIXED. */
export const PYTHON_PATH = "/usr/bin/python3.12";

/** The scenario of the helper that really answers. */
export const NORMAL_SCENARIO = "normal";

/** The scenario of the helper that says hello, takes the authorisation and stays. */
export const SILENT_SCENARIO = "silent";

/**
 * The bound of the observations of a terminal proof.
 *
 * It is the bound of the production, and the tool does not accept a proof
 * that carries more observations than the production ever writes.
 */
const MAX_TERMINAL_OBSERVATIONS = 64;

/** The picture of the synthetic protocol: 1024 bytes of 0x4a. */
export const PICTURE_BYTES = 1024;

/** The one byte the picture is made of. */
export const PICTURE_BYTE = 0x4a;

/** The digest of exactly that picture. It is FIXED, and it is not a guess. */
export const PICTURE_SHA256 = createHash("sha256")
  .update(Buffer.alloc(PICTURE_BYTES, PICTURE_BYTE))
  .digest("hex");

/** How long one poll of the pilot waits, in milliseconds. */
export const PILOT_POLL_MS = 50;

/** How long one poll of the pilot waits for a fact of the draw, in milliseconds. */
export const PILOT_FACT_WAIT_MS = 30_000;

/** The options of one run. */
export interface PositivePilotOptions {
  readonly mode: "normal" | "assertion-failure";
  readonly expectedCustodianSha256: string;
  readonly expectedFixtureSha256: string;
}

/** One event of the helper, as it wrote it into its own runtime root. */
export interface PilotHelperEvent {
  readonly event: string;
  readonly pid?: number;
  readonly ticket_digest?: string;
  readonly scenario?: string;
}

/**
 * What the kernel says about ONE process, as this tool reads it.
 *
 * The STATE is part of the observation: a process that is a zombie is not
 * alive, and a known number is not a live one.
 */
export interface PilotIdentity {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly sid: number;
  readonly start_ticks: string;
  /** The state of the process in the kernel: ``R``, ``S``, ``Z``, ``T``... */
  readonly state: string;
}

/** What the kernel could say about one process. */
export interface PilotObservation {
  readonly presence: "gone" | "known" | "unknown";
  readonly identity: PilotIdentity | null;
}

/**
 * The surface of the supervisor that this pilot uses.
 *
 * It is the REAL supervisor that satisfies it, and the type is a STRUCTURAL
 * one so that a case may hand the pilot a stub of exactly these facts without
 * weakening the type of the production code.
 */
export interface PositivePilotSupervisor {
  reserve(request: CacheDrawRequest): CacheDrawHandle;
  start(handle: CacheDrawHandle): Promise<CacheDrawSettlement>;
  inspectCleanup(handle: unknown): CacheCleanupInspection;
  reconcileCleanup(handle: unknown): Promise<CacheCleanupInspection>;
  requestCancel(handle: unknown, originalError: unknown): void;
  diagnosticSnapshot(handle: unknown): CacheDiagnosticSnapshot;
}

/**
 * ONE registry entry: the owner of everything this run touches.
 *
 * It is created BEFORE any resource exists, and it is PARTIAL: the root, the
 * supervisor, the reserved handle and the promise of the start are attached to
 * it one by one, as they really come into being. A failure between two of
 * them still has a precise owner, and the root is KEPT when the end of the run
 * is unknown.
 *
 * It is never replaced by a boolean or by a path.
 */
export interface PositivePilotRegistryEntry {
  /** The runtime root, as soon as it exists. */
  root: string | null;
  /** The supervisor, as soon as it is constructed. */
  supervisor: PositivePilotSupervisor | null;
  /** The reserved handle, as soon as it is reserved. */
  reservedHandle: CacheDrawHandle | null;
  /** The promise of the start, as soon as the start was asked for. */
  startPromise: Promise<CacheDrawSettlement> | null;
  /** The FIRST failure of the run. It is never replaced. */
  originalFailure: unknown;
  /** Where the run is. It moves as the run moves. */
  state: "created" | "reserved" | "started" | "settled" | "unknown" | "not-started";
}

/** A bounded description of a failure. */
export interface PilotBoundedError {
  readonly name: string;
  readonly message: string;
  readonly code: string | null;
}

/** ONE artifact of the run, with the digest of its bytes. */
export interface PilotArtifact {
  readonly name: string;
  readonly digest: string | null;
  /** The number of bytes of the artifact, when it could be read. */
  readonly bytes: number | null;
  readonly error: PilotBoundedError | null;
}

/**
 * The facts of ONE file: the digest of its bytes and their number.
 *
 * A file that could not be read has NO facts: the answer is null, and it is
 * never a digest of nothing.
 */
export interface PilotFileFacts {
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * The result of a PUBLICATION of a record.
 *
 * It is the fact of the bytes that were really written: their number and
 * their digest. A publication that did not complete has NO result.
 */
export interface PilotPublication {
  readonly bytes: number;
  readonly sha256: string;
}

/**
 * The artifacts of the run, as they really are.
 *
 * A failure of the LISTING or of a HASH is reported here and never hidden as
 * an empty list: a required read that failed is a fact of the case, and it
 * disqualifies it.
 */
export interface PilotArtifactFacts {
  readonly artifacts: readonly PilotArtifact[];
  readonly error: PilotBoundedError | null;
}

/** The boundaries of the pilot. Every one of them may be replaced. */
export interface PositivePilotDependencies {
  readonly createSupervisor: (options: CacheProcessSupervisorOptions) => PositivePilotSupervisor;
  /**
   * The ONE allocation of the run: it creates the runtime root and returns
   * its path. It creates NOTHING else, so that the root may be registered the
   * moment it exists.
   */
  readonly createRoot: () => string;
  /** The preparation of a root that exists: its subdirectories. */
  readonly prepareRoot: (root: string) => void;
  readonly copyHelper: (source: string, destination: string) => void;
  readonly writeScenario: (root: string, scenario: string) => void;
  /** The digest and the number of the bytes of a file, or null. */
  readonly fileFacts: (path: string) => PilotFileFacts | null;
  /**
   * The BYTES of a file of the root.
   *
   * It is the boundary of the READING of the evidence: a file that could not
   * be read has NO bytes, and the answer is null - it is never the bytes of
   * nothing.
   */
  readonly readBytes: (path: string) => Buffer | null;
  readonly writeEvidence: (root: string, name: string, data: unknown) => void;
  /**
   * The PUBLICATION of the final record.
   *
   * It writes into a TEMPORARY file of the SAME root, it closes it, and it
   * renames it over the name of the record. A publication that did not
   * complete leaves NO record: a temporary file is not a record, and it is
   * never read as one.
   */
  readonly publishEvidence: (root: string, name: string, data: unknown) => PilotPublication;
  /** The artifacts of the root, with their digests and the errors of the reads. */
  readonly artifactFacts: (root: string) => PilotArtifactFacts;
  readonly readHelperEvents: (root: string) => readonly PilotHelperEvent[];
  readonly observeIdentity: (pid: number) => PilotObservation;
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  /**
   * The write route of the reporting.
   *
   * It takes a CALLBACK: the completion of the write is a route of a failure
   * of the destination, and a destination that fails asynchronously must never
   * end the owner of the run.
   */
  readonly writeStderr: (text: string, callback?: (error: unknown) => void) => void;
  /** The destination of the reports. It is LISTENED to before anything starts. */
  readonly reportStream: { on?: (event: string, listener: (error: unknown) => void) => unknown } | null;
  readonly custodianPath: string;
  readonly fixtureSource: string;
  readonly vendorRoot: string;
  readonly producerFile: string;
  readonly producerSha256: string;
  readonly pythonExecutable: string;
}

/** The REAL boundaries of the pilot. */
export const REAL_DEPENDENCIES: PositivePilotDependencies = {
  createSupervisor: (options) => new CacheProcessSupervisor(options),
  createRoot: () => {
    // The ONE allocation of the run. The root is registered the moment this
    // returns, and the preparation of the root happens AFTER that.
    const base = join(REPOSITORY_ROOT, PILOT_ROOT_RELATIVE_PATH);
    mkdirSync(base, { recursive: true });
    return mkdtempSync(join(base, "run-"));
  },
  prepareRoot: (root) => {
    for (const name of ["home", "cache", "config", "data", "runtime", "tmp"]) {
      mkdirSync(join(root, name), { recursive: true, mode: 0o700 });
    }
  },
  copyHelper: (source, destination) => { copyFileSync(source, destination); },
  writeScenario: (root, scenario) => {
    writeFileSync(join(root, "cache-worker-fixture.scenario"), `${scenario}\n`, "utf8");
  },
  fileFacts: (path) => {
    try {
      const bytes = readFileSync(path);
      return {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      };
    } catch {
      return null;
    }
  },
  readBytes: (path) => {
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  },
  writeEvidence: (root, name, data) => {
    writeFileSync(join(root, name), `${JSON.stringify(data, null, 2)}\n`, "utf8");
  },
  publishEvidence: (root, name, data) => {
    // The PUBLICATION of a record.
    //
    // The bytes go into a TEMPORARY file of the SAME root, the file is
    // created EXCLUSIVELY, it is closed, and only then it is RENAMED over the
    // name of the record. A publication that did not complete leaves NO
    // record: the temporary file is not a record, and it is never read as
    // one.
    const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, "utf8");
    const temporary = join(root, `.${name}.publishing`);
    const handle = openSync(temporary, "wx", 0o600);
    let closed = false;
    try {
      writeFileSync(handle, bytes);
      closeSync(handle);
      closed = true;
      renameSync(temporary, join(root, name));
    } catch (error) {
      if (!closed) {
        try { closeSync(handle); } catch { /* the handle is already gone */ }
      }
      try { rmSync(temporary, { force: true }); } catch { /* it stays, and it is not a record */ }
      throw error;
    }
    return {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  },
  artifactFacts: (root) => {
    // The LISTING and the HASHING of the artifacts of the run. A failure of
    // either one is REPORTED: it is never hidden as an empty list.
    let names: string[];
    try {
      names = readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .sort();
    } catch (error) {
      return {
        artifacts: [],
        error: {
          name: String((error as { name?: unknown }).name ?? "Error").slice(0, 128),
          message: String((error as { message?: unknown }).message ?? "").slice(0, 1024),
          code: typeof (error as { code?: unknown }).code === "string"
            ? String((error as { code?: unknown }).code).slice(0, 64)
            : null,
        },
      };
    }
    const artifacts = names.map((name) => {
      const facts = REAL_DEPENDENCIES.fileFacts(join(root, name));
      return {
        name,
        digest: facts === null ? null : facts.sha256,
        bytes: facts === null ? null : facts.bytes,
        error: facts === null ? {
          name: "Error",
          message: `the digest of ${name} could not be read`,
          code: "EIO",
        } : null,
      };
    });
    return { artifacts, error: null };
  },
  readHelperEvents: (root) => {
    const path = join(root, "cache-worker-fixture.events");
    if (!existsSync(path)) return [];
    const text = readFileSync(path, "utf8");
    const pieces = text.split("\n");
    // The LAST piece is the text after the last newline: a line that was not
    // TERMINATED is a line that is still being written, and it is not
    // consumed. A line that IS terminated and that cannot be read is a
    // FAILURE: the run does not get to pretend that it did not happen.
    const complete = pieces.slice(0, pieces.length - 1);
    const events: PilotHelperEvent[] = [];
    for (const line of complete) {
      if (line.trim() === "") continue;
      events.push(JSON.parse(line) as PilotHelperEvent);
    }
    return events;
  },
  observeIdentity: (pid) => {
    try {
      const text = readFileSync(`/proc/${pid}/stat`, "utf8");
      const cut = text.lastIndexOf(")");
      const fields = text.slice(cut + 1).trim().split(/\s+/u);
      return {
        presence: "known",
        identity: {
          pid: Number(text.slice(0, text.indexOf("(")).trim()),
          ppid: Number(fields[1] ?? "0"),
          pgid: Number(fields[2] ?? "0"),
          sid: Number(fields[3] ?? "0"),
          start_ticks: String(fields[19] ?? ""),
          state: String(fields[0] ?? ""),
        },
      };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      // A file that could not be READ is UNKNOWN: it is never "gone".
      if (code === "ENOENT" || code === "ESRCH") return { presence: "gone", identity: null };
      return { presence: "unknown", identity: null };
    }
  },
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolveSleep) => { setTimeout(resolveSleep, milliseconds); }),
  writeStderr: (text, callback) => { process.stderr.write(text, callback); },
  reportStream: process.stderr,
  custodianPath: join(REPOSITORY_ROOT, CUSTODIAN_RELATIVE_PATH),
  fixtureSource: join(REPOSITORY_ROOT, FIXTURE_RELATIVE_PATH),
  vendorRoot: "/nonexistent/vendor",
  producerFile: "packages/openfilm/studio/server/pageframes.mjs",
  producerSha256: "0".repeat(64),
  pythonExecutable: PYTHON_PATH,
};

/** A failure of the pilot itself. */
export class PositivePilotFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PositivePilotFailure";
    this.code = code;
  }
}

/** Keep a bounded description of an error. */
function boundedError(error: unknown): { name: string; message: string; code: string | null } {
  if (error === null || error === undefined) return { name: "Error", message: "", code: null };
  const value = error as { name?: unknown; message?: unknown; code?: unknown };
  const code = typeof value.code === "string" ? value.code.slice(0, 64) : null;
  const message = typeof value.message === "string" ? value.message.slice(0, 1024) : String(error).slice(0, 1024);
  return { name: String(value.name ?? "Error").slice(0, 128), message, code };
}

/**
 * The REPORTING BOUNDARY of this tool.
 *
 * It is the ACTUAL export of the REVIEWED nofork pilot - the file that was
 * reviewed with an asynchronous stderr, a callback on every write and a
 * listener that is never removed while the owner is alive. This tool does NOT
 * keep a second copy of that boundary: a copy is a boundary that was never
 * reviewed, and it is exactly the copy that let a delayed EPIPE end the owner
 * of a run.
 *
 * The typing is EXPLICIT here: the module is loaded with a guarded dynamic
 * import of the FIXED local path, and the shape of its export is declared
 * rather than assumed. The nofork signal and cleanup authority is NOT reused:
 * only the reporting factory is.
 */
export interface ReviewedReportingBoundary {
  readonly report: (text: string) => boolean;
  readonly settled: () => Promise<void>;
  readonly firstFailure: {
    readonly route: string;
    readonly error: { readonly name: string; readonly message: string; readonly code: string | null };
  } | null;
  readonly failures: readonly {
    readonly route: string;
    readonly error: { readonly name: string; readonly message: string; readonly code: string | null };
  }[];
  readonly pending: number;
  readonly broken: boolean;
}

/** The options of the reviewed factory, as it declares them. */
export interface ReviewedReportingOptions {
  readonly stream?: {
    readonly on?: (event: string, listener: (error: unknown) => void) => unknown;
  } | null;
  readonly write?: ((text: string, callback?: (error: unknown) => void) => void) | null;
}

/** The shape of the module of the reviewed nofork pilot that this tool uses. */
interface ReviewedNoforkPilotModule {
  readonly createReportingBoundary: (options: ReviewedReportingOptions) => ReviewedReportingBoundary;
}

/**
 * The FIXED specifier of the reviewed nofork pilot.
 *
 * It is relative to THIS file, and it names one local file of this
 * repository. It is typed as a plain string on purpose: the module is loaded
 * at RUN time, and the shape of its export is declared below.
 */
const NOFORK_PILOT_SPECIFIER: string = "./native-cache-nofork-pilot.mjs";

/**
 * The ACTUAL reporting factory of the REVIEWED nofork pilot.
 *
 * It is the very same factory for the whole run: the entry point and the
 * runner share ONE instance, so a report is never written through another
 * route and a failure of the destination is seen by both.
 */
export async function createReviewedReportingBoundary(
  stream: { readonly on?: (event: string, listener: (error: unknown) => void) => unknown } | null,
  write: ((text: string, callback?: (error: unknown) => void) => void) | null,
): Promise<ReviewedReportingBoundary> {
  const loaded = await import(/* @vite-ignore */ NOFORK_PILOT_SPECIFIER) as Record<string, unknown>;
  const factory = loaded["createReportingBoundary"];
  if (typeof factory !== "function") {
    throw new PositivePilotFailure(
      "REPORTING_BOUNDARY_MISSING",
      "the reviewed nofork pilot does not export a reporting boundary: no report of this run may be written");
  }
  const create = factory as (options: ReviewedReportingOptions) => ReviewedReportingBoundary;
  return create({ stream, write });
}

/**
 * Parse the arguments of the tool.
 *
 * It takes EXACTLY a mode and two digests, and it refuses everything else.
 */
export function parsePositivePilotArguments(argv: readonly string[]): PositivePilotOptions {
  const options = {
    mode: null as "normal" | "assertion-failure" | null,
    expectedCustodianSha256: null as string | null,
    expectedFixtureSha256: null as string | null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--mode") {
      const value = argv[index + 1];
      index += 1;
      if (value === undefined || !PILOT_MODES.includes(value)) {
        throw new PositivePilotFailure("BAD_MODE", `the mode must be one of ${PILOT_MODES.join(", ")}`);
      }
      options.mode = value as "normal" | "assertion-failure";
      continue;
    }
    if (argument === "--expected-custodian-sha256") {
      const value = argv[index + 1];
      index += 1;
      if (value === undefined || !/^[0-9a-f]{64}$/u.test(value)) {
        throw new PositivePilotFailure("BAD_SHA256", "the expected digest of the custodian must be 64 hexadecimal digits");
      }
      options.expectedCustodianSha256 = value;
      continue;
    }
    if (argument === "--expected-fixture-sha256") {
      const value = argv[index + 1];
      index += 1;
      if (value === undefined || !/^[0-9a-f]{64}$/u.test(value)) {
        throw new PositivePilotFailure("BAD_SHA256", "the expected digest of the helper must be 64 hexadecimal digits");
      }
      options.expectedFixtureSha256 = value;
      continue;
    }
    throw new PositivePilotFailure("BAD_ARGUMENT", `the argument ${String(argument)} is not one this pilot takes`);
  }
  if (options.mode === null) {
    throw new PositivePilotFailure("NO_MODE", "this pilot needs a --mode of normal or assertion-failure");
  }
  if (options.expectedCustodianSha256 === null) {
    throw new PositivePilotFailure("NO_CUSTODIAN_SHA256", "this pilot needs the --expected-custodian-sha256 of the reviewed custodian");
  }
  if (options.expectedFixtureSha256 === null) {
    throw new PositivePilotFailure("NO_FIXTURE_SHA256", "this pilot needs the --expected-fixture-sha256 of the reviewed helper");
  }
  return {
    mode: options.mode,
    expectedCustodianSha256: options.expectedCustodianSha256,
    expectedFixtureSha256: options.expectedFixtureSha256,
  };
}

/**
 * The registry of the runs of this process.
 *
 * It holds the owner of every run that is alive, and it is the thing that
 * keeps a root, a supervisor, a handle and a promise together.
 */
export const PILOT_REGISTRY = new Map<string, PositivePilotRegistryEntry>();

/**
 * The PUBLICATION of the final record of a run, as the run returns it.
 *
 * It is the ELIGIBILITY of the publication and the facts of the bytes that
 * were really written. A consumer of a run may not accept a record because
 * the record says so: it may accept it because the publication is eligible
 * AND the digests of the ACTUAL bytes match AND the exit code of the
 * protocol says what it says.
 */
export interface PilotPublicationFacts {
  /** The protocol of the publication. */
  readonly protocol: string;
  /** Whether the final record was REALLY published. */
  readonly published: boolean;
  /** The exit code of the run, as the protocol says it. */
  readonly exit_code: number;
  /** The digest of the bytes of the published final, or null. */
  readonly final_sha256: string | null;
  /** The number of bytes of the published final, or null. */
  readonly final_bytes: number | null;
  /** The digest of the bytes of the manifest, or null. */
  readonly manifest_sha256: string | null;
  /** The number of bytes of the manifest, or null. */
  readonly manifest_bytes: number | null;
  /** The digest of the bytes of the candidate, or null. */
  readonly candidate_sha256: string | null;
  /** The number of bytes of the candidate, or null. */
  readonly candidate_bytes: number | null;
  /** Every problem of the evidence, as a bounded fact. */
  readonly errors: readonly PilotBoundedError[];
}

/** The outcome of one run. */
export interface PositivePilotOutcome {
  readonly kind: "ok" | "fault-observed" | "failed" | "unknown";
  readonly mode: "normal" | "assertion-failure";
  /** The runtime root that was REALLY allocated, or null when there was none. */
  readonly root: string | null;
  readonly exitCode: number;
  readonly originalFailure: unknown;
  readonly settlementFailure: unknown;
  /** The bounded facts of the RAW cleanup of the draw. */
  readonly cleanupFacts: readonly PilotBoundedError[];
  readonly faultCasePassed: boolean;
  readonly terminalProof: boolean;
  readonly pictureSha256: string | null;
  readonly pictureBytes: number | null;
  readonly pictureIsTheExactOne: boolean;
  readonly reportingFailure: { readonly route: string; readonly error: { name: string; message: string; code: string | null } } | null;
  readonly evidenceErrors: readonly { readonly name: string; readonly error: { name: string; message: string; code: string | null } }[];
  /** Whether the FINAL qualification was really written. */
  readonly authoritative: boolean;
  /**
   * The PUBLICATION of the final record.
   *
   * It is the joint authority of a run: the eligibility of the publication,
   * the digests of the ACTUAL bytes of the three records and the exit code
   * of the protocol.
   */
  readonly publication: PilotPublicationFacts;
  /**
   * The ACTUAL diagnostic snapshot of the run.
   *
   * It is the snapshot that the runner took ONCE, at the end of the run, and
   * it is the FROZEN one: it is the baseline of the result facts, and the
   * candidate and the final were built from it. It is never re-sampled, and
   * it never becomes a second authority - it carries facts, and it grants no
   * cleanup and no authority of its own.
   *
   * It is an INTERNAL surface of this tool: it is not a public DTO, not an
   * MCP tool and not an EnginePort method.
   */
  readonly diagnosticSnapshot: CacheDiagnosticSnapshot | null;
}

/** Whether the picture of the draw is EXACTLY the synthetic picture. */
export function isTheExactPicture(picture: Buffer | null): boolean {
  if (picture === null) return false;
  if (picture.length !== PICTURE_BYTES) return false;
  for (const byte of picture) {
    if (byte !== PICTURE_BYTE) return false;
  }
  return createHash("sha256").update(picture).digest("hex") === PICTURE_SHA256;
}

/**
 * The worker of the draw, as the supervisor ACCEPTED it.
 *
 * It is the EPOCH of the worker: its number, its start ticks, its group, its
 * session and its parent. A process that is not this very process is not the
 * worker of the draw, whatever the number says.
 */
export interface AcceptedWorker {
  readonly pid: number;
  readonly start_ticks: string;
  readonly pgid: number;
  readonly sid: number;
  readonly ppid: number;
}

/** Whether the observation is the VERY SAME process as the accepted worker. */
export function isTheSameEpoch(observation: PilotObservation, worker: AcceptedWorker): boolean {
  if (observation.presence !== "known" || observation.identity === null) return false;
  if (observation.identity.pid !== worker.pid) return false;
  if (String(observation.identity.start_ticks) !== String(worker.start_ticks)) return false;
  // The WHOLE epoch is compared: the parent, the group and the session of the
  // accepted worker. A process that only shares its number is not it.
  if (observation.identity.ppid !== worker.ppid) return false;
  if (observation.identity.pgid !== worker.pgid) return false;
  if (observation.identity.sid !== worker.sid) return false;
  // A zombie is not alive: a known number that is a zombie is not the live
  // worker of the draw.
  const state = observation.identity.state;
  if (state === "Z" || state === "X" || state === "x") return false;
  return true;
}

/** The worker the supervisor accepted, as a read-only fact. */
function acceptedWorker(entry: PositivePilotRegistryEntry): AcceptedWorker | null {
  const supervisor = entry.supervisor;
  const handle = entry.reservedHandle;
  if (supervisor === null || handle === null) return null;
  const snapshot = supervisor.diagnosticSnapshot(handle);
  const worker = snapshot.worker;
  if (worker === null) return null;
  return {
    pid: worker.pid,
    start_ticks: String(worker.start_ticks),
    pgid: worker.pgid,
    sid: worker.sid,
    ppid: worker.ppid,
  };
}

/**
 * Whether the worker of the draw REALLY stated its identity and REALLY lives.
 *
 * A known number is NOT a live worker: the FRESH observation of the kernel
 * must be the very same process - the same number AND the same start ticks -
 * and it must not be a zombie.
 */
async function waitForLiveWorker(
  entry: PositivePilotRegistryEntry,
  deps: PositivePilotDependencies,
): Promise<{ readonly live: boolean; readonly worker: AcceptedWorker | null }> {
  const deadline = deps.now() + PILOT_FACT_WAIT_MS;
  for (;;) {
    const worker = acceptedWorker(entry);
    if (worker !== null) {
      const observation = deps.observeIdentity(worker.pid);
      if (isTheSameEpoch(observation, worker)) return { live: true, worker };
    }
    if (deps.now() >= deadline) return { live: false, worker: null };
    await deps.sleep(PILOT_POLL_MS);
  }
}

/**
 * Whether the helper of the run REALLY received the authorisation.
 *
 * The GO event is bound to the SAME worker: it must come from the runtime root
 * of this run, it must name the number of the accepted worker, and it must
 * carry the digest of the ticket of THIS draw. A GO of another draw, or of
 * another worker, is not an authorisation of this one.
 */
async function waitForAuthorisation(
  root: string,
  deps: PositivePilotDependencies,
  worker: AcceptedWorker,
  ticketDigest: string,
): Promise<boolean> {
  const deadline = deps.now() + PILOT_FACT_WAIT_MS;
  for (;;) {
    const events = deps.readHelperEvents(root);
    const go = events.find(event => event.event === "go");
    if (go !== undefined && go.pid === worker.pid && go.ticket_digest === ticketDigest) {
      return true;
    }
    if (deps.now() >= deadline) return false;
    await deps.sleep(PILOT_POLL_MS);
  }
}

/**
 * The state of ONE run, as the owner of it sees it.
 *
 * It is ONE object: the failure, the settlement, the picture, the cleanup and
 * the proof belong to the SAME run, and they are never split into two
 * histories.
 */
interface PilotRunState {
  /** The FIRST failure of the run. It is never replaced. */
  originalFailure: unknown;
  /** The failure of the REAL settlement of the draw. */
  settlementFailure: unknown;
  /** The bounded facts of the RAW cleanup of the draw. */
  cleanupFacts: PilotBoundedError[];
  /** The picture of the REAL settlement of the draw. */
  picture: Buffer | null;
  /** Whether the domain of the draw is really gone. */
  terminalProof: boolean;
  /** The qualification of the deliberate failure. */
  faultCasePassed: boolean;
  /** Whether the owner already asked this draw to stop. */
  cancelIssued: boolean;
  /** The REAL settlement of the draw, as soon as it arrives. */
  settlement: CacheDrawSettlement | null;
  /** Whether the settlement of the draw arrived. */
  settled: boolean;
}

/** The bounded facts of a cleanup: the first ones, and the count of the rest. */
const MAX_CLEANUP_FACTS = 32;

/** The bounded serialization of the raw cleanup of a settlement. */
function boundedCleanupFacts(cleanup: readonly unknown[] | undefined): PilotBoundedError[] {
  if (!Array.isArray(cleanup)) return [];
  const facts: PilotBoundedError[] = [];
  for (const cause of cleanup.slice(0, MAX_CLEANUP_FACTS)) {
    const record = (cause ?? {}) as { name?: unknown; message?: unknown; code?: unknown };
    facts.push({
      name: String(record.name ?? "Error").slice(0, 128),
      message: String(record.message ?? "").slice(0, 1024),
      code: typeof record.code === "string" ? record.code.slice(0, 64) : null,
    });
  }
  return facts;
}

/** One observation of the run, in the order in which it really happened. */
interface PilotTimelineEntry {
  readonly at: number;
  readonly what: string;
  readonly detail: unknown;
}

/**
 * THE CANONICAL TERMINAL CONTINUATION of a run.
 *
 * It is the ONLY place where a run ends, and it is ALWAYS reached: through
 * the normal path, through a failure of the setup and through an exception.
 *
 * The rules are strict:
 *
 *  - a draw that is merely PENDING is ORDINARY PROGRESS: it is waited for,
 *    and it is NEVER cancelled because it has not finished yet. The owner asks
 *    the draw to stop only when the run really has a failure of its own to
 *    report, and then only ONCE, on the SAME handle;
 *  - the SAME promise of the start is followed: a run never gives up its own
 *    draw and starts another one, and it never replaces the handle or the
 *    promise;
 *  - the ORIGINAL result of that promise is read: the picture, the original
 *    error AND the raw cleanup of the draw. A run that was held and that
 *    recovered never loses the result of the draw it owned;
 *  - a draw that is HELD is reconciled with the SAME owner until the FRESH
 *    proof arrives: the poll is bounded, the RESPONSIBILITY is not, and there
 *    is no expiry of it;
 *  - when there is no handle at all, the run says that nothing was started:
 *    there is no phantom child and no invented failure.
 */
async function continueToTerminal(
  entry: PositivePilotRegistryEntry,
  deps: PositivePilotDependencies,
  state: PilotRunState,
  timeline: PilotTimelineEntry[],
): Promise<void> {
  const supervisor = entry.supervisor;
  const handle = entry.reservedHandle;
  if (supervisor === null || handle === null || entry.startPromise === null) {
    // NOTHING was started: the run ends as the failure it is, and there is no
    // phantom child.
    entry.state = "not-started";
    timeline.push({ at: deps.now(), what: "not-started", detail: null });
    return;
  }
  // 1. The draw is asked to stop ONCE, on the SAME handle, and ONLY when the
  //    run really has a failure of its own to report. A draw that is still
  //    PENDING is not a failure: it is waited for.
  if (state.originalFailure !== null && !state.cancelIssued) {
    try {
      supervisor.requestCancel(handle, state.originalFailure);
      state.cancelIssued = true;
      timeline.push({
        at: deps.now(),
        what: "owned-cancel",
        detail: boundedError(state.originalFailure),
      });
    } catch {
      // The handle is foreign or the draw is over: there is nothing more to
      // ask, and the owner continues with the promise it already has.
      timeline.push({ at: deps.now(), what: "owned-cancel-refused", detail: null });
    }
  }
  // 2. The SAME promise of the start is followed, and its REAL result is read.
  for (;;) {
    observeSettlement(entry, state, timeline, deps);
    const current = supervisor.inspectCleanup(handle);
    if (state.settled && current.settled && !current.cleanup_required) {
      state.terminalProof = true;
      timeline.push({ at: deps.now(), what: "terminal-proof", detail: null });
      return;
    }
    if (current.cleanup_required) {
      try {
        await supervisor.reconcileCleanup(handle);
      } catch {
        // The draw is still held: the reason is in the inspection, and the
        // owner is kept exactly where it is.
      }
    }
    await deps.sleep(PILOT_POLL_MS);
  }
}

/**
 * Read the REAL settlement of the draw, once, into the state of the run.
 *
 * The picture, the original error AND the raw cleanup of the draw are kept:
 * a count of the cleanup is not the cleanup.
 */
function observeSettlement(
  entry: PositivePilotRegistryEntry,
  state: PilotRunState,
  timeline: PilotTimelineEntry[],
  deps: PositivePilotDependencies,
): void {
  if (!state.settled || state.settlement === null) return;
  const value = state.settlement;
  state.settlement = null;
  state.picture = value.picture;
  state.cleanupFacts = boundedCleanupFacts(value.cleanup);
  if (value.error !== null && value.error !== undefined) {
    state.settlementFailure = value.error;
  }
  if (state.originalFailure === null && value.error !== null && value.error !== undefined) {
    state.originalFailure = value.error;
    entry.originalFailure = value.error;
  }
  entry.state = "settled";
  timeline.push({
    at: deps.now(),
    what: "settlement",
    detail: {
      has_picture: value.picture !== null,
      picture_bytes: value.picture === null ? null : value.picture.length,
      error: value.error === null || value.error === undefined ? null : boundedError(value.error),
      cleanup: state.cleanupFacts.length,
    },
  });
}

/**
 * A BOUNDED wait for the accepted epoch of the worker.
 *
 * While the worker of the draw is null the draw is STARTING, and a starting
 * draw is not a failed observation: the deadline only decides whether the
 * injection happens at all, and it NEVER decides that the resources are
 * gone.
 *
 * A REAL failure of the draw is reported as it is: it is the outcome of the
 * run, and it is never masked by the deliberate failure.
 */
async function waitForAcceptedWorker(
  entry: PositivePilotRegistryEntry,
  deps: PositivePilotDependencies,
  state: PilotRunState,
  timeline: PilotTimelineEntry[],
): Promise<{ readonly worker: AcceptedWorker | null; readonly realFailure: unknown }> {
  const deadline = deps.now() + PILOT_FACT_WAIT_MS;
  for (;;) {
    // A REAL failure of the draw is the outcome of the run.
    if (state.settled && state.settlement !== null) {
      const value = state.settlement;
      if (value.error !== null && value.error !== undefined) {
        return { worker: null, realFailure: value.error };
      }
    }
    const worker = acceptedWorker(entry);
    if (worker !== null) return { worker, realFailure: null };
    if (deps.now() >= deadline) {
      timeline.push({ at: deps.now(), what: "accepted-worker-deadline", detail: null });
      return { worker: null, realFailure: null };
    }
    await deps.sleep(PILOT_POLL_MS);
  }
}

/**
 * The DELIBERATE failure of the `assertion-failure` mode.
 *
 * It is injected ONLY after the worker of the draw REALLY stated its
 * identity, REALLY received the authorisation of THIS draw and is REALLY
 * alive - and the LAST check of the kernel is SYNCHRONOUS and happens right
 * before the cancel, with no await in between.
 *
 * The SAME handle is cancelled, with the ORIGINAL error object.
 */
async function runTheDeliberateFailure(
  entry: PositivePilotRegistryEntry,
  deps: PositivePilotDependencies,
  state: PilotRunState,
  timeline: PilotTimelineEntry[],
): Promise<void> {
  const supervisor = entry.supervisor;
  const handle = entry.reservedHandle;
  if (supervisor === null || handle === null) {
    throw new PositivePilotFailure(
      "DRAW_NOT_RESERVED", "the draw of this run was not reserved: no failure was injected");
  }
  const refuse = (code: string, message: string): void => {
    const failure = new PositivePilotFailure(code, message);
    // The FIRST failure of the run is kept: a refusal never replaces a REAL
    // failure of the draw.
    if (state.originalFailure === null) {
      state.originalFailure = failure;
      entry.originalFailure = failure;
    }
    timeline.push({ at: deps.now(), what: "no-injection", detail: { code } });
    if (!state.cancelIssued) {
      try {
        supervisor.requestCancel(handle, state.originalFailure ?? failure);
        state.cancelIssued = true;
      } catch {
        // The handle is foreign or the draw is over.
      }
    }
  };
  // 1. The accepted epoch of the worker, with a BOUNDED wait. The draw may be
  //    STARTING, and a null worker during the startup is not a failure.
  const ready = await waitForAcceptedWorker(entry, deps, state, timeline);
  if (ready.realFailure !== null) {
    // The draw REALLY failed: that failure is the outcome of the run, and the
    // deliberate failure is never injected on top of it.
    if (state.originalFailure === null) {
      state.originalFailure = ready.realFailure;
      entry.originalFailure = ready.realFailure;
    }
    timeline.push({
      at: deps.now(),
      what: "real-failure",
      detail: boundedError(ready.realFailure),
    });
    return;
  }
  const worker = ready.worker;
  if (worker === null) {
    refuse("WORKER_NOT_OBSERVED",
      "the worker of the draw was not really observed: no failure was injected");
    return;
  }
  // 2. The GO of THIS draw, from THIS root, for THIS worker.
  const ticketDigest = supervisor.diagnosticSnapshot(handle).ticket_digest;
  const authorised = await waitForAuthorisation(entry.root ?? "", deps, worker, ticketDigest);
  const live = await waitForLiveWorker(entry, deps);
  if (!authorised || !live.live) {
    refuse("WORKER_NOT_OBSERVED",
      "the worker of the draw was not really observed: no failure was injected");
    return;
  }
  // 3. The LAST fresh kernel check: it is SYNCHRONOUS, and there is no await
  // between it and the cancel of the very same handle.
  const finalWorker = acceptedWorker(entry);
  if (finalWorker === null) {
    refuse("WORKER_NOT_OBSERVED",
      "the worker of the draw was not really observed: no failure was injected");
    return;
  }
  const observation = deps.observeIdentity(finalWorker.pid);
  if (!isTheSameEpoch(observation, finalWorker)) {
    refuse("WORKER_NOT_LIVE",
      "the worker of the draw was not really alive at the moment of the injection: no failure was injected");
    return;
  }
  timeline.push({
    at: deps.now(),
    what: "same-epoch-live",
    detail: { pid: finalWorker.pid, start_ticks: finalWorker.start_ticks },
  });
  // The deliberate failure, and the cancel of the VERY SAME handle.
  const deliberate = new PositivePilotFailure(
    EXPECTED_ASSERTION_FAILURE,
    `the deliberate assertion failure of the positive pilot (${EXPECTED_ASSERTION_FAILURE})`);
  state.originalFailure = deliberate;
  entry.originalFailure = deliberate;
  timeline.push({ at: deps.now(), what: "injection", detail: { code: EXPECTED_ASSERTION_FAILURE } });
  supervisor.requestCancel(handle, deliberate);
  state.cancelIssued = true;
}

/**
 * Run ONE positive pilot.
 *
 * The order is fixed and it is not permuted:
 *
 *   1. the reporting boundary is installed - it is the REVIEWED one;
 *   2. the entry of the run is created, and it is PARTIAL;
 *   3. the runtime root is allocated and REGISTERED at once, and only then it
 *      is prepared;
 *   4. the reviewed bytes are pinned, the helper is copied, and the COPY is
 *      verified against its digest;
 *   5. the supervisor, the reserved handle and the promise of the start are
 *      attached to the entry, one by one, as they really come into being;
 *   6. the mode runs - the normal one waits for the real picture, and the
 *      deliberate one waits for the worker to be really alive;
 *   7. the CANONICAL TERMINAL CONTINUATION runs, in the finally, and it owns
 *      the draw until the end of it.
 */
export async function runPositivePilot(
  options: PositivePilotOptions,
  deps: PositivePilotDependencies = REAL_DEPENDENCIES,
  reporting?: ReviewedReportingBoundary,
): Promise<PositivePilotOutcome> {
  const boundary = reporting ?? await createReviewedReportingBoundary(deps.reportStream, deps.writeStderr);
  const evidenceErrors: { name: string; error: { name: string; message: string; code: string | null } }[] = [];
  const writeEvidence = (root: string, name: string, data: unknown): void => {
    try {
      deps.writeEvidence(root, name, data);
    } catch (error) {
      // A failure of the filesystem is a FACT and never the end of the owner:
      // it is kept, it disqualifies the case, and the run goes on.
      evidenceErrors.push({ name, error: boundedError(error) });
    }
  };

  // The entry is created BEFORE any resource exists, and it is PARTIAL: the
  // root, the supervisor, the reserved handle and the promise of the start are
  // attached to it as they really come into being.
  const entry: PositivePilotRegistryEntry = {
    root: null,
    supervisor: null,
    reservedHandle: null,
    startPromise: null,
    originalFailure: null,
    state: "created",
  };
  const state: PilotRunState = {
    originalFailure: null,
    settlementFailure: null,
    cleanupFacts: [],
    picture: null,
    terminalProof: false,
    faultCasePassed: false,
    cancelIssued: false,
    settlement: null,
    settled: false,
  };
  const timeline: PilotTimelineEntry[] = [];
  // The AUTHORITATIVE result of the run is BUILT at the end, when the report
  // of the candidate and the evidence were written: a failure of the evidence
  // is never hidden behind a green candidate.
  let finalKind: PositivePilotOutcome["kind"] = "failed";
  let finalExitCode = PILOT_EXIT_UNRELIABLE;
  let authoritative = false;
  // The PUBLICATION of the final record. It is the joint authority of the
  // run, and it exists even when nothing was published: the absence of a
  // publication is a fact, and it is a fact that is returned.
  // The ONE snapshot of the run: it is taken ONCE, at the end of the run,
  // and it is the baseline of the result facts. It is never re-sampled.
  let runSnapshot: CacheDiagnosticSnapshot | null = null;
  let publication: PilotPublicationFacts = {
    protocol: PILOT_PUBLICATION_PROTOCOL,
    published: false,
    exit_code: PILOT_EXIT_UNRELIABLE,
    final_sha256: null,
    final_bytes: null,
    manifest_sha256: null,
    manifest_bytes: null,
    candidate_sha256: null,
    candidate_bytes: null,
    errors: [],
  };
  let custodianDigest: string | null = null;
  let fixtureDigest: string | null = null;
  let copiedFixtureDigest: string | null = null;
  const scenario = options.mode === "normal" ? NORMAL_SCENARIO : SILENT_SCENARIO;

  try {
    // 1. The ONE allocation of the run. The root is REGISTERED the moment it
    //    exists, and the preparation of it happens AFTER that.
    const root = deps.createRoot();
    entry.root = root;
    PILOT_REGISTRY.set(root, entry);
    timeline.push({ at: deps.now(), what: "root-created", detail: { root } });
    deps.prepareRoot(root);
    timeline.push({ at: deps.now(), what: "root-prepared", detail: null });

    // 2. The pins of the reviewed bytes. They are checked BEFORE anything is
    //    copied and before anything is started.
    custodianDigest = deps.fileFacts(deps.custodianPath)?.sha256 ?? null;
    fixtureDigest = deps.fileFacts(deps.fixtureSource)?.sha256 ?? null;
    if (custodianDigest === null || custodianDigest !== options.expectedCustodianSha256) {
      throw new PositivePilotFailure("CUSTODIAN_NOT_REVIEWED", "the custodian is not the reviewed one: nothing was started");
    }
    if (fixtureDigest === null || fixtureDigest !== options.expectedFixtureSha256) {
      throw new PositivePilotFailure("FIXTURE_NOT_REVIEWED", "the helper is not the reviewed one: nothing was started");
    }
    timeline.push({ at: deps.now(), what: "pins-checked", detail: { custodianDigest, fixtureDigest } });

    // 3. The copy of the helper, and the digest of the COPY.
    const fixture = join(root, "cache-worker-fixture.mjs");
    deps.copyHelper(deps.fixtureSource, fixture);
    copiedFixtureDigest = deps.fileFacts(fixture)?.sha256 ?? null;
    if (copiedFixtureDigest === null || copiedFixtureDigest !== options.expectedFixtureSha256) {
      throw new PositivePilotFailure("FIXTURE_COPY_NOT_REVIEWED", "the copy of the helper is not the reviewed one: nothing was started");
    }
    // The scenario lives NEXT TO THE COPY, and never next to the sources.
    deps.writeScenario(root, scenario);
    timeline.push({ at: deps.now(), what: "helper-copied", detail: { copiedFixtureDigest } });

    // 4. The supervisor, the reserved handle and the start. Each of them is
    //    attached to the entry the moment it really exists.
    const supervisor = deps.createSupervisor({
      vendorRoot: deps.vendorRoot,
      producerFile: deps.producerFile,
      producerSha256: deps.producerSha256,
      workerPath: fixture,
      custodianPath: deps.custodianPath,
      pythonExecutable: deps.pythonExecutable,
    });
    entry.supervisor = supervisor;
    const request = {
      root, base: "http://127.0.0.1:1", rel: "film.html",
      ms: -1, width: 480, overrides: null,
    };
    const reservedHandle = supervisor.reserve(request);
    entry.reservedHandle = reservedHandle;
    entry.state = "reserved";
    const startPromise = supervisor.start(reservedHandle);
    entry.startPromise = startPromise;
    entry.state = "started";
    // The settlement of THIS promise is followed from the moment it exists:
    // the mode and the continuation read the very same result.
    void startPromise.then(
      (value) => { state.settlement = value; state.settled = true; },
      (error: unknown) => { state.settlementFailure = error; state.settled = true; },
    );
    timeline.push({ at: deps.now(), what: "started", detail: null });

    // 5. The mode.
    if (options.mode === "assertion-failure") {
      await runTheDeliberateFailure(entry, deps, state, timeline);
    }
  } catch (error) {
    // The FIRST failure is kept: a later failure never replaces it.
    if (state.originalFailure === null) {
      state.originalFailure = error;
      entry.originalFailure = error;
    }
    entry.state = "unknown";
    timeline.push({ at: deps.now(), what: "setup-failed", detail: boundedError(error) });
  } finally {
    // 6. THE CANONICAL TERMINAL CONTINUATION. It always runs, and it owns the
    //    draw until the end of it.
    await continueToTerminal(entry, deps, state, timeline);

    // The evidence of the run stays in the root: the root is KEPT, and it is
    // never removed because a timer expired.
    const root = entry.root;
    const snapshot = (() => {
      try {
        if (entry.supervisor === null || entry.reservedHandle === null) return null;
        return entry.supervisor.diagnosticSnapshot(entry.reservedHandle);
      } catch {
        return null;
      }
    })();
    // The snapshot of the run, ONCE: the candidate, the final and the outcome
    // are all built from THIS one, and it is never read again.
    runSnapshot = snapshot;
    const pictureIsTheExactOne = isTheExactPicture(state.picture);
    /**
     * The JUDGEMENT of the run.
     *
     * It is asked AFTER the report of the candidate and its SETTLEMENT, and
     * AFTER the manifest of the artifacts: a failure of the evidence, of the
     * reporting or of the manifest is never hidden behind a green candidate.
     * The deliberate failure is only the expected one when the EXACT fault,
     * the ORIGINAL cancel error, the complete terminal proof and the absence
     * of every unrelated failure are all there.
     *
     * The EVIDENCE problems are the gate: every required artifact, every
     * per-row digest and every per-row error of the manifest, and the LINKS
     * of the final record. A problem is a problem of the evidence, and it
     * disqualifies the run - whatever the draw itself did.
     */
    const judge = (evidenceProblems: readonly PilotBoundedError[]): { kind: PositivePilotOutcome["kind"]; exitCode: number; faultCasePassed: boolean } => {
      const faultExpected = options.mode === "assertion-failure";
      const faultObserved = faultExpected
        && state.originalFailure !== null
        && (state.originalFailure as { code?: unknown }).code === EXPECTED_ASSERTION_FAILURE;
      // The settlement must be THE SAME failure, or the exact cause of it:
      // any other error is not the deliberate one.
      const settlementIsTheDeliberateOne = state.settlementFailure !== null
        && state.settlementFailure !== undefined
        && (state.settlementFailure === state.originalFailure
          || (state.settlementFailure as { cause?: unknown }).cause === state.originalFailure);
      // No picture at all, and not the exact one either: a late success is not
      // the expected failure.
      const noPicture = state.picture === null && !pictureIsTheExactOne;
      // The RAW cleanup of the draw and the FINAL cleanup diagnostics: a
      // count is not the cleanup, and a failure that is only visible in the
      // diagnostics still disqualifies the case.
      const noCleanupFailure = state.cleanupFacts.length === 0
        && snapshot !== null
        && snapshot.cleanup_failures === 0;
      // No unrelated failure of the FAULT case: the transport of the draw was
      // clean, and the cancel of the owner really became the PRIMARY outcome.
      const faultClean = snapshot !== null
        && snapshot.transport_failure === null
        && snapshot.latched_outcome.kind === "failure"
        && snapshot.latched_outcome.code === "DRAW_CANCELLED"
        && snapshot.cancel_provenance !== null
        && snapshot.cancel_provenance.accepted_as_primary === true;
      // No unrelated failure of the NORMAL case: nothing failed at all.
      const normalClean = snapshot !== null
        && snapshot.transport_failure === null
        && snapshot.latched_outcome.kind !== "failure";
      // The evidence is COMPLETE: every required artifact, every row of the
      // manifest and every link of the final record is there, and the report
      // of the run did not fail.
      const evidenceIsComplete = evidenceProblems.length === 0
        && evidenceErrors.length === 0
        && boundary.firstFailure === null;
      const faultPassed = faultObserved
        && settlementIsTheDeliberateOne
        && state.terminalProof
        && noPicture
        && faultClean
        && noCleanupFailure
        && evidenceIsComplete;
      const kind = faultPassed
        ? "fault-observed"
        : (options.mode === "normal"
          && state.originalFailure === null
          && state.settlementFailure === null
          && state.terminalProof
          && pictureIsTheExactOne
          && normalClean
          && noCleanupFailure
          && evidenceIsComplete
          ? "ok"
          : "failed");
      return { kind, exitCode: kind === "ok" ? 0 : 1, faultCasePassed: faultPassed };
    };

    if (root === null) {
      // There is NO root: there is nothing that may own an evidence file, and
      // the working directory is NOT a substitute for a missing root. The run
      // reports the refusal and keeps no phantom child.
      timeline.push({ at: deps.now(), what: "no-root", detail: null });
      const refusal = {
        kind: "REFUSED",
        reason: state.originalFailure === null
          ? "the runtime root of this run was never allocated"
          : boundedError(state.originalFailure).message,
        mode: options.mode,
      };
      boundary.report(`${JSON.stringify(refusal)}\n`);
      await boundary.settled();
      finalKind = "failed";
      finalExitCode = PILOT_EXIT_UNRELIABLE;
      authoritative = false;
      publication = {
        ...publication,
        published: false,
        exit_code: PILOT_EXIT_UNRELIABLE,
        errors: state.originalFailure === null
          ? [{ name: "Error", message: "the runtime root of this run was never allocated", code: "ENOENT" }]
          : [boundedError(state.originalFailure)],
      };
    } else {
      // 7. The CANDIDATE facts. They are explicitly NOT authoritative: a
      //    candidate is never a committed receipt.
      const candidate = {
        kind: "positive-pilot-candidate",
        authoritative: false,
        mode: options.mode,
        root,
        custodian_sha256: custodianDigest,
        fixture_sha256: fixtureDigest,
        copied_fixture_sha256: copiedFixtureDigest,
        scenario,
        // The EXPECTED image and the ACTUAL image are STRICTLY apart: the
        // reference is a constant, and the actual one is what really came.
        expected_image: { sha256: PICTURE_SHA256, bytes: PICTURE_BYTES },
        actual_image: state.picture === null
          ? null
          : {
            sha256: createHash("sha256").update(state.picture).digest("hex"),
            bytes: state.picture.length,
            is_the_exact_one: pictureIsTheExactOne,
          },
        // The ORIGINAL settlement of the draw and its RAW cleanup: the facts,
        // not a count of them.
        original_failure: state.originalFailure === null ? null : boundedError(state.originalFailure),
        settlement_failure: state.settlementFailure === null ? null : boundedError(state.settlementFailure),
        cleanup_facts: state.cleanupFacts,
        terminal_proof: state.terminalProof,
        // The ACTUAL observations of the terminal proof, as the proof path saw
        // them. The raw segments of the receipt are NOT kept here: only the
        // summary and the digests of them are.
        terminal_proof_observations: snapshot?.terminal_proof ?? null,
        receipt_summary: snapshot?.receipt_summary ?? null,
        accumulator_summary: snapshot?.accumulator_summary ?? null,
        raw_segments_saved: false,
        timeline,
      };
      writeEvidence(root, "candidate.json", candidate);

      // 8. The REPORT of the candidate, and its SETTLEMENT. The final
      //    qualification is NOT persisted before this: a report that fails
      //    later must be able to revoke it.
      boundary.report(`${JSON.stringify({
        kind: "CANDIDATE",
        candidate_kind: judge([]).kind,
        authoritative: false,
        mode: options.mode,
        root,
        fault_case_passed: judge([]).faultCasePassed,
        terminal_proof: state.terminalProof,
        picture_sha256: state.picture === null
          ? null
          : createHash("sha256").update(state.picture).digest("hex"),
        picture_is_the_exact_one: pictureIsTheExactOne,
      })}\n`);
      await boundary.settled();

      // 9. The MANIFEST of the artifacts that really exist. It EXCLUDES itself
      //    and the final record, and it says so: there is no self reference
      //    and no cycle. The digest of the final record is checked by the
      //    recorder and by MAIN, outside this program.
      const facts = deps.artifactFacts(root);
      const manifest = {
        kind: "positive-pilot-manifest",
        authoritative: false,
        root,
        artifacts: facts.artifacts,
        listing_error: facts.error,
        excluded: ["manifest.json", "final.json"],
        exclusion_reason: "the manifest may not hash itself, and the final record is written after it",
        required_artifacts: REQUIRED_ARTIFACTS,
      };
      writeEvidence(root, "manifest.json", manifest);

      // 10. The LINKS of the final record. The digests of the candidate and of
      //     the manifest are READ from the files themselves, BEFORE the
      //     judgement: a link that could not be read, or a link that does not
      //     match the bytes that are really there, is a failure of the
      //     evidence - and it is recorded as the bounded error it is.
      const candidateFacts = deps.fileFacts(join(root, "candidate.json"));
      const manifestFacts = deps.fileFacts(join(root, "manifest.json"));
      const evidenceProblems = evidenceProblemsOf(facts, candidateFacts, manifestFacts);
      // 11. The FINAL qualification: the authority of the run. It is written
      //     AFTER the report settlement and AFTER the manifest, and it names
      //     the two of them by their digest. A manifest that could not be
      //     built is NOT an empty manifest: the case is not green.
      const finalJudgement = judge(evidenceProblems);
      const final = {
        kind: "positive-pilot-final",
        authoritative: true,
        publication_protocol: PILOT_PUBLICATION_PROTOCOL,
        mode: options.mode,
        root,
        exit_code: finalJudgement.exitCode,
        kind_of_run: finalJudgement.kind,
        fault_case_passed: finalJudgement.faultCasePassed,
        terminal_proof: state.terminalProof,
        picture_sha256: state.picture === null
          ? null
          : createHash("sha256").update(state.picture).digest("hex"),
        picture_bytes: state.picture === null ? null : state.picture.length,
        picture_is_the_exact_one: pictureIsTheExactOne,
        original_failure: state.originalFailure === null ? null : boundedError(state.originalFailure),
        settlement_failure: state.settlementFailure === null ? null : boundedError(state.settlementFailure),
        cleanup_facts: state.cleanupFacts,
        reporting_failure: boundary.firstFailure,
        reporting_failures: boundary.failures,
        evidence_errors: evidenceErrors,
        evidence_problems: evidenceProblems,
        manifest_error: facts.error,
        required_artifacts: REQUIRED_ARTIFACTS,
        candidate_sha256: candidateFacts === null ? null : candidateFacts.sha256,
        candidate_bytes: candidateFacts === null ? null : candidateFacts.bytes,
        manifest_sha256: manifestFacts === null ? null : manifestFacts.sha256,
        manifest_bytes: manifestFacts === null ? null : manifestFacts.bytes,
        terminal_proof_observations: snapshot?.terminal_proof ?? null,
        diagnostic_snapshot: snapshot,
      };
      // 12. The PUBLICATION of the final record.
      //
      //     It is the LAST mandatory write of the run: every report settled,
      //     every other record written, and the bytes of the final are
      //     complete before they are published. The publication itself is a
      //     TEMPORARY file of the SAME root, a complete write, a successful
      //     close and a rename.
      //
      //     A publication that failed is NOT a final record: the run is not
      //     authoritative, the fault is not the expected one, and the exit
      //     code of the run is the one of an unreliable evidence. The error is
      //     kept as it is - the original failure of the draw, the picture and
      //     the cleanup of it are NOT replaced by it.
      let published: PilotPublication | null = null;
      let publicationError: PilotBoundedError | null = null;
      try {
        published = deps.publishEvidence(root, "final.json", final);
      } catch (error) {
        publicationError = boundedError(error);
        evidenceErrors.push({ name: "final.json", error: publicationError });
      }
      const unreliable = evidenceProblems.length > 0
        || evidenceErrors.length > 0
        || boundary.firstFailure !== null
        || published === null;
      // The final record was really published, and the evidence of the run is
      // complete: the run is authoritative.
      authoritative = !unreliable;
      state.faultCasePassed = unreliable ? false : finalJudgement.faultCasePassed;
      finalKind = unreliable ? "failed" : finalJudgement.kind;
      finalExitCode = unreliable ? PILOT_EXIT_UNRELIABLE : finalJudgement.exitCode;
      publication = {
        protocol: PILOT_PUBLICATION_PROTOCOL,
        published: published !== null,
        exit_code: finalExitCode,
        final_sha256: published === null ? null : published.sha256,
        final_bytes: published === null ? null : published.bytes,
        manifest_sha256: manifestFacts === null ? null : manifestFacts.sha256,
        manifest_bytes: manifestFacts === null ? null : manifestFacts.bytes,
        candidate_sha256: candidateFacts === null ? null : candidateFacts.sha256,
        candidate_bytes: candidateFacts === null ? null : candidateFacts.bytes,
        errors: [...evidenceProblems, ...(publicationError === null ? [] : [publicationError])],
      };
    }
  }
  return {
    kind: finalKind,
    mode: options.mode,
    root: entry.root,
    exitCode: finalExitCode,
    originalFailure: state.originalFailure,
    settlementFailure: state.settlementFailure,
    cleanupFacts: state.cleanupFacts,
    faultCasePassed: state.faultCasePassed,
    terminalProof: state.terminalProof,
    pictureSha256: state.picture === null ? null : createHash("sha256").update(state.picture).digest("hex"),
    pictureBytes: state.picture === null ? null : state.picture.length,
    pictureIsTheExactOne: isTheExactPicture(state.picture),
    reportingFailure: boundary.firstFailure,
    evidenceErrors,
    authoritative,
    publication,
    diagnosticSnapshot: runSnapshot,
  };
}

/**
 * The bytes of a file of the root, as a reader may see them.
 *
 * A file that could not be read has NO bytes: the answer is null, and it is
 * never the bytes of nothing.
 */
export type PilotByteReader = (path: string) => Buffer | null;

/**
 * The verdict of the joint check of a published run.
 *
 * The three fields are SEPARATE on purpose, and their meaning is fixed:
 *
 *  - `evidenceReliable` says whether the mandatory evidence of the run could
 *    be READ, PARSED and VERIFIED. A run whose evidence is not reliable is
 *    never an accepted fault;
 *  - `accepted` says whether the run is the outcome that it claims to be: a
 *    normal draw that really succeeded, or the deliberate fault that was
 *    really observed. An ordinary business failure is NOT accepted, and its
 *    exit code of 1 is never a pass;
 *  - `exitCode` says what the command answers: 0 for an accepted normal run,
 *    1 for an accepted expected fault and for an ordinary business failure
 *    with reliable evidence, and 3 when the evidence, the publication, a
 *    read, a parse, the protocol or a link is not reliable.
 */
export interface PilotJointVerdict {
  readonly evidenceReliable: boolean;
  readonly accepted: boolean;
  readonly exitCode: number;
  readonly reasons: readonly string[];
}

/** The digest of a set of bytes. */
function digestOfBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The REAL reader: it reads the bytes that are really on the disk. */
function readRealBytes(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

/**
 * Parse ONE record of the root.
 *
 * A record that is not JSON, or that is not an object, has NO record: the
 * answer is null, and it is never an empty record that passes.
 */
function parseJsonRecord(bytes: Buffer): Record<string, unknown> | null {
  try {
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** Whether a value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Whether a value is a boolean. */
function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Whether a value is a string or null. */
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** Whether a value is a finite number or null. */
function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

/** Whether a value is an array of strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

/**
 * The CANONICAL projection of the ACTUAL result facts of a run.
 *
 * It is ONE projection: the candidate, the final and the outcome are all
 * compared against it, field by field. It never uses JSON.stringify - that
 * would lose the name, the message and the cause of an Error - and it never
 * depends on the order of the fields.
 */
interface PilotResultFacts {
  readonly mode: "normal" | "assertion-failure";
  readonly kind: PositivePilotOutcome["kind"];
  readonly exitCode: number;
  readonly faultCasePassed: boolean;
  readonly original: PilotBoundedError | null;
  readonly settlement: PilotBoundedError | null;
  readonly cleanupFacts: readonly PilotBoundedError[];
  readonly terminalProof: boolean;
  readonly pictureSha256: string | null;
  readonly pictureBytes: number | null;
  readonly pictureIsTheExactOne: boolean;
}

/** The canonical bounded form of an ACTUAL error object. */
function canonicalError(value: unknown): PilotBoundedError | null {
  if (value === null || value === undefined) return null;
  return boundedError(value);
}

/** The canonical projection of the actual result facts of a run. */
function resultFactsOf(outcome: PositivePilotOutcome): PilotResultFacts {
  return {
    mode: outcome.mode,
    kind: outcome.kind,
    exitCode: outcome.exitCode,
    faultCasePassed: outcome.faultCasePassed,
    original: canonicalError(outcome.originalFailure),
    settlement: canonicalError(outcome.settlementFailure),
    cleanupFacts: outcome.cleanupFacts.map(entry => ({
      name: entry.name,
      message: entry.message,
      code: entry.code,
    })),
    terminalProof: outcome.terminalProof,
    pictureSha256: outcome.pictureSha256,
    pictureBytes: outcome.pictureBytes,
    pictureIsTheExactOne: outcome.pictureIsTheExactOne,
  };
}

/**
 * Compare two sets of facts, FIELD BY FIELD.
 *
 * It is NOT JSON.stringify: that would lose the difference between a missing
 * field and a null one, and it would depend on the order of the keys. Every
 * field of the EXPECTED must be present in the ACTUAL with the same value,
 * and the ACTUAL may not carry a field that the EXPECTED does not.
 */
function sameFacts(expected: unknown, actual: unknown, path: string): string | null {
  if (expected === undefined) return null;
  if (expected === null || actual === null) {
    return expected === actual ? null : `${path} is not the same fact`;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return `${path} is not the same shape`;
    if (expected.length !== actual.length) return `${path} does not have the same number of entries`;
    for (let index = 0; index < expected.length; index += 1) {
      const difference = sameFacts(expected[index], actual[index], `${path}[${index}]`);
      if (difference !== null) return difference;
    }
    return null;
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) return `${path} is not the same shape`;
    for (const key of Object.keys(expected)) {
      if (!(key in actual)) return `${path}.${key} is missing`;
      const difference = sameFacts(expected[key], actual[key], `${path}.${key}`);
      if (difference !== null) return difference;
    }
    for (const key of Object.keys(actual)) {
      if (!(key in expected)) return `${path}.${key} is not a fact of the run`;
    }
    return null;
  }
  return expected === actual ? null : `${path} is not the same value`;
}

/** Whether a value is a legal bounded error record. */
function isBoundedErrorRecord(value: unknown): value is PilotBoundedError {
  if (!isRecord(value)) return false;
  if (typeof value.name !== "string" || value.name.length > 128) return false;
  if (typeof value.message !== "string" || value.message.length > 1024) return false;
  if (value.code !== null && (typeof value.code !== "string" || value.code.length > 64)) return false;
  return true;
}

/** Whether a value is an array of legal bounded error records. */
function isBoundedErrorArray(value: unknown): value is PilotBoundedError[] {
  return Array.isArray(value) && value.every(entry => isBoundedErrorRecord(entry));
}

/** Whether a value is the image record of the run. */
function isImageRecord(value: unknown): value is {
  readonly sha256: string;
  readonly bytes: number;
  readonly is_the_exact_one: boolean;
} {
  if (!isRecord(value)) return false;
  if (!isFullSha256(value.sha256)) return false;
  if (!isByteCount(value.bytes)) return false;
  if (!isBoolean(value.is_the_exact_one)) return false;
  return true;
}

/** Whether a value is the terminal proof of the production. */
function isTerminalProofRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.at !== "number" || !Number.isFinite(value.at)) return false;
  if (!isBoolean(value.proven)) return false;
  if (!isBoolean(value.truncated)) return false;
  if (!Array.isArray(value.observations)) return false;
  if (value.observations.length > MAX_TERMINAL_OBSERVATIONS) return false;
  return value.observations.every((entry) => isRecord(entry)
    && (entry.kind === "custodian-epoch"
      || entry.kind === "worker-epoch"
      || entry.kind === "group"
      || entry.kind === "known-target")
    && typeof entry.presence === "string"
    && (entry.pid === null || (typeof entry.pid === "number" && Number.isInteger(entry.pid)))
    && typeof entry.at === "number"
    && Number.isFinite(entry.at)
    && (entry.start_ticks === null || typeof entry.start_ticks === "string")
    && (entry.state === null || typeof entry.state === "string")
    && (entry.reason === null || typeof entry.reason === "string"));
}

/** Whether a value is the latched outcome of the production. */
function isLatchedOutcomeRecord(value: unknown): value is {
  readonly kind: "none" | "failure" | "candidate";
  readonly code: string | null;
  readonly message: string | null;
  readonly native_phase: string | null;
} {
  if (!isRecord(value)) return false;
  if (value.kind !== "none" && value.kind !== "failure" && value.kind !== "candidate") return false;
  if (value.code !== null && typeof value.code !== "string") return false;
  if (value.message !== null && typeof value.message !== "string") return false;
  if (value.native_phase !== null && typeof value.native_phase !== "string") return false;
  return true;
}

/** Whether a value is the native error envelope of the production. */
function isNativeEnvelopeRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.message !== "string") return false;
  if (value.code !== null && typeof value.code !== "string") return false;
  if (value.stack !== null && typeof value.stack !== "string") return false;
  if (value.phase !== null && typeof value.phase !== "string") return false;
  if (value.cause !== null && !isNativeEnvelopeRecord(value.cause)) return false;
  return true;
}

/** Whether a value is the cancel provenance of the production. */
function isCancelProvenanceRecord(value: unknown): value is {
  readonly code: string;
  readonly message: string;
  readonly error_name: string;
  readonly error_code: string | null;
  readonly accepted_as_primary: boolean;
  readonly superseded_by_earlier_failure: boolean;
} {
  if (!isRecord(value)) return false;
  if (typeof value.code !== "string") return false;
  if (typeof value.message !== "string") return false;
  if (typeof value.error_name !== "string") return false;
  if (value.error_code !== null && typeof value.error_code !== "string") return false;
  if (!isBoolean(value.accepted_as_primary)) return false;
  if (!isBoolean(value.superseded_by_earlier_failure)) return false;
  return true;
}

/**
 * The RESULT-CRITICAL view of the diagnostic snapshot of the production.
 *
 * It is the shape that the checker reads: the fields that the modes and the
 * proof depend on. The guard below proves that they are there and that they
 * have the right type.
 */
interface PilotSnapshotFacts {
  readonly transport_failure: unknown;
  readonly latched_outcome: unknown;
  readonly cancel_provenance: unknown;
  readonly cleanup_failures: unknown;
  readonly cleanup_facts: unknown;
  readonly terminal_proof: unknown;
  readonly receipt_summary: unknown;
  readonly accumulator_summary: unknown;
}

/**
 * Whether a value is the diagnostic snapshot of the production.
 *
 * It checks the RESULT-CRITICAL fields and their types: two incomplete
 * objects that are equal to each other are NOT a snapshot.
 */
function isDiagnosticSnapshotRecord(value: unknown): value is PilotSnapshotFacts {
  if (!isRecord(value)) return false;
  if (value.known !== true) return false;
  if (typeof value.phase !== "string") return false;
  if (!isBoolean(value.settled)) return false;
  if (!isBoolean(value.cleanup_required)) return false;
  if (typeof value.draw_id !== "string") return false;
  if (typeof value.ticket_digest !== "string") return false;
  if (!isBoolean(value.custodian_born)) return false;
  if (!isBoolean(value.custodian_closed)) return false;
  if (!isBoolean(value.forked)) return false;
  if (!isByteCount(value.cleanup_failures)) return false;
  if (!isBoundedErrorArray(value.cleanup_facts)) return false;
  if (!isLatchedOutcomeRecord(value.latched_outcome)) return false;
  if (value.transport_failure !== null && !isNativeEnvelopeRecord(value.transport_failure)) return false;
  if (value.cancel_provenance !== null && !isCancelProvenanceRecord(value.cancel_provenance)) return false;
  if (value.terminal_proof !== null && !isTerminalProofRecord(value.terminal_proof)) return false;
  if (value.receipt_summary !== null && !isRecord(value.receipt_summary)) return false;
  if (!isRecord(value.accumulator_summary)) return false;
  return true;
}

/**
 * Compare ONE mandatory error fact of a record with the canonical fact of the
 * actual run.
 *
 * A MISSING field, a wrong type, an explicit null that contradicts the run
 * and a different failure are four different things, and none of them is
 * silently a null.
 */
function errorFactDifference(
  where: string,
  value: unknown,
  canonical: PilotBoundedError | null,
): string | null {
  if (value === undefined) return `the ${where} does not carry the field`;
  if (value === null) {
    return canonical === null ? null : `the ${where} is null and the run really failed`;
  }
  if (!isBoundedErrorRecord(value)) return `the ${where} is not a legal bounded error`;
  if (canonical === null) return `the ${where} carries a failure that the run did not have`;
  return sameFacts(canonical, value, where);
}

/**
 * Compare ONE mandatory cleanup array of a record with the canonical facts of
 * the actual run: the CONTENT and the ORDER, not only the number.
 */
function cleanupFactsDifference(
  where: string,
  value: unknown,
  canonical: readonly PilotBoundedError[],
): string | null {
  if (value === undefined) return `the ${where} does not carry the field`;
  if (!isBoundedErrorArray(value)) return `the ${where} is not an array of legal bounded failures`;
  if (value.length !== canonical.length) {
    return `the ${where} does not carry the same number of failures`;
  }
  for (let index = 0; index < canonical.length; index += 1) {
    const difference = sameFacts(canonical[index], value[index], `${where}[${index}]`);
    if (difference !== null) return difference;
  }
  return null;
}

/**
 * THE JOINT CHECKER of a published run.
 *
 * It is the ONE checker of this repository: the command, the legacy consumer
 * and the pure tests all call THIS function. It reads the ACTUAL bytes of
 * the root - the final record, the manifest, the candidate and every
 * artifact that the manifest lists - and it verifies them against the
 * publication that the run returned, against the ACTUAL result facts of the
 * run and against the protocol of the publication.
 *
 * THE RESULT FACTS (F01..F10) are checked as follows:
 *
 *  - F01 the identity, the authorities, the mode and the exit flags of the
 *    three records and of the outcome, and the valid combinations of them;
 *  - F02 the original failure: the candidate, the final and the outcome must
 *    carry the SAME canonical bounded error, and an explicit null is not a
 *    missing field;
 *  - F03 the settlement failure: the same, and the RELATION between the
 *    actual settlement and the actual original - the same object or its
 *    direct cause - is checked on the OBJECTS, never on their text;
 *  - F04 the cleanup facts: the content and the order of the three sources;
 *  - F05 the terminal proof: the three booleans, the proof observations and
 *    the ACTUAL proof of the snapshot;
 *  - F06 the image facts: the expected constants, the actual image and the
 *    null image of a fault;
 *  - F07 the diagnostic snapshot: the final one must be the ACTUAL snapshot
 *    that the run took once, and the candidate summaries must be the same
 *    baseline;
 *  - F08 the cleanup, the transport failure and the latched outcome of the
 *    snapshot, and the mode predicates of them;
 *  - F09 the cancel provenance: its code, its name, its error code and its
 *    message are bound to the SAME original error;
 *  - F10 the byte chain, the report, the evidence and the publication.
 *
 * It NEVER throws and it NEVER removes evidence: a failure of the check is
 * a verdict, and the verdict is the refusal with the exit code of an
 * unreliable evidence.
 *
 * IT IS AN INTERNAL surface of this tool: it is not the API of the Host, not
 * a public DTO and not an EnginePort method. And it does NOT observe the exit
 * code that the operating system will give to this process: the outer
 * recorder and the acceptor compare the REAL observed exit with this
 * verdict, and they do it outside of this program.
 *
 * @internal
 */
export function verifyPublishedRun(
  outcome: PositivePilotOutcome,
  root: string,
  readBytes: PilotByteReader = readRealBytes,
): PilotJointVerdict {
  const reasons: string[] = [];
  const refuse = (reason: string): PilotJointVerdict => ({
    evidenceReliable: false,
    accepted: false,
    exitCode: PILOT_EXIT_UNRELIABLE,
    reasons: [...reasons, reason],
  });
  const ordinary = (reason: string): PilotJointVerdict => ({
    evidenceReliable: true,
    accepted: false,
    exitCode: PILOT_EXIT_FAULT,
    reasons: [...reasons, reason],
  });
  try {
    // 1. The root, the protocol and the producer's own facts.
    if (typeof root !== "string" || root.length === 0) return refuse("the run had no root of its own");
    if (outcome.root !== root) return refuse("the root of the run is not the root that was checked");
    if (outcome.publication.protocol !== PILOT_PUBLICATION_PROTOCOL) {
      return refuse("the publication did not use the reviewed protocol");
    }
    if (!outcome.publication.published) return refuse("the final record was not really published");
    if (!outcome.authoritative) return refuse("the run did not return an authoritative qualification");
    if (outcome.reportingFailure !== null) return refuse("the report of the run failed");
    if (outcome.evidenceErrors.length > 0) return refuse("the run kept a failure of its evidence");
    if (outcome.publication.exit_code !== outcome.exitCode) {
      return refuse("the exit code of the publication and the exit code of the run disagree");
    }
    if (outcome.mode !== "normal" && outcome.mode !== "assertion-failure") {
      return refuse("the mode of the run is not one of the two modes");
    }
    // 2. The bytes of the three MAIN records.
    const finalBytes = readBytes(join(root, "final.json"));
    const manifestBytes = readBytes(join(root, "manifest.json"));
    const candidateBytes = readBytes(join(root, "candidate.json"));
    if (finalBytes === null) return refuse("the final record could not be read");
    if (manifestBytes === null) return refuse("the manifest could not be read");
    if (candidateBytes === null) return refuse("the candidate could not be read");
    if (digestOfBytes(finalBytes) !== outcome.publication.final_sha256) {
      return refuse("the final record on the disk is not the one that was published");
    }
    if (finalBytes.length !== outcome.publication.final_bytes) {
      return refuse("the final record on the disk has another number of bytes");
    }
    if (digestOfBytes(manifestBytes) !== outcome.publication.manifest_sha256) {
      return refuse("the manifest on the disk is not the one of the run");
    }
    if (manifestBytes.length !== outcome.publication.manifest_bytes) {
      return refuse("the manifest on the disk has another number of bytes");
    }
    if (digestOfBytes(candidateBytes) !== outcome.publication.candidate_sha256) {
      return refuse("the candidate on the disk is not the one of the run");
    }
    if (candidateBytes.length !== outcome.publication.candidate_bytes) {
      return refuse("the candidate on the disk has another number of bytes");
    }
    // 3. Their JSON.
    const final = parseJsonRecord(finalBytes);
    if (final === null) return refuse("the final record is not a JSON record");
    const manifest = parseJsonRecord(manifestBytes);
    if (manifest === null) return refuse("the manifest is not a JSON record");
    const candidate = parseJsonRecord(candidateBytes);
    if (candidate === null) return refuse("the candidate is not a JSON record");
    // 4. The PRESENCE of every mandatory field of the three records.
    //
    //    A field that is MISSING is not a field with an explicit null, and a
    //    field that carries `undefined` is missing as well: only a real null
    //    says "there is nothing here". The gate runs BEFORE the baseline,
    //    the mode and the ordinary-failure branches, so that no branch can
    //    read a missing field as an answer.
    const missingCandidate = missingRequiredKeys(candidate, REQUIRED_CANDIDATE_KEYS);
    if (missingCandidate.length > 0) {
      return refuse(`the candidate does not carry ${missingCandidate.join(", ")}`);
    }
    const missingManifest = missingRequiredKeys(manifest, REQUIRED_MANIFEST_KEYS);
    if (missingManifest.length > 0) {
      return refuse(`the manifest does not carry ${missingManifest.join(", ")}`);
    }
    const missingFinal = missingRequiredKeys(final, REQUIRED_FINAL_KEYS);
    if (missingFinal.length > 0) {
      return refuse(`the final record does not carry ${missingFinal.join(", ")}`);
    }
    // 5. The identity of the three records.
    if (final.kind !== "positive-pilot-final") return refuse("the final record is not a final record");
    if (final.authoritative !== true) return refuse("the final record does not claim the authority");
    if (final.publication_protocol !== PILOT_PUBLICATION_PROTOCOL) {
      return refuse("the final record does not name the reviewed protocol");
    }
    if (final.root !== root) return refuse("the final record names another root");
    if (final.mode !== outcome.mode) return refuse("the final record names another mode");
    if (manifest.kind !== "positive-pilot-manifest") return refuse("the manifest is not a manifest");
    if (manifest.root !== root) return refuse("the manifest names another root");
    if (candidate.kind !== "positive-pilot-candidate") return refuse("the candidate is not a candidate");
    if (candidate.root !== root) return refuse("the candidate names another root");
    if (candidate.mode !== outcome.mode) return refuse("the candidate names another mode");
    if (candidate.authoritative !== false) return refuse("the candidate claims the authority");
    if (manifest.listing_error !== null) {
      return refuse("the manifest carries the error of the listing");
    }
    if (!isStringArray(manifest.excluded)) return refuse("the manifest does not say what it excludes");
    for (const name of RESERVED_RECORD_NAMES) {
      if (!manifest.excluded.includes(name)) {
        return refuse(`the manifest does not exclude the reserved record ${name}`);
      }
    }
    if (final.exit_code !== 0 && final.exit_code !== 1) {
      return refuse("the final record does not carry an exit code of the protocol");
    }
    if (typeof final.kind_of_run !== "string") return refuse("the final record does not name the kind of the run");
    if (!isBoolean(final.fault_case_passed)) return refuse("the final record does not say whether the fault was observed");
    if (!isBoolean(final.terminal_proof)) return refuse("the final record does not say whether the domain ended");
    if (!isNullableString(final.picture_sha256)) return refuse("the final record does not carry the digest of the picture");
    if (!isNullableNumber(final.picture_bytes)) return refuse("the final record does not carry the number of bytes of the picture");
    if (!isBoolean(final.picture_is_the_exact_one)) {
      return refuse("the final record does not say whether the picture is the exact one");
    }
    if (!isFullSha256(final.candidate_sha256)) return refuse("the final record does not name the digest of the candidate");
    if (!isFullSha256(final.manifest_sha256)) return refuse("the final record does not name the digest of the manifest");
    if (!isByteCount(final.candidate_bytes)) return refuse("the final record does not carry the number of bytes of the candidate");
    if (!isByteCount(final.manifest_bytes)) return refuse("the final record does not carry the number of bytes of the manifest");
    if (!Array.isArray(final.cleanup_facts)) return refuse("the final record does not carry the cleanup facts");
    if (!Array.isArray(final.reporting_failures)) return refuse("the final record does not carry the failures of the report");
    if (!Array.isArray(final.evidence_errors)) return refuse("the final record does not carry the failures of the evidence");
    if (!Array.isArray(final.evidence_problems)) return refuse("the final record does not carry the problems of the evidence");
    if (candidate.raw_segments_saved !== false) {
      return refuse("the candidate does not say that the raw segments are not saved");
    }
    // 5. F01: the exit flags of the three records and of the outcome, and the
    //    valid combinations of them.
    if (final.kind_of_run !== outcome.kind) {
      return refuse("the final record and the run disagree about the kind of the run");
    }
    if (final.exit_code !== outcome.exitCode) {
      return refuse("the final record and the run disagree about the exit code");
    }
    if (final.fault_case_passed !== outcome.faultCasePassed) {
      return refuse("the final record and the run disagree about the fault");
    }
    if (outcome.kind === "ok"
      && !(outcome.mode === "normal" && outcome.exitCode === PILOT_EXIT_OK && outcome.faultCasePassed === false)) {
      return refuse("an accepted normal run is not a normal run with the exit code 0");
    }
    if (outcome.kind === "fault-observed"
      && !(outcome.mode === "assertion-failure" && outcome.exitCode === PILOT_EXIT_FAULT && outcome.faultCasePassed === true)) {
      return refuse("an accepted fault is not the fault mode with the exit code 1");
    }
    if (outcome.kind === "failed"
      && !(outcome.exitCode === PILOT_EXIT_FAULT && outcome.faultCasePassed === false)) {
      return refuse("a failed run does not carry the exit code 1 without the fault");
    }
    if (outcome.kind !== "ok" && outcome.kind !== "fault-observed" && outcome.kind !== "failed") {
      return refuse("the kind of the run is not one of the three kinds of the protocol");
    }
    // 6. F02, F03 and F04: the failures and the cleanup facts.
    const facts = resultFactsOf(outcome);
    const originalDifference = errorFactDifference(
      "candidate.original_failure", candidate.original_failure, facts.original);
    if (originalDifference !== null) return refuse(originalDifference);
    const finalOriginalDifference = errorFactDifference(
      "final.original_failure", final.original_failure, facts.original);
    if (finalOriginalDifference !== null) return refuse(finalOriginalDifference);
    const settlementDifference = errorFactDifference(
      "candidate.settlement_failure", candidate.settlement_failure, facts.settlement);
    if (settlementDifference !== null) return refuse(settlementDifference);
    const finalSettlementDifference = errorFactDifference(
      "final.settlement_failure", final.settlement_failure, facts.settlement);
    if (finalSettlementDifference !== null) return refuse(finalSettlementDifference);
    const cleanupDifference = cleanupFactsDifference(
      "candidate.cleanup_facts", candidate.cleanup_facts, facts.cleanupFacts);
    if (cleanupDifference !== null) return refuse(cleanupDifference);
    const finalCleanupDifference = cleanupFactsDifference(
      "final.cleanup_facts", final.cleanup_facts, facts.cleanupFacts);
    if (finalCleanupDifference !== null) return refuse(finalCleanupDifference);
    // 7. F05: the terminal proof.
    if (!isBoolean(candidate.terminal_proof)) {
      return refuse("the candidate does not carry the terminal proof");
    }
    if (candidate.terminal_proof !== facts.terminalProof) {
      return refuse("the candidate and the run disagree about the terminal proof");
    }
    if (final.terminal_proof !== facts.terminalProof) {
      return refuse("the final record and the run disagree about the terminal proof");
    }
    // 8. F06: the image facts.
    if (!isRecord(candidate.expected_image)) return refuse("the candidate does not carry the expected image");
    if (candidate.expected_image.sha256 !== PICTURE_SHA256
      || candidate.expected_image.bytes !== PICTURE_BYTES) {
      return refuse("the candidate does not carry the expected image of the protocol");
    }
    if (candidate.actual_image !== null && !isImageRecord(candidate.actual_image)) {
      return refuse("the candidate does not carry a legal actual image");
    }
    if (final.picture_sha256 !== facts.pictureSha256) {
      return refuse("the final record and the run disagree about the digest of the picture");
    }
    if (final.picture_bytes !== facts.pictureBytes) {
      return refuse("the final record and the run disagree about the number of bytes of the picture");
    }
    if (final.picture_is_the_exact_one !== facts.pictureIsTheExactOne) {
      return refuse("the final record and the run disagree about the picture of the draw");
    }
    if (candidate.actual_image !== null) {
      if (candidate.actual_image.sha256 !== facts.pictureSha256
        || candidate.actual_image.bytes !== facts.pictureBytes
        || candidate.actual_image.is_the_exact_one !== facts.pictureIsTheExactOne) {
        return refuse("the candidate and the run disagree about the picture of the draw");
      }
    } else if (facts.pictureSha256 !== null || facts.pictureBytes !== null) {
      return refuse("the candidate has no picture and the run really has one");
    }
    // 9. F07: the ACTUAL snapshot of the run, and the two records that carry
    //    its summaries.
    const baseline = outcome.diagnosticSnapshot;
    if (baseline === null) {
      if (final.diagnostic_snapshot !== null) {
        return refuse("the final record carries a snapshot that the run did not take");
      }
      // A run WITHOUT a snapshot still publishes the four summaries of its
      // terminal proof, and they say that there is none: a missing field is
      // not an explicit null, and no mock proof is invented here.
      for (const [where, value] of [
        ["candidate.receipt_summary", candidate.receipt_summary],
        ["candidate.accumulator_summary", candidate.accumulator_summary],
        ["candidate.terminal_proof_observations", candidate.terminal_proof_observations],
        ["final.terminal_proof_observations", final.terminal_proof_observations],
      ] as const) {
        if (value !== null) {
          return refuse(`the ${where} is not the explicit null of a run without a snapshot`);
        }
      }
    } else {
      if (!isDiagnosticSnapshotRecord(final.diagnostic_snapshot)) {
        return refuse("the final record does not carry a legal diagnostic snapshot");
      }
      const snapshotDifference = sameFacts(baseline, final.diagnostic_snapshot, "final.diagnostic_snapshot");
      if (snapshotDifference !== null) return refuse(snapshotDifference);
      // EVERY mandatory summary is compared with the baseline: none of them
      // is skipped when the baseline happens to be null.
      const receiptDifference = sameFacts(
        baseline.receipt_summary, candidate.receipt_summary, "candidate.receipt_summary");
      if (receiptDifference !== null) return refuse(receiptDifference);
      const accumulatorDifference = sameFacts(
        baseline.accumulator_summary, candidate.accumulator_summary, "candidate.accumulator_summary");
      if (accumulatorDifference !== null) return refuse(accumulatorDifference);
      const observationsDifference = sameFacts(
        baseline.terminal_proof, candidate.terminal_proof_observations, "candidate.terminal_proof_observations");
      if (observationsDifference !== null) return refuse(observationsDifference);
      const finalObservationsDifference = sameFacts(
        baseline.terminal_proof, final.terminal_proof_observations, "final.terminal_proof_observations");
      if (finalObservationsDifference !== null) return refuse(finalObservationsDifference);
    }
    // 10. F08 and F09: the facts of the snapshot that the modes depend on.
    const snapshot = isDiagnosticSnapshotRecord(final.diagnostic_snapshot)
      ? final.diagnostic_snapshot
      : null;
    // The snapshot that is read here already passed the guard above: its
    // latched outcome and its provenance are therefore either null or legal
    // records, and they are never turned into a null here.
    const transportFailure = snapshot === null ? null : snapshot.transport_failure;
    const latchedRaw = snapshot === null ? null : snapshot.latched_outcome;
    const latched = latchedRaw === null
      ? null
      : (isLatchedOutcomeRecord(latchedRaw) ? latchedRaw : null);
    const provenanceRaw = snapshot === null ? null : snapshot.cancel_provenance;
    const provenance = provenanceRaw === null
      ? null
      : (isCancelProvenanceRecord(provenanceRaw) ? provenanceRaw : null);
    const snapshotCleanupFailures = snapshot === null ? null : snapshot.cleanup_failures;
    const snapshotCleanupFacts = snapshot === null ? null : snapshot.cleanup_facts;
    // 11. The LINKS of the final record.
    if (final.candidate_sha256 !== digestOfBytes(candidateBytes)) {
      return refuse("the final record does not name the candidate that is on the disk");
    }
    if (final.candidate_bytes !== candidateBytes.length) {
      return refuse("the final record does not name the number of bytes of the candidate");
    }
    if (final.manifest_sha256 !== digestOfBytes(manifestBytes)) {
      return refuse("the final record does not name the manifest that is on the disk");
    }
    if (final.manifest_bytes !== manifestBytes.length) {
      return refuse("the final record does not name the number of bytes of the manifest");
    }
    // 12. EVERY row of the manifest, against the ACTUAL bytes of its file.
    if (!Array.isArray(manifest.artifacts)) return refuse("the manifest does not carry its artifacts");
    const seen = new Set<string>();
    for (const raw of manifest.artifacts) {
      if (!isRecord(raw)) return refuse("the manifest carries a row that is not a record");
      const row = raw as unknown as PilotArtifact;
      const problems = artifactRowProblems(row);
      if (problems.length > 0) {
        return refuse(`the manifest carries a row that is not valid: ${problems[0]?.message ?? "unknown"}`);
      }
      if (seen.has(row.name)) return refuse(`the manifest carries the row ${row.name} twice`);
      seen.add(row.name);
      const bytes = readBytes(join(root, row.name));
      if (bytes === null) return refuse(`the artifact ${row.name} could not be read`);
      if (digestOfBytes(bytes) !== row.digest) {
        return refuse(`the artifact ${row.name} is not the one that the manifest names`);
      }
      if (bytes.length !== row.bytes) {
        return refuse(`the artifact ${row.name} has another number of bytes`);
      }
    }
    for (const name of REQUIRED_ARTIFACTS) {
      if (!seen.has(name)) return refuse(`the manifest does not name the required artifact ${name}`);
    }
    // 13. The failures of the report and of the evidence. They are not a
    //     failed RUN: they are an EVIDENCE that is not reliable, and the exit
    //     code of that is 3 - never the 1 of an ordinary failure.
    if (final.reporting_failure !== null) {
      return refuse("the report of the run failed");
    }
    if (final.reporting_failures.length > 0) return refuse("the run kept a failure of its report");
    if (final.evidence_errors.length > 0) return refuse("the run kept a failure of its evidence");
    if (final.evidence_problems.length > 0) return refuse("the run kept a problem of its evidence");
    if (final.manifest_error !== null) {
      return refuse("the manifest of the run carries an error");
    }
    // 14. The proof of the domain, and the CLEANUP of the run.
    const terminalProof = facts.terminalProof;
    const proofIsReal = baseline !== null
      && baseline.terminal_proof !== null
      && baseline.terminal_proof.proven === true;
    const noRawFailure = facts.cleanupFacts.length === 0;
    const noDiagnosticFailure = snapshot !== null
      && snapshotCleanupFailures === 0
      && Array.isArray(snapshotCleanupFacts)
      && snapshotCleanupFacts.length === 0;
    // 15. The decision of the mode.
    //
    // A run that FAILED is an ordinary business failure: its evidence is
    // reliable, it is NOT accepted, and its exit code is 1 - never the exit
    // code of the expected fault as a pass.
    if (outcome.kind === "failed") {
      return ordinary("the run failed for an ordinary business reason");
    }
    if (outcome.mode === "normal") {
      // A normal run is ACCEPTED when it really succeeded: the exact picture,
      // the complete terminal proof, no failure at all, and the facts of the
      // run agree with the record.
      const pictureIsTheExactOne = facts.pictureBytes === PICTURE_BYTES
        && facts.pictureSha256 === PICTURE_SHA256
        && facts.pictureIsTheExactOne === true;
      const noTransportFailure = transportFailure === null;
      const notLatchedAsFailure = latched !== null && latched.kind !== "failure";
      const agrees = outcome.kind === "ok"
        && outcome.exitCode === PILOT_EXIT_OK
        && outcome.faultCasePassed === false
        && outcome.terminalProof === true
        && outcome.pictureIsTheExactOne === true
        && outcome.pictureBytes === PICTURE_BYTES
        && outcome.pictureSha256 === PICTURE_SHA256
        && outcome.originalFailure === null
        && outcome.settlementFailure === null;
      const accepted = outcome.kind === "ok"
        && final.kind_of_run === "ok"
        && final.fault_case_passed === false
        && final.exit_code === PILOT_EXIT_OK
        && terminalProof
        && proofIsReal
        && pictureIsTheExactOne
        && facts.original === null
        && facts.settlement === null
        && noRawFailure
        && noDiagnosticFailure
        && noTransportFailure
        && notLatchedAsFailure
        && agrees;
      if (accepted) {
        return { evidenceReliable: true, accepted: true, exitCode: PILOT_EXIT_OK, reasons };
      }
      // The run CLAIMS a normal success and its own facts do not support it:
      // that is a contradiction between the records and the actual facts, and
      // it is NOT an ordinary business failure.
      return refuse("the run claims a normal success that its own facts do not support");
    }
    // The FAULT mode: the deliberate failure is only accepted when it is the
    // EXACT one - the same code, the settlement of the SAME error or of its
    // direct cause, the cancel of the owner as the PRIMARY outcome, no
    // picture at all, no other failure and the complete terminal proof.
    const originalCode = facts.original === null ? null : facts.original.code;
    const isTheDeliberateOne = originalCode === EXPECTED_ASSERTION_FAILURE;
    // The RELATION between the ACTUAL objects: the same object, or the direct
    // cause of it. The text of the two errors is never the relation.
    const actualOriginal = outcome.originalFailure;
    const actualSettlement = outcome.settlementFailure;
    const settlementIsTheOriginal = actualOriginal !== null && actualOriginal !== undefined
      && (actualSettlement === actualOriginal
        || (isRecord(actualSettlement) && (actualSettlement as { cause?: unknown }).cause === actualOriginal));
    const cancelIsPrimary = provenance !== null
      && provenance.accepted_as_primary === true
      && provenance.superseded_by_earlier_failure === false
      && provenance.code === "DRAW_CANCELLED";
    const latchedIsTheCancel = latched !== null
      && latched.kind === "failure"
      && latched.code === "DRAW_CANCELLED";
    const provenanceIsBoundToTheOriginal = provenance !== null
      && facts.original !== null
      && provenance.error_name === facts.original.name
      && provenance.error_code === facts.original.code
      && provenance.message === facts.original.message;
    const noPicture = facts.pictureSha256 === null
      && facts.pictureBytes === null
      && facts.pictureIsTheExactOne === false;
    const agrees = outcome.kind === "fault-observed"
      && outcome.exitCode === PILOT_EXIT_FAULT
      && outcome.faultCasePassed === true
      && outcome.terminalProof === true
      && outcome.pictureSha256 === null
      && outcome.pictureBytes === null
      && outcome.pictureIsTheExactOne === false;
    const accepted = outcome.kind === "fault-observed"
      && final.kind_of_run === "fault-observed"
      && final.fault_case_passed === true
      && final.exit_code === PILOT_EXIT_FAULT
      && isTheDeliberateOne
      && settlementIsTheOriginal
      && facts.settlement !== null
      && cancelIsPrimary
      && latchedIsTheCancel
      && provenanceIsBoundToTheOriginal
      && transportFailure === null
      && terminalProof
      && proofIsReal
      && noPicture
      && noRawFailure
      && noDiagnosticFailure
      && agrees;
    if (accepted) {
      return { evidenceReliable: true, accepted: true, exitCode: PILOT_EXIT_FAULT, reasons };
    }
    // The run CLAIMS the deliberate fault and its own facts do not support it:
    // the same object, or the direct cause of it, is the relation - and the
    // text of the two errors is never the relation.
    return refuse("the run claims the deliberate fault that its own facts do not support");
  } catch (error) {
    return refuse(`the check itself failed: ${boundedError(error).message}`);
  }
}

/**
 * The command of the tool.
 *
 * The exit code is the JUDGEMENT of the run, and it follows the INTERNAL
 * protocol `positive-pilot-publication-v2`:
 *
 *   0  the normal draw really succeeded and the joint publication of its
 *      evidence is complete;
 *   1  the deliberate failure was really observed and the joint publication
 *      of its evidence is complete - OR the run failed for an ordinary
 *      business reason, which is NEVER a pass;
 *   2  the arguments or the entry of the command were refused;
 *   3  a mandatory evidence, a report or the publication itself is not
 *      reliable - and this is NEVER an accepted fault.
 *
 * THE OLD SEMANTICS, AND WHAT CHANGED:
 *
 *   - the old code answered 1 for everything that was not a success: a
 *     refused argument was 2, and EVERY other failure was 1. The failure of
 *     the evidence, of the report and of the publication is now 3, so that it
 *     may never be read as the expected fault - which is also 1;
 *   - the old code returned the green qualification of a run whose final
 *     record was NOT really written. The qualification is now revoked with
 *     the publication, and the run answers 3;
 *   - the old code accepted an exit code of 1 as the expected fault. The
 *     expected fault is now a fact of the RECORD: it needs the complete
 *     terminal proof AND the valid final chain AND the joint publication.
 *
 * The run owns its OWN report and its OWN final qualification: the report of
 * the candidate goes through the boundary, the final record is written after
 * the report settled, and the exit code is the one of that record. The
 * command only reports a REFUSAL of its own - a bad argument or a run that
 * could not be made at all.
 */
export async function main(argv: readonly string[], deps: PositivePilotDependencies = REAL_DEPENDENCIES): Promise<number> {
  // The REPORTING BOUNDARY is installed BEFORE any resource is created: the
  // destination is LISTENED to, and the completion of every write is handled.
  // It is the ACTUAL boundary of the REVIEWED nofork pilot - not a copy of it
  // - and it is the SAME instance for the whole run.
  const reporting = await createReviewedReportingBoundary(deps.reportStream, deps.writeStderr);
  const report = (text: string): void => { reporting.report(text); };
  let options: PositivePilotOptions;
  try {
    options = parsePositivePilotArguments(argv);
  } catch (error) {
    report(`${JSON.stringify({ kind: "REFUSED", reason: boundedError(error).message })}\n`);
    await reporting.settled();
    return PILOT_EXIT_REFUSED;
  }
  let outcome: PositivePilotOutcome;
  try {
    outcome = await runPositivePilot(options, deps, reporting);
  } catch (error) {
    report(`${JSON.stringify({ kind: "REFUSED", reason: boundedError(error).message })}\n`);
    await reporting.settled();
    return PILOT_EXIT_REFUSED;
  }
  // Every report that is still PENDING is awaited here: an error that arrives
  // on a LATER turn is part of the result, and it is never lost behind a
  // success. The runner already waited for its own report; this is the last
  // chance of a late error.
  await reporting.settled();
  // The JOINT qualification of the run. It is the conjunction of the
  // PUBLICATION (the final record was really published and the evidence is
  // complete), the DIGESTS of the three records and the PROTOCOL of the exit
  // code:
  //
  //  - a failure of the reporting is a failure of the CASE, and the result
  //    may never be green while a report of it failed;
  //  - a run whose FINAL record was not really published is not accepted at
  //    all, and it is not an expected fault either;
  //  - a green looking final record on the disk is NOT the authority: the
  //    authority is the conjunction above.
  if (reporting.firstFailure !== null) return PILOT_EXIT_UNRELIABLE;
  // The JOINT check of the run: the ACTUAL bytes of the root, the protocol
  // of the publication and the result that is specific to the mode.
  //
  // It is the SAME function that the legacy consumer and the pure tests
  // call - there is ONE checker in this repository, and it is not a copy.
  //
  // It does NOT observe the exit code that the operating system will give to
  // this process: the outer recorder and the acceptor compare the REAL
  // observed exit with this verdict, and they do it outside of this program.
  return verifyPublishedRun(outcome, outcome.root ?? "", deps.readBytes).exitCode;
}

/** Whether this file is the entry point of the run. */
export function isEntryPoint(argv1: string | undefined = process.argv[1]): boolean {
  if (argv1 === undefined) return false;
  try {
    return resolve(argv1) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2));
}
