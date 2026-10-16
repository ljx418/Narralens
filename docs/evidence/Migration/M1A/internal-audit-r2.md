# M1A 内部实现审计 R2

日期：2026-10-16  
冻结实现提交：`84ecd6dcc2cd567865a7b03483b22c0cccb7176c`  
结论：`INTERNAL_PASS / EXTERNAL_R2_PENDING / M1A_NOT_YET_CLOSED`

## 审计范围

本审计覆盖 `304c891..84ecd6d` 的 production/test/evidence-script 变化、IM-01..26、完整 D421 冻结矩阵、R1 Claude Code 的 2 major/4 must-fix，以及重新执行的全量门禁与 Headless 浏览器证据。

## R1 闭环

| R1 发现 | 关闭证据 |
|---|---|
| UI artifact 未绑定 commit | evidence script 强制 40 位 `D421_SOURCE_COMMIT`；100%/200% canonical artifact 均记录 `84ecd6d...` |
| 第 257 项走重复 identity | 构造合法唯一 entry，`planAppend` 明确命中 capacity 409 `MANIFEST_CHANGED` |
| 不同名重复 file part 缺失 | 新增 `duplicate-file-different-name` 独立 variant |
| timeout/stderr 仅合成错误 | 实际可执行 shell：超时后断言 PID `ESRCH`；真实 64 KiB stderr 触发 128-byte maxBuffer |
| inventory 未走 HTTP/真实改字节 | 两次真实 `/api/projects/inventory-256/assets`；中间将第 7 项同长度 `x` 改为 `y`，第二次立即为 `HASH_MISMATCH`；并发峰值=2、单项 timeout 隔离 |
| 内审未覆盖 test seam | 本审计绑定新冻结提交；确认生产构造均使用默认真实依赖，注入项不能由 HTTP 输入控制 |

## 实际门禁

- `corepack pnpm check`: 17 files、134/134、0 skipped；TypeScript PASS；Vite production build PASS。
- 64 MiB upload evidence：PASS；旧 artifact 哈希保持可核验。
- Headless 100%：PASS，真实浏览器导入、HTTP 201、journal committed、revision/source/run/narration 不变。
- Headless native 200%：初次发现长 asset ID 引起横向溢出并诚实失败；在 `.fit-workspace` 与 `.asset-options` 增加收缩边界后，新鲜 fixture 复跑 PASS，document width 不超过 viewport、clipped controls=0、axe violations=0。
- Headed 自动化：NOT_RUN。人类体验：NOT_RUN。
- 测试结束后 4174/9244/9245 无监听进程，临时 fixture/profile 已移入系统回收站。

## 声明边界

M1A 内部证据已经闭环，但必须由新的独立 Claude Code 会话复审 `84ecd6d` 及其后仅含审计/证据的提交。R2 外审 PASS/YES 前不得关闭 M1A；即使 M1A 通过，M1B 当前仍为 PARTIAL，M2 仍是 NO_GO。
