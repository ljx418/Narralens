import { describe, expect, it, vi } from "vitest";
import type { OpenFilmAvailability } from "../../src/adapters/openfilm/openfilm-upstream.js";
import { verifyOpenFilmForComposition } from "../../src/host/engine/openfilm-composition.js";

function verdict(available: boolean, reason: string): OpenFilmAvailability {
  return {
    available,
    vendor_root: "/pinned/openfilm",
    observed_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
    expected_sha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
    reason,
    checked: available ? ["git_head", "git_clean"] : ["git_head"],
  };
}

describe("OpenFilm composition verification retry", () => {
  it("retries an inconclusive clean-tree check and accepts a later verified result", async () => {
    const check = vi.fn()
      .mockResolvedValueOnce(verdict(false, "cannot verify that the pinned OpenFilm checkout is clean"))
      .mockResolvedValueOnce(verdict(true, "pinned OpenFilm checkout verified"));

    const result = await verifyOpenFilmForComposition("/pinned/openfilm", 10, {
      attempts: 3, delayMs: 0, check,
    });

    expect(result.available).toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("does not retry a conclusive dirty-checkout verdict", async () => {
    const dirty = verdict(false, "pinned OpenFilm checkout has local modifications: package.json");
    const check = vi.fn().mockResolvedValue(dirty);

    await expect(verifyOpenFilmForComposition("/pinned/openfilm", 10, {
      attempts: 3, delayMs: 0, check,
    })).resolves.toBe(dirty);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured number of inconclusive checks", async () => {
    const unavailable = verdict(false, "cannot verify that the pinned OpenFilm checkout is clean");
    const check = vi.fn().mockResolvedValue(unavailable);

    await expect(verifyOpenFilmForComposition("/pinned/openfilm", 10, {
      attempts: 2, delayMs: 0, check,
    })).resolves.toBe(unavailable);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
