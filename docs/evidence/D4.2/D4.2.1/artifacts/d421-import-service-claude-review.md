# D4.2.1 ImportService Claude Code 完整外审记录

日期：2026-10-14 20:10（Asia/Shanghai）  
工具：Claude Code CLI 2.1.205 / Sonnet  
模式：只读完整上下文复审

## 结论

```text
VERDICT: PASS
ALLOW_UI: YES
CRITICAL: 0
MAJOR: 0
MINOR: 0
```

## 前次六项指控复核

1. `RETRACTED`：`RevisionStore.assetImportIdempotent` 只对 `committed` 且响应字段完整的记录返回缓存，其余未完成状态返回 409。
2. `RETRACTED`：`AssetImportService.importRequest` 将 commit 包装在共享 `ProjectOperationQueue` 中，Host 还会拒绝自定义依赖中的队列不一致。
3. `RETRACTED`：恢复提交要求当前 manifest 等于精确 after-image SHA，随后再次验证安装文件的 realpath、regular-file 与内容 SHA。
4. `RETRACTED`：响应 `close` 触发 AbortController，signal 传入媒体验证并最终传入 ffprobe/ffmpeg 的 `execFile`；事务 commit 开始后按设计确定性完成。
5. `RETRACTED`：补偿删除仅作用于本事务创建、manifest 未引用、非 symlink、位于工程根内且 SHA 与 journal 相同的文件；无法证明则进入 attention。
6. `RETRACTED`：新内容安装在 source fsync、hard-link、destination fsync、目录 fsync 完成后才返回成功；不确定清理不会伪报成功。

## 额外核对

- 上传的 file、metadata 与 transport envelope 均为“精确等于上限允许、超过上限拒绝”。
- Busboy 限额设置为业务限额加一，再由显式字节判断执行真实业务边界。
- 对应测试验证 3 字节上限接收 3 字节为 200，接收 4 字节为 413。

## 外审原始理由摘要

完整源码中的可执行守卫分别证明了 committed-only 幂等返回、共享队列串行、恢复双重 SHA 证明、子进程取消传播、补偿删除多条件保护和持久化 fsync 链。外审未发现其他问题，因此允许进入 UI 子阶段。该结论只解除 ImportService 外审门禁，不替代 D4.2.1 最终验收。
