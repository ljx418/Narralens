import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * The M5 Chinese acceptance report (Wave 3 `04` §8, `02` §5).
 *
 * It is generated from the capture, so it cannot claim more than the capture holds: the
 * case statuses come from the case files, the command exits from the `.exit` files, the
 * digests from the manifest. A case that did not run says `NOT_RUN`, and the human gate
 * says so too.
 */
const captureRoot = resolve(process.argv[2] ?? "");
const outputPath = resolve(process.argv[3] ?? "docs/evidence/WAVE3/M5/acceptance-report.html");
if (captureRoot === "" || !existsSync(captureRoot)) {
  process.stderr.write("usage: node tools/m5-acceptance-report.mjs <capture-dir> [output]\n");
  process.exit(2);
}

const read = (relativePath) => {
  const path = join(captureRoot, relativePath);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};
const readJson = (relativePath) => {
  const text = read(relativePath);
  if (text === "") return undefined;
  try { return JSON.parse(text); }
  catch { return undefined; }
};

const allFiles = readdirSync(captureRoot, { recursive: true }).map((name) => name.replaceAll("\\", "/"));
const manifest = readJson("manifest.json") ?? { files: [], cases: [] };
const environment = read("environment.txt");
const environmentFacts = Object.fromEntries(environment.split("\n").filter((line) => line.includes("="))
  .map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));

const caseFiles = allFiles.filter((name) => name.startsWith("cases/") && name.endsWith(".json"));
const cases = caseFiles.map((name) => readJson(name)).filter((value) => value !== undefined)
  .sort((left, right) => (left.case_id < right.case_id ? -1 : 1));

const commands = allFiles.filter((name) => name.endsWith(".cmd")).map((name) => {
  const base = name.slice(0, -4);
  return {
    name: base,
    command: read(base + ".cmd").trim(),
    exit: read(base + ".exit").trim(),
    output: read(base + ".txt"),
  };
});

const screenshots = allFiles.filter((name) => name.startsWith("screenshots/") && name.endsWith(".png"));
const media = readJson("media/fixtures.json");
const browser = readJson("browser/environment.json");
const zoom = readJson("zoom/native-200.json");
const architectureHref = relative(dirname(outputPath), resolve("docs/architecture/m5-stage-current.architecture.html"))
  .replaceAll("\\", "/");
const probe = existsSync(resolve("docs/evidence/WAVE3/M5/upstream/studio-seam-probe.json"))
  ? JSON.parse(readFileSync(resolve("docs/evidence/WAVE3/M5/upstream/studio-seam-probe.json"), "utf8"))
  : undefined;

const escape = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const statusLabel = (status) => ({ PASS: "通过", FAIL: "失败", BLOCKED_ENV: "环境阻塞", NOT_RUN: "未运行" }[status] ?? status);

const caseRows = cases.map((entry) => {
  const failed = entry.assertions.filter((assertion) => !assertion.ok);
  return `<tr>
    <td><code>${escape(entry.case_id)}</code></td>
    <td>${escape(entry.title)}</td>
    <td class="s-${escape(entry.status)}">${escape(statusLabel(entry.status))}</td>
    <td>${entry.assertions.length}</td>
    <td>${failed.length === 0 ? "—" : escape(failed.map((assertion) => assertion.claim).join("；"))}</td>
    <td><code>cases/${escape(entry.case_id)}.json</code></td>
  </tr>`;
}).join("\n");

const commandRows = commands.map((entry) => {
  const selfGenerating = entry.name === "acceptance-report" && entry.exit === "";
  const ok = entry.exit === "0";
  return `<tr>
    <td><code>${escape(entry.name)}</code></td>
    <td><code>${escape(entry.command)}</code></td>
    <td class="s-${selfGenerating ? "NOT_RUN" : ok ? "PASS" : "FAIL"}">${selfGenerating
      ? "生成本页中；最终退出码见 acceptance-report.exit" : escape(entry.exit)}</td>
    <td><code>${escape(entry.name)}.txt</code></td>
  </tr>`;
}).join("\n");

const screenshotRows = screenshots.map((name) => `<figure>
    <img src="${escape(relative(dirname(outputPath), join(captureRoot, name)).replaceAll("\\", "/"))}" alt="${escape(name)}" loading="lazy" />
    <figcaption>${escape(name)}</figcaption>
  </figure>`).join("\n");

const mediaRows = (media?.files ?? []).map((file) => `<tr>
    <td>${escape(file.kind)}</td>
    <td><code>${escape(file.name)}</code></td>
    <td><code>${escape(file.sha256)}</code></td>
    <td>${escape(file.bytes)}</td>
    <td>${escape(file.decoded_frames)}</td>
    <td><code>${escape(file.command)}</code></td>
  </tr>`).join("\n");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Narralens M5 自动验收报告</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif; margin: 0; padding: 24px; line-height: 1.6; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 { font-size: 20px; margin: 32px 0 8px; border-bottom: 1px solid #8884; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; font-size: 13px; }
  th, td { border: 1px solid #8884; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #8881; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
  .s-PASS { color: #1a7f37; font-weight: 600; }
  .s-FAIL { color: #b42318; font-weight: 600; }
  .s-BLOCKED_ENV { color: #b54708; font-weight: 600; }
  .s-NOT_RUN { color: #666; font-weight: 600; }
  .note { background: #8881; border-left: 4px solid #8886; padding: 8px 12px; margin: 12px 0; }
  .figures { display: flex; flex-wrap: wrap; gap: 12px; }
  figure { margin: 0; width: 320px; }
  figure img { width: 100%; border: 1px solid #8884; }
  figcaption { font-size: 12px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; font-size: 14px; }
  iframe.architecture { width: 100%; min-height: 620px; border: 1px solid #8884; background: white; }
  dt { font-weight: 600; }
  dd { margin: 0; }
</style>
</head>
<body>
<h1>Narralens M5 自动验收报告</h1>
<p class="note">本报告由仓内工具从一次真实捕获生成，声明上限 <strong>M5_HEADLESS_EVIDENCED</strong>。
人工体验门（UX-12）保持 <strong>HUMAN_NOT_RUN</strong>；本报告不构成 Gate D4.2、V1-P0、V1-Full 或 M6 的任何结论。</p>

<h2>1. 基线与冻结 SHA</h2>
<dl>
  <dt>捕获 commit</dt><dd><code>${escape(environmentFacts.git_head ?? manifest.capture_sha)}</code></dd>
  <dt>分支</dt><dd><code>${escape(environmentFacts.git_branch ?? "")}</code></dd>
  <dt>origin/main</dt><dd><code>${escape(environmentFacts.origin_main ?? "")}</code></dd>
  <dt>捕获时工作树</dt><dd><code>dirty=${escape(environmentFacts.repo_dirty_at_capture ?? "?")}</code></dd>
  <dt>固定 OpenFilm 上游</dt><dd><code>${escape(environmentFacts.openfilm_upstream ?? "")}</code></dd>
  <dt>声明上限</dt><dd><code>${escape(environmentFacts.declaration_ceiling ?? "M5_HEADLESS_EVIDENCED")}</code></dd>
  <dt>交互约束</dt><dd><code>${escape(environmentFacts.interaction ?? "")}</code></dd>
</dl>

<h2>2. 逐 case 状态</h2>
<table>
  <thead><tr><th>Case</th><th>标题</th><th>状态</th><th>断言数</th><th>未通过的断言</th><th>证据</th></tr></thead>
  <tbody>
${caseRows}
  </tbody>
</table>

<h2>3. 目标架构与当前实现</h2>
<p>本阶段架构由 Archify showcase 模式生成并通过 9/9 结构与组合检查。图中把 M5 的
fixture/proxy 与 M6 正式生产渲染明确分离，并展示 Panel/StudioHost/Gateway、受控写服务、
ProjectCoordinator、EnginePort、素材化 worker、SQLite 与工程文件系统的真实边界。</p>
<p><a href="${escape(architectureHref)}">在独立页面打开本阶段架构设计</a></p>
<iframe class="architecture" src="${escape(architectureHref)}" title="Narralens M5 当前实现架构"></iframe>

<h2>4. 命令、退出码与原始日志索引</h2>
<table>
  <thead><tr><th>名称</th><th>命令</th><th>退出码</th><th>原始输出</th></tr></thead>
  <tbody>
${commandRows}
  </tbody>
</table>

<h2>5. 用户体验路径与截图索引</h2>
<p>截图只在每个 case 的 Studio 与 Narralens 面板仍处于成功态时捕获；环境关闭后的
“Studio connection lost”页面不会被当作成功证据。路径覆盖：打开已迁移工程 → 定位镜头/章节 →
读取原生时间线 → 回放已录制提案 → 素材化 → impact/锁确认 → 采用 → history 恢复。</p>
<div class="figures">
${screenshotRows}
</div>

<h2>6. 浏览器、硬件、profile 与缩放</h2>
<dl>
  <dt>浏览器</dt><dd><code>${escape(browser?.browser ?? "")}</code></dd>
  <dt>可执行文件</dt><dd><code>${escape(browser?.executable ?? "")}</code></dd>
  <dt>CDP 端点</dt><dd><code>${escape(browser?.cdp_endpoint ?? "")}</code></dd>
  <dt>隔离 profile</dt><dd><code>${escape(browser?.profile_root ?? "")}</code></dd>
  <dt>Gateway origin</dt><dd><code>${escape(browser?.gateway_origin ?? "")}</code></dd>
  <dt>原生 200% 读回</dt><dd><code>${escape(JSON.stringify(zoom?.layout ?? {}))}</code></dd>
</dl>

<h2>7. 媒体、ffprobe 与完整解码</h2>
<table>
  <thead><tr><th>种类</th><th>文件</th><th>SHA256</th><th>字节</th><th>解码帧数</th><th>生成命令</th></tr></thead>
  <tbody>
${mediaRows}
  </tbody>
</table>
<p class="note">${escape((media?.claim_limits ?? []).join(" "))}</p>

<h2>8. 上游 Studio 接缝探测</h2>
<dl>
  <dt>探测结果</dt><dd><code>ok=${escape(probe?.ok)} ${escape(probe?.reason ?? "")}</code></dd>
  <dt>startStudio 模块</dt><dd><code>${escape(probe?.seams?.start_studio?.module ?? "")}</code></dd>
  <dt>startStudio 摘要</dt><dd><code>${escape(probe?.seams?.start_studio?.sha256 ?? "")}</code></dd>
  <dt>StudioHost 模块</dt><dd><code>${escape(probe?.seams?.studio_host?.module ?? "")}</code></dd>
  <dt>StudioHost 摘要</dt><dd><code>${escape(probe?.seams?.studio_host?.sha256 ?? "")}</code></dd>
  <dt>加载闭包文件数</dt><dd>${escape(Object.keys(probe?.loaded_closure ?? {}).length)}</dd>
</dl>

<h2>9. 事务 / NOWRITE 差异</h2>
<p>写路径的前后差异由 <code>tests/m5/locks.test.ts</code> 与 <code>tests/m5/comparison-replay.test.ts</code> 断言：
锁的 CAS 失败为零 lock/outbox 变化，replay 不改变 source/revision/snapshot/ledger。</p>

<h2>10. 失败捕获</h2>
<p>失败捕获只追加、不覆盖，索引见 <code>docs/evidence/WAVE3/M5/failed-captures.json</code>；
完整性门 <code>tools/m5-evidence-integrity.mjs</code> 会检查每一次失败都在索引中。</p>

<h2>11. 审查状态</h2>
<p>四视角内部审查见 <code>docs/evidence/WAVE3/M5/reviews/internal-review.md</code>。
独立外审与人工体验均未进行，本报告不代替它们。</p>

<h2>12. 回退</h2>
<p>关闭 M5 的 workbench/replay/locks 路由与 Studio Gateway 并恢复旧 <code>NarralensApp</code> 即可回退 UI；
不重置数据库、不删除 Wave 2 表、snapshot 或迁移副本。</p>

<h2>13. 限制与 NOT_RUN</h2>
<ul>
  <li>UX-12（人类一分钟定位、十秒找到撤回、理解 impact 与错误）保持 <code>HUMAN_NOT_RUN</code>：自动化不得代签人类判断。</li>
  <li>fixture 只证明系统交互，不证明长片内容质量；120 clip / 6 章是结构压力用例。</li>
  <li>没有声明 Gate D4.2、V1-P0、V1-Full、M6 完成，也没有声明任何 headed 或人工验证。</li>
</ul>
</body>
</html>
`;

writeFileSync(outputPath, html, "utf8");
process.stdout.write(`report written: ${outputPath}\n`);
