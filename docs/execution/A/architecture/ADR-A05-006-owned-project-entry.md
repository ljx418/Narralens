# A05-006：启动页真实工程导航

MAIN集成现有Host根入口；PRODUCT只提供纯展示组件，不另建编辑应用。CP-A0 Agent合同保持原样。

UI-only GET /api/ui/v1/projects：Host与同origin proof认证先于查找，SQL按caller principal筛选committed created并逐项复核归属，按project_id稳定keyset（24+1），只返回持久保存事实。state=saved要求完整revision/snapshot/date/frame_count；attention仍可展示但不开放按钮。读取不访问媒体、不启动Studio，不声称新鲜ready或native loaded。

UI-only POST /api/ui/v1/projects/:id/native-open沿用真实受控启动链；native-entry@1.0明示unconfirmed，客户端只接受选中project、未过期、精确loopback entry fragment地址，不接受任意redirect。共享Cookie不足以读私有列表。

Root一次fragment兑换后读取真实/api/session；仅明确trusted_ui进入owned列表，明确legacy会话仍保留原导演页；未知/过期凭据给出重开指引，不回落d1-30s。前端serial隔离StrictMode重入和晚到列表，单飞防重复打开；分页由server重新验证归属，after不提供授权。

实证：type/build0；4files10tests覆盖实际Host、真实Headless root→刷新→原生编辑器同页M5、零d1请求、零ack写入。两主题截图仅入口，不是影片两主题或人验。列表25th-row尚无真实HTTP测试，查询与参数绑定已静态复核，保留限定。入口当前为真实空工程，不代表A05/A、影片或受管native观察通过。

回退：移除owned Root导航及UI列表路由，保留工程、快照与所有证据；legacy入口仍在，不能reset/删工程以回退。
