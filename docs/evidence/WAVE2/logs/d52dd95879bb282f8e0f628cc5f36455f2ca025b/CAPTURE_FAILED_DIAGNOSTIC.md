# M4B 第二轮返修失败捕获

本目录是失败捕获，禁止作为冻结证据或改写为全绿。

- capture commit：`d52dd95879bb282f8e0f628cc5f36455f2ca025b`
- `overall=1`，唯一的失败命令是 `wave2-m4b`（exit=1）；其余 15 条命令 exit 0，
  两个历史 current-tip 门按设计 exit 1。
- `wave2-m4b.txt`：**51 个测试中 49 个通过、2 个失败**，两条失败都不是断言失败，而是
  `HOST_RESOURCE_EXHAUSTED` / `SOURCE_TREE_UNREADABLE:ENOMEM`：
  - `converges the pre-publish crash boundary after_plan to aborted with revision +0`
    —— fixture 阶段的迁移读源树时遇到 ENOMEM；
  - `answers a visual lock held during recovery with a controlled 423 and nothing committed`
    —— 采用请求在读源树时遇到 ENOMEM，因此拿到的是 500/HOST_RESOURCE_EXHAUSTED 而不是 423。

## 这是什么、不是什么

这不是断言失败，也不是行为回归。Host 把 ENOMEM 映射成 `HOST_RESOURCE_EXHAUSTED` 且
`recoverable: true`，正是为了让一次瞬时的机器状态不被当成行为问题；两个失败的测试都在**被测行为
之前**就倒下了（fixture 迁移 / 采用的读源树）。

这台机器同时跑着数个 Claude 会话，`free -m` 显示 swap 已用 2.8 GB —— 捕获期间确实处于内存压力下。
同一提交上单独跑 `test:wave2:m4b` 是 51/51。

## 处置

不是放宽断言，而是让**夹具**对可恢复的资源失败重试：harness 的 `migrate()` 与 M4B 的
`postAdoption()` 遇到 `code === "HOST_RESOURCE_EXHAUSTED"` 且 `recoverable !== false` 时重试
（最多三次、间隔递增）。重试用的是**同一个 idempotency key**，所以一次重试是一次重放而不是第二次
采用 —— 这正是同一个 key 本就该有的行为。断言本身一个字都没有放宽：第二次仍然失败，失败照旧成立。

下一次捕获在新的干净提交上进行；本目录原样保留，不覆盖、不删除。
