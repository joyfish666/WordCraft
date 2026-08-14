# Changelog

本文件记录 WordCraft 的功能、修复与工程化变更。版本号沿用 package.json（单一来源）。

## Unreleased（2026-08-14 全面审查批次，版本号未升）

### 2026-08-14 遗留任务批次（A/B 组测试补缺，704 用例全绿）

#### 测试补缺（654 → 704，新增 50 用例）

- `lib/safeStorage.test.ts`（12 用例）：`createDedupeStorage` 去重命中底层只 setItem 一次 / 不同键独立去重 / 底层被外部清空或改写后缓存失效真正写回 / removeItem 清缓存 / getItem 透传 / 底层读失败不阻塞写入；`safeLocalStorage` setItem 抛错静默降级 + 一次性警告、getItem 抛错返回 null、removeItem 抛错静默、正常读写删透传（存储层「拖拽预览不写 localStorage」承重墙直测，坑 80/91）。
- `store/useModelStore.test.ts` / `useChatStore.test.ts` persist 迁移 rehydrate 端到端（各 2 用例）：v1 盒子存档 → v3（`levels[0].rooms`/4 点足迹/wall 并入家具）且 v3 存档原样读入；v2 消息带 `model` 存档 → rehydrate 后内存与持久化均无 model 并回写 version 3。
- `hooks/useDirtyTracking.test.tsx`（5 用例）：挂载首帧基线不误标脏 / 干净→变化置脏 / 脏后连续变化只置脏一次（spy 计数，坑 75）/ 移回已保存内容清脏 / 游离场景不跟踪。
- `hooks/useMobileCompact.test.tsx`（4 用例）：桌面 false / 窄屏 resize 转 true / 高度 ≤480 判紧凑 / 阈值边界 760 / 卸载移除监听。
- `pages/SettingsPage.test.tsx`（8 用例）：API Key 增删与首条自动激活 / 空表单按钮禁用 / radio 切换 / 默认 Base URL 与模型输入 / 连通性检测成功失败文案（mock `testConnection`）/ 语言切换英文界面。
- `components/ui/Dialog.test.tsx`（7 用例）+ `Button.test.tsx`（5 用例）+ `Input.test.tsx`（4 用例）：聚焦首元素 / Tab 焦点陷阱 / Escape 与遮罩点击关闭 / 内容区不冒泡 / 焦点归还 / 滚动锁 / portal 卸载；变体类名与禁用态。

#### 文档与工程

- 测试数 654 → 704（architecture §9、README 双语）；README 双语 FAQ 修正 Key 存储描述为仅 localStorage（IndexedDB 是项目库）；`.gitignore` 补 `.env*`（防御性）；`docs/review-followup.md` 勾选 A/B 组全部项并记录提交号（A1 `b8b6d78` / A2 `a77097b` / A3 `ccbd440` / A4 `7bf40e0` / B1 `612be91` / B2 `d543bc9` / B3 `b8e0a34`）；C1（react-router v7）单独排期未执行，C3（Compass/PlanEditLayer 组件测试）确认不做（jsdom 无 WebGL，硬测只得「渲染不崩」低价值断言，纯几何已由 planGeometry/planEdit 测试覆盖）。

### 2026-08-14 审查落地批次（P0/P1/P2：几何收拢 / 性能 / 测试补缺 / UI 一致性 / 文档工程，654 用例全绿）

#### 修复与健壮性

- **属性面板拖拽右边界钳制读实际宽度**：`clampOffset` 不再硬编码 270px——`.wc-compact` 紧凑模式下面板宽 240px，硬编码会把右边界算宽 30px（面板可拖出视口/复位被错误回拉）；现读面板 `offsetWidth`，CSS 调宽不再与 JS 脱节。
- **macro 批次不再重复跑家具常理摆放**：`executeOps` 对「非 custom macro 且批内无新增家具来源」的批次跳过末尾 `applyFurnitureConventions + normalizeContainment`——`applyMacro → resolveLayout`（auto 分支）已摆放过一次，贪心摆放二次执行有再推窗口 + 全量开销；`macro + addRoom/addFurniture` 等混合批次仍跑（为新家具兜底）。回归测试断言 conventions 只跑一次 / 混合批次两次。
- **编辑日志只记录实际执行的 op**：`ExecuteResult` 新增 `appliedOps`（成功执行列表），`applyPlanOps` 改用 `result.appliedOps` 追加编辑日志——executor 逐条容错跳过失败条目时，LLM 上下文不再出现「并未生效的操作」。
- **足迹边解析统一收拢（`geometry.edgeMetaOf`）**：footprintEdges / edgeByRingIndex / edgeDirIndex / findEdgeBySide / edgeByIndex / edgeDirOf / ringIndexOf 七处各自实现的「环边 → axis/line/start/length/dir」判定合并为单一纯函数——此前容差写法与方向比较基准已分歧（内联 1e-6 vs EPSILON、非轴对齐边处理不一），收拢后杜绝「一处修容差、另一处漏修」的漂移；`edgeByRingIndex`/`ringIndexOf` 互逆映射同容差。
- **v2 快照 diff 逐维下发 dimensions**：仅层高变化时不再下发 length/width——`updateNodeFields` 收到 length/width 会触发无谓的 `resizeFootprint`。
- **ChatDrawer 生成计时不再高频朗读**：逐秒变化的「已 N 秒」文本 `aria-hidden`，由静态 `.sr-only` 行在插入时向读屏器播报一次（新增 `.sr-only` 工具类）。

#### 性能

- **ModelNodeView / RoomShell memo 化**：此前仅家具叶子（FurnitureView）memo，房间外壳与全部墙段 JSX 在拖拽预览期间逐帧重建；现房间子树按引用 memo（`childAncestors`/`material`/`roomCenterPos`/`ORIGIN_CENTER` 引用全部 useMemo 稳定），未变房间不再逐帧协调。

#### 测试补缺（614 → 654，新增 40 用例）

- `lib/geometry.test.ts`（19 用例）：rectsOverlap/halfRectOverlaps 贴边与浮点边界、translateRoom 递归平移、sameFootprint、findRoomInList id→name 回退优先级、edgeMetaOf（矩形四向/下标回绕/斜边/退化边/L 形）。
- `hooks/useKeyboardShortcuts.test.tsx`（10 用例）：Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y、R 复位、方向键/WASD 平移、INPUT/TEXTAREA/`role="dialog"` 让位（坑 110）、Ctrl+R 不劫持、卸载移除监听。
- `hooks/useGeneration.test.tsx`（9 用例）：无 key 保留草稿、成功替换场景与历史基线、冲突确认 cancel/apply、失败不清场景、卸载中止、撤销生成。

#### 可维护性

- 常量收拢：内联 `1e-6` 统一引用 `constants.EPSILON`（chat/footprint/openings/diff/planEdit/roomGeometry）；`layout` 的 `DEFAULT_ROOM_HEIGHT` → `DEFAULT_HEIGHT`；`doorDirection` 的 0.5 阈值与 `hitWallOnEdge` 的 0.15 容差命名化；`modelTree` 的 1e-9 平移校验命名 `TRANSLATION_EPSILON`。
- 几何公式收拢：嵌套房间角点偏移 `(父-子)/2 - 墙厚` 三处复制 → `geometry.nestedCornerHalf`；嵌套禁入区/墙内活动区（furniturePlacement/modelTree 各两处复制）→ `geometry.nestedKeepOutRect`/`roomInnerBounds`；`applyOpenings` 内联切分循环 → 复用 `splitSegments`。
- UI 一致性：`HelpDialog` 改用统一 `<Button>` 组件；「3D」视图切换按钮补 `title`（新增 i18n key `home.view3dTitle`，中英对称）；`.segmented` 样式从 settings.css 移入 base.css（通用组件类被首页组件共用）。

#### 文档与工程

- 测试数 614 → 654（architecture §9、README 双语）；「6 张贴图」→ 7 张并补 `plasterWall`（design.md/history.md）；notes.md 文件地图修正（生成竞态防护 → `hooks/useGeneration.ts` + `useConfirm`）；README 双语补「部署（GitHub Pages）」章节；**CI 补 `npm audit --audit-level=high` 门**（audit 清零不再是一次性动作）；删除 `useModelStore.test.ts` 死代码 `void master`。

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
