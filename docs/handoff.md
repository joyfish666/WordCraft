# 言筑（WordCraft）项目交接文档

> 面向下一个接手 agent / 开发者。本文档补充 README 与技术文档未涉及之处：项目现状、关键实现坑、运行调试方式、下一步建议。

**交接日期**：2026-08-06 · 当前分支 `main`（v1.2.0 已发布并推送 GitHub；v1.3.0 三大功能已完成，未发布/未推送）

## 1. 交接总览

言筑是一个**纯前端**"文生 3D"应用：用户用自然语言描述房屋，大模型输出语义模型，代码确定性平铺成 3D。核心已实现并可运行：

- ✅ 对话生成（SSE 流式、多轮修改、深度思考开关）
- ✅ v2 语义布局引擎（走廊型 / 客厅居中型 / 自由型）
- ✅ 分段墙体模型（共享墙去重、开放空间、私密房间、卫生间归属、入户门）
- ✅ 卧室内嵌卫生间（嵌套房间、靠角、门朝父房间）
- ✅ 交互（聚焦视图、选中部件、面包屑、坐标显示、罗盘、WASD 视角）
- ✅ 属性面板编辑（名称/长宽高/坐标、Enter/blur 提交、位置微调、复位位置）
- ✅ 撤销/重做（快照历史栈，工具栏按钮 + Ctrl+Z/Ctrl+Y 快捷键）
- ✅ 家具常理摆放（生成时贴墙 + 大面积贴墙旋转 + 避让嵌套卫生间/门口/家具，`lib/furniturePlacement.ts`）
- ✅ 调试日志精简（去重、去刷屏）+ 调试面板「下载日志」按钮
- ✅ 调试模式、测试（109 用例）
- ✅ **v1.0.0 已发布**（2026-08-05）：GitHub Pages 在线版 https://joyfish666.github.io/WordCraft/，`vite base=/WordCraft/` + GitHub Actions 自动构建部署（`.github/workflows/deploy.yml`）
- ✅ **本地项目库（v1.1.0）**：Dexie 接入 UI，工具栏「保存/项目库」，新建/打开/重命名/删除，未保存守卫
- ✅ **2D 俯视平面图（v1.1.0）**：同 Canvas 正交俯视相机，房间标签 + 外廓尺寸线，与 3D 选中/聚焦联动
- ✅ **中英双语切换（v1.2.0）**：首页工具栏 + 设置页标题行的「EN / 中文」按钮一键切换 + 持久化；UI 界面层全覆盖，生成数据不翻译（见坑 27/28）
- ✅ **真·内嵌嵌套房间（v1.3.0）**：嵌套房间与父墙共线处不再重复渲染（`computeAllWallPlans`/`nestedWallPlan` 全量墙线并集查询，见坑 29）；父房间家具（含手动编辑）推出嵌套占地
- ✅ **Gizmo 辅助编辑（v1.3.0）**：TransformControls 移动/缩放手柄 + 属性面板模式切换 + 拖拽实时联动（preview/commitDrag，见坑 30）
- ✅ **截图分享 + 口令（v1.3.0）**：场景净化截图（preserveDrawingBuffer + screenshotMode）+ 口令水印 + 复制/粘贴还原/历史（见坑 31）

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
- **部署**：推送到 `main` 即触发 `.github/workflows/deploy.yml` 自动构建并部署到 GitHub Pages（`base=/WordCraft/`）。首次需在仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。推送失败重试同加代理。

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
12. **updateNodeFields 空补丁必须返回原引用**：容器层递归时要向上传播"子节点是否有变化"（`children.map` 后比对引用），否则空补丁也会新建对象，store 的 `updateSelected` 会误记一条空历史。判断"无实际变化"靠的是 `nextRoot === state.scene.root`。
13. **updateSelected 会跑 normalizeContainment**：属性面板输入的越墙值会被拉回墙内（例：双人床 X 中心 -2 改到 -1，主卧内缩后可活动 X ∈ [-2.35,-1.65]，被钳到 -1.65）。**面板回显的是约束后的值，不是用户输入的原值**，属预期行为。
14. **setScene 清空撤销历史**：生成新模型/加载示例会重置 `past`/`future`，撤销不会回到旧模型；历史栈仅会话内、不持久化（`partialize` 只存 `scene`）。
15. **手动改房间尺寸不会重新平铺布局**：`computeWallPlan` 共享墙方案基于房间间相邻关系，手动编辑尺寸/位置后可能与邻居错位（出现外墙段或缝隙），这是属性面板"自由编辑"的已知边界，非 bug。家具会被 `normalizeContainment` 约束进（改后）的房间内。
16. **屏幕东/西与代码内部 +x/-x 相反（镜像）**：默认南视角（相机在 -Z 看 +Z）下，世界 +x 投影在**屏幕左侧**，罗盘 E 在屏幕右侧 → **罗盘 E = 世界 -x**、罗盘 W = 世界 +x。属性面板位置微调因此是 东=-x、西=+x、北=+z、南=-z。**墙/走廊代码里的 east=+x 只是内部约定，与罗盘相反；改微调按钮时别按内部 east 映射改回去。**
17. **家具常理摆放只对生成生效（auto 模式）**：`resolveLayout` 里 auto 模式跑 `applyFurnitureConventions`，custom 自由布局保留 LLM 显式坐标；`createSampleModel` 也应用（示例床贴墙）。常理规则：靠墙家具（床/衣柜/橱柜等）贴**最近墙**（保持平行坐标），**大面积贴墙**（长边沿墙，必要时旋转）、再**沿墙滑动避开三类禁区**：嵌套子房间（如主卧卫生间）、**房间门口通道**（`computeDoorZones`，含入户门）、已放置的其他家具（按 children 顺序贪心）；独立家具（茶几/餐桌/椅子等）仅约束、不贴墙。**normalizeContainment 不避让嵌套房间/门口**——只有本 pass 会避让，属性面板手动把家具拖进卫生间或门口不会被弹开（已知限制）。
18. **重叠判定要容忍浮点贴边**：床贴墙/贴禁区边界时，边缘仅差 ~1e-16 的浮点噪声，严格不等式会误判重叠。`overlaps` 内部用 1e-6 容差，测试判定也按贴边允许处理。
19. **旋转 = 交换长宽**：大面积贴墙时若长边不在墙的平行轴，通过**交换 length/width** 实现 90° 旋转（`rotationY` 同步 +90°，但**渲染器暂不读 rotationY**，视觉靠交换后的尺寸生效）。副作用：旋转后属性面板/状态栏显示的"长×宽"与家具语义相反（如衣柜 1.2×0.6 贴东墙后显示 0.6×1.2）。改渲染器支持 rotationY 前，别在面板里"修正"它的尺寸。
20. **调试日志精简**：`roomGeometry` 不再记录「入户门生成」（该函数每次场景变化都重算导致刷屏）；`chat.ts` 里原始回复本身就是纯净 JSON 时跳过重复的「解析结果」日志（避免 JSON 翻倍）。调试面板新增「下载」按钮（Blob 下载 .log 到浏览器下载目录）。
21. **相机切换必须用 drei 相机组件**：R3F 核心**不处理** `makeDefault`（源码确认），只有 drei 的 `OrthographicCamera`/`PerspectiveCamera` 封装才切换 `state.camera` 并在卸载时恢复原相机。`SceneViewer` 用 `{planMode && <OrthographicCamera makeDefault .../>}` + **`<OrbitControls key={planMode?'ortho':'persp'} .../>`**（key 强制重挂载绑定新相机）+ `enableRotate={!planMode}`。改回原生 `<orthographicCamera>` 会失效。
22. **项目库脏标记用 lastSavedJsonRef 而非 revision**：HomePage 持 `lastSavedJsonRef`（上次保存的场景 JSON），`useEffect` 订阅 `scene`——与之一致则 `markSaved`、不一致则 `markDirty`；**仅 `currentId !== null` 时跟踪**（游离新场景不算脏）。打开项目/保存成功后必须先 `lastSavedJsonRef.current = JSON.stringify(scene)` 再 `setProject`/`markSaved`，顺序反了会被 effect 误标脏。手动保存策略（README 原说"自动保存"已改为手动+守卫）。
23. **测试注入 fake-indexeddb**：jsdom 无原生 IndexedDB，`vitest.setup.ts` 加了 `import 'fake-indexeddb/auto'` 供 Dexie 测试（`database.test.ts`）。`ProjectLibraryDialog` 的异步续体用 `aliveRef` 守卫避免卸载后 setState（否则 vitest 报 unhandled error）。
24. **正交相机 pan 公式**：`SceneViewer.pan` 对正交相机 scale = `1/zoom`（drei ortho frustum 恒等于像素尺寸）；透视分支保持 `2*distance*tan(fov/2)/clientHeight`。别把透视公式套到正交上。正北朝上靠 `camera.up.set(0,0,1)` + `lookAt(整屋中心)`。
25. **R3F 射线命中按距离排序、逐个派发直到 stopPropagation**：房屋线框盒（整屋最高的盒）与房间选中轮廓盒（横跨房间体积、高于家具）若不排除，会先被命中并冒泡到房间 group（`stopPropagation`），导致"选中房间后点不到内部部件"。修复：两个盒都加 `raycast={() => null}`；空白处取消选中改由 Canvas `onPointerMissed` 兜底（原房屋线框盒的 onClick 已移除）。
26. **撤销生成用生成前快照栈（会话内）**：`useChatStore.generationStack`，生成成功前 `pushGenerationHistory(prevScene)`，`undoLastGeneration()` 弹快照 + 删最后 user+assistant 对并返回场景（HomePage `setScene` 恢复）。`clearGenerationHistory` 在 加载示例/清空场景/打开项目/清空对话 时调用。生成失败不记录；仅当最后一条是携带模型的助手消息才允许撤销。
27. **i18n 范围边界（重要）**：`src/i18n/translations.ts` 只翻译 **UI 界面层**。**生成数据不翻译**——LLM 系统提示词保持中文，`roomGeometry`/`furniturePlacement` 的房间/家具分类器是中文词表（`ROOM_TYPE_RE`、`FREE_STANDING_RE` 等），若英文房间名生成会破坏走廊/开放/私密房/家具贴墙分类。改分类器/提示词做多语言前，别期望英文房间名能正确分类。示例模型名、已保存项目内容保持原样。切换按钮在 `components/ui/LanguageToggle.tsx`（首页工具栏右侧 + 设置页标题行）；语言存 `useSettingsStore.language`（persist version 3）。
28. **i18n 实现要点**：组件用 `useT()`（响应式）、lib 抛错用 `t()`（非响应式读 store，无循环依赖）；`t()` 的 `{}` 插值用 `split/join`（目标是 ES2020，无 `replaceAll`）。`translations.ts` 的 zh 为 key 真源、en 用 `Record<TKey,string>`，`translations.test.ts` 断言两语言 key 集合一致。2D 尺寸线标签走 `planGeometry.dimensionLines(bounds, { y, lang })`（保持纯函数）。
29. **嵌套墙覆盖判定要容忍浮点贴边**：平铺/平移会把坐标弄出 ~1e-13 噪声（如 `3.0000000000000004`），墙线差会算成 `0.15000000000000036` 而**恰好略大于 `WALL_THICKNESS`(0.15)**，被误判"不共线"导致嵌套墙漏覆盖（双重墙）。`nestedWallPlan` 的行比较用 `WALL_THICKNESS + 1e-6`；段切分后用 `cleanSegments` 去掉 `to-from < 1e-6` 的浮点微段并合并相邻同类型段（否则 `shared` 判定与 `fullyOpen` 失败）。
30. **Gizmo 拖拽必须"预览不记历史 + 结束一次性 commit"**：直接复用 `updateSelected`/`translateSelected` 会每帧 `pushPast` 刷爆撤销栈、且 `normalizeContainment` 每帧回弹导致手柄抖动。方案：`previewSelected(patch)` 拖拽中只更新 scene 不记历史不约束；`onMouseDown` 记 `baseScene`，`onMouseUp` 调 `commitDrag(baseScene)`（压入历史恰好一步 + normalize）。代理 group 作 TransformControls 的 `object`（`object={ref}`，drei 的 `useLayoutEffect` 读 `object.current`），避免与 R3F 对 mesh `position` prop 的管理冲突；家具代理 y 要 +`FLOOR_THICKNESS`（mesh 中心抬了地板厚），回写时还原。drei 内部 `dragging-changed` 自动禁用 OrbitControls，无需手动。缩放手柄：以拖拽开始时的基准尺寸 × 代理 scale，写 `dimensions`（渲染器不读 scale 字段），下限 0.1。
31. **截图三件套**：① Canvas 必须 `gl={{ preserveDrawingBuffer: true }}` 否则 `toDataURL()` 读不到缓冲（空白）；② 场景净化用 `useModelStore.screenshotMode`，置 true 后**等两帧 rAF** 让 React 应用隐藏（网格/坐标轴/房屋线框/选中轮廓/Edges/Gizmo/平面图标注）再 `gl.domElement.toDataURL('image/png')`，最后复位；③ jsdom 无 WebGL、mock 的 SceneViewer 无 `captureScreenshot`，HomePage 调用须用 `viewportRef.current?.captureScreenshot?.()`（`?.` 守卫方法本身）。口令历史 `useShareStore` 只持久化 records（上限 20），还原校验 `version===1 && root.type==='house'`。

## 5. 已知限制 / 未实现

- ~~**嵌套房间是"父内独立外壳"（双重墙）**~~ ✅ v1.3 真·内嵌：与父墙共线处不再重复渲染、父家具推出嵌套占地。**仍保留的限制**：父房间地板是整块的（嵌套房间地板叠在其上，靠 `floorLift` 防闪烁），不是真正挖出 L 形地板；两个嵌套房间共用内隔墙时只处理一半（后处理者看到先处理者的墙）。
- ~~**2D 俯视视图**未实现~~ ✅ 已实现（v1.1，同 Canvas 正交俯视，坑见第 4 节 21/24）。
- ~~**Gizmo 辅助编辑**未实现~~ ✅ 已实现（v1.3，TransformControls 移动/缩放，坑见第 4 节 30）。
- **手动编辑不触发重排**：改房间尺寸/位置不会重跑布局引擎，共享墙方案可能与该房间邻居错位（见第 4 节坑 15）。Gizmo 拖动房间/缩放同理。
- **家具-家具避让是"贪心顺序"**：生成时常理按 children 顺序逐个放置并避让已放置家具，非全局最优，极端情况下仍可能贴边。属性面板手动编辑不会再触发常理（改后可能叠到其他家具/门口，属手动编辑的自由）。
- **属性面板/Gizmo 编辑不避让门口**：`normalizeContainment` 只约束进父房间外边界与推出嵌套占地；手动把家具移进门口不会弹开（生成时的 `applyFurnitureConventions` 才会避让）。
- ~~**本地项目库**未接入 UI~~ ✅ 已实现（v1.1，手动保存模式；README 原说的"自动保存"按用户要求改为手动保存 + 未保存守卫）。
- ~~**截图分享、口令**未实现~~ ✅ 已实现（v1.3，坑见第 4 节 31；口令历史仅存 code，不存缩略图）。
- **LLM 输出质量依赖提示词**（当前 DeepSeek v4-flash）。多轮修改、家具常理摆放等依赖 LLM 遵循度，必要时可加代码级兜底。
- 测试环境 jsdom 无 WebGL：`HomePage.test.tsx` mock 了 `SceneViewer`，测试 R3F 渲染相关改动注意；`captureScreenshot` 在 mock 下不存在（HomePage 用 `?.()` 防御）。

## 6. 给下一个 agent 的建议

1. **先跑 `npm run dev` + `npm test`**，加载示例模型熟悉渲染；再开调试模式跑一次生成，看日志理解数据流。
2. **下一步优先级**（真·内嵌 / Gizmo / 截图分享+口令 已落地 v1.3）：
   - **移动端基础适配**（Phase 2 未勾选项）
   - **2D 平面图增强**：家具足迹显示、门洞开启符号、房间尺寸标注（当前仅标签 + 外廓总尺寸）
   - **优化性能与体验**（Phase 3 剩余项：`preserveDrawingBuffer` 有轻微性能开销，可评估按需截图）
   - **数据导出**（README 功能规范列了"导出原始 JSON / 标准化描述文本"，尚未实现）
   - 若做口令二维码水印：README 提到"口令或二维码"，当前仅口令文本水印
3. **改墙体/门相关代码前**，先看第 4 节的坑，尤其东西墙旋转、门段渲染与嵌套墙覆盖判定（坑 29）。
4. **加功能时保持"语义/几何分离"**：让 LLM 出语义，代码算几何；不要回到"LLM 直接给绝对坐标"。
5. **用户原则**：一切以用户明确要求为主，未明确才按常理；除入户门外不要擅自固定其他内容。

## 7. 快速文件地图

| 需求 | 改哪里 |
|------|--------|
| 布局/平铺 | `lib/layout.ts` |
| 家具常理摆放（贴墙/旋转/避门口/避内卫） | `lib/furniturePlacement.ts` |
| 门口禁区提取 | `lib/roomGeometry.ts`（`computeDoorZones`/`DOOR_CLEARANCE`） |
| 墙体/门/开放空间 | `lib/roomGeometry.ts` |
| 提示词/生成链路 | `lib/chat.ts` |
| v2 契约 | `types/model.ts`、`schemas/model.schema.ts` |
| 渲染 | `components/viewport/*` |
| 属性面板 UI | `components/viewport/PropertyPanel.tsx` |
| 编辑提交/撤销重做 | `store/useModelStore.ts`（`updateSelected`/`undo`/`redo`）、`lib/modelTree.ts`（`updateNodeFields`） |
| 状态 | `store/*`（项目库状态在 `store/useProjectStore.ts`） |
| 家具约束 | `lib/modelTree.ts` |
| 项目库 UI/保存/守卫 | `components/ui/ProjectLibraryDialog.tsx` + `pages/HomePage.tsx`（`handleSave`/`handleOpenProject`/`confirmDiscardUnsaved`/脏标记 effect）、`db/database.ts`、`store/useProjectStore.ts` |
| 2D 平面图（取景/标注） | `lib/planGeometry.ts`（纯函数）、`components/viewport/PlanRig.tsx`、`PlanAnnotations.tsx`、`SceneViewer.tsx`（`planMode` 相机切换） |
| 共享配色（2D/3D 一致） | `lib/palette.ts`（`roomFaceColor`） |
| 嵌套房间分隔墙（真·内嵌） | `lib/roomGeometry.ts`（`computeAllWallPlans`/`nestedWallPlan`）+ `Viewport3D.tsx`（换入口）、`lib/modelTree.ts`（`containChildren` 推出嵌套占地） |
| Gizmo 编辑 | `components/viewport/GizmoControls.tsx` + `SceneViewer.tsx`（挂载）、`PropertyPanel.tsx`（模式切换）、`store/useModelStore.ts`（`gizmoMode`/`previewSelected`/`commitDrag`） |
| 截图分享/口令 | `components/ui/ShareDialog.tsx` + `pages/HomePage.tsx`（`handleShare`/`restoreFromShare`）、`SceneViewer.tsx`（`captureScreenshot`/`ScreenshotBridge`）、`lib/watermark.ts`、`lib/compression.ts`、`store/useShareStore.ts` |
