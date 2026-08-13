# 言筑（WordCraft）历史版本更迭关键点

> 本文档记录项目三代架构的关键决策与演进脉络，体现"整屋直接生成 → 语义/几何分离 → 契约动词化"的逐步完善过程。配套：[设计方案](design.md) · [技术架构](architecture.md)。

## 三代架构总览

| 代 | 时期 | 核心形态 | 解决的问题 | 遗留问题 |
|----|------|----------|------------|----------|
| **第一代** | 2026-08-01 起（v0） | **大模型直接生成整屋**：输出层级 JSON + **绝对坐标**，代码仅做校验与渲染 | 从零打通"对话 → 3D"链路 | 缝隙/重叠/不合常理；修改不可控；无布局规则 |
| **第二代** | 2026-08-05 起（v1.0-v1.4，已被第三代取代） | **大模型只输出语义**（房间清单 + 名义尺寸 + 布置意图），**代码算几何**（无缝平铺/门/闭合） | 几何确定性、可编辑、可测试、可撤销 | 模板词表锁死表达上限；整屋快照改一处重写全屋；手动编辑无法回流对话 |
| **第三代** | v3 现行实现（P1 数据模型、P2 契约动词化、P3 双向同步与 P4 平面图自由编辑已完成，见 [design.md](design.md)） | **契约动词化**：LLM 输出操作序列（ops），逐条确定性执行；**足迹几何**：正交多边形房间 + 显式门窗；**双向同步**（P3 已完成）：手动编辑记录为同构 op 回流对话；**平面图自由编辑**（P4 已完成）：拖顶点/拖房间/点墙放门窗/拆房/合并，全部产出同构 op；另完成路线图项「2D 平面图增强」与「移动端横屏支持」 | 自由布局、自由编辑 | P5（约束图/楼层/风格）为可选二期 |

---

## 第一代：大模型直接生成整屋（v0）

**形态**：用户一句话 → LLM 输出一棵带**绝对坐标**的层级 JSON（房间/家具全部带 `position`）→ Zod 校验 → 直接渲染。多轮对话靠把上一轮整段 JSON 塞回上下文。

**当时的关键进展**：

- 对话生成核心链路 + SSE 流式请求（解决推理型模型超时）；
- 自动走廊、实心墙体与门洞、家具防重叠、墙底落地、共享墙去重；
- 南侧入户门、开放空间不设墙、卧室不互开门、45° 南视角、罗盘。

**核心痛点（催生第二代的直接原因）**：LLM **不擅长空间算术**。让它直接算绝对坐标，结果充满缝隙（墙不贴合）、重叠（家具穿模/房间交叠）、不合常理（卧室互开门、门开向外墙）。且**每次修改都是整屋重输出**，LLM 会顺手改动无关部分，用户无法依赖任何稳定性。调试靠逐个修 bug，规则越加越多、越来越脆。

**教训沉淀**：几何不该由大模型决定——这是项目最重要的转折判断。

---

## 第二代：语义/几何分离（v1.0-v1.4，已被第三代取代）

**标志性提交**：`c199bd3 refactor: v2 布局重构——语义与几何分离`（2026-08-05）。

**形态**：大模型只输出 **v2 语义契约**——房间清单、名义尺寸、布置意图（`side`/入口/中心），家具位置相对房间中心，**不再输出绝对坐标**。新增布局引擎 `resolveLayout`（`lib/layout.ts`）确定性平铺为 v1 绝对坐标模型（渲染/存储/墙体方案沿用同一套）。

**三条布局模式**（由 LLM 按需求选择）：

- `corridor` 走廊型：房间沿走廊两侧无缝平铺，入口房间靠前端、固定南侧；
- `living` 客厅居中型：客厅居中、其余房间环绕四边；
- `custom` 自由型：LLM 给绝对坐标，代码兜底（保留给非常规布局，但代价是失去确定性质量）。

**为什么这样分**：一个合理户型本质是"约束平铺问题"（无缝共墙、对齐、动线）。LLM 擅长语义组合，代码擅长确定性平铺。分层后：**LLM 决定"哪些房间、多大、怎么连"，代码保证"无缝、连通、闭合"**。

### 关键演进里程碑（v1.x）

| 版本 | 关键点 | 解决/引入 |
|------|--------|-----------|
| v1.0.0 | 对话生成 · 属性面板编辑 · 撤销/重做 · GitHub Pages 部署 | 编辑体验闭环 |
| v1.1.0 | 本地项目库（IndexedDB/Dexie）· 2D 俯视平面图 | 数据归属 + 视角切换 |
| v1.2.0 | 中英双语切换 | i18n（仅 UI 层，生成数据不翻译） |
| v1.3.0 | 真·内嵌嵌套房间（卧室套卫生间）· Gizmo 辅助编辑 · 截图分享 + 口令 | 结构真实感 + 直接拖动编辑 |
| v1.4.0 | 家具部件模型（13 类按名称拼装）· 走廊两侧自动均衡 · 入口房间保留 · 家具完整性提示 | 家具真实感 + 布局多样性 |

**第二代沉淀的关键设计**（详见 [architecture.md](architecture.md) 与 [notes.md](notes.md)）：

- 墙段模型 `computeWallPlan`：共享墙去重、开放空间不设墙、私密房间不互开门、卫生间命名归属、入口南墙入户门；
- 家具常理摆放 `applyFurnitureConventions`：贴墙 + 大面积贴墙旋转 + 避让嵌套/门口/家具；
- 兜底链：JSON 提取容错 → Zod 校验 → 模板/常理兜底，**LLM 再飘也不产出非法场景**；
- 布局多样性：未指定 `side` 的房间贪心均衡分配到走廊两侧。

**第二代的剩余瓶颈**（催生第三代的直接原因）：

1. **表达上限被模板词表锁死**：契约里没有的布局（L 形、环形动线、院落）无法表达——不是 LLM 不够聪明，是语言里没这些词；
2. **整屋快照契约**：改一个房间 = 重写整屋 JSON，token 高、LLM 可能顺手改动无关房间、局部修改做不到；
3. **单向管线**：手动编辑改的是 v1 绝对坐标，对话上下文里只有旧 v2 快照，**两者互相看不见**——用户拖完房间再让 AI 改，劳动会被覆盖。

---

## 第三代：契约动词化 + 足迹几何 + 双向同步（v3 已实施完成）

**形态**（详见 [design.md](design.md)，决策已评审）：

1. **契约从"快照"变"操作序列"**：LLM 输出 `addRoom/updateRoom/moveRoom/setOpenings` 等增量命令，执行器逐条确定性执行、失败单条回滚；`macro` 复用第二代布局引擎作兜底，快照输出走 diff 适配器兼容；
2. **几何从"矩形盒子"变"正交多边形足迹"**：L/U 形、内凹空间可表达；墙段从足迹边生成（推导 + 显式开洞双层）；新增 `window` 图元；Phase 5 预留楼层/楼梯/风格；
3. **管线从"单向"变"双向"**：手动编辑记录为与对话 op 同构的日志，喂回 LLM 上下文（当前场景摘要 + 最近改动）——人在 AI 改过的版本上继续，AI 在用户改过的版本上继续；
4. **平面图自由编辑**：拖顶点、画墙拆房、点墙放门窗，全部产出同构 op，共享撤销栈与对话上下文。

### P1 里程碑（2026-08-09，已实施）

v3 数据模型落地（纯重构，验收：旧数据可打开 + 214 用例全绿 + 截图无回归）：

- **v3 内部格式**：`SceneModel{version:3, root:HouseNode{levels}}` → `RoomNode{footprint 顶点环, height, doors/windows 显式开洞, furniture, nestedRooms}`；房间不再存 position/dimensions，由 `lib/footprint.ts` 纯函数推导（`roomCenter/roomDims/nodePosition/nodeDims`）；
- **墙体泛化为足迹边**：`WallPlan.edges`（每边 axis/line/start/length/dir/shared + 段），段局部坐标以边起点为 0；相邻判定从"四面对齐盒子"泛化为"足迹边共线重叠"，规则不变；新增 `window` 段与显式开洞覆盖层（`applyOpenings`）；
- **渲染适配**：足迹 Shape/Extrude 地板（非共享边外扩墙厚）+ 沿边墙段（轴 'z' 边 -90° 旋转由边轴推导，镜像 hack 自然消失）+ 窗洞渲染；
- **迁移三路径**：`migrateModel`（幂等）覆盖 本地项目 JSON / 旧分享口令（无前缀兼容 + 新口令 `wc3:` 前缀）/ localStorage 持久化（store persist migrate）；
- **示例模型几何不变**：houseBounds 12.3×10 断言原值通过，截图无回归。

### P2 里程碑（2026-08-09，已实施）

契约动词化落地（验收：生成/多轮/撤销/分享全链路可用 + 253 用例全绿）：
- **ops 操作契约**：`types/ops.ts` + `schemas/ops.schema.ts`——当时 11 种操作（setHouse/macro/addRoom/updateRoom/removeRoom/moveRoom/家具三件套/setOpenings/addAdjacency；后 P3 补 `nestRoom`、P4 补 `splitRoom`/`mergeRoom`，现共 **14 种**），Zod 判别联合白名单，`{"version":3,"ops":[...]}` 或裸数组均可解析；
- **确定性执行器**（`lib/executor.ts`）：逐条 try/catch，失败仅跳过该条；`macro` 直接构造 v2 HouseNode 复用 `resolveLayout`（老引擎零浪费）；`addRoom`/`moveRoom` 支持 `relativeTo` 贴靠（无缝共墙）、无提示排东侧；`custom` 支持显式 `footprint` 顶点环（L/U 形）；执行结束统一 `normalizeContainment`（auto 批次 + 家具常理兜底）+ 楼层高度刷新；
- **快照容错路径**：LLM 输出旧式 v2 快照时 auto → 映射 `macro`（与旧行为一致）、custom → `diffSceneV2` 按 id 递归 diff 成 ops 再执行（改名/改尺寸/增删房间/家具增删改，空 diff 场景不变）；
- **提示词重写**：从"输出整屋 JSON"改为"输出操作序列"——无固定模板、`macro` 仅整体重排时用、多轮基于「当前房屋状态」摘要修改（id 复用、只输出必要操作）；
- **多轮上下文**：`generateModelFromChat` 注入当前场景摘要（房间/家具 id·名称·尺寸），替代整段 v2 JSON 回传（token 优化 + 摘要格式属 P3 继续演进）；
- **墙段渲染映射回归修复**（坑 41）：P1 把墙段局部坐标改为「以边起点为 0」（坑 37）但渲染 group 仍锚在边中点，导致所有墙向边尾端漂移半个边长；修复为锚边起点（`wallGroupPosition`）+ 抽出 `segmentWorldRange` 并加集成回归测试（段世界区间不得越出房间足迹边界）。

### P3 里程碑（2026-08-09，已实施）

双向同步落地（验收：手动编辑后对话能看到改动 + 281 用例全绿，补强后最终 307 用例全绿）：

- **编辑 op 日志**（`lib/editOps.ts` 的 `editDiffToOps` + `useChatStore.editOps`）：手动编辑（属性面板/Gizmo/位移微调）提交时把「编辑前 → 编辑后」diff 成单条同构 op——家具位移 → `updateFurniture.patch.position`（相对所在房间中心，v2 语义）；房间位移/改尺寸 → `updateRoom.patch.footprint`（世界坐标顶点环）；改名/层高 → 对应 patch；无实际变化不记录。日志上限 50、会话内不持久化；Gizmo 整次拖拽记一条；撤销/重做栈维持整场景快照（行为不变）；
- **对话上下文改造**：`generateModelFromChat` 注入「场景摘要 + 手动编辑日志」；`toChatHistory` 剔除助手消息中的纯 JSON（上一轮 ops 原文由摘要替代，token 省 80%+），用户消息与文本助手消息保留——"我拖了个房间，再让 AI 继续改"成立（AI 基于用户改过的版本工作，反之用户改过的东西不再被覆盖）；
- **日志生命周期**：`setScene`/`resetScene`（生成成功/打开项目/加载示例/口令还原/撤销生成）与 `clearConversation` 清空编辑日志（旧日志描述的是已替换的场景）；系统提示词补充"不得原样重复编辑日志中的操作"。
- **验收后的用户反馈补强**（坑 42-48）：流式回复截断自动补全闭合括号 + 双编码 JSON 解包；`setHouse` 迁移入户门（entranceRoomId/entranceDir）；方向一致性（世界锚定罗盘 + 右上角投影罗盘 + 平面图标准地图）；卫生间单门规则；`nestRoom` 内嵌（避门口禁区 + 家具推出占地）；贴靠对齐走廊边线；`moveRoom` 取消内嵌 + 落点空侧回退。

### P4 里程碑（2026-08-09，已实施）

平面图自由编辑落地（验收：纯手动从零搭一套房、全操作可撤销 + 343 用例全绿）：

- **纯函数库 `lib/planEdit.ts`**：网格吸附（0.1m）、`dragVertexFootprint` 正交顶点拖拽（被拖顶点取网格点、前驱/后继沿边滑行、其余不动）+ `footprintValid` 校验（每边轴对齐 ≥ 0.3m、非相邻边不相交——自交/自触拒绝，notes §5.5 落地）、`snapRoomTranslation` 贴墙吸附（网格先行 + 边对齐：线差 ≤ 0.25 且区间重叠 ≥ 0.5）、`hitWallOnEdge`/`collectWallHitEdges` 墙命中（与渲染 `computeAllWallPlans` 同源）、`splitRoomLayout`/`mergeRoomsLayout` 拆合布局；
- **新操作进契约**：`splitRoom`（矩形沿轴线切两半，原房间保留 id 与西/南部分，家具/嵌套/开洞按中心与边重映射，**共墙自动开门且门加在渲染侧** `sharedWallOwner`）、`mergeRoom`（并集面积守恒才合并，keep 保留，入口迁移，keep 嵌套在 remove 内交换角色防丢房间）；`setOpenings` 新增 `edgeIndex`（精确指边，非矩形多边可用）与 `remove: true`（删除开洞，补齐 P2 已知边界）；
- **交互层 `PlanEditLayer`**：渲染在平面图镜像 group 内（指针经 `worldToLocal` 还原足迹坐标，坑 49），五种工具（选择/移动/顶点/门窗/拆房/合并）产出同构 op——拖拽走「预览不记历史 + `commitPlanEdit` 一次提交」模式（坑 52），非拖拽走 `applyPlanOps`（执行器 + 撤销栈 + 编辑日志三合一）；R3F 指针捕获保证拖拽不中断（坑 53）；门窗工具带门/窗切换与已有开洞标记（点已开门窗即删除）；
- **store**：`planTool`/`openingKind` 会话内状态 + `previewFootprint`/`commitPlanEdit`/`applyPlanOps`；工具栏（HomePage 平面图视图左上，i18n 双语 + 逐工具提示）。

### 方向一致性补强（2026-08-09，坑 26 全面反转）

用户反馈"3D 与平面图左右相反"：世界 +x=东、+z=北 是**左手系**，相机在南侧朝北看时东必然显示在屏幕左侧（左东右西），而平面图经镜像已是标准地图（左西右东）——坑 26 原文"面向北、东在左"是事实错误。最终方案：**3D 与 2D 平面图内容共用同一个镜像组 `scale=[-1,1,1]`**，默认相机保持南侧正对入户门，两视图统一呈现**上北下南、左西右东**。三处镜像补偿：右上角罗盘按相机投影时把世界方向 x 取反（`CornerCompassSensor`）；**Gizmo 移到镜像组外渲染**、代理坐标 x 取反与镜像内容对齐（坑 55，避免手柄方向与拖拽效果视觉反转）；世界锚定罗盘在组内自动随内容镜像。

### 平面图增强与编辑体验补强（2026-08-10，路线图项，非 P5）

README 路线图「2D 平面图增强」落地（验收：370 用例全绿，新增 planGeometry 门窗符号/尺寸线 + modelTree 移动带动家具 + furniturePresets 新种类 + store 尺寸开关用例）：

- **家具足迹**：平面图模式下 3D 家具网格不再渲染（`planMode` 透传 `ModelNodeView`），改以 2D 足迹呈现——半透明填充 + 轮廓 + 朝向标记（床画床头板、其余画背侧贴墙线），点击可选中；
- **门窗符号**：与 3D 墙体方案同源（`computeAllWallPlans`）——门扇线 + 90° 开启弧线（入户门暖橙）、窗洞双线（浅蓝），纯函数 `doorLeafLine`/`doorArcPoints`/`windowHatchLines`（planGeometry.ts）；
- **房间尺寸线**：顶层房间内部标长/宽（`roomDimLines`，< 2m 边跳过）；**尺寸标注一键开关**（工具栏第二行「尺寸」按钮，`useModelStore.showPlanDims` 会话内）——尺寸信息覆盖房间的用户诉求；房间标签恒只显示名称（不再重复标注长宽）；
- **移动房间带动家具**（用户诉求）：`modelTree.translateRoomContents` 统一平移足迹 + 家具 + 嵌套房间（相对关系不变），覆盖属性面板微调/复位、X/Z 数值框、Gizmo 拖拽、平面图移动工具、LLM `moveRoom`；`updateNodeFootprint` 纯平移检测保证编辑日志回放行为一致；
- **家具 13 → 20 类**：新增 浴缸（长边贴墙特判）/床头柜/梳妆台/鞋柜/灶台/烤箱/微波炉（词表顺序敏感：床头柜在「床」前）；
- **体验修复**：微调按钮顺序（第一行 东北上、第二行 西南下）；罗盘标签按各方向自身半宽/半深 + 2.8m 边距定位（旧 max 半宽导致东字遮挡东侧「总宽」尺寸标签）；操作提示条空文案不再渲染（黑底空胶囊）。

### 移动端横屏支持（2026-08-10，README 路线图项）

README 路线图「移动端基础适配」以**横屏限定**方式落地（验收：375 用例全绿，新增 OrientationGuard 4 + HomePage 移动端面板 1 用例）：

- **竖屏引导**：`OrientationGuard` 全屏覆盖层（**阈值 A**：JS 判定 `宽度<768 且 高度>宽度` 才拦——手机竖屏提示旋转，手机横屏/iPad/桌面零影响；**应用层不卸载**，旋转回来即时恢复不丢状态）；
- **紧凑布局**：JS 判定（`宽度≤760 或 高度≤480`）给 `<html>` 加 `wc-compact` 类，样式由类门控（侧边栏 200→160、聊天栏 320→280、工具栏横向滚动、状态栏换行、设置页 API 表单单列、**平面图工具栏移动端改为「工具」+「尺寸」两个独立常驻按钮**——工具按钮呼出两列网格面板（门窗/提示在内）可上下滚动、选工具即关闭，**尺寸开关不放面板内**（用户反馈面板内点不到），罗盘缩小 108→68px）——**不用媒体查询**：小米系统浏览器等对媒体查询视口判定不可靠（`pointer: coarse` 与 `max-height` 两轮均实测漏命中），JS 视口恒为 CSS 像素最稳；桌面正常窗口永不命中；
- **触控正确性**：Canvas `touch-action: none`，平面图拖拽与 OrbitControls 双指缩放不受浏览器手势劫持。
- **修复**：罗盘缩小后标签叠字——`box-sizing: border-box` 使 `clientWidth`（68→66）算出的偏移 23 被 `radius < 24` 守卫拦截，标签停圆心；改为 `Math.max(size/2-10, 20)` 并删除提前 return（坑 63）。

**决策**：移动端只做横屏。竖屏用「请旋转屏幕」引导，不做竖屏重排——桌面布局在横屏手机上基本可用（667px 以上），竖屏适配投入产出比低。

### 手动编辑避让门口（2026-08-10，notes 坑 15 已知限制修复）

属性面板 / Gizmo / 平面图把家具拖进门洞通道后不再被弹开的**已知限制**被补齐（验收：376 用例全绿，新增 modelTree 1 用例 + 4 个既有测试场景调整）：

- **统一兜底**：`normalizeContainment` 把与渲染同源的门口禁区（`computeDoorZones` + `doorZoneRect`，含入户门，深 `DOOR_CLEARANCE=1m` × 门宽 0.9m）并入 `pushOutOfRects`——手动编辑与 LLM 生成（custom 显式坐标堵门同样兜底）走同一约束路径，与生成路径常理摆放（`applyFurnitureConventions`）行为一致；
- **`pushOutOfRects` 候选扩展**：候选对**所有**禁区生成（此前只对当前重叠禁区取候选——家具推出嵌套卫生间时恰好撞进门区，重叠数不变被"无改进"拒绝而原地不动，几何有解却找不到）；选择全局重叠最少的落点，确定性不变；
- **已知边界**（已记入坑 15）：嵌套房间（如卫生间）内部的门区不参与避让（`computeDoorZones` 只遍历顶层，与 `furniturePlacement` 一致）；被门区/嵌套夹到只剩唯一安全位的家具，越界拖拽会回弹原位（编辑日志 diff 为空不记 op，坑 18 语义）。

### 全新 UI 改版（2026-08-12，基于 ui-preview.html 落地）

以 `docs/ui-preview.html` 视觉稿为基准的**全面换肤与布局重构**（验收：388 用例全绿，HomePage 新增空态卡 3 用例）：

- **暖色浅色主题**：全局 CSS 变量由深色切换为米纸暖色系（`#e2dccb` 底、绿色强调），3D 渲染同步换肤——场景背景/网格线/家具与走廊中性色（`palette.ts` 按浅底可辨性重调）/选中高亮/门窗符号/平面图标注与罗盘；
- **移除侧边栏**：品牌「言筑 WordCraft」入顶栏左侧，首页/设置导航入顶栏右侧图标（NavLink + tooltip）；设置页顶部加「← 首页」返回入口；
- **顶栏分组**：场景（示例/清空场景）、编辑（撤销/重做）、对话/分享/截图/帮助、右侧 保存/项目库/导航/语言/API 徽章（未配置 → 链接设置）；「清空」改名「清空场景」；
- **底部对话抽屉**（push 布局）：取代左侧 320px 聊天面板——折叠仅剩输入条、展开最大 55vh；顶栏「对话」按钮联动高亮；生成动画圆点 + 耗时；撤销生成/清空对话按钮行；API Key 未配置黄色提示条；发送自动展开；
- **空态引导卡**：无场景时画布中央"用一句话，生成你的房子" + 3 个示例标签（点击填入输入框）+ **未配置 API Key 时提示可先加载示例模型**；
- **独立「截图」按钮**：直接下载无水印 PNG（分享对话框保留带水印截图 + 口令流程）；**属性面板可拖动**（按住头部拖拽，会话内记住偏移）；**R 键复位视角**（状态栏视角按钮组移除，键盘平移保留）。

### 生成链路与几何确定性补强（2026-08-12，全部按 notes §2 原则 7"挖根因"落地）

用户反馈驱动的六处根治（验收：388 用例全绿，新增/重写 13 用例）：

- **`macro.name` 容错修复**：模型把整屋名填进布局类型字段（`"name":"三室一厅一厨"`），Zod 拒绝整条 macro → 输出"全部无效"。`parseOps` 前过 `repairMacroName`——按 params 确定性推断布局类型（有 corridor → corridor；有 centerRoomId → living；有 rooms → custom），并把原 name 移入 params.name 保住整屋名；
- **房间引用支持名称**：LLM 不给房间 id 直接用房间名引用（`setOpenings`/`setHouse`/`relativeTo`）时全部失效。`findRoom`/`mapRoom`/`addEntranceDoor` 按 id 优先、名称回退（确定性首次匹配）；`setHouse.entranceRoomId` 落库解析后的真实 id；
- **`macro` custom 房间支持 `relativeTo`**：schema 悄悄丢弃导致所有房间落原点"全塞一块"。`RoomSpec` 补 `relativeTo`，`resolveCustom` 按列表顺序贴靠（引用可用 id 或名称）；
- **无走廊自由布局直接开门**：custom 无走廊时"私密只连走廊"规则把卧室封死（只能从卫生间进出，布局"错乱"）。`computeWallPlan` 按 `hasCorridor` 门控——无走廊时私密房间与开放空间直接开门（坑 11 修正）；
- **入户门与显式开洞互让**：门与窗在同一面墙上互不相让——先窗后门门被挤小、先门后窗大窗被劈成两段（坑 65）。`applyOpenings` 先切墙、`addEntranceDoor` 后放置：门只开在 ≥0.9m 实心段、入口墙放不下按确定性顺序换外墙，窗保持完整一段；
- **家具常理摆放修复**（坑 66）：① auto 分支去掉"先 normalize 再摆放"（床被推出门口后北上墙，占掉衣柜的墙面导致重叠）；② `slideAlongWall` 改迭代滑动 + visited 震荡防护（"避开卫生间却撞上已放家具"）；③ 重叠判定必须逐禁区判断；④ **嵌套房间避开父房间门口禁区**（坑 47 的 macro 路径版本：`avoidNestedDoorZones` 布局后统一检查，内卫默认东北角不再压门）。

### 代码审查修复批次（2026-08-13，坑 70-73 + 工程化，版本标记 v1.5.0）

全面代码审查后的缺陷修复批次（验收：403 用例全绿，新增 15 用例；全部是"静默"类缺陷——不报错、不崩溃，但行为与用户预期/契约不符）：

- **生成竞态防护**（坑 70）：发送时快照场景引用（`generationBaseRef`），返回后场景已变（生成期间手动编辑/打开项目/加载示例）则 `confirm` 是否覆盖，取消保留用户编辑；**无 API Key 不再清空输入草稿**；
- **名称引用契约修复**（坑 71）：`findRoom` 支持按名称回退但 modelTree/planEdit 的变更函数只按 id 匹配——按名称的 `updateRoom`/`removeRoom`/`splitRoom`/`mergeRoom`/`moveRoom`/`nestRoom` 全部"静默成功但零变更"。executor 各 apply 函数先解析真实 `room.id` 再变更，`moveAdjacent` 自引用判定/`pickFreePlacement` 排除同改；新增 7 条回归测试；
- **项目库房间数恒 0**：`ProjectLibraryDialog` 读 `root.children`（v1 结构），v3 房间在 `root.levels[0].rooms`——修正并补测试；
- **Ctrl/Cmd+R 被劫持**：键盘监听无 `mod` 守卫拦截浏览器刷新快捷键——加 `if (mod) return`；
- **墙体方案共享缓存**（坑 72）：`computeAllWallPlansCached`（WeakMap 按场景引用）——渲染层三个组件（Viewport3D/PlanEnhancements/PlanEditLayer）同场景引用只算一次，拖拽预览每帧省 2/3 重复计算；缓存 Map 只读约定写入注释；
- **PlanRig 取景依赖 scene 引用**（坑 73）：拖拽预览每帧新 scene → 每帧重取景并 `saveState()`（视图跳变、复位基准被覆盖）——改依赖 `houseBounds` 数值签名；
- **CI 补质量门**：新增 `.github/workflows/ci.yml`（PR + main 推送跑 lint/format:check/typecheck/test），`package.json` 补 `typecheck` 脚本——此前唯一 CI 只 build 部署、从不跑测试；
- **顶层 ErrorBoundary**：渲染异常（如持久化数据损坏）不再白屏，展示兜底页 + 「重置本地数据」（清 localStorage 重载）与「重试」入口。

**演进规律**：三代迭代的共同线索是**逐步把"不可控"移出 LLM、把"表达力"还给用户**——

- 第一代：几何不受控 → 第二代把几何交给代码（确定性）；
- 第二代：布局表达受限 → 第三代把布局词表换成操作动词 + 自由足迹；
- 第三代：编辑自由度由"代码能表达的模板"提升为"用户能画的任意正交形状"，同时保证对话/编辑/撤销/分享全链路同构。

---

### 工程化与代码结构整理（2026-08-13，P0+P1 代码审查建议批次）

全面审视后的工程化整理（验收：430 用例全绿，新增组件测试 12 + api 测试重写；全仓格式一次收敛）：

- **移除 axios 统一 fetch**：流式主路径本就是 fetch，axios 仅剩 `testConnection` 一处——双 HTTP 栈浪费 bundle 约 13KB gzip。`createApiClient`/`describeAxiosError` 删除，统一 `fetch` + `describeHttpError`；**`testConnection` 遇 `max_tokens` 被拒（HTTP 400，如 o1 系列）自动降级 `max_completion_tokens` 重试一次**；`SettingsPage.runTest` 补 aliveRef 卸载守卫（坑 33 同款）。
- **版本号单一来源**：状态栏硬编码 `v1.5.0` 改为 vite `define: { __APP_VERSION__ }`（从 package.json 注入），发布不再漏改。
- **HomePage 瘦身（788 → ~490 行）**：平面图工具栏（移动/桌面两套重复 JSX + 双份工具清单）收拢为 `components/ui/PlanToolbar.tsx`；调试面板（含复制/下载重复逻辑）拆为 `components/ui/DebugPanel.tsx` + `debugLog.formatDebugText`；键盘快捷键拆为 `hooks/useKeyboardShortcuts.ts`；移动端紧凑判定提为 `lib/viewport.ts`（`isCompactViewport`/`isPortraitBlocked`）+ `hooks/useMobileCompact.ts`，与 `OrientationGuard` 共享阈值（坑 61 判定逻辑单一来源）。
- **样式按域拆分**：`global.css` 2017 行单文件拆为 15 个分区文件（variables/base/home/toolbar/chat/property/compass/debug/dialog/settings/project/share/plan/mobile/error-boundary），`global.css` 仅保留 @import 链——**@import 顺序 = 原层叠顺序，零规则改动**（行区间脚本切分，逐行校验）。
- **组件测试补齐**：`PropertyPanel`（尺寸 Enter 提交/非法回显/微调步长/复位/关闭）、`ChatDrawer`（发送/Enter 与 Shift+Enter/禁用态/生成摘要/API 提示条/折叠）、`HomeToolbar`（回调/禁用态/API 徽章/语言切换）共 12 用例；`api.test.ts` 随 fetch 统一重写（含降级重试断言）。
- **CI 补 format:check 门**：此前 54 个文件存在格式漂移导致该门被注释（注释与文档声称的「CI lint/format/typecheck/test」不一致）——全仓 `npm run format` 一次收敛后正式入 CI。
- **顺手清理**：tsconfig 移除无使用的 `allowImportingTsExtensions`（新增 `resolveJsonModule` 供 vite.config 读 package.json）；`chat.generatedModel` 文案更新（方向键视角 → 平面图自由编辑）。

### 全面审查与重构批次（2026-08-13，坑 74-76）

对框架/实现/UI/文档的全面审视后落地（验收：468 用例全绿，30+ 测试文件；typecheck/lint/format 全过）：

- **数据入口加固（坑 74）**：`migration.ts` 的 v3 分支此前只查 `root.type/levels` 就用 `as unknown as SceneModel` 放行——畸形分享口令/损坏项目数据可注入非法模型（对比 v1 有完整 zod，v3 反而裸奔）。新增 `sceneModelV3Schema`（递归房间/家具/开洞/楼层全结构校验），校验通过才放行，失败返回 null 走既有降级提示。
- **几何共享模块**：重叠判定（executor 两处、modelTree、furniturePlacement 四处复制）、房间平移（layout.translateRoom ≡ modelTree.translateRoomContents）、足迹相等（executor/editOps 双份）、嵌套落点符号（NEST_CORNER 双份）、"id 优先名称回退"查找（executor/roomGeometry/layout 三处）全部收拢到 `lib/geometry.ts`——消除"一处修容差、另一处漏修"的漂移风险。
- **常量集中**：`lib/constants.ts` 单一来源（EPSILON/墙厚/门宽/邻接容差/门口留空/默认层高/房间间隔/走廊宽），roomGeometry 同名常量改为再导出；chat 邻接判定 GAP 0.4 与墙体验证共用 `ADJACENCY_GAP`。
- **executor 按 op 组拆分（1072 行 → 目录）**：`lib/executor/`（index 门面 + core 逐条容错执行 + rooms 整屋/房间 + furniture 家具 + openings 开洞 + diff 快照 diff + shared 树操作辅助），依赖单向无环，公共 API 原样再导出（chat.ts/测试零改动）。
- **脏标记收敛到 useProjectStore（坑 75）**：`dirty` 真值此前由 HomePage 的 `lastSavedJsonRef` + effect 推算回写（双源易漂移），且 `previewSelected`/`previewFootprint` 拖拽每帧换 scene 引用触发**每帧 JSON.stringify 全场景**。现改为 store 内 `savedJson` 快照 + 订阅只在「干净 → 变化」时比对一次（拖拽首帧置脏后跳过），撤销/重做回到已保存状态由 `syncDirtyWithSaved` 一次性清除；HomePage 相应逻辑抽为 `hooks/useDirtyTracking.ts`。
- **SSE 流式测试补齐（坑 76）**：`streamChatCompletion` 是零测试的最关键生产路径——补分片边界拼接/[DONE]/坏行忽略/空 delta/流结束/HTTP 错误透传/无 body/网络失败/读取中断/用户中止（AbortError）共 10 用例。
- **extractModelJson 支持纯 ops 数组输出**：提示词允许"直接输出 ops 数组"但提取只认 `{` 开头；补 `[` 直出与代码块内数组提取。
- **对话框 a11y 收敛**：ShareDialog/ProjectLibraryDialog/HelpDialog 三处复制改为通用 `components/ui/Dialog.tsx`（role=dialog + aria-labelledby + aria-modal + Escape 关闭 + 遮罩点击关闭 + 打开聚焦首个可聚焦元素 + Tab 焦点陷阱 + 关闭归还焦点）；ShareDialog 删除按钮/属性面板关闭按钮补 aria-label，设置页 API Key 单选补可访问名。
- **i18n 补漏与死代码清理**：语言切换按钮（HomeToolbar/LanguageToggle 双份硬编码）与 schema 错误文案入词典（`lang.switchToZh/En`、`error.noOps`、`error.unknownFormat`）；删除 7 个死 key（nav.footer/home.viewTitle/home.pan*Title/home.resetView）与死 CSS（`.api-hint__link`、`--danger-soft`）。
- **HomePage 再瘦身（~480 → ~390 行）**：对话生成链路（send/撤销生成/生成计时/竞态防护）抽为 `hooks/useGeneration.ts`，脏标记订阅抽为 `hooks/useDirtyTracking.ts`。
- **测试补齐**：PlanToolbar（桌面工具行/移动端弹出面板）、LanguageToggle、lib 薄测试（viewport/palette/sampleModel/watermark）、migration 畸形 v3、useProjectStore 快照与 syncDirtyWithSaved。
- **文档同步**：README 双版技术栈 Axios→fetch 修正、design.md §9 验收表补行与数字统一、notes.md 坑号重排、ui-preview.html 补"仅供参考"标注。

## 给后来者的三条主线经验

1. **不要回到"LLM 直接给绝对坐标"**：几何确定性是一切（撤销/测试/分享/多轮）的基石；
2. **契约升级的方向是"动词化"而非"字段堆叠"**：快照再怎么加字段，局部修改与编辑回流问题依然存在；
3. **自由不是去掉约束，而是换更对的约束**：模板 → 操作 → 约束图（二期），每一步都在扩大表达空间的同时保留确定性兜底。
