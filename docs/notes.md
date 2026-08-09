# 言筑（WordCraft）开发注意事项

> 面向所有接手本项目的开发者/agent。本文档是**踩坑实录**：这些是实际修过的 bug 与设计边界，改相关代码前务必先读，避免重复犯错。配套：[设计方案](design.md) · [技术架构](architecture.md) · [版本演进](history.md)。

## 1. 接手须知

**先读**：`README-zh.md`（功能）→ `docs/architecture.md`（现行架构）→ `docs/design.md`（v3 方向）→ 再读本文档（坑与细节）。

**运行 / 测试 / 调试**：

```bash
npm install
npm run dev      # 开发，http://localhost:5173
npm run test     # Vitest
npm run lint
npm run build    # tsc --noEmit && vite build
```

**调试模式**：设置页 → 调试 → 开启。首页底部出现日志面板（可复制/下载），记录"请求参数 → 原始回复 → v2 解析 → 布局平铺 → 入户门生成"。排查生成问题第一件事就是开它。

**GitHub 推送**：本机访问 GitHub 443 常被网络阻断，可用代理：

```bash
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push
```

**部署**：推送到 `main` 即触发 `.github/workflows/deploy.yml` 自动构建并部署 GitHub Pages（`base=/WordCraft/`）。首次需在仓库 Settings → Pages → Source 选 **GitHub Actions**。

## 2. 核心设计原则（改代码前先对齐）

1. **语义/几何分离（最高原则）**：LLM 出语义（房间清单/尺寸/意图），代码算几何（无缝平铺/门/闭合）。**永远不要回到"LLM 直接给绝对坐标"**——几何确定性是撤销/测试/分享/多轮对话的基石。
2. **用户明确要求优先**：一切以用户明确要求为主，未明确才按常理；除入户门外不要擅自固定其他内容。
3. **兜底链永远保留**：JSON 提取容错 → Zod 结构校验 → 模板/常理兜底。LLM 输出是"不信任输入"，每层都做防御。
4. **确定性**：同一输入必须同一输出。所有布局/常理算法必须是纯函数或确定性流程，禁止依赖随机/时间/对象遍历顺序（对象遍历顺序尤其危险，见坑 12）。
5. **i18n 边界**：只翻译 UI 层；生成数据与房间/家具分类器是中文词表（见坑 27/28）。
6. **编辑操作与对话操作同构（v3）**：手动编辑产出与对话 op 相同的操作，共享执行器/撤销栈/对话上下文。

## 3. 踩坑记录（按主题分组，改相关代码前必看）

### 3.1 渲染与墙体

1. **东西墙渲染镜像**：东/西墙 group 旋转必须是 `[0, -Math.PI/2, 0]`（`RoomShell`）。用 `+90°` 会把墙段沿墙镜像，导致"客厅比厨房大时，客厅独有那段外墙缺失"。`wallInfo` 的局部坐标方向与渲染方向必须一致。
2. **门段被渲染成实心墙**：门段宽度恰为 `DOOR_WIDTH`（0.9），旧代码 `len <= DOOR_WIDTH` 把它当实心墙。**`WallSegmentBox` 中 `kind === 'door'` 必须永远渲染为门洞**（左右墙段+门扇/标识），只有 `kind === 'wall'` 才渲染实心。
3. **嵌套墙覆盖判定要容忍浮点贴边**：平铺/平移会把坐标弄出 ~1e-13 噪声（如 `3.0000000000000004`），墙线差会算成 `0.15000000000000036` 而恰好略大于 `WALL_THICKNESS`(0.15)，被误判"不共线"导致嵌套墙漏覆盖（双重墙）。行比较用 `WALL_THICKNESS + 1e-6`；段切分后用 `cleanSegments` 去掉 `to-from < 1e-6` 的浮点微段并合并相邻同类型段。
4. **R3F 射线命中按距离排序、逐个派发直到 stopPropagation**：房屋线框盒与房间选中轮廓盒若不排除，会先被命中并冒泡到房间 group，导致"选中房间后点不到内部部件"。修复：两个盒都加 `raycast={() => null}`；空白处取消选中由 Canvas `onPointerMissed` 兜底。
5. **点击部件冒泡**：点击床等部件会冒泡到父房间 group 重新选中父房间。家具/嵌套房间的 `onClick` 必须 `e.stopPropagation()`。
6. **垂直面严禁共面（z-fighting 闪烁）**：门板/床头板/靠背/扶手若与箱体/床架前脸同在 W/2（或 L/2）平面，移动视角会闪。方案：箱体前脸后缩、部件凸出贴前脸（衣柜/冰箱/洗衣机）、床头板内凹、沙发靠背/扶手内凹。共面只在**垂直面**出现（水平堆叠的底面是背面被剔除，不闪）。
7. **阶梯外墙的「立柱」转角不是 bug**：同侧房间深度不一时，较深房间的侧墙在浅房间下方变外墙，与浅房间外墙成 90° 转角。曾试过把同侧深度对齐到最大值消除立柱，但副作用是**覆盖了 LLM 的房间尺寸、多轮改大小失效**，已回退。别再引入对齐。

### 3.2 布局与生成

8. **复合房间名误判**：`isCorridorName('走廊卫生间')` 曾因含"走廊"返回 true，导致被当作走廊过滤。现在 `isCorridorName`/`isOpenRoom` 用 `ROOM_TYPE_RE`（卫生间|浴室|卧室|书房…）排除复合名。**注意**：ROOM_TYPE_RE 不能包含 客厅/餐厅/厨房（它们是开放空间）。
9. **嵌套房间不该拍平**：卧室内嵌卫生间必须**保留在父房间内部**（`makeRoom` 递归 + `placeNested` 靠角），不能拍平为顶层邻居。`Viewport3D` 只对顶层房间算共享墙方案，嵌套房间用 `wallPlanWithDoor(node, 朝向父房间中心)`。
10. **嵌套房间门方向**：曾用整屋中心方向，可能朝父房间外墙；现在 `nestedDoorDirection(node, parentCenter)` 朝父房间中心。
11. **私密房间连厨房/客厅**：卧室/书房（`isPrivateRoom`）**只连走廊与其套间卫生间**，不直连非走廊开放空间；否则次卧会又连走廊又连厨房。
12. **公共卫生间没门**：`公共卫生间` 归属名"公共"在房屋中不存在，曾导致密封无门。规则：**归属房间不存在时，公共/公用卫生间允许与走廊开门**。
13. **多轮修改 LLM 原样输出**：大模型经常不应用修改、原样重复上一次 JSON。提示词明确要求"基于上一个模型输出修改后的完整 JSON、不得原样重复"。即便如此仍可能不稳定（LLM 行为），必要时让用户换个说法。
14. **入口房间保留**：`resolveCorridor` 里入口房间即使名字含「走廊」（如 LLM 为"大门开在走廊"创建的「入口走廊」）也保留为真实房间，否则被 `isCorridorName` 过滤后 `entranceRoomId` 悬空、大门回退到南边界房间、改大门位置无反应。
15. **家具常理摆放只对生成生效（auto 模式）**：`resolveLayout` 里 auto 模式跑 `applyFurnitureConventions`，custom 自由布局保留 LLM 显式坐标。常理规则：靠墙家具贴**最近墙**（保持平行坐标）、**大面积贴墙**（长边沿墙，必要时旋转）、再**沿墙滑动避开三类禁区**（嵌套子房间、**房间门口通道**、已放置的其他家具，按 children 顺序贪心）；独立家具（茶几/餐桌/椅子等）仅约束、不贴墙。**normalizeContainment 不避让嵌套房间/门口**——属性面板手动把家具拖进卫生间或门口不会被弹开（已知限制）。
16. **床放置要「短边/床头贴墙」**：大面积贴墙默认长边沿墙，床必须例外——交换条件取反，短边贴墙、长边垂直墙伸入室内。改测试注意：示例床落点会随示例模型/房间几何变，`modelTree`/`useModelStore`/`planGeometry` 的相关断言随之更新。
17. **旋转 = 交换长宽**：大面积贴墙时若长边不在墙的平行轴，通过**交换 length/width** 实现 90° 旋转（`rotationY` 同步 +90°，但**渲染器暂不读 rotationY**，视觉靠交换后的尺寸生效）。副作用：旋转后属性面板显示的"长×宽"与家具语义相反。改渲染器支持 rotationY 前，别在面板里"修正"它的尺寸。

### 3.3 编辑与状态

18. **updateNodeFields 空补丁必须返回原引用**：容器层递归时要向上传播"子节点是否有变化"（`children.map` 后比对引用），否则空补丁也会新建对象，store 的 `updateSelected` 会误记一条空历史。判断"无实际变化"靠 `nextRoot === state.scene.root`。
19. **updateSelected 会跑 normalizeContainment**：属性面板输入的越墙值会被拉回墙内。**面板回显的是约束后的值，不是用户输入的原值**，属预期行为。
20. **setScene 清空撤销历史**：生成新模型/加载示例会重置 `past`/`future`，撤销不会回到旧模型；历史栈仅会话内、不持久化（`partialize` 只存 `scene`）。
21. **Gizmo 拖拽必须"预览不记历史 + 结束一次性 commit"**：直接复用 `updateSelected`/`translateSelected` 会每帧 `pushPast` 刷爆撤销栈、且 `normalizeContainment` 每帧回弹导致手柄抖动。方案：`previewSelected(patch)` 拖拽中只更新 scene 不记历史不约束；`onMouseDown` 记 `baseScene`，`onMouseUp` 调 `commitDrag(baseScene)`（压入历史恰好一步 + normalize）。代理 group 作 TransformControls 的 `object`；家具代理 y 要 +`FLOOR_THICKNESS`（mesh 中心抬了地板厚），回写时还原。缩放手柄以拖拽开始的基准尺寸 × 代理 scale 写 `dimensions`，下限 0.1。
22. **手动改房间尺寸不会重新平铺布局**：`computeWallPlan` 共享墙方案基于房间间相邻关系，手动编辑尺寸/位置后可能与邻居错位（出现外墙段或缝隙）——这是属性面板"自由编辑"的已知边界，非 bug。家具会被约束进（改后）的房间内。v3 的「足迹几何 + 双向同步」正是为根治此问题。
23. **撤销生成用生成前快照栈（会话内）**：`useChatStore.generationStack`，生成成功前 `pushGenerationHistory(prevScene)`，`undoLastGeneration()` 弹快照 + 删最后 user+assistant 对并返回场景。仅当最后一条是携带模型的助手消息才允许撤销。

### 3.4 相机与视图

24. **相机切换必须用 drei 相机组件**：R3F 核心**不处理** `makeDefault`，只有 drei 的 `OrthographicCamera`/`PerspectiveCamera` 封装才切换 `state.camera` 并在卸载时恢复。`SceneViewer` 用 `{planMode && <OrthographicCamera makeDefault .../>}` + `<OrbitControls key={planMode?'ortho':'persp'} .../>`（key 强制重挂载绑定新相机）+ `enableRotate={!planMode}`。
25. **正交相机 pan 公式**：`SceneViewer.pan` 对正交相机 scale = `1/zoom`（drei ortho frustum 恒等于像素尺寸）；透视分支保持 `2*distance*tan(fov/2)/clientHeight`。别把透视公式套到正交上。正北朝上靠 `camera.up.set(0,0,1)` + `lookAt(整屋中心)`。
26. **屏幕东/西与代码内部 +x/-x 相反（镜像）**：默认南视角（相机在 -Z 看 +Z）下，世界 +x 投影在**屏幕左侧**，罗盘 E 在屏幕右侧 → **罗盘 E = 世界 -x**、罗盘 W = 世界 +x。属性面板位置微调因此是 东=-x、西=+x、北=+z、南=-z。**墙/走廊代码里的 east=+x 只是内部约定，与罗盘相反**；改微调按钮时别按内部 east 映射改回去。

### 3.5 存储与持久化

27. **持久化迁移**：`useSettingsStore` persist 带 `version` 字段（如 version 2 起默认关闭线框），旧数据自动迁移。localStorage keys：`wordcraft.settings` / `wordcraft.model` / `wordcraft.chat`。**改持久化结构必须升 version 并写迁移**（v3 模型的 IndexedDB/口令迁移见 design.md §3.4）。
28. **项目库脏标记用 lastSavedJsonRef 而非 revision**：HomePage 持 `lastSavedJsonRef`（上次保存的场景 JSON），`useEffect` 订阅 `scene`——与之一致则 `markSaved`、不一致则 `markDirty`；**仅 `currentId !== null` 时跟踪**（游离新场景不算脏）。打开项目/保存成功后必须先 `lastSavedJsonRef.current = JSON.stringify(scene)` 再 `setProject`/`markSaved`，顺序反了会被 effect 误标脏。
29. **截图三件套**：① Canvas 必须 `gl={{ preserveDrawingBuffer: true }}` 否则 `toDataURL()` 读不到缓冲（空白）；② 场景净化用 `useModelStore.screenshotMode`，置 true 后**等两帧 rAF** 让 React 应用隐藏辅助元素再截图，最后复位；③ jsdom 无 WebGL，HomePage 调用须用 `viewportRef.current?.captureScreenshot?.()`（`?.` 守卫方法本身）。口令历史只持久化 records（上限 20），还原校验 `version===1 && root.type==='house'`。

### 3.6 i18n

30. **i18n 范围边界（重要）**：`src/i18n/translations.ts` 只翻译 **UI 界面层**。**生成数据不翻译**——LLM 系统提示词保持中文，`roomGeometry`/`furniturePlacement` 的分类器是中文词表（`ROOM_TYPE_RE`、`FREE_STANDING_RE` 等），英文房间名会破坏走廊/开放/私密房/家具贴墙分类。改分类器/提示词做多语言前，别期望英文房间名能正确分类。
31. **i18n 实现要点**：组件用 `useT()`（响应式）、lib 抛错用 `t()`（非响应式读 store，无循环依赖）；`t()` 的 `{}` 插值用 `split/join`（目标 ES2020，无 `replaceAll`）。`translations.ts` 的 zh 为 key 真源、en 为 `Record<TKey,string>`，`translations.test.ts` 断言两语言 key 集合一致。

### 3.7 家具部件模型

32. **家具部件模型（v1.4.0，13 类）**：
   ① `furnitureKind` 分类器必须**先排除易误判词**再宽松匹配（`床头柜` 含「床」会误套床造型 → `GENERIC_GUARD_RE` 先归 generic）；
   ② **水平（x/z）必须钳制在 L×W 足迹内、底面贴地**——测试硬性断言覆盖 13 类 × 小/大尺寸 × 四朝向；**竖直顶部允许向上悬挑**（电视柜上的电视屏高于盒顶），别把 y 上界当硬约束；
   ③ **朝向用 `facingFromRoom(node, room, BACK_AXIS[kind])`**（不是最近墙）：柜/沙发等背侧沿**短轴**——朝短轴上最近的墙；**床单独处理**：床头在**长轴端**（短边中间），朝长轴上最近的墙。用「最近墙」会出错：转角衣柜 tie 到相邻墙后柜门开到小面。`parentRoom` 由 `ModelNodeView` 房间分支下传，改代码别漏；
   ④ 渲染用 `<group onClick>` + 各部件 mesh（点击任一部分选中整件），**选中轮廓是并集包围盒的隐形 box + Edges，须 `raycast={() => null}`**（同坑 4）；
   ⑤ 配色三档：主色 / 副色 / 深色强调（标准与色盲模式均可辨）；
   ⑥ **垂直面严禁共面**（同坑 6）；
   ⑦ 阶梯外墙「立柱」是正确外墙（同坑 7）。

### 3.8 测试环境

33. **jsdom 无原生 IndexedDB**：`vitest.setup.ts` 加了 `import 'fake-indexeddb/auto'` 供 Dexie 测试（`database.test.ts`）。`ProjectLibraryDialog` 的异步续体用 `aliveRef` 守卫避免卸载后 setState。
34. **jsdom 无 WebGL**：`HomePage.test.tsx` mock 了 `SceneViewer`，测试 R3F 渲染相关改动注意；`captureScreenshot` 在 mock 下不存在（HomePage 用 `?.()` 防御）。
35. **重叠判定要容忍浮点贴边**：床贴墙/贴禁区边界时，边缘仅差 ~1e-16 的浮点噪声，严格不等式会误判重叠。`overlaps` 内部用 1e-6 容差，测试判定也按贴边允许处理。
36. **调试日志精简**：`roomGeometry` 不再记录「入户门生成」（该函数每次场景变化都重算导致刷屏）；`chat.ts` 里原始回复本身就是纯净 JSON 时跳过重复的「解析结果」日志。加日志时注意：高频路径（场景变化触发）不加日志。

## 4. 已知限制（当前实现）

- **嵌套房间地板**：父房间地板是整块的（嵌套房间地板叠在其上，靠 `floorLift` 防闪烁），不是真正挖出 L 形地板；两个嵌套房间共用内隔墙时只处理一半（后处理者看到先处理者的墙）。
- **手动编辑不触发重排**：改房间尺寸/位置不会重跑布局引擎（见坑 22）。
- **家具-家具避让是"贪心顺序"**：生成时常理按 children 顺序逐个放置并避让已放置家具，非全局最优。
- **属性面板/Gizmo 编辑不避让门口**：`normalizeContainment` 只约束进父房间外边界与推出嵌套占地。
- **LLM 输出质量依赖提示词**（当前 DeepSeek v4-flash）。多轮修改、家具常理摆放等依赖 LLM 遵循度。
- **无窗/无楼梯/无楼层**：v3 方案（design.md）已将窗口段列入 P1、楼层/楼梯列入 Phase 5。

## 5. v3 实施注意事项（开始改之前读）

1. **P1 是纯重构**：数据模型 v3 只是内部格式升级，禁止借机夹带新功能；验收 = 旧数据可打开 + 用例全绿 + 截图无回归。
2. **迁移函数必须幂等且可测**：`migrateModel(v1 → v3)` 写成纯函数，覆盖旧项目 JSON 与旧分享口令两条路径；分享口令加版本前缀后，旧口令解码失败要走降级提示而非崩溃。
3. **op 执行器逐条容错**：任何一条 op 失败只回滚该条，绝不整屋回滚；执行顺序必须确定（数组顺序），禁止依赖对象键序。
4. **编辑器与对话共用执行器**：平面图编辑产出与对话 op 同构，否则撤销栈/对话上下文会出现两套语义（这是 P3/P4 的验收点）。
5. **footprint 顶点约束**：正交约束（每边水平/垂直）在生成与编辑两处都做，编辑器用网格吸附兜底；自交多边形必须在编辑时拒绝。
6. **墙段泛化小心镜像**：足迹边按顺序遍历时，局部坐标方向要统一（顺时针/逆时针），否则重蹈东西墙镜像的坑 1。
7. **window 段渲染**：沿用门段"永远渲染为开洞"的原则（坑 2），`WallSegmentKind` 加枚举后同步检查所有 `switch` 分支。
8. **多轮上下文摘要**：房间摘要必须含 id（LLM 靠 id 引用节点），且与 ops 日志按时间顺序拼装，避免模型看到乱序的"当前状态"。

## 6. 快速文件地图

| 需求 | 改哪里 |
|------|--------|
| 布局/平铺 | `lib/layout.ts` |
| 家具常理摆放（贴墙/旋转/避门口/避内卫） | `lib/furniturePlacement.ts` |
| 门口禁区提取 | `lib/roomGeometry.ts`（`computeDoorZones`/`DOOR_CLEARANCE`） |
| 墙体/门/开放空间 | `lib/roomGeometry.ts` |
| 提示词/生成链路 | `lib/chat.ts` |
| v2 契约 | `types/model.ts`、`schemas/model.schema.ts` |
| 渲染 | `components/viewport/*`（核心 `ModelNodeView.tsx`） |
| 属性面板 UI | `components/viewport/PropertyPanel.tsx` |
| 编辑提交/撤销重做 | `store/useModelStore.ts`、`lib/modelTree.ts` |
| 状态 | `store/*` |
| 家具部件模型（分类/拼装/包围盒） | `lib/furniturePresets.ts` + `ModelNodeView.tsx`（`FurnitureMesh`） |
| 项目库 UI/保存/守卫 | `ProjectLibraryDialog.tsx` + `HomePage.tsx` + `db/database.ts` + `store/useProjectStore.ts` |
| 2D 平面图（取景/标注） | `lib/planGeometry.ts`、`PlanRig.tsx`、`PlanAnnotations.tsx`、`SceneViewer.tsx` |
| 共享配色（2D/3D 一致） | `lib/palette.ts` |
| Gizmo 编辑 | `GizmoControls.tsx` + `SceneViewer.tsx` + `PropertyPanel.tsx` + `useModelStore.ts` |
| 截图分享/口令 | `ShareDialog.tsx` + `HomePage.tsx` + `SceneViewer.tsx` + `lib/watermark.ts` + `lib/compression.ts` + `store/useShareStore.ts` |
| i18n | `i18n/translations.ts`（zh 为真源） |
