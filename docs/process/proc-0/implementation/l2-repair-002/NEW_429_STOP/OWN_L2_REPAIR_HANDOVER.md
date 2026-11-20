# OWN_L2_REPAIR_HANDOVER — PROC-0 L2 修订 001 交还（冻结候选 + 待录三门）

本文件是**交还材料**，不是验收结论：不签 L1/L2/L3/L4，不证明业务语义，不证明产品完成。
实施者：ClaudeCode，Task `task_1e803fda402b` / Dispatch `ctx_ab2f1ac4c732`。
逐 finding 的改法与 direct 反例见 `OWN_L2_REPAIR_REPORT.md`。

## 1. 冻结候选（五文件 SHA-256）

| 路径 | SHA-256 | 行数 |
|---|---|---:|
| `tools/run-delivery.py` | `8cc37503961b7efe4be7d1146cbd4b6c3000d3325d5a43daaf3d3a62dc44079f` | 2079 |
| `tools/check-delivery-spec.py` | `6edd56ed818e8d9dbd1e85a65245cb8a59be862c15d5c938f90dadf47e2fd36e` | 1558 |
| `tests/process/test_delivery_admission.py` | `be739865027fae9c04e78e7ff5c49d635d5a460c42dfe1cbbbacaa4eaed31afe` | 956 |
| `tests/process/test_delivery_handoff.py` | `42e5bea0b03732a738915095a716a4175f1a36cb5d126c832f5744d8a721f225` | 558 |
| `tests/process/fixtures/admission_helper.py` | `65dd48515b3ddee4bbc901ebc74aa544e5335fb75bcd9a1c09feb66c1eeaed3e` | 153 |

起点 HEAD `9c2f6237f997c27e3f2d013fec48107a56f862ba`；本轮**无 Git 变更**；
其余 651 项 recorded 输入与保护项未改。

## 2. 逐 case 的 direct 映射与准备好的入口

全部 16 项均有直接映射（细节见 repair report §3）。准备就绪的三条 bootstrap 门（**尚未运行**，
等 MAIN 冻结后由 MAIN 用受保护 observer 原 recorder FIRST 执行）：

| 门 | 内层命令（cwd = W） | 期望 inner exit | 覆盖 |
|---|---|---:|---|
| B1 | `/usr/bin/python3.12 -I -S -B tests/process/test_delivery_admission.py` | 0 | runner 生命周期、epoch、authority、竞争、pending、slot 授权 |
| B2 | `/usr/bin/python3.12 -I -S -B tests/process/test_delivery_handoff.py` | 0 | checker metadata、零读取纪律、真实 producer→checker 链、helper barrier |
| B3 | `/usr/bin/python3.12 -I -S -B tools/check-delivery-spec.py --self-test` | 0 | checker 自身 25+ 负例分支与正例恢复 |

## 3. 新的运行时口径（MAIN 绑定 L3 时需要知道）

- **唯一 project authority**：`<project_root>/var/process-admission/authority/`
  （`state.json` / `lock` / `journal.jsonl`）。票面 `state_root` 只是**该票的产物根**。
- **产物固定命名**（checker 按此推导并先核后读）：
  - bootstrap 旁证：`<state_root>/bootstrap/<run_id>.json`
  - runtime sidecar：`<state_root>/sidecars/<run_id>.json`
  - 失败凭据：`<state_root>/credentials/<run_id>.json`
  - 终局收据：`<state_root>/receipts/<run_id>.json`
  - 原 capture 六件套：原 recorder 目录下的 `<basename>` + 六 suffix（不挪动、不补造）
- **终局收据**绑定 authority journal 中的 terminal `event_id`/`sequence` 与原件摘要、产物 SHA；
  checker 从外部阶段票推导收据与 journal 位置并核该事件确实存在。
- **失败凭据**必须由实际日志证明指定断言确已触发才签 `case_passed`；其 `cleanup.source` 必须与
  **同一 sidecar** 的实测观察逐项相符。
- **protected_inputs** 可含 MAIN 精确列出的绝对 pin（固定 Python、MAIN observer）；recorded_source
  仍只允许仓内相对路径。

## 4. 需要 MAIN 做的事

1. 核 §1 的五文件 SHA 与 scope（其余 651 项未改）。
2. 出具 **bootstrap-002**：重绑全部实际 recorded 输入（含本次 5 个文件的新摘要）、`protected_inputs`
   不变、**全新 capture basename**（旧的 001/002/003 一律保留不可复用或覆盖），并给出 B1/B2/B3 的
   原 recorder FIRST 精确票（observer、cwd、argv、期望 inner exit）。
3. 收到票后我才运行这三条命令；运行期输入不变，失败保原 capture，不套 timeout、不后台脱管。
4. 三门全绿后，按逐 case + 真实原件/旁证引用交还 L1 候选，等待 L2 独立源码审；**不自签外审**。

## 5. 诚实的边界

- 本轮**一条测试都没跑**，所有「应为绿」都只是代码候选；红绿以 MAIN 的实录为准。
- **L3 的真实双客户争抢、在途取消、真实 helper、真实 inner/outer 退出码、wrapper 死亡注入**
  全部 NOT_RUN，仍需 MAIN 另票。
- **R6 的 8 条源码仍未写**；PROC-0、R6、N1N2、V1 各自原门状态不变。
- 工具仍只是**合作式流程门**：不宣称 OS 隔离，不宣称完整 fork 历史，不防同用户任意改文件。
