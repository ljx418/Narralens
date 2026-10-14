# D421-DEP-01 依赖与许可证证据

日期：2026-10-14

## 锁定结果

| 包 | 用途 | 精确版本 | 许可证证据 |
|---|---|---:|---|
| `busboy` | streaming multipart parser | 1.6.0 | 上游 LICENSE 为 MIT 文本；仓内规范化换行副本 `busboy-1.6.0-LICENSE.txt`，SHA-256 `9f75981e6039d13bf2e591c59e9c89a2641ca605fde59ba78974b11553f6c148`（上游安装文件 SHA-256 `d06b5d27bbbbe22c36b1fd88406b1208876e2d37d795f5b8eaed951a459a3111`） |
| `@types/busboy` | TypeScript declarations | 1.5.5 | 安装包 LICENSE 为 MIT，SHA-256 `c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383` |

`package.json` 与 `pnpm-lock.yaml` 均使用精确版本；lockfile 同时固定 Busboy 的直接传递依赖 `streamsearch@1.1.0`。TypeScript 编译与真实 HTTP multipart 测试属于同一门禁，不能只凭 lockfile 声明可用。

## 供应链审计

安装 Busboy 后首次执行 `pnpm audit --prod --json`，发现既有 `ajv@8.17.1` 的中危 `GHSA-2g4f-4pwh-qvx6 / CVE-2025-69873`；触发条件是启用 `$data: true`，本项目未启用，但仍将 AJV 精确升级至修复版 `8.18.0`。再次执行 `pnpm audit --prod --audit-level high` 输出 `No known vulnerabilities found`，退出码 0。

## 结论

Busboy 与类型包已经锁版、许可证留证、可编译并由真实流式请求覆盖；生产依赖没有未裁决的已知漏洞。`D421-DEP-01` 通过。该结论只覆盖当前 lockfile，后续升级必须重新审计。
