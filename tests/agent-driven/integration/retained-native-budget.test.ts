import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mkdtempSync, rmSync, statSync, writeFileSync, closeSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

/**
 * The retained closure's budget, and the bound of its digests.
 *
 * These cases touch nothing but the file system: no Host, no browser, no media
 * tool, no network.
 *
 * The OBSERVATION is the real one: `node:fs` is wrapped for this test file's own
 * module graph, the real `readSync` and the real `openSync` are called, their real
 * results are returned, and the bytes they moved are recorded against the REAL
 * descriptor the closure opened. The observation therefore works on the OLD
 * closure as well - it does not depend on the closure telling anybody what it read
 * - and it cannot make a fact true that is not.
 *
 * The MUTATION is a real external child process that changes the file ONCE, at the
 * exact moment the parent wants it: at the first real read of the watched file,
 * which is after the closure took its own size and after its first block was read.
 * The parent waits for that child's real exit inside the read, so the growth is a
 * fact that happened before the read in flight returned.
 */
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  const {createRequire}=await import("node:module");
  // The observation is loaded through require(ESM), so the test and this factory
  // share ONE state and not two copies of it.
  const state=createRequire(import.meta.url)("./helpers/native-read-byte-observer.mjs");
  return {
    ...actual,
    // The observation is reachable through the mocked module itself, so the test
    // and the wrapper share ONE state and not two copies of it.
    __observer: state,
    openSync: (path: string, flags: number, mode?: number) => {
      const fd = actual.openSync(path, flags, mode);
      state.recordOpen(fd, path);
      return fd;
    },
    readSync: (fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position?: number | null) => {
      const moved = actual.readSync(fd, buffer, offset, length, position ?? null);
      state.recordRead(fd, moved);
      return moved;
    },
  };
});

const {RetainedNativeClosure} = await import("../../../src/host/agent-driven/retained-native-closure.js");
/** The observation the real wrapper fills: one state, reached through the mocked
 *  module the wrapper itself lives in. */
interface ReadObservation {
  recordOpen(fd: number, path: string): void;
  recordRead(fd: number, bytes: number): void;
  armMutation(target: string, run: () => void): void;
  mutationFired(): boolean;
  reset(): void;
  bytesOf(path: string): number;
  totalBytes(): number;
  pathsRead(): readonly string[];
}
const observer = (await import("node:fs") as unknown as { __observer: ReadObservation }).__observer;


const here = fileURLToPath(new URL(".", import.meta.url));
const helper = (name: string): string => join(here, "helpers", name);

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});
beforeEach(() => {
  observer.reset();
});

const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "n1n2-budget-"));
  roots.push(dir);
  return dir;
};

/** The real mutation, in a real child, waited for. */
const mutate = (target: string, mode: "grow" | "truncate" | "rewrite"): { status: number | null; out: string } => {
  const result = spawnSync(process.execPath, [helper("native-read-growth-child.mjs"), target, mode], {encoding: "utf8"});
  return { status: result.status, out: result.stdout };
};

/** The bytes the REAL reads moved on the file of that name. */
const bytesReadOf = (name: string): number => {
  let total = 0;
  for (const path of observer.pathsRead()) if (path.endsWith(`/${name}`)) total += observer.bytesOf(path);
  return total;
};

describe("the retained closure's text budget and its bounded digests", () => {
  it("refuses a text above the per-file budget before a single byte of it is read", async () => {
    const dir = root();
    writeFileSync(join(dir, "film.html"), "x".repeat(9 * 1024 * 1024));
    const closure = await RetainedNativeClosure.open(dir, {});
    try {
      await expect(closure.retainFile("film.html")).rejects.toMatchObject({code: "NATIVE_CLOSURE_BUDGET"});
      // The REAL reads of that file are zero: the refusal came BEFORE the read, and
      // the observation does not depend on the closure saying so.
      expect(bytesReadOf("film.html")).toBe(0);
    } finally {
      await closure.release();
    }
  });

  it("refuses the text that crosses the total budget before its bytes are read", async () => {
    const dir = root();
    writeFileSync(join(dir, "a.json"), "a".repeat(3072));
    writeFileSync(join(dir, "b.json"), "b".repeat(3072));
    // The total of THIS closure is 4 KiB: the second file crosses it.
    const closure = await RetainedNativeClosure.open(dir, {maxTotalTextBytes: 4096});
    try {
      const first = await closure.retainFile("a.json");
      expect(first.bytes).toBe(3072);
      expect(bytesReadOf("a.json")).toBe(3072);
      // The file that crosses the total is refused BEFORE it is read: the budget is
      // spent by the files this closure really holds, not by the ones it reads later.
      await expect(closure.retainFile("b.json")).rejects.toMatchObject({code: "NATIVE_CLOSURE_BUDGET"});
      expect(bytesReadOf("b.json")).toBe(0);
    } finally {
      await closure.release();
    }
  });

  it("streams a known media file and refuses an unknown extension as a text", async () => {
    const dir = root();
    writeFileSync(join(dir, "clip.mp4"), Buffer.alloc(9 * 1024 * 1024, 1));
    writeFileSync(join(dir, "blob.unknown"), Buffer.alloc(9 * 1024 * 1024, 2));
    const closure = await RetainedNativeClosure.open(dir, {});
    try {
      // A KNOWN media file is hashed in a bounded stream: the text budget does not
      // touch it.
      const media = await closure.retainFile("clip.mp4");
      expect(media.bytes).toBe(9 * 1024 * 1024);
      // An extension nobody knows is not a way past the text budget.
      await expect(closure.retainFile("blob.unknown")).rejects.toMatchObject({code: "NATIVE_CLOSURE_BUDGET"});
      expect(bytesReadOf("blob.unknown")).toBe(0);
      // And a media label does not make a file readable as text either.
      await expect(closure.readText(media)).rejects.toMatchObject({code: "NATIVE_CLOSURE_BUDGET"});
    } finally {
      await closure.release();
    }
  });

  it("refuses a file that grew while it was hashed, and reads at most the captured size", async () => {
    const dir = root();
    const target = join(dir, "big.mp4");
    const size = 32 * 1024 * 1024;
    writeFileSync(target, Buffer.alloc(size, 3));
    const mutations: { status: number | null; out: string }[] = [];
    // The mutation fires at the FIRST real read of the file: the closure has taken
    // its own size already, and its first block is in flight.
    observer.armMutation("big.mp4", () => { mutations.push(mutate(target, "grow")); });
    const closure = await RetainedNativeClosure.open(dir, {});
    try {
      await expect(closure.retainFile("big.mp4")).rejects.toMatchObject({code: "NATIVE_CLOSURE_MEMBERSHIP_MOVED"});
      // The external change really happened, in a child that really ended.
      expect(mutations.length).toBe(1);
      expect(mutations[0]!.status).toBe(0);
      expect(statSync(target).size).toBeGreaterThan(size);
      // The closure read at most the size it captured, plus the one byte that
      // proves that the file did not grow.
      expect(bytesReadOf("big.mp4")).toBeGreaterThan(0);
      expect(bytesReadOf("big.mp4")).toBeLessThanOrEqual(size + 1);
    } finally {
      await closure.release();
    }
  });

  it("refuses a file that was truncated while it was hashed", async () => {
    const dir = root();
    const target = join(dir, "big.mp4");
    const size = 32 * 1024 * 1024;
    writeFileSync(target, Buffer.alloc(size, 4));
    const mutations: { status: number | null; out: string }[] = [];
    observer.armMutation("big.mp4", () => { mutations.push(mutate(target, "truncate")); });
    const closure = await RetainedNativeClosure.open(dir, {});
    try {
      await expect(closure.retainFile("big.mp4")).rejects.toMatchObject({code: "NATIVE_CLOSURE_MEMBERSHIP_MOVED"});
      expect(mutations.length).toBe(1);
      expect(mutations[0]!.status).toBe(0);
      expect(statSync(target).size).toBeLessThan(size);
      expect(bytesReadOf("big.mp4")).toBeLessThanOrEqual(size + 1);
    } finally {
      await closure.release();
    }
  });

  it("refuses a file that was rewritten in place while it was hashed", async () => {
    const dir = root();
    const target = join(dir, "big.mp4");
    const size = 32 * 1024 * 1024;
    writeFileSync(target, Buffer.alloc(size, 8));
    const mutations: { status: number | null; out: string }[] = [];
    // The SAME byte is written back while the hash is running: the length, the
    // bytes and the digest of the file do not change - only the change time of the
    // inode does. The size probe cannot see it.
    observer.armMutation("big.mp4", () => { mutations.push(mutate(target, "rewrite")); });
    const closure = await RetainedNativeClosure.open(dir, {});
    try {
      await expect(closure.retainFile("big.mp4")).rejects.toMatchObject({code: "NATIVE_CLOSURE_MEMBERSHIP_MOVED"});
      expect(mutations.length).toBe(1);
      expect(mutations[0]!.status).toBe(0);
      // The length did not change, and the digest of the file is the same one.
      expect(statSync(target).size).toBe(size);
      // The fence after the read is what refuses it.
      expect(bytesReadOf("big.mp4")).toBeLessThanOrEqual(size + 1);
    } finally {
      await closure.release();
    }
  });

  it("refuses the re-hash of a file that grew, and bounds the bytes it reads", async () => {
    const dir = root();
    const target = join(dir, "big.mp4");
    const size = 32 * 1024 * 1024;
    writeFileSync(target, Buffer.alloc(size, 5));
    const closure = await RetainedNativeClosure.open(dir, {});
    try {
      const file = await closure.retainFile("big.mp4");
      expect(file.bytes).toBe(size);
      const mutations: { status: number | null; out: string }[] = [];
      observer.armMutation("big.mp4", () => { mutations.push(mutate(target, "grow")); });
      const before = bytesReadOf("big.mp4");
      await expect(closure.hashFile(file)).rejects.toMatchObject({code: "NATIVE_CLOSURE_MEMBERSHIP_MOVED"});
      expect(mutations.length).toBe(1);
      expect(mutations[0]!.status).toBe(0);
      expect(statSync(target).size).toBeGreaterThan(size);
      expect(bytesReadOf("big.mp4") - before).toBeLessThanOrEqual(size + 1);
    } finally {
      await closure.release();
    }
  });

  it("bounds the file guard, and the bytes it reads are the real ones", async () => {
    const dir = root();
    const target = join(dir, "big.mp4");
    const size = 32 * 1024 * 1024;
    writeFileSync(target, Buffer.alloc(size, 6));
    const closure = await RetainedNativeClosure.open(dir, {});
    try {
      const file = await closure.retainFile("big.mp4");
      const mutations: { status: number | null; out: string }[] = [];
      observer.armMutation("big.mp4", () => { mutations.push(mutate(target, "grow")); });
      const before = bytesReadOf("big.mp4");
      const guarded = closure.verifyFile(file);
      expect(mutations.length).toBe(1);
      expect(mutations[0]!.status).toBe(0);
      expect(statSync(target).size).toBeGreaterThan(size);
      // The guard read the file for real, and it read at most the size it took.
      expect(bytesReadOf("big.mp4") - before).toBeGreaterThan(0);
      expect(bytesReadOf("big.mp4") - before).toBeLessThanOrEqual(size + 1);
      expect(guarded).toBe(false);
    } finally {
      await closure.release();
    }
  });

  it("bounds the whole tree guard, and the bytes it reads are the real ones", async () => {
    const dir = root();
    const target = join(dir, "big.mp4");
    const size = 32 * 1024 * 1024;
    writeFileSync(target, Buffer.alloc(size, 7));
    const closure = await RetainedNativeClosure.open(dir, {});
    try {
      const file = await closure.retainFile("big.mp4");
      const mutations: { status: number | null; out: string }[] = [];
      observer.armMutation("big.mp4", () => { mutations.push(mutate(target, "grow")); });
      const before = bytesReadOf("big.mp4");
      const guarded = closure.verify();
      expect(mutations.length).toBe(1);
      expect(mutations[0]!.status).toBe(0);
      expect(statSync(target).size).toBeGreaterThan(size);
      expect(bytesReadOf("big.mp4") - before).toBeGreaterThan(0);
      expect(bytesReadOf("big.mp4") - before).toBeLessThanOrEqual(size + 1);
      expect(guarded).toBe(false);
    } finally {
      await closure.release();
    }
  });

  it("gives the text budget back when a retain fails", async () => {
    const dir = root();
    const target = join(dir, "film.html");
    writeFileSync(target, "x".repeat(1024));
    writeFileSync(join(dir, "other.html"), "y".repeat(1024));
    const mutations: { status: number | null; out: string }[] = [];
    observer.armMutation("film.html", () => { mutations.push(mutate(target, "grow")); });
    // The total of THIS closure is 2 KiB: the second text would cross it.
    const closure = await RetainedNativeClosure.open(dir, {maxTotalTextBytes: 2048});
    try {
      // The retain fails: the file grew while it was hashed.
      await expect(closure.retainFile("film.html")).rejects.toMatchObject({code: "NATIVE_CLOSURE_MEMBERSHIP_MOVED"});
      expect(mutations.length).toBe(1);
      expect(mutations[0]!.status).toBe(0);
      // The budget of the file that was NOT kept is back: the next text of the
      // same size is admitted, and the total is still this closure's own.
      const other = await closure.retainFile("other.html");
      expect(other.bytes).toBe(1024);
    } finally {
      await closure.release();
    }
  });

  it("keeps the genuine release failure and the uncertainty of a failed retain", async () => {
    const dir = root();
    const target = join(dir, "film.html");
    writeFileSync(target, "x".repeat(1024));
    const mutations: { status: number | null; out: string }[] = [];
    observer.armMutation("film.html", () => { mutations.push(mutate(target, "grow")); });
    // The release of a descriptor really fails: the closure must keep that
    // failure, and it must NOT pretend that it holds nothing.
    const closure = await RetainedNativeClosure.open(dir, {}, {
      close: (fd: number) => {
        // The REAL close happens first, exactly once; the failure is reported after
        // it, so nothing is left open and nothing is closed twice.
        closeSync(fd);
        throw new Error("the release of the retained file failed");
      },
    });
    try {
      // The retain fails, and the release of its descriptor fails as well: the
      // primary keeps its place and the genuine failure is carried with it.
      let thrown: unknown;
      try { await closure.retainFile("film.html"); } catch (error) { thrown = error; }
      expect(thrown).toBeDefined();
      expect((thrown as { code?: string }).code).toBe("NATIVE_CLOSURE_MEMBERSHIP_MOVED");
      expect((thrown as { cleanup_errors?: unknown[] }).cleanup_errors?.length).toBeGreaterThan(0);
      // The failed release latched the uncertainty: the closure can no longer say
      // what it holds, and it admits no new work.
      expect(closure.uncertain).toBe(true);
      await expect(closure.retainFile("film.html")).rejects.toMatchObject({code: "NATIVE_CLOSURE_UNCERTAIN"});
    } finally {
      const failure = await closure.release().then(() => null, (error: unknown) => error);
      // The closure that could not release one of its files says so, and it says
      // so with the genuine failure attached.
      if (failure !== null) expect((failure as { cleanup_errors?: unknown[] }).cleanup_errors?.length).toBeGreaterThan(0);
    }
  });
});
