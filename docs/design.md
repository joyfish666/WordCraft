# 言筑（WordCraft）设计方案 —— v3「自由设计」

> 版本：v3 草案 · 状态：已评审，P1（数据模型 v3）、P2（契约动词化）、P3（双向同步）与 P4（平面图自由编辑）已实施 · 配套文档：[技术架构（现行实现）](architecture.md) · [版本演进](history.md) · [开发注意事项](notes.md)

> **P1 进度**（2026-08-09 完成）：§3 数据模型 v3 已落地——v3 类型、`migrateModel` 迁移（项目 JSON/分享口令/持久化三路径）、足迹渲染（Shape 地板 + 沿边墙段）、`window` 段与显式开洞覆盖层。验收达标：旧数据可打开（迁移测试）、用例全绿（214）、示例截图无回归（houseBounds 断言不变）。
>
> **P2 进度**（2026-08-09 完成）：§4 契约动词化已落地——ops 操作契约（11 种操作，Zod 判别联合）、确定性执行器 `lib/executor.ts`（逐条容错 + `macro` 复用旧引擎 + v2 快照按 id diff 容错）、提示词重写（输出操作序列 + 多轮场景摘要上下文）。验收达标：生成/多轮/撤销/分享全链路可用（253 用例全绿）。
>
> **P3 进度**（2026-08-09 完成）：§5 双向同步已落地——手动编辑（属性面板/Gizmo/位移微调）经 `editDiffToOps`（`lib/editOps.ts`）diff 成与对话同构的 op 追加进 `useChatStore.editOps` 编辑日志（上限 50，会话内）；对话上下文 = 当前场景摘要（含**邻接表**）+ 手动编辑日志（`toChatHistory` 不再回传助手纯 JSON 的上一轮 ops 原文，用户消息与文本回复保留）。验收达标：手动编辑后对话能看到改动、token 显著下降（281 用例全绿）。期间补强：生成链路容错（流式回复截断自动补全闭合括号 `repairTruncatedJson` + 双编码 JSON 解包，坑 42）、入户门迁移操作（`setHouse.entranceRoomId`/`entranceDir`，坑 43）、方向一致性（世界锚定罗盘 + 右上角投影罗盘 + 平面图标准地图，坑 26 反转）、卫生间单门规则（坑 44）、`nestRoom` 内嵌操作（含避门口禁区与家具推出，坑 45/47）、贴靠对齐走廊边线（坑 46）、moveRoom 取消内嵌 + 落点空侧回退（坑 48，最终 308 用例全绿）。P4 起按 §9 计划推进。
>
> **P4 进度**（2026-08-09 完成）：§6 平面图自由编辑已落地——平面图编辑工具栏（选择/移动/顶点/门窗/拆房/合并）接入 `PlanEditLayer` 交互层：拖顶点改足迹（正交约束 + 网格吸附 + 自交拒绝，`planEdit.ts` 纯函数）、拖房间平移（Gizmo 同款预览/提交 + 贴墙吸附）、点墙放门窗（与渲染同源墙段命中，`setOpenings` 新增 `edgeIndex` 精确指边与 `remove` 删除，补齐 notes §4 已知边界）、画墙拆房间（新增 `splitRoom` op：矩形沿轴线切两半、家具/嵌套/开洞按中心归属、共墙自动开一扇门——门加在渲染侧）、合并房间（新增 `mergeRoom` op：并集为合法矩形才合并、共墙开洞丢弃、入口房间迁移）。全部产出同构 op 走统一执行器（`applyPlanOps`）+ 快照撤销栈 + 编辑日志回流对话。验收：343 用例全绿（新增 planEdit 21 + executor 新用例 + store 新用例）。

本文档描述言筑下一代的完整设计方案：在不推翻"语义/几何分离"这一已验证核心的前提下，让用户能够**自由输入、自由布局、自由编辑**，真正设计出自己心中的房屋。

## 1. 目标与问题

### 1.1 目标

用户的"自由"由三层构成，缺一不可：

1. **输入自由**：想说"带院子的二层小楼，客厅要有落地窗"就能说，不被固定模板/词表绑架；
2. **布局自由**：L 形、U 形、环形动线、错层、院落……几何上表达得出来；
3. **编辑自由**：直接上手画/拖/改，改完还能继续对话，人和 AI 的修改互相可见。

### 1.2 现状的三个瓶颈

| 瓶颈 | 现状 | 后果 |
|------|------|------|
| 数据结构 | 房间 = 矩形盒子，墙段由盒子四边推导（`roomGeometry.ts` 的共线重叠判定） | L 形/内凹空间无法表达；无窗、无楼梯、无楼层 |
| 契约形态 | LLM 每次输出**整屋快照** JSON（v2），改一个房间 = 重写整屋 | 局部修改做不到、token 成本高、LLM 重平铺可能顺手改动无关房间 |
| 管线方向 | 单向生成：LLM → v1 模型；手动编辑（v1 坐标）**无法回流**到对话上下文 | 用户手动拖完房间再对话，AI 看不到，基于旧快照覆盖用户的劳动 |

### 1.3 设计原则（保留与改变）

**保留**（已被验证正确的核心）：

- **LLM 出语义、代码算几何**：LLM 擅长"建什么、怎么连、多大"，代码保证"无缝、连通、闭合、不穿模"；
- **确定性**：同一输入 → 同一输出，撤销/重做/测试/分享口令全部依赖它；
- **兜底链**：提取容错 → Zod 校验 → 模板/常理兜底，LLM 再飘也不会产出非法场景。

**改变**：

- 契约从"整屋快照"→ **操作序列**（增量修改，错误半径从整屋缩到单条指令）；
- 几何从"矩形盒子"→ **正交多边形足迹**（footprint，矩形是特例）；
- 管线从"单向生成"→ **双向同步**（手动编辑记录为同构操作日志，喂回 LLM）。

## 2. 总体架构

```
用户自然语言 / 手动编辑操作
        │
        ▼
┌─────────────── 操作总线（统一） ───────────────┐
│  对话：LLM(SSE) → ops 契约 → 逐条确定性执行      │
│  编辑：平面图拖顶点/画墙/放门窗 → 同一套 op       │
│  撤销/重做：同一套 op 栈（粒度=单条 op）          │
└───────────────┬────────────────────────────────┘
                ▼
        v3 场景模型（footprint 几何 + 显式门窗）
                │
        ├─ 渲染层（R3F：Shape 拉伸 + 墙段）
        ├─ 墙体方案（足迹边邻接 + 显式开洞覆盖）
        ├─ 常理兜底（贴墙/避让，仅生成时）
        └─ 双向同步（编辑 op 日志 → 对话上下文）
```

关键点：**对话产生的 op 与手动编辑产生的 op 完全同构**，共享执行器、共享撤销栈、共享给 LLM 的上下文来源。

## 3. 数据模型 v3（Phase 1）

### 3.1 模型结构

```ts
SceneModel { version: 3, root: HouseNode }
HouseNode  { id, name, style?, levels: LevelNode[] }        // 预留多层
LevelNode  { id, height, rooms: RoomNode[] }                // 楼层
RoomNode   { id, name, footprint: Point2D[],                // 正交多边形顶点环（矩形=4点特例）
             height, doors: Opening[], windows: Opening[],  // 显式开洞（覆盖层）
             furniture: FurnitureNode[], nestedRooms: RoomNode[] }
Opening    { edgeIndex, from, to, width }                   // 相对所在边的局部区间
FurnitureNode { id, name, dimensions, position, rotationY } // 盒子，沿用现有定义
StairNode  { id, fromLevel, toLevel, position, dimensions } // Phase 5 预留
```

- `footprint` 为房间平面轮廓顶点环（世界坐标，整屋原点在地面中心），相邻边垂直（正交多边形）；
- 矩形房间 = 4 个顶点的特例，`dimensions` 可由 footprint 推导，兼容迁移；
- 房间高度独立于 footprint，层高仍是 `height`。

### 3.2 墙体"推导 + 覆盖"双层（关键决策）

- **默认墙/门由代码推导**：把现有 `computeWallPlan`（`roomGeometry.ts`）的"四面对齐盒子共线重叠"泛化为"足迹边共线重叠"，规则不变（开放空间不设墙、私密房间不直接开门、卫生间归属、外墙保留、入口南墙入户门）；
- **用户/LLM 显式开洞走覆盖层**：`RoomNode.doors / windows` 显式开口渲染时覆盖推导结果；
- 好处：LLM 与首次生成零负担（不用输出墙），自由编辑窗/门时又是显式的。

### 3.3 渲染适配（✓ P1 已实施）

- 房间从 `<boxGeometry>` 改为 `ShapeGeometry`/`ExtrudeGeometry`（footprint 顶点 → three.js Shape → 拉伸，`ModelNodeView.tsx`）；
- 墙段沿足迹边摆放，删除东/西墙 `-90°` 旋转 hack（`ModelNodeView.tsx` 中镜像问题随边轴统一局部坐标自然消失，轴 'x' 平放 / 轴 'z' `-90°` 由边轴推导）；
- 碰撞/家具兜底（`modelTree.ts` 的 `normalizeContainment`、`furniturePlacement.ts`）从"矩形半宽"改为"点到边距离"（P1 用足迹包围盒近似，P4 拖顶点时精化）；
- 平面图（`PlanRig` / `PlanAnnotations` / `planGeometry.ts`）同步消费 footprint。

### 3.4 迁移与兼容（✓ P1 已实施）

- 新增 `migrateModel(v1 → v3)`：盒子 → 4 点足迹，`entranceRoomId` 保留（`lib/migration.ts`，幂等纯函数）；
- 分享口令（`compression.ts` / `useShareStore.ts`）加版本前缀 `wc3:`，旧口令（无前缀）解码兼容并迁移；
- 项目库（`database.ts` / `useProjectStore.ts`）与 localStorage 持久化（`useModelStore`/`useChatStore` persist version 2）读取时迁移；
- **Phase 1 为纯重构，零新功能**，验收已达成：214 用例适配全绿、旧数据可打开、截图无回归。

## 4. 契约动词化：操作序列（Phase 2 ✓ 已实施）

> **P2 落地实录**（2026-08-09）：本节的 ops 契约、确定性执行器（`src/lib/executor.ts`）与提示词重写（`chat.ts`）均已实施，用例覆盖于 `executor.test.ts` / `chat.test.ts`。实施要点：
>
> - **11 种操作**：`setHouse / macro / addRoom / updateRoom / removeRoom / moveRoom / addFurniture / updateFurniture / removeFurniture / setOpenings / addAdjacency`，Zod 判别联合白名单（`schemas/ops.schema.ts`），类型在 `types/ops.ts`。
> - **执行器**：`executeOps(scene, ops, {furnitureConventions})` 逐条 try/catch，失败仅跳过该条并记录原因；全部执行后统一 `normalizeContainment`（+ auto 批次家具常理兜底）+ 楼层高度刷新。`macro` 直接构造 v2 HouseNode 调 `resolveLayout`，老引擎零浪费。
> - **`addRoom`/`moveRoom` 的 `relativeTo`**：贴靠目标房间某侧无缝共墙（间隔 0，共享墙去重沿用）；无 `relativeTo` 的新房间排到整屋东侧（确定性、不重叠）；显式 `footprint` 提供时以顶点环为准。**约束图求解（多房间约束推理）仍属 Phase 5**，`relativeTo` 仅支持单房间贴靠。
> - **`custom` 升级**：v2 房间规格支持可选 `footprint` 顶点环（L 形/U 形直接表达），`resolveCustom` 直接使用；矩形仍是特例。
> - **快照容错路径**：LLM 输出旧式 v2 整屋快照时——auto 模板直接映射 `macro`（与旧版行为一致），custom 按 id 递归 diff（改名/改尺寸/增删房间/家具增删改），空 diff 场景不变。
> - **多轮上下文**：`generateModelFromChat` 在有当前场景时注入「当前房屋状态」摘要消息（房间/家具 id·名称·尺寸），LLM 靠 id 引用节点修改；历史仍携带上一轮 ops 原文（场景摘要替换整段 v2 JSON 的 token 优化属 P3）。
> - **已知边界**：`updateRoom.patch.side` 对已平铺房间无几何意义（接受并忽略，布局意图改动请用 moveRoom 或 macro）；`setOpenings` 只替换同边同种开洞，暂不支持删除开洞（P4 平面图编辑接入）；家具相对位置 y 沿用 v2 语义（高度一半，非偏移）。

### 4.1 操作契约

LLM 不再输出整屋快照，而是输出一组操作（Zod union 白名单 + id 引用校验）：

```ts
type Op =
  | { op: 'setHouse', name?, style?, entranceRoomId?, entranceDir? }   // entranceRoomId/entranceDir：迁移入户门与方向（P3 补）
  | { op: 'addRoom', id?, name, dimensions?, side?, relativeTo?: { roomId, dir },
      footprint?, furniture?: FurnitureSpec[], nestedRooms?: RoomSpec[] }
  | { op: 'updateRoom', id, patch: { name?, dimensions?, side?, footprint? } }
  | { op: 'removeRoom', id }
  | { op: 'moveRoom', id, relativeTo?: { roomId, dir } }
  | { op: 'nestRoom', id, into, side? }                                // 内嵌为嵌套子房间（P3 补）
  | { op: 'addFurniture' | 'updateFurniture' | 'removeFurniture', ... }
  | { op: 'setOpenings', roomId, side, kind: 'door' | 'window', from?, to? }
  | { op: 'addAdjacency', roomId, neighborId, side }
  | { op: 'macro', name: 'corridor' | 'living' | 'custom', params? }   // 复用旧布局引擎
```

### 4.2 确定性执行器（新 `src/lib/executor.ts`）

- 逐条执行，**每条独立 try/catch，失败跳过并回滚该条**——LLM 再飘也不毁整屋；
- `macro` 操作直接映射现有 `resolveCorridor` / `resolveLiving`（`layout.ts`），老引擎零浪费；
- **快照容错路径**：LLM 偶尔输出整屋快照时，快照适配器按 id diff 成 ops 再执行；
- 执行结果统一过 `normalizeContainment` + 生成时家具常理兜底。

### 4.3 提示词重写（`chat.ts` 的 `buildSystemPrompt`）

- 从"输出整屋 JSON"改为"输出操作序列"；**明确没有固定模板**：用户怎么描述就怎么响应，`macro` 仅在用户不关心布局时使用；
- `custom` 升级：允许显式 footprint 顶点环（L 形/U 形直接表达）；
- 保留规则：id 全局唯一、多轮基于最新状态修改、常理默认尺寸、家具完整性。

## 5. 双向同步（Phase 3 ✓ 已实施）

> **P3 落地实录**（2026-08-09）：本节的编辑 op 日志与对话上下文改造均已实施。实施要点：
>
> - **手动编辑 → op**（§5.1）：`lib/editOps.ts` 的 `editDiffToOps(before, after, id)` 纯函数把一次手动编辑 diff 成单条 op——家具位移 → `updateFurniture.patch.position`（换算为相对所在房间中心，v2 语义）；房间位移/改尺寸 → `updateRoom.patch.footprint`（世界坐标顶点环，可精确回放）；改名/层高 → 对应 patch；无实际变化返回空数组（不记录）。
> - **编辑日志**（§5.1）：`useChatStore.editOps`（上限 50 条，会话内不持久化），`useModelStore` 的 `translateSelected`/`resetSelectedPosition`/`updateSelected`/`commitDrag` 提交时各追加一条（Gizmo 拖拽整次记一条）；**撤销栈维持整场景快照不变**（用户行为不变，op 粒度化属后续优化）。
> - **上下文改造**（§5.2）：`generateModelFromChat` 新增 `editOps` 选项，消息顺序 = system + 历史 + 场景摘要 + 手动编辑日志 + 用户输入；`toChatHistory` 不再回传助手消息中的纯 JSON（上一轮 ops 原文由摘要替代，token 省 80%+），用户消息与文本助手消息保留（多轮意图不断裂）。
> - **日志生命周期**：`setScene`/`resetScene`（生成成功/打开项目/加载示例/口令还原/撤销生成）与 `clearConversation` 时清空——旧日志描述的是已被替换的场景。
> - **验收**：手动编辑后对话能看到改动（日志注入 + 摘要兜底），281 用例全绿（新增 editOps 12 + useModelStore 8 + useChatStore 6 + chat 2）；后续补强（坑 42-48）后最终 307 用例全绿。

### 5.1 手动编辑 → op 日志（✓ 已实施）

- `useModelStore` 的撤销栈从"整场景快照"（`pushPast`）升级为"操作记录"：**每次编辑同时生成一条 op**，追加进 `useChatStore` 的编辑日志；
- 撤销/重做行为不变，粒度从"整快照"降为"单 op"；
- 日志上限（如 50 条），会话内不持久化。

### 5.2 对话上下文改造（✓ 已实施，`chat.ts` + `toChatHistory`）

- 发给 LLM 的上下文 = **当前场景摘要**（房间 id/名/尺寸/邻接表，几十行）+ **最近改动 ops 日志**；
- 替代现在"整段旧 v2 JSON"的 history，token 省 80%+，且手动编辑不再丢失；
- 效果："我拖了个房间，再让 AI 继续改"——AI 基于用户改过的版本工作。

### 5.3 局部重生成（✓ 随 P2/P3 落地）

- 用户提到哪个房间，LLM 用 `updateRoom` 只动那个节点，其余 id/几何不变；
- 与快照 diff 容错路径配合，兼容 LLM 输出全量 JSON 的旧行为；
- P3 起手动编辑以同构 op 回流，LLM 在「摘要 + 编辑日志」上做局部重生成。

## 6. 平面图自由编辑（Phase 4 ✓ 已实施）

> **P4 落地实录**（2026-08-09）：本节的五种编辑能力全部落地，交互层为 `components/viewport/PlanEditLayer.tsx`（渲染在平面图镜像 group 内，指针经 `group.worldToLocal` 还原足迹坐标），几何全部走 `lib/planEdit.ts` 纯函数。实施要点：
>
> - **拖顶点**（§6 第一行）：`dragVertexFootprint` 正交约束——被拖顶点取指针网格点（0.1m 吸附），前驱/后继顶点沿各自边滑行（只改一个坐标），其余顶点不动；结果必须过 `footprintValid`（每边轴对齐且 ≥ 0.3m、非相邻边不相交，自交/自触拒绝，notes §5.5）。预览经 `previewFootprint`（不记历史），松开经 `commitPlanEdit`（快照入撤销栈 + `editDiffToOps` 产出 `updateRoom.patch.footprint` 进编辑日志）。
> - **拖房间平移**：复用 Gizmo 的 `previewSelected`/`commitPlanEdit` 模式；`snapRoomTranslation` 贴墙吸附（网格吸附先、边对齐后：与邻居边共线且线差 ≤ 0.25、区间重叠 ≥ 0.5 时对齐到邻居边线，两轴独立）。
> - **点墙放门窗**：`collectWallHitEdges` 把 `computeAllWallPlans` 的墙段映射为可命中边（含 footprint 边下标），`hitWallOnEdge` 按指针距墙线 ≤ 0.4 命中；实心墙段 → `setOpenings`（新增 `edgeIndex` 精确指边、`from/to` 取命中点居中），门/窗段 → `setOpenings remove: true` 删除（补齐 notes §4 的「无删除」边界）。UI 有门/窗种类切换与已有开洞标记。
> - **画墙拆房间**：新增 `splitRoom` op（`{"op":"splitRoom","id","axis":"x|z","position","name"可选}`）——矩形房间沿轴线切两半，原房间保留 id 与西/南部分，新房间（默认「原名2」）排东/北侧；家具/嵌套房间按中心归属、显式开洞按边重映射（跨切线丢弃）；**共墙自动开一扇门**，门加在**渲染共享墙的一侧**（`sharedWallOwner`，避免坑 43 静默空操作）。
> - **合并房间**：新增 `mergeRoom` op（`{"op":"mergeRoom","keep","remove"}`）——两房间必须为矩形且**并集为合法矩形**（面积守恒判定），keep 保留 id/名称、层高取较大值；家具/嵌套房间保持世界坐标直接并入；开洞重映射（变成内部墙的边丢弃）；remove 是入口房间时 `entranceRoomId` 迁移到 keep；keep 嵌套在 remove 内时交换角色防数据丢失。
> - **工具状态**：`useModelStore.planTool`（select/move/vertex/opening/split/merge）+ `openingKind`，会话内不持久化；工具栏渲染在 HomePage 平面图视图左上（i18n 双语 + 操作提示）。`applyPlanOps`（执行器 + 撤销栈 + 编辑日志三合一）供非拖拽类编辑统一提交。

在已有 `PlanRig` 正交俯视基础上新增编辑模式：

| 操作 | 实现 |
|------|------|
| 拖顶点改足迹形状 | 正交约束（边保持水平/垂直）+ 网格吸附 |
| 拖房间平移 | 复用 Gizmo 平移 + 邻墙吸附 |
| 点墙放门窗 | 命中墙段 → 生成 `setOpenings` op（含删除） |
| 画墙拆房间 | 墙段级：墙中线切分两矩形房，共墙自动生成门洞 |
| 合并房间 | 删共墙，并集为合法矩形时合并 |

- 所有操作产出 op → 统一执行器 + 撤销栈；
- 编辑器产生的 op = 给 LLM 的上下文，对话产生的 op = 可撤销的用户可查操作，**完全同构**；
- 属性面板 / Gizmo 继续兼容（适配 footprint 顶点手柄）。

## 7. Phase 5（可选，二期）

- **约束图布局**：`addRoom` 支持约束参数（"客厅北接阳台""主卧邻主卫"），代码确定性求解，失败降级 `macro`；
- **楼梯/楼层**：`LevelNode` + `StairNode` 自动连通；
- **风格/屋顶**：`style` 驱动调色（`palette.ts` 扩展）与屋顶样式。

## 8. 决策记录（已确认）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 1 几何路线 | 正交多边形 | 自由/成本交点，覆盖 95% 真实户型；全自由角度成本高 3-5 倍 |
| 2 产品定位 | 编辑器为主、LLM 辅助 | 手是最高带宽通道；op 同构不增加重复成本 |
| 3 LLM 契约 | 操作序列 ops | 局部修改 + 编辑回流 + 逐条容错全解决 |
| 4 初始生成 | 模板 macro + custom 自由 | 复用老引擎，风险最低；约束图二期再加 |
| 5 拆分合并 | 墙段级 | 高频场景够用；多边形布尔按需二期加 |
| 6 本轮范围 | P1-P4 全做 | 三段交付（P1 → P2+P3 → P4），风险渐次暴露 |
| 7 新图元 | 窗必做，楼梯/楼层/风格二期 | 墙段枚举加 `window` 成本最低、收益最高 |

## 9. 分阶段实施计划与验收

| 阶段 | 交付 | 验收标准 |
|------|------|----------|
| ~~P1 数据模型 v3~~ ✅ | 模型 + 迁移 + footprint 渲染 + window 段 | 旧数据全可打开、用例全绿、截图无回归（**已完成**，214 用例） |
| ~~P2 契约动词化~~ ✅ | ops 契约 + 执行器 + 提示词重写 | 生成/多轮/撤销/分享全链路可用（**已完成**，253 用例：新增 executor 32 + chat 更新 + 墙段映射回归 3） |
| ~~P3 双向同步~~ ✅ | 编辑 op 日志 + 对话上下文改造 | 手动编辑后对话能看到改动（**已完成**，验收 281 用例，补强后最终 307 用例） |
| ~~P4 平面图编辑~~ ✅ | 拖顶点/画墙/放门窗 + 拆房/合并 | 纯手动从零搭一套房，全操作可撤销（**已完成**，343 用例：新增 planEdit 21 + executor 拆合/开洞 11 + store 6） |
| P5（可选） | 约束图/楼层/风格 | — |

每阶段独立上线：`npm test` 全绿 + 手工回归清单通过后才进入下一阶段。

## 10. 风险与对策

1. **ops 契约 LLM 遵循度** → Zod 白名单 + 逐条容错 + `macro`/快照双兜底，最坏退化到旧模板行为；
2. **footprint 几何（渲染/碰撞/切割）** → 正交多边形算法成熟，矩形路径先保底，测试用属性驱动用例覆盖；
3. **存量数据** → version 前缀 + 迁移函数 + 旧口令降级提示；
4. **工作量** → P1-P4 每阶段独立交付，P1 是纯重构风险隔离。

## 11. 非目标（本轮明确不做）

- 任意角度墙 / 弧形墙（二期评估）；
- 真实材质贴图、物理光照；
- 多人协作编辑；
- 多边形布尔级房间切割（按需二期加）。
