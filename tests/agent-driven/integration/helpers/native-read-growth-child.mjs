/**
 * An OWNED external mutator.
 *
 * It performs ONE real change of the file it was told about - one real append, or
 * one real truncation - and exits. The parent waits for its REAL exit, so the
 * change is a fact that happened BEFORE the parent continued: the file really
 * changed, and the child really ended.
 *
 * There is no timer here and no marker: the parent decides WHEN the change
 * happens by running this child at the very moment it wants it - inside the read
 * that is in flight, after the reader took its own size and after its first block
 * was read.
 *
 * argv: <target> <grow|truncate> [chunkBytes]
 */
import { closeSync, ftruncateSync, openSync, readSync, statSync, writeSync } from "node:fs";

const [target, mode, chunkText] = process.argv.slice(2);
if (!target || (mode !== "grow" && mode !== "truncate" && mode !== "rewrite")) {
  process.stderr.write("INVALID_ARGUMENTS\n");
  process.exit(2);
}
const chunk = Number(chunkText ?? 1048576);
const handle = openSync(target, mode === "grow" ? "a" : "r+");
try {
  if (mode === "truncate") ftruncateSync(handle, Math.floor(statSync(target).size / 2));
  // A REWRITE changes the bytes and keeps the length: the size probe cannot see
  // it, only the change time of the inode can.
  else if (mode === "rewrite") {
    // The SAME byte is written back: the content, the size and the digest of the
    // file do not change - only the change time of the inode does.
    const one = Buffer.alloc(1);
    readSync(handle, one, 0, 1, 0);
    writeSync(handle, one, 0, 1, 0);
  } else writeSync(handle, Buffer.alloc(chunk, 0x41));
} finally {
  closeSync(handle);
}
process.stdout.write(`${statSync(target).size}\n`);
process.exit(0);
