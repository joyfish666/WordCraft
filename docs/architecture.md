# 言筑（WordCraft）技术文档

> 版本：v1.5 · 更新：2026-08-05

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
4. **嵌套房间**：`makeRoom` 递归——嵌套房间按 `side` 靠父房间对应**角落**（贴两面墙，`placeNested`）、无提示时靠东北角；门朝父房间内部（`ModelNodeView` 计算朝向父房间中心的门方向）；`normalizeContainment` 再兜底约束进父房间。
5. **整屋包围盒**：所有房间+走廊求包围盒 → 平移到原点居中 → `house.dimensions`=包围盒尺寸。
6. 家具相对父房间中心偏移为绝对坐标；`normalizeContainment` 将家具约束进墙内。

**布局惯例**：客厅近入口（南侧）、卧室沿走廊两侧、单间房无走廊、除入户门外房屋闭合。

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

## 5. 渲染管线（components/viewport/*）

- **SceneViewer**：R3F Canvas；初始 45° 南视角正对入户门；内置实时**东西南北罗盘**（`Compass` 每帧读取相机方位角旋转 N/S/E/W 玫瑰）。
- **Viewport3D**：计算顶层房间的墙体方案（嵌套房间用 `defaultWallPlan`）。
- **ModelNodeView**：递归渲染层级模型——
  - **房间外壳**（`RoomShell`）：实体地板（外扩覆盖墙脚）+ 分段实心墙（门洞与墙同高）+ 选中轮廓；嵌套子房间地板略微抬高避免与父地板重叠闪烁。
  - **嵌套房间门朝向父房间**：`wallPlanWithDoor(room, dir)` + 按父房间中心计算门方向（`nestedDoorDirection`）。
  - **点击选中部件**：家具/嵌套房间的 `onClick` 调用 `stopPropagation()`，点击床等部件可选中并展示信息，不会被父房间覆盖。
  - **家具**：实体 vs 虚化两态（聚焦时非聚焦房间家具虚化）。
  - **聚焦模式**：点击房间 → 该房间外壳透明化以查看内部实体家具，其他房间虚化。
- **入户门**：暖橙门扇 + 亮黄门头标识，一眼可辨。

## 6. 状态管理（store/*）

- **useSettingsStore**（Zustand + persist → localStorage `wordcraft.settings`）：API Keys、Base URL、默认模型、深度思考模式、颜色模式、线框、调试开关。
- **useModelStore**（persist → `wordcraft.model`）：当前场景（已解析模型）、选中节点、聚焦房间、初始位置快照；`setScene` 应用 `normalizeContainment`。
- **useChatStore**（persist → `wordcraft.chat`）：对话消息、生成态。

## 7. 生成链路（lib/chat.ts）

1. 构建 messages：系统提示词（v2 语义契约 + 多轮修改规则）+ 多轮历史 + 用户输入。
2. **SSE 流式请求**（`streamChatCompletion`，lib/api.ts）：兼容推理型模型长思考，180s 兜底超时。
3. 从回复提取 JSON（纯 JSON / 代码块 / 夹杂散文），`sceneModelV2Schema` 校验。
4. `resolveLayout` 平铺为绝对坐标模型。
5. 多轮：历史发送的是上一轮的 v2 JSON，系统提示词要求"基于上一个模型输出修改后的完整 JSON，不得原样重复"。

## 8. 文件结构

```
src/
├── main.tsx / App.tsx         # 入口与路由
├── components/
│   ├── layout/AppShell.tsx    # 侧边栏 + 内容区
│   ├── ui/                    # Button/Input/HelpDialog
│   └── viewport/              # SceneViewer/Viewport3D/ModelNodeView/Compass
├── lib/
│   ├── chat.ts                # 生成链路与系统提示词
│   ├── api.ts                 # OpenAI 兼容客户端、SSE 流式、连通性检测
│   ├── layout.ts              # 布局引擎 resolveLayout
│   ├── roomGeometry.ts        # 分段墙体方案 computeWallPlan
│   ├── modelTree.ts           # 树遍历/家具约束 normalizeContainment
│   ├── sampleModel.ts         # 示例模型
│   ├── debugLog.ts            # 调试日志器
│   └── palette.ts / id.ts
├── schemas/model.schema.ts    # v2 Zod Schema
├── store/                     # Zustand stores
├── styles/global.css
├── types/model.ts             # v2 契约 + v1 已解析模型类型
└── db/database.ts             # Dexie 本地项目库
```

## 9. 测试（Vitest）

- `lib/layout.test.ts`：走廊/客厅/custom 平铺、嵌套房间靠边/靠角、整屋包围盒居中。
- `lib/roomGeometry.test.ts`：分段墙体、共享墙去重、开放空间、私密房间、卫生间归属、入户门。
- `lib/chat.test.ts`：流式请求、v2 校验、错误分类。
- `lib/modelTree.test.ts`：树遍历、家具约束。
- `lib/debugLog.test.ts`：调试日志开关。
- `pages/HomePage.test.tsx`：对话交互（mock 3D 视口）。

## 10. 调试模式

设置页开启后，`logDebug` 记录：请求参数 → 模型原始回复 → v2 解析 → 布局平铺结果 → 入户门生成，首页面板可一键复制，便于向开发者复现问题。

---

**维护者**：JoyFish · 文档版本 v1.5
