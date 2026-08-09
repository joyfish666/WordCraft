# 言筑（WordCraft）技术文档 —— 现行实现（v3 足迹模型 + v2 语义契约）

> 版本：v2.0 · 更新：2026-08-09。本文档描述**当前代码**的架构与数据契约（v2 语义契约 + v3 足迹几何模型）。P1（v3 数据模型）已实施：数据模型升级为足迹几何 + 显式开洞覆盖层，为纯重构（旧数据可打开、用例全绿、截图无回归）。下一代 v3 完整架构见 [设计方案](design.md)，演进脉络见 [版本演进](history.md)，踩坑记录见 [开发注意事项](notes.md)。

本文档面向开发者和贡献者，描述言筑的核心架构、数据契约与实现细节。项目为**纯前端**应用，无需后端。

## 1. 架构总览

言筑的核心设计原则是**语义与几何分离**：

- **大模型负责语义**：输出"建什么"——房间清单、名义尺寸、布置意图（相对关系），不输出绝对坐标。
- **代码负责几何**：布局引擎将语义确定性平铺为精确的足迹几何（正交多边形），保证无缝共用墙、门连通、房屋闭合。

```
用户自然语言
   │
   ▼
大模型（DeepSeek 等，SSE 流式）
   │  输出 v2 语义契约 JSON
   ▼
Zod 校验（schemas/model.schema.ts）
   │
   ▼
布局引擎 resolveLayout（lib/layout.ts）
   │  平铺为 v3 足迹模型（内部统一格式）
   ▼
已解析模型 SceneModel（types/model.ts + lib/footprint.ts）
   │
   ├─ 渲染层（components/viewport/*）
   ├─ 墙体方案 computeWallPlan（lib/roomGeometry.ts，足迹边分段 + 显式开洞覆盖层）
   └─ 状态层（store/useModelStore.ts）
```

**为什么分层**：一个合理的户型本质是"约束平铺问题"（房间无缝共用墙、对齐、动线），LLM 擅长语义组合但**不擅长空间算术**。让 LLM 直接算绝对坐标会导致缝隙/重叠/不合常理。分层后：LLM 决定"哪些房间、多大、怎么连"，代码保证"无缝、连通、闭合"。

## 2. 数据契约

### 2.1 v2 语义契约（大模型输出）

大模型输出的 v2 模型包含 `layout`（布局模式）与 `children`（房间）——**P1 保持 v2 契约不变**（契约动词化属 P2）：

```jsonc
{
  "version": 2,
  "root": {
    "id": "house1",
    "type": "house",
    "name": "温馨之家",
    "dimensions": { "length": 12, "width": 8, "height": 2.8 },
    "position": { "x": 0, "y": 0, "z": 0 },
    "layout": {
      "mode": "auto",                 // auto | custom
      "template": "corridor",         // corridor | living（auto 时）
      "corridor": { "width": 1.2, "entranceRoomId": "living_room" }
    },
    "children": [
      {
        "id": "living_room",
        "type": "room",
        "name": "客厅",
        "dimensions": { "length": 6, "width": 4.2, "height": 2.8 },
        "side": "left",               // corridor: left/right；living: north/south/east/west
        "children": [
          { "id": "sofa", "type": "furniture", "name": "沙发", "dimensions": {…}, "position": {…} }
          // 可嵌套子房间：
          { "id": "bathroom1", "type": "room", "name": "主卧卫生间", "dimensions": {…}, "side": "north", "children": […] }
        ]
      }
    ]
  }
}
```

关键约定：
- **房间不填绝对坐标**（auto 模式），由引擎平铺；`custom` 模式才需要绝对 `position`。
- **家具 position 相对所在房间中心**，`y` 为家具高度一半（底面贴房间地面）。
- **可嵌套子房间**（如"卧室里面有卫生间"），引擎会渲染在父房间内部。
- **卫生间命名归属**：`X卫生间` 只与其归属房间 `X` 开门（`主卧卫生间 → 主卧`、`走廊卫生间 → 走廊`）。
- **布局模式由大模型按需求选择**：常规住宅 → auto（corridor/living）；明确非常规/自由布局 → custom。

### 2.2 已解析模型（内部统一格式，v3）

布局引擎输出 `SceneModel`（v3，足迹几何），一切具有**绝对坐标**，供渲染/存储/墙体方案消费：

```ts
interface SceneModel { version: 3, root: HouseNode }
interface HouseNode {
  id: string; name: string; style?: string
  levels: LevelNode[]               // 楼层（P1 恒为单层，Phase 5 预留多层）
  entranceRoomId?: string           // 入户房间 id（迁移保留）
}
interface LevelNode { id: string; height: number; rooms: RoomNode[] }
interface RoomNode {
  id: string; name: string
  footprint: Point2D[]              // 正交多边形顶点环（世界坐标，矩形 = 4 点特例）
  height: number                    // 层高，独立于 footprint
  doors: Opening[]; windows: Opening[]   // 显式开洞（覆盖层，P1 无 UI 产出但模型/渲染/墙体支持）
  furniture: FurnitureNode[]        // 家具（绝对坐标）
  nestedRooms: RoomNode[]           // 嵌套子房间（如卧室内卫生间）
}
interface Opening { edgeIndex: number; from: number; to: number; width: number }  // 相对所在边局部区间
```

- **房间不再存 position/dimensions**：中心/尺寸由 footprint 推导（`lib/footprint.ts` 的 `footprintCenter`/`footprintDims`/`roomCenter`/`roomDims` 等纯函数统一提供，属性面板/Gizmo/HomePage 全部经 `nodePosition`/`nodeDims` 访问器消费）。
- 房间高度独立于 footprint；整屋高度 = 楼层高度（墙顶/标注层）。
- **显式开洞覆盖层**（设计 §3.2）：`doors/windows` 显式开口在渲染时覆盖推导结果（`applyOpenings`）；P1 生成器/迁移均产出空数组，UI 暂无入口，能力先落地（渲染 + 墙体 + 单测）。

### 2.3 迁移与版本（migrateModel，lib/migration.ts）

- `migrateModel(input)`：v1 盒子模型 → v3 足迹模型（盒子 → 4 点足迹、`entranceRoomId` 保留、`wall` 类型家具并入 `furniture`、单层 `levels`），**幂等且纯函数**；v3 输入原样返回；非法输入返回 `null`（调用方降级提示，不崩溃）。
- 三条旧数据路径全部走迁移：本地项目库（HomePage 打开项目时）、分享口令（ShareDialog 还原时）、localStorage 持久化（`useModelStore`/`useChatStore` persist `version: 2` + `migrate`）。
- 分享口令编码加版本前缀 `wc3:`（`compression.ts`），旧口令（无前缀）解码兼容——前缀仅用于标识，解码逻辑对两种格式一视同仁。

## 3. 布局引擎（lib/layout.ts）

`resolveLayout(sceneV2): SceneModel` 将 v2 语义模型平铺为 v3 足迹模型（P1 平铺仍产矩形足迹）：

1. **corridor 走廊型**：走廊沿 X 贯穿；房间按 `side`（left=南/right=北）在两侧顺序平铺、无缝贴合；入口房间强制置于南侧并排最前；单房间省略走廊。
2. **living 客厅居中型**：中心房间（`centerRoomId`）居中于原点，其余房间按 `side` 环绕排布。
3. **custom 自由型**：房间直接用 LLM 提供的绝对坐标。
4. **嵌套房间**：`makeRoom` 递归——嵌套房间按 `side` 靠父房间对应**角落**（贴两面墙，`placeNested`）、无提示时靠东北角；门朝父房间内部；`normalizeContainment` 再兜底约束进父房间。**真·内嵌**：`computeAllWallPlans` 为嵌套房间算独立分隔墙方案——与已渲染墙共线且被覆盖的边渲染为 `open`，其余边为内部分隔墙 + 朝父中心的门；`containChildren` 同时把父房间家具（含手动编辑）推出嵌套占地。
5. **整屋包围盒**：所有房间+走廊的足迹求包围盒 → 平移到原点居中（`translateRoom` **递归平移嵌套房间足迹与家具**，否则嵌套房间会脱离父房间）。整屋不存 dimensions（由 `houseBounds` 推导）。
6. 家具相对父房间中心偏移为绝对坐标；`normalizeContainment` 将家具约束进墙内。

**布局惯例**：客厅近入口（南侧）、卧室沿走廊两侧、单间房无走廊、除入户门外房屋闭合。

**家具常理摆放**（`furniturePlacement.ts`，仅 auto 模式 + 示例模型）：靠墙家具（衣柜/橱柜/书桌/沙发等，`isWallAnchored`）贴**最近墙**（保持平行于墙的坐标），**大面积贴墙**——长边（max(长,宽)）沿墙，必要时**交换长宽**实现 90° 旋转（`rotationY` 同步 +90°，渲染器暂不读 rotationY，视觉靠交换后的尺寸生效）；**床例外：短边（床头）贴墙**；再**沿墙滑动**避开三类禁止进入区：嵌套子房间（足迹包围盒 + 墙厚）、**房间门口通道**（`computeDoorZones` 从墙体方案提取门洞，含入户门，`DOOR_CLEARANCE=1m` 深 × 门宽）、已放置的其他家具。独立家具（茶几/餐桌/椅子等，`FREE_STANDING_RE`）保持原位，仅约束进墙内并避让上述禁区。custom 自由布局保留大模型的显式坐标。

## 4. 墙体模型（lib/roomGeometry.ts）

墙体按**足迹边切分为段（segment）**渲染，每段为 实体 / 门 / 开放 / 窗 之一：

```ts
type WallSegmentKind = 'wall' | 'door' | 'open' | 'window'
interface WallSegment { from: number; to: number; kind: WallSegmentKind; entrance?: boolean }
interface WallEdge {
  axis: 'x' | 'z'          // 轴对齐边；段局部坐标以**边起点为 0**（方向恒 + 轴）
  line: number             // 垂直方向的固定世界坐标
  start: number            // 沿边方向起点的世界坐标
  length: number
  dir: DoorDirection       // 外向法线方向（north/south/east/west）
  shared: boolean          // 是否有相邻房间（影响地板外扩）
  segments: WallSegment[]
}
interface WallPlan { edges: WallEdge[] }   // 与 footprint 顶点环一一对应
```

- `footprintEdges(room)`：足迹顶点环 → 轴对齐边（每条边基座为整段 `wall`）；`edgeOf(plan, dir)` 按外向法线取边（矩形每方向恰一条）。
- **相邻判定泛化**（设计 §3.2）：旧"四面对齐盒子共线重叠" → 新"足迹边共线重叠"——对侧边同线（|line 差| ≤ ADJACENCY_GAP）且区间重叠即为邻居，规则不变：共享墙去重、开放空间不设墙、私密房间不互开门、卫生间命名归属、外墙保留、入口南墙入户门。
- **显式开洞覆盖层**：`applyOpenings(plan, rooms)` 把 `RoomNode.doors/windows` 的局部区间切到对应边的实心墙段上（`door`/`window` 段，不影响 `open` 段），先于兜底门判定执行（已开洞房间不再兜底开门）。
- **入户门**：开在入口房间南外墙居中，段标记 `entrance: true`，渲染醒目门扇。
- **嵌套房间分隔墙**（真·内嵌）：`computeAllWallPlans` = `computeWallPlan`（顶层零改动）+ 自顶向下为每个嵌套房间调 `nestedWallPlan` 写入同一 Map。`nestedWallPlan(node, parent, plan, roomById)` 对每面墙做**全量墙线并集查询**——收集同一世界墙线（`|line 差| ≤ WALL_THICKNESS + 1e-6`，容忍浮点贴边）上所有非 `open` 段的覆盖区间，被覆盖处切为 `open`（由外层墙围护，避免与父墙/邻居墙双重墙）；其余边为内部分隔墙，门开在朝父中心一面（退化时最近含 `wall` 段的面，四面全覆盖则不开门）。段切分后用 `cleanSegments` 合并相邻同类型段并去除浮点噪声微段。
- **门口禁区**（`computeDoorZones`/`DOOR_CLEARANCE`）：从墙体方案提取各顶层房间门洞（含入户门），供家具常理摆放避让；与渲染用 `computeWallPlan` 同源，保证门洞位置一致。

## 5. 渲染管线（components/viewport/*）

- **SceneViewer**：R3F Canvas（`gl={{ preserveDrawingBuffer: true }}` 供截图读取缓冲）；初始 45° 南视角正对入户门；内置实时**东西南北罗盘**（`Compass` 每帧读取相机方位角旋转 N/S/E/W 玫瑰）。
- **Viewport3D**：从 `scene.root.levels[0].rooms` 提取顶层房间，计算所有房间（含嵌套）的墙体方案（`computeAllWallPlans`）；`screenshotMode` 时隐藏网格/坐标轴。
- **ModelNodeView**：递归渲染层级模型——
  - **房间外壳**（`RoomShell`）：**足迹地板** = footprint 沿非共享边外扩一个墙厚（`floorPolygon` 逐边求偏移线交点，矩形下与旧"四边外扩"语义一致），`THREE.Shape` + `ExtrudeGeometry` 拉伸 `FLOOR_THICKNESS`（旋转 -90° X 铺平到 XZ 平面，shape 坐标 y = -世界 z）；**墙段沿足迹边摆放**——轴 'x' 边平放、轴 'z' 边 `[0, -π/2, 0]` 旋转（局部方向统一为 + 轴，旧"东西墙 -90° hack"泛化为按边轴推导）；门洞/窗洞与墙同高；嵌套子房间地板略微抬高避免与父地板重叠闪烁。
  - **嵌套房间**：`wallPlan?.get(node.id)` 命中 `computeAllWallPlans` 算出的分隔墙方案（与父墙共线处 `open`）；无方案时兜底 `wallPlanWithDoor(room, nestedDoorDirection(node, parentCenter))`。
  - **window 段渲染**：窗台（实体，高 0.9）+ 半透明蓝色玻璃 + 窗楣（实体）+ 窗框线框示意——沿用"门段永远渲染为开洞"原则，绝不渲染成实心墙。
  - **点击选中部件**：家具/嵌套房间的 `onClick` 调用 `stopPropagation()`；房屋线框盒（足迹并集包围盒）与房间选中轮廓盒（足迹包围盒）都加 `raycast={() => null}`。
  - **家具**：实体 vs 虚化两态；朝向 `facingFromRoom` 消费 `roomCenter/roomDims` 派生的房间几何。
  - **聚焦模式**：点击房间 → 该房间外壳透明化以查看内部实体家具，其他房间虚化。
- **入户门**：暖橙门扇 + 亮黄门头标识，一眼可辨。
- **属性面板**（`PropertyPanel`）：选中模块后浮于视口右侧，编辑名称/长宽高/X·Y·Z；房间的尺寸/坐标为足迹派生值（`nodeDims`/`nodePosition`），提交时由 `updateNodeFields` 转为足迹缩放/平移（`height` → 层高，位置 Y 对房间无效）；数字输入本地草稿态、Enter/blur 提交；位置微调与复位位置直接调用 `translateSelected`/`resetSelectedPosition`。

### 5.1 家具部件模型（lib/furniturePresets.ts，v1.4.0）

家具不渲染为统一长方体，而是按名称识别种类、用程序化部件拼装（纯函数，无渲染依赖；**P1 无变化**）：

- **分类**：`furnitureKind(name)` 用中文正则词表把家具名映射到种类（床/衣柜/书桌/沙发/椅子/马桶/洗手池/冰箱/电视柜/餐桌/圆桌/书架/洗衣机），未命中回退 `generic`（整盒）。`GENERIC_GUARD_RE` 先排除易误判词（如「床头柜」含「床」）。
- **拼装**：`buildFurnitureParts(kind, L, H, W, facing)` 返回部件列表（`center`/`size`/`shape`(box|cylinder)/`shade`）。柜/沙发等按「背侧朝 +z」的规范朝向构建，东/西墙用「交换长宽 + 旋转 90°」、南/北墙用 0°/180°（`orientParts`），足迹保持不变；`BACK_DIR`/`BACK_AXIS` 声明每类背侧的局部方向与沿轴。
- **床**：单独 `buildBedParts`——床头板/枕头放**长轴端**（短边中间），朝向由长轴上最近的墙决定；放置层（`furniturePlacement.ts`）也例外处理床**短边贴墙**。
- **朝向**：`facingFromRoom(node, room, backAxis)` 由家具在父房间内的位置算背侧应贴的墙（短轴/长轴规则，避免转角衣柜门开在小面）；v3 下父房间几何经 `roomCenter/roomDims` 派生。
- **配色**：三档——主色 `FURNITURE_COLOR`（色盲模式切换）、副色 `FURNITURE_PART_DARK`、深色强调 `FURNITURE_PART_INK`（床头板/柜门/电视屏）。
- **防共面（z-fighting）**：垂直面前脸部件不得与箱体/床架前脸共面——箱体前脸后缩 `doorTh+0.02`、门板凸出；床头板内凹 0.05、沙发靠背/扶手内凹 0.03。

## 6. 状态管理（store/*）

- **useSettingsStore**（Zustand + persist → localStorage `wordcraft.settings`）：API Keys、Base URL、默认模型、深度思考模式、颜色模式、线框、调试开关、`language`。`version: 3` + migrate。
- **useModelStore**（persist → `wordcraft.model`）：当前场景（v3 足迹模型）、选中节点、聚焦房间、初始位置快照（`nodePosition`，房间取足迹中心）、**撤销/重做历史栈（`past`/`future`，仅会话内不持久化）**；`setScene` 应用 `normalizeContainment` 并清空历史。**persist `version: 2` + migrate**：旧持久化（v1 模型）读取时经 `migrateModel` 迁移。
  - 编辑提交统一走 `updateSelected(patch)`：不可变更新 `updateNodeFields`（房间补丁 → 足迹缩放/平移/层高，空补丁返回原引用）→ `normalizeContainment` 约束进墙内 → 旧场景压入 `past` 并清空 `future`。
  - `translateSelected` 与 `resetSelectedPosition` 每次调用各记一步历史；历史上限 50 步。
  - **Gizmo 拖拽**：`gizmoMode`（会话内）+ `previewSelected(patch)`（拖拽中实时更新，不记历史、不约束）+ `commitDrag(baseScene)`（结束一次性压入历史并对当前场景 `normalizeContainment`）；代理同步用 `nodePosition`/`nodeDims`。`screenshotMode` 截图瞬间隐藏辅助元素。
- **useChatStore**（persist → `wordcraft.chat`）：对话消息、生成态、**生成历史栈**（会话内不持久化）：每次生成成功前 `pushGenerationHistory(prevScene)`（上限 20）；`undoLastGeneration()` 弹出快照并移除最后 user+assistant 对；`clearGenerationHistory` 在加载示例/清空场景/打开项目/清空对话时调用。**persist `version: 2` + migrate**：消息携带的旧 v1 模型读取时迁移。
- **useProjectStore**（persist → `wordcraft.project`）：当前场景所属项目（`currentId`/`currentName`，持久化）+ 会话内脏标记 `dirty`；脏标记驱动在 HomePage（`lastSavedJsonRef` 对照场景 JSON）。

## 6.5 本地项目库与 2D 俯视平面图（v1.1.0）

### 本地项目库

- **数据**：Dexie（IndexedDB）`wordcraft.projects`，`ProjectRecord {id?, name, data(模型JSON), createdAt, updatedAt}`；`database.ts` 提供 `listProjects`（按 updatedAt 倒序）/ `saveProject` / `getProject` / `updateProject` / `deleteProject`。
- **UI**：HomePage 工具栏「保存」「项目库」+ `ProjectLibraryDialog`（新建/打开/重命名/删除）。保存无当前项目时打开对话框聚焦名称输入；有当前项目时 `updateProject` 覆盖。
- **打开项目**：`JSON.parse` → **`migrateModel` 迁移**（旧 v1 项目自动升 v3；解析失败/迁移失败提示无效）→ `setScene(parsed)`（内部 normalize + 初始位置快照 + 清历史）→ `setProject`。切换/加载示例/清空前用 `confirmDiscardUnsaved` 守卫未保存修改。
- **生成/示例/清空** 后 `clearProject()`：新场景成为游离场景，不属于任何项目。

### 2D 俯视平面图（同 Canvas 正交相机）

- **纯函数**（`lib/planGeometry.ts`）：`houseBounds`（**由所有房间足迹并集包围盒外扩墙厚推导**，兼容旧 `house.dimensions` 语义）、`walkRooms`（levels[0] 递归，嵌套下标 = 父家具数 + 嵌套下标，与 3D 配色一致）、`roomLabelText`（足迹包围盒尺寸）、`dimensionLines`、`computePlanCamera`。均可单测。
- **相机切换**：drei `OrthographicCamera makeDefault` + `OrbitControls key` 强制重挂载（⚠️ 必须用 drei 相机组件）。
- **取景**（`PlanRig`）：`camera.up.set(0,0,1)` + `lookAt(整屋中心)` 正北朝上；`zoom = computePlanCamera().zoom`。
- **标注**（`PlanAnnotations`）：drei `Html` 绘制房间「名称 长×宽」标签（`roomCenter` 定位）+ 整屋尺寸线；标签高度 = 楼层高度以上。
- **平移**：`pan()` 正交分支 scale = `1/zoom`。

## 6.6 中英双语（i18n，v1.2.0，P1 无变化）

- **轻量自研，零依赖**：
  - `src/i18n/translations.ts` — 纯模块，`zh` 词典为 key 真源（`as const`）、`en: Record<TKey, string>` 保证 key 一致；`translate(lang, key, params)` 纯函数，`{name}`/`{count}` 插值（`split/join`），缺 key 回退 zh → key。
  - `src/i18n/index.ts` — `useT()`（响应式 hook，订阅 `useSettingsStore.language`，供组件）+ `t(key, params)`（非响应式，内部读 `getState().language`，供 lib 抛错时用）。
- **状态**：`useSettingsStore.language`，persist version 3 + migrate（旧数据回退 zh）。
- **切换**：`components/ui/LanguageToggle.tsx` 可复用按钮（首页工具栏右侧 + 设置页标题行，zh 显示 EN / en 显示 中文）→ `setLanguage`；`App.tsx` 随语言更新 `document.documentElement.lang`、`document.title` 与 meta description。
- **范围边界**：只覆盖 UI 界面层。**生成数据不翻译**——LLM 系统提示词保持中文，房间/家具名由大模型按提示词产出；`roomGeometry`/`furniturePlacement` 的分类器为中文词表，故英文房间名会破坏走廊/开放/私密房/家具贴墙分类（属已知边界）。示例模型名、已保存项目内容保持原样。
- **错误本地化**：`chat.ts` 的 `ChatGenerationError` 与 `api.ts` 的错误字符串用 `t()` 在抛出时按当前语言生成（默认 zh 与原文逐字一致，既有测试不受影响）。

## 6.7 Gizmo 辅助编辑 + 截图分享与口令（v1.3.0）

### Gizmo（TransformControls）

- **组件**：`components/viewport/GizmoControls.tsx`。代理 group 作 drei `TransformControls` 受控对象；家具代理中心抬 `FLOOR_THICKNESS`；**房间代理同步 `nodePosition(room)`（足迹中心 + 层高一半）**，拖拽位移经 `updateNodePosition` 转足迹平移。
- **模式**：`mode={gizmoMode}`（`translate`/`scale`）；缩放 = 拖拽开始基准尺寸（`nodeDims`）× 代理 scale 写回（房间 → `resizeFootprint` + 层高）。
- **数据流**：`onMouseDown` 记 `baseScene` → `onObjectChange` 调 `previewSelected` → `onMouseUp` 调 `commitDrag`。planMode/screenshotMode 不渲染。

### 截图（场景净化）与口令（lz-string）

- **截图**：`gl={{ preserveDrawingBuffer: true, antialias: true }}` + `dpr={[1,2]}`；`ScreenshotBridge` 把 renderer 写入父级 `glRef`；`captureScreenshot()` 置 `screenshotMode=true` → 等两帧 → `toDataURL` → 复位。净化隐藏 网格/坐标轴/线框/选中框/Gizmo/标注。
- **水印**：`lib/watermark.ts` 右下角半透明口令文本。
- **口令**：`lib/compression.ts` 编码加**版本前缀 `wc3:`**（新口令），解码兼容无前缀旧口令；`useShareStore` 持久化 records（上限 20）。还原路径（ShareDialog）：解压 → **`migrateModel` 迁移**（旧 v1 口令自动升 v3；非法口令降级提示，不崩溃）→ `onRestore`。

## 7. 生成链路（lib/chat.ts）

1. 构建 messages：系统提示词（**v2 语义契约不变**，P1 不改提示词）+ 多轮历史 + 用户输入。
2. **SSE 流式请求**（`streamChatCompletion`，lib/api.ts）：180s 兜底超时。
3. 从回复提取 JSON，`sceneModelV2Schema` 校验。
4. `resolveLayout` 平铺为 v3 足迹模型；auto 布局额外跑一遍家具常理摆放，再 normalizeContainment 兜底。
5. 多轮：历史发送上一轮 v2 JSON，系统提示词要求"基于上一个模型输出修改后的完整 JSON、不得原样重复"。

## 8. 文件结构

```
src/
├── main.tsx / App.tsx         # 入口与路由
├── components/
│   ├── layout/AppShell.tsx    # 侧边栏 + 内容区
│   ├── ui/                    # Button/Input/HelpDialog/ProjectLibraryDialog/ShareDialog
│   └── viewport/              # SceneViewer/Viewport3D/ModelNodeView/PropertyPanel/Compass/PlanRig/PlanAnnotations/GizmoControls
├── lib/
│   ├── chat.ts                # 生成链路与系统提示词（v2 契约）
│   ├── api.ts                 # OpenAI 兼容客户端、SSE 流式、连通性检测
│   ├── layout.ts              # 布局引擎 resolveLayout（→ v3 足迹模型）
│   ├── footprint.ts           # v3 足迹几何纯函数（包围盒/平移/缩放/节点访问器）【新增】
│   ├── migration.ts           # migrateModel v1→v3 幂等迁移【新增】
│   ├── furniturePresets.ts    # 家具部件模型（分类/拼装/朝向/包围盒，纯函数）
│   ├── furniturePlacement.ts  # 家具常理摆放（贴墙 + 避让嵌套卫生间；床短边贴墙例外）
│   ├── roomGeometry.ts        # 足迹边分段墙体 computeWallPlan + applyOpenings + nestedWallPlan（真·内嵌）+ window 段
│   ├── modelTree.ts           # 树遍历/足迹更新/家具约束 normalizeContainment（含推出嵌套占地）
│   ├── planGeometry.ts        # 2D 平面图纯函数（足迹包围盒/取景/尺寸线/房间标签）
│   ├── compression.ts         # lz-string 分享口令编解码（wc3: 版本前缀）
│   ├── watermark.ts           # 截图口令水印（离屏 canvas）
│   ├── sampleModel.ts         # 示例模型
│   ├── debugLog.ts            # 调试日志器
│   └── palette.ts / id.ts     # palette 含共享 roomFaceColor
├── schemas/model.schema.ts    # v2 Zod Schema
├── store/                     # Zustand stores（含 useProjectStore/useShareStore）
├── styles/global.css
├── types/model.ts             # v2 契约 + v3 已解析模型类型
└── db/database.ts             # Dexie 本地项目库（已接入 UI）
```

## 9. 测试（Vitest，214 用例）

- `lib/layout.test.ts`：走廊/客厅/custom 平铺、嵌套房间靠边/靠角、整屋包围盒居中、computeAllWallPlans 嵌套分隔墙。
- `lib/roomGeometry.test.ts`：足迹边分段墙体、共享墙去重、开放空间、私密房间、卫生间归属、入户门、window 段/显式开洞覆盖层、nestedWallPlan 覆盖判定（并集查询/开放连通/嵌套之嵌套/部分覆盖/退化）。
- `lib/footprint.test.ts`【新增】：矩形足迹/包围盒/中心/平移/缩放、房间与整屋访问器、楼层工具。
- `lib/migration.test.ts`【新增】：v1→v3 迁移（足迹/嵌套/entranceRoomId/wall 并入）、幂等、v3 原样返回、非法输入降级。
- `lib/furniturePlacement.test.ts`：家具常理摆放（贴墙/旋转/避门口/避内卫）。
- `lib/chat.test.ts`：流式请求、v2 校验、错误分类。
- `lib/modelTree.test.ts`：树遍历、足迹更新、家具约束、家具推出嵌套占地。
- `lib/planGeometry.test.ts`：足迹推导的整屋包围盒（示例 12.3×10 不回归）、取景/标签/尺寸线。
- `lib/compression.test.ts`：口令编解码（往返/前缀/旧口令兼容/无效）。
- `store/useModelStore.test.ts`：编辑/撤销重做 + previewSelected/commitDrag（Gizmo）。
- `store/useChatStore.test.ts` / `store/useShareStore.test.ts` / `store/useSettingsStore.test.ts` / `store/useProjectStore.test.ts`：各 store 行为。
- `components/ui/ShareDialog.test.tsx`：口令复制/还原/历史 + **旧 v1 口令迁移还原为 v3**。
- `pages/HomePage.test.tsx`：对话交互 + 分享/还原（mock 3D 视口）。

## 10. 调试模式

设置页开启后，`logDebug` 记录：请求参数 → 模型原始回复 → v2 解析 → 布局平铺结果（房间中心/尺寸/家具数）→ 入户门生成，首页面板可一键复制，便于向开发者复现问题。

---

**维护者**：JoyFish · 文档版本 v2.0
