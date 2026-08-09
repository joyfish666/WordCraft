# 言筑（WordCraft）技术文档 —— 现行实现（v2 语义契约）

> 版本：v1.4 · 更新：2026-08-09。本文档描述**当前代码**的架构与数据契约（v2 语义契约 + v1 绝对坐标模型）。下一代 v3 架构见 [设计方案](design.md)，演进脉络见 [版本演进](history.md)，踩坑记录见 [开发注意事项](notes.md)。

本文档面向开发者和贡献者，描述言筑的核心架构、数据契约与实现细节。项目为**纯前端**应用，无需后端。

## 1. 架构总览

言筑的核心设计原则是**语义与几何分离**：

- **大模型负责语义**：输出"建什么"——房间清单、名义尺寸、布置意图（相对关系），不输出绝对坐标。
- **代码负责几何**：布局引擎将语义确定性平铺为精确的绝对坐标，保证无缝共用墙、门连通、房屋闭合。

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
   │  平铺为 v1 绝对坐标模型（内部统一格式）
   ▼
已解析模型 SceneModel（types/model.ts）
   │
   ├─ 渲染层（components/viewport/*）
   ├─ 墙体方案 computeWallPlan（lib/roomGeometry.ts）
   └─ 状态层（store/useModelStore.ts）
```

**为什么分层**：一个合理的户型本质是"约束平铺问题"（房间无缝共用墙、对齐、动线），LLM 擅长语义组合但**不擅长空间算术**。让 LLM 直接算绝对坐标会导致缝隙/重叠/不合常理。分层后：LLM 决定"哪些房间、多大、怎么连"，代码保证"无缝、连通、闭合"。

## 2. 数据契约

### 2.1 v2 语义契约（大模型输出）

大模型输出的 v2 模型包含 `layout`（布局模式）与 `children`（房间）：

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

### 2.2 已解析模型（内部统一格式，v1）

布局引擎输出 `SceneModel`（v1），一切具有**绝对坐标**，供渲染/存储/墙体方案消费：

```ts
interface SceneModel {
  version: 1
  root: ContainerNode   // house
}
interface ContainerNode {
  id: string
  type: 'house' | 'room'
  name: string
  dimensions: Dimensions
  position: Position       // 绝对坐标（整屋中心为原点，地面 y=0）
  children: ModelNode[]    // FurnitureNode | ContainerNode（嵌套房间）
  entranceRoomId?: string  // 整屋的入户房间 id
}
```

持久化（localStorage）与对话历史存储的都是这种已解析模型，渲染层完全不变。

## 3. 布局引擎（lib/layout.ts）

`resolveLayout(sceneV2): SceneModel` 将 v2 语义模型平铺为绝对坐标：

1. **corridor 走廊型**：走廊沿 X 贯穿；房间按 `side`（left=南/right=北）在两侧顺序平铺、无缝贴合；入口房间强制置于南侧并排最前；单房间省略走廊。
2. **living 客厅居中型**：中心房间（`centerRoomId`）居中于原点，其余房间按 `side` 环绕排布。
3. **custom 自由型**：房间直接用 LLM 提供的绝对坐标。
4. **嵌套房间**：`makeRoom` 递归——嵌套房间按 `side` 靠父房间对应**角落**（贴两面墙，`placeNested`）、无提示时靠东北角；门朝父房间内部（`nestedDoorDirection` 计算朝向父房间中心的门方向）；`normalizeContainment` 再兜底约束进父房间。**真·内嵌**：`computeAllWallPlans` 为嵌套房间算独立分隔墙方案——与已渲染墙共线且被覆盖的边渲染为 `open`（由外层墙围护，不再重复渲染），其余边为内部分隔墙 + 朝父中心的门；`containChildren` 同时把父房间家具（含手动编辑）推出嵌套占地。
5. **整屋包围盒**：所有房间+走廊求包围盒 → 平移到原点居中 → `house.dimensions`=包围盒尺寸。
6. 家具相对父房间中心偏移为绝对坐标；`normalizeContainment` 将家具约束进墙内。

**布局惯例**：客厅近入口（南侧）、卧室沿走廊两侧、单间房无走廊、除入户门外房屋闭合。

**家具常理摆放**（`furniturePlacement.ts`，仅 auto 模式 + 示例模型）：靠墙家具（衣柜/橱柜/书桌/沙发等，`isWallAnchored`）贴**最近墙**（保持平行于墙的坐标），**大面积贴墙**——长边（max(长,宽)）沿墙，必要时**交换长宽**实现 90° 旋转（`rotationY` 同步 +90°，渲染器暂不读 rotationY，视觉靠交换后的尺寸生效）；**床例外：短边（床头）贴墙**（`furnitureKind(name)==='bed'` 时交换条件取反，长边垂直墙伸入室内，床头朝墙是常理）；再**沿墙滑动**避开三类禁止进入区：嵌套子房间（足迹 + 墙厚）、**房间门口通道**（`computeDoorZones` 从墙体方案提取门洞，含入户门，`DOOR_CLEARANCE=1m` 深 × 门宽）、已放置的其他家具（按 children 顺序贪心）。独立家具（茶几/餐桌/椅子等，`FREE_STANDING_RE`）保持原位，仅约束进墙内并避让上述禁区。custom 自由布局保留大模型的显式坐标。

## 4. 墙体模型（lib/roomGeometry.ts）

墙体按**相邻关系切分为段（segment）**渲染，每段为 实体 / 门 / 开放 之一：

```ts
type WallSegmentKind = 'wall' | 'door' | 'open'
interface WallFace {
  shared: boolean          // 是否有相邻房间（影响地板外扩）
  segments: WallSegment[]  // 沿墙方向分段
}
```

`computeWallPlan(rooms, { entrance, entranceRoomId })` 的规则：
- **共享墙去重**：相邻房间共用的墙只由一方渲染（非走廊优先，否则 id 较小者）。
- **开放空间**：客厅/餐厅/厨房等（`isOpenRoom`）与走廊之间不设墙。
- **私密房间**：卧室/书房（`isPrivateRoom`）只连走廊与其套间卫生间，不直连非走廊开放空间（厨房/客厅/餐厅），彼此不互开门。
- **卫生间归属**：卫生间只与其归属房间开门，其余连接为实心墙（`bathroomOwner` 解析命名）；归属房间在房屋中不存在的**公共/公用卫生间**允许与走廊开门。
- **部分被占用的墙**：被相邻房间覆盖的部分按共享/开放处理，**未覆盖部分仍渲染为外墙**，保证不与外部相通。
- **入户门**：开在入口房间南外墙居中，段标记 `entrance: true`，渲染醒目门扇。
- **墙段坐标**：东/西墙渲染用 `-90°` 旋转，使局部坐标方向与 `wallInfo` 一致（避免镜像导致外墙段错位）。
- **门口禁区**（`computeDoorZones`/`DOOR_CLEARANCE`）：从墙体方案提取各顶层房间门洞（含入户门），供家具常理摆放避让；与渲染用 `computeWallPlan` 同源，保证门洞位置一致。
- **嵌套房间分隔墙**（真·内嵌，v1.3）：`computeAllWallPlans` = `computeWallPlan`（顶层零改动）+ 自顶向下为每个嵌套房间调 `nestedWallPlan` 写入同一 Map。`nestedWallPlan(node, parent, plan, roomById)` 对每面墙做**全量墙线并集查询**——收集同一世界墙线（`|line 差| ≤ WALL_THICKNESS + 1e-6`，容忍浮点贴边）上所有非 `open` 段的覆盖区间，被覆盖处切为 `open`（由外层墙围护，避免与父墙/邻居墙双重墙）；其余边为内部分隔墙，门开在朝父中心一面（退化时最近含 `wall` 段的面，四面全覆盖则不开门）。段切分后用 `cleanSegments` 合并相邻同类型段并去除浮点噪声微段。

## 5. 渲染管线（components/viewport/*）

- **SceneViewer**：R3F Canvas（`gl={{ preserveDrawingBuffer: true }}` 供截图读取缓冲）；初始 45° 南视角正对入户门；内置实时**东西南北罗盘**（`Compass` 每帧读取相机方位角旋转 N/S/E/W 玫瑰）。
- **Viewport3D**：计算整屋所有房间（含嵌套）的墙体方案（`computeAllWallPlans`）；`screenshotMode` 时隐藏网格/坐标轴。
- **ModelNodeView**：递归渲染层级模型——
  - **房间外壳**（`RoomShell`）：实体地板（外扩覆盖墙脚）+ 分段实心墙（门洞与墙同高）+ 选中轮廓；嵌套子房间地板略微抬高避免与父地板重叠闪烁。
  - **嵌套房间**：`wallPlan?.get(node.id)` 命中 `computeAllWallPlans` 算出的分隔墙方案（与父墙共线处 `open`）；无方案时兜底 `wallPlanWithDoor(room, nestedDoorDirection(node, parentCenter))`。
  - **点击选中部件**：家具/嵌套房间的 `onClick` 调用 `stopPropagation()`，点击床等部件可选中并展示信息，不会被父房间覆盖。**房屋线框盒与房间选中轮廓盒都加了 `raycast={() => null}`**——R3F 按射线距离排序逐级派发事件，若轮廓盒参与射线，它会先被命中并冒泡到房间 group 的 `stopPropagation`，导致选中房间后无法点中内部部件。
  - **家具**：实体 vs 虚化两态（聚焦时非聚焦房间家具虚化）。
  - **聚焦模式**：点击房间 → 该房间外壳透明化以查看内部实体家具，其他房间虚化。
- **入户门**：暖橙门扇 + 亮黄门头标识，一眼可辨。
- **属性面板**（`PropertyPanel`）：选中模块后浮于视口右侧，编辑名称/长宽高/X·Y·Z；数字输入本地草稿态、Enter/blur 提交（避免逐键提交）；位置微调与复位位置直接调用 `translateSelected`/`resetSelectedPosition`。

### 5.1 家具部件模型（lib/furniturePresets.ts，v1.4.0）

家具不再渲染为统一长方体，而是按名称识别种类、用程序化部件拼装（纯函数，无渲染依赖）：

- **分类**：`furnitureKind(name)` 用中文正则词表把家具名映射到种类（床/衣柜/书桌/沙发/椅子/马桶/洗手池/冰箱/电视柜/餐桌/圆桌/书架/洗衣机），未命中回退 `generic`（整盒）。`GENERIC_GUARD_RE` 先排除易误判词（如「床头柜」含「床」）。
- **拼装**：`buildFurnitureParts(kind, L, H, W, facing)` 返回部件列表（`center`/`size`/`shape`(box|cylinder)/`shade`）。柜/沙发等按「背侧朝 +z」的规范朝向构建，东/西墙用「交换长宽 + 旋转 90°」、南/北墙用 0°/180°（`orientParts`），足迹保持不变；`BACK_DIR`/`BACK_AXIS` 声明每类背侧的局部方向与沿轴。
- **床**：单独 `buildBedParts`——床头板/枕头放**长轴端**（短边中间），朝向由长轴上最近的墙决定；放置层（`furniturePlacement.ts`）也例外处理床**短边贴墙**。
- **朝向**：`facingFromRoom(node, room, backAxis)` 由家具在父房间内的位置算背侧应贴的墙（短轴/长轴规则，避免转角衣柜门开在小面）。
- **配色**：三档——主色 `FURNITURE_COLOR`（色盲模式切换）、副色 `FURNITURE_PART_DARK`、深色强调 `FURNITURE_PART_INK`（床头板/柜门/电视屏）。
- **防共面（z-fighting）**：垂直面前脸部件不得与箱体/床架前脸共面——箱体前脸后缩 `doorTh+0.02`、门板凸出；床头板内凹 0.05、沙发靠背/扶手内凹 0.03。

## 6. 状态管理（store/*）

- **useSettingsStore**（Zustand + persist → localStorage `wordcraft.settings`）：API Keys、Base URL、默认模型、深度思考模式、颜色模式、线框、调试开关、`language`（`'zh'|'en'`，默认 zh，`setLanguage` 切换）。`version: 3` + migrate：旧数据缺 `language` 时回退 `'zh'`。
- **useModelStore**（persist → `wordcraft.model`）：当前场景（已解析模型）、选中节点、聚焦房间、初始位置快照、**撤销/重做历史栈（`past`/`future`，仅会话内不持久化）**；`setScene` 应用 `normalizeContainment` 并清空历史。
  - 编辑提交统一走 `updateSelected(patch)`（名称/尺寸/位置部分补丁）：不可变更新 `updateNodeFields` → `normalizeContainment` 约束进墙内 → 旧场景压入 `past` 并清空 `future`。
  - `translateSelected`（位置微调/方向键）与 `resetSelectedPosition`（复位）每次调用也各记一步历史；新编辑会使 redo 失效；历史上限 50 步。
  - **Gizmo 拖拽（v1.3）**：`gizmoMode`（`'translate'|'scale'`，会话内）+ `previewSelected(patch)`（拖拽中实时更新，不记历史、不约束）+ `commitDrag(baseScene)`（拖拽结束把拖拽前场景压入 `past` 恰好一步，并对当前场景 `normalizeContainment`）。`screenshotMode` 截图瞬间隐藏辅助元素（会话内）。
- **useChatStore**（persist → `wordcraft.chat`）：对话消息、生成态、**生成历史栈**（`generationStack`，会话内不持久化）：每次生成成功前 `pushGenerationHistory(prevScene)`（上限 20）；`undoLastGeneration()` 弹出快照并移除最后 user+assistant 对、返回待恢复场景（仅当最后一条是携带模型的助手消息）；`clearGenerationHistory` 在加载示例/清空场景/打开项目/清空对话时调用。
- **useProjectStore**（persist → `wordcraft.project`）：当前场景所属项目（`currentId`/`currentName`，持久化）+ 会话内脏标记 `dirty`；`setProject`/`clearProject`/`markSaved`/`markDirty`/`setCurrentName`。**脏标记驱动**在 HomePage：`lastSavedJsonRef` 记录"上次保存的场景 JSON"，场景变化时与之一致则 `markSaved`、不一致则 `markDirty`；仅当前项目绑定（`currentId !== null`）时跟踪。

## 6.5 本地项目库与 2D 俯视平面图（v1.1.0）

### 本地项目库

- **数据**：Dexie（IndexedDB）`wordcraft.projects`，`ProjectRecord {id?, name, data(模型JSON), createdAt, updatedAt}`；`database.ts` 提供 `listProjects`（按 updatedAt 倒序）/ `saveProject` / `getProject` / `updateProject` / `deleteProject`。
- **UI**：HomePage 工具栏「保存」「项目库」+ `ProjectLibraryDialog`（新建/打开/重命名/删除）。保存无当前项目时打开对话框聚焦名称输入；有当前项目时 `updateProject` 覆盖。
- **打开项目**：`JSON.parse` + 轻量校验（`version===1 && root.type==='house'`）→ `setScene(parsed)`（内部 normalize + 初始位置快照 + 清历史）→ `setProject`。切换/加载示例/清空前用 `confirmDiscardUnsaved` 守卫未保存修改。
- **生成/示例/清空** 后 `clearProject()`：新场景成为游离场景，不属于任何项目。

### 2D 俯视平面图（同 Canvas 正交相机）

- **纯函数**（`lib/planGeometry.ts`）：`houseBounds`（整屋包围盒）、`walkRooms`（递归房间+兄弟索引，颜色与 3D 一致）、`roomLabelText`、`dimensionLines`（外廓尺寸线）、`computePlanCamera`（正交取景 zoom = min(w/fitX, h/fitZ)）。均可单测。
- **相机切换**：`SceneViewer` 的 `planMode` 为 true 时挂载 **drei `OrthographicCamera makeDefault`**（`near=1 far=300 zoom=20 up=[0,0,1]`），`OrbitControls key={planMode?'ortho':'persp'}` 强制重挂载绑定新相机。⚠️ **必须用 drei 相机组件而非 R3F 原生元素**——R3F 核心不处理 `makeDefault`，drei 封装才切换 `state.camera` 并在卸载时恢复原相机。
- **取景**（`PlanRig`）：`camera.up.set(0,0,1)` + `lookAt(整屋中心)` 使正北朝上；`camera.zoom = computePlanCamera().zoom`、`controls.update()`、`controls.saveState()`（复位视角回到取景）。依赖 scene/size 变化自动重新取景。
- **标注**（`PlanAnnotations`）：drei `Html`（正交相机兼容）绘制房间「名称 长×宽」标签（颜色用共享 `roomFaceColor(name, siblingIndex, colorMode)`，走廊默认色）+ 整屋「总长/总宽」尺寸线（细长 mesh + Html 文案，墙顶之上、包围盒外）。`zIndexRange={[9,0]}` 保证在属性面板（z-10）之下。
- **平移**：`pan()` 增加正交分支（scale = `1/zoom`；drei ortho frustum = 像素尺寸）；透视分支保持原 fov 公式。

## 6.6 中英双语（i18n，v1.2.0）

- **轻量自研，零依赖**：
  - `src/i18n/translations.ts` — 纯模块，`zh` 词典为 key 真源（`as const`）、`en: Record<TKey, string>` 保证 key 一致；`translate(lang, key, params)` 纯函数，`{name}`/`{count}` 插值（`split/join`），缺 key 回退 zh → key。
  - `src/i18n/index.ts` — `useT()`（响应式 hook，订阅 `useSettingsStore.language`，供组件）+ `t(key, params)`（非响应式，内部读 `getState().language`，供 lib 抛错时用）。
- **状态**：`useSettingsStore.language`，persist version 3 + migrate（旧数据回退 zh）。
- **切换**：`components/ui/LanguageToggle.tsx` 可复用按钮（首页工具栏右侧 + 设置页标题行，zh 显示 EN / en 显示 中文）→ `setLanguage`；`App.tsx` 随语言更新 `document.documentElement.lang`、`document.title` 与 meta description。
- **范围边界**：只覆盖 UI 界面层。**生成数据不翻译**——LLM 系统提示词保持中文，房间/家具名由大模型按提示词产出；`roomGeometry`/`furniturePlacement` 的分类器为中文词表，故英文房间名会破坏走廊/开放/私密房/家具贴墙分类（属已知边界）。示例模型名、已保存项目内容保持原样。
- **错误本地化**：`chat.ts` 的 `ChatGenerationError` 与 `api.ts` 的错误字符串用 `t()` 在抛出时按当前语言生成（默认 zh 与原文逐字一致，既有测试不受影响）。

## 6.7 Gizmo 辅助编辑 + 截图分享与口令（v1.3.0）

### Gizmo（TransformControls）

- **组件**：`components/viewport/GizmoControls.tsx`（Canvas 内、`Viewport3D` 之后）。用**代理 group** 作为 drei `TransformControls` 的受控对象（`object={ref}`），避免与 R3F 对 mesh `position` prop 的管理冲突；家具/墙体代理中心抬 `FLOOR_THICKNESS`（与 ModelNodeView 的 mesh 一致），房间用自身中心。drei 内部监听 `dragging-changed` 自动禁用 OrbitControls。
- **模式**：`mode={gizmoMode}`（`translate`/`scale`）；属性面板顶部「Gizmo 手柄」分段控件切换。不做 rotate（渲染器按"旋转=交换长宽"建模，见坑 19）。
- **数据流**：`onMouseDown` 记 `baseScene`+基准尺寸 → `onObjectChange` 读代理 position/scale 调 `previewSelected`（不记历史不约束，属性面板实时联动）→ `onMouseUp` 调 `commitDrag(baseScene)`（记一步历史 + normalize 约束进墙）。
- **缩放映射**：`新尺寸 = 拖拽开始时基准尺寸 × 代理 scale`，各轴独立，下限 0.1；尺寸写入 `dimensions`（不读/写 `scale` 字段）。未拖拽时 `useEffect` 把代理同步到选中节点（选择切换/外部编辑/撤销后跟随）。
- **隐藏**：planMode（2D 平面图）与 screenshotMode 时不渲染。

### 截图（场景净化）

- **Canvas**：`gl={{ preserveDrawingBuffer: true, antialias: true }}`（`toDataURL` 需读取绘制缓冲）；`dpr={[1,2]}` 保证高分辨率。
- **桥接**：`ScreenshotBridge`（Canvas 内 `useThree(s=>s.gl)`）把 renderer 写入父级 `glRef`；`SceneViewerHandle.captureScreenshot()` 置 `screenshotMode=true` → 等两帧 rAF（React 应用隐藏）→ `gl.domElement.toDataURL('image/png')` → 复位 → resolve。无 gl（测试环境）返回 null。
- **净化**：`screenshotMode` 时隐藏 网格/坐标轴（Viewport3D）、房屋线框/选中轮廓/家具 Edges（ModelNodeView）、Gizmo（GizmoControls）、平面图标注（PlanAnnotations）。
- **水印**：`lib/watermark.ts` `withWatermark(pngUrl, code)` 离屏 2D canvas 在右下角绘制半透明口令文本；无 canvas 2D 环境降级返回原图。

### 口令（lz-string）

- **编解码**：复用 `lib/compression.ts`（`encodeShareCode` / `decompressObject`，已有测试）。
- **历史**：`store/useShareStore.ts`（persist `wordcraft.share`，`partialize` 只存 records，上限 20）；`ShareRecord {id, name?, code, createdAt}`，还原时 `decompressObject<SceneModel>(code)` + 校验 `version===1 && root.type==='house'`。
- **UI**：`components/ui/ShareDialog.tsx`（截图预览 + 口令复制 + 粘贴还原 + 历史列表删除）；HomePage 工具栏「分享」按钮**始终可用**：有模型时 `handleShare` = `encodeShareCode → captureScreenshot → withWatermark → 打开对话框 + addRecord`；**无模型时仅打开对话框**（code/screenshot 为 null，提示「粘贴口令还原」）供导入他人模型；`restoreFromShare` 走 `confirmDiscardUnsaved` 守卫 → `setScene` → 解绑项目/生成历史。

## 7. 生成链路（lib/chat.ts）

1. 构建 messages：系统提示词（v2 语义契约 + 多轮修改规则）+ 多轮历史 + 用户输入。
2. **SSE 流式请求**（`streamChatCompletion`，lib/api.ts）：兼容推理型模型长思考，180s 兜底超时。
3. 从回复提取 JSON（纯 JSON / 代码块 / 夹杂散文），`sceneModelV2Schema` 校验。
4. `resolveLayout` 平铺为绝对坐标模型；**auto 布局额外跑一遍家具常理摆放**（`applyFurnitureConventions`，贴墙 + 避让嵌套卫生间），再 normalizeContainment 兜底。
5. 多轮：历史发送的是上一轮的 v2 JSON，系统提示词要求"基于上一个模型输出修改后的完整 JSON，不得原样重复"。

## 8. 文件结构

```
src/
├── main.tsx / App.tsx         # 入口与路由
├── components/
│   ├── layout/AppShell.tsx    # 侧边栏 + 内容区
│   ├── ui/                    # Button/Input/HelpDialog/ProjectLibraryDialog/ShareDialog
│   └── viewport/              # SceneViewer/Viewport3D/ModelNodeView/PropertyPanel/Compass/PlanRig/PlanAnnotations/GizmoControls
├── lib/
│   ├── chat.ts                # 生成链路与系统提示词
│   ├── api.ts                 # OpenAI 兼容客户端、SSE 流式、连通性检测
│   ├── layout.ts              # 布局引擎 resolveLayout
│   ├── furniturePresets.ts    # 家具部件模型（分类/拼装/朝向/包围盒，纯函数）
│   ├── furniturePlacement.ts  # 家具常理摆放（贴墙 + 避让嵌套卫生间；床短边贴墙例外）
│   ├── roomGeometry.ts        # 分段墙体 computeWallPlan + computeAllWallPlans/nestedWallPlan（真·内嵌）
│   ├── modelTree.ts           # 树遍历/家具约束 normalizeContainment（含推出嵌套占地）
│   ├── planGeometry.ts        # 2D 平面图纯函数（包围盒/取景/尺寸线/房间标签）
│   ├── compression.ts         # lz-string 分享口令编解码
│   ├── watermark.ts           # 截图口令水印（离屏 canvas）
│   ├── sampleModel.ts         # 示例模型
│   ├── debugLog.ts            # 调试日志器
│   └── palette.ts / id.ts     # palette 含共享 roomFaceColor
├── schemas/model.schema.ts    # v2 Zod Schema
├── store/                     # Zustand stores（含 useProjectStore/useShareStore）
├── styles/global.css
├── types/model.ts             # v2 契约 + v1 已解析模型类型
└── db/database.ts             # Dexie 本地项目库（已接入 UI）
```

## 9. 测试（Vitest）

- `lib/layout.test.ts`：走廊/客厅/custom 平铺、嵌套房间靠边/靠角、整屋包围盒居中、computeAllWallPlans 嵌套分隔墙。
- `lib/roomGeometry.test.ts`：分段墙体、共享墙去重、开放空间、私密房间、卫生间归属、入户门、nestedWallPlan 覆盖判定（并集查询/开放连通/嵌套之嵌套/部分覆盖/退化）。
- `lib/chat.test.ts`：流式请求、v2 校验、错误分类。
- `lib/modelTree.test.ts`：树遍历、家具约束、家具推出嵌套占地。
- `lib/debugLog.test.ts`：调试日志开关。
- `lib/compression.test.ts`：分享口令编解码（往返/无效）。
- `store/useModelStore.test.ts`：编辑/撤销重做 + previewSelected/commitDrag（Gizmo）。
- `store/useShareStore.test.ts`：口令历史上限/持久化。
- `components/ui/ShareDialog.test.tsx`：口令复制/还原/历史。
- `pages/HomePage.test.tsx`：对话交互 + 分享/还原（mock 3D 视口）。

## 10. 调试模式

设置页开启后，`logDebug` 记录：请求参数 → 模型原始回复 → v2 解析 → 布局平铺结果 → 入户门生成，首页面板可一键复制，便于向开发者复现问题。

---

**维护者**：JoyFish · 文档版本 v1.13
