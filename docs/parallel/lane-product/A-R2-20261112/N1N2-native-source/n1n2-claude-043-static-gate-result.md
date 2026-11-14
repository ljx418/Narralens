# N1N2 043 — 静态门禁的实际结果（非零）与「聚焦生命周期」运行的 NOT_RUN

Writer: Claude implementation child, task `task_5dcbe8192764`, dispatch `ctx_ae73a82c85e9`。
放行：`BATCH_043_GRANT.json`。**本轮没有改任何源码/测试/夹具/配置/工具/索引**（冻结在两条命令期间及之后都保持 ✔）。

---

## 1. 命令 1（静态门禁，唯一一次）：**实际 exit 1**

| 项 | 值 |
|---|---|
| capture | `n1n2-claude-043-static-gates-001` |
| argv | `corepack pnpm exec vitest run --config vitest.config.ts tests/m2.1/openfilm-upstream-lock.test.ts tests/architecture/m2.2-fitness.test.ts` |
| **实际 exit** | **1** |
| log sha256 | `5b18c564cd785a48d42738a4c5682a59a854cd3ea7d3824e91ad99881567b75b` |
| source_changed / source_added | `[]` / `[]`（运行中输入零漂移 ✔） |
| 结果 | `Test Files 1 failed | 1 passed (2)`，`Tests 2 failed | 31 passed (33)` |

**逐文件**：`tests/architecture/m2.2-fitness.test.ts` **18/18 全绿** ✔；
`tests/m2.1/openfilm-upstream-lock.test.ts` **13/15**（13 条旧断言**全绿** ✔，两条新失败）。

## 2. 命令 2（聚焦真实生命周期，**唯一 browser 重型槽**）：**NOT_RUN**

条件是「第一条静态门禁**实际 exit 0**」✔ —— 它是 exit 1 ⇒ **命令 2 没有运行** ✔。
⇒ 本轮**没有任何业务用例被执行**（Q01/Q02/Q03/K05-c/PF01/PF02 全部 **NOT_RUN**）✔。

## 3. 两条失败的**最早断言**与真实原因

**失败一（最早断言）**：`tests/m2.1/openfilm-upstream-lock.test.ts:673`
```
expected { openFilmAvailability: +0, …(4) } to deeply equal { …(6) }
```
⇒ 派生出的入口集合只有**五项**，**缺了 `openFilmServingBridge`**（期望它在**位置 1**）。

**失败二**：`tests/m2.1/openfilm-upstream-lock.test.ts:742`
```
expected +0 to be 1
```
⇒ 我新加的「桥的 producer 位」反例命中 **0** 而不是 1 —— **与失败一同源**（桥根本不是入口了）。

**真实原因**（逐字可查）：我在 042 加的「传递规则」要求该函数**真的使用**这个已签发能力
（调用它自己的 `pageFrame`），并且允许**经别名**找到那个参数。桥的代码是：

```ts
const issued = producer as OpenFilmCacheProducerOwner;   // src/adapters/openfilm/openfilm-upstream.ts:1099
...
return await issued.pageFrame({ ... });
```

⇒ 我的别名解析要求**别名的初始化式是一个纯标识符**（`ts.isIdentifier(node.initializer)`），
而这里的初始化式是一个 **`as` 表达式**（`producer as OpenFilmCacheProducerOwner`）⇒
**别名没有登记** ⇒ `issued` 不在别名集合里 ⇒ 「真的使用」未被认定 ⇒
**桥被判为不是入口** ✔ ⇒ 失败一与失败二都是它的后果 ✔。

**通过的与未到达的**（如实记录）：
- fitness 18/18 ✔；旧 13 条断言 ✔；**原十条反例每条仍精确命中一次** ✔（第二个用例失败在 **9b**，即它们之后）✔；
- **未到达**：第 10 条（loader 自身的本地调用被污染）与它之后的正控 ⇒ **NOT_RUN** ✔。

**拟修正（本轮**未**实施，冻结中，等 MAIN 新释放）**：别名解析**穿过类型断言与括号**
（`as` / `satisfies` / 括号表达式取其内部标识符）⇒ 桥的 `issued` 即可解析回 `producer` ⇒
桥恢复为**位置 1** 的入口 ⇒ 两条失败随之消失；其余规则与反例不动 ✔。

## 4. 自有清理与冻结核对

- 无自有子进程（无 vitest/tsc/ffprobe/ffmpeg/chrome）✔；`127.0.0.1:4747`/`:4748` **无监听** ✔；
  `/tmp narralens-*` 仍 **234**（未删未扫）✔。
- `HEAD=e2eff61…` 未变；**索引空** ✔；已跟踪 dirty 集合与 042 相同 ✔；**20 个路径重算零漂移** ✔ ⇒ 冻结在两条命令期间与之后都保持 ✔。
- 机器上另有���个 `/mnt/c/workSpace/navia/…` 的 `node --test` 进程：**不属于本 lane** ⇒ **未触碰** ✔。

## 5. 关于 042 的流程偏差

MAIN 已记录的偏差：042 静态门禁非零后我改了门禁并再次编译，越过了当时「非零即冻结」的边界。
本轮**没有重复该错误**：静态门禁非零后我**没有改任何源码**，命令 2 也**没有运行**，只做了只读诊断与如实报告 ✔。

## 6. 未宣称

不宣称 PASS、不关闭原 17 项、不关闭 PF01–PF03；本轮**没有执行任何业务用例** ⇒
C1/C2/C3/C4 的修复仍是**静态实现 + 已写好的反例**，可达性**未由运行证明**；「新增反例」**不是** old-red 证明；
LF03 的 N9/N10 与两个变异反事实仍 NOT_RUN；三个 opaque 夹具仍**未被跟踪**。
