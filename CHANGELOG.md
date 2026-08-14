# Changelog

本文件记录 WordCraft 的功能、修复与工程化变更。版本号沿用 package.json（单一来源）。

## Unreleased（2026-08-14 全面审查批次，版本号未升）

### 修复与健壮性

- **移动端门控统一**：删除 mobile.css 中与 `wc-compact` JS 门控并存的 `@media (max-width: 768px)` 块（760~768px 区间曾出现顶栏/属性面板样式冲突），窄屏样式全部由单一门控驱动。
- **室外地面几何泄漏修复**：GroundView 按尺寸缓存 PlaneGeometry（原拖拽预览每帧新建且不释放，GPU 缓冲泄漏）。
- **executeOps 逐条容错契约落实**：null/非对象 op 不再于 catch 内二次解引用导致整批崩溃；未知 op 名走显式 default 抛错，由逐条容错跳过（不污染 current）。
- **SSE 生成链路生命周期管理**：`useGeneration` 增加 AbortController——组件卸载/路由切换中止请求，不再静默覆盖场景；并发双发守卫改用 `getState()`；瞬态失败（连接失败/429/5xx）自动重试一次（800ms 退避）；流结束尾部 UTF-8 冲刷（不丢最后一个字符）；用户取消显示「已取消生成」。
- **IndexedDB 容错门面 `safeProjectDb`**：隐私模式/配额满时项目库操作不再产生未捕获 rejection，UI 给出一致提示（对齐 localStorage 侧 safeStorage 的降级哲学）；保存/打开项目改为落盘数据与脏标记快照同源。
- **undo/redo 与手动编辑日志一致**：撤销/重做时用历史条目内的 editOps 快照整体恢复（此前撤销后日志仍描述"已不存在的手动修改"，注入 LLM 的上下文自相矛盾）。
- **undoLastGeneration 校验消息配对**：仅当最后两条为 user+assistant 且 assistant 携带模型时才撤销。
- **API 错误分类细化**：流式请求的中止（用户取消/超时）以专用错误类型透出「请求超时」且不参与自动重试。

### 性能

- **persist 内容去重**：`createDedupeStorage` 包装模型/对话存储——纯 UI 状态变更（selectNode/planTool 等）不再触发全场景序列化写盘；对话 store 的 isGenerating 等非持久化变更同样零写盘。
- **家具子树 memo 化**：ModelNodeView 抽 `FurnitureView`（React.memo）——拖拽预览期间未变家具不再逐帧执行 buildFurnitureParts/partsBounds 与 React 协调。
- **墙体方案内容签名缓存**：`computeAllWallPlansCached` 增加单条目内容签名（足迹/开洞/入口），拖拽预览每帧新场景引用但内容不变时复用共享方案（O(房间²) 重算降为字符串比对）。
- **罗盘传感器瘦身**：标签列表首帧缓存（DOM 重建时自动重查）；相机未转动时跳过 style 写入。
- **阴影开销收紧**：勒脚/踢脚线/门套立柱等装饰小件不再 castShadow。

### 可访问性与设计系统

- **Dialog Portal + 滚动锁**：模态对话框渲染到 `document.body`（祖先 transform/overflow 不再破坏定位），打开时锁定背景滚动；消息经 `aria-describedby` 关联。
- **aria 语义补全**：视图切换/尺寸开关补 `aria-pressed`；调试面板补 `aria-expanded/aria-controls`；属性面板名称输入补 label；竖屏拦截层聚焦 + Tab 陷阱（键盘用户不再 Tab 到被遮挡控件）。
- **设计令牌收敛**：硬编码圆角/面板色替换为 `--radius-*`、`--bg-panel-90/92` 变量；语言切换按钮合并为单一 `LanguageToggle` 组件与单一 `.lang-btn` 样式。

### 英文体验（English UX parity）

- **房型分类词表双语化**（roomGeometry）：走廊/开放/私密/卫生间归属支持英文名（Hallway/Living Room/Bedroom/Master Bathroom 等）。
- **家具分类词表双语化**（furniturePresets）：20 类家具支持英文名（Bed/Wardrobe/Sofa/Nightstand 等），不再回退为 generic 盒。
- **配套补全语言化**：排除关键词（"no chair" 等）与补全件名称（Chair/Nightstand/Coffee Table）随界面语言。
- **地板材质按英文房名分类**（bathroom/kitchen/balcony → 瓷砖/防腐木）。
- **系统提示词双语**：英文界面使用英文提示词（规则与中文版一一对应），LLM 产出英文房间/家具名；场景摘要/编辑日志标题与方位词随语言；摘要补充入户门信息（入口房间/方向）。
- **品牌名走 i18n**：顶栏品牌随语言显示 言筑/WordCraft。

### 语言默认跟随系统

- 首次使用默认跟随系统语言（`navigator.language`），系统语言变化时自动切换（`languagechange`）；用户手动切换后固化选择（`languageFollowsSystem=false` 持久化），顶栏切换按钮保留。旧存档显式写过语言视为手动选择，不再跟随。

### 工程收尾

- 文档同步：测试数 574→601、architecture v2.16→v2.17。
- CI：job 增加 `timeout-minutes` 与 PR 并发取消；vitest 设 `testTimeout: 15s`。
- 新增 CHANGELOG.md（本文件）。
