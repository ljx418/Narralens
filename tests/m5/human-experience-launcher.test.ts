import { describe, expect, it } from "vitest";
import { assertLoopbackUrl, headedChromeArgs } from "../../tools/m5-human-experience.js";

describe("M5 UX-12 visible launcher safety", () => {
  it("only accepts an HTTP loopback experience URL", () => {
    expect(assertLoopbackUrl("http://127.0.0.1:4321/studio").port).toBe("4321");
    expect(assertLoopbackUrl("http://localhost:4321/studio").hostname).toBe("localhost");
    expect(() => assertLoopbackUrl("https://127.0.0.1/studio")).toThrow("M5_HUMAN_REFUSED_NON_LOOPBACK");
    expect(() => assertLoopbackUrl("http://example.com/studio")).toThrow("M5_HUMAN_REFUSED_NON_LOOPBACK");
  });

  it("builds a visible isolated app window without headless or mute flags", () => {
    const args = headedChromeArgs("/tmp/narralens-human", "http://127.0.0.1:4321/studio#/refine/p1", false);
    expect(args).toContain("--user-data-dir=/tmp/narralens-human");
    expect(args).toContain("--app=http://127.0.0.1:4321/studio#/refine/p1");
    expect(args.some((arg) => arg.includes("headless"))).toBe(false);
    expect(args.some((arg) => arg.includes("mute-audio"))).toBe(false);
  });

  it("converts an isolated profile for Windows Chrome", () => {
    const args = headedChromeArgs("/mnt/c/Users/Public/narralens-human", "http://127.0.0.1:4321/studio", true);
    expect(args).toContain("--user-data-dir=C:\\Users\\Public\\narralens-human");
  });
});
