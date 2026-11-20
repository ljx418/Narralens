# R6 私有合同 revision2 受影响独立复验

**PLAN_READY。** R6-DOC-01/02/03均为 **CLOSED_DOCUMENT**，没有剩余BLOCKER/MAJOR/MINOR。结论仅是两份文档已足以指导MAIN随后制定精确release；当前源码未因此修复或验收，未授予Claude实施、产品运行或任何阶段PASS。

本审全文读revision2私有合同/开发验收草案与原contract-review/REVIEW，核revision2绑定，并复核未改源码的相关Host startup与C实际control loop入口。655份实际read/hash输入首尾相等：4份文档/绑定＋651 source hash-read。651不是逐文件语义审计，源码讨论限定受影响入口及首轮上下文，不重开未改kernel算法。全部本审产品/测试/编译/生成/C/N/kernel/信号/Host/Chrome/network **NOT_RUN**，无源码/Git/旧证据改动，无子Agent。

## 逐项闭环

|旧ID|文档结论|具体依据与反证结果|
|---|---|---|
|R6-DOC-01|CLOSED_DOCUMENT|§1A优先的startup判别表分离Host-only no-child/no-authorize与bound fork-failed/failedsetup/exec-succeeded；null wait/ordinal、group-disposition、stream not-opened/never-inherited闭合、真正空转录均有明确分支。结构化setup进展/失败记录在同.py已有pipe内限2条/512bytes并支持partial read，能区分同errno的setsid与exec失败。§2/§3同步豁免不存在的N要求；C06-EXEC明确actual writer→parser→domain/eligibility对照。|
|R6-DOC-02|CLOSED_DOCUMENT|§1B在FD分配/fork前封存合法binding并消耗唯一attempt，fork成功瞬间登记原N；同批消息逐条查不可逆状态，重复/终止后AUTH不改绑定或覆盖PID/FD。统一wait ordinal与新wait使旧ECHILD失效。§4A清楚规定local raw-tree→实际stream finish→resource proof/wire→Host C-close，排除了原循环依赖；actual跨层mock及unknown/reader-close/wire/Cclose未证反对照已要求。|
|R6-DOC-03|CLOSED_DOCUMENT|C08-FORGE明确creative_eligible:false是合法失败证书正控，true/missing/wrongtype拒绝，其他required-true字段false另判。|

## 关键可实施性判断

- **无C与无授权**：对应现有supervisor #proveDomainGone no-child/no-birth与未authorize门，不要求不存在的C receipt/N wait/exit。C未收到AUTH不知可信ticket，Host-only分支避免伪造wire。
- **Host已授权但C无可信绑定**：§1A明确不能退回“Host未授权”豁免。CANCEL后AUTH的直接负例可保持协议失败/证据不完整责任，不能以C close伪签N不存在；这与普通合法normal/fault必须完整返回并不冲突。
- **唯一原根与overflow证明**：§1B把根前提落到当前_authorize_fork/_run_loop需要修改的真实入口，且新增AUTH,AUTH / CANCEL,AUTH / AUTH,CANCEL的至多1/0/1实际attempt反例。failed-terminal不是完整transcript的兼容fallback；资源证明仍需实际根registry、subreaper/sole wait、N实际wait及之后ECHILD、原group/retained epochs义务。该组合在声明的专用根范围内可用，不是仅凭ECHILD，也没有增加cgroup或任意恶意native保证。
- **EIO不自锁**：§4A先在C仍活着时产生不依赖reader已关/receipt/Host C-close的raw_tree_terminal，再完成EIO reader实际关闭且eof=false，最后才生成wire并由Host查C-close。raw-tree未知/reader-close不确定继续原责任，不盲关复用FD。§4旧一般文字按新增明确顺序解释，未形成相反前置门。
- **完整与失败资格**：完整transcript/full epoch/wait、parent-reaped仅原epoch消失的语义继续成立；failed-terminal一律无图。首预算失败/更早cause及secondary要求未弱化，流预算仍每路65536/尾8192，不以输出或责任超时伪结束。

现有same8可以容纳该私有协议、setup pipe和ledger/validator/mapper/直接测试；无需改公共API、upstream/workspace/closure/配置或受保护fixture。此处是可实施性判断，不是已存在实现的证明。

## 绑定与下一门

本轮实际文档摘要：

- MAIN_PRIVATE_CONTRACT_DRAFT.md：fb244621f206b6e9518be411377c396fbc79ddc9d113ebc921cf2c9dba62c35d
- MAIN_DEVELOPMENT_ACCEPTANCE_DRAFT.md：abc1d3a011c10f29e4c8c185e6e1e03e8177bd02b051271af6682d8d356c6d3a
- MAIN_DRAFT_INPUT_BINDING.json revision2：fe57a408704ae41246ee28c97d8c775920f77b6f41f8ecf555c5b5d03e33f36b
- 原contract-review/REVIEW.md：e64958ab5d97671c263d9533e4e55478ca406eac673886e9aec225e8b67e0350

MAIN仍须精确ReleaseAssignment后才交唯一Claude writer；实际代码需实现上述单调事实并有直接producer/consumer断言，不能只向receipt填布尔。six FIRST轻量验证/新失败保留/新429立即停规则继续；交还后独立源码复核，再由MAIN另票新pin真实normal/fault及递进场景。fixture仍protected，C09仍OPEN；R6仅可按草案交付C06..08内部证据，不签整个R6、原17/ISO18、N1N2/R7/R8/新冻结/NEXT/V1通过。旧失败及未证因果边界不因本次文档PLAN_READY变绿。
