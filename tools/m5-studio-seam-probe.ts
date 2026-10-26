import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenFilmStudioSupervisor } from "../src/host/m5/openfilm-studio-supervisor.js";

/**
 * The M5 Studio seam probe (Wave 3 `04` §1).
 *
 * It is the *first* thing M5 does with the upstream, and it is a real probe: the pinned
 * checkout is verified, `startStudio` is located and its options are read out of its own
 * signature, the `StudioHost` v1 interface is read for `onSelection` and `onCommand`, and
 * the whole module closure the Studio server loads is digested file by file.
 *
 * Two files come out of it:
 *
 * - `docs/evidence/WAVE3/M5/upstream/studio-seam-probe.json` — the probe record;
 * - `contracts/openfilm-upstream-lock.json` — extended with the Studio's loaded closure
 *   and the Studio build's input digests, so the bytes that are about to run are pinned
 *   before they run, exactly as the film seam already is.
 *
 * The probe never modifies the pinned upstream and never starts the Studio: it reads.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const vendorRoot = resolve(process.env.NARRALENS_OPENFILM_VENDOR ?? REPO, "vendor/openfilm");
const probePath = resolve(REPO, "docs/evidence/WAVE3/M5/upstream/studio-seam-probe.json");
const lockPath = resolve(REPO, "contracts/openfilm-upstream-lock.json");

const supervisor = new OpenFilmStudioSupervisor({
  vendorRoot,
  targetRootOf: async () => { throw new Error("THE_PROBE_DOES_NOT_OPEN_ANY_PROJECT"); },
  onStudio: () => undefined,
});

const probe = await supervisor.probe();

await mkdir(dirname(probePath), { recursive: true });
await writeFile(probePath, `${JSON.stringify(probe, null, 2)}\n`, "utf8");
process.stdout.write(`probe written: ${probePath}\n`);

if (probe.ok) {
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
  const next = {
    ...lock,
    studio_entry_module: probe.seams.start_studio.module,
    studio_entry_module_sha256: probe.seams.start_studio.sha256,
    studio_host_module: probe.seams.studio_host.module,
    studio_host_module_sha256: probe.seams.studio_host.sha256,
    studio_loaded_module_sha256: probe.loaded_closure,
    studio_build_input_sha256: probe.studio_build.files,
    studio_seam_exports: ["startStudio"],
    studio_host_members: ["version", "onSelection", "onCommand", "panel"],
  };
  await writeFile(lockPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  process.stdout.write(`lock extended: ${lockPath}\n`);
}

process.stdout.write(`probe ok: ${probe.ok} — ${probe.reason}\n`);
if (!probe.ok) process.exitCode = 1;
