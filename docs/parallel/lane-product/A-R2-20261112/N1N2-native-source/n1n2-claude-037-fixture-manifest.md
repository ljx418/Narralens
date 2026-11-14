# N1N2 037 — 三个 opaque 组件夹具的交付清单（LF01）

状态：**已按 RELEASE_037 的精确摘要交付到工作树；未 git add（索引由 MAIN 独占）。**

## 1. 这三个文件是什么（明说）

| 文件 | 字节 | SHA256 | 它是什么 | 它**不是**什么 |
|---|---|---|---|---|
| `tests/fixtures/m2.1/snapshot-project/assets/generated/visual-10s.mp4` | 17 | `0427d617584264ac2875243d6cf711dd985577566f71db6b9d5faf051575989c` | 一个**不透明占位**：内容 `SNAPFIX-VISUAL-A\n` | **不是 MP4**，不可解码、不可渲染、无任何帧 |
| `tests/fixtures/m2.1/snapshot-project/assets/generated/visual-alt-10s.mp4` | 17 | `40d825e66ee7e69ae53dfdc8d5195fbb9ffc3af7eb07452a5081c51e24115cff` | 一个**不透明占位**：内容 `SNAPFIX-VISUAL-B\n` | **不是 MP4**，不可解码、不可渲染、无任何帧 |
| `tests/fixtures/m2.1/snapshot-project/assets/generated/narration-30s.wav` | 18 | `e4276d5ec9199f11df067a98061508eaa11dbaf11ffac107775714b95962173d` | 一个**不透明占位**（旁白） | **不是 WAV**，不可解码、无任何采样 |

- 这三个摘要**正是** `tests/fixtures/m2.1/snapshot-project/narralens.assets.json` 里登记的 `sha256`
  （`visual-10s.mp4` 见该文件第 6-7 行，`visual-alt-10s.mp4` 见第 23-24 行），
  也正是 canonical 仓库中同名文件的历史字节 ⇒ **组件合同就是这组 opaque 字节**。
- 因此它们**不可**被真实媒体替换：换了就破坏 manifest 的合同、破坏旧 Gate 记录的摘要，
  也会把「组件夹具流转」这一类证据偷换成另一类证据。

## 2. 来源与可复现性

- 来源（**只读**复制，无改动）：
  `/mnt/c/workspace/videoworkline/Narralens/tests/fixtures/m2.1/snapshot-project/assets/generated/{visual-10s.mp4,visual-alt-10s.mp4,narration-30s.wav}`
- 复制后**逐个**核对 SHA256 与 RELEASE_037 的 `allow_fixture_exact_sha256`：**三项全部逐字相等**（见 §1 表格）。
- 这三个路径被 `.gitignore:19-20`（`*.mp4`、`*.wav`）忽略，**从来不在 git 里**：
  canonical 仓库里它们是「被忽略的本地文件」，本 worktree 之前**整个 `assets/generated/` 目录都不存在**
  ⇒ 036 的 5 个失败套件是**前置条件缺失**，不是本候选引入的回归。
- **可复现性尚未成立**：只在本地补上被忽略的文件，不能宣称「干净 checkout 可复现」。
  按 RELEASE_037 的裁决，**由 MAIN 在冻结时显式 `git add -f` 这三个确切小文件**（或另行采用等价追踪方案）；
  Claude 不做 `git add`/`commit`，索引保持为空。

## 3. 这三个夹具证明什么、不证明什么

**证明**（组件级）：路径、字节、manifest 摘要、资产登记与迁移流转 —— 即「被登记的资产确实是清单里那组字节」。

**不证明**：
- 不证明任何**真实媒体**链路（没有可解码的像素、没有帧、没有采样）；
- 不证明**视觉素材在迁移后被保留**（旧 migrator 的 `clipHtml` 用 title/stage/duration，不是原始画面）；
- 不证明 **A 轮真实中文影片**、Studio/NativeAck、完整可编辑内容迁移 —— 那些仍单列 NOT_RUN。

**真实媒体证据在哪里**：`tests/m2.3/migration-real-export.test.ts` 现在在自己的**私有临时副本**里
用固定本机 ffmpeg 准备**真实可解码**的诊断媒体（900 帧 @30fps）、用固定 ffprobe 实测帧数与完整解码，
并把**私有副本**的 manifest 更新为真实字节的摘要与真实帧数（`AssetRegistry` 改用真实 probe，不再用常量 900）。
固定 opaque 夹具本身**未被改动**；该诊断媒体**不是** A 创作影片。

## 4. 交付时的仓库状态

- `HEAD` = `e2eff61b464d75d36598103d718cd2a75db5dfda`（未变）。
- `git diff --cached --quiet` ⇒ **索引为空**（三个夹具未被 add，且被 ignore）。
- 已跟踪 dirty 集合未变（`AGENTS.md` + 7 个候选文件），另加本次 037 批次内的源码/测试改动（均在释放白名单内）。
