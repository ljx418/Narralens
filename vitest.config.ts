import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["vendor/**", "node_modules/**"],
    passWithNoTests: false,
    /**
     * Bounded on purpose, and this is a reliability fix rather than a budget.
     *
     * At the default (one worker per core, 24 here) the full suite intermittently failed
     * with `ENOMEM: not enough memory, readdir` inside `d4.2.1-import-service.test.ts` —
     * three separate runs, always in that file, never when it ran alone. The cause is
     * ordinary memory pressure: that suite copies a 135 MB media fixture per case and
     * fsyncs heavily, and doing several of those at once on a 15 GB box exhausts the page
     * cache.
     *
     * A flaky gate is worse than a slower one — it forces a re-roll that hides whether the
     * tree is actually green. At `maxWorkers: 8` the full suite passed three consecutive
     * times, and the wall clock was the same or better (94.65s bounded against 88.24s
     * unbounded, with unbounded being the run that also had to survive the flake).
     */
    maxWorkers: 8,
  },
});
