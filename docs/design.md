# 言筑（WordCraft）设计方案 —— v3「自由设计」

> 版本：v3 草案 · 状态：已评审，P1（数据模型 v3）已实施 · 配套文档：[技术架构（现行实现）](architecture.md) · [版本演进](history.md) · [开发注意事项](notes.md)

> **P1 进度**（2026-08-09 完成）：§3 数据模型 v3 已落地——v3 类型、`migrateModel` 迁移（项目 JSON/分享口令/持久化三路径）、足迹渲染（Shape 地板 + 沿边墙段）、`window` 段与显式开洞覆盖层。验收达标：旧数据可打开（迁移测试）、用例全绿（214）、示例截图无回归（houseBounds 断言不变）。P2 起按 §9 计划推进。

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

## 4. 契约动词化：操作序列（Phase 2）

### 4.1 操作契约

LLM 不再输出整屋快照，而是输出一组操作（Zod union 白名单 + id 引用校验）：

```ts
type Op =
  | { op: 'setHouse', name?, style? }
  | { op: 'addRoom', id?, name, dimensions?, side?, relativeTo?: { roomId, dir },
      footprint?, furniture?: FurnitureSpec[] }
  | { op: 'updateRoom', id, patch: { name?, dimensions?, side?, footprint? } }
  | { op: 'removeRoom', id }
  | { op: 'moveRoom', id, relativeTo?: { roomId, dir } }
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

## 5. 双向同步（Phase 3）

### 5.1 手动编辑 → op 日志

- `useModelStore` 的撤销栈从"整场景快照"（`pushPast`）升级为"操作记录"：**每次编辑同时生成一条 op**，追加进 `useChatStore` 的编辑日志；
- 撤销/重做行为不变，粒度从"整快照"降为"单 op"；
- 日志上限（如 50 条），会话内不持久化。

### 5.2 对话上下文改造（`chat.ts` + `toChatHistory`）

- 发给 LLM 的上下文 = **当前场景摘要**（房间 id/名/尺寸/邻接表，几十行）+ **最近改动 ops 日志**；
- 替代现在"整段旧 v2 JSON"的 history，token 省 80%+，且手动编辑不再丢失；
- 效果："我拖了个房间，再让 AI 继续改"——AI 基于用户改过的版本工作。

### 5.3 局部重生成

- 用户提到哪个房间，LLM 用 `updateRoom` 只动那个节点，其余 id/几何不变；
- 与快照 diff 容错路径配合，兼容 LLM 输出全量 JSON 的旧行为。

## 6. 平面图自由编辑（Phase 4）

在已有 `PlanRig` 正交俯视基础上新增编辑模式：

| 操作 | 实现 |
|------|------|
| 拖顶点改足迹形状 | 正交约束（边保持水平/垂直）+ 网格吸附 |
| 拖房间平移 | 复用 Gizmo 平移 + 邻墙吸附 |
| 点墙放门窗 | 命中墙段 → 生成 `setOpenings` op |
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
| P2 契约动词化 | ops 契约 + 执行器 + 提示词重写 | 生成/多轮/撤销/分享全链路可用 |
| P3 双向同步 | 编辑 op 日志 + 对话上下文改造 | 手动编辑后对话能看到改动 |
| P4 平面图编辑 | 拖顶点/画墙/放门窗 | 纯手动从零搭一套房，全操作可撤销 |
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
