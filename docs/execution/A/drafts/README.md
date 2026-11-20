# MAIN临时实现稿

基线全量仍使用ca5b67a源码，因此尚不把新生产模块/测试加入该运行的文件集合，避免捕获中混入后续代码。此目录是待落到src/host/agent-driven的草稿，不表示生产装配或测试通过。

agent-schema.ts.txt：把批准cp-a0 migration通过原RevisionStore.compose作用于同一连接，schema+receipt同事务；拒绝既有无回执或漂移schema，不另开DB。基线全量结束后复制冻结SQL到contracts、落实模块，跑真实Node RevisionStore fresh/reopen/rollback/drift测试，再接PRODUCT精确closed records到cp_a0表。

待落实时需补充：基于合同freeze记录校验migration自身SHA、异常时不暴露SQL细节、已有空receipt表结构检查；测试不得仅镜像实现，应覆盖真实旧RevisionStore schema、FK和事务回滚/重复升级/篡改，不能把Pythonfixture代替Host证据。
