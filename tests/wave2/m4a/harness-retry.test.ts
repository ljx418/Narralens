import { describe, expect, it, vi } from "vitest";
import { retryRecoverable } from "../../support/retry-recoverable.js";

describe("M4A harness recoverable upstream verification", () => {
  it("retries an unverifiable pinned checkout and then returns the successful result", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(
        new Error("cannot verify that the pinned OpenFilm checkout is clean"),
        { code: "ENGINE_UNAVAILABLE" },
      ))
      .mockResolvedValue("verified");

    await expect(retryRecoverable(operation, 3)).resolves.toBe("verified");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry a checkout that is verifiably dirty", async () => {
    const failure = Object.assign(
      new Error("pinned OpenFilm checkout has local modifications"),
      { code: "ENGINE_UNAVAILABLE" },
    );
    const operation = vi.fn().mockRejectedValue(failure);

    await expect(retryRecoverable(operation, 3)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("bounds repeated unverifiable-checkout retries", async () => {
    const failure = Object.assign(
      new Error("cannot verify that the pinned OpenFilm checkout is clean"),
      { code: "ENGINE_UNAVAILABLE" },
    );
    const operation = vi.fn().mockRejectedValue(failure);

    await expect(retryRecoverable(operation, 2)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
