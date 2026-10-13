# Contract 文件说明

运行时权威合同位于仓库根目录 `contracts/*.schema.json`，`src/contracts/validator.ts` 只加载该目录。这里的 `docs/contracts/` 保存各开发阶段冻结、供人类外审的参考合同与示例，不是第二套运行时合同。

- D3 文件只描述 D3 当时冻结的 `set_visual_fit`，不会在 D4.0 后反向改写历史快照。
- D4 文件描述新增 `replace_visual_asset`、AssetManifest 与 descriptor 增量；生产 `contracts/edit-operation.schema.json` 将 D3/D4 operation 合并成当前 union。
- D4.1 文件描述多提案 request、Runner draft 与 Host 包装后的 ProposalComparison；当前只是外审快照，内外文档审查通过后才同步到生产 `contracts/`、TypeScript 与 validator。
- 生产 AssetManifest schema 与 D4 参考 schema 都在 schema 层拒绝绝对路径和 `..` 段；Host 与 Hypit 仍必须做 realpath containment，不能只信正则。
- 若参考合同与生产合同在同一当前字段上发生语义冲突，以生产合同、TypeScript 类型和 validator 测试为准，并必须在对应阶段审计中记录差异与修订。
