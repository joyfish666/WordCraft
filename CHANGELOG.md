# Changelog

本文件记录 WordCraft 的功能、修复与工程化变更。版本号沿用 package.json（单一来源）。

## Unreleased（2026-08-14 全面审查批次，版本号未升）

### 2026-08-14 追加（坑 105-114：重试语义 / 缓存键 / 提交语义 / 契约透传 / a11y）

#### 修复与健壮性

- **流中途中断不再自动重试**：`reader.read()` 抛错改抛 `StreamInterruptedError`，`isRetryableStreamError` 排除之——此前普通 Error 一律可重试，流已产出大半内容（token 已计费）后中断会重复发起整次 POST（重复计费 + 内容整段替换）。可重试仅限「连接建立前失败」与 429/5xx；回归测试断言 fetch 只调用一次（坑 105）。
- **墙体方案内容签名补房间名**：`wallPlanContentKey` 纳入 `r.name`——此前只含足迹/开洞/入口，重命名房间后命中陈旧缓存，3D 渲染/平面图/点墙放门窗三处显示旧门墙（坑 106）。
- **家具独立/靠墙词表双语化**：`FREE_STANDING_RE` 补英文等价词，英文 UI 下 Coffee Table/Chair 等不再被误当靠墙家具贴墙（坑 107）。
- **settings migrate 保留线框偏好**：仅持久化版本 <2 时强制关闭线框，v2+ 保留用户显式设置（此前每次版本升级都静默重置）（坑 108）。
- **拖拽提交语义收敛**：新增 `commitEdit` 统一 commitDrag/commitPlanEdit——场景必收敛为约束后版本，但内容 diff（editDiffToOps）为空时不压历史、不追加编辑日志（消除幽灵撤销条目）；所有离散提交点调 `syncDirtyWithSaved`，拖回原位不再脏标记卡死（坑 109）。
- **快捷键对话框守卫**：`[role="dialog"]` 打开时 Ctrl+Z/R/方向键不再作用于背后场景（坑 110）。
- **v2 快照路径补 rotationY/relativeTo 透传**：此前快照中家具旋转修改与贴靠定位被静默丢弃，与手写 ops 不等价（坑 111）。
- **applyOpenings 按足迹环几何取边**：新增 `edgeByRingIndex`——退化边过滤后数组下标会错位，开洞不能直接索引渲染侧数组（坑 112）。
- **ConfirmProvider 请求队列化**：重入的 confirm/alertMessage 按序弹出，前一个 Promise 不再永久悬挂；卸载兜底 resolve（坑 113）。
- **截图竞态防护**：`flushSync` 同步提交净化状态 + 请求序号防重叠调用互相复位（坑 114）。
- **对话消息与历史有上限**：`messages` 上限 100 条、`toChatHistory` 只送最近 30 条（防 5MB 配额逼近）。
- **口令还原后清空旧分享内容**：ShareDialog 不再显示已不属于当前场景的口令/截图。

#### 可访问性与样式

- **aria 补全**：属性面板 Gizmo/步长、平面图工具行与门窗切换补 `aria-pressed`（工具行含单选组语义）、工具面板按钮补 `aria-expanded`、ChatDrawer 折叠按钮补 `aria-label`。
- **输入框焦点指示**：`input:focus-visible` 由移除 outline 改为边框变色 + 2px 外发光环（`--accent-soft`），色弱用户不再难以辨认焦点。
- **平面图编辑只响应左键**：右键/中键保留给 OrbitControls（此前会同时拖房间与转视角）。
- **派生色令牌化**：硬编码 rgba（accent/danger/warn/遮罩）收敛为 `color-mix` 派生变量（`--accent-soft-strong`/`--danger-soft`/`--warn-strong`/`--overlay`），随主题令牌联动。
- **属性面板偏移随窗口钳制**：resize/松手时把拖拽偏移钳回视口容器内（拖过头后面板不再整体出视口且头部不可拖回）。
- **调试日志下载稳健化**：anchor 挂 DOM 再点击 + 延迟 revokeObjectURL（Safari 等浏览器立即 revoke 会下载失败）。

### 工程收尾

- 文档同步：测试数 601→614、architecture v2.17→v2.18、README 双语 FAQ 更新（词表双语化后的真实边界）、notes 新增坑 105-114。


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

- 文档同步：测试数 574→601、architecture v2.16→v2.17（2026-08-14 批次后 601→614、v2.17→v2.18）。
- CI：job 增加 `timeout-minutes` 与 PR 并发取消；vitest 设 `testTimeout: 15s`。
- 新增 CHANGELOG.md（本文件）。
