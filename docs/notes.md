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
2. **门段被渲染成实心墙**：门段宽度恰为 `DOOR_WIDTH`（0.9），旧代码 `len <= DOOR_WIDTH` 把它当实心墙。**`WallSegmentBox` 中 `kind === 'door'` 必须永远渲染为门洞**（左右墙段+门扇/标识），只有 `kind === 'wall'` 才渲染实心。**window 段同理（坑 7 已落地）**：`kind === 'window'` 永远渲染为窗洞（窗台 + 玻璃 + 窗楣），`WallSegmentKind` 枚举改动后所有 `switch`/分支都已同步检查。
3. **嵌套墙覆盖判定要容忍浮点贴边**：平铺/平移会把坐标弄出 ~1e-13 噪声（如 `3.0000000000000004`），墙线差会算成 `0.15000000000000036` 而恰好略大于 `WALL_THICKNESS`(0.15)，被误判"不共线"导致嵌套墙漏覆盖（双重墙）。行比较用 `WALL_THICKNESS + 1e-6`；段切分后用 `cleanSegments` 去掉 `to-from < 1e-6` 的浮点微段并合并相邻同类型段。
4. **R3F 射线命中按距离排序、逐个派发直到 stopPropagation**：房屋线框盒与房间选中轮廓盒若不排除，会先被命中并冒泡到房间 group，导致"选中房间后点不到内部部件"。修复：两个盒都加 `raycast={() => null}`；空白处取消选中由 Canvas `onPointerMissed` 兜底。
5. **点击部件冒泡**：点击床等部件会冒泡到父房间 group 重新选中父房间。家具/嵌套房间的 `onClick` 必须 `e.stopPropagation()`。
6. **垂直面严禁共面（z-fighting 闪烁）**：门板/床头板/靠背/扶手若与箱体/床架前脸同在 W/2（或 L/2）平面，移动视角会闪。方案：箱体前脸后缩、部件凸出贴前脸（衣柜/冰箱/洗衣机）、床头板内凹、沙发靠背/扶手内凹。共面只在**垂直面**出现（水平堆叠的底面是背面被剔除，不闪）。
7. **阶梯外墙的「立柱」转角不是 bug**：同侧房间深度不一时，较深房间的侧墙在浅房间下方变外墙，与浅房间外墙成 90° 转角。曾试过把同侧深度对齐到最大值消除立柱，但副作用是**覆盖了 LLM 的房间尺寸、多轮改大小失效**，已回退。别再引入对齐。

### 3.2 布局与生成

42. **模型流式回复偶发被截断，整段 JSON 无法解析**（2026-08-09 实测）：DeepSeek v4-flash 流式回复偶发在网络/输出处被截断——整段 JSON 末尾缺几个闭合符（如 `...}}]}` 被切成 `...}}]}`），`JSON.parse` 直接抛错，用户看到「模型返回的 JSON 无法解析」。修复：`repairTruncatedJson`（chat.ts）在 parse 失败时按「字符串感知的括号栈」补全缺失闭合符——**字符串未闭合 / 括号失衡（错配/多余闭合）/ 结构本已完整时返回 null 不修复**；补全前先剔除末尾空白与逗号（截断点恰在分隔符后）。⚠️ 补全后仍可能因缺逗号等语法错误解析失败（如 `{"a":1,` → `{"a":1,}`），调用方需再 try 并走原错误路径。另加了**双编码容错**：模型偶发把 JSON 对象包进 JSON 字符串字面量（`"{\"...\"}"`），`unwrapJsonString` 解包一层（只在内层以 `{`/`[` 开头时解包，散文首尾恰是引号不误判）。debug 日志会记「模型回复 JSON 被截断，已自动补全闭合括号」。

43. **入户门位置由 `entranceRoomId` 决定，`setOpenings` 移动不了入户门**（2026-08-09 用户反馈）：LLM 想"把入户门移到走廊"时输出了 `setOpenings`（走廊南墙开门洞）——op 解析执行成功，但入户门没变化。原因有二：① 入户门是 `addEntranceDoor`（roomGeometry.ts）按 `entranceRoomId` 在入口房间入口方向外墙生成的派生门，契约里原本没有改入口房间的操作；② 走廊是开放空间且其南墙与南侧房间共享（全 `open` 段），`addDoorOnFace`/`applyOpenings` 只切实心 `wall` 段，共享/开放边上的开洞是**静默空操作**。修复：`setHouse` 增加 `entranceRoomId` 与 `entranceDir`（默认 south；执行器校验房间存在，指向不存在则跳过该条；`macro` 整体重排会**保留**用户设置的 `entranceDir`；提示词注明"移动入户门用 setHouse 不要用 setOpenings"）。⚠️ 边界：入户门必须落在入口房间朝向入口方向的外墙——走廊等内部空间选其最外沿方向（如走廊东端外墙 → `entranceDir: 'east'` + `entranceRoomId: 'corridor'`）；指向完全无外墙的方向仍为静默空操作。改 `applySetHouse`/`addEntranceDoor`/`Viewport3D`/`furniturePlacement` 的 entrance 取值时别破坏这条约定。

44. **卫生间默认只开一扇门（2026-08-09 用户反馈）**：普通"卫生间"同时邻走廊和卧室时，旧规则每面共享墙都开门（双门）。新规则（computeWallPlan 内 `bathroomDoorTargets` 预扫描）：每间卫生间至多一扇**推导门**——① 命名归属房间存在（主卧卫生间→主卧）只对它开门；② 否则（公共/普通卫生间）**走廊优先**（"卫生间移开走廊门"=用户要求两门时用 setOpenings 在实心墙上显式加门）；③ 无走廊时选邻居 id 最小者（确定性）。注意：门判定在共享墙两侧是对称的（卫生间侧不开时邻居侧也不开，否则会出现"卧室侧有门、卫生间侧实心"的半扇门）。改 `computeWallPlan` 的门逻辑时，别把普通卫生间退回"每面墙都开门"。

45. **把已有房间"内嵌"成嵌套子房间必须用 `nestRoom`**（2026-08-09 用户反馈）：用户要求"主卧卫生间内嵌到主卧"，LLM 输出了 `moveRoom`（relativeTo）——它只能把房间贴到目标房间外侧，无法变成嵌套子房间（嵌套只在 macro/addRoom 的 nestedRooms 里生成）。修复：新增 op `{"op":"nestRoom","id":"主卧卫生间","into":"主卧","side":"可选"}`——执行器从原父容器移除该房间（顶层或已嵌套均可），按布局引擎 `placeNested` 的角落规则（side→父房间对应角，默认东北角，去墙厚余量）平移到父房间内部，家具与嵌套子房间整体随动（`translateRoomNode`），再挂进父房间 `nestedRooms`；环检测（父房间不能是待移动房间的后代）与非法输入跳过；结束统一 `normalizeContainment` 兜底（过大时钳制居中、父家具推出占地）。已嵌套的房间可再次 nestRoom 转移父房间。提示词已补充该操作。**设计决策：nestRoom 移走房间后留下的空隙不自动补位**（其他房间保持不动——op 是局部修改语义，自动滑动会改动用户未提及的房间；想补位用 moveRoom 让 LLM 移动相邻房间，见坑 46 的对齐修正）。

46. **贴靠放置必须对齐走廊边线（moveRoom/addRoom 的 relativeTo）**（2026-08-09 用户反馈）："次卧和主卧相邻"后，次卧开走廊门但地板与走廊有 0.25m 缝隙——`adjacentCenter` 在垂直于贴靠方向的轴对齐到**目标房间中心**，房间宽度与目标不一致时（次卧宽 3 < 主卧宽 3.5），其走廊侧边悬在走廊边线上方；缝隙 0.25 < ADJACENCY_GAP(0.4) 仍判相邻 → 有门但地板悬空。修复：`alignAdjacentPlacement`（executor.ts）在 east/west 贴靠时把被移动房间靠走廊一侧的边对齐到**目标房间的同侧边线**（走廊型布局中所有北侧房南边都在走廊北边线上）；`applyAddRoom` 与 `moveAdjacent` 共用（目标就是走廊本身时跳过，语义模糊）。改贴靠逻辑时别丢掉这步对齐。

47. **nestRoom 落点必须避开父房间门口禁区，家具必须推出嵌套占地**（2026-08-09 用户反馈）：
   ① **落点压门**：卫生间内嵌到主卧后落在东北角，恰好压在主卧（朝走廊全宽开门）门洞正下方——透过门洞看过去没有墙（嵌套房间与外墙共线的边被覆盖为 open），门洞形同虚设。修复：`applyNestRoom` 用 `computeDoorZones`（与渲染同源，含入户门）+ `doorZoneRect`（furniturePlacement 导出）计算父房间门口禁区，候选角按「请求的 side 优先、其余 东北/西北/东南/西南 确定性尝试」选择第一个不与禁区重叠的角；全部冲突回退到请求的角。
   ② **家具推不出**：`normalizeContainment` 的 `pushOutOfRects` 有三个缺陷——旧实现只沿最小穿透轴推一次再钳制，**钳制会把家具拉回禁区**（家具贴墙时）；**完全在禁区内的家具**（nestRoom 把卫生间嵌进已有家具的房间时，如床头柜落在卫生间里）最小穿透推不出去；**贴边浮点噪声**（-1.05+0.75=-0.29999...8 与边界 -0.29999...93 差 1e-16）被判为重叠。修复：`overlapsRect` 加 1e-6 容差（与 furniturePlacement 一致，坑 35），候选 = X/Z 最小穿透 + 四个方向「完全退出」（移动到禁区边界外侧）的钳制结果，取重叠数最少的候选。改这两处时别退回旧行为。

48. **取消内嵌/移出嵌套房间必须用 moveRoom（坑 48）**（2026-08-09 用户反馈）：用户说"把主卧卫生间移出来"，LLM 输出 `nestRoom`（又把卫生间嵌进去）——旧契约里 `moveRoom` 只对嵌套房间平移足迹（保持嵌套），**没有"移出"操作**，LLM 无路可走。修复：`moveAdjacent`（moveRoom/addAdjacency 共用）在房间为嵌套时先 `liftToTopLevel`（removeNode + 追加到顶层末尾，世界坐标不变）再贴靠——"移出来/取消内嵌"语义。同时新增 `pickFreePlacement`：贴靠落点若与其他顶层房间（含走廊）重叠，按 北/南/东/西 确定性回退到第一个空侧（防止"移到主卧南侧"直接压到走廊上），addRoom 的 relativeTo 同用；全部冲突回退请求方向。提示词已注明"取消内嵌 → moveRoom，不要用 nestRoom"。

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
26. **方向约定（务必读）：世界 +x=东、+z=北，罗盘/地图/属性面板全部一致，渲染整体沿 X 镜像**。注意：**+x=东、+z=北 是左手系**（右手系在 x=东、y=上 时 z 必为南，如 Minecraft 的 +z=南），因此不镜像时 3D 渲染相对"人站在场景中"天然左右镜像。现行做法：**3D 与 2D 平面图内容都放在 `scale=[-1,1,1]` 的镜像组里**（`SceneViewer`），呈现标准地图方向——**上北下南、左西右东**；默认相机在南侧（`[0,9,-10]` 朝北看，正对入户门），镜像后东在屏幕右侧，与平面图一致。配套三处镜像补偿（改其中任何一处都要同步检查）：
   ① 世界锚定罗盘（`WorldCompass`）在镜像组内渲染，锚点自动随内容镜像，无需额外处理；**但标签定位要按各方向自己的半宽/半深 + 边距（2026-08-10）**：旧实现用 `max(半宽,半深)` 从中心算距离，宽度 > 深度时东/西标签比南/北更贴近房屋，东字会盖住东侧「总宽」尺寸标签（用户反馈）；且 DOM 标签世界宽度随缩放变化（12px 文字 + 内边距约 0.6~1.9m），边距需 2.8m 才够让开（尺寸线标签中心在房沿外 1.1m、文字可伸到 ~1.9m）；
   ② 右上角覆盖层罗盘（`CornerCompassSensor`）在组外（DOM），按相机矩阵投影世界方向——**必须把方向 x 取反再投影**（内容镜像了，世界方向也要镜像，否则 E/W 标签指反）；
   ③ **Gizmo（TransformControls）必须渲染在镜像组之外**，代理坐标取节点镜像位置（`-x, y, z`），读写处对称还原（`GizmoControls` 的 sync/readback 各有一处取反）——放在组内会因「手柄渲染镜像 + 拖拽沿世界轴」导致拖拽方向视觉反转（坑 55）。
   属性面板微调按钮 东=+x、西=-x，与镜像后的视觉（东在右）一致。**改罗盘/平面图/Gizmo/相机时别再按旧镜像约定改回去**。

### 3.5 存储与持久化

27. **持久化迁移**：`useSettingsStore` persist 带 `version` 字段（如 version 2 起默认关闭线框），旧数据自动迁移。localStorage keys：`wordcraft.settings` / `wordcraft.model` / `wordcraft.chat`。**改持久化结构必须升 version 并写迁移**（v3 模型的 IndexedDB/口令迁移见 design.md §3.4）。
28. **项目库脏标记用 lastSavedJsonRef 而非 revision**：HomePage 持 `lastSavedJsonRef`（上次保存的场景 JSON），`useEffect` 订阅 `scene`——与之一致则 `markSaved`、不一致则 `markDirty`；**仅 `currentId !== null` 时跟踪**（游离新场景不算脏）。打开项目/保存成功后必须先 `lastSavedJsonRef.current = JSON.stringify(scene)` 再 `setProject`/`markSaved`，顺序反了会被 effect 误标脏。
29. **截图三件套**：① Canvas 必须 `gl={{ preserveDrawingBuffer: true }}` 否则 `toDataURL()` 读不到缓冲（空白）；② 场景净化用 `useModelStore.screenshotMode`，置 true 后**等两帧 rAF** 让 React 应用隐藏辅助元素再截图，最后复位；③ jsdom 无 WebGL，HomePage 调用须用 `viewportRef.current?.captureScreenshot?.()`（`?.` 守卫方法本身）。口令历史只持久化 records（上限 20），还原校验走 `migrateModel`（v1/v3 均可，P1 起）；口令编码带 `wc3:` 前缀（P1 起）。

### 3.6 i18n

30. **i18n 范围边界（重要）**：`src/i18n/translations.ts` 只翻译 **UI 界面层**。**生成数据不翻译**——LLM 系统提示词保持中文，`roomGeometry`/`furniturePlacement` 的分类器是中文词表（`ROOM_TYPE_RE`、`FREE_STANDING_RE` 等），英文房间名会破坏走廊/开放/私密房/家具贴墙分类。改分类器/提示词做多语言前，别期望英文房间名能正确分类。
31. **i18n 实现要点**：组件用 `useT()`（响应式）、lib 抛错用 `t()`（非响应式读 store，无循环依赖）；`t()` 的 `{}` 插值用 `split/join`（目标 ES2020，无 `replaceAll`）。`translations.ts` 的 zh 为 key 真源、en 为 `Record<TKey,string>`，`translations.test.ts` 断言两语言 key 集合一致。

### 3.7 家具部件模型

32. **家具部件模型（v1.4.0，20 类）**：
   ① `furnitureKind` 分类器必须**先排除易误判词**再宽松匹配（`床尾凳` 含「床」会误套床造型 → `GENERIC_GUARD_RE` 先归 generic；**词表顺序敏感**：`床头柜/床边柜` 必须排在 `床` 之前、`电视柜` 排在 `电视` 之前，含子串的宽松词后置）；
   ② **水平（x/z）必须钳制在 L×W 足迹内、底面贴地**——测试硬性断言覆盖 20 类 × 小/大尺寸 × 四朝向；**竖直顶部允许向上悬挑**（电视柜上的电视屏/梳妆台镜面高于盒顶），别把 y 上界当硬约束；
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

### 3.9 v3 足迹模型（P1 落地实录）

37. **墙段局部坐标约定：以边起点为 0，方向恒 + 轴**：v1 墙段局部坐标以墙中心为 0（世界映射 `start + half + local`）。v3 足迹边泛化后统一为「段局部 0 = 边起点（min 端）」，世界映射 `start + local`——`footprintEdges` 基座段必须是 `[0, length]` 而非 `[-len/2, len/2]`，否则嵌套覆盖判定（`rEdge.start + seg.from`）错位半个边长，出现「覆盖只剩 0.15 宽滑条」的怪象。**改 segment 初始化/开洞/兜底门时别混用两套约定**。⚠️ **渲染侧也必须同步**：墙组锚点必须放边起点而非边中点，否则整段墙向边尾端漂移半个边长（P1 曾漏改，见坑 41）。
38. **整屋居中平移必须递归平移嵌套房间足迹**：`finalizeHouse` 把整屋平移到原点时，若只平移顶层房间 footprint，嵌套房间（及其家具）会留在平移前的绝对坐标——随后 `normalizeContainment` 把它们钳制到父房间边界内侧，表现为"嵌套卫生间跑到卧室中心/东侧"。用 `translateRoom` 递归平移（足迹 + 家具 + 嵌套），保持相对关系。
39. **footprint 边下标与顶点环顺序强相关**：`Opening.edgeIndex` 引用的是 `footprint` 顶点环的边序号（`rectFootprint` 自西南角逆时针：0=南、1=东、2=北、3=西）。手写开洞测试/将来 UI 生成开洞时，务必按该顺序索引，否则窗开在错误的墙上。
40. **房间尺寸/位置改为足迹派生后，属性面板与 Gizmo 必须走访问器**：`nodeDims/nodePosition`（`lib/footprint.ts`）统一返回 家具（直接字段）/房间（足迹包围盒 + 层高、足迹中心）/整屋（并集）。任何直接读 `room.dimensions/position` 的代码都会在 v3 类型下编译报错——这反而是好事，靠类型系统把残留引用全部找出来。

## 4. 已知限制（当前实现）

- **嵌套房间地板**：父房间地板是整块的（嵌套房间地板叠在其上，靠 `floorLift` 防闪烁），不是真正挖出 L 形地板；两个嵌套房间共用内隔墙时只处理一半（后处理者看到先处理者的墙）。
- **手动编辑不触发重排**：改房间尺寸/位置不会重跑布局引擎（见坑 22）。
- **家具-家具避让是"贪心顺序"**：生成时常理按 children 顺序逐个放置并避让已放置家具，非全局最优。
- **属性面板/Gizmo 编辑不避让门口**：`normalizeContainment` 只约束进父房间外边界与推出嵌套占地。
- ~~**房间移动不带动家具**~~（**已修复**：移动房间（属性面板微调/复位、X/Z 数值框、Gizmo 拖拽、平面图移动工具、LLM `moveRoom`）整体平移足迹 + 家具 + 嵌套房间，相对关系不变——`modelTree.translateRoomContents`；`updateNodeFootprint` 对纯平移足迹同样带动家具（保证编辑日志 `updateRoom.patch.footprint` 回放行为一致）。改形状/缩放仍只约束进墙内）。
- **LLM 输出质量依赖提示词**（当前 DeepSeek v4-flash）。多轮修改、家具常理摆放等依赖 LLM 遵循度。
- **拆分仅支持矩形房间**：`splitRoom` 只接受 4 点矩形足迹（L 形等需先拖顶点/或用 addRoom 重建）；合并要求并集为合法矩形（面积守恒）。
- **无楼梯/无楼层**：`LevelNode` 已在模型中预留单层，楼层/楼梯属 Phase 5。
- **footprint 编辑仍是矩形语义**：P1 布局引擎只产矩形足迹；属性面板改房间尺寸 = 足迹按包围盒缩放（L 形多边形会被拉伸，属已知边界，P4 拖顶点编辑后建议改用顶点工具改形状）。
- **P2 ops 已知边界**：① `updateRoom.patch.side` 对已平铺房间无几何意义（接受并忽略）；② ~~`setOpenings` 无删除开洞~~（**P4 已补齐**：`remove: true` + 可选 `from/to` 只删重叠者；`edgeIndex` 精确指边）；③ `relativeTo` 仅支持贴靠单个房间，多房间约束推理（"客厅北接阳台"）属 Phase 5；④ `addRoom` 无 `relativeTo` 时排东侧，可能不贴已有房间。
- **P3 已知边界**：① 撤销/重做栈为整场景快照（**设计决策，非待办——别再提议 op 粒度化**）：op 逆操作（Gizmo 拖拽中间态 / normalizeContainment 约束 / splitRoom/mergeRoom 等）难以定义且回放后不保证还原，快照正确性最稳、内存开销在当前规模下可忽略、对用户行为无感；② 编辑日志不随撤销/重做弹栈——撤销后的场景摘要仍权威，日志里的过期 op 由 LLM 结合摘要自行消解；③ ~~手动编辑仅覆盖 属性面板/Gizmo/位移微调 四入口，无删除类手动编辑~~（**P4 已补齐**：平面图编辑提供增（拆房/放门窗/画墙）删（合并/删门窗/拖顶点缩小）全套入口）。

## 5. v3 实施注意事项（开始改之前读）

> 状态：**P1（数据模型 v3）、P2（契约动词化）、P3（双向同步）与 P4（平面图自由编辑）已完成**（2026-08-09）。以下条目除标注「✓ 已完成」外均属后续阶段（P5）要求。

1. **✓ P1 是纯重构**：数据模型 v3 只是内部格式升级，禁止借机夹带新功能；验收 = 旧数据可打开 + 用例全绿 + 截图无回归。P1 已达成：214 用例全绿、migrateModel 覆盖旧项目 JSON/旧分享口令/旧持久化三条路径、示例模型几何与 v1 完全一致（houseBounds 12.3×10 断言不回归）。
2. **✓ 迁移函数必须幂等且可测**：`migrateModel(v1 → v3)` 写成纯函数，覆盖旧项目 JSON 与旧分享口令两条路径；分享口令加版本前缀 `wc3:` 后，旧口令解码兼容（`decodeShareCode` 对无前缀口令直接解压），解压/迁移失败走降级提示而非崩溃（`migration.test.ts` 覆盖）。
3. **✓ op 执行器逐条容错**（P2）：任何一条 op 失败只回滚该条，绝不整屋回滚；执行顺序必须确定（数组顺序），禁止依赖对象键序。已落地：`executeOps` 逐条 try/catch，`skipped` 记录失败原因；单条 op 的 zod 校验也在 `parseOps` 里逐条做（一条无效不连累整批）。
4. **编辑器与对话共用执行器**（P3/P4 已达成）：平面图编辑产出与对话 op 同构，撤销栈/对话上下文单套语义。
5. **✓ footprint 顶点约束（P4 已落地）**：正交约束（每边水平/垂直）由 `dragVertexFootprint`（`lib/planEdit.ts`）保证——被拖顶点取指针网格点、前驱/后继沿边滑行；编辑器用 0.1m 网格吸附兜底；自交/自触多边形在编辑时拒绝（`footprintValid`：每边轴对齐且 ≥ 0.3m + 非相邻边不相交，测试覆盖）。
6. **✓ 墙段泛化小心镜像**：足迹边按顺序遍历时，局部坐标方向统一为 + 轴（坑 37：段局部 0 = 边起点），渲染按边轴决定旋转（轴 'x' 平放 / 轴 'z' `-90°`），不再重蹈东西墙镜像的坑 1。
7. **✓ window 段渲染**：沿用门段"永远渲染为开洞"的原则（坑 2），`WallSegmentKind` 加枚举后同步检查所有分支（`ModelNodeView.WallSegmentBox` + 测试）。
8. **多轮上下文摘要**（P2 已落地/P3 完成）：房间摘要必须含 id（LLM 靠 id 引用节点），且与 ops 日志按时间顺序拼装，避免模型看到乱序的"当前状态"。当前 `buildSceneSummary` 输出 整屋 + 递归房间（含嵌套）+ 家具 的 id/名称/尺寸 + **顶层房间邻接表（邻居-方位）**，作为 user 消息注入；P3 已用精简摘要替代"上一轮 ops 原文"（token 省 80%+），邻接表判定与墙体同源（任一边共线 |线差|≤0.4 且区间重叠即相邻，方位 = 邻居相对本房间的方向），供 LLM 选择 relativeTo/moveRoom 的 dir。

### P3 落地补充（改 editOps/chat/useModelStore 前读）

9. **手动编辑 → op 必须按编辑后的实际状态取数**：`editDiffToOps(before, after, id)` 与真实提交一致（如 `updateSelected` 先 `normalizeContainment` 再 diff），家具 op 的 `patch.position` 必须是**相对所在房间中心**的换算值（x/z 偏移、y 为高度一半），房间位移/改尺寸统一用 `patch.footprint`（世界坐标顶点环）表达——直接塞绝对坐标会误导 LLM（v2 语义是相对值，坑 9 同源）。
10. **家具尺寸断言别写死**：示例模型家具经家具常理摆放可能已交换长宽（坑 17），断言编辑后尺寸时应取"编辑后节点的实际 dimensions"而非"规格里的名义长宽"。
11. **`toChatHistory` 剔除规则只认助手纯 JSON**：以 `{` 开头的助手消息（上一轮 ops 原文）不回传，由场景摘要 + 编辑日志替代；用户消息与带文本的助手消息保留（多轮意图不断裂）。改该过滤规则时注意 `undoLastGeneration` 依赖消息对结构，别误删。
12. **编辑日志生命周期**：`setScene`/`resetScene`/`clearConversation` 清空 `useChatStore.editOps`——旧日志描述的是已被整体替换的场景，留着会让 LLM 把已作废的改动当成现状；生成失败（场景未变）时日志保留。
13. **记录编辑 op 的时机在 useModelStore 提交处**（translateSelected/resetSelectedPosition/updateSelected/commitDrag 四个入口），`previewSelected`（拖拽中）不记录；commitDrag 整次拖拽只记一条。撤销/重做不弹日志（行为不变），别顺手改动 snapshot 撤销栈（坑 20/21 保持）。
14. **跨 store 调用只走 getState**：useModelStore → useChatStore 的 `getState().pushEditOps()` 单向依赖（chat store 不 import model store，无环）；在 `set()` 回调内同步调用安全。

### P2 落地补充（改 executor/chat 前读）

9. **v2 家具 position 语义是"相对房间中心"**（x/z 偏移、y 为高度一半），快照 diff 时把当前绝对位置换算成相对后再比较（`f.position - footprintCenter`），否则整屋居中后绝对坐标漂移会误产生 position 补丁；patch.position 直接写 v2 相对值。
10. **`setHouse` 空操作判断不能靠引用比较**：`{...scene.root}` 恒为新对象；必须显式判 `name === undefined && style === undefined`。
11. **`macro` 保持整屋 id 不变**：多轮稳定性靠 `scene.root.id` 传递，`entranceRoomId` 由 corridor params 重建；`removeRoom` 删除入口房间时清空 `entranceRoomId` 防大门悬空。
12. **auto 模板快照直接映射 `macro` 而非逐房间 diff**：模板语义是整屋重排（走廊/环绕关系无法用单房间 diff 表达），与旧版 `resolveLayout` 行为一致；只有 `custom` 快照才走按 id diff。
13. **`setOpenings` 的 edgeIndex 沿用坑 39 约定**（footprint 顶点环边序号，矩形 0=南 1=东 2=北 3=西）；非矩形同方向多边取最长者（确定性）。
14. **执行器结束要刷新楼层高度**：op 改了房间 `height` 后 `level.height` 不会自动跟随（`finalizeHouse` 只跑在 macro 内），`executeOps` 统一按最大层高刷新。
15. **addRoom 落点三选一**（确定性）：有 `relativeTo` → 贴靠目标房间对应侧（间隔 0 无缝共墙，共享墙去重由墙体方案负责）；无 → 已有房间时排整屋东侧（`maxX + 半宽 + 0.3`）；空屋 → 原点。显式 `footprint` 时以顶点环为准（忽略落点）。

### 3.10 墙段渲染映射（坑 37 的渲染侧，P2 修复实录）

41. **渲染 group 必须锚在边起点，不是边中点**：P1 把墙段局部坐标从"墙中心为 0"改为"**边起点为 0**"（坑 37），`footprintEdges` 基座段 = `[0, length]`、嵌套覆盖判定用 `rEdge.start + seg.from`——但 `ModelNodeView` 的墙组 `position` 仍沿用 v1 的 `start + length/2`（边中点），两者差半个边长：整段墙 `[0, len]` 的中心（局部 `len/2`）被画到"边中点 + len/2" = **边的终点**，表现为**所有墙（东西+南北）整体向边尾端漂移半个边长**（用户报告："x=1 到 x=2 应该是墙，结果 x=1.5 到 x=2.5 是墙"）。修复：`wallGroupPosition` 锚在边起点（轴 'x' → `[start, y, line]`；轴 'z' → `[line, y, start]`，旋转后局部 +x → 世界 +z），世界映射统一 = `start + local`。**改段坐标约定时，必须同步检查渲染锚点与所有 `start + seg.from` 的使用点**（`segmentWorldRange` 已抽出并有回归测试：墙段世界区间不得越出房间足迹边界）。

### 3.11 平面图编辑（P4 落地实录）

49. **编辑层必须渲染在镜像 group 内，指针坐标经 `worldToLocal` 还原**：`SceneViewer` 的渲染内容（3D 与 2D 平面图）都在 `<group scale={[-1,1,1]}>` 镜像组内（坑 26）。`PlanEditLayer` 的网格若渲染在镜像组外，方向/命中全反；射线在世界 y=0 平面取交点（`Raycaster.setFromCamera(pointer, camera)` + `intersectPlane`）后必须经 `group.worldToLocal` 转足迹坐标——直接在组外算局部坐标会在 X 轴镜像（±1 倍）。改命中/拖拽换算时别绕过这个转换。
50. **splitRoom 的共墙门必须加在渲染共享墙的一侧**（坑 43 同源）：拆房后两房间的共享墙只由一方渲染（`sharedWallOwner`：非走廊优先、同则 id 小者），把门开在非渲染侧的 `doors` 上是**静默空操作**（`applyOpenings` 只切实心墙段）。`applySplitRoom` 先判 owner 再决定门加在 a 的东/北墙（owner=a）或 b 的西/南墙（owner=b），`sharedWallEdgeDir(axis, ownerIsA)` 统一推导。
51. **mergeRoom 里 keep 嵌套在 remove 内必须先交换角色**：`removeNode(remove)` 会连同其嵌套后代一起删除——若 keep 是 remove 的嵌套子房间，先交换（keep↔remove）再合并，失败（并集非矩形）也能保证场景不丢房间；合并入口房间时 `entranceRoomId` 要迁移到 keep。
52. **平面图编辑的拖拽一律「预览不记历史 + 结束一次性 commit」**（同坑 21 的 Gizmo 模式）：`previewFootprint`/`previewSelected` 只改场景，`commitPlanEdit(baseScene, id)` 结束时压入拖拽前快照 + `editDiffToOps` 记一条 op；**切换工具时必须先 commit 再清拖拽状态**（否则预览过的场景没有撤销点）。非拖拽类编辑（放门窗/拆房/合并）走 `applyPlanOps`：`executeOps` 后同时检查 `applied > 0` 与 `JSON.stringify` 前后一致（同边同区间重复开洞等"执行成功但无变化"不记历史）。
53. **拖拽要用 R3F 指针捕获**：`capturePointer`（`e.target.setPointerCapture(e.pointerId)`，R3F 捕获语义会把捕获对象并入后续事件的命中列表）——否则拖顶点时指针悬停手柄对象，move 事件被手柄吃掉、平面收不到，拖拽停顿。手柄与平面都要注册 onPointerMove/onPointerUp，且都做归属校验（drag.roomId/vertexIndex 匹配才处理）。
54. **拆房切线的确定性**：splitRoom 的 position 是世界坐标（不是局部区间），矩形判定用 `footprintIsRect`（4 点轴对齐环）；切线两侧必须各 ≥ `MIN_ROOM_SIDE`(1m)（房间过小/切线太靠边直接拒绝，UI alert 提示）；开洞重映射按「边方向（几何判定，不依赖环起点）+ 沿边世界区间」归属 A/B，跨切线丢弃。
55. **Gizmo 必须在镜像组之外渲染，代理坐标 x 取反**（坑 26 的③，2026-08-09 落实）：3D 内容整体沿 X 镜像（左手系补偿）后，TransformControls 若仍在镜像组内——手柄网格随组镜像（+x 手柄显示在左），但拖拽位移仍沿世界 +x 应用（对象往右移动）→ **手柄方向与拖拽效果视觉反转**。修法：`GizmoControls` 移到镜像组外，代理 `position.x` 取反与节点的视觉位置对齐（节点世界 (x,y,z) → 代理 (-x,y,z)），`handleObjectChange` 提交时 `x: -g.position.x` 还原；scale 模式不受影响（缩放对镜像对称）。

### 3.12 平面图增强（README 路线图「2D 平面图增强」，2026-08-10 落地实录）

> 不属于 design.md 的 P5（P5 = 约束图/楼层/风格）。平面图模式下 3D 家具网格改由 `PlanEnhancements` 的 2D 足迹呈现（`ModelNodeView` 透传 `planMode` 跳过渲染），门窗符号与墙体方案同源（`computeAllWallPlans`），房间尺寸线为顶层房间内标注。

56. **尺寸信息会盖在房间上——必须提供开关**（2026-08-10 用户反馈）：房间内部尺寸线（`roomDimLines`）叠加在房间上会遮挡内容。方案：`useModelStore.showPlanDims`（会话内，默认开、不随 setScene 复位——视图偏好与场景无关）控制渲染，工具栏「尺寸」开关独立一行（第二行，不挤占工具行）。⚠️ 尺寸线「仅选择工具时显示」（编辑工具下让位），开关 ≠ 工具联动。
57. **房间标签不要重复尺寸**（2026-08-10 用户反馈）：尺寸线已标注长宽后，房间标签再显示「厨房 3.5×3」是重复信息。方案：**标签恒只显示名称**（`PlanAnnotations` 不再调 `roomLabelText`，该函数已随死代码删除）——比"开关联动"更简单且不会因开关/工具状态变化导致标签闪烁。
58. **空文案提示条会露出黑底空胶囊**（2026-08-10 用户反馈"火腿肠"）：`.plan-toolbar__hint` 是黑底圆角胶囊（`rgba(20,22,27,0.72)` + border-radius），选择工具下文案为空仍渲染出空胶囊。方案：HomePage 里 `planTool !== 'select'` 时才渲染提示条（不要再加空内容 div）。
59. **平面图增强的三层高度与编辑层交互平面不冲突**：足迹 0.14 / 门窗符号 0.25 / 尺寸线 0.35，全部低于 `PlanEditLayer` 交互平面 0.5——编辑工具下平面先命中（相机俯视按距离排序），足迹/符号不会拦截指针；选择工具下无交互平面，足迹（`onClick` + stopPropagation）可选中家具。改高度时别抬到 0.5 以上。
60. **门扇符号弧线：atan2 差值恒为 ±π/2，天然是 90° 短弧且落在房间内**：铰链端（段起点门框角）→ 门扇线垂直入房间；弧线从门扇端点扫到洞口另一端，首尾点取精确坐标（浮点缝隙会导致线与墙之间出现断点）。窗洞符号 = 向内偏移 0.1/0.22 的双线（经典双线示意）。

### 3.13 移动端横屏支持（2026-08-10 落地实录，README 路线图项，横屏限定）

61. **竖屏引导与紧凑布局判定一律走 JS 视口（innerWidth/innerHeight），不要用 matchMedia/媒体查询**（2026-08-10 实测踩坑两轮）：小米系统浏览器（Redmi K70E 实测）等部分安卓浏览器对媒体查询的视口判定不可靠——先是用 `(pointer: coarse)` 限定触屏（安卓/桌面模式报告 `pointer: fine` 漏命中），去掉后纯 `(max-height: 480px)` 仍不命中。最终方案：`OrientationGuard` 用 `window.innerWidth/innerHeight`（恒为 CSS 像素）计算两个状态——① 竖屏引导（阈值 A：`w < 768 && h > w`，纯 orientation 会把 iPad 竖屏也拦住）；② 紧凑布局（`w <= 760 || h <= 480`）给 `<html>` 加 `wc-compact` 类，**窄屏样式全部由该类门控**；`index.html` 内联脚本在首帧前预置该类防闪烁。命中时**应用层不要卸载**（覆盖层盖在下方即可），旋转回来即时恢复不丢状态；jsdom 无真实视口，测试用 `Object.defineProperty(window, 'innerWidth'...)` + resize 事件模拟。**桌面端任何情况都不应命中**——桌面正常窗口高度 ≥500px、宽度 >760px。
62. **触屏必须给 Canvas `touch-action: none`**：否则手机横屏上平面图拖拽（PlanEditLayer 的 Pointer Events）与 OrbitControls 双指缩放会被浏览器滚动/捏合手势劫持。桌面鼠标不受影响，改这条不影响桌面端。
63. **从元素尺寸推导布局偏移时，警惕 `box-sizing: border-box` 下的 `clientWidth`（不含边框）与首帧 0 值**（2026-08-10 实测）：`.corner-compass` 缩小到 68px 后 `clientWidth` = 66 → `66/2 - 10 = 23`，被 `radius < 24` 的守卫提前 return，四个方向标签全部停在圆心叠成一团。修复：偏移量下限取 20（`Math.max(size/2 - 10, 20)`）并**删除提前 return**——标签永远有位置；67px 以下的元素配合下限也不会越界。
64. **世界锚定罗盘标签（drei Html `zIndexRange [19,0]`）会盖住 z-index ≤19 的浮层**（2026-08-10 实测）：移动端「工具」弹出面板（`plan-toolbar` 原 z-index 10、面板内 20）被「西」方向标签遮挡。drei Html 的 DOM z-index 上限 19；`.plan-toolbar` 整体 z-index 提到 30 即可压过。以后改浮层 z-index 时记住这条上限（`orientation-guard` 1000 / 调试面板等不受影响）。

## 6. 快速文件地图

| 需求 | 改哪里 |
|------|--------|
| 生成链路/提示词（ops 契约 + 场景摘要 + 编辑日志 + 快照容错） | `lib/chat.ts`（`buildSystemPrompt`/`buildSceneSummary`/`buildEditOpsLog`/`resolveRawOutput`） |
| 双向同步（手动编辑 → op 日志）【P3 新增】 | `lib/editOps.ts`（`editDiffToOps`）+ `useModelStore`（提交处记录）+ `useChatStore.editOps`/`toChatHistory` |
| ops 执行器（逐条容错/macro/addRoom 贴靠/家具/开洞/**splitRoom/mergeRoom【P4】**） | `lib/executor.ts`（`executeOps`/`applyOp`/`diffSceneV2`）【新增】 |
| 平面图编辑纯函数（网格吸附/正交顶点拖拽/自交校验/墙命中/平移吸附/拆合布局）【P4】 | `lib/planEdit.ts`（`snapToGrid`/`dragVertexFootprint`/`footprintValid`/`hitWallOnEdge`/`snapRoomTranslation`/`splitRoomLayout`/`mergeRoomsLayout`）【新增】 |
| ops 契约类型 | `types/ops.ts`【新增】 |
| ops Zod 校验（判别联合白名单） | `schemas/ops.schema.ts`【新增】 |
| 布局/平铺 | `lib/layout.ts`（`makeRoom` 导出；custom 支持 `footprint` 顶点环） |
| v3 足迹几何（包围盒/平移/缩放/节点访问器） | `lib/footprint.ts` |
| v1→v3 迁移（项目 JSON/分享口令/持久化） | `lib/migration.ts`（`migrateModel` 幂等纯函数） |
| 家具常理摆放（贴墙/旋转/避门口/避内卫） | `lib/furniturePlacement.ts` |
| 门口禁区提取 | `lib/roomGeometry.ts`（`computeDoorZones`/`DOOR_CLEARANCE`） |
| 墙体/门/窗/开放空间（足迹边分段 + 显式开洞覆盖层 + 渲染锚点/段世界区间） | `lib/roomGeometry.ts`（`computeWallPlan`/`applyOpenings`/`footprintEdges`/`edgeOf`/`wallGroupPosition`/`segmentWorldRange`） |
| v2 契约 | `types/model.ts`、`schemas/model.schema.ts` |
| v3 模型类型 | `types/model.ts` |
| 渲染 | `components/viewport/*`（核心 `ModelNodeView.tsx`：Shape 足迹地板 + 沿边墙段 + window 窗洞） |
| 属性面板 UI | `components/viewport/PropertyPanel.tsx`（房间尺寸/坐标经 `nodeDims`/`nodePosition` 派生） |
| 编辑提交/撤销重做 | `store/useModelStore.ts`（persist migrate）、`lib/modelTree.ts` |
| 状态 | `store/*` |
| 家具部件模型（分类/拼装/包围盒） | `lib/furniturePresets.ts` + `ModelNodeView.tsx`（`FurnitureMesh`） |
| 项目库 UI/保存/守卫 | `ProjectLibraryDialog.tsx` + `HomePage.tsx` + `db/database.ts` + `store/useProjectStore.ts` |
| 2D 平面图（取景/标注） | `lib/planGeometry.ts`（足迹推导包围盒）、`PlanRig.tsx`、`PlanAnnotations.tsx`、`SceneViewer.tsx` |
| 平面图增强（家具足迹/门窗符号/尺寸线 + 尺寸开关）【2026-08-10】 | `PlanEnhancements.tsx` + `lib/planGeometry.ts`（`doorLeafLine`/`doorArcPoints`/`windowHatchLines`/`roomDimLines`）+ `useModelStore.showPlanDims` + `ModelNodeView`（planMode 跳过 3D 家具）+ HomePage 工具栏第二行 |
| 移动房间带动家具【2026-08-10】 | `lib/modelTree.ts`（`translateRoomContents`：足迹 + 家具 + 嵌套递归同量平移；`updateNodePosition`/`updateNodeFields`/`updateNodeFootprint` 纯平移检测） |
| 平面图自由编辑交互层【P4】 | `PlanEditLayer.tsx`（工具手势/命中/拖拽）+ `useModelStore`（`planTool`/`openingKind`/`previewFootprint`/`commitPlanEdit`/`applyPlanOps`）+ HomePage 工具栏 |
| 共享配色（2D/3D 一致） | `lib/palette.ts` |
| Gizmo 编辑 | `GizmoControls.tsx` + `SceneViewer.tsx` + `PropertyPanel.tsx` + `useModelStore.ts` |
| 截图分享/口令 | `ShareDialog.tsx` + `HomePage.tsx` + `SceneViewer.tsx` + `lib/watermark.ts` + `lib/compression.ts`（`wc3:` 前缀）+ `store/useShareStore.ts` |
| 竖屏横屏引导 + 窄横屏布局【2026-08-10】 | `components/ui/OrientationGuard.tsx`（JS 视口判定：竖屏覆盖层 + `wc-compact` 类）+ `App.tsx`（包裹整棵路由）+ `index.html`（内联脚本首帧预置类）+ `styles/global.css`（覆盖层样式 + `.wc-compact` 门控紧凑布局 + `.scene-canvas` `touch-action: none`） |
| i18n | `i18n/translations.ts`（zh 为真源） |
