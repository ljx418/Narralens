# Contract 文件说明

运行时权威合同位于仓库根目录 `contracts/*.schema.json`，`src/contracts/validator.ts` 只加载该目录。这里的 `docs/contracts/` 保存各开发阶段冻结、供人类外审的参考合同与示例，不是第二套运行时合同。

- D3 文件只描述 D3 当时冻结的 `set_visual_fit`，不会在 D4.0 后反向改写历史快照。
- D4 文件描述新增 `replace_visual_asset`、AssetManifest 与 descriptor 增量；生产 `contracts/edit-operation.schema.json` 将 D3/D4 operation 合并成当前 union。
- D4.1 文件描述多提案 request、Runner draft 与 Host 包装后的 ProposalComparison；当前只是外审快照，内外文档审查通过后才同步到生产 `contracts/`、TypeScript 与 validator。
- D4.2 五份跨子阶段文件描述本地导入元数据、实体化请求、MaterializedProposal、带影响确认的采用 operation 和 AssetManifest v2；D4.2.1 另有导入响应与公开库存响应两份合同，避免用完整 manifest 暴露 `project_path`，并让 restricted/unknown 条目可见但不可采用。D4.2.1 的 import metadata、@1/@2 manifest union、import response、inventory response 已同步生产 `contracts/`、注册 AJV 并固定 SHA；materialize request、MaterializedProposal、adopt operation 仍为 docs-only，未注册。v2 兼容读取 v1，并以 `derived + lineage` 区分普通本地 composite 与 AI `generated`。
- 生产 AssetManifest schema 与 D4 参考 schema 都在 schema 层拒绝绝对路径和 `..` 段；Host 与 Hypit 仍必须做 realpath containment，不能只信正则。
- 若参考合同与生产合同在同一当前字段上发生语义冲突，以生产合同、TypeScript 类型和 validator 测试为准，并必须在对应阶段审计中记录差异与修订。

## D4.2 审查快照与运行时映射（2026-10-14）

| 审查合同 | docs SHA-256 | 计划运行时 ID | 当前运行时状态 |
|---|---|---|---|
| `d4.2-asset-import-metadata.schema.json` | `67e4be38ada59322ee029cb4d1268c0341f385f7a4482d376786a8c8a42c3574` | `AssetImportMetadata` | 已同步：`contracts/asset-import-metadata.schema.json`，runtime SHA `0b1b8f0edb4845f93ac8f166b90076d29bcf165c48449bda0103df15523f77d0`（仅 `$id/$comment` 生产化） |
| `d4.2-asset-manifest-v2.schema.json` | `16ba862f27b0b595491a49875e7b749df50789a4353b3c2bc6c197536cac3b02` | `AssetManifest`（@1/@2 union） | 已同步：`contracts/asset-manifest.schema.json`，runtime SHA `97fe0b86fcd02a035348f38081a1673318f61e2ae1a4b378993ab8d80c769a21`（保留 @1 并合入 @2 严格分支） |
| `d4.2.1-asset-import-response.schema.json` | `9496733341675becdee796f1da398bb6a56ace83b1f7f5d2c8b5864f6d3806e9` | `AssetImportResponse` | 已同步：`contracts/asset-import-response.schema.json`，runtime SHA `155df604c849a7644aa91d2a9a1edd99927cbe0a67fb8ba8bb9de37564d9f949`（仅 `$id` 生产化）；路线 A 允许真实返回 @1/@2，并约束 created/migrated 组合 |
| `d4.2.1-asset-inventory-response.schema.json` | `243a1e685260a95fc1914b1bcd14fabc9444ec8a3fc557be04daf57a346bd999` | `AssetInventoryResponse` | 已同步：`contracts/asset-inventory-response.schema.json`，runtime SHA `90232b3b18022ccbaa9256c24d55cbc5d43d558e391b6dbd5ce0385201bbc728`（复用 runtime manifest source/license 定义） |
| `d4.2-materialize-request.schema.json` | `1094a0b6da0e33b396279a1979349657b68eec08435166dbe12361809e0566c6` | `MaterializeRequest` | 未创建；D4.2.2 前不得注册 |
| `d4.2-materialized-proposal.schema.json` | `d094857365837af26994a57e5e4effce6df2e2ebbdcdc8cfee9b1ff65cbc107e` | `MaterializedProposal` | 未创建；D4.2.2 前不得注册 |
| `d4.2-adopt-operation.schema.json` | `220e139a97920d67f06b1a3ab6014fe6b953f8ad4c4db65e58c92b7ffa3e261c` | `AdoptMaterializedProposal` | 未创建；D4.2.3 前不得注册 |

D4.2.1 四份 runtime 合同已由 `D421-CONTRACT-04` 固定 SHA、`contractIds`、AJV 可解析性和三份后续合同未注册边界；后续三份合同仍保持有意未创建，不能由本次同步推导为 materialize/adopt 已实现。
