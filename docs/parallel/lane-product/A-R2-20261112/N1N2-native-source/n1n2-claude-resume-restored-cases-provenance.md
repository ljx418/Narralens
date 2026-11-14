N1N2 — the provenance of the four restored cases

Writer: Claude implementation child, task task_5dcbe8192764 / dispatch
ctx_b4086093cd96, cwd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration.

WHAT HAPPENED

A broad block replacement of `tests/agent-driven/integration/created-native-source-reader.test.ts`
(this child's own helper, later abandoned) replaced the case
"F04 refuses a hardlink alias and an unknown directory in the working copy" and
extended over the cases that followed it, deleting FOUR existing cases. MAIN found the
deletion by counting the cases of the file against the 018 grant's input hash. The
record of the regression is in `n1n2-claude-resume-after-140-cleanup-evidence.txt`.

THE RESTORATION SOURCE - EXACTLY WHAT IT IS

The four cases were restored from THIS CHILD'S OWN TRANSCRIPT of the round in which
it wrote them: the batch that added the G03-G07 cases, and the later revision that
gave the empty-directory case its genuine native cache directory. There was NO byte
backup of the file: the recorder's `inputs.json` holds hashes only, and the vitest
transform cache held no sources. The file is not tracked by git (it is a new
untracked path), so git holds no copy of it either.

CONSEQUENCE, STATED PLAINLY

- The restoration is NOT claimed to be byte-identical to what the deleted region
  contained. It is claimed to carry the SAME assertions, with the same fixture
  wiring and the same expectations, as the fragments in this child's transcript -
  and every assertion of every restored case is listed here.
- No case was padded or weakened to reach a count. The file holds 80 cases, which is
  the count MAIN expected.
- The broad replacement helper is no longer used. The insertions since are bounded
  and the whole hunk is read before the compile.

THE RESTORED CASES AND EVERY ASSERTION THEY MAKE

1. "G07 invalidates an old proof when an external hardlink appears after it"
   - the held proof verifies before the hardlink (`verifyClosure()` is true);
   - a hard link is created beside the working copy's film.html;
   - the same proof no longer verifies (the file gained a name: it is an alias).
2. "G07 holds both trees and a parallel proof under one descriptor pool"
   - the reader's pool is read before the first round;
   - after one round the pool's count is greater than before (the two trees of one
     acquisition are held by ONE count);
   - a parallel proof raises the count further (the SAME count);
   - after both rounds' handles are closed, the count is back where it was.
3. "G07 holds every nested and empty directory of both trees independently"
   - the empty native cache directory `.film/cache/probe` is created in the working
     copy (an arbitrary directory is still refused - that is the F04 case);
   - the reader's retained directories hold `.film/cache/probe` of the working copy;
   - the working copy's and the committed source's `assets` are both retained;
   - their (dev, ino) differ - two independent allocations, not two wrapper objects.
4. "P07 keeps the named primary and every cleanup cause of the real unpack path"
   - the named primary really fired (the counter is one) and the failure exists;
   - the cause list is an array, the named primary is its FIRST element and it is the
     very object that was injected, with its own code EIO;
   - each of the THREE named releases (the walk's own child on the nested unwind, the
     ancestry above the root, the root itself) really failed, by name, and each of
     those failures is kept in the cause list;
   - the refusal carries the production reason;
   - every allocation that was taken was released exactly once, no descriptor twice,
     and the released paths are the opened paths;
   - the second half: the final release failure is reported with the production code,
     every outstanding allocation was attempted exactly once, the failure is reported
     once, and a repeated release neither retries the failed allocation nor reports
     the failure twice.

WHAT IS STILL OPEN AFTER THE RESTORATION

The cases were restored from a transcript, not from bytes. The next freeze will
save the exact byte blobs by SHA256 (MAIN's FROZEN_SOURCE_BACKUP_RULE.md), so this
gap closes for the candidate - it does not close retroactively for these four cases.
