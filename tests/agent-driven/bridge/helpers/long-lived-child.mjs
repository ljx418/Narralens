/**
 * A child that stays alive and reports its pid.
 *
 * The wrapper's cleanup case needs a process it can watch: this one writes its pid
 * to the file named by `NARRALENS_CHILD_PID_FILE` and then waits, so the case can
 * check that the wrapper really did take it down rather than merely that the
 * wrapper exited.
 */

import { writeFileSync } from "node:fs";

const pidFile = process.env.NARRALENS_CHILD_PID_FILE;
if (pidFile !== undefined && pidFile.length > 0) {
  writeFileSync(pidFile, String(process.pid));
}

setInterval(() => {
  // Stay alive until the wrapper stops us.
}, 1000);
