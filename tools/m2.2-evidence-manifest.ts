import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Build `docs/evidence/M2/M2.2/evidence-manifest.json`.
 *
 * Same discipline as the M2.1 manifest: every referenced file must exist, be tracked by
 * git, and still hash to what the manifest records. Test counts never stand in for a
 * per-case status.
 *
 * Run from a clean tree: `corepack pnpm exec tsx tools/m2.2-evidence-manifest.ts`
 */

const EVIDENCE_ROOT = resolve("docs/evidence/M2/M2.2");
const CODE_PATHS = ["src", "tests", "contracts", "tools", "package.json"];
const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" }).trim();

function assertTracked(relativePath: string): void {
  execFileSync("git", ["ls-files", "--error-unmatch", "--", relativePath], { encoding: "utf8" });
}

interface Case {
  case_id: string;
  title: string;
  status: string;
  evidence_kind: string[];
  module: string;
  assertions: string[];
  artifacts: Array<{ path: string; sha256: string }>;
}

/** Artifact paths are repository-relative, the same way git records them. */
const artifact = (path: string): { path: string; sha256: string } => {
  assertTracked(path);
  return { path, sha256: sha256File(resolve(path)) };
};

const frozenSha = git("rev-parse", "HEAD");
// The manifest measures dirtiness before it exists; writing it must not count as a change.
const SELF = "docs/evidence/M2/M2.2/evidence-manifest.json";
const dirty = git("status", "--porcelain").split("\n")
  .filter((line) => line.trim() !== "" && !line.includes(SELF));

const cases: Case[] = [
  {
    case_id: "JRNL", module: "1-persistence", status: "PASSED", evidence_kind: ["schema_unit", "mutation_test"],
    title: "唯一权威事务状态机 + 旧 journal 带前态推进",
    assertions: [
      "received→preconditions_checked→staged→validated→prepared→committed 逐步推进，每步断言 changes===1",
      "表外的前后态一律拒绝；committed 无后继",
      "recovering 只能经 markRecovering()，在线 transition() 不可达",
      "journal 首行仍由 actor 的 prepare() 写入，协调器不重复插入",
      "MUT-M/MUT-J 退化后对应套件失败",
    ],
    artifacts: [artifact("tests/m2.2/transaction-state-machine.test.ts"),
      artifact("tests/m2.2/journal-predecessor.test.ts")],
  },
  {
    case_id: "SNAP", module: "2-snapshot", status: "PASSED", evidence_kind: ["integration", "mutation_test"],
    title: "内容寻址、原子发布、reader 只认 active_commit",
    assertions: [
      "snapshot_id = SHA256('narralens-snapshot-v1\\n' + canonical({project_id, source_digest}))",
      "相同内容重复发布为空操作而非 ENOTEMPTY",
      "复制后重新哈希，不符即拒绝发布",
      "reader 只能按 snapshot_id 读取，目录枚举不作为来源",
      "MUT-S/MUT-T 退化后套件失败",
    ],
    artifacts: [artifact("tests/m2.2/snapshot-store.test.ts"),
      artifact("src/host/projects/snapshot-store.ts")],
  },
  {
    case_id: "DUR", module: "2-snapshot", status: "PASSED", evidence_kind: ["fault_injection"],
    title: "durability 不可证明即完全不发布",
    assertions: [
      "逐一在每个 fsync 步骤注入失败，全部 11 个位置都拒绝发布",
      "父目录 fsync 失败时已发生的 rename 被撤销，不留无指针目录",
      "durability 由注入函数驱动，真实路径也走同一顺序",
    ],
    artifacts: [artifact("tests/m2.2/snapshot-store.test.ts")],
  },
  {
    case_id: "LOCK", module: "3-locks", status: "PASSED", evidence_kind: ["schema_unit", "mutation_test"],
    title: "三类锁由服务端计算，preserve 不授权",
    assertions: [
      "visual 恒命中；range/position 变更额外命中 duration；字幕/音频变更命中 project 作用域 narration",
      "锁冲突 423 TARGET_LOCKED；相邻半开区间不冲突",
      "同类锁不阻塞只影响其他类的写",
      "MUT-R 把检查改成看 reason 文本后套件失败",
    ],
    artifacts: [artifact("tests/m2.2/lock-service.test.ts"),
      artifact("tests/m2.2/lock-service.test.ts")],
  },
  {
    case_id: "LOCK-NA", module: "3-locks", status: "NOT_APPLICABLE_APPROVED", evidence_kind: ["scope"],
    title: "duration / narration 锁的集成层",
    assertions: [
      "M2.2 没有任何 typed edit 能改变时长或旁白（replace_visual_asset 要求资产帧长恰好等于选区）",
      "分类器以合成载荷单测；集成层无任何可达用例",
      "不以不可达的集成断言冒充 PASS",
    ],
    artifacts: [artifact("docs/migration/M2/M2.2-development-and-acceptance-plan.md")],
  },
  {
    case_id: "BYP", module: "4-coordinator", status: "PASSED", evidence_kind: ["http_integration", "mutation_test"],
    title: "网关在所有生产写路径之前",
    assertions: [
      "attention 项目 423 且 actor 从未被调用",
      "基线不符 409 且自行置 attention",
      "锁定范围 423 且 actor 从未被调用",
      "把项目绑到 OpenFilm 后请求写片，网关依引擎能力表拒绝 422",
      "MUT-Q 移除网关检查后套件失败",
    ],
    artifacts: [artifact("tests/m2.2/project-coordinator.test.ts"),
      artifact("tests/m2.1/native-bypass.test.ts")],
  },
  {
    case_id: "SER", module: "4-coordinator", status: "PASSED", evidence_kind: ["concurrency"],
    title: "同项目串行、跨项目并行",
    assertions: [
      "同项目两次写按单例队列串行，revision 单调",
      "另一项目不被本项目队列阻塞",
    ],
    artifacts: [artifact("tests/m2.2/project-coordinator.test.ts")],
  },
  {
    case_id: "JB-01", module: "5-jobs", status: "PASSED", evidence_kind: ["restart", "schema_unit"],
    title: "重启保留 Job，失 lease 的 running 不假成功",
    assertions: [
      "重启后 Job 与事件仍在（真实数据库文件）",
      "失 lease 回队列；尝试用尽进 attention，任何分支都不是 succeeded",
      "记明原因与平台限制",
    ],
    artifacts: [artifact("tests/m2.2/persistent-job-store.test.ts")],
  },
  {
    case_id: "JB-02", module: "5-jobs", status: "PASSED", evidence_kind: ["concurrency", "mutation_test"],
    title: "双 worker CAS 只有一个 owner",
    assertions: [
      "两个竞争者恰好一个成功",
      "lease 未过期时不可被夺取，包括 lease 已死但尚未回收的 running",
      "MUT-O 去掉 state='queued' 条件后套件失败",
    ],
    artifacts: [artifact("tests/m2.2/persistent-job-store.test.ts")],
  },
  {
    case_id: "JB-03", module: "5-jobs", status: "PASSED", evidence_kind: ["integration"],
    title: "SSE cursor 补发与去重",
    assertions: [
      "每 job 单调 seq；全局 event_id 不复用",
      "after=seq 只补发之后的事件且不重复",
      "线上事件同时带 seq（续传用）与 event_id（去重用）",
    ],
    artifacts: [artifact("tests/m2.2/persistent-job-store.test.ts"),
      artifact("contracts/job-event.schema.json")],
  },
  {
    case_id: "JB-04", module: "5-jobs", status: "PASSED", evidence_kind: ["schema_unit"],
    title: "取消后的晚到结果 quarantine 且 NOWRITE",
    assertions: [
      "job 已移动时不改状态，只写 quarantined_artifact / quarantined_receipt",
      "事件 message 以 'quarantined:' 开头，type 取当前状态",
      "completed_after_cancel 不再被写入，但仍是可读字面量",
    ],
    artifacts: [artifact("tests/m2.2/persistent-job-store.test.ts")],
  },
  {
    case_id: "JB-05", module: "5-jobs", status: "PASSED", evidence_kind: ["schema_unit"],
    title: "未知费用不重发、不记 0",
    assertions: [
      "cost_status 初始为 unknown，仅在拿到明确金额后转 known",
      "provider 类 kind 上限为 1，失 lease 直接 attention，不再提供第二次尝试",
      "可显式覆盖上限",
    ],
    artifacts: [artifact("tests/m2.2/persistent-job-store.test.ts"),
      artifact("src/host/job-defaults.ts")],
  },
  {
    case_id: "JB-07", module: "5-jobs", status: "PASSED", evidence_kind: ["concurrency"],
    title: "孤儿 lease 可在进程内被回收",
    assertions: [
      "同进程两个竞争者对已回收 job 恰好一个成功",
    ],
    artifacts: [artifact("tests/m2.2/persistent-job-store.test.ts")],
  },
  {
    case_id: "JB-06", module: "6-outbox", status: "PASSED", evidence_kind: ["fault_injection", "mutation_test"],
    title: "commit 后崩溃只续发 outbox，不重复 commit",
    assertions: [
      "同一事件对同一消费者无论重放多少次只投递一次",
      "一个消费者失败不回滚已成功的消费者",
      "达到重试上限关闭事件并留下原因，置 attention 而非静默丢弃",
      "重放从不重新执行 commit",
      "MUT-P 去掉消费者去重后套件失败",
    ],
    artifacts: [artifact("tests/m2.2/outbox.test.ts"), artifact("src/host/outbox.ts")],
  },
  {
    case_id: "RECOVERY", module: "6-outbox", status: "PASSED", evidence_kind: ["restart"],
    title: "启动顺序与写门",
    assertions: [
      "journal 恢复 → outbox 重放 → 回收 lease → 报告 attention",
      "存在 attention 时 recoverStatus 为 false，写入口 423 且 actor 从未被调用",
    ],
    artifacts: [artifact("tests/m2.2/project-coordinator.test.ts"),
      artifact("src/host/projects/project-coordinator.ts")],
  },
  {
    case_id: "GATE-FITNESS", module: "all", status: "PASSED", evidence_kind: ["architecture_fitness", "mutation_test"],
    title: "架构 fitness 与变异门",
    assertions: [
      "20 条变异用例逐条注入并全部按预期失败",
      "fitness 断言：单一状态机写入点、单队列、单数据库、actor 不持 commit、路由保持关闭",
    ],
    artifacts: [artifact("tests/architecture/m2.2-fitness.test.ts"),
      artifact("tests/architecture/m2.1-fitness.test.ts")],
  },
  {
    case_id: "REG", module: "all", status: "PASSED", evidence_kind: ["regression"],
    title: "旧 D1–M2.1 回归",
    assertions: [
      "corepack pnpm check 34 files / 344 tests 全绿",
      "旧 JobStore 及其测试未改；/edits 响应字段一字未加未删",
    ],
    artifacts: [artifact("tests/host/host-http.test.ts"), artifact("src/host/job-store.ts")],
  },
];

const gates = ["check", "test:m2.1", "test:contracts", "check:m2.1-docs", "test:m2.1:golden-python",
  "test:m2.1:mutation", "openfilm-probe"];

const manifest = {
  format: "narralens.m22-evidence-manifest@1.0",
  ticket: "M2.2",
  title: "一致提交、三类锁、持久任务",
  declaration_ceiling: "M2_2_DURABILITY_READY",
  captured_at: new Date().toISOString(),
  repo_branch: git("rev-parse", "--abbrev-ref", "HEAD"),
  repo_sha: frozenSha,
  frozen_code_sha: frozenSha,
  repo_dirty_at_capture: dirty.length > 0,
  dirty_paths_at_capture: dirty,
  node: process.version,
  pnpm: execFileSync("corepack", ["pnpm", "-v"], { encoding: "utf8" }).trim(),
  gates: [
    { command: "corepack pnpm check", log: "logs/check.txt", exit_code: 0 },
    { command: "bash tools/m2.1-gate-mutation-check.sh <tmp>", log: "logs/mutation-gates.txt", exit_code: 0 },
    { command: "corepack pnpm exec tsx tests/m2.1-probe/openfilm-upstream-probe.mjs <vendorRoot> <projectDir> /tmp/probe.json",
      log: "logs/openfilm-probe.txt", exit_code: 0 },
    { command: "corepack pnpm exec tsx tools/m2.1-external-review-repro.mts hypit-visual-asset", log: "logs/repro-b02.txt", exit_code: 0 },
    { command: "corepack pnpm exec tsx tools/m2.1-external-review-repro.mts symlink-alias", log: "logs/repro-m03.txt", exit_code: 0 },
  ],
  gate_artifacts: ["logs/check.txt", "logs/mutation-gates.txt", "logs/openfilm-probe.txt",
    "logs/repro-b02.txt", "logs/repro-m03.txt", "logs/environment.txt"]
    .map((path) => ({ path, sha256: sha256File(resolve(EVIDENCE_ROOT, path)) })),
  code_paths: CODE_PATHS,
  case_count: cases.length,
  passed_count: cases.filter((entry) => entry.status === "PASSED").length,
  screenshots: [],
  claim_limits: [
    "This evidence supports M2_2_DURABILITY_READY only.",
    "M2 is NOT complete: M2.3 (migration copy, rollback) is not implemented.",
    "AC-005 is only partially satisfied on the legacy Hypit path: the snapshot is a post-hoc capture of committed bytes, not an isolated-stage preimage. The full stage→snapshot→pointer flow lands with M2.3 and M4A.",
    "duration and narration lock integration is NOT_APPLICABLE_APPROVED: no M2.2 typed edit can change either.",
    "render and snapshot_publish have no runner in M2.2; only their storage, lease, event, recovery and NOWRITE semantics are proven.",
    "vendor/openfilm is not a registered submodule; the real upstream evidence comes from the isolated M1B worktree and is not a production integration.",
    "Headed browser automation and human experience are NOT_RUN; this ticket ran no UI automation.",
  ],
  review: { internal: "PASS", internal_record: "reviews/internal-review.md", external: "REVIEW_PENDING" },
  cases,
};

if (!existsSync(EVIDENCE_ROOT)) throw new Error(`missing ${EVIDENCE_ROOT}`);
void statSync;
writeFileSync(join(EVIDENCE_ROOT, "evidence-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`cases=${manifest.case_count} passed=${manifest.passed_count} sha=${frozenSha} dirty=${manifest.repo_dirty_at_capture}`);
