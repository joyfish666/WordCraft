# 言筑（WordCraft）技术文档 —— 现行实现（v3 足迹模型 + ops 操作契约 + 双向同步）

> 版本：v2.18 · 更新：2026-08-14。本文档描述**当前代码**的架构与数据契约（v3 足迹几何模型 + ops 操作契约 + v2 快照容错路径 + P3 手动编辑 op 回流 + P4 平面图自由编辑 + 平面图增强 + 移动端横屏支持 + 全新 UI + 房屋造型材质层）。P1（v3 数据模型）、P2（契约动词化）、P3（双向同步）与 P4（平面图自由编辑：拖顶点/拖房间/点墙放门窗/拆房/合并）已实施：P1 为纯重构（旧数据可打开、用例全绿、截图无回归）；P2 将生成契约从"整屋快照"动词化为"操作序列"（逐条容错执行器 + 提示词重写 + 快照 diff 容错）；P3 把手动编辑 diff 成同构 op 日志回流对话上下文（摘要 + 编辑日志替代整段旧历史，省 token）；P4 在平面图上直接编辑（全部产出同构 op：新增 splitRoom/mergeRoom 操作与 setOpenings 的 edgeIndex/remove，纯函数库 planEdit.ts + 交互层 PlanEditLayer）。2026-08-10 追加落地：**平面图增强**（家具足迹/门窗符号/房间尺寸线 + 尺寸开关）、**移动房间带动家具**（translateRoomContents）、**家具 13 → 20 类**、**移动端横屏支持**（OrientationGuard JS 视口判定 + `wc-compact` 类门控 + 平面图「工具/尺寸」工具栏 + 罗盘缩小 + Canvas touch-action）、**手动编辑避让门口**（normalizeContainment 推出堵门家具，坑 15 更新）。**2026-08-12 追加落地**：**全新 UI 改版**（暖色浅色主题、移除侧边栏、品牌入顶栏、底部对话抽屉、空态引导卡、独立截图按钮、属性面板可拖动、R 键复位视角）与**生成链路确定性补强**（macro.name 容错修复、房间按名称引用、custom 房间 relativeTo、无走廊自由布局直接开门、入户门与开洞互让、家具摆放管线与滑动算法修复、嵌套房间避让父房间门区；388 用例全绿）。**2026-08-13 追加落地（代码审查批次，坑 70-73）**：**生成竞态防护**（发送时快照场景引用，返回时场景已变则 confirm 是否覆盖，无 API Key 不再清空草稿）、**名称引用契约修复**（executor 先 findRoom 解析真实 id 再走 id-only 变更函数，坑 71）、**项目库房间数读取修正**（root.levels[0].rooms，原读错字段恒为 0）、**Ctrl/Cmd+R 不再被劫持**、**墙体方案共享缓存**（computeAllWallPlansCached，WeakMap 按场景引用，渲染层三组件一次计算，坑 72）、**PlanRig 取景按包围盒签名失效**（拖拽不再每帧重取景，坑 73）、**CI 补 lint/format/typecheck/test**、**顶层 ErrorBoundary**（渲染崩溃不再白屏，可重置本地数据）。**2026-08-13 追加落地（工程化与代码结构整理批次）**：**移除 axios 统一 fetch**（流式与连通性检测同一 HTTP 栈，describeAxiosError → describeHttpError；testConnection 遇 max_tokens 400 自动降级 max_completion_tokens 重试）、**版本号单一来源**（package.json → vite define `__APP_VERSION__`，状态栏不再硬编码）、**HomePage 瘦身**（平面图工具栏 → `PlanToolbar`（移动/桌面分支收拢、工具清单单一定义）、调试面板 → `DebugPanel`、键盘快捷键 → `useKeyboardShortcuts`、移动端判定 → `lib/viewport.ts` + `useMobileCompact`，与 OrientationGuard 共享阈值）、**样式按域拆分**（global.css 2017 行单文件 → 15 个分区文件 + @import 链，顺序即层叠顺序）、**组件测试补齐**（PropertyPanel/ChatDrawer/HomeToolbar 12 用例）、**CI 补 format:check 门**（全仓格式一次收敛）。**2026-08-13 追加落地（全面审查批次，坑 74-76）**：**数据入口加固**（migration 的 v3 分支补 `sceneModelV3Schema` 结构校验，畸形分享口令/损坏数据不再放行，坑 74）、**几何共享模块**（重叠判定/房间平移/足迹相等/嵌套落点符号/名称回退查找收拢到 `lib/geometry.ts`，消除 executor/modelTree/furniturePlacement/layout 四处同源复制）、**常量集中**（`lib/constants.ts`：EPSILON/墙厚/门宽/邻接容差/默认层高单一来源）、**executor 按 op 组拆分**（`lib/executor/` 目录：core/rooms/furniture/openings/diff/shared）、**脏标记收敛到 useProjectStore**（savedJson 快照 + 干净→变化时才比对，拖拽预览不再每帧 JSON.stringify 全场景；撤销回到已保存状态由 syncDirtyWithSaved 一次清除）、**SSE 流式测试补齐**（streamChatCompletion 分片边界/[DONE]/坏行/中断/中止）、**extractModelJson 支持纯 ops 数组输出**、**对话框 a11y 收敛**（通用 Dialog 组件：aria-labelledby/焦点陷阱/Escape 关闭/焦点归还，替换三处复制）、**i18n 补漏与死代码清理**（语言切换/错误文案入词典，删 7 个死 key 与死 CSS）、**HomePage 再瘦身**（useGeneration/useDirtyTracking hooks）、**文档同步**（README 技术栈修正、design §9 补行、notes 坑号重排）。468 用例全绿。**2026-08-13 追加落地（房屋造型材质层）**：**程序化材质**（`lib/materials.ts`：6 张 Canvas 贴图全局缓存，周期函数无缝平铺；地板按房间名匹配 瓷砖/混凝土/防腐木/木地板 × 房间识别色 tint，墙身中性化；家具按种类×明度档匹配 木纹/织物/金属/陶瓷/玻璃/塑料；色盲模式统一中性灰）、**造型细节**（踢脚线/门套/实体窗框/外墙六面多材质，聚焦/虚化/线框/截图全兼容）、**平屋顶 + 檐口**（RoofView，聚焦房间看内部自动隐藏）与**室外地面**（GroundView，草地 + 入户石板小径）、**光照阴影**（半球光 + 2048 阴影贴图）、**设置开关**（roof/shadows，settings v4 迁移默认开启；488 用例全绿）。**2026-08-13 追加落地（材质层写实化与修复批次，坑 77-79）**：**写实化**（ACES 色调映射 + PCFSoft 软阴影 + drei 程序化天空/地平线雾 + `RoomEnvironment` 环境反射桥 + 重配光 0.35/0.35/1.4 + 阴影边界随房屋动态伸缩）、**UV 双重缩放修复**（共享纹理 repeat 与几何层 UV 拉伸相乘 → tile² 周期，base 纹理改 repeat=1、地板走 `getWorldUvTexture` 克隆）、**色板三档明度**（外墙近白/屋顶深暖灰/草地灰绿）、**纹理重绘**（木地板顺纹 + 草地中性灰 + 外墙抹灰 `plasterWall`、走廊改木地板、tint 向暖白混 80%）、**造型细节**（基座勒脚/反射玻璃/门横杠移除/石板小径对齐门洞）、**屋顶整体移除**（一层户型檐口遮挡内部，RoofView 删除、`roof` 设置项全链路清理、settings 升 v5 剔除残留）、**同法向共面 z-fighting 修复**（墙/勒脚/踢脚线/门套底面与侧面逐一错位 1~2.5mm + 墙家具沉入地板 2mm；490 用例全绿）。**2026-08-13 追加落地（审查批次后续：批 A/B/C，坑 80-85）**：**拖拽预览不再逐帧写 localStorage**（persist 走 `previewAwareStorage` 存储层开关，预览 set 跳过序列化与写入——坑 75 修了脏检查的每帧 stringify，persist 自身每帧全场景 JSON 序列化仍漏网；坑 80）、**对话消息不再持久化场景快照**（`useChatStore` partialize 剥离消息内嵌 `model`，persist 升 v3 迁移一并剥离——多轮对话每轮一份完整 SceneModel 逼近 5MB 配额；坑 81）、**v2 快照容错路径补全 position/relativeTo/rotationY/description 透传**（custom 快照新增房间此前全部落"排东侧"兜底，静默几何错误；`addRoom` op 契约补 `position` 字段贯通 type/schema/执行器；坑 82）、**setOpenings 的 side 改为可选**（`edgeIndex` 可单独使用，schema 与执行器一致，UI 不再 `as Op` 绕过校验；坑 83）、**RoomShell 地板几何按内容签名 memo**（拖拽预览每帧新 WallPlan 引用但内容不变——Shape/ExtrudeGeometry 不再每帧重建；坑 84）、**CI 补 build 门 + deploy 补测试门**、**`three-stdlib` 声明为直接依赖**（原为 drei 传递依赖的幽灵依赖）、**`npm audit` 清零 high（nanoid 链）**、**format 门修复**（HEAD 上 6 个文件未格式化导致 CI 实际是红的——`npm run format` 收敛；497 用例全绿）。**2026-08-13 追加落地（用户反馈修复批次，坑 86-87）**：**全屋唯一卫生间按公共卫生间处理**（`bathroomDoorTargets` 预扫描：顶层卫生间计数为 1 且无命名归属时，门目标优先级 走廊 > 开放空间（客厅/餐厅/厨房）> 邻居 id 最小——无走廊自由布局里单卫生间不再落到"某卧室专属"；嵌套卫生间不参与"唯一"判定；坑 86）、**家具常配套件自动补全**（新增 `lib/furnitureCompleteness.ts`：书桌/梳妆台→椅、餐桌/圆桌→餐椅、床→床头柜×2、沙发→茶几，挂进 `applyFurnitureConventions`；用户明确不要的通道 = 房间任一家具 `description` 含"不要"等排除词即整房间跳过；随 `furnitureConventions` 选项生效——auto 模板与快照路径补全，custom 自由布局与手动编辑不侵入；幂等；坑 87）、**提示词同步**（第 6 条说明自动补齐与排除通道、第 7 条说明唯一卫生间公共语义；513 用例全绿）。**2026-08-13 追加落地（渲染共面审计批次，坑 88）**：**墙转角端盖互掐修复**（踢脚线/勒脚长度两端各内收 2mm（`END_CLEAR`），端盖平面离开墙端平面——此前踢脚线/勒脚端盖与墙盒端盖同法向共面，每处墙转角三面互掐）、**家具部件同高顶面/端盖/底面逐对错位**（沙发扶手顶面低座面 2cm、靠背端盖内收 6cm、扶手前脸浅 1cm、三底面 3/6mm 递增错开；灶台控制条低柜体 1.5cm + 前脸内收 1.5cm、炉头改为嵌台面上沿（顺带修复炉头整体埋在台面内不可见）；浴缸内胆低缸沿 5mm；书架背板收缝 + 顶/底/背面错位；梳妆镜嵌桌面 + 收缝；床头板/水箱/龙头/电视屏底面抬 3mm）、**共面审计回归防线**（`furniturePresets.test.ts` 61 用例：全种类 × 全档尺寸 × 四朝向枚举所有 box 面，断言无「同法向 + 同平面 + 区间重叠」组合；574 用例全绿）。**2026-08-13 追加落地（部署/UX/类型安全批次，坑 89-92）**：**深链接 404 修复**（`public/404.html` 把原始路径编码进查询串重定向到首页，`index.html` 内联脚本 `?/` 前缀 `history.replaceState` 还原——Pages 静态托管无 SPA 回退，替代 HashRouter 方案，URL 保持 pathname 形式）、**原生 confirm/alert 全量替换**（`ConfirmProvider` + `useConfirm` 的 `confirm()`/`alertMessage()`，HomePage 未保存守卫/生成冲突确认/项目与口令删除/拆合失败提示共 10 处，测试改点按钮断言）、**localStorage 写入防护**（`lib/safeStorage.ts` 读写删 try/catch + 一次性 warn，五个 store persist 共用，配额满不打断编辑）、**`noUncheckedIndexedAccess` 开启**（383 处索引访问收敛：循环边界/长度守卫处加 `!`）。下一代 v3 完整架构见 [设计方案](design.md)，演进脉络见 [版本演进](history.md)，踩坑记录见 [开发注意事项](notes.md)。

本文档面向开发者和贡献者，描述言筑的核心架构、数据契约与实现细节。项目为**纯前端**应用，无需后端。

## 1. 架构总览

言筑的核心设计原则是**语义与几何分离**：

- **大模型负责语义**：输出"建什么"——房间清单、名义尺寸、布置意图（相对关系），不输出绝对坐标。
- **代码负责几何**：布局引擎将语义确定性平铺为精确的足迹几何（正交多边形），保证无缝共用墙、门连通、房屋闭合。

```
用户自然语言 / 当前房屋状态摘要 / 手动编辑日志（P3）
   │
   ▼
大模型（DeepSeek 等，SSE 流式）
   │  输出 ops 操作序列（v2 整屋快照走容错路径）
   ▼
Zod 校验（schemas/ops.schema.ts，逐条容错）
   │
   ▼
确定性执行器 executeOps（lib/executor/ 目录）
   │  逐条应用；macro 复用布局引擎 resolveLayout（lib/layout.ts）
   ▼
已解析模型 SceneModel（types/model.ts + lib/footprint.ts）
   │
   ├─ 渲染层（components/viewport/*）
   ├─ 墙体方案 computeWallPlan（lib/roomGeometry.ts，足迹边分段 + 显式开洞覆盖层）
   └─ 状态层（store/useModelStore.ts）
        └─ 手动编辑 → editDiffToOps（lib/editOps.ts）→ 编辑日志（useChatStore.editOps）
```

**为什么分层**：一个合理的户型本质是"约束平铺问题"（房间无缝共用墙、对齐、动线），LLM 擅长语义组合但**不擅长空间算术**。让 LLM 直接算绝对坐标会导致缝隙/重叠/不合常理。分层后：LLM 决定"哪些房间、多大、怎么连"，代码保证"无缝、连通、闭合"。

## 2. 数据契约

### 2.1 生成契约（P2 起：操作序列 ops，v2 快照为容错路径）

大模型输出的是**操作序列**（`{"version":3,"ops":[...]}`，或直接 ops 数组）——P2 契约动词化（design.md §4）：LLM 只输出增量指令，代码逐条确定性执行。v2 整屋快照仍兼容（快照适配器按 id diff 成 ops 再执行）。

```jsonc
{
  "version": 3,
  "ops": [
    { "op": "macro", "name": "corridor", "params": {
        "name": "温馨之家",
        "corridor": { "width": 1.2, "entranceRoomId": "living_room" },
        "rooms": [ { "id": "living_room", "name": "客厅", "dimensions": {…}, "side": "left", "furniture": [{"id":"sofa","name":"沙发","dimensions":{…},"position":{…}}] } ]
    } },
    { "op": "addRoom", "id": "bathroom1", "name": "卫生间", "dimensions": {…},
      "relativeTo": { "roomId": "living_room", "dir": "west" } },
    { "op": "setOpenings", "roomId": "bathroom1", "side": "east", "kind": "door" }
  ]
}
```

关键约定（详见 `types/ops.ts` / `schemas/ops.schema.ts` / `lib/executor/`（2026-08-13 由单文件 executor.ts 拆为目录））：

- **14 种操作**：`setHouse`（改名 / **迁移入户门 `entranceRoomId` + 方向 `entranceDir`**，P3 补）、`macro`（corridor/living/custom 整体布局，复用旧布局引擎）、`addRoom`/`updateRoom`/`removeRoom`/`moveRoom`、**`nestRoom`（把已有房间内嵌为另一个房间的嵌套子房间，P3 补）**、**`splitRoom`（P4：矩形房间沿轴线切两半，共墙自动开一扇门）**、**`mergeRoom`（P4：并集为合法矩形的相邻房间合并）**、`addFurniture`/`updateFurniture`/`removeFurniture`、`setOpenings`（门/窗开洞，**P4 起支持 `edgeIndex` 精确指边与 `remove: true` 删除**）、`addAdjacency`（相邻约束）。
- **id 全局唯一、复用**：修改已有节点必须用其 id；`addRoom`/`addFurniture` 的 id 可省略（执行器自动生成）。**引用房间可用 id 或名称**：LLM 常不给房间 id 直接用房间名引用，`findRoom`/`mapRoom` 均先按 id、未命中按名称首次匹配（确定性）；`setHouse.entranceRoomId` 落库时解析为真实 id。**⚠️ 坑 71（2026-08-13 修复）**：modelTree/planEdit 的变更函数（`updateNodeFields`/`updateNodeFootprint`/`removeNode`/`replaceRoom`/`updateNodePosition`）只按 id 精确匹配——executor 各 apply 函数必须先 `findRoom` 解析出真实 `room.id` 再调用它们（含 `moveAdjacent` 的自引用判定与 `pickFreePlacement` 排除），否则名称引用的 op 会静默零变更。
- **`relativeTo` 贴靠**：新房间/移动贴到已有房间某侧，无缝共墙，**垂直于贴靠方向的轴对齐走廊边线**（`alignAdjacentPlacement`，坑 46：避免宽度不同的房间与走廊错位出缝隙）；**嵌套房间贴靠时自动提升到顶层（取消内嵌，坑 48）**；**落点与其他房间重叠时按 北/南/东/西 回退选空侧**（`pickFreePlacement`，避免贴到走廊/别的房间上）；无 `relativeTo` 的新房间排到整屋东侧；显式 `footprint` 顶点环优先（L 形/U 形）。**`addRoom` 的 `position`（绝对坐标，房间中心）优先级：footprint > position > relativeTo > 东侧兜底**（2026-08-13 坑 82 补：此前 op 契约缺 position 字段，v2 快照按 position 布局的新房间全部落到东侧兜底）。**`macro` custom 的房间规格同样支持 `relativeTo`**（2026-08-12 起）：`resolveCustom` 按列表顺序贴靠到前文已列出的房间（id 或名称），LLM 用 custom 自由布局描述"客厅东侧是餐厅"时不再全部落到原点。
- **逐条容错**：每条 op 独立 try/catch，失败仅跳过该条（`skipped` 记录原因），绝不整屋回滚；执行顺序 = 数组顺序（确定性）。
- **`macro.name` 容错修复**（2026-08-12，坑 65 之外）：`parseOps` 解析前过 `repairMacroName`——模型常把整屋名填进 `macro.name`（应为 corridor/living/custom），此时按 `params` 确定性推断布局类型（有 corridor → corridor；有 centerRoomId → living；有 rooms → custom），并把原 name 移入 `params.name`（保住整屋名），杜绝"全部 op 无效"。
- **`setOpenings` 的 edgeIndex/remove（P4 补）**：UI 点墙放门窗时提供 `edgeIndex`（footprint 顶点环边下标，坑 39 约定）精确定位，执行器按边下标取边（省略时仍按 `side` 取该方向最长边，LLM 语义不变）；`remove: true` 删除同边同种开洞（给 `from/to` 只删重叠者，省略整边清除）——补齐 P2 已知边界「setOpenings 无删除开洞」。**`side` 与 `edgeIndex` 至少其一即可（2026-08-13 坑 83 起 side 改为可选）**：此前 schema 强索 `side` 而执行器支持 edgeIndex-only，UI 只能 `as Op` 绕过校验；现契约一致（schema 与 TS 类型均可选，跨字段约束由执行器兜底，discriminatedUnion 不支持 refine 包装）。
- **`splitRoom`（P4 画墙拆房间）**：`{ op:'splitRoom', id, axis:'x'|'z', position, name? }`——矩形房间沿轴线在 position（世界坐标）处切两半：原房间保留 id 与西/南部分（a），新房间排东/北侧（b，默认名「原名2」）；家具/嵌套房间按中心归属；显式开洞按边重映射（跨切线丢弃）；**共墙自动开一扇门**——门加在**渲染共享墙的一侧**（`sharedWallOwner`，与墙体方案同源，避免开在非渲染侧成为静默空操作，坑 43 同源）。非矩形房间/切线两侧 < 1m 抛错跳过。
- **`mergeRoom`（P4 合并房间）**：`{ op:'mergeRoom', keep, remove }`——两房间必须为矩形且**并集为合法矩形**（面积守恒判定：`unionRectOf`），keep 保留 id/名称、层高取较大值；家具/嵌套房间保持世界坐标直接并入；显式开洞重映射（变成内部墙的边丢弃）；remove 是入口房间时 `entranceRoomId` 迁移到 keep；**keep 嵌套在 remove 内时交换角色**（否则 removeNode 会连 keep 一起删掉）。
- **多轮上下文（P3 起）**：当前场景摘要（房间/家具 id·名称·尺寸 + **顶层房间邻接表（邻居-方位，与墙体判定同源）**）+ **手动编辑日志**（`useChatStore.editOps`，与对话 op 同构）注入对话；历史只回传用户消息与文本助手消息（助手纯 JSON 的上一轮 ops 原文由摘要替代，token 省 80%+）；LLM 基于摘要 + 日志输出增量修改。
- **编辑 op 回流（P3 双向同步）**：手动编辑（属性面板/Gizmo/位移微调）提交时经 `editDiffToOps`（lib/editOps.ts）diff 成单条 op——家具 → `updateFurniture`（position 换算为相对房间中心），房间 → `updateRoom.patch.footprint`（世界坐标顶点环）；日志上限 50、会话内不持久化；`setScene`/`resetScene`/`clearConversation` 时清空（旧日志描述的是已替换的场景）。撤销/重做栈为整场景快照（**最终设计，不做 op 粒度化**——op 逆操作难以定义且回放不保证还原，快照正确性最稳）。
- **v2 快照容错**：auto 模板 → 直接映射 `macro`（与旧版行为一致）；custom → 按 id 递归 diff（改名/改尺寸/增删房间/家具增删改）；v3 场景原样通过（`migrateModel` 幂等）。
- **房间规格与家具规格**沿用 v2 语义：家具 `position` 相对所在房间中心（x/z 偏移、y 为高度一半）；房间可嵌套子房间；`custom` 模式支持绝对 `position` 或 `footprint` 顶点环。
- **卫生间命名归属**：`X卫生间` 只与其归属房间 `X` 开门（`主卧卫生间 → 主卧`、`走廊卫生间 → 走廊`）。**全屋唯一卫生间公共语义（2026-08-13 坑 86）**：顶层卫生间计数为 1 且无命名归属时，门目标优先级 = **走廊 > 开放空间（客厅/餐厅/厨房）> 邻居 id 最小**——无走廊自由布局里单卫生间不再按旧规则（邻居 id 最小）落到"某卧室专属"；嵌套卫生间（嵌在卧室内的）不参与"唯一"计数；多卫生间场景保持原规则（走廊优先 / 邻居 id 最小，确定性）。

### 2.2 已解析模型（内部统一格式，v3）

布局引擎输出 `SceneModel`（v3，足迹几何），一切具有**绝对坐标**，供渲染/存储/墙体方案消费：

```ts
interface SceneModel { version: 3, root: HouseNode }
interface HouseNode {
  id: string; name: string; style?: string
  levels: LevelNode[]               // 楼层（P1 恒为单层，Phase 5 预留多层）
  entranceRoomId?: string           // 入户房间 id（迁移保留）
  entranceDir?: 'north'|'south'|'east'|'west'  // 入户门方向（默认 south 南墙，setHouse 可改）
}
interface LevelNode { id: string; height: number; rooms: RoomNode[] }
interface RoomNode {
  id: string; name: string
  footprint: Point2D[]              // 正交多边形顶点环（世界坐标，矩形 = 4 点特例）
  height: number                    // 层高，独立于 footprint
  doors: Opening[]; windows: Opening[]   // 显式开洞（覆盖层，P4 起平面图编辑可产出；模型/渲染/墙体层 P1 已支持）
  furniture: FurnitureNode[]        // 家具（绝对坐标）
  nestedRooms: RoomNode[]           // 嵌套子房间（如卧室内卫生间）
}
interface Opening { edgeIndex: number; from: number; to: number; width: number }  // 相对所在边局部区间
```

- **房间不再存 position/dimensions**：中心/尺寸由 footprint 推导（`lib/footprint.ts` 的 `footprintCenter`/`footprintDims`/`roomCenter`/`roomDims` 等纯函数统一提供，属性面板/Gizmo/HomePage 全部经 `nodePosition`/`nodeDims` 访问器消费）。
- 房间高度独立于 footprint；整屋高度 = 楼层高度（墙顶/标注层）。
- **显式开洞覆盖层**（设计 §3.2）：`doors/windows` 显式开口在渲染时覆盖推导结果（`applyOpenings`）；P2 起 `setOpenings` 操作（LLM 生成路径）可产出，P4 起平面图编辑「门窗」工具提供 UI 入口（点墙放门窗/点已开洞删除），P1 生成器/示例模型仍产出空数组。

### 2.3 迁移与版本（migrateModel，lib/migration.ts）

- `migrateModel(input)`：v1 盒子模型 → v3 足迹模型（盒子 → 4 点足迹、`entranceRoomId` 保留、`wall` 类型家具并入 `furniture`、单层 `levels`），**幂等且纯函数**；v3 输入原样返回；非法输入返回 `null`（调用方降级提示，不崩溃）。
- 三条旧数据路径全部走迁移：本地项目库（HomePage 打开项目时）、分享口令（ShareDialog 还原时）、localStorage 持久化（`useModelStore` persist `version: 2` / `useChatStore` persist `version: 3`（坑 81 起消息不再携带模型）+ `migrate`）。
- 分享口令编码加版本前缀 `wc3:`（`compression.ts`），旧口令（无前缀）解码兼容——前缀仅用于标识，解码逻辑对两种格式一视同仁。

## 3. 布局引擎（lib/layout.ts）

`resolveLayout(sceneV2): SceneModel` 将 v2 语义模型平铺为 v3 足迹模型（P1 平铺仍产矩形足迹）：

1. **corridor 走廊型**：走廊沿 X 贯穿；房间按 `side`（left=南/right=北）在两侧顺序平铺、无缝贴合；入口房间强制置于南侧并排最前；单房间省略走廊。
2. **living 客厅居中型**：中心房间（`centerRoomId`）居中于原点，其余房间按 `side` 环绕排布。
3. **custom 自由型**：房间直接用 LLM 提供的绝对坐标；**2026-08-12 起支持 `relativeTo`**（顺序贴靠到前文已列出的房间，见 §2.1），无 position/footprint/relativeTo 才落原点。
4. **嵌套房间**：`makeRoom` 递归——嵌套房间按 `side` 靠父房间对应**角落**（贴两面墙，`placeNested`）、无提示时靠东北角；门朝父房间内部；`normalizeContainment` 再兜底约束进父房间。**真·内嵌**：`computeAllWallPlans` 为嵌套房间算独立分隔墙方案——与已渲染墙共线且被覆盖的边渲染为 `open`，其余边为内部分隔墙 + 朝父中心的门；`containChildren` 同时把父房间家具（含手动编辑）推出嵌套占地。
5. **嵌套房间避让父房间门区**（2026-08-12，坑 47 的布局引擎版本）：`placeNested` 按角落落位时不看父房间门洞，内卫无 side 默认东北角可能恰好压住父房间朝走廊的门（门后无墙）。`resolveLayout` 布局完成后统一跑 `avoidNestedDoorZones`：嵌套房间与父房间门区（`computeDoorZones` + `doorZoneRect`，与渲染同源、含入户门）重叠时按 东北/西北/东南/西南 确定性换角，覆盖 corridor/living/custom 全部模板（与 `applyNestRoom` op 路径行为一致）。
6. **整屋包围盒**：所有房间+走廊的足迹求包围盒 → 平移到原点居中（`translateRoom` **递归平移嵌套房间足迹与家具**，否则嵌套房间会脱离父房间）。整屋不存 dimensions（由 `houseBounds` 推导）。
7. 家具相对父房间中心偏移为绝对坐标；`normalizeContainment` 将家具约束进墙内、推出嵌套子房间占地（真·内嵌）**与门口通道**（`computeDoorZones` + `doorZoneRect`，与渲染/常理摆放同源——手动编辑与 LLM 生成统一兜底，堵门家具被推出门口禁区）。

**布局惯例**：客厅近入口（南侧）、卧室沿走廊两侧、单间房无走廊、除入户门外房屋闭合。

**家具常理摆放**（`furniturePlacement.ts`，仅 auto 模式 + 示例模型）：靠墙家具（衣柜/橱柜/书桌/沙发等，`isWallAnchored`）贴**最近墙**（保持平行于墙的坐标），**大面积贴墙**——长边（max(长,宽)）沿墙，必要时**交换长宽**实现 90° 旋转（`rotationY` 同步 +90°，渲染器暂不读 rotationY，视觉靠交换后的尺寸生效）；**床例外：短边（床头）贴墙**；再**沿墙滑动**避开三类禁止进入区：嵌套子房间（足迹包围盒 + 墙厚）、**房间门口通道**（`computeDoorZones` 从墙体方案提取门洞，含入户门，`DOOR_CLEARANCE=1m` 深 × 门宽）、已放置的其他家具。独立家具（茶几/餐桌/椅子等，`FREE_STANDING_RE`）保持原位，仅约束进墙内并避让上述禁区。custom 自由布局保留大模型的显式坐标。

**2026-08-12 管线修复（坑 66）**：auto 分支**先常理摆放、后 normalize**（不再先 normalize——否则家具被推到"零重叠但位置差"的角落，后续"就近贴墙"被带偏，把本该留给其他家具的墙面占掉，复现"主卧衣柜与床重叠"）；`slideAlongWall` 改为**迭代滑动**（单趟"避开 A 撞上 B"：沿墙滑开卫生间时可能撞进已放家具），带 visited 震荡防护；重叠判定必须**逐禁区判断**（不可把"任一禁区重叠"的全集合结果复用于每个禁区）。

**常配套件自动补全（2026-08-13 坑 87，`furnitureCompleteness.ts`）**：生成链路对 LLM 漏配的配套做兜底——书桌/梳妆台 → 使用者侧补 1 椅、餐桌/圆桌 → 两侧补 2 餐椅、床 → 床头两侧补 2 床头柜、沙发 → 前方补 1 茶几；**用户明确不要的通道**：该房间任一家具 `description` 含「不要|不需要|免配|别放」等排除词即整房间跳过（用户要求优先，提示词第 6 条已说明）；已有同类家具不补（幂等）。**范围边界**：随 `furnitureConventions` 选项生效——auto 模板（corridor/living）与 v2 快照路径补全，custom 自由布局与手动编辑不补全（custom 保留 LLM 显式清单、手动编辑是用户显式操作，均不应被侵入）。补全件初始位置由主家具当前位置推导（绝对坐标），最终由摆放流程确定（硬保证不越界不重叠，软目标贴合主家具）。

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
- **相邻判定泛化**（设计 §3.2）：旧"四面对齐盒子共线重叠" → 新"足迹边共线重叠"——对侧边同线（|line 差| ≤ ADJACENCY_GAP）且区间重叠即为邻居，规则不变：共享墙去重、开放空间不设墙、私密房间不互开门、**卫生间单门规则**（`bathroomDoorTargets` 预扫描：命名归属房间存在（主卧卫生间→主卧）只对它开门；公共/普通卫生间走廊优先（"卫生间移开走廊门"）；无走廊时选邻居 id 最小者——用户要双门用 `setOpenings` 显式加）、卫生间命名归属、外墙保留、入口方向外墙入户门。
- **私密房间开门规则按走廊门控**（2026-08-12，坑 11 修正）：「私密房间只连走廊、不直连客厅/厨房等开放空间」的规则**前提是房屋里有走廊**——无走廊的自由布局（custom）若仍套用，卧室只剩卫生间一个出入口（布局"错乱"）。`computeWallPlan` 预扫描 `hasCorridor`：有走廊时维持原规则（卧室/书房只连走廊与其套间卫生间）；无走廊时私密房间与开放空间直接开门（保证可达）。卧室↔卧室始终不互开门。
- **显式开洞覆盖层**：`applyOpenings(plan, rooms)` 把 `RoomNode.doors/windows` 的局部区间切到对应边的实心墙段上（`door`/`window` 段，不影响 `open` 段），先于兜底门判定执行（已开洞房间不再兜底开门）。
- **入户门与显式开洞互让**（2026-08-12，坑 65）：`applyOpenings` 先切墙，`addEntranceDoor` 后放置——门只开在**长度 ≥ DOOR_WIDTH 的实心墙段**上（绝不缩窄成小门、绝不劈开窗段），入口墙放不下（如整面外墙被大窗占满）时按确定性顺序（入口方向 → 顺时针 east/north/west）换其他外墙，全部放不下则静默省略。历史教训：窗先开门被挤小、门先开窗被劈成两段，都是"门与窗互不相让"的同一个根因。
- **嵌套房间分隔墙**（真·内嵌）：`computeAllWallPlans` = `computeWallPlan`（顶层零改动）+ 自顶向下为每个嵌套房间调 `nestedWallPlan` 写入同一 Map。`nestedWallPlan(node, parent, plan, roomById)` 对每面墙做**全量墙线并集查询**——收集同一世界墙线（`|line 差| ≤ WALL_THICKNESS + 1e-6`，容忍浮点贴边）上所有非 `open` 段的覆盖区间，被覆盖处切为 `open`（由外层墙围护，避免与父墙/邻居墙双重墙）；其余边为内部分隔墙，门开在朝父中心一面（退化时最近含 `wall` 段的面，四面全覆盖则不开门）。段切分后用 `cleanSegments` 合并相邻同类型段并去除浮点噪声微段。
- **门口禁区**（`computeDoorZones`/`DOOR_CLEARANCE`）：从墙体方案提取各顶层房间门洞（含入户门），供家具常理摆放避让，并供 `normalizeContainment` 兜底推出手动编辑/LLM 生成的堵门家具；与渲染用 `computeWallPlan` 同源，保证门洞位置一致。

## 5. 渲染管线（components/viewport/*）

- **SceneViewer**：R3F Canvas（`gl={{ preserveDrawingBuffer: true }}` 供截图读取缓冲；**`toneMapping: ACESFilmic` + `toneMappingExposure 1.05`**，2026-08-13 写实化；`shadows='soft'` = PCFSoftShadowMap，设置关断时连 shadowMap 一起禁用）；初始 45° 南视角正对入户门（`[0, 9, -10]` 朝北看，`far: 10000` 容纳天空球）；**内容组整体沿 X 镜像**（`<group scale={[-1,1,1]}>`，3D 与 2D 平面图一致，坑 26：世界 +x=东、+z=北 是左手系，镜像补偿后呈现**标准地图方向——上北下南、左西右东**，默认南视角东在屏幕右侧）；**双罗盘**：世界锚定罗盘（`WorldCompass`：drei Html 把 东/西/南/北（zh）/N·E·S·W（en）钉在整屋包围盒外沿四个世界方位——**按各方向自身半宽/半深定位 + 2.8m 边距**（旧实现用 max 半宽导致宽度 > 深度时东/西标签更贴近房屋、遮挡东侧「总宽」尺寸标签），在镜像组内自动随内容镜像，任意视角下都指向真实东西南北，不进入 WebGL 截图缓冲）+ 右上角覆盖层罗盘（`CornerCompassSensor`：N/E/S/W 标签按各自世界方向**镜像（x 取反）后**的屏幕投影方位角逐帧单独定位，非刚性玫瑰）；**Gizmo 渲染在镜像组之外**，代理坐标 x 取反与镜像内容对齐（`GizmoControls`，坑 55）；**2D 平面图 = 标准地图**：同一镜像组 → 北朝上、东朝右。P4 编辑层在镜像组内渲染（指针经 `worldToLocal` 还原足迹坐标）。**环境（2026-08-13 写实化）**：仅 3D 模式渲染 drei 程序化 `<Sky>`（`sunPosition` 与主光对齐，材质显式 `fog=false` 避免被雾吞掉）+ 地平线雾 `<fog args={['#e8e3d4', 30, 120]}>`（地面 6m 留白边缘融进地平线）；`EnvironmentBridge` 用 `PMREMGenerator + RoomEnvironment`（three 自带，零外部资源）写入 `scene.environment`（`environmentIntensity 0.4`）——玻璃/金属获得反射内容。
- **Viewport3D**：从 `scene.root.levels[0].rooms` 提取顶层房间，计算所有房间（含嵌套）的墙体方案（`computeAllWallPlansCached`，**坑 72 共享缓存**：WeakMap 按场景引用缓存 + 单条目内容签名（足迹/开洞/入口/**房间名**——名字参与门/墙推导，漏名字会让重命名后命中陈旧方案，坑 106），`PlanEnhancements`/`PlanEditLayer.collectWallHitEdges` 同引用只算一次，拖拽预览每帧至少省 2/3 重复计算；缓存 Map 为只读，调用方不得修改）；`screenshotMode` 时隐藏网格/坐标轴。
- **ModelNodeView**：递归渲染层级模型——
  - **房间外壳**（`RoomShell`）：**足迹地板** = footprint 沿非共享边外扩一个墙厚（`floorPolygon` 逐边求偏移线交点，矩形下与旧"四边外扩"语义一致），`THREE.Shape` + `ExtrudeGeometry` 拉伸 `FLOOR_THICKNESS`（旋转 -90° X 铺平到 XZ 平面，shape 坐标 y = -世界 z）；**墙段沿足迹边摆放**——段局部坐标以边起点为 0（坑 37），墙组锚在**边起点**（`wallGroupPosition`，坑 41：锚边中点会偏移半个边长），轴 'x' 边平放、轴 'z' 边 `[0, -π/2, 0]` 旋转（局部方向统一为 + 轴，旧"东西墙 -90° hack"泛化为按边轴推导）；门洞/窗洞与墙同高；嵌套子房间地板略微抬高避免与父地板重叠闪烁。**材质层（2026-08-13）**：地板材质按房间名自动匹配（卫生间/厨房→瓷砖、走廊/其余→木地板、阳台→防腐木，走廊由混凝土改为木地板融入暖色房间群），`roomFloorMaterial(name, colorMode, siblingIndex)` 输出中性灰纹理 × 房间识别色淡化 tint（识别色保留在地板、墙身中性化；木地板/防腐木向暖白抹灰 `#f0ede4` 混 80%——识别色只留淡暖色调，瓷砖/混凝土向纯白混 66%；ExtrudeGeometry 顶面 UV = 形状世界坐标，经 `getWorldUvTexture` 取带 `repeat=1/tileMeters` 的克隆纹理按世界米平铺）；墙段统一暖白抹灰（`WALL_INTERIOR_COLOR`），**外墙**（`WallEdge.shared=false`）±z 面外侧用外墙抹灰饰面 + `plasterWall` 纹理（`boxWallGeometry` 按段长/墙高拉伸 UV，六面多材质数组）；**踢脚线**（高 0.08，房间识别色加深，`skirtingColor`）；**基座勒脚**（外墙底部 0.28m 深灰压边、外凸 3cm，墙段与窗台下连续、门段留空）；**门套**（室内侧两立柱）与**实体窗框**（上下轨/立柱/大窗中梃，`TRIM_COLOR`）。**共面错位（坑 77/88）**：墙/勒脚/踢脚线/门套的底面与外侧面逐一错开 1~2.5mm（`BASE_CLEARANCE`/`POST_CLEAR`/`PLINTH_CLEAR`/`PLINTH_INNER_CLEAR`），墙与家具沉入地板顶面 2mm（`FLOOR_EMBED`/`FLOOR_TOP_Y`，Gizmo 换算同步）——消除同法向共面 z-fighting 闪烁；**踢脚线/勒脚端盖内收 2mm（`END_CLEAR`，坑 88）**——端盖不再与墙盒端盖同平面（墙转角三面互掐的根因）。
  - **嵌套房间**：`wallPlan?.get(node.id)` 命中 `computeAllWallPlans` 算出的分隔墙方案（与父墙共线处 `open`）；无方案时兜底 `wallPlanWithDoor(room, nestedDoorDirection(node, parentCenter))`。
  - **window 段渲染**：窗台（实体，高 0.9）+ 半透明反射玻璃（深蓝灰 `#3a4a55`、metalness 0.85、roughness 0.12，吃环境反射）+ 窗楣（实体）+ 实体窗框——沿用"门段永远渲染为开洞"原则，绝不渲染成实心墙。
  - **点击选中部件**：家具/嵌套房间的 `onClick` 调用 `stopPropagation()`；房屋线框盒（足迹并集包围盒）与房间选中轮廓盒（足迹包围盒）都加 `raycast={() => null}`。
  - **家具**：实体 vs 虚化两态；朝向 `facingFromRoom` 消费 `roomCenter/roomDims` 派生的房间几何；材质由 `furnitureMaterial(kind, shade, colorMode)` 匹配（见 §5.1）。
  - **聚焦模式**：点击房间 → 该房间外壳透明化以查看内部实体家具，其他房间虚化。
- **入户门**：暖橙门扇（`ENTRANCE_DOOR_COLOR`），门洞上方不再有标识牌/横梁（用户反馈移除）。
- **室外地面**（`GroundView`，2026-08-13）：整屋包围盒 + 6m 留白草地平面（顶面 y=-0.01 承接地板，接收阴影，中性灰草纹 × 灰绿 tint）；**入户石板小径与门洞对齐**——从 `wallPlan` 中找真实 `entrance` 门段（含入口墙放不下时兜底换墙的场景）算门洞世界中心，石板沿该边外向法线从门口向外铺（石板 0.9m 与门宽对齐，微抬 1mm 不与草地共面）。
- **屋顶已移除**（2026-08-13 晚，用户决策）：一层户型屋檐遮挡内部视野，`RoofView.tsx` 删除、`roof` 设置项全链路清理（types/settings、useSettingsStore、设置页 UI、i18n），settings persist 升 v5 并在 migrate 中剔除旧存档残留的 `roof` 字段（坑 79）。
- **灯光与阴影**（`SceneViewer`，2026-08-13 写实化）：ACES 色调映射 + `shadows='soft'`（PCFSoft）；ambient 0.35 + hemisphere（`#f2f6ff`/`#8d8570`）+ directional 1.4（暖白）`castShadow`（2048² 阴影贴图，`shadow-bias -0.0004`，**相机边界随 `houseLevelsBounds` 动态伸缩**）；家具/墙段/石板 `castShadow`，地板/墙面/地面 `receiveShadow`；设置项 `shadows` 关闭时连 shadowMap 一起禁用。
- **属性面板**（`PropertyPanel`）：选中模块后浮于视口右侧，编辑名称/长宽高/X·Y·Z；房间的尺寸/坐标为足迹派生值（`nodeDims`/`nodePosition`），提交时由 `updateNodeFields` 转为足迹缩放/平移（`height` → 层高，位置 Y 对房间无效）；数字输入本地草稿态、Enter/blur 提交；位置微调与复位位置直接调用 `translateSelected`/`resetSelectedPosition`。

### 5.1 家具部件模型（lib/furniturePresets.ts，v1.4.0）

家具不渲染为统一长方体，而是按名称识别种类、用程序化部件拼装（纯函数，无渲染依赖；**P1 无变化**）：

- **分类**：`furnitureKind(name)` 用中文正则词表把家具名映射到种类（床/衣柜/书桌/沙发/椅子/马桶/洗手池/冰箱/电视柜/餐桌/圆桌/书架/洗衣机/浴缸/床头柜/梳妆台/鞋柜/灶台/烤箱/微波炉，20 类），未命中回退 `generic`（整盒）。`GENERIC_GUARD_RE` 先排除易误判词（如「床尾凳」含「床」）；词表顺序敏感——床头柜/床边柜须在「床」之前（含子串的宽松词后置）。
- **拼装**：`buildFurnitureParts(kind, L, H, W, facing)` 返回部件列表（`center`/`size`/`shape`(box|cylinder)/`shade`）。柜/沙发等按「背侧朝 +z」的规范朝向构建，东/西墙用「交换长宽 + 旋转 90°」、南/北墙用 0°/180°（`orientParts`），足迹保持不变；`BACK_DIR`/`BACK_AXIS` 声明每类背侧的局部方向与沿轴。
- **床/浴缸**：单独 `buildBedParts`/`buildBathtubParts`——床头板/枕头放**长轴端**（短边中间）、浴缸长边贴墙，朝向由长轴上最近的墙决定；放置层（`furniturePlacement.ts`）也例外处理床**短边贴墙**（浴缸长边贴墙即常理，无需例外）。
- **朝向**：`facingFromRoom(node, room, backAxis)` 由家具在父房间内的位置算背侧应贴的墙（短轴/长轴规则，避免转角衣柜门开在小面）；v3 下父房间几何经 `roomCenter/roomDims` 派生。
- **配色**：三档——主色 `FURNITURE_COLOR`（色盲模式切换）、副色 `FURNITURE_PART_DARK`、深色强调 `FURNITURE_PART_INK`（床头板/柜门/电视屏/浴缸内胆），常量定义在 `lib/palette.ts`，`buildFurnitureParts` 只产出 `shade: 'base'|'secondary'|'dark'` 标签，渲染时映射。**材质层（2026-08-13）**：渲染侧改由 `materials.furnitureMaterial(kind, shade, colorMode)` 按（种类, 明度档）匹配 木纹/织物/金属/陶瓷/玻璃/塑料（色盲模式统一中性灰），`FURNITURE_*` 常量仍为颜色工具库保留。
- **防共面（z-fighting）**：垂直面前脸部件不得与箱体/床架前脸共面——箱体前脸后缩 `doorTh+0.02`、门板凸出；床头板内凹 0.05、沙发靠背/扶手内凹 0.03。

## 6. 状态管理（store/*）

- **useSettingsStore**（Zustand + persist → localStorage `wordcraft.settings`）：API Keys、Base URL、默认模型、深度思考模式、颜色模式、线框、`shadows`（实时阴影）开关、调试开关、`language`。`version: 5` + migrate（v5 起剔除旧存档残留的 `roof` 字段——屋顶已随材质层后续批次移除，坑 79；旧数据缺省补开 `shadows`）。
- **useModelStore**（persist → `wordcraft.model`）：当前场景（v3 足迹模型）、选中节点、聚焦房间、初始位置快照（`nodePosition`，房间取足迹中心）、**撤销/重做历史栈（`past`/`future`，仅会话内不持久化）**、**平面图编辑工具 `planTool`（select/move/vertex/opening/split/merge）+ `openingKind`（P4，会话内）**；`setScene` 应用 `normalizeContainment` 并清空历史。**persist `version: 2` + migrate**：旧持久化（v1 模型）读取时经 `migrateModel` 迁移。
  - 编辑提交统一走 `updateSelected(patch)`：不可变更新 `updateNodeFields`（房间补丁 → 足迹缩放/平移/层高，空补丁返回原引用）→ `normalizeContainment` 约束进墙内并推出嵌套占地/**门口通道**（`computeDoorZones` + `doorZoneRect`，与渲染同源）→ 旧场景压入 `past` 并清空 `future`；**每次提交（含 translateSelected/resetSelectedPosition/commitDrag）经 `editDiffToOps` 把编辑 diff 成 op 追加进 `useChatStore.editOps`**（P3 双向同步）。
  - `translateSelected` 与 `resetSelectedPosition` 每次调用各记一步历史；历史上限 50 步。
  - **Gizmo 拖拽**：`gizmoMode`（会话内）+ `previewSelected(patch)`（拖拽中实时更新，不记历史、不约束）+ `commitDrag(baseScene)`（结束一次性压入历史、记一条编辑 op，并对当前场景 `normalizeContainment`）；代理同步用 `nodePosition`/`nodeDims`。`screenshotMode` 截图瞬间隐藏辅助元素。**拖拽预览抑制持久化（2026-08-13 坑 80）**：`previewSelected`/`previewFootprint` 每帧产生新场景引用，persist 每次 `setState` 后同步 JSON.stringify 全场景写 localStorage（坑 75 只修了脏检查的每帧 stringify，persist 自身仍每帧写）——现 persist 走 `previewAwareStorage` 存储层开关，预览期间跳过写入（瞬态预览丢失可接受），提交时恢复；**不要用 partialize 返回 undefined 实现**（zustand v4 对 undefined 仍会写 `{"state":...}`，清掉已持久化场景）。
  - **平面图编辑（P4）**：`previewFootprint(id, footprint)`（顶点拖拽预览，不记历史）+ `commitPlanEdit(baseScene, id)`（拖拽结束：约束 + 压入拖拽前快照 + `editDiffToOps` 记编辑日志）+ `applyPlanOps(ops)`（非拖拽类编辑：`executeOps` 执行 → 有实际变化才压入历史 + 追加编辑日志）；`planTool`/`openingKind` 会话内不持久化，`setScene`/`resetScene` 复位为 select。
- **useChatStore**（persist → `wordcraft.chat`）：对话消息、生成态、**生成历史栈**（会话内不持久化）：每次生成成功前 `pushGenerationHistory(prevScene)`（上限 20）；`undoLastGeneration()` 弹出快照并移除最后 user+assistant 对；`clearGenerationHistory` 在加载示例/清空场景/打开项目/清空对话时调用。**编辑操作日志 `editOps`**（P3，上限 50、会话内不持久化、`clearConversation`/`clearEditOps` 清空）：手动编辑产出的同构 op，随多轮上下文喂给 LLM。**`toChatHistory`（P3 精简）**：只回传用户消息 + 文本助手消息，助手消息中的纯 JSON（`{` 开头）即上一轮 ops 原文被剔除（由摘要 + 编辑日志替代）。**persist `version: 3`（2026-08-13 坑 81 升）+ migrate**：**消息内嵌的 `model`（整场景快照）不再落盘**——多轮对话每轮各带一份完整 SceneModel，持久化以每次 addMessage 全量重序列化的代价逼近 5MB 配额；`model` 仅供会话内「撤销生成」使用（`generationStack` 已覆盖），migrate 时把 v2 存档中的 `model` 一并剥离。
- **useProjectStore**（persist → `wordcraft.project`）：当前场景所属项目（`currentId`/`currentName`，持久化）+ 会话内脏标记 `dirty` 与**已保存快照 `savedJson`**（2026-08-13 收敛，坑 75）：`commitSavedScene(sceneJson)` 在 打开/保存/新建项目后调用，`useDirtyTracking`（HomePage hook）订阅场景变化只在「干净 → 变化」时比对一次，撤销/重做回已保存状态由 `syncDirtyWithSaved` 清除（详见 notes 坑 28/75）。

## 6.5 本地项目库与 2D 俯视平面图（v1.1.0）

### 本地项目库

- **数据**：Dexie（IndexedDB）`wordcraft.projects`，`ProjectRecord {id?, name, data(模型JSON), createdAt, updatedAt}`；`database.ts` 提供 `listProjects`（按 updatedAt 倒序）/ `saveProject` / `getProject` / `updateProject` / `deleteProject`。
- **UI**：HomePage 工具栏「保存」「项目库」+ `ProjectLibraryDialog`（新建/打开/重命名/删除）。保存无当前项目时打开对话框聚焦名称输入；有当前项目时 `updateProject` 覆盖。
- **打开项目**：`JSON.parse` → **`migrateModel` 迁移**（旧 v1 项目自动升 v3；解析失败/迁移失败提示无效）→ `setScene(parsed)`（内部 normalize + 初始位置快照 + 清历史）→ `setProject`。切换/加载示例/清空前用 `confirmDiscardUnsaved` 守卫未保存修改。
- **生成/示例/清空** 后 `clearProject()`：新场景成为游离场景，不属于任何项目。

### 2D 俯视平面图（同 Canvas 正交相机）

- **纯函数**（`lib/planGeometry.ts`）：`houseBounds`（**由所有房间足迹并集包围盒外扩墙厚推导**，兼容旧 `house.dimensions` 语义）、`walkRooms`（levels[0] 递归，嵌套下标 = 父家具数 + 嵌套下标，与 3D 配色一致）、`dimensionLines`、`computePlanCamera` + 平面图增强用 `doorLeafLine`/`doorArcPoints`/`windowHatchLines`/`roomDimLines`（§6.5 平面图增强）。均可单测。
- **相机切换**：drei `OrthographicCamera makeDefault` + `OrbitControls key` 强制重挂载（⚠️ 必须用 drei 相机组件）。
- **取景**（`PlanRig`）：`camera.up.set(0,0,1)` + `lookAt(整屋中心)` 正北朝上；`zoom = computePlanCamera().zoom`。**⚠️ 坑 73（2026-08-13 修复）**：effect 依赖取景几何签名（`houseBounds` 数值串）而非 scene 引用——拖拽预览每帧产生新 scene 引用但包围盒不变，依赖 scene 会每帧重取景并 `saveState()`（视图跳变 + 复位基准被覆盖）。
- **标注**（`PlanAnnotations`）：drei `Html` 绘制房间标签（`roomCenter` 定位）+ 整屋尺寸线；标签高度 = 楼层高度以上。**房间标签恒只显示名称**（尺寸由平面图增强的尺寸线/足迹呈现，不重复标注长宽）。
- **平面图增强**（`PlanEnhancements`，README 路线图「2D 平面图增强」，非 design.md P5）：平面图模式下 3D 家具网格由 `ModelNodeView` 跳过渲染（`planMode` 透传），改以 **2D 家具足迹**呈现——半透明填充 + 轮廓线 + 朝向标记（床画床头板、其余画背侧贴墙线），点击可选中；**门窗符号**与 3D 墙体方案同源（`computeAllWallPlans`）：门扇线 + 开启弧线（`doorLeafLine`/`doorArcPoints`，90° 短弧落在房间内、不越出洞口区间；入户门暖橙）、窗洞双线（`windowHatchLines`，浅蓝）；**房间尺寸线**（`roomDimLines`，顶层房间内部标长/宽，< 2m 的边跳过，仅选择工具且 `useModelStore.showPlanDims`（工具栏「尺寸」开关，会话内）为开时显示，避免标注遮挡房间）。尺寸开关独立一行（工具栏第二行，不挤占工具行）；操作提示条仅在非选择工具时渲染（空文案不露出黑底空胶囊）。三层高度：足迹 0.14 / 符号 0.25 / 尺寸 0.35（互不遮挡、低于编辑层交互平面 0.5）。
- **平移**：`pan()` 正交分支 scale = `1/zoom`。

## 6.6 中英双语（i18n，v1.2.0，P1 无变化）

- **轻量自研，零依赖**：
  - `src/i18n/translations.ts` — 纯模块，`zh` 词典为 key 真源（`as const`）、`en: Record<TKey, string>` 保证 key 一致；`translate(lang, key, params)` 纯函数，`{name}`/`{count}` 插值（`split/join`），缺 key 回退 zh → key。
  - `src/i18n/index.ts` — `useT()`（响应式 hook，订阅 `useSettingsStore.language`，供组件）+ `t(key, params)`（非响应式，内部读 `getState().language`，供 lib 抛错时用）。
- **状态**：`useSettingsStore.language`，persist version 3 + migrate（旧数据回退 zh）。
- **切换**：`components/ui/LanguageToggle.tsx` 可复用按钮（首页工具栏右侧 + 设置页标题行，zh 显示 EN / en 显示 中文）→ `setLanguage`；`App.tsx` 随语言更新 `document.documentElement.lang`、`document.title` 与 meta description。
- **范围边界**：`src/i18n/translations.ts` 只翻译 **UI 界面层**。**生成数据不翻译**——但 LLM 系统提示词与分类词表已双语化（2026-08-13 起）：英文 UI 下发英文提示词、LLM 产出英文房间/家具名，`roomGeometry`（走廊/开放/私密/卫生间归属）与 `furniturePresets`（20 类家具）+ `furniturePlacement`（独立/靠墙判定）的分类词表均为中英双语，配套补全件名称随界面语言。**真实边界**：分类依赖词表与模型输出语言匹配——词表外的写法（如 "Master En-suite" 这类复合命名）可能漏判；`roomFloorMaterial` 的英文房名匹配（bathroom/kitchen/balcony）只覆盖常见词；示例模型名、已保存项目内容保持原样。改分类器/提示词做多语言时，中文英文两套词表必须同步维护。
- **错误本地化**：`chat.ts` 的 `ChatGenerationError` 与 `api.ts` 的错误字符串用 `t()` 在抛出时按当前语言生成（默认 zh 与原文逐字一致，既有测试不受影响）。

### 6.6.5 平面图自由编辑（P4，v2.3）

- **交互层**：`components/viewport/PlanEditLayer.tsx` 渲染在平面图镜像 group 内（`SceneViewer` 的 `<group scale={[-1,1,1]}>`，仅 planMode 且非截图时渲染）：透明大平面承载指针事件，射线在世界 y=0 平面取交点后经 `group.worldToLocal` 还原为足迹坐标（镜像安全）。工具状态 `useModelStore.planTool`/`openingKind`，工具栏在 HomePage 平面图视图左上（i18n 双语 + 逐工具操作提示）。
- **五种工具**（全部产出与对话同构的 op）：
  1. **移动**：拖房间主体 → `previewSelected`（平移足迹）+ 松开 `commitPlanEdit`（撤销栈 + `updateRoom.patch.footprint` 进编辑日志）；`snapRoomTranslation`（lib/planEdit.ts）贴墙吸附——网格吸附先、边对齐后（邻居边共线、线差 ≤ 0.25、区间重叠 ≥ 0.5 时对齐，两轴独立）。
  2. **顶点**：点击选中房间后拖角点 → `dragVertexFootprint` 正交约束（被拖顶点取网格点，前驱/后继沿边滑行，其余不动）+ `footprintValid` 校验（边 ≥ 0.3m 轴对齐、非相邻边不相交）→ `previewFootprint` 预览 → `commitPlanEdit` 提交；非法拖拽（退化/自交）静默拒绝。
  3. **门窗**：`collectWallHitEdges`（与渲染同源 `computeAllWallPlans`，含 footprint 边下标）→ `hitWallOnEdge`（距墙线 ≤ 0.4 命中）；实心墙段 → `setOpenings`（`edgeIndex` 精确指边 + 命中点居中 from/to），门/窗段 → `setOpenings remove: true` 删除；已有开洞以彩色标记显示。
  4. **拆房**：画线（自动吸附网格、取拖动主导方向为轴线）→ `splitRoom` op（见 §2.1）；非法（非矩形/切线太靠边）alert 提示不执行。
  5. **合并**：先点保留房间（绿色高亮）再点相邻房间 → `mergeRoom` op；失败自动尝试交换方向，仍失败 alert 提示。
- **指针捕获**：R3F `setPointerCapture` 保证拖拽期间 move/up 持续路由到起始对象（顶点手柄拖拽不因指针悬停手柄而中断）。
- **清理**：切换工具时结束进行中的手势（拖拽中的预览场景会先 commit，避免只改场景不记历史）。

### 6.6.6 移动端横屏支持（2026-08-10，README 路线图项，横屏限定）

- **竖屏引导**：`components/ui/OrientationGuard.tsx` 包裹整棵路由——JS 判定「宽度 < 768px 且 高度 > 宽度」（**阈值 A：窄屏 + 竖放才拦**，手机横屏/iPad/桌面均不命中）时渲染全屏覆盖层（旋转图标 + 双语提示，`role="alert"`）；**应用层不卸载**（盖在下方，旋转回来即时恢复、不丢状态）。**不用 matchMedia**——小米系统浏览器等部分安卓浏览器对媒体查询/`matchMedia` 的视口判定不可靠，实测横屏漏命中。
- **紧凑布局**：JS 判定「宽度 ≤760px 或 高度 ≤480px」（任意宽度横屏手机，横屏高度恒 360-430px）时给 `<html>` 加 `wc-compact` 类，**窄屏样式全部由该类门控**（`styles/mobile.css`，2026-08-13 由 global.css 按域拆分而来；判定阈值共享 `lib/viewport.ts`，不用媒体查询，原因同上）；`index.html` 有内联脚本在首帧前预置该类避免闪烁。桌面正常窗口（高度 ≥500px）永不命中。
- **紧凑内容**（2026-08-12 UI 改版后调整）：顶栏横向滚动（隐藏品牌副标题）、**底部对话抽屉折叠态更矮（112→96px）、输入字体 16px（防 iOS 聚焦缩放）**、状态栏可换行、属性面板 240px（top 90px 让开缩小后的罗盘）、设置页 API 表单改单列、**平面图工具栏移动端改为「工具」+「尺寸」两个独立常驻按钮**（`HomePage` 内 `mobileCompact` 分支：工具按钮呼出弹出面板——工具两列网格 + 门窗门/窗切换 + 操作提示，面板 `max-height` 可上下滚动，选择工具即关闭、点空白关闭；**尺寸开关单独成按钮放在面板外**，用户反馈面板内点不到，常驻后不遮挡平面图且随时可切换；桌面端常驻工具行保持原样）、**右上角罗盘缩小**（108→68px，标签偏移随尺寸动态推导）。
- **触控正确性**：`.scene-canvas` 加 `touch-action: none`——OrbitControls 双指缩放/平面图拖拽不被浏览器滚动与捏合手势劫持（桌面鼠标无影响）。

### 6.7 Gizmo 辅助编辑 + 截图分享与口令（v1.3.0）

### Gizmo（TransformControls）

- **组件**：`components/viewport/GizmoControls.tsx`。代理 group 作 drei `TransformControls` 受控对象；家具代理中心抬 `FLOOR_TOP_Y`（地板顶面沉入 2mm 的基准，坑 77）；**房间代理同步 `nodePosition(room)`（足迹中心 + 层高一半）**，拖拽位移经 `updateNodePosition` 转足迹平移——**房间移动整体携带家具与嵌套房间**（`modelTree.translateRoomContents`，足迹 + 家具 + 嵌套递归同量平移，相对关系不变；`updateNodeFootprint` 对纯平移足迹同样带动家具，保证编辑日志回放一致）。
- **模式**：`mode={gizmoMode}`（`translate`/`scale`）；缩放 = 拖拽开始基准尺寸（`nodeDims`）× 代理 scale 写回（房间 → `resizeFootprint` + 层高）。
- **数据流**：`onMouseDown` 记 `baseScene` → `onObjectChange` 调 `previewSelected` → `onMouseUp` 调 `commitDrag`。planMode/screenshotMode 不渲染。

### 截图（场景净化）与口令（lz-string）

- **截图**：`gl={{ preserveDrawingBuffer: true, antialias: true }}` + `dpr={[1,2]}`；`ScreenshotBridge` 把 renderer 写入父级 `glRef`；`captureScreenshot()` 置 `screenshotMode=true` → 等两帧 → `toDataURL` → 复位。净化隐藏 网格/坐标轴/线框/选中框/Gizmo/标注。两个入口：**分享对话框**（带口令水印）与**顶栏「截图」按钮**（2026-08-12 新增：直接下载无水印 PNG）。
- **水印**：`lib/watermark.ts` 右下角半透明口令文本。
- **口令**：`lib/compression.ts` 编码加**版本前缀 `wc3:`**（新口令），解码兼容无前缀旧口令；`useShareStore` 持久化 records（上限 20）。还原路径（ShareDialog）：解压 → **`migrateModel` 迁移**（旧 v1 口令自动升 v3；非法口令降级提示，不崩溃）→ `onRestore`。

## 6.8 全新 UI（2026-08-12，暖色浅色主题）

- **主题**：`styles/variables.css` 的 `:root` 全套 CSS 变量由深色切换为暖色米纸浅色（`--bg #e2dccb`、`--bg-panel #ede8dd`、强调色绿色 `--accent #3d7a48`、圆角/阴影体系）；**样式按域拆分为分区文件**（2026-08-13：variables/base/home/toolbar/chat/property/compass/debug/dialog/settings/project/share/plan/mobile/error-boundary，`global.css` 仅保留 @import 链，顺序即层叠顺序）；**3D 渲染同步换肤**——场景背景 `#d6cfbf`（Viewport3D 的 `<color attach="background">`）、网格线、选中高亮（`#3d7a48`）、家具/走廊中性色（`palette.ts` 按浅底可辨性重调）、门窗符号、平面图标注（`plan-label`/`plan-dim`/罗盘改浅色面板底）。设置页/对话框/项目库/分享等全部页面随变量自动换肤。
- **布局骨架**：**移除侧边栏**（`AppShell` 精简为裸 `Outlet`）；品牌「言筑 WordCraft」移入顶栏左侧，首页/设置导航移入顶栏右侧图标（`toolbar__nav`，NavLink + data-label tooltip）；设置页顶部新增「← 首页」返回入口。
- **顶栏分组**（`components/ui/HomeToolbar.tsx`）：场景（示例/清空场景）、编辑（撤销/重做，图标按钮）、对话（与底部抽屉联动的高亮态）/分享/截图/帮助、右侧 保存（primary 弱化样式）/项目库/导航/语言/API 徽章（未配置 → 链接到设置）。桌面窄窗口（≤768px）按钮自动图标化（媒体查询，纯装饰降级；移动端仍由 `wc-compact` 类门控，坑 61 不变）。
- **底部对话抽屉**（`components/ui/ChatDrawer.tsx`，push 布局）：取代原左侧 320px 聊天面板——折叠时仅剩输入条（112px），展开最大 55vh；顶栏「对话」按钮与其联动高亮；消息气泡样式（用户右对齐绿色、助手左对齐）、生成中动画圆点 + 耗时、错误消息红框、**撤销生成/清空对话**按钮行、**API Key 未配置黄色提示条**（附「前往设置」）。发送自动展开抽屉；`role="log"` + `aria-live="polite"`。
- **空态引导卡**（`components/ui/EmptyStateCard.tsx`）：无场景时悬浮画布中央——一句话生成引导 + 3 个示例标签（三室一厅一厨/现代简约小屋/书房工作室，点击填入输入框并展开抽屉）+ 「数据全在本地」脚注；**未配置 API Key 时额外提示可先加载示例模型**（示例按钮直接加载）。
- **属性面板可拖动**（2026-08-12）：按住面板头部指针拖拽移动（指针捕获 + 会话内记住偏移，切换选中不重置；头部 grab 光标、拖拽中加深阴影）；面板位置让开右上角罗盘（top 130px，`wc-compact` 下 90px）。
- **键盘**：方向键/WASD 平移视角保留；**R 键复位视角**（原状态栏「视角」按钮组已移除，帮助文案同步）。
- **确认/提示对话框**（2026-08-13 坑 90）：`ConfirmProvider`（挂 main.tsx）提供 `useConfirm()` 的 `confirm()`（Promise<boolean>，确定/取消/遮罩/Escape）与 `alertMessage()`（单按钮提示）——替代全部 `window.confirm/alert`（未保存守卫、生成冲突确认、删除确认、拆合失败提示等 10 处），复用通用 `Dialog`（焦点陷阱/焦点归还），危险操作用 `danger` 红色主按钮。
- **状态栏**：面包屑 + 选中尺寸信息 + 版本号；`focusId` 时显示「返回整屋」。
- **i18n**：新增约 30 个 key（顶栏/抽屉/空态/截图/拖动提示等，zh/en 对称，`translations.test.ts` 断言 key 集合一致）。

## 7. 生成链路（lib/chat.ts + lib/executor/）

1. 构建 messages：系统提示词（**ops 操作序列契约**，P2 重写）+ 多轮历史（**P3 精简**：`toChatHistory` 剔除助手纯 JSON）+ **当前房屋状态摘要**（有场景时）+ **手动编辑日志**（`editOps` 非空时）+ 用户输入。
2. **SSE 流式请求**（`streamChatCompletion`，lib/api.ts，fetch 实现）：`chat.ts` 侧 `GENERATION_TIMEOUT_MS = 180s` 兜底超时。
3. 从回复提取 JSON，解析为操作序列（**解析容错链** `tryParseModelJson`，坑 93/94：原样 → `repairTruncatedJson` 按未闭合括号栈补全截断 → `repairLenientJson` 宽松括号修复（跳过错配/多余闭合符，坑 94——模型把 `]` 写成 `}` 或多打 `}` 时唯一能恢复的路径）→ 还原双编码（`unescapeDoubleEncodedJson`，只在解析失败后调用）→ 尾部修剪（截断残留，取最长可解析前缀）；`extractModelJson` 解包被包进字符串的 JSON；逐条 zod 校验，单条无效跳过）。
4. `executeOps` 确定性执行：`macro` 走旧布局引擎；`addRoom/updateRoom/...` 增量修改；失败单条跳过；结束统一 `normalizeContainment`（auto 批次额外家具常理兜底）+ 楼层高度刷新。
5. **快照容错路径**：输出为 v2 整屋快照时，auto → 映射 `macro`，custom → `diffSceneV2` 按 id diff 成 ops 再执行；v3 场景直接使用。
6. 多轮：上下文 = 场景摘要 + 手动编辑日志（P3），提示词要求"基于当前状态输出必要操作、复用已有 id、不得原样重复（含编辑日志中的操作）"。
7. **生成竞态防护**（2026-08-13，坑 70）：`send()` 发送时快照场景引用（HomePage `generationBaseRef`）；返回后若 `useModelStore.scene !== baseScene`（生成期间手动编辑/打开项目/加载示例/撤销），`window.confirm` 询问是否仍应用生成结果——取消则丢弃并提示，保留用户编辑。**改生成链路时别去掉这个确认环节**：模型基于旧版本场景生成的 ops 无条件覆盖会静默丢掉用户几分钟的编辑。

## 8. 文件结构

```
src/
├── main.tsx / App.tsx         # 入口与路由（main 顶层包 ErrorBoundary【2026-08-13】+ ConfirmProvider【2026-08-13 坑 90】）
├── components/
│   ├── layout/AppShell.tsx    # 无侧边栏：裸 Outlet（品牌/导航移入各页顶栏，2026-08-12）
│   ├── ui/                    # Button/Input/HelpDialog/ProjectLibraryDialog/ShareDialog/OrientationGuard【移动端横屏】/LanguageToggle
│   │                          # + HomeToolbar【顶栏，2026-08-12】/ChatDrawer【底部对话抽屉，2026-08-12】/EmptyStateCard【空态引导卡，2026-08-12】/icons【SVG 图标库，2026-08-12】/ErrorBoundary【顶层错误边界，2026-08-13】/PlanToolbar【平面图工具栏，2026-08-13 从 HomePage 拆出】/DebugPanel【调试日志面板，2026-08-13 拆出】/Dialog【通用对话框：a11y 收敛，2026-08-13 审查批次】/ConfirmDialog【应用内确认/提示对话框（ConfirmProvider，替代 window.confirm/alert，2026-08-13 坑 90）】/useConfirm【useConfirm hook（独立文件避 fast-refresh 告警）】
│   └── viewport/              # SceneViewer/Viewport3D/ModelNodeView/PropertyPanel（可拖动，2026-08-12）/Compass/PlanRig/PlanAnnotations/GizmoControls/PlanEditLayer【P4】/PlanEnhancements【平面图增强】/GroundView【材质层 2026-08-13】
├── hooks/                     # useKeyboardShortcuts【全局键盘，2026-08-13 从 HomePage 拆出】/useMobileCompact【紧凑视口判定】/useGeneration【对话生成链路】/useDirtyTracking【项目库脏标记订阅】【审查批次】
├── pages/                     # HomePage（顶栏 + 画布 + 底部抽屉 + 状态栏，2026-08-13 工具栏/调试面板/键盘拆出后瘦身）/ SettingsPage（设置/调试/i18n，含返回首页入口）
├── db/database.ts             # Dexie（IndexedDB）项目库
├── i18n/                      # translations.ts（zh 真源 + en）+ useT/t 包装
├── store/                     # useSettingsStore/useModelStore/useChatStore/useProjectStore/useShareStore
├── lib/
│   ├── chat.ts                # 生成链路与系统提示词（ops 契约 + 场景摘要 + 编辑日志 + 快照容错 + repairMacroName【2026-08-12】+ extractModelJson 支持纯 ops 数组【审查批次】）
│   ├── editOps.ts             # 双向同步：editDiffToOps 手动编辑 → op【P3】
│   ├── executor/              # 确定性执行器（2026-08-13 审查批次由 executor.ts 按 op 组拆分）
│   │   ├── index.ts           # 门面：executeOps/applyOp/emptyScene/diffSceneV2/findRoom 再导出
│   │   ├── core.ts            # executeOps 逐条容错执行 + applyOp 分发 + emptyScene
│   │   ├── rooms.ts           # 整屋与房间操作（setHouse/macro/add/update/remove/move/nest/split/merge/addAdjacency + 贴靠落点）
│   │   ├── furniture.ts       # 家具操作（add/update/removeFurniture）
│   │   ├── openings.ts        # 开洞操作（setOpenings，edgeIndex/side 双入口 + 删除）
│   │   ├── diff.ts            # v2 整屋快照 → ops diff（容错路径）
│   │   └── shared.ts          # findRoom/mapRoom/refreshLevelHeight 等树操作辅助 + DEFAULT_* 缺省尺寸（findRoom 按名称回退【2026-08-12】+ 名称引用解析真实 id【2026-08-13，坑 71】）
│   ├── planEdit.ts            # 平面图编辑纯函数（网格吸附/正交顶点拖拽/自交校验/墙命中/平移吸附/拆合布局）【P4 新增】collectWallHitEdges 走共享墙体缓存【2026-08-13，坑 72】
│   ├── api.ts                 # OpenAI 兼容客户端、SSE 流式、连通性检测（2026-08-13 移除 axios，统一 fetch；max_tokens 400 时降级 max_completion_tokens）
│   ├── layout.ts              # 布局引擎 resolveLayout（macro 复用；custom 支持 footprint 顶点环与 relativeTo【2026-08-12】；avoidNestedDoorZones 嵌套避门区【2026-08-12】）
│   ├── footprint.ts           # v3 足迹几何纯函数（包围盒/平移/缩放/节点访问器）
│   ├── geometry.ts            # 平面几何共享纯函数【审查批次】：rectsOverlap/halfRectOverlaps/translateRoom/sameFootprint/NEST_CORNER（嵌套落点符号）/findRoomInList（id 优先名称回退）
│   ├── constants.ts           # 跨模块几何/布局常量单一来源【审查批次】：EPSILON/墙厚/门宽/邻接容差/门口留空/默认层高/房间间隔/走廊宽
│   ├── migration.ts           # migrateModel v1→v3 幂等迁移（v3 分支过 sceneModelV3Schema 结构校验【审查批次，坑 74】）
│   ├── furniturePresets.ts    # 家具部件模型（分类/拼装/朝向/包围盒，纯函数）
│   ├── furniturePlacement.ts  # 家具常理摆放（贴墙 + 迭代滑动避让【2026-08-12】；床短边贴墙例外）
│   ├── roomGeometry.ts        # 足迹边分段墙体 computeWallPlan（hasCorridor 门控【2026-08-12】）+ applyOpenings + placeEntranceDoorOnEdge 入户门互让【2026-08-12】+ nestedWallPlan（真·内嵌）+ window 段 + computeAllWallPlansCached 共享缓存【2026-08-13，坑 72】
│   ├── modelTree.ts           # 树遍历/足迹更新/家具约束 normalizeContainment（约束进墙 + 推出嵌套占地与门口通道，含 updateNodeFootprint/removeNode）+ translateRoomContents（移动房间带动家具）
│   ├── planGeometry.ts        # 2D 平面图纯函数（足迹包围盒/取景/尺寸线/门窗符号/房间尺寸线【平面图增强】）
│   ├── viewport.ts            # 移动端视口判定纯函数（isCompactViewport/isPortraitBlocked，与 OrientationGuard 共享）【2026-08-13】
│   ├── compression.ts         # lz-string 分享口令编解码（wc3: 版本前缀）
│   ├── safeStorage.ts         # localStorage 安全存储层（读写删 try/catch + 一次性 warn，五个 store persist 共用，2026-08-13 坑 91）
│   ├── watermark.ts           # 截图口令水印（离屏 canvas）
│   ├── sampleModel.ts         # 示例模型
│   ├── debugLog.ts            # 调试日志器（含 formatDebugText 文本导出【2026-08-13】）
│   └── palette.ts / materials.ts / id.ts     # palette 含共享 roomFaceColor 与家具三档配色（FURNITURE_COLOR 等；2026-08-12 按浅色底重调）+ 墙/屋顶/地面色与 hex 工具；materials.ts【2026-08-13 新增】程序化纹理（Canvas 周期函数无缝平铺，全局缓存）+ 材质分类（地板按房间名、家具按种类×明度档）+ UV 拉伸工具
├── schemas/model.schema.ts    # v2 Zod Schema（快照容错路径用）+ v3 足迹模型 Schema（sceneModelV3Schema，数据入口校验【审查批次】）
├── schemas/ops.schema.ts      # ops 操作契约 Zod Schema（判别联合白名单；roomSpec 支持 relativeTo【2026-08-12】）【新增】
├── types/model.ts             # v2 契约 + v3 已解析模型类型
├── types/ops.ts               # ops 操作契约类型（Op/RoomSpec/FurnitureSpec）【新增】
├── types/settings.ts          # 设置项类型（AppSettings/ApiKeyEntry/ColorMode 等）
├── styles/                    # 2026-08-13 由单文件 global.css 按域拆分：global.css 仅 @import 链（顺序 = 层叠顺序）
│   ├── variables.css          # 设计令牌（颜色/圆角/阴影/尺寸）
│   ├── base.css               # 重置 + 布局骨架 + 通用组件（panel/btn/input/badge）
│   ├── home/toolbar/chat/property/compass/debug/dialog.css  # 各 UI 分区
│   ├── settings/project/share/plan.css                      # 设置页/项目库/分享/平面图
│   └── mobile.css             # 竖屏引导 + wc-compact 紧凑布局 + 桌面窄窗口降级；error-boundary.css 兜底页
└── vite-env.d.ts              # __APP_VERSION__ 声明（vite.config.ts 从 package.json 注入，2026-08-13）
```

## 9. 测试（Vitest，654 用例）

- `lib/planEdit.test.ts`【P4 新增】：网格吸附/足迹校验（非正交/过短/自交拒绝）、正交顶点拖拽（矩形滑行/L 形内凹角/退化与自交拒绝/最近顶点）、平移贴墙吸附（线差阈值/网格先行/无重叠不吸附）、拆房布局（家具/嵌套/开洞归属重映射）、合并布局（unionRectOf 面积守恒/开洞重映射）、墙命中（实心墙/入户门/门段/邻屋共墙）。
- `lib/editOps.test.ts`【新增】：editDiffToOps 纯函数——家具位移（相对房间中心换算）/房间位移与改尺寸（footprint 顶点环）/层高（dimensions.height）/家具改名改尺寸/约束后位置变化/normalize 提交一致性/无变化与节点缺失返回空/整屋改名（setHouse）/嵌套房间内家具归属最内层房间。
- `lib/executor.test.ts`【新增】…… 端点行为、**按名称引用 describe（updateRoom/removeRoom/moveRoom/自引用/splitRoom/mergeRoom/nestRoom 七条，坑 71 回归）【2026-08-13】**。
- `lib/roomGeometry.test.ts`：足迹边分段墙体、共享墙去重、开放空间、私密房间、**卫生间单门规则（走廊优先/确定性邻居）**、卫生间归属、入户门、window 段/显式开洞覆盖层、nestedWallPlan 覆盖判定（并集查询/开放连通/嵌套之嵌套/部分覆盖/退化）+ **墙段坐标与渲染映射回归**（`wallGroupPosition` 锚边起点 / `segmentWorldRange` 世界区间 / 集成断言段不越界，坑 41）+ **无走廊自由布局私密房间直接开门（主卧↔客厅有门，坑 11 修正）【2026-08-12】** + **入户门与窗互让（大窗占满入口墙 → 窗完整一段、门换墙恒 0.9m；窗只占中段 → 门留入口墙）【2026-08-12】**
- `lib/layout.test.ts`：走廊/客厅/custom 平铺、嵌套房间靠边/靠角、整屋包围盒居中、computeAllWallPlans 嵌套分隔墙 + **主卧带内卫家具常理摆放互不重叠（坑 66 回归）【2026-08-12】** + **嵌套卫生间默认东北角但避开父房间门口禁区（坑 47 的 macro 路径回归）【2026-08-12】**。
- `lib/footprint.test.ts`【新增】：矩形足迹/包围盒/中心/平移/缩放、房间与整屋访问器、楼层工具。
- `lib/migration.test.ts`【新增】：v1→v3 迁移（足迹/嵌套/entranceRoomId/wall 并入）、幂等、v3 原样返回、非法输入降级。
- `lib/furniturePlacement.test.ts`：家具常理摆放（贴墙/旋转/避门口/避内卫）。
- `lib/chat.test.ts`：ops 输出/场景摘要（含邻接表）/编辑日志/快照容错路径、逐条容错、请求体与错误分类、**截断补全与双编码解析（extractModelJson/repairTruncatedJson，坑 42）** + **macro.name 填整屋名/缺省时按 params 推断布局类型（repairMacroName 容错修复，复现"三室一厅一厨"报错）【2026-08-12】**。
- `lib/modelTree.test.ts`：树遍历、足迹更新、家具约束、家具推出嵌套占地 + **移动房间带动家具【2026-08-10 新增】updateNodePosition/updateNodeFields 平移带动家具与嵌套房间（相对关系不变）、updateNodeFootprint 纯平移带动/改形状保持原位** + **家具推出门口通道（拖进主卧门区被推开且不压嵌套卫生间、仍在墙内）【2026-08-10 新增】**。
- `lib/planGeometry.test.ts`：足迹推导的整屋包围盒（示例 12.3×10 不回归）、取景/尺寸线 + **平面图增强【2026-08-10 新增】门窗符号（门扇线四向进入房间/开启弧线几何约束/窗洞双线/与墙体方案同源回归）与房间尺寸线（4×3 房间/过小跳过）**。
- `lib/furniturePresets.test.ts`【2026-08-10 扩充】：分类词表（含 7 种新家具别名与顺序敏感断言）+ 部件数量（20 类）+ 小/大尺寸 × 四朝向包围盒约束（含浴缸长轴特判）。
- `lib/compression.test.ts`：口令编解码（往返/前缀/旧口令兼容/无效）。
- `store/useModelStore.test.ts`：编辑/撤销重做 + previewSelected/commitDrag（Gizmo）+ **手动编辑记录编辑日志（translate/update/commitDrag/reset/setScene 清空）【P3】** + **平面图编辑【P4】（planTool 切换与复位/previewFootprint 预览与 commitPlanEdit 提交/applyPlanOps 记历史与编辑日志/splitRoom 可撤销）** + **showPlanDims 尺寸开关【平面图增强】会话内切换、不随 setScene 复位**。
- `store/useChatStore.test.ts` / `store/useShareStore.test.ts` / `store/useSettingsStore.test.ts` / `store/useProjectStore.test.ts`：各 store 行为（chat 含 **editOps 追加/上限 50/清空/不持久化 + toChatHistory 精简【P3】**）。
- `components/ui/ShareDialog.test.tsx`：口令复制/还原/历史 + **旧 v1 口令迁移还原为 v3**。
- `components/ui/OrientationGuard.test.tsx`【2026-08-10 新增】：竖屏横屏引导与紧凑类——桌面视口只渲染子内容 / 窄屏竖放渲染全屏覆盖层（子内容保留在 DOM）+ 加 `wc-compact` 类 / 横屏手机不渲染覆盖层但加紧凑类 / 旋转回横屏后覆盖层消失且类移除（`Object.defineProperty` 模拟视口 + resize 事件）。
- `pages/HomePage.test.tsx`：对话交互 + 分享/还原（mock 3D 视口）+ **移动端紧凑视口下平面图「工具」「尺寸」独立按钮与弹出面板交互（选工具即关闭、尺寸开关不受面板影响）** + **空态引导卡（示例标签填入输入框；未配置 API Key 时提示可加载示例、点击加载；已配置时不显示）【2026-08-12】** + **生成竞态（坑 70）：无 API Key 不清草稿 / 生成期间场景被编辑时 confirm 取消保留编辑、确认则覆盖【2026-08-13】**。
- `lib/roomGeometry.test.ts`【2026-08-13 扩充】：**computeAllWallPlansCached 共享缓存（同场景引用返回同一 Map / 不同引用重算且与无缓存版本一致，坑 72）**。
- `components/ui/ProjectLibraryDialog.test.tsx`【2026-08-13 扩充】：**项目行房间数读取 root.levels[0].rooms（v3 模型显示真实房间数，原实现读错字段恒为 0）**。
- `components/ui/ErrorBoundary.test.tsx`【2026-08-13 新增】：子组件抛错展示兜底页不白屏 / 重置按钮清空 localStorage / 正常子树不受影响。
- `components/viewport/PropertyPanel.test.tsx` / `components/ui/ChatDrawer.test.tsx` / `components/ui/HomeToolbar.test.tsx`【2026-08-13 新增】：属性面板（显示节点信息/尺寸 Enter 提交与非法回显/微调步长平移/复位与禁用态/关闭取消选中）、聊天抽屉（发送与 Enter/Shift+Enter、禁用态、消息渲染与生成摘要、API 提示条、折叠切换）、顶栏（按钮回调/禁用态/API 徽章/语言切换）。
- `lib/api.test.ts`【2026-08-13 重写】：fetch 统一后的 describeHttpError（error.message 优先/data.message 兜底/仅状态码/网络错误/兜底文案）+ testConnection（成功/401/404/max_tokens 400 降级 max_completion_tokens 重试/网络错误）。
- `lib/api.test.ts`【2026-08-13 审查批次扩充】：**streamChatCompletion SSE 流式（累积多段 delta/[DONE]/跨分片行拼接/坏行忽略/空 delta 不回调/流结束无 [DONE]/HTTP 错误透传/无 body/网络失败/读取中断/用户中止 AbortError）**。
- `lib/chat.test.ts`【2026-08-13 审查批次扩充】：**extractModelJson 纯 ops 数组直出与代码块内数组提取**。
- `lib/migration.test.ts`【2026-08-13 审查批次扩充】：**畸形 v3 输入返回 null（缺楼层/空楼层/足迹 <4 点/字段类型错误）+ 合法 v3 放行（坑 74 闸门回归）**。
- `lib/viewport.test.ts` / `lib/palette.test.ts` / `lib/sampleModel.test.ts` / `lib/watermark.test.ts`【2026-08-13 审查批次新增】：移动端视口判定阈值 / 房间配色（色板循环/走廊默认色）/ 示例模型（布局引擎产出 6 房间 + 走廊、嵌套卫生间、入户房间）/ 截图水印（canvas 绘制、canvas 不可用降级、图片加载失败降级）。
- `components/ui/PlanToolbar.test.tsx` / `components/ui/LanguageToggle.test.tsx`【2026-08-13 审查批次新增】：平面图工具栏（桌面工具行切换与高亮/门窗切换/操作提示/移动端「工具」面板选即关与遮罩关闭）、语言切换（zh→en 翻转与可访问名随当前语言）。
- `store/useProjectStore.test.ts`【2026-08-13 审查批次扩充】：**commitSavedScene 快照与清脏 / clearProject 清快照 / syncDirtyWithSaved 回到已保存状态清除脏标记（坑 74 脏标记收敛）**。
- 【2026-08-13 审查批次后续（坑 80-84）】：**useModelStore 拖拽预览不写 localStorage**（preview 后 storage 保持提交时场景、commitDrag 恢复持久化，坑 80）；**useChatStore 持久化消息剥离 model**（partialize 与 migrate 均无 `model` 字段、内存中保留，坑 81）；**executor 快照 diff 新增房间透传 position/footprint/家具 rotationY·description**（此前 custom 快照按 position 布局的新房间落东侧兜底，坑 82）+ **addRoom position 落点**（绝对位置生效、优先级高于 relativeTo、显式 footprint 优先于 position）+ **setOpenings edgeIndex-only 通过 zod 校验并可执行/删除、side 与 edgeIndex 均缺省时执行器兜底跳过**（坑 83）。
- 【2026-08-13 用户反馈修复（坑 86-87）】：**唯一卫生间公共语义**（`roomGeometry.test.ts`：唯一卫生间邻客厅+主卧 → 门开向客厅而非主卧 / 只邻私密房间退化为 id 最小 / 多卫生间不特判，坑 86）；**家具常配套件补全**（`furnitureCompleteness.test.ts` 11 用例：书桌→椅位置/幂等/餐桌长边两侧 2 椅/圆桌直径两侧/床头柜床两侧/已有不补/沙发→茶几/description 排除词整房间跳过/空房间返回原引用/多主家具各补各的；`furniturePlacement.test.ts` 集成：补全件经摆放后全部在房间内且两两不重叠、description 排除不补，坑 87）；`modelTree.test.ts` countNodes 27 → 31（示例模型随 auto 路径获得 4 件补全）。
- 【2026-08-13 渲染共面审计（坑 88）】：**`furniturePresets.test.ts` 共面审计 61 用例**（全种类 × 全档尺寸 × 四朝向，枚举所有 box 部件 6 面，断言任意两部件无「同法向 + 同平面 + 区间重叠」——沙发扶手/靠背、灶台控制条/炉头、浴缸内胆/龙头、书架背板、梳妆镜、床头板、水箱、电视屏的端盖/顶面/底面互掐全部修复并锁死回归）。

## 10. 调试模式

设置页开启后，`logDebug` 记录：请求参数（含是否有当前场景摘要）→ 模型原始回复 → ops 操作序列解析（操作清单/单条无效跳过原因）→ v2 快照容错路径 → 部分操作失败明细，首页面板可一键复制/下载，便于向开发者复现问题。

---

**维护者**：JoyFish · 文档版本 v2.18**2026-08-14 追加落地（代码审查批次，坑 105-114）**：**流中途中断不再自动重试**（`StreamInterruptedError` 专属类型，与注释承诺一致——此前普通 Error 会被当作可重试错误，重复发起整次 POST 造成重复计费；坑 105）、**墙体方案内容签名补房间名**（`wallPlanContentKey` 此前不含 `r.name`，重命名房间后缓存返回陈旧门/墙方案——3D 渲染/平面图/墙命中三处同时出错；坑 106）、**家具独立词表双语化**（`FREE_STANDING_RE` 补英文，英文 UI 下 Coffee Table/Chair 等不再被误当靠墙家具；坑 107）、**settings migrate 保留线框偏好**（此前任何版本差都强制重置 wireframe，用户设置随每次升级静默丢失；仅 v<2 强制关；坑 108）、**提交语义收敛**（`commitEdit` 统一 commitDrag/commitPlanEdit：场景必收敛为约束后版本，但内容 diff 为空时不压历史——消除幽灵撤销条目；所有离散提交点调 `syncDirtyWithSaved`，拖回原位不再脏标记卡死；坑 109）、**快捷键对话框守卫**（`[role="dialog"]` 打开时 Ctrl+Z/R/方向键不再作用于背后场景；坑 110）、**v2 快照路径补 rotationY/relativeTo 透传**（此前家具旋转修改与贴靠定位在快照容错路径静默丢失；坑 111）、**applyOpenings 按足迹环几何取边**（退化边过滤后数组下标错位，开洞落到错误的墙；坑 112）、**ConfirmProvider 请求队列化**（重入不再悬挂前一个 Promise；坑 113）、**截图竞态防护**（flushSync 同步提交 + 请求序号防重叠复位；坑 114）、**对话消息与历史有上限**（messages 100 条 + toChatHistory 最近 30 条，防 5MB 配额逼近）、**a11y 补全**（segmented/工具行 aria-pressed、ChatDrawer aria-label、输入框 focus 环、非左键不启动平面图拖拽）、**样式派生色令牌化**（color-mix 派生色收敛到 variables.css）、**属性面板偏移随窗口钳制**。614 用例全绿。