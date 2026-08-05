# 言筑（WordCraft）项目交接文档

> 面向下一个接手 agent / 开发者。本文档补充 README 与技术文档未涉及之处：项目现状、关键实现坑、运行调试方式、下一步建议。

**交接日期**：2026-08-05 · 当前分支 `main`（全部已推送 GitHub）

## 1. 交接总览

言筑是一个**纯前端**"文生 3D"应用：用户用自然语言描述房屋，大模型输出语义模型，代码确定性平铺成 3D。核心已实现并可运行：

- ✅ 对话生成（SSE 流式、多轮修改、深度思考开关）
- ✅ v2 语义布局引擎（走廊型 / 客厅居中型 / 自由型）
- ✅ 分段墙体模型（共享墙去重、开放空间、私密房间、卫生间归属、入户门）
- ✅ 卧室内嵌卫生间（嵌套房间、靠角、门朝父房间）
- ✅ 交互（聚焦视图、选中部件、面包屑、坐标显示、罗盘、WASD 视角）
- ✅ 调试模式、测试（71 用例）

**先读**：`README-zh.md`（功能）、`docs/architecture.md`（架构）→ 再读本文档（坑与细节）。

## 2. 运行 / 测试 / 调试

```bash
npm install
npm run dev      # 开发，http://localhost:5173
npm run test     # Vitest
npm run lint
npm run build
```

- **调试模式**：设置页 → 调试 → 开启。首页底部出现日志面板（可复制），记录"请求参数 → 原始回复 → v2 解析 → 布局平铺 → 入户门生成"。排查生成问题第一件事就是开它。
- **GitHub 推送**：本机访问 GitHub 443 常被网络阻断，可用代理：
  `git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push`

## 3. 架构速览（详见 architecture.md）

```
用户输入 → LLM(SSE流式) → v2语义JSON → Zod校验 → resolveLayout平铺 → 已解析v1模型 → R3F渲染
```

- **大模型只输出语义**（房间清单+尺寸+布置意图），**代码算几何**（无缝平铺/门/闭合）。
- 关键文件：
  - `src/lib/layout.ts` — 布局引擎
  - `src/lib/roomGeometry.ts` — 分段墙体方案
  - `src/lib/chat.ts` — 生成链路与系统提示词
  - `src/schemas/model.schema.ts` — v2 Zod Schema
  - `src/components/viewport/ModelNodeView.tsx` — 渲染核心
  - `src/lib/modelTree.ts` — 树工具 + normalizeContainment（家具/嵌套房间约束）

## 4. 踩过的坑（重要，别重踩）

这些是本项目迭代中实际修过的 bug，改相关代码时务必注意：

1. **东西墙渲染镜像**：东/西墙的 group 旋转必须是 `[0, -Math.PI/2, 0]`（`RoomShell`）。用 `+90°` 会把墙段沿墙镜像，导致"客厅比厨房大时，客厅独有那段外墙缺失"。`wallInfo` 的局部坐标方向与渲染方向必须一致。
2. **门段被渲染成实心墙**：门段宽度恰为 `DOOR_WIDTH`（0.9），旧代码 `len <= DOOR_WIDTH` 把它当实心墙。**`WallSegmentBox` 中 `kind === 'door'` 必须永远渲染为门洞**（左右墙段+门扇/标识），只有 `kind === 'wall'` 才渲染实心。
3. **复合房间名误判**：`isCorridorName('走廊卫生间')` 曾因含"走廊"返回 true，导致走廊卫生间被布局引擎当作走廊过滤掉。现在 `isCorridorName`/`isOpenRoom` 用 `ROOM_TYPE_RE`（卫生间|浴室|卧室|书房…）排除复合名。**注意**：ROOM_TYPE_RE 不能包含 客厅/餐厅/厨房（它们是开放空间）。
4. **嵌套房间不该拍平**：曾把卧室内嵌卫生间拍平为顶层邻居；现在**保留在父房间内部**（`makeRoom` 递归 + `placeNested` 靠角）。`Viewport3D` 只对顶层房间算共享墙方案，嵌套房间用 `wallPlanWithDoor(node, 朝向父房间中心)`。
5. **嵌套房间门方向**：曾用整屋中心方向，可能朝父房间外墙；现在 `nestedDoorDirection(node, parentCenter)` 朝父房间中心。
6. **私密房间连厨房/客厅**：卧室/书房（`isPrivateRoom`）**只连走廊与其套间卫生间**，不直连非走廊开放空间；否则次卧会又连走廊又连厨房。
7. **公共卫生间没门**：`公共卫生间` 归属名"公共"在房屋中不存在，曾导致密封无门。规则：**归属房间不存在时，公共/公用卫生间允许与走廊开门**。
8. **点击部件冒泡**：点击床等部件会冒泡到父房间 group 重新选中父房间。家具/嵌套房间的 `onClick` 必须 `e.stopPropagation()`。
9. **多轮修改 LLM 原样输出**：大模型经常不应用修改、原样重复上一次 JSON。系统提示词第 9 条明确要求"基于上一个模型输出修改后的完整 JSON、不得原样重复"。即便如此，**多轮修改仍可能不稳定**（LLM 行为），必要时让用户换个说法。
10. **normalizeContainment 约束嵌套房间**：`containChildren` 对容器子节点（嵌套房间）做约束，**仅当父节点是房间时**（`container.type === 'room'`）；顶层房间（父是整屋）不约束，否则会把房间按墙厚偏移、破坏已有布局。
11. **持久化迁移**：`useSettingsStore` persist `version: 2`（v2 起默认关闭线框 `wireframe.enabled: false`），旧数据自动迁移。localStorage keys：`wordcraft.settings` / `wordcraft.model` / `wordcraft.chat`。

## 5. 已知限制 / 未实现

- **嵌套房间是"父内独立外壳"**，不是真正在父房间墙内再划分（卫生间与卧室共享地板，靠内部墙+门分隔）。若要"真·内嵌"，需引擎支持父房间内再划分子空间。
- **2D 俯视视图**未实现（README 提到）。
- **属性面板/Gizmo 编辑**未实现（Phase 2）。`useModelStore` 已留有 `translateSelected`/`resetSelectedPosition`/`stepSize`/`initialPositions` 供属性面板/键盘移动使用，但目前 UI 仅状态栏移动视角，无属性面板。
- **本地项目库**（Dexie `src/db/database.ts` 已就绪）未接入 UI。
- **截图分享、口令**未实现（Phase 3）。
- **LLM 输出质量依赖提示词**（当前 DeepSeek v4-flash）。多轮修改、家具常理摆放等依赖 LLM 遵循度，必要时可加代码级兜底。
- 测试环境 jsdom 无 WebGL：`HomePage.test.tsx` mock 了 `SceneViewer`，测试 R3F 渲染相关改动注意。

## 6. 给下一个 agent 的建议

1. **先跑 `npm run dev` + `npm test`**，加载示例模型熟悉渲染；再开调试模式跑一次生成，看日志理解数据流。
2. **下一步优先级**（README Phase 2）：
   - 属性面板（选中模块后改尺寸/坐标，`useModelStore` 已铺路）
   - 本地项目库 UI（Dexie 就绪）
   - Gizmo 辅助编辑（TransformControls，`@react-three/drei` 已装）
3. **改墙体/门相关代码前**，先看第 4 节的坑，尤其东西墙旋转和门段渲染。
4. **加功能时保持"语义/几何分离"**：让 LLM 出语义，代码算几何；不要回到"LLM 直接给绝对坐标"。
5. **用户原则**：一切以用户明确要求为主，未明确才按常理；除入户门外不要擅自固定其他内容。

## 7. 快速文件地图

| 需求 | 改哪里 |
|------|--------|
| 布局/平铺 | `lib/layout.ts` |
| 墙体/门/开放空间 | `lib/roomGeometry.ts` |
| 提示词/生成链路 | `lib/chat.ts` |
| v2 契约 | `types/model.ts`、`schemas/model.schema.ts` |
| 渲染 | `components/viewport/*` |
| 状态 | `store/*` |
| 家具约束 | `lib/modelTree.ts` |
