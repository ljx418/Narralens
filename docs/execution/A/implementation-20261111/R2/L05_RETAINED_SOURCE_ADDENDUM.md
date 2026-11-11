# L05 实现接口补充：真实源文件身份与完整闭包

状态：MAIN 已裁决实现接口；尚无运行时通过结论。原 INTERFACE_LOCK.md 字节保持冻结。此补充落实其既有 source identity / final synchronous guard 要求，不改变 CP-A0 DTO、工具数量、EnginePort 或授权范围。

## 精确签名与职责

PRODUCT 在自己的 openfilm-native-expected.ts 导出：

```ts
interface NativeExpectedRetainedFile {
  readonly relative_path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly verify: () => boolean;
  readonly close: () => void;
}
// NativeExpectedSourceFacts 原字段保持，新增：
// readonly retained: readonly NativeExpectedRetainedFile[];
// readonly verifyClosure: () => boolean;
```

readSource({binding}) 仍返回 Promise<NativeExpectedSourceFacts>。BRIDGE 负责 Host 真实 committed-reader 实现与装配，PRODUCT 负责接口、expected proof 与 observation 最终核验。两方只修改本次已释放文件，不跨 owner 写。

## 真实读取与守卫

- 每个 retained 条目必须持有实际仍打开的只读描述符；verify 同步检查原 canonical 根与路径身份、当前路径与持有 FD 的 dev/ino、同 FD 的当前字节数与 SHA256。只检查 fstat(FD) 无法发现路径已替换，不能作为完整守卫。
- verifyClosure 同步重新核对相关源闭包的根身份、依赖与成员集合，覆盖 film、scene、设置、字幕样式、字幕、markers 和引用资产。必须检测新增与删除，不能只循环初次返回的文件数组。符号链接、逃逸、不可读取或不能证明均拒绝。
- 文件守卫和闭包守卫只由 Host 实际读取端产生，不能从 native body、客户端、自报摘要或默认恒真实现取得。
- PRODUCT 在 readSource await 返回后立即接管资源；后续 projection/hash/proof 创建失败也必须关闭全部资源。release/close 幂等释放；证明绑定原 issuing instance、不可变事实及原 binding。
- 每个异步边界后复核，最终 assertCurrent 同步检查闭包和每个文件，并紧邻 ack 写入；不得在最终守卫与落行之间插入未受保护的 await。复读同一数据库摘要不能证明物理源仍然一致。

## 必需负向证据

字节改变、相同字节的 inode/path 替换、根替换、闭包增删或依赖变化、跨实例/伪造/释放证明、proof 失败与服务关闭时句柄清理。需要原实现失败的测试，不以既有 14 条结构单测替代。最终还需真实 Host/native build/browser 路径证据。

## 决策记录

PRODUCT 问题 msg_d7b98223d4e1；MAIN 答复 msg_8cba44362942；BRIDGE 协调消息 msg_918e5f9a1819。既有 e0aaa242 候选尚不具备上述真实证明，因此未被集成或认可为生产能力。
