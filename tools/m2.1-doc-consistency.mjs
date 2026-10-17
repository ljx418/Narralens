import { readFileSync } from "node:fs";

const architecture = readFileSync("docs/03_Architecture.md", "utf8");
const traceability = readFileSync("docs/11_V1_Traceability.md", "utf8");
const manifest = JSON.parse(readFileSync("docs/evidence/M2/M2.1/evidence-manifest.json", "utf8"));
const marker = /M2\.1_REWORK_BASE_SHA=([a-f0-9]{40}) REVIEW_STATUS=([A-Z_]+)/gu;

const marks = [architecture, traceability].map((document) => [...document.matchAll(marker)]);
if (marks.some((matches) => matches.length !== 1)) throw new Error("M2.1 current-state marker must appear exactly once in each authority document");
const [[architectureMark], [traceabilityMark]] = marks;
if (architectureMark[1] !== traceabilityMark[1] || architectureMark[2] !== traceabilityMark[2]) {
  throw new Error("M2.1 architecture and traceability current-state markers disagree");
}
if (manifest.review.external !== architectureMark[2]) throw new Error("M2.1 manifest review status disagrees with authority documents");
if (manifest.review.rework_implementation_sha !== architectureMark[1]) throw new Error("M2.1 manifest rework SHA disagrees with authority documents");

const staleCurrentClaims = [
  "CapabilityMap 为空",
  "外部变化检测尚未从生产路径持久进入 attention",
  "Hypit 视觉资产 bytes 未进入闭包",
  "realpath alias 会重复 canonical path",
  "加载器只验 HEAD",
  "OF-06 oracle 需修复",
];
for (const claim of staleCurrentClaims) {
  if (architecture.includes(claim)) throw new Error(`stale M2.1 architecture claim remains: ${claim}`);
}

console.log(`PASS M2.1 docs agree: rework=${architectureMark[1]} review=${architectureMark[2]}`);
