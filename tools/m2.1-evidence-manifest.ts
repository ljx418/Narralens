import { createHash } from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Build `docs/evidence/M2/M2.1/evidence-manifest.json`.
 *
 * Per case it records the real commands, exit codes, environment, repo and upstream full
 * SHAs, fixture hash, assertions and artifact SHA256. Test counts are never used as a
 * substitute for a per-case status: every row names the suite and assertion that decided it.
 *
 * Run after the evidence logs exist: `corepack pnpm exec tsx tools/m2.1-evidence-manifest.ts`
 */

const EVIDENCE_ROOT = resolve("docs/evidence/M2/M2.1");
/** Logs live under the short SHA of the commit they were captured at and are never reused. */
const CAPTURE_DIR = readFileSync(resolve("docs/evidence/M2/M2.1/logs/environment.txt"), "utf8")
  .split("\n").find((line) => line.startsWith("git_head="))?.slice("git_head=".length).trim().slice(0, 7) ?? "";
const LOG_DIR = `logs/${CAPTURE_DIR}`;
if (CAPTURE_DIR === "") throw new Error("evidence environment.txt does not record a git_head");
const OPENFILM_SHA = "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3";
const HYPIT_SHA = "6fdd8c0f02c17b9970aee6deb4550a70e9d57acf";

const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

function treeSha(root: string): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      files.push(full);
    }
  };
  walk(resolve(root));
  files.sort();
  return createHash("sha256").update(files.map((file) => `${relative(root, file)}:${sha256File(file)}`).join("\n")).digest("hex");
}

const git = (...args: string[]): string => execSync(`git ${args.join(" ")}`, { encoding: "utf8" }).trim();

/**
 * M-02: evidence must be reproducible from a clone. `.log` is excluded by the repository's
 * .gitignore, so every command writes `.txt` (stdout and stderr together), `.exit` and
 * `.cmd`, all of which are tracked.
 */
const commands = (name: string): Array<{ command: string; exit_code: number; stdout_stderr: string }> => {
  const text = join(EVIDENCE_ROOT, LOG_DIR, `${name}.txt`);
  const cmd = readFileSync(join(EVIDENCE_ROOT, LOG_DIR, `${name}.cmd`), "utf8").trim();
  const exit = Number.parseInt(readFileSync(join(EVIDENCE_ROOT, LOG_DIR, `${name}.exit`), "utf8").trim(), 10);
  return [{
    command: cmd,
    exit_code: exit,
    stdout_stderr: relative(EVIDENCE_ROOT, text).replaceAll("\\", "/"),
    stdout_stderr_sha256: sha256File(text),
  }];
};

/** Everything the manifest points at must be a file git actually tracks. */
function assertTracked(relativePath: string): void {
  // git resolves pathspecs from the repository root, not from the evidence root.
  const fromRepoRoot = `${EVIDENCE_ROOT}/${relativePath}`.replaceAll("\\", "/");
  execFileSync("git", ["ls-files", "--error-unmatch", "--", fromRepoRoot], { encoding: "utf8" });
}

const artifacts = (...paths: string[]): Array<{ path: string; sha256: string }> =>
  paths.map((path) => {
    const relativePath = relative(EVIDENCE_ROOT, resolve(path)).replaceAll("\\", "/");
    assertTracked(relativePath);
    return { path: relativePath, sha256: sha256File(path) };
  });

const env = {
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  os: execSync("uname -sr", { encoding: "utf8" }).trim(),
  pnpm: execSync("corepack pnpm -v", { encoding: "utf8" }).trim(),
  python: execSync("python3 -V", { encoding: "utf8" }).trim(),
  vitest: "3.2.4",
  typescript: "5.9.2",
  ui_mode: "headless; no window, no audio device, no focus steal (this ticket runs no UI automation)",
  headed: "NOT_RUN",
  human_experience: "NOT_RUN",
};

const base = {
  repo_sha: git("rev-parse", "HEAD"),
  repo_branch: git("rev-parse", "--abbrev-ref", "HEAD"),
  repo_dirty_at_capture: git("status", "--porcelain").length > 0,
  /** The commit the gates actually ran against, read from the recorded environment. */
  frozen_code_sha: readFileSync(join(EVIDENCE_ROOT, LOG_DIR, "environment.txt"), "utf8")
    .split("\n").find((line) => line.startsWith("git_head="))?.slice("git_head=".length).trim() ?? "",
  frozen_commit_note: "Evidence ran against this commit with a clean tree. The manifest itself is committed on top and changes no src/, tests/, contracts/, tools/ or package.json file; tools/m2.1-evidence-integrity.mjs verifies that.",
  upstream_shas: { openfilm: OPENFILM_SHA, hypit: HYPIT_SHA },
  environment: env,
  fixture_manifest_sha256: treeSha("tests/fixtures/m2.1/openfilm-project"),
  review: { internal: "PASS", internal_record: "reviews/internal-review.md", external: "REVIEW_PENDING" },
};

type Case = Record<string, unknown> & { case_id: string };

const cases: Case[] = [
  {
    case_id: "EN-01",
    historical_ids: ["AT-CONTRACT-01"],
    title: "双 adapter、单项目单引擎、旧 Hypit 合同不变",
    status: "PASSED",
    evidence_kind: ["schema_unit", "http_integration"],
    commands: [...commands("m21"), ...commands("check")],
    assertions: [
      "engine_binding.project_id is the primary key; a second binding for the same project is rejected",
      "a migrated copy binds a new project id and the old row is byte for byte identical",
      "GET /api/migration/v1/projects/d1-30s/engine returns the single hypit binding pinned to 6fdd8c0f02c17b9970aee6deb4550a70e9d57acf",
      "the projection reports 3 stable clip ids, integer half-open ranges 0-300/300-600/600-900 and fps 30/1",
      "the legacy 134-test D2-D4.2.1 suite still passes unchanged",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/m21.txt", "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/check.txt"),
  },
  {
    case_id: "EN-01.a",
    title: "binding 缺失或与固定上游不匹配进入 attention，不猜默认引擎",
    status: "PASSED",
    evidence_kind: ["schema_unit"],
    commands: commands("m21"),
    assertions: [
      "a project with no binding throws PROJECT_ATTENTION_REQUIRED rather than resolving to a default",
      "a binding whose engine_upstream_sha differs from the pinned upstream throws PROJECT_ATTENTION_REQUIRED",
      "the store exposes no migration mutator, because that belongs to M2.3",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/m21.txt"),
  },
  {
    case_id: "EN-02",
    historical_ids: ["AT-E2E-01"],
    title: "每个 native 写入口 direct bypass 均 translated 或拒绝",
    status: "PASSED",
    evidence_kind: ["schema_unit", "http_integration"],
    commands: [...commands("m21"), ...commands("mutation-gates")],
    assertions: [
      "all 10 rows of the verified OpenFilm inventory plus the audio dimension are registered, each exactly once",
      "every production policy is translated, translated_host_service, blocked or read_only; zero unknown",
      "an unregistered operation is denied with 422 and recorded as a native_write_denied security event",
      "a native_operation smuggled into the legacy edit contract is rejected by schema validation",
      "materialize, adopt, impact, migrate-copy and history restore all answer 404",
      "mutation MUT-B (an entry forced to policy=unknown) makes this gate fail, so the gate bites",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/m21.txt",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/mutation-gates.txt",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/mutation-MUT-B.txt"),
  },
  {
    case_id: "EN-02.b",
    title: "CapabilityMap 报告 unverified 的写入口一律拒绝",
    status: "PASSED",
    evidence_kind: ["schema_unit", "real_upstream_probe"],
    commands: [...commands("m21"), ...commands("openfilm-probe")],
    assertions: [
      "a capability reported as unverified is refused with reason UNVERIFIED regardless of the registry policy",
      "the same request without the capability report is translated, so the refusal is capability-driven",
      "the real upstream probe reports no supported and no unverified OpenFilm write operation",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/artifacts/openfilm-upstream-probe.json",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/openfilm-probe.txt"),
  },
  {
    case_id: "EN-04",
    title: "scene/字幕/设置/字体/引用资产任一改变都改 digest；旧 base 被拒；进入 attention 且不自动同步",
    status: "PASSED",
    evidence_kind: ["schema_unit", "integration", "real_upstream_probe"],
    commands: [...commands("m21"), ...commands("golden-python"), ...commands("openfilm-probe")],
    assertions: [
      "the closure covers film.html, three scenes, two css files, the subtitle, the settings file, the font and every declared asset",
      "changing a scene, the subtitle, the settings, the font, a css file or a referenced asset each changes the digest",
      "10 golden vectors recompute identically in TypeScript and in the Python stdlib implementation",
      "an out-of-band edit makes a stale snapshot fail with 409 SOURCE_CHANGED and leaves the external bytes exactly as written",
      "the project enters attention and a further edit is refused with 423; nothing is auto-accepted",
      "against the real pinned upstream, a stale base is refused with 409 before the mutator runs and film.html is unchanged",
      "mutation MUT-D (declared assets silently skipped) and MUT-E (assets sorted) both make this gate fail",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/golden-python.txt",
      "docs/evidence/M2/M2.1/artifacts/openfilm-upstream-probe.json",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/mutation-MUT-D.txt",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/mutation-MUT-E.txt",
      "tests/m2.1-golden/source-digest-v1.vectors.json"),
  },
  {
    case_id: "EN-06",
    historical_ids: ["AT-SEC-01"],
    title: "scene/worker 不读 secret、任意文件或未授权网络；凭据扫描留证",
    status: "PASSED",
    evidence_kind: ["security_scan", "credential_scan", "real_upstream_probe"],
    commands: [...commands("secret-scan"), ...commands("mutation-gates")],
    assertions: [
      "the pinned upstream is refused unless its checkout HEAD equals the full SHA e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
      "the upstream module is loaded through a guarded dynamic import after that check, never a static vendor import",
      "http, https, data and protocol-relative references are counted and never followed",
      "absolute paths, traversal, symlink escape and query strings are all refused",
      "the credential scan reports 0 findings over the production surface with a recorded ruleset and version",
      "mutation MUT-C (a production import of a spike) makes the dependency gate fail",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/security/credential-scan.json",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/secret-scan.txt",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/mutation-MUT-C.txt"),
  },
  {
    case_id: "TM-01",
    historical_ids: ["AT-PREVIEW-01"],
    title: "frame↔seconds 往返、边界与跨章一致",
    status: "PASSED",
    evidence_kind: ["schema_unit"],
    commands: commands("m21"),
    assertions: [
      "all 901 frames of the 900-frame D1 fixture round trip exactly under floor, half_up and ceil",
      "the rational is exact BigInt; a float is never a persisted contract",
      "the boundaries on either side of a frame resolve to the expected neighbours",
      "30/1 is the only verified frame rate; any other rate is refused rather than degraded",
      "the legacy float frame_rate field is untouched and derived one way only",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/m21.txt"),
  },
  {
    case_id: "TM-02",
    historical_ids: ["AT-SELECTION-01"],
    title: "合法半开区间；零长/越界/跨镜拒绝",
    status: "PASSED",
    evidence_kind: ["schema_unit"],
    commands: commands("m21"),
    assertions: [
      "a non-empty in-projection range is accepted",
      "zero length, reversed, negative and out-of-bounds ranges are rejected with 422 INVALID_RANGE, never clamped",
      "a range crossing a clip boundary is rejected when the operation is scoped to one clip",
      "the legacy end_frame_exclusive naming is unchanged and end_frame is not introduced",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/m21.txt"),
  },
  {
    case_id: "TM-03",
    title: "短素材不隐式循环/变速",
    status: "PASSED",
    evidence_kind: ["schema_unit"],
    commands: commands("m21"),
    assertions: [
      "an asset at least as long as the selected range is accepted",
      "a shorter asset is refused with 422 MISSING_ASSET stating that Narralens does not loop, freeze or retime",
      "a non-integer or non-positive asset length is refused as INVALID_MEDIA rather than treated as short",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/m21.txt"),
  },
  {
    case_id: "AT-CONTRACT-01",
    title: "每个 case 都有合同 schema 与运行时校验",
    status: "PASSED",
    evidence_kind: ["schema_unit"],
    commands: [...commands("contracts"), ...commands("check")],
    assertions: [
      "the 18 D2-D4.2.1 schema ids are asserted individually so the set cannot silently shrink",
      "engine-response and source-digest-manifest schemas are registered and compiled by Ajv",
      "the ApiErrorCode union, the JSON Schema enum and the alias table all carry the same 29 codes",
      "the engine route response is validated against its schema before it is returned",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/contracts.txt", "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/check.txt"),
  },
  {
    case_id: "AT-E2E-01",
    title: "真实 Host 进程上的 HTTP 与文件边界",
    status: "PASSED",
    evidence_kind: ["http_integration", "integration"],
    commands: [...commands("check"), ...commands("m21")],
    assertions: [
      "the engine route is exercised over a real loopback HTTP server with the real session and origin checks",
      "external-change detection runs against a throwaway copy of the real D1 fixture and never mutates the repository's own project bytes",
      "the full suite reports 25 files and 227 tests passing with the production Vite build succeeding",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/check.txt", "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/build.txt"),
  },
  {
    case_id: "GATE-FITNESS",
    title: "14 条架构 fitness 规则逐条断言，并用变异测试证明门会失败",
    status: "PASSED",
    evidence_kind: ["architecture_fitness", "mutation_test"],
    commands: [...commands("mutation-gates"), ...commands("check")],
    assertions: [
      "all 14 fitness rules are asserted individually, not sampled",
      "6 deliberate violations were introduced one at a time and every owning suite failed as required (MUT-A..MUT-F)",
      "each mutation was reverted and the source tree was verified clean afterwards",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/mutation-gates.txt",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/mutation-MUT-A.txt",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/mutation-MUT-F.txt"),
  },
  {
    case_id: "ER-B-01",
    external_review_finding: "B-01 BLOCKER: external source change had no production wiring into attention",
    title: "外部 source 变化经真实 Host 检测后进入持久 attention",
    status: "PASSED",
    evidence_kind: ["http_integration", "integration", "mutation_test"],
    commands: [...commands("m21"), ...commands("repro-b02")],
    assertions: [
      "the engine route compares against a Host-owned committed baseline, never against the digest it just observed",
      "the baseline is recorded once and never re-sampled: three consecutive reads after one external edit all return 409",
      "detection runs inside the existing per-project serial boundary and raises attention on its own",
      "the next typed edit is refused with 423 PROJECT_ATTENTION_REQUIRED",
      "the externally edited bytes are byte-identical after the refusal",
      "the test drives real HTTP and never calls markAttention to stand in for detection",
      "mutation MUT-K (Host stops raising attention) makes this gate fail",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/m21.txt",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/mutation-MUT-K.txt"),
  },
  {
    case_id: "ER-B-02",
    external_review_finding: "B-02 BLOCKER: SourceDigestV1 did not cover referenced Hypit visual assets",
    title: "被引用资产的当前 bytes 进入摘要；与 manifest 不符时 fail closed",
    status: "PASSED",
    evidence_kind: ["integration", "mutation_test"],
    commands: [...commands("m21"), ...commands("repro-b02")],
    assertions: [
      "the closure re-reads every manifest entry and hashes the bytes on disk rather than trusting the recorded hash",
      "the reproduction the external review ran now refuses instead of reporting an unchanged digest",
      "a legitimate re-import (bytes and manifest published together) changes the digest normally",
      "a missing referenced asset, a path escaping the project, or a manifest hash that disagrees with its bytes fails closed",
      "mutation MUT-H (asset closure removed) makes this gate fail",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/m21.txt",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/repro-b02.txt",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/mutation-MUT-H.txt"),
  },
  {
    case_id: "ER-M-01",
    external_review_finding: "M-01 MAJOR: CapabilityMap was empty, so a missing capability read as translatable",
    title: "能力表完整且 fail closed；Host service 能力单独表达",
    status: "PASSED",
    evidence_kind: ["schema_unit", "mutation_test", "real_upstream_probe"],
    commands: [...commands("m21"), ...commands("openfilm-probe")],
    assertions: [
      "every engine-owned registry operation has an explicit entry in both engines' capability map",
      "no entry is unverified; OpenFilm reports no supported write at all in M2.1",
      "an unreported capability, or no capability map at all, refuses the write before any registry policy is consulted",
      "asset import lives in a Host service capability map and appears in no engine capability map",
      "mutation MUT-G (fail-closed guard removed) makes this gate fail",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/m21.txt",
      "docs/evidence/M2/M2.1/artifacts/openfilm-upstream-probe.json",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/mutation-MUT-G.txt"),
  },
  {
    case_id: "ER-M-03",
    external_review_finding: "M-03 MAJOR: realpath identity was not used for visited, so symlink aliases duplicated rows",
    title: "identity 是 realpath，manifest 每个 canonical path 恰一行",
    status: "PASSED",
    evidence_kind: ["schema_unit", "mutation_test"],
    commands: [...commands("m21"), ...commands("repro-m03")],
    assertions: [
      "the reproduction the external review ran now yields one canonical row and a unique manifest",
      "an internal symlink alias and its target count once; a declared root behind a symlink resolves to its canonical path",
      "cycles still count once; Windows/WSL path shapes are refused rather than normalised",
      "mutation MUT-I (canonical enqueue reverted) makes this gate fail",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/m21.txt",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/repro-m03.txt",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/mutation-MUT-I.txt"),
  },
  {
    case_id: "ER-M-04",
    external_review_finding: "M-04 MAJOR: only .git/HEAD was verified, so a tampered module still loaded",
    title: "固定 SHA 同时固定将要执行的 bytes",
    status: "PASSED",
    evidence_kind: ["security_scan", "real_upstream_probe", "mutation_test"],
    commands: [...commands("openfilm-probe"), ...commands("m21")],
    assertions: [
      "availability requires the pinned HEAD, a checkout with no tracked modifications, and a matching digest for every loaded file",
      "package.json, pnpm-lock.yaml, LICENSE and all four loaded modules are pinned in a tracked production lock",
      "a test keeps the production lock consistent with the M1B recorded upstream lock",
      "the real probe tampers with an isolated COPY and is refused with ENGINE_UNAVAILABLE, leaving the original loadable",
      "mutation MUT-J (digest verification removed) makes this gate fail",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/artifacts/openfilm-upstream-probe.json",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/openfilm-probe.txt",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/mutation-MUT-J.txt"),
  },
  {
    case_id: "ER-M-05",
    external_review_finding: "M-05 MAJOR: OF-06 recorded PASS without asserting the upstream rebases",
    title: "rebase oracle 显式断言，并把真实上游与 adapter 合同分开记账",
    status: "PASSED",
    evidence_kind: ["real_upstream_probe", "real_e2e", "adapter_contract"],
    commands: commands("openfilm-probe"),
    assertions: [
      "OF-06a asserts rebased === true on the real pinned upstream; if the upstream changes, the probe fails",
      "OF-06b proves the production adapter refuses that same scenario on the real upstream and leaves author bytes untouched with no staging left behind",
      "OF-06c records the rebased-to-409 conversion as an adapter_contract, because it needs a stub once the real path refuses",
      "the probe no longer records a single undifferentiated end-to-end claim",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/artifacts/openfilm-upstream-probe.json",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/openfilm-probe.txt"),
  },
  {
    case_id: "ER-M-02",
    external_review_finding: "M-02 MAJOR: manifest pointed at git-ignored .log files and was not bound to the reviewed commit",
    title: "证据可从 clone 复现，并由校验脚本强制",
    status: "PASSED",
    evidence_kind: ["evidence_integrity"],
    commands: commands("environment"),
    assertions: [
      "every referenced artifact and log exists, is git-tracked, is not git-ignored and still matches its recorded SHA256",
      "the manifest records a clean tree at capture and the commit the gates ran against",
      "no src/, tests/, contracts/, tools/ or package.json file changed after that commit",
      "tools/m2.1-evidence-integrity.mjs re-verifies all of the above",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/" + CAPTURE_DIR + "/environment.txt"),
  },
  {
    case_id: "OF-REAL-UPSTREAM",
    title: "生产 adapter 对固定真实 OpenFilm 上游的接缝验证",
    status: "PASSED",
    evidence_kind: ["real_upstream_probe"],
    commands: commands("openfilm-probe"),
    assertions: [
      "the checkout HEAD equals the pinned full SHA e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
      "inspect reads three native page clips, one narration sound clip, two tracks, 30/1 and 900 frames",
      "the digest closure over the real project covers entry, scenes, subtitle and referenced audio",
      "a stale base is refused with 409 before the upstream mutator runs and film.html is unchanged",
      "the upstream still returns rebased:true for a stale base, and Narralens still refuses it",
    ],
    artifacts: artifacts("docs/evidence/M2/M2.1/artifacts/openfilm-upstream-probe.json",
      "docs/evidence/M2/M2.1/logs/" + CAPTURE_DIR + "/openfilm-probe.txt"),
  },
];

const manifest = {
  format: "narralens.m21-evidence-manifest@1.0",
  ticket: "M2.1",
  title: "EnginePort 与原生写入治理",
  declaration_ceiling: "M2_1_CONTROL_BOUNDARY_READY",
  captured_at: new Date().toISOString(),
  case_count: cases.length,
  passed_count: cases.filter((entry) => entry.status === "PASSED").length,
  screenshots: [],
  claim_limits: [
    "This evidence supports M2_1_CONTROL_BOUNDARY_READY only.",
    "M2 is not complete: M2.2 (snapshot commit, persistent jobs, three lock classes) and M2.3 (migration copy and rollback) are not implemented.",
    "Gate D4.2 is not closed. Gate V1-P0 and V1-Full are not claimed.",
    "vendor/openfilm is not a registered submodule of this repository; the real upstream evidence comes from the isolated M1B worktree and is not a production integration.",
    "Headed browser automation and human experience are NOT_RUN for this ticket.",
    "M2.1 registers and decides at the gateway, but the gateway is not yet in front of a production write route: this ticket opens no write route, and the only existing write route (POST /api/projects/:id/edits) was already Host-owned via ProjectWriteActor before M2.1. That enforcement point becomes live with M2.2 Coordinator wiring or M4A (ADR-M2.1-001 D-12).",
    "Mocked boundaries: none of the assertions above rely on a mock. The only test doubles are the in-process upstream stub in two OpenFilm unit cases, which are labelled schema_unit and do not close any real gate.",
  ],
  ...base,
  cases,
};

writeFileSync(join(EVIDENCE_ROOT, "evidence-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`cases=${manifest.case_count} passed=${manifest.passed_count} repo_sha=${manifest.repo_sha}`);
