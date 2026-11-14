# N1N2 — the ONE consolidated G01–G07 proposal (17 requirements, one round)

Writer: Claude implementation child, task `task_5dcbe8192764` / dispatch
`ctx_b4086093cd96`, terminal `term_d383bb87-4e85-4090-a651-e24d730f642b`, coordinator
`term_c42901ca-2c06-452f-8f59-085ab98adb8a`. Sole writer of the released paths; MAIN
is the sole reviewer and document owner.

Inputs: `resume-claude-20261112/G01_G07_MAIN_DESIGN_CONSTRAINTS.md` (the canonical
design constraints), the round-2 independent audit, the 012/013 captures, and the
pinned upstream. **This is a proposal, not an implementation.** Nothing is written
until MAIN releases it, in ONE release.

Every path below is one of the ten released paths. No new HTTP DTO, no public
contract, no DDL, no pin/artifact change, no config, no commit by this child.

---

## G01 — an error is not a cleanup uncertainty; the ownership fact must cross the boundary

**Why the old implementation failed.** `failOpen` attaches the original `EIO` as a
cause in the *same* `cleanup_errors` list that genuine release failures use
(`retained-native-closure.ts:52-67`). So "the error has causes" says nothing about
whether a release failed. Meanwhile the reader's `#adopt`
(`created-native-source-reader.ts:335-364`) ignores the raw rejection entirely, and
the authority's catch (`committed-snapshot-authority.ts:510-518`) overwrites the
primary's causes with a raw `Object.defineProperty`. Result: a genuinely uncertain
source release is forgotten (a later read is admitted) while an ordinary read error
could, under the naive rule, lock the reader for ever.

**The change — `src/host/agent-driven/retained-native-closure.ts`.** A private,
identity-keyed ledger of *genuine* cleanup failures, next to the existing helpers:

```ts
/** The genuine release failures of one failure.
 *
 * A failure that merely CARRIES an ordinary cause — the syscall error that stopped
 * the work — is not uncertain: only a release that really failed is. The ledger is
 * private and keyed by the failure's own identity, so no JSON, no file and no
 * lookalike can register a cleanup failure. */
const cleanupLedger=new WeakMap<object,readonly unknown[]>();
/** The genuine release failures of a failure, or an empty list. */
export function retainedCleanupFailures(error:unknown):readonly unknown[]{
 if(typeof error!=='object'||error===null)return [];
 return cleanupLedger.get(error)??[];
}
/** Record that these failures are genuine release failures of this failure. */
export function markRetainedCleanupFailures(error:unknown,causes:readonly unknown[]):void{
 if(typeof error!=='object'||error===null)return;
 cleanupLedger.set(error,[...(cleanupLedger.get(error)??[]),...causes]);
}
```

`mergeCauses` (`:46-57`) marks what it merges; `failOpen` does **not** mark (an
ordinary `EIO` is not uncertainty); `close()`, `release()`, `open()`'s catch and the
child-release branch mark the failures they really had.

**The change — `src/host/agent-driven/committed-snapshot-authority.ts`.**
`acquireNativeFacts`'s catch merges the closure's release failure into the primary
with the same helper (never overwriting) and marks it; `#streamDigest`
(`:313-314`) stops replacing the named syscall cause:

```ts
const changed=(cause?:unknown)=>{const error=new ProductError('REVISION_CONFLICT','The committed snapshot facts or bytes changed');
 if(cause!==undefined)Object.defineProperty(error,'cause',{value:cause,enumerable:false,configurable:true});
 return error;};
// …in #streamDigest:
catch(error){throw changed(error);}
```

**The change — `src/host/agent-driven/created-native-source-reader.ts`.** `#adopt`'s
rejection branch adopts the *genuine* uncertainty, into the reader's existing sticky
ledger, before the close may finish:

```ts
const owned=work.then(value=>{…},(error:unknown)=>{
 // The reader asked for this acquisition, so it owns its release state. Only a
 // GENUINE release failure is an uncertainty; an ordinary cause is not.
 const genuine=retainedCleanupFailures(error);
 if(genuine.length>0){this.#cleanupUncertain=true;this.#cleanupFailures.push(...genuine);}
});
```

The reader's `#read` catch (`:593-609`) merges its own local failures with the same
helper (they are genuine) instead of the raw `Object.defineProperty`.

**Success / refusal behaviour.** A source acquisition that failed to release leaves
the reader **uncertain**: the next read is refused with
`NATIVE_SOURCE_READER_UNCERTAIN`, the reader's close reports the causes, and the
primary error of the failed acquisition keeps every cause. An ordinary `EIO` (a file
that is not there, a media that cannot be probed) leaves the reader **usable**: the
failure is reported, the resources are released, and the next read is admitted.

**The real reproduction barrier.** `observeNativeFacts({closureOps:{close:…}})`:
the source open/unpack fails with a named `EIO` **and** the source's release fails
(the descriptor is closed first, the failure injected afterwards). The first read
rejects; the rejection carries the named cause; a **second** read on the same reader
is refused with `NATIVE_SOURCE_READER_UNCERTAIN`; the reader's close reports the
causes. The variant: the caller is cancelled (the reader closes while the
acquisition is pending) and the raw acquisition then rejects with genuine cleanup
failures — the ledger holds them and the close reports them. A third variant: an
ordinary `EIO` (no release failure) must leave the next read **admitted** — the
negative control that proves the marker is not "any cause".

**Verification category / command.** Component (real Host + sqlite + the real tool):
`corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-source-reader.test.ts -t "R0|F02|F03|F04|F05|F06|F07|F08|F09|F10 shows"`, through the unchanged recorder, serial.

---

## G02 — the delivery linearization point

**Why the old implementation failed.** `#readFacts` ends with the closure checks
(`:839-843`), then `#read` sets `owned.delivered = true` (`:589-592`) with **no**
check of the reader's own `closed`/`cleanupUncertain` state, and an await or a
callback may still run in between: a `closureOps.close` callback during the final
`workspaceClosure.verify()` can close the reader synchronously, and the facts are
delivered anyway.

**The change — `created-native-source-reader.ts` `#read`.** After every await and
every callback has returned, and with **no** await and **no** re-entrant callback
between the check and the delivery flag:

```ts
const read=await this.#readFacts(baseline,facts,sourceLease,workspaceLease,workspaceClosure,owned);
// The linearization point: the reader is still open and still sure of what it
// holds. Nothing may run between this check and the delivery.
if(this.#closed)refuse('NATIVE_SOURCE_READER_CLOSED','The native source reader was closed while it was reading');
if(this.#cleanupUncertain)refuse('NATIVE_SOURCE_READER_UNCERTAIN','The native source reader cannot say what it holds');
owned.delivered=true;
return read;
```

The refusal stays **inside** the existing try, so it takes the existing
all-attempt pre-delivery cleanup (every handle closed once, the owner released, the
primary kept). The rule that a close **after** a completed delivery does not
destroy the owner-held resources is not touched.

**Success / refusal behaviour.** A reader that was closed (or became uncertain)
during the last verification refuses the round instead of delivering facts that no
one can trust. A close after a completed delivery still leaves the delivered
resources alone.

**The real reproduction barrier.** A `closureOps.close` callback that fires during
the **final** `workspaceClosure.verify()` calls `reader.close()` synchronously and
returns normally: the read must **not** deliver; it must reject with a `NATIVE_`
code; every handle must be released exactly once; the reader's close reports
nothing new. The second barrier: an already delivered proof's release fails while
the in-flight proof is in its final work — the in-flight proof must be refused.

**Verification category / command.** Component, as above.

---

## G03 — the parser may only consume bounded, retained bytes

**Why the old implementation failed.** `#nativeLineage` calls
`readProjectFilm(root)` (`committed-snapshot-authority.ts:280`); the adapter
(`src/adapters/openfilm/openfilm-upstream.ts:272-289`) opens `root/film.html` and
`handle.readFile()`s it **whole**. That read is outside the retained closure's
8 MiB / 64 MiB budget and outside its identity fence: a film replaced or grown
after the bounded digest is allocated before the equality check at `:286-287`
refuses it.

**The change — `committed-snapshot-authority.ts` only** (the adapter needs **no**
change: it already copies the bytes into its own `mkdtemp` folder at mode 0600 and
calls the pinned parser on that copy):

```ts
/** The film as the pinned parser sees it: a private, immutable copy.
 *
 * The pinned parser reads by path (`studio/server/film.mjs:33-44` reads
 * `film.html` and calls `readFilmFile(text)`), so it is given a folder this
 * authority owns: mode 0700, the exact retained bytes at 0600, nothing else. The
 * original root is never read again. */
async #parsePrivateFilm(text:string):Promise<OpenFilmFilmRead>{
 const folder=await mkdtemp(join(tmpdir(),'narralens-n1n2-film-'));
 let parsed:OpenFilmFilmRead;
 try{
  await writeFile(join(folder,'film.html'),Buffer.from(text,'utf8'),{flag:'wx',mode:0o600});
  parsed=await (await createPinnedOpenFilmUpstream(this.vendorRoot)).readProjectFilm(folder);
 }finally{
  // The folder is this authority's own; its removal is attempted once and its
  // failure is kept with the primary (G01).
  await rm(folder,{recursive:true,force:true});
 }
 return parsed;
}
```

In `#nativeLineage` the film text is taken **first** from the retained closure
(`closure.readText(await closure.retainFile('film.html'))` — the budget and the
identity fence apply), and the parse consumes that text. The closure-less legacy
path (`:227-228` via `:537`) uses the bytes the bounded, digest-checked 64 MiB
handle already read (`:267-270`). The original source's final identity/hash fence
still holds: the manifest digest, the retained-text equality (`:286-287`) and the
final `closure.verify()` (`:465`) are unchanged.

**Success / refusal behaviour.** The parse always sees the bytes the closure
retained; a source that changed in between is refused by the existing fences, not
by a lucky comparison.

**The real reproduction barrier.** Between the bounded digest and the parse, the
source `film.html` is really **grown** (or replaced) — the parse must not whole-read
the replaced big file, the read must be refused, and the owned folder must be
removed. The existing `onReadChunk` counter is re-described as *bounded text
decoding*; it is **not** claimed to be "zero physical I/O".

**Verification category / command.** Component (the authority path runs in the real
fixture): as above; plus the pure budget cases in the pure gate.

---

## G04 — the normal cache must be verifiable: neither a permanent refusal nor a blanket permission

**The upstream facts** (pinned, read this round — `studio/server/pageframes.mjs`):
the key is `sha256('black\0'+rel+'\0'+round(ms)+'\0'+w[+'\0'+overrides]).slice(0,24)`
(`:62-71`); the JSON holds **only** the file list (`:102-104`,
`deps=[...new Set([rel,...loaded])].filter(exists)`); the stamp is
`stampOf(root,files)=sha256(files.map(f=>`${f}:${mtimeMs}:${size}`).join('\n')).slice(0,24)`
(`:119-122`); **the upstream's own cache-validity rule** (`:75-81`) is "the deps
JSON exists AND `stampOf(root,files)` equals the stored stamp"; the poster is
written only for `rel='film.html'`, `ms<0`, `w=POSTER_W=480` and is "kept as its
last whatever film.html becomes" (`:109`, `:124-127`); the producer is reached as
`pageFrame(root,folderUrl,at,-1,480,tweaks)` / `pageFrame(root,folderUrl,at,ms,w,tweaks)`
(`studio/server/server.mjs:563-566`).

**Why the old implementation failed.** The arbitrary-key acceptance was removed
(the right call), but the replacement refuses **every** pageframe triple and the
poster (`:1132-1134`), so a working copy that the native itself decorated can never
be read again — a permanent blanket refusal of normal native output.

**The change — `created-native-source-reader.ts` `#classifyCache`.** The reader
recomputes the **upstream's own** rule from the bytes it retains:

```ts
/** The upstream's own stamp over a dependency list.
 *  `pageframes.mjs:119-122`: sha256(`${path}:${mtimeMs}:${size}` joined by a
 *  newline).slice(0,24). The retained facts are the same two numbers the upstream
 *  would stat. */
const upstreamStamp=(entries:readonly {path:string;mtime_ms:number;bytes:number}[]):string=>
 createHash('sha256').update(entries.map(entry=>`${entry.path}:${entry.mtime_ms}:${entry.bytes}`).join('\n')).digest('hex').slice(0,24);
```

A pageframe triple is **accepted** when: all three files of the key exist; the
`.json` parses to `{files:[…]}`; **every** listed file is a retained relative path
of the working copy; and the upstream's stamp over those retained
(`mtime_ms`,`bytes`) equals the content of the `.stamp`. The trust comes from the
**Host's own recomputation over its retained bytes** — the cache file grants no
trust by itself, an external JSON cannot register a witness, and a file that merely
exists proves nothing.

The **key is not recomputed**: `(rel, ms, w, tweaks)` are the *request's*
parameters (`server.mjs:563-566`), not facts of the workspace, so recomputing it
would be the reverse-hash guess MAIN forbade. The key binds the three files
together; the deps+stamp pairing is the witness.

`film-poster.jpg` is classified as a **known native-derived stale artifact**: it is
accepted as a derived item of the native's own producer path and is **never** used
as a fact about the current film (the upstream itself may return an old poster),
never used as an author source, and never used as an independent expected fact.
`film-duration.json` keeps its current check against the film's own
`mtime:size` and is likewise never a duration source (the duration comes from the
real probe).

**The later-stage producer-call witness (DESIGN ONLY, not implemented here).** For
the native GET path (out of this ticket's scope — the pinned producer renders a web
page and needs a page renderer), the trusted witness would be: issued by the Host
**only when the pinned producer is actually invoked**, never by a file on disk;
bound to the issued workspace instance and generation, the request parameters, the
actual three cache files' content digests and the closure that held the
dependencies; lost on a restart or a new workspace instance, where a lost witness
refuses **that instance** (the entry becomes an unpaired derived item) instead of
declaring the whole family permanently unsupported; and never an author source and
never an expected fact. The exact internal interface and files are MAIN's decision.

**Success / refusal behaviour.** A native-decorated working copy becomes readable
again; a forged entry (a stamp that does not match the dependencies' current
`mtime:size`, a dependency that is not retained, a missing `.stamp`) is refused
with its own code, and **nothing is deleted**.

**The real reproduction barrier.** A legitimate triple, built by the test with the
upstream's **own** key and stamp rules over the retained files, is accepted in a
stable round **and** its appearance invalidates the older proof (the R04
"legitimate cache" pattern); a forged triple is refused with its own code and the
files are still there afterwards.

**Verification category / command.** Component: as above.

---

## G05 — the algorithm injection and the real subprocess evidence are separate

**Why the old implementation failed.** `:947` drives the production runner with a
**hand-written** child object with the pid 4242: the "hang" kill emits `close`
itself, the stdout overflow emits 5 MiB, the stderr branch emits **nothing** (the
256 KiB stderr limit is never exercised), and no counter proves that the injected
branch was the one that fired — the version query also runs through the transport
with the same shortened deadline, so a timeout can be attributed to the wrong child.

**The change — the test file only.** The injected children become **real local
subprocesses** of the test (spawned by the test, never a fake object), and they
emit **only a failure** — never a tool answer, and no case may assert a successful
probe from them: one writes more than 4 MiB on stdout, one writes more than 256 KiB
on stderr, one sleeps, one exits abruptly, one is cancelled. The **version query
stays the real fixed `ffprobe`** (the transport lets it through) so it can never
steal the target branch. Each case asserts the **named branch hit** through the
reader's own `childEvents`: the `started` event's argument must be the
`/proc/<pid>/fd/<n>` path of the **media** probe, never `-version`.

**Success / refusal behaviour.** A real child that hangs is killed, **reaped**, and
the refusal is `NATIVE_PROBE_TIMEOUT`; a real child that floods stdout/stderr is
killed and reaped with `NATIVE_PROBE_OUTPUT`; the **input descriptor is still held
when the raw child ends** and is released only after it (the real pid, the exit and
close events, the release events and the promise settle order are the evidence); the
real media success is still the fixed `ffprobe` reading the held parent-PID FD.

**The real reproduction barrier.** The real child's actual pid, exit and close are
observed; the ordering "child exited → input released → the read rejected" is
asserted on the real events.

**Verification category / command.** Component (the real tool children): as above.

---

## G06 — the missing cases add the ORIGINAL discriminating power, no new product

**Why the old implementation failed.** The cases exist but do not discriminate:
the absent-`markers` case never reaches `computeNativeEffectiveSidecars` (the
markers are handed to Expected directly), so it would still pass if the broken
style/transcript negative-lookup branch came back; the source-parent swap leaves a
`video-moved` directory behind, so an earlier membership refusal could be the real
reason; the caption-order case compares `readdir` with the retained names, which
cannot fail if the platform's `readdir` is lexical; the lease cases call
`isLease`/`isNativeFactsLease` instead of substituting a foreign capability into a
real acquisition.

**The change — the test file only.** Each case first asserts that the **target
stage or injection was hit**, then the precise refusal, then that there is no side
effect:

1. an absent **style** and an absent **heard transcript** that the sidecar consumer
   really consumes → the read **succeeds**, and the file's later birth invalidates
   the held proof;
2. an **empty directory alone** born under a held proof;
3. settings/style **added and deleted** variants;
4. a foreign capability consumed through the **actual reader**;
5. owner / base / control / generation / ref changing **before and after a real
   await**;
6. an **isolated** parent/root swap that leaves **no extra file** behind, so the
   membership cannot refuse it early;
7. the raw caption directory order asserted **independently** of the numeric video
   sorting — with a fixture that can actually fail; if the platform's order is
   naturally lexical, that limit is stated honestly and a discriminating consumer
   fixture is prepared rather than a mutation claim.

**Success / refusal behaviour.** Each new case fails if the behaviour it protects
regresses, and passes only when the **precise** stage is reached.

**Verification category / command.** Component + pure, as above.

---

## G07 — the physical isolation: the safe hardlink policy, the empty directories, the instance-wide FD budget

**Why the old implementation failed.** The only inode comparison is between the
source and the working copy at the **same relative path**
(`created-native-source-reader.ts:645-654`), so a workspace leaf hardlinked to an
**external** identical file (a different inode, the same bytes) is accepted; there
is no link-count policy at all; the empty directories of the two trees are not
retained (the enumeration closes its temporary directory descriptors), so the
"independent ownership" claim rests on wrapper objects, not on descriptors; and the
descriptor budget is **per closure** (each closure may hold 8192), so two trees of
one acquisition may hold twice the intended number.

**The change — `src/host/agent-driven/retained-native-closure.ts`.**

1. The membership carries the **link count** (`nlink`, from the bigint `lstat`).
   `retainFile` refuses a **regular file** with `nlink > 1` with its own code
   (`NATIVE_CLOSURE_ALIASED`): a file with more than one link is not a file of this
   tree. **Directories are exempt** — their link count is normally greater than one,
   and the file rule must not be applied to them.
2. The **final guard** re-reads the *current* link count of the path and of the
   retained descriptor, so a hardlink created **after** the issue invalidates the
   proof.
3. An **instance-wide, allocation-counted descriptor budget** replaces the
   per-closure cap as the outer bound:

```ts
/** The instance-wide descriptor budget.
 *
 * It is owned by the Host, not by a closure: the two trees of one acquisition and
 * the parallel proofs of one reader draw from the SAME count. A reservation is
 * taken BEFORE the open and given back on the release; an UNCERTAIN release does
 * NOT give the quota back, because the descriptor may still be open — a quota that
 * is reported as reclaimed while a descriptor is open is a false report. */
export interface RetainedDescriptorBudget{ readonly limit:number; readonly used:number; readonly uncertain:number; }
```

   The per-closure `maxDescriptors` remains as an **additional** cap; the shared
   budget refuses with `NATIVE_CLOSURE_BUDGET` **before** the open. The budget's
   numbers are readable through a Host-private export so a case can hold both trees
   at once and prove the shared count, the rollback on a failed open, and the
   non-reclaim of an uncertain release.

**The change — `created-native-source-reader.ts`.** The alias comparison is widened
from "the same relative path" to **any** path pair that shares an inode; **every**
directory of both trees is retained (so every empty and every nested directory is
held by its own descriptor), and the **nearest negative-fact parent** of each tree
is held independently.

**Success / refusal behaviour.** A hardlinked leaf — same bytes, aliased identity —
is refused at admission and, if the alias appears later, the old proof stops
verifying; the two trees' same-relative-path leaves and their nested/empty
directories are provably two independent allocations; the FD budget is one count
for the instance, not two.

**The real reproduction barrier.** A working-copy leaf replaced by a hardlink to an
**external** identical file is refused; a hardlink created **after** the proof
invalidates it; a hardlink between the two trees under **different** relative paths
is refused; a case holds both trees and a parallel proof at once and reads the
shared budget's count.

**Verification category / command.** Component + pure, as above.

---

## The one round, the gate sequence and the 17 requirements

One release, one round, then ONE recorded sequence: `tsc --noEmit` → the pure gate
(`-t "P0|F01|F10 lists|F10 keeps"`, 18 cases) → the full component gate
(`-t "R0|F02|F03|F04|F05|F06|F07|F08|F09|F10 shows"`, 34 cases) → the legacy
regressions (the three legacy files, 107 cases). Each with a unique capture name,
the ten hashes at the moment of the run, the raw log and its digest, and a cleanup
receipt. Every failing capture is preserved and never re-run under its own name.

The seventeen original ledger requirements are covered by G01–G07 as mapped in
`n1n2-claude-resume-013-results-r01-r07-mapping.md` section 7: items 1–13 and 15
are closed by the seven items above (each with its own barrier), item 14 by the
legacy gate on the final bytes, item 16 by a NEW independent read-only review of the
frozen candidate (MAIN's, never this child's), item 17 by MAIN after acceptance.

**What stays UNPROVEN with a concrete reason (not a waiver).** The pageframe
**frame** family cannot be bound to a clip, because `ms`/`w` are the browser
request's parameters and the upstream's own cache rule does not use them — its
witness is the deps+stamp pairing; binding it to a clip would need a bounded scope
MAIN decides. The **valid-translation consumer** is unreachable from this producer
(it writes one VTT and no translations) — that is a property of this producer, not
of OpenFilm. The **native GET producer-call witness** needs the page renderer and
is out of this ticket's scope; the design is proposed above for MAIN's later
ticket.

**No claim.** Not a completion of N1N2, not an independent review, not a NativeAck,
not a Studio or native-UI readiness, not an A-film result, not a human acceptance.
The candidate must be a real commit with an independent acceptance bound to that
commit; the current report and the test counts are not a final external PASS.

---

# REVISION 1 — MAIN's architecture decisions (append-only; the sections above stay)

MAIN's `msg_fd79d491fa8e` (and the canonical design constraints) change three things.
This revision replaces the corresponding parts of the plan above; everything above is
retained as it was written.

## R1.1 G04 — the deps+stamp witness is REJECTED; the witness must come from the real producer

**Why MAIN is right about the old proposal.** The upstream's own cache-validity rule
is `deps json present AND stampOf(deps) == stamp` (`pageframes.mjs:75-81`). That
rule proves only that the entry is *self-consistent*: anyone who knows the formula
can fabricate a stamp over any deps list — even an empty or an unrelated one — and
the entry would pass. It does not prove that the **fixed upstream producer** ever
produced it. A test that builds a triple from a copied formula is an algorithm
fixture, not producer evidence.

**The new witness: an actual producer/request witness, issued by a guarded
production wrapper.**

*New private module (proposed as a new release path):*
`src/host/agent-driven/native-cache-witness.ts`

```ts
/** The witness of one native cache entry.
 *
 * It is issued ONLY by the guarded wrapper around the FIXED upstream producer, when
 * that producer was really invoked. It binds:
 *  - the issued workspace instance and its generation,
 *  - the request that produced it: rel, ms, the normalized width and the overrides
 *    exactly as the upstream hashed them,
 *  - the key the upstream computes from that request,
 *  - the digests of the three files the producer really wrote,
 *  - the dependency closure the producer read, BEFORE and AFTER the call.
 *
 * It is NOT a persistent authority and NOT a registration hook: it lives in the
 * Host's memory, in the workspace instance that issued it. It is lost with that
 * instance, and a lost witness refuses THAT instance - it never makes the family
 * permanently unsupported, and it never becomes an author source or an expected
 * fact. */
export interface NativeCacheWitness{
 readonly workspace_ref:string;
 readonly generation:number;
 readonly rel:string;
 readonly ms:number;
 readonly width:number;
 readonly overrides_json:string|null;
 readonly key:string;
 readonly jpeg_sha256:string;
 readonly deps_sha256:string;
 readonly stamp_sha256:string;
 readonly dependencies:readonly {readonly path:string;readonly sha256:string;readonly bytes:number;readonly mtime_ms:number}[];
 readonly issued_at:string;
}
```

*The guarded producer wrapper (same module), the single production entry point:*

```ts
/** Produce one native cache entry with the FIXED upstream producer, and witness it.
 *
 * The order is fixed: the dependency state is verified BEFORE the call, the pinned
 * producer is invoked, the dependency state is verified AFTER it, the three files
 * the producer really wrote are read back and hashed, the key is computed with the
 * upstream's own formula over the request, and only then is the witness issued.
 * A producer that did not write the three files, or that changed a dependency
 * while it ran, issues NO witness. */
export async function produceNativePageFrame(request:NativePageFrameRequest):Promise<NativeCacheWitness>;
```

*Precise upstream wrapper addition (outside the ten; MAIN to scope):*
`src/adapters/openfilm/openfilm-upstream.ts` exposes ONE more method of the pinned
module — the pinned producer `pageFrame(root, base, rel, ms, width, overrides)`
(`studio/server/pageframes.mjs:62-71`), imported from the **same pinned tree** whose
full SHA the adapter already verifies (`OPENFILM_PIN.full_sha`). The pin, the
artifact, the vendor tree and the dependencies are **unchanged**: the tree's digest
already commits to that file, and no seam export list, pin field or artifact
changes. The wrapper is a production path, not a test-only registration function.

*The registry (in the ten):* `src/host/agent-driven/created-native-workspace.ts`
holds the witnesses **per issued workspace instance**, keyed by the ref and the
generation — so a witness belongs to exactly one issued view, is lost with it, and
can never be replayed against another one.

*The consumer (in the ten):* `created-native-source-reader.ts` accepts a pageframe
entry **only** when there is a live witness for this workspace instance and
generation whose `key` equals the entry's key, whose `rel` equals the entry's first
dependency, and whose three digests equal the digests of the retained files. No
witness, a witness of another instance, or a witness whose digests do not match →
the entry is refused with its own code, and **nothing is deleted**.

*The poster:* `film-poster.jpg` keeps the upstream's LAST semantics
(`pageframes.mjs:109`, `:124-127`): it is a retained **non-authority** cache. It is
allowed only as the exact paired witnessed producer output, and it is never a
duration proof, never a source proof and never an independent expected fact.

*How the later controlled GET wiring consumes the same port:* the Studio GET route
of a later stage calls `produceNativePageFrame` — the very wrapper the N1N2 cases
call — so the witness is issued by the production path in both stages. N1N2 needs
no public UI integration; what N1N2 must not do is invent a second, test-only
registration path.

**The real reproduction barrier.** A legitimate entry is produced by the **fixed
native producer** on a **diagnostic local page** (a loopback page served by the
test's own local server): the producer really runs, really writes the three files,
and the witness is issued from that call. The negative barriers: (a) a fabricated
triple (a hand-made jpg/json/stamp with a correctly computed key and a computed
stamp) is **refused** — the case that the rejected design would have passed;
(b) a witness of another workspace instance or another generation is refused;
(c) a witness whose triple digests do not match the retained files is refused;
(d) the witnessed entry invalidates the older proof and the next stable round
accepts it.

**The resource reality, stated concretely.** The pinned producer draws a web page
in a headless browser (`studio/server/pageframes.mjs:10-16`, `playwright-core`
`1.61.1` in `packages/openfilm/package.json:59`). On this machine
`playwright-core` is already installed in the pinned tree
(`packages/openfilm/node_modules/playwright-core`) and the chromium builds are
already present (`~/.cache/ms-playwright/chromium-*`, `chromium_headless_shell-*`),
so **no install, no download, no network, no paid service and no J drive** would be
needed. A real producer run is still a **headless browser** and therefore needs a
**fresh MAIN grant**, with the exact argv, cwd, case names and resource class; I
will not start it before that grant.

## R1.2 G07(c) — the descriptor budget is an EXPLICIT pool scoped to ONE reader instance

MAIN's decision, replacing the module-global idea of the plan above: the pool is
**not** a process singleton and **not** a test-mutable global limit.

```ts
/** The descriptor budget of ONE reader instance.
 *
 * It counts every allocation that instance owns: the roots, the ancestries, the
 * temporary directories of the walks and every retained directory and file — of the
 * source tree, of the working copy and of the parallel proofs of that instance. A
 * reservation is taken BEFORE the open and given back ONLY when the release really
 * closed the descriptor: an UNCERTAIN release does NOT return the capacity, because
 * the descriptor may still be open, and a quota reported as reclaimed while a
 * descriptor is open is a false report. */
export interface RetainedDescriptorPool{
 readonly limit:number;
 readonly used:number;
 readonly uncertain:number;
}
```

* `retained-native-closure.ts`: `RetainedNativeClosure.open(root, budget?, ops?,
  pool?)` — the pool is an **optional internal argument**; a closure without a pool
  keeps its own per-closure counter (the additional cap), and a closure with a pool
  draws from the shared one as well.
* `committed-snapshot-authority.ts`: `acquireNativeFacts(projectId, transactionId,
  principalId, pool?)` — the same optional internal argument, so the source closure
  of an acquisition draws from the reader's pool.
* `created-native-source-reader.ts`: the reader creates **one** pool per reader
  instance and passes it to **both** closures (the source one through the
  authority, the working-copy one directly) and to every parallel proof it starts.
  The pool's numbers are readable by the Host's own tests through this private
  module, so a case can hold both trees and a parallel proof at once and read the
  shared count, the rollback after a failed open, and the fact that an uncertain
  release did not return the capacity.
* The refusal is `NATIVE_CLOSURE_BUDGET` **before** the open; an actual OS error
  (EMFILE and friends) still fails closed with the OS error as its cause. **No
  claim that EMFILE is impossible under any OS configuration.**

## R1.3 G01 — aligned, with the negative control kept

The plan above already uses the private, identity-keyed marker
(`retainedCleanupFailures` / `markRetainedCleanupFailures`, a `WeakMap` in
`retained-native-closure.ts`), **not** the presence of `cleanup_errors`: an ordinary
`EIO` cause lives in that array and must not make the reader permanently sticky.
The negative control is part of the plan: an ordinary read failure **without** a
failed release leaves the next read **admitted**; only a genuine release failure
makes the reader uncertain.

## R1.4 The verdict labels of the mapping

Every "PROVED" wording in the mapping document of the results file is a **TARGET**:
the requirements that the consolidated round will close are `TARGET_NOT_RUN`, not
achieved. The only achieved facts are the 012/013 executions on the current bytes.
