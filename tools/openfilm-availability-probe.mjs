import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Real pinned-upstream probe for the W2.0 evidence capture.
 *
 * Reports whether the checkout the OpenFilm port would be composed from is at the pinned
 * full SHA, clean, and has every file it is about to load hashing to its pinned digest.
 *
 * Absence is reported as `NOT_RUN` with exit 0, never as a pass and never as a failure. A
 * missing checkout is an environment fact; a *drifted* one is a real finding and exits 1,
 * because "the bytes we execute are not the bytes we froze" is exactly the defect this
 * probe exists to catch.
 */

const VENDOR = process.env.NARRALENS_OPENFILM_VENDOR
  ?? resolve("/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm");

// Run through tsx: the production module is TypeScript with `.js` import specifiers.
const { OPENFILM_PIN, openFilmAvailability } = await import("tsx/esm").then(
  async () => import("../src/adapters/openfilm/openfilm-upstream.ts"),
);

console.log(`vendor_root=${VENDOR}`);
console.log(`expected_sha=${OPENFILM_PIN.full_sha}`);

if (!existsSync(VENDOR)) {
  console.log("status=NOT_RUN");
  console.log("reason=PINNED_OPENFILM_ABSENT: no checkout at this path; nothing was probed or claimed");
  process.exit(0);
}

const availability = await openFilmAvailability(VENDOR);
console.log(`available=${availability.available}`);
console.log(`observed_sha=${availability.observed_sha ?? "none"}`);
console.log(`reason=${availability.reason}`);
console.log(`checked=${JSON.stringify(availability.checked)}`);
console.log(`module_pin=${JSON.stringify(OPENFILM_PIN.loaded_module_sha256)}`);
console.log(`package_pin=${OPENFILM_PIN.package_json_sha256}`);
console.log(`lockfile_pin=${OPENFILM_PIN.lockfile_sha256}`);
console.log(`license_pin=${OPENFILM_PIN.license_sha256}`);
console.log(`license=${OPENFILM_PIN.license}`);

if (availability.available) process.exit(0);
console.log("status=FAIL: the pinned checkout did not verify; the OpenFilm port stays un-composed");
process.exit(1);
