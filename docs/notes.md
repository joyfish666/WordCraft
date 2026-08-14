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

**调试模式**：设置页 → 调试 → 开启。首页底部出现日志面板（可复制/下载），记录"请求参数（含是否有当前场景摘要）→ 模型原始回复 → ops 操作序列解析（截断自动补全/单条无效跳过原因）→ v2 快照容错路径 → 失败明细"。排查生成问题第一件事就是开它。

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
5. **i18n 边界**：只翻译 UI 层；生成数据由大模型按界面语言产出——**分类词表必须中英双语同步维护**（roomGeometry/furniturePresets/furniturePlacement 已双语，坑 107 补全了独立/靠墙词表；改词表时两套语言一起改，见坑 30）。
6. **编辑操作与对话操作同构（v3）**：手动编辑产出与对话 op 相同的操作，共享执行器/撤销栈/对话上下文。
7. **修 bug 必须挖根因（2026-08-12 起强制执行）**：禁止为单次复现打临时补丁（如改提示词绕开、特判某个房间名/坐标、只修表象不修规则）。每次修复先回答"为什么这次会错"——绝大多数 bug 是"通用规则在特定前提（布局模式 / 开洞组合 / 引用形式）下失效"，修复应落在规则层：把失效前提纳入规则本身，并补回归测试（复现场景 + 相邻场景），防止"修 A 破 B"。教训案例：入户门与窗的两次同根 bug——「窗先开、门后加」门被挤成小门，「门先开、窗后加」大窗被劈成两段，根因都是"门与窗在同一面墙上互不相让"，最终修法是把"门必须落在 ≥0.9m 实心段、放不下就换外墙"写进规则（坑 26 的 ③ 之后见 §3.14）。

## 3. 踩坑记录（按主题分组，改相关代码前必看）

### 3.1 渲染与墙体

1. **东西墙渲染镜像**：东/西墙 group 旋转必须是 `[0, -Math.PI/2, 0]`（`RoomShell`）。用 `+90°` 会把墙段沿墙镜像，导致"客厅比厨房大时，客厅独有那段外墙缺失"。`wallInfo` 的局部坐标方向与渲染方向必须一致。
2. **门段被渲染成实心墙**：门段宽度恰为 `DOOR_WIDTH`（0.9），旧代码 `len <= DOOR_WIDTH` 把它当实心墙。**`WallSegmentBox` 中 `kind === 'door'` 必须永远渲染为门洞**（左右墙段+门扇/标识），只有 `kind === 'wall'` 才渲染实心。**window 段同理（坑 7 已落地）**：`kind === 'window'` 永远渲染为窗洞（窗台 + 玻璃 + 窗楣），`WallSegmentKind` 枚举改动后所有 `switch`/分支都已同步检查。
3. **嵌套墙覆盖判定要容忍浮点贴边**：平铺/平移会把坐标弄出 ~1e-13 噪声（如 `3.0000000000000004`），墙线差会算成 `0.15000000000000036` 而恰好略大于 `WALL_THICKNESS`(0.15)，被误判"不共线"导致嵌套墙漏覆盖（双重墙）。行比较用 `WALL_THICKNESS + 1e-6`；段切分后用 `cleanSegments` 去掉 `to-from < 1e-6` 的浮点微段并合并相邻同类型段。
4. **R3F 射线命中按距离排序、逐个派发直到 stopPropagation**：房屋线框盒与房间选中轮廓盒若不排除，会先被命中并冒泡到房间 group，导致"选中房间后点不到内部部件"。修复：两个盒都加 `raycast={() => null}`；空白处取消选中由 Canvas `onPointerMissed` 兜底。
5. **点击部件冒泡**：点击床等部件会冒泡到父房间 group 重新选中父房间。家具/嵌套房间的 `onClick` 必须 `e.stopPropagation()`。
6. **同法向共面 = z-fighting 闪烁（2026-08-13 认知修正）**：**只有「同法向 + 共面 + 重叠」的面才会闪**——反向共面（如墙底朝下 vs 地板顶面朝上）会被背面剔除、同一像素只会渲染一面，永不互掐。旧记录「只在垂直面出现（水平底面被剔除不闪）」是错的：水平**朝下**的底面彼此同法向时同样互掐（坑 77：墙底/勒脚底/踢脚线底同面闪烁）。家具场景：门板/床头板/靠背/扶手若与箱体/床架前脸同在 W/2（或 L/2）平面会闪——方案：箱体前脸后缩、部件凸出贴前脸（衣柜/冰箱/洗衣机）、床头板内凹、沙发靠背/扶手内凹。改任何"贴面"几何（墙脚线/勒脚/门套/窗框/部件拼装）都要先问：它和谁共面？法向是否同向？
7. **阶梯外墙的「立柱」转角不是 bug**：同侧房间深度不一时，较深房间的侧墙在浅房间下方变外墙，与浅房间外墙成 90° 转角。曾试过把同侧深度对齐到最大值消除立柱，但副作用是**覆盖了 LLM 的房间尺寸、多轮改大小失效**，已回退。别再引入对齐。

### 3.2 布局与生成

42. **模型流式回复偶发被截断，整段 JSON 无法解析**（2026-08-09 实测）：DeepSeek v4-flash 流式回复偶发在网络/输出处被截断——整段 JSON 末尾缺几个闭合符（如 `...}}]}` 被切成 `...}}]}`），`JSON.parse` 直接抛错，用户看到「模型返回的 JSON 无法解析」。修复：`repairTruncatedJson`（chat.ts）在 parse 失败时按「字符串感知的括号栈」补全缺失闭合符——**字符串未闭合 / 括号失衡（错配/多余闭合）/ 结构本已完整时返回 null 不修复**；补全前先剔除末尾空白与逗号（截断点恰在分隔符后）。⚠️ 补全后仍可能因缺逗号等语法错误解析失败（如 `{"a":1,` → `{"a":1,}`），调用方需再 try 并走原错误路径。另加了**双编码容错**：模型偶发把 JSON 对象包进 JSON 字符串字面量（`"{\"...\"}"`），`unwrapJsonString` 解包一层（只在内层以 `{`/`[` 开头时解包，散文首尾恰是引号不误判）。debug 日志会记「模型回复 JSON 被截断，已自动补全闭合括号」。

43. **入户门位置由 `entranceRoomId` 决定，`setOpenings` 移动不了入户门**（2026-08-09 用户反馈）：LLM 想"把入户门移到走廊"时输出了 `setOpenings`（走廊南墙开门洞）——op 解析执行成功，但入户门没变化。原因有二：① 入户门是 `addEntranceDoor`（roomGeometry.ts）按 `entranceRoomId` 在入口房间入口方向外墙生成的派生门，契约里原本没有改入口房间的操作；② 走廊是开放空间且其南墙与南侧房间共享（全 `open` 段），`addDoorOnFace`/`applyOpenings` 只切实心 `wall` 段，共享/开放边上的开洞是**静默空操作**。修复：`setHouse` 增加 `entranceRoomId` 与 `entranceDir`（默认 south；执行器校验房间存在，指向不存在则跳过该条；`macro` 整体重排会**保留**用户设置的 `entranceDir`；提示词注明"移动入户门用 setHouse 不要用 setOpenings"）。⚠️ 边界：入户门必须落在入口房间朝向入口方向的外墙——走廊等内部空间选其最外沿方向（如走廊东端外墙 → `entranceDir: 'east'` + `entranceRoomId: 'corridor'`）；指向完全无外墙的方向仍为静默空操作。改 `applySetHouse`/`addEntranceDoor`/`Viewport3D`/`furniturePlacement` 的 entrance 取值时别破坏这条约定。

44. **卫生间默认只开一扇门（2026-08-09 用户反馈）**：普通"卫生间"同时邻走廊和卧室时，旧规则每面共享墙都开门（双门）。新规则（computeWallPlan 内 `bathroomDoorTargets` 预扫描）：每间卫生间至多一扇**推导门**——① 命名归属房间存在（主卧卫生间→主卧）只对它开门；② 否则（公共/普通卫生间）**走廊优先**（"卫生间移开走廊门"=用户要求两门时用 setOpenings 在实心墙上显式加门）；③ 无走廊时选邻居 id 最小者（确定性）。注意：门判定在共享墙两侧是对称的（卫生间侧不开时邻居侧也不开，否则会出现"卧室侧有门、卫生间侧实心"的半扇门）。改 `computeWallPlan` 的门逻辑时，别把普通卫生间退回"每面墙都开门"。

45. **把已有房间"内嵌"成嵌套子房间必须用 `nestRoom`**（2026-08-09 用户反馈）：用户要求"主卧卫生间内嵌到主卧"，LLM 输出了 `moveRoom`（relativeTo）——它只能把房间贴到目标房间外侧，无法变成嵌套子房间（嵌套只在 macro/addRoom 的 nestedRooms 里生成）。修复：新增 op `{"op":"nestRoom","id":"主卧卫生间","into":"主卧","side":"可选"}`——执行器从原父容器移除该房间（顶层或已嵌套均可），按布局引擎 `placeNested` 的角落规则（side→父房间对应角，默认东北角，去墙厚余量）平移到父房间内部，家具与嵌套子房间整体随动（`translateRoom`，lib/geometry.ts，原 modelTree.translateRoomContents），再挂进父房间 `nestedRooms`；环检测（父房间不能是待移动房间的后代）与非法输入跳过；结束统一 `normalizeContainment` 兜底（过大时钳制居中、父家具推出占地）。已嵌套的房间可再次 nestRoom 转移父房间。提示词已补充该操作。**设计决策：nestRoom 移走房间后留下的空隙不自动补位**（其他房间保持不动——op 是局部修改语义，自动滑动会改动用户未提及的房间；想补位用 moveRoom 让 LLM 移动相邻房间，见坑 46 的对齐修正）。

46. **贴靠放置必须对齐走廊边线（moveRoom/addRoom 的 relativeTo）**（2026-08-09 用户反馈）："次卧和主卧相邻"后，次卧开走廊门但地板与走廊有 0.25m 缝隙——`adjacentCenter` 在垂直于贴靠方向的轴对齐到**目标房间中心**，房间宽度与目标不一致时（次卧宽 3 < 主卧宽 3.5），其走廊侧边悬在走廊边线上方；缝隙 0.25 < ADJACENCY_GAP(0.4) 仍判相邻 → 有门但地板悬空。修复：`alignAdjacentPlacement`（lib/executor/rooms.ts，2026-08-13 由 executor.ts 拆分）在 east/west 贴靠时把被移动房间靠走廊一侧的边对齐到**目标房间的同侧边线**（走廊型布局中所有北侧房南边都在走廊北边线上）；`applyAddRoom` 与 `moveAdjacent` 共用（目标就是走廊本身时跳过，语义模糊）。改贴靠逻辑时别丢掉这步对齐。

47. **nestRoom 落点必须避开父房间门口禁区，家具必须推出嵌套占地**（2026-08-09 用户反馈）：
    ① **落点压门**：卫生间内嵌到主卧后落在东北角，恰好压在主卧（朝走廊全宽开门）门洞正下方——透过门洞看过去没有墙（嵌套房间与外墙共线的边被覆盖为 open），门洞形同虚设。修复：`applyNestRoom` 用 `computeDoorZones`（与渲染同源，含入户门）+ `doorZoneRect`（furniturePlacement 导出）计算父房间门口禁区，候选角按「请求的 side 优先、其余 东北/西北/东南/西南 确定性尝试」选择第一个不与禁区重叠的角；全部冲突回退到请求的角。⚠️ **2026-08-12 补充：macro 布局路径同样有此坑**——`placeNested`（layout.ts）按角落规则落位时不看门洞，内卫无 side 时默认东北角同样会压门（用户复现"卫生间贴近门的那一侧没有墙壁"）。修复：`resolveLayout` 布局完成后统一跑 `avoidNestedDoorZones`（与 nestRoom 同款避让逻辑，按 东北/西北/东南/西南 确定性换角），覆盖 corridor/living/custom 全部模板。改内嵌落点逻辑时两条路径都要保持避让。
    ② **家具推不出**：`normalizeContainment` 的 `pushOutOfRects` 有三个缺陷——旧实现只沿最小穿透轴推一次再钳制，**钳制会把家具拉回禁区**（家具贴墙时）；**完全在禁区内的家具**（nestRoom 把卫生间嵌进已有家具的房间时，如床头柜落在卫生间里）最小穿透推不出去；**贴边浮点噪声**（-1.05+0.75=-0.29999...8 与边界 -0.29999...93 差 1e-16）被判为重叠。修复：`halfRectOverlaps`（lib/geometry.ts，原 modelTree.overlapsRect，2026-08-13 收拢为共享模块）加 1e-6 容差（与 furniturePlacement 一致，坑 35），候选 = X/Z 最小穿透 + 四个方向「完全退出」（移动到禁区边界外侧）的钳制结果，取重叠数最少的候选。改这两处时别退回旧行为。

48. **取消内嵌/移出嵌套房间必须用 moveRoom（坑 48）**（2026-08-09 用户反馈）：用户说"把主卧卫生间移出来"，LLM 输出 `nestRoom`（又把卫生间嵌进去）——旧契约里 `moveRoom` 只对嵌套房间平移足迹（保持嵌套），**没有"移出"操作**，LLM 无路可走。修复：`moveAdjacent`（moveRoom/addAdjacency 共用）在房间为嵌套时先 `liftToTopLevel`（removeNode + 追加到顶层末尾，世界坐标不变）再贴靠——"移出来/取消内嵌"语义。同时新增 `pickFreePlacement`：贴靠落点若与其他顶层房间（含走廊）重叠，按 北/南/东/西 确定性回退到第一个空侧（防止"移到主卧南侧"直接压到走廊上），addRoom 的 relativeTo 同用；全部冲突回退请求方向。提示词已注明"取消内嵌 → moveRoom，不要用 nestRoom"。

8. **复合房间名误判**：`isCorridorName('走廊卫生间')` 曾因含"走廊"返回 true，导致被当作走廊过滤。现在 `isCorridorName`/`isOpenRoom` 用 `ROOM_TYPE_RE`（卫生间|浴室|卧室|书房…）排除复合名。**注意**：ROOM_TYPE_RE 不能包含 客厅/餐厅/厨房（它们是开放空间）。
9. **嵌套房间不该拍平**：卧室内嵌卫生间必须**保留在父房间内部**（`makeRoom` 递归 + `placeNested` 靠角），不能拍平为顶层邻居。`Viewport3D` 只对顶层房间算共享墙方案，嵌套房间用 `wallPlanWithDoor(node, 朝向父房间中心)`。
10. **嵌套房间门方向**：曾用整屋中心方向，可能朝父房间外墙；现在 `nestedDoorDirection(node, parentCenter)` 朝父房间中心。
11. **私密房间连厨房/客厅**：卧室/书房（`isPrivateRoom`）**只连走廊与其套间卫生间**，不直连非走廊开放空间；否则次卧会又连走廊又连厨房。⚠️ **该规则的前提是房屋里有走廊**（2026-08-12 修正）：custom 自由布局没有走廊时，若仍套用规则，卧室会只剩卫生间一个出入口（布局"错乱"）。`computeWallPlan` 现按 `hasCorridor` 门控：无走廊时私密房间与开放空间直接开门（保证可达）；有走廊时维持原规则。改这条时别把走廊存在与否的判断去掉。
12. **公共卫生间没门**：`公共卫生间` 归属名"公共"在房屋中不存在，曾导致密封无门。规则：**归属房间不存在时，公共/公用卫生间允许与走廊开门**。
13. **多轮修改 LLM 原样输出**：大模型经常不应用修改、原样重复上一次 JSON。提示词明确要求"基于上一个模型输出修改后的完整 JSON、不得原样重复"。即便如此仍可能不稳定（LLM 行为），必要时让用户换个说法。
14. **入口房间保留**：`resolveCorridor` 里入口房间即使名字含「走廊」（如 LLM 为"大门开在走廊"创建的「入口走廊」）也保留为真实房间，否则被 `isCorridorName` 过滤后 `entranceRoomId` 悬空、大门回退到南边界房间、改大门位置无反应。
15. **家具常理摆放只对生成生效（auto 模式）**：`resolveLayout` 里 auto 模式跑 `applyFurnitureConventions`，custom 自由布局保留 LLM 显式坐标。常理规则：靠墙家具贴**最近墙**（保持平行坐标）、**大面积贴墙**（长边沿墙，必要时旋转）、再**沿墙滑动避开三类禁区**（嵌套子房间、**房间门口通道**、已放置的其他家具，按 children 顺序贪心）；独立家具（茶几/餐桌/椅子等）仅约束、不贴墙。~~**normalizeContainment 不避让嵌套房间/门口——属性面板手动把家具拖进卫生间或门口不会被弹开（已知限制）**~~（**已修复**：`normalizeContainment` 现把家具推出嵌套占地（坑 47）**与门口通道**——与渲染同源的 `computeDoorZones` + `doorZoneRect` 作为禁止进入区并入 `pushOutOfRects`，手动编辑（属性面板/Gizmo/平面图）把家具拖进门洞会被推开，与生成路径一致；`pushOutOfRects` 候选对**所有**禁区生成（只对当前重叠禁区取候选时，家具推出 A 恰好撞进 B 会被拒绝而原地不动）。已知边界：嵌套房间（如卫生间）内部的**门区不参与避让**（`computeDoorZones` 只遍历顶层房间，与 `furniturePlacement` 行为一致）；门区避让会让某些"唯一安全位"家具在越界拖拽后回弹原位（此时编辑日志 diff 为空，不记 op，属坑 18 语义）。
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

27. **持久化迁移**：`useSettingsStore` persist 带 `version` 字段（如 version 2 起默认关闭线框），旧数据自动迁移。localStorage keys：`wordcraft.settings` / `wordcraft.model` / `wordcraft.chat` / `wordcraft.project` / `wordcraft.share`。**改持久化结构必须升 version 并写迁移**（v3 模型的 IndexedDB/口令迁移见 design.md §3.4）。
28. **项目库脏标记：快照收在 store（`savedJson` + `commitSavedScene`），只做一次全量比对**（2026-08-13 重构，坑 75）：早期实现是 HomePage 持 `lastSavedJsonRef` + `useEffect` 订阅 `scene` 推算 dirty 并回写 store——拖拽预览每帧换 scene 引用触发**每帧 `JSON.stringify` 全场景**，且 dirty 真值与 store 双源易漂移（`markDirty` 从未被业务主动调用）。现行机制：`useProjectStore` 持 `savedJson`（上次保存的场景 JSON）+ `dirty`；**打开项目/保存成功/新建项目后必须调 `commitSavedScene(JSON.stringify(scene))`**（先 `setScene` 再 `commitSavedScene`，避免订阅把"加载即变"误判为脏）；`hooks/useDirtyTracking`（HomePage）订阅场景变化，只在「干净 → 变化」时比对一次（拖拽首帧置脏后跳过，不再逐帧 stringify）；撤销/重做回到已保存状态由 `useModelStore.undo/redo` 调 `syncDirtyWithSaved` 一次性清除。**仅 `currentId !== null` 时跟踪**（游离新场景不算脏）。约定：dirty 判定必须走 store 快照，别回到"组件 ref + effect 推算"的实现（坑 75）。
29. **截图三件套**：① Canvas 必须 `gl={{ preserveDrawingBuffer: true }}` 否则 `toDataURL()` 读不到缓冲（空白）；② 场景净化用 `useModelStore.screenshotMode`，置 true 后**等两帧 rAF** 让 React 应用隐藏辅助元素再截图，最后复位；③ jsdom 无 WebGL，HomePage 调用须用 `viewportRef.current?.captureScreenshot?.()`（`?.` 守卫方法本身）。口令历史只持久化 records（上限 20），还原校验走 `migrateModel`（v1/v3 均可，P1 起）；口令编码带 `wc3:` 前缀（P1 起）。

### 3.6 i18n

30. **i18n 范围边界（重要）**：`src/i18n/translations.ts` 只翻译 **UI 界面层**。**生成数据不翻译**——LLM 系统提示词与分类词表已双语化（2026-08-13 起）：英文 UI 下发英文提示词、LLM 产出英文房间/家具名，`roomGeometry`（走廊/开放/私密/卫生间归属）与 `furniturePresets`（20 类）与 `furniturePlacement`（独立/靠墙判定，坑 107 补）的分类词表均为中英双语，配套补全件名称随界面语言。**真实边界**：分类依赖词表与模型输出语言匹配——词表外的复合命名（如 "Master En-suite"）可能漏判；`roomFloorMaterial` 的英文房名匹配只覆盖常见词（bathroom/kitchen/balcony）。改分类器/提示词做多语言时，中文英文两套词表必须同步维护，并补双语用例（isWallAnchored 的英文断言就是坑 107 的回归防线）。
31. **i18n 实现要点**：组件用 `useT()`（响应式）、lib 抛错用 `t()`（非响应式读 store，无循环依赖）；`t()` 的 `{}` 插值用 `split/join`（目标 ES2020，无 `replaceAll`）。`translations.ts` 的 zh 为 key 真源、en 为 `Record<TKey,string>`，`translations.test.ts` 断言两语言 key 集合一致。

### 3.7 家具部件模型

32. **家具部件模型（v1.4.0，20 类）**：
   ① `furnitureKind` 分类器必须**先排除易误判词**再宽松匹配（`床尾凳` 含「床」会误套床造型 → `GENERIC_GUARD_RE` 先归 generic；**词表顺序敏感**：`床头柜/床边柜` 必须排在 `床` 之前，含子串的宽松词后置）；
   ② **水平（x/z）必须钳制在 L×W 足迹内、底面贴地**——测试硬性断言覆盖 20 类 × 小/大尺寸 × 四朝向；**竖直顶部允许向上悬挑**（电视柜上的电视屏/梳妆台镜面高于盒顶），别把 y 上界当硬约束；
   ③ **朝向用 `facingFromRoom(node, room, BACK_AXIS[kind])`**（不是最近墙）：柜/沙发等背侧沿**短轴**——朝短轴上最近的墙；**床单独处理**：床头在**长轴端**（短边中间），朝长轴上最近的墙。用「最近墙」会出错：转角衣柜 tie 到相邻墙后柜门开到小面。`parentRoom` 由 `ModelNodeView` 房间分支下传，改代码别漏；
   ④ 渲染用 `<group onClick>` + 各部件 mesh（点击任一部分选中整件），**选中轮廓是并集包围盒的隐形 box + Edges，须 `raycast={() => null}`**（同坑 4）；
   ⑤ 配色三档：主色 / 副色 / 深色强调（标准与色盲模式均可辨）；
   ⑥ **垂直面严禁共面**（同坑 6）；
   ⑦ 阶梯外墙「立柱」是正确外墙（同坑 7）。

### 3.8 测试环境

33. **jsdom 无原生 IndexedDB**：`vitest.setup.ts` 加了 `import 'fake-indexeddb/auto'` 供 Dexie 测试（`database.test.ts`）。`ProjectLibraryDialog` 的异步续体用 `aliveRef` 守卫避免卸载后 setState。
34. **jsdom 无 WebGL**：`HomePage.test.tsx` mock 了 `SceneViewer`，测试 R3F 渲染相关改动注意；`captureScreenshot` 在 mock 下不存在（HomePage 用 `?.()` 防御）。
35. **重叠判定要容忍浮点贴边**：床贴墙/贴禁区边界时，边缘仅差 ~1e-16 的浮点噪声，严格不等式会误判重叠。`halfRectOverlaps`（lib/geometry.ts，与 furniturePlacement 同源）内部用 1e-6 容差（`EPSILON`），测试判定也按贴边允许处理。
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
- ~~**属性面板/Gizmo 编辑不避让门口**~~（**已修复**：`normalizeContainment` 把家具推出门口通道——`computeDoorZones` + `doorZoneRect` 并入 `pushOutOfRects`，覆盖属性面板/Gizmo/平面图/执行器全部提交路径，见坑 15 更新）。
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

9. **手动编辑 → op 必须按编辑后的实际状态取数**：`editDiffToOps(before, after, id)` 与真实提交一致（如 `updateSelected` 先 `normalizeContainment` 再 diff），家具 op 的 `patch.position` 必须是**相对所在房间中心**的换算值（x/z 偏移、y 为高度一半），房间位移/改尺寸统一用 `patch.footprint`（世界坐标顶点环）表达——直接塞绝对坐标会误导 LLM（v2 语义是相对值，见本页「P2 落地补充」第 9 条，两节各自独立编号）。
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
58. **空文案提示条会露出黑底空胶囊**（2026-08-10 用户反馈"火腿肠"）：`.plan-toolbar__hint` 是黑底圆角胶囊（`rgba(20,22,27,0.72)` + border-radius），选择工具下文案为空仍渲染出空胶囊。方案（2026-08-13 起在 `PlanToolbar` 内实现，原 HomePage 逻辑随组件拆分迁移）：`hintFor` 对选择工具返回空串，渲染处 `hint && <div>` 空串即不渲染（不要再加空内容 div）。
59. **平面图增强的三层高度与编辑层交互平面不冲突**：足迹 0.14 / 门窗符号 0.25 / 尺寸线 0.35，全部低于 `PlanEditLayer` 交互平面 0.5——编辑工具下平面先命中（相机俯视按距离排序），足迹/符号不会拦截指针；选择工具下无交互平面，足迹（`onClick` + stopPropagation）可选中家具。改高度时别抬到 0.5 以上。
60. **门扇符号弧线：atan2 差值恒为 ±π/2，天然是 90° 短弧且落在房间内**：铰链端（段起点门框角）→ 门扇线垂直入房间；弧线从门扇端点扫到洞口另一端，首尾点取精确坐标（浮点缝隙会导致线与墙之间出现断点）。窗洞符号 = 向内偏移 0.1/0.22 的双线（经典双线示意）。

### 3.13 移动端横屏支持（2026-08-10 落地实录，README 路线图项，横屏限定）

61. **竖屏引导与紧凑布局判定一律走 JS 视口（innerWidth/innerHeight），不要用 matchMedia/媒体查询**（2026-08-10 实测踩坑两轮）：小米系统浏览器（Redmi K70E 实测）等部分安卓浏览器对媒体查询的视口判定不可靠——先是用 `(pointer: coarse)` 限定触屏（安卓/桌面模式报告 `pointer: fine` 漏命中），去掉后纯 `(max-height: 480px)` 仍不命中。最终方案：`OrientationGuard` 用 `window.innerWidth/innerHeight`（恒为 CSS 像素）计算两个状态——① 竖屏引导（阈值 A：`w < 768 && h > w`，纯 orientation 会把 iPad 竖屏也拦住）；② 紧凑布局（`w <= 760 || h <= 480`）给 `<html>` 加 `wc-compact` 类，**窄屏样式全部由该类门控**；`index.html` 内联脚本在首帧前预置该类防闪烁。命中时**应用层不要卸载**（覆盖层盖在下方即可），旋转回来即时恢复不丢状态；jsdom 无真实视口，测试用 `Object.defineProperty(window, 'innerWidth'...)` + resize 事件模拟。**桌面端任何情况都不应命中**——桌面正常窗口高度 ≥500px、宽度 >760px。
62. **触屏必须给 Canvas `touch-action: none`**：否则手机横屏上平面图拖拽（PlanEditLayer 的 Pointer Events）与 OrbitControls 双指缩放会被浏览器滚动/捏合手势劫持。桌面鼠标不受影响，改这条不影响桌面端。
63. **从元素尺寸推导布局偏移时，警惕 `box-sizing: border-box` 下的 `clientWidth`（不含边框）与首帧 0 值**（2026-08-10 实测）：`.corner-compass` 缩小到 68px 后 `clientWidth` = 66 → `66/2 - 10 = 23`，被 `radius < 24` 的守卫提前 return，四个方向标签全部停在圆心叠成一团。修复：偏移量下限取 20（`Math.max(size/2 - 10, 20)`）并**删除提前 return**——标签永远有位置；67px 以下的元素配合下限也不会越界。
64. **世界锚定罗盘标签（drei Html `zIndexRange [19,0]`）会盖住 z-index ≤19 的浮层**（2026-08-10 实测）：移动端「工具」弹出面板（`plan-toolbar` 原 z-index 10、面板内 20）被「西」方向标签遮挡。drei Html 的 DOM z-index 上限 19；`.plan-toolbar` 整体 z-index 提到 30 即可压过。以后改浮层 z-index 时记住这条上限（`orientation-guard` 1000 / 调试面板等不受影响）。

### 3.14 入户门与显式开洞的互让（2026-08-12 落地实录，§2 原则 7 的活教材）

65. **入户门与窗在同一面墙上互不相让，两个方向都会坏**（用户反馈两轮，2026-08-12）：①「窗先开、门后加」→ 大窗把实心墙切成 <0.9m 窄段，入户门被压成小门；②「门先开、窗后加」→ 门保住了，但大窗被门劈成两段（用户："大窗户被入户门分割成了两个小窗户"）。两次都是同一个根因：**入户门永远钉在入口墙中心，从不考虑显式开洞**。根治（`roomGeometry.ts`）：`applyOpenings` 先切墙，`addEntranceDoor` 后放置——门只开在**长度 ≥ DOOR_WIDTH 的实心墙段**上（绝不缩窄、绝不劈窗），入口墙放不下时按确定性顺序（入口方向 → 顺时针 east/north/west）换其他外墙，全部放不下则静默省略。改 `addEntranceDoor`/`placeEntranceDoorOnEdge` 时别退回"门让窗"或"窗让门"的单向妥协——两个方向的 bug 都会复发。

### 3.15 家具常理摆放（2026-08-12 落地实录，§2 原则 7 的活教材之二）

66. **主卧带内卫时家具重叠，根因是管线顺序 + 单趟滑动**（用户反馈"衣柜和双人床重叠"，2026-08-12）：三个叠加根因，缺一不可——
    ① `resolveLayout` 的 auto 分支先 `normalizeContainment` 再常理摆放：家具被推到"零重叠但位置差"的角落（床被推出门口禁区后悬在房间中部），随后"就近贴墙"被带偏，把本该留给衣柜的北墙占掉。修法：auto 分支去掉首个 normalize（常理摆放自带约束：贴墙/避门区/避嵌套/钳制进墙），custom 分支保留；
    ② `slideAlongWall` 单趟滑动：按起点重叠的禁区求避让量，避开 A 却撞上 B（沿北墙滑开卫生间时撞进已放家具）。修法：迭代滑动到干净为止 + visited 震荡防护（两个禁区在两侧反复横跳时返回 null 换墙）；
    ③ 重写时把 per-k 重叠判定误写成全集合判定（`overlapsAt` 的 `.some()` 结果复用给每个禁区），导致所有禁区都贡献避让量、算出荒谬距离全部失败——**改重叠判定务必逐禁区判断**。
    修后 4.5×3.5 主卧 + 2×1.8 内卫可完美容纳床/衣柜/双床头柜，无需放大房间。改 `furniturePlacement`/`resolveLayout` 时别把这三个修复退回。

### 3.16 缺陷修复批次（2026-08-13 代码审查落地：静默缺陷 + 渲染性能）

> 编号说明：坑 67-69 为早期编辑时跳号（历史遗留），未使用；本节从 70 继续编号，3.17 节接 74。

70. **生成竞态：180 秒生成期间的编辑被静默覆盖 / 无 API Key 时草稿被清空**（代码审查发现，2026-08-13）：`send()` 只读发送时刻的场景快照，最长 180s 后无条件 `setScene(model)`——期间用户手动编辑（拖动/属性面板/打开项目/加载示例）被覆盖，撤销栈也被清空；且 `setDraft('')` 在 API Key 检查**之前**执行，无 key 时辛苦输入的草稿消失。修复（HomePage，2026-08-13 起抽入 `hooks/useGeneration`）：① 发送时快照 `generationBaseRef`（场景引用），返回后 `scene !== baseScene` 时 `window.confirm` 询问「仍要应用生成结果覆盖当前编辑吗」，取消则丢弃结果并提示（用户编辑保留）；② `setDraft('')` 移到 key 检查之后。改生成链路时别再出现"无条件覆盖"——结果基于旧版本的场景生成时必须有确认环节。
71. **「按名称引用」契约与 id-only 变更函数不一致 → 静默零变更**（代码审查发现，2026-08-13）：提示词允许 LLM 用房间名引用（`findRoom` 也按名回退），但 `updateNodeFields`/`updateNodeFootprint`/`removeNode`/`replaceRoom`/`updateNodePosition`（modelTree/executor）只按 `root.id === id` 精确匹配——按名称的 `updateRoom`/`removeRoom`/`splitRoom`/`mergeRoom`/`moveRoom`/`nestRoom` 全部**静默"成功"但零变更**（`next === scene` 检查被 `{...scene}` 浅拷贝绕过），用户与日志都无法察觉。修复：各 apply 函数先 `findRoom` 解析出真实 `room.id` 再调用 id-only 变更函数；`moveAdjacent` 的自引用判定与 `pickFreePlacement` 排除也改用真实 id。**约定：executor 里凡 findRoom 之后还要传引用给 modelTree/planEdit 的地方，必须传 `room.id` 而非原始 ref**。executor.test.ts 新增「按名称引用」describe（updateRoom/removeRoom/moveRoom/自引用/splitRoom/mergeRoom/nestRoom 七条）。
72. **墙体方案同一场景每帧重复计算 3 次**（代码审查发现，2026-08-13）：`Viewport3D` / `PlanEnhancements` / `PlanEditLayer`（经 `collectWallHitEdges`）各自 `useMemo` 调用 `computeAllWallPlans`——拖拽预览每帧产生新 scene 引用时三份各算一遍（含嵌套线并集扫描），稳定场景下也是 3 倍浪费。修复：`roomGeometry.ts` 新增 `computeAllWallPlansCached(scene, entrance, entranceRoomId)`——**WeakMap 以场景对象引用为键**（场景被替换自动回收，无泄漏），同一引用只算一次；三个调用方全部改走缓存。⚠️ **共享的 WallPlan Map 是只读对象，调用方（如 ModelNodeView）只能 `.get()` 不能 `.set()`/`.delete()`**——后续若在组件里写 wallPlan 必须改为不可变副本。`computeDoorZones` 的多次调用（生成链路 6-7 次）暂未合并，属后续优化点。
73. **平面图拖拽时相机每帧重新取景**（代码审查发现，2026-08-13）：`PlanRig` 的 effect 依赖 `scene` 引用，而拖拽预览每帧产生新 scene → 每帧 `computePlanCamera` + `saveState()`，视图持续跳变且「复位视角」基准被覆盖，房间在包围盒边缘时几乎无法编辑。修复：effect 依赖改为取景几何签名（`boundsKey` = houseBounds 数值串），包围盒不变则不重取景；房间结构变化（生成/打开项目）仍正常取景。

### 3.17 全面审查批次（2026-08-13 落地：数据入口 + 去重重构 + 性能 + a11y）

74. **v3 数据入口无结构校验（migration 裸断言放行畸形数据）**（全面审查发现，2026-08-13）：v1 迁移路径有完整 zod，但 v3 分支只查 `root.type/levels` 就用 `as unknown as SceneModel` 放行——畸形分享口令/损坏的项目库数据可注入非法模型（缺字段/足迹 <4 点/字段类型错）。修复：`schemas/model.schema.ts` 新增 `sceneModelV3Schema`（递归房间/家具/开洞/楼层全结构校验），`migration.ts` 校验通过才放行（返回原对象保持引用不变，幂等测试不受影响）。**约定：凡本地/口令 JSON 数据入口，必须有 zod 结构校验**（v2 快照、v1、v3 三条路径现已全覆盖）。
75. **脏标记双源 + 拖拽每帧 JSON.stringify 全场景**（全面审查发现，2026-08-13）：`dirty` 真值由 HomePage 的 `lastSavedJsonRef` + effect 推算并回写 store（store 的 `markDirty` 从未被业务主动调用，职责分裂易漂移）；且 `previewSelected`/`previewFootprint` 拖拽每帧产生新 scene 引用，触发 effect **每帧 `JSON.stringify` 全场景**（20+ 房间约 100KB × 60fps）。修复：快照与判定收敛到 `useProjectStore`（`savedJson` + `commitSavedScene`），订阅只在「干净 → 变化」时比对一次（拖拽首帧置脏后跳过，不再逐帧 stringify）；「撤销回到已保存状态清除脏标记」由 `useModelStore.undo/redo` 调 `syncDirtyWithSaved` 一次性全量比对（离散操作，可接受）。HomePage 逻辑抽为 `hooks/useDirtyTracking.ts`。**约定：dirty 判定必须走 store 快照，不要在组件里用 ref+effect 推算；高频预览路径不得做全量序列化**。
76. **SSE 流式解析是最关键的零测试生产路径**（全面审查发现，2026-08-13）：`streamChatCompletion`（分片缓冲/`[DONE]`/坏行忽略/中断处理）此前零测试，回归只能靠真实请求。补 10 个用例（跨分片行拼接/`[DONE]`/坏行/空 delta/流结束/HTTP 错误透传/无 body/网络失败/读取中断/用户中止 AbortError）。另：`extractModelJson` 只认 `{` 开头，提示词允许的纯 ops 数组输出提取失败——补 `[` 直出与代码块内数组提取。
### 3.18 材质层写实化与渲染缺陷修复（2026-08-13 晚，坑 77-79）

77. **墙/勒脚/踢脚线/门套的同法向共面底边与侧面会闪烁**（用户反馈"地板和外墙的连接处闪""相连两房间的墙底部闪"，2026-08-13）：第一次修复只把墙底沉入地板 2mm（`FLOOR_EMBED`）——无效，因为墙底（朝下）与地板顶面（朝上）是**反向**共面，背面剔除使它们永远不会互掐（见坑 6 认知修正）。真正的肇事者是**三个同朝下的底面叠在同一平面**：墙底、勒脚底、踢脚线底都在 `wallBaseY`，从低角度（地面看外墙根、透过门洞看内部、室内低视角看共享墙）三者同时渲染 → 互掐；此外踢脚线外侧面 = 墙面内表面平面（同法向朝房间内）、勒脚内侧面 = 墙面内表面平面、门套立柱外侧面/底面也与墙/踢脚线共面。**修复（ModelNodeView）**：每层底面与外侧面分配互不相同的错位量——踢脚线底 +1mm/外侧面内收 1mm（`BASE_CLEARANCE`）、门套立柱底 +1.5mm/外侧面内收 1.5mm（`POST_CLEAR`）、勒脚底 +2.5mm/内侧面内收 1.5mm（`PLINTH_CLEAR`/`PLINTH_INNER_CLEAR`，板深同步减 1.5mm），全部 ≥0.5mm 间隔（远大于场景深度精度 ~0.06mm）；墙/家具整体沉入地板顶面 2mm（`FLOOR_TOP_Y = FLOOR_THICKNESS - FLOOR_EMBED`，`GizmoControls` 代理 y 换算同步用 `FLOOR_TOP_Y`）。**教训：改"贴面"几何后必须自查同法向共面对**——窗口的窗框/玻璃与窗台/窗楣是反向共面（不闪）、玻璃无深度写入，无需处理；地面石板底与草地顶也是反向共面，不互掐。
78. **共享纹理 repeat 与几何层 UV 拉伸相乘 = tile² 双重缩放**（写实化审查发现，2026-08-13）：`getTexture` 对共享纹理全局设 `repeat = 1/tileMeters`，墙面（`boxWallGeometry`）/屋顶/地面（`scaleAllUvs`/`planeGeometryWithUvs`）又在几何层把 UV 拉伸 `len/tileMeters`——采样坐标 = uv × repeat，实际平铺周期变成 tileMeters²（混凝土墙 6.25m、草地 4m 一贴），墙面纹理糊成一片"灰平涂"。只有地板（Extrude 顶面 UV 为世界坐标，仅乘一次 repeat）碰巧正确。**修复（materials.ts）**：base 纹理 repeat=1（归一化 UV 几何自行按米拉伸，家具/墙/屋顶/地面共用）；新增 `getWorldUvTexture` 返回 base 的克隆（共享图像 source，仅 repeat=1/tileMeters）供世界坐标 UV 的地板使用。`MaterialSpec` 加 `uvMode: 'world' | 'normalized'`（默认 normalized），`materialParams` 按模式选纹理。**教训：纹理 repeat 与 UV 缩放只能二选一，混用即平方**。
79. **屋顶整体移除（用户决策，2026-08-13 晚）**：用户为**一层户型**，屋檐遮挡内部视野要求去掉。`RoofView.tsx` 删除；`roof` 设置项全链路清理（`types/settings.ts`/`useSettingsStore`（含 `setRoof`）/`SettingsPage` 开关/i18n 中英 key）；settings persist 升 **v5**，migrate 中把旧存档残留的 `roof` 字段解构剔除（避免残留进状态）。**教训：造型层功能被用户否掉时要整链删除（类型/存储/迁移/UI/i18n），不要留死开关**；v4 → v5 的迁移仍保留 shadows 默认开启逻辑。

### 3.19 审查批次后续（2026-08-13 晚，坑 80-84 + 工程化，批 A/B/C）

> 承接 3.16/3.17 的全面审查结论，本次修复"性能热路径 + 契约漂移"两个主题；D 批（modelTree 泛型化消 cast、组件拆分、死代码清理、HashRouter）留待后续（HashRouter 已由 404.html 深链接回退方案替代，见坑 89）。

80. **拖拽预览每帧写 localStorage（坑 75 的姊妹问题）**（审查发现，2026-08-13）：坑 75 修掉了脏检查的每帧 `JSON.stringify`，但 **zustand persist 每次 `setState` 后同步 JSON.stringify 全场景写 localStorage**——`previewSelected`/`previewFootprint` 拖拽每帧产生新场景引用，100KB+ 场景 × 60fps 同步序列化 + `setItem`。修复（`useModelStore`）：persist 配置改走自定义存储层 `previewAwareStorage`（`storage: createJSONStorage(() => previewAwareStorage)`，`getStorage` 已弃用），模块级 `persistEnabled` 开关在预览 set 期间跳过写入、提交恢复；配套测试断言「预览后 storage 保持提交时场景、commitDrag 恢复持久化」。⚠️ **不要用「partialize 返回 undefined」实现**——zustand v4 对 undefined 仍会写 `{"state":...}`（把已持久化场景清成空壳）；预览态是瞬态，中途刷新丢失可接受。
81. **对话消息持久化整场景快照（5MB 配额风险）**（审查发现，2026-08-13）：`useChatStore` 的 messages 内嵌完整 `SceneModel`（多轮 = 每轮一份），`partialize: { messages }` 每次 addMessage 全量重序列化，多轮后逼近 localStorage 5MB 配额。修复：partialize 剥离 `model` 字段（`model` 仅供会话内「撤销生成」——`generationStack` 已覆盖，刷新后由场景摘要 + 编辑日志替代）；persist 升 **v3**，migrate 把 v2 存档消息中的 `model` 一并剥离。**约定：持久化体积上限思维——凡是"每轮/每次操作一份全量数据"的字段，先问是否必须落盘。**
82. **v2 快照容错路径丢 position/relativeTo → 新房间全部堆到东侧**（审查发现，2026-08-13）：`diffSceneV2` 的 `addRoom` op 构造只拷贝 id/name/dimensions/side/footprint/furniture/nestedRooms，`roomSpecFromV2` 算出的 `position` 被丢——按 position 布局的 custom 快照新增房间全部落到 `defaultPlacement` 的"排东侧"兜底，**静默几何错误**（无报错、日志无感知）。根因是三层漂移：提示词声明 addRoom 支持 position → `RoomSpec` 类型有 → `addRoom` op 类型/schema/执行器没有。修复：`addRoom` op 契约补 `position` 字段贯通 type/schema/执行器（落点优先级 **footprint > position > relativeTo > 东侧兜底**）；`diff.ts` 的 addRoom 构造与 `roomSpecFromV2` 家具映射全字段透传（顺带补回此前静默丢失的 `rotationY`/`description`）。**教训：契约三层（提示词/类型/zod）任一层改字段，必须三层同步 + 快照适配器检查。**
83. **setOpenings 的 side 三方不一致，UI 靠 `as Op` 绕过校验**（审查发现，2026-08-13）：schema 强索 `side` 但执行器支持 edgeIndex-only 路径，`PlanEditLayer` 只能 `as Op` 绕过——类型系统形同虚设。修复：`side` 改为可选（schema/类型同步），跨字段约束「side 与 edgeIndex 至少其一」由执行器兜底（**discriminatedUnion 不接受 `.refine` 包装成 ZodEffects 的选项**，跨字段校验放执行器与"房间存在性"同模式）；`PlanEditLayer` 四处 `as Op` 删除（对象字面量本身类型已足够）；错误消息区分 side/edgeIndex 来源。
84. **RoomShell 地板几何每帧重建（Shape + ExtrudeGeometry 分配/GC）**（审查发现，2026-08-13）：`floorShape = new THREE.Shape(...)` 每 render 新建并传 `<extrudeGeometry args>`，拖拽预览每帧每房间重建几何 + 旧实例 dispose。难点：`computeAllWallPlansCached` 按场景引用缓存，预览每帧新 scene → 新 WallPlan 引用，`useMemo([room, plan])` 引用比较每帧失效。修复：`wallPlanKey(plan)` 按**内容签名**（axis/line/shared/dir，即 `floorPolygon` 实际消费的字段）经 WeakMap 缓存字符串实例，memo 依赖 `[room.footprint, wallPlanKey(plan)]`——足迹与墙线内容不变即命中（足迹数组引用在不可变更新中稳定，`rebuildContainer` 保留原引用）。**教训：缓存键是"内容"还是"引用"取决于消费方**——渲染层引用键（坑 72）对"同引用只算一次"是对的，组件 memo 需要内容键。
85. **工程化批次（2026-08-13）**：① **format 门修复**——审查时发现 HEAD 上 6 个文件未格式化（ModelNodeView/Viewport3D/translations/materials/palette/SettingsPage），`format:check` 实际是红的，与文档声称的"全仓格式收敛"矛盾：`npm run format` 收敛；② **ci.yml 补 build 门**（此前 PR 只跑 lint/format/typecheck/test，rollup 错误只在 main 部署时炸）+ **deploy.yml 补测试门**（此前 CI 与 deploy 并行，测试红照样部署）；③ **`three-stdlib` 声明为直接依赖**（`PlanRig`/`SceneViewer` 直接 import 但靠 drei 传递解析，幽灵依赖——升级即断）；④ **`npm audit`**：nanoid High（vite→postcss 链，`npm audit fix` 已清）清零，react-router v6 线 2 个 Moderate 已升 v7 清零（坑 115）；⑤ **zustand persist `getStorage` 弃用** → `storage: createJSONStorage(...)`。

> **react-router v7 升级（原 review-followup.md C1，2026-08-14 完成，坑 115）**：动机为 `npm audit` 报 v6 线 2 个 moderate（CVE-2025-68470 open redirect、GHSA-337j SSR deserializeErrors）**无修复**；本项目 CSR-only 且路由全硬编码，实际不可达，属依赖线 EOL 风险非活动漏洞。执行结果：① `react-router-dom` 升 `^7`（v7 起为 `react-router` 的再导出包，7.18.2，API 零改动——BrowserRouter/Routes/Route/Navigate/NavLink/Link/Outlet/MemoryRouter 声明式模式全兼容）；② **删除全部 `future={{ v7_startTransition: true, v7_relativeSplatPath: true }}`**（`src/main.tsx` 的 BrowserRouter + `HomePage.test.tsx`/`HomeToolbar.test.tsx` 两处 MemoryRouter——v7 已默认且不再接受该 prop，保留即报错）；③ 全门（lint/format/typecheck/test 704/build）绿；④ 生产构建 `vite preview` 手工回归深链接 `/WordCraft/settings` 与 `/WordCraft/?/settings` 均正常回退 index.html（`public/404.html` + `index.html` 的 `?/` 还原脚本与路由版本无关，坑 89 约定未受影响）；⑤ `npm audit --omit=dev` **0 vulnerabilities**（v6 线 2 个 moderate 随升级消失）。

### 3.20 用户反馈修复批次（2026-08-13，坑 86-87：卫生间公共语义 + 家具配套补全）

> 用户反馈两件事：① 全屋只有一个卫生间时应默认视为公共卫生间，而不是主卧专属；② 家具摆放应符合常理（书房有书桌就要有椅子，除非用户明确不要；床头柜应在床头两侧等）。两条都遵循「用户明确要求优先，未明确才按常理」。

86. **全屋唯一卫生间被当成"某卧室专属"**（用户反馈，2026-08-13）：`bathroomDoorTargets`（roomGeometry.ts）对无命名归属的卫生间"走廊优先、无走廊时邻居 id 最小"——无走廊的自由布局（custom）里单卫生间同时邻主卧与客厅时，若主卧 id 较小，门只开向主卧 → 卫生间变成主卧专属，其他房间不可用。修复：预扫描增加「**全屋唯一卫生间 → 公共语义**」分支——顶层卫生间计数（**嵌套卫生间不算**：嵌在卧室内的显然是专属）为 1 且无命名归属时，目标优先级改为 **走廊 > 开放空间（客厅/餐厅/厨房，isOpenRoom 且非走廊）> 邻居 id 最小（确定性兜底）**；命名归属（"主卧卫生间"）与多卫生间场景保持原规则不变。回归测试：唯一卫生间邻客厅+主卧 → 门开向客厅；只邻私密房间 → 退化为 id 最小；两个卫生间 → 不特判（旧规则）。⚠️ 判断"唯一"必须只数**顶层房间**——`computeWallPlan` 只对顶层房间调用该预扫描，嵌套卫生间走 `nestedWallPlan` 不经过此规则。
87. **LLM 漏配常配套件（书房有书桌没椅子、卧室有床没床头柜）**（用户反馈，2026-08-13）：提示词第 6 条要求"每类至少配 1-2 件"但依赖 LLM 遵循度。修复：新增 `lib/furnitureCompleteness.ts`——**常配套件补全**（`completeRoomFurniture`，挂进 `applyFurnitureConventions` 的 visitRoom）：书桌/梳妆台 → 使用者侧（背侧反方向 0.6m）补 1 椅；餐桌/圆桌 → 长边/直径两侧补 2 餐椅；床 → 床头两侧补 2 床头柜；沙发 → 前方补 1 茶几。**用户明确不要的通道**：该房间任一家具 `description` 含「不要|不配|不需要|无需|去掉|免配|别放|不加|不设」等词 → 整房间跳过补全（提示词已说明）。**幂等**：已有同类家具不补（`applyFurnitureConventions` 可能跑两轮）。**范围边界**：随 `furnitureConventions` 选项生效——auto 模板（corridor/living）与 v2 快照路径补全，custom 自由布局与手动编辑**不补全**（custom 保留 LLM 显式清单，手动编辑是用户显式操作，都不应被侵入）。补全件用 LLM 给定家具的当前位置推导初始坐标（绝对坐标），最终由摆放流程（贴墙/避让/约束进墙）确定，不保证"紧贴床头"的精确位置（软目标，硬保证是不越界不重叠）。示例模型（走 resolveLayout auto）随之获得 4 件补全（床头柜×2、书桌椅、沙发茶几），`countNodes` 断言 27 → 31 同步更新。

### 3.21 渲染共面 z-fighting 审计批次（2026-08-13 晚，坑 88）

> 用户反馈：示例模型在**墙转角**与**灶台/沙发两侧**仍闪烁（停止移动相机后一段时间才消失——互掐面多为端盖/顶面的细条带，只在特定视角可见，转动相机时最明显）。

88. **转角与家具部件的「端盖/顶面同法向共面」互掐（用户反馈，2026-08-13）**：坑 77 只修了"底面/外侧面"错位，**端盖与顶面**这批漏网——审计发现三类共面对：
   ① **墙转角**：踢脚线/勒脚沿墙线通铺，其**端盖与墙盒端盖同平面**（同法向 + 共面 + 重叠）——每处墙转角三面（墙端盖/踢脚线端盖/勒脚端盖）互掐。修法（ModelNodeView）：踢脚线/勒脚长度两端各内收 2mm（`END_CLEAR`），端盖平面离开墙端平面（2mm 端缝即标准伸缩缝观感）；
   ② **家具部件同高顶面/端盖**（furniturePresets）：沙发**扶手顶面 = 座面顶面**（两侧交接带互掐）+ 扶手/靠背/底座**三底面同落地板** + 靠背端盖 = 底座端盖 + 扶手前脸 = 靠背前脸 + 扶手外端面 = 靠背端盖；灶台**控制条顶面 = 柜体顶面**、**前脸 = 柜体前脸**（正面双条互掐）；浴缸**内胆顶面 = 缸沿**；书架**背板通铺整宽**（端盖 = 侧板端盖、顶/底面 = 侧板顶/底面、背面 = 侧板背面——朝向旋转后 3 处共面）；梳妆镜**底面 = 桌面底面、背面 = 桌面后缘、小桌面时满宽端盖 = 桌面端盖**；床头板/水箱/龙头/电视屏**底面 = 主件底面**。修法：逐一分配错位（顶面低 2cm~5mm、端盖内收 3cm~1cm、底面抬 3~6mm 且相邻底面递增错开、背板/镜面宽度收缝），并**顺带修复灶台炉头整体埋在台面里不可见**（旧 burnerY 在台面内部——topTh 3~5cm 厚、炉头 2cm 高永远被埋；改为底面嵌入 1mm、顶面高出 1.9cm）；
   ③ **回归防线**：`furniturePresets.test.ts` 新增**共面审计**（全种类 × 全档尺寸 × 四朝向，61 用例）——枚举所有 box 部件的 6 个面，断言任意两部件的面不存在「同法向 + 同一平面（1e-7）+ 面内区间重叠（1e-6）」组合；后续改任何部件几何必须过此审计（圆柱跳过）。**教训：改"贴面"几何要自查的不只是底面/侧面，还有端盖与顶面**；坑 6/77 的认知补全为「同法向 + 共面 + 重叠」三要素全查（法向反向不互掐、平面错开 ≥0.5mm 不互掐）。

### 3.22 部署/UX/类型安全批次（2026-08-13，坑 89-92）

> 承接 3.19 批 C 的 D 批遗留项与代码审查建议：深链接 404（HashRouter 替代方案）、原生对话框替换、持久化写入防护、`noUncheckedIndexedAccess`。

89. **GitHub Pages 深链接刷新 404（部署缺陷，2026-08-13）**：`BrowserRouter` + Pages 静态托管没有 SPA 回退——用户直接访问/刷新 `/WordCraft/settings` 返回 404 白屏。采用 **404.html 回退方案**（非 HashRouter，URL 保持 `pathname` 形式）：`public/404.html` 把原始路径编码进查询串重定向到首页（`/WordCraft/?/settings`，`pathSegmentsToKeep=1` 保留仓库名前缀），`index.html` 内联脚本检测 `?/` 前缀后 `history.replaceState` 还原路径给应用路由。⚠️ 两条约定：① 改 `vite.config.ts` 的 `base` 或仓库名时，`pathSegmentsToKeep` 需同步（段数 = 仓库名前缀段数）；② 页面内跳转不受影响（History API），只有"整页刷新/直接输入 URL"走 404.html。
90. **原生 `window.confirm`/`window.alert` 全部替换为应用内对话框（UX/a11y，2026-08-13）**：新增 `components/ui/ConfirmDialog.tsx`（`ConfirmProvider`，挂 `main.tsx` 的 ErrorBoundary 内）+ `components/ui/useConfirm.ts`（hook，独立文件避免 fast-refresh lint 告警）。`useConfirm().confirm()` 返回 `Promise<boolean>`（确定/取消/遮罩/Escape 关闭），`alertMessage()` 为单「好」按钮提示；沿用通用 `Dialog`（焦点陷阱/焦点归还/Escape），`danger` 选项主按钮变红。替换 10 处调用：HomePage 未保存守卫（`confirmDiscardUnsaved` 改 async）+ 打开失败/截图失败提示、useGeneration 生成冲突确认（坑 70 的确认环节保留）、项目库删除、分享历史删除、平面图拆/合失败提示。**测试同步**：原 `vi.spyOn(window, 'confirm')` 断言全部改为「点击对话框按钮」，组件测试需包裹 `<ConfirmProvider>`（渲染 HomePage/ShareDialog/ProjectLibraryDialog 的三处测试已加）。
91. **localStorage 写入失败无防护（配额/隐私模式，2026-08-13）**：zustand persist 每次 `setState` 同步写 localStorage，5MB 配额满/隐私模式禁用时 `setItem` 抛错会中断当前编辑。新增 `lib/safeStorage.ts`（`safeLocalStorage: StateStorage`，读写删全 try/catch，写失败一次性 console.warn），五个 store（settings/chat/model/project/share）persist 全部改走它；`useModelStore` 的 `previewAwareStorage` 内部复用（坑 80 的预览抑制开关不变）。
92. **tsconfig 开启 `noUncheckedIndexedAccess`（类型安全，2026-08-13）**：数组/字符串索引访问变为 `T | undefined`，383 处编译错误全部收敛——源码按语义处理：多边形循环索引（`fp[i]` 等，for 边界保证存在）与 `levels[0]`（v3 schema 保证至少一层）加 `!`，`Dialog` 焦点陷阱首尾元素、`past[last]` 等已有长度守卫处加 `!`；测试文件断言处加 `!`（断言失败即用例红）。**约定：新写索引访问先问"边界是否保证存在"——保证则 `!`，不保证则写守卫**；`levels[0]` 后续若支持多层需改为显式守卫。

### 3.23 生成解析容错链扩充（2026-08-13，坑 93：三室一厅一厨报"JSON 无法解析"）

> 用户反馈：示例一「三室一厅一厨」首次生成报「模型返回的 JSON 无法解析，请重试」。debug 日志显示回复完整（6 房间 corridor macro），但末尾闭合符形态可疑——模型**在完整 JSON 之后多打了一个右括号**（`...}]}}` 之后多余的 `}`）。

93. **`repairTruncatedJson` 只覆盖"截断缺闭合符"，多余闭合符/尾部残留/转义截断全部拒绝修复**（用户反馈，2026-08-13）：坑 42 的修复假定截断形态是"末尾缺几个闭合符"（括号栈非空、字符串已闭合才补全）。真实模型输出还有三种形态：①**多余闭合符**（模型收尾多打 `}`，括号栈空栈 pop → repair 返回 null）；②**尾部残留**（截断后紧跟垃圾字符）；③**双编码 + 截断**（外层引号缺失，`unwrapJsonString` 的 `endsWith('"')` 检查失败，`{...}` 切片仍带 `\"` 转义，parse 与 repair 双双失败）。三种形态全部落到「模型返回的 JSON 无法解析」。修复（chat.ts）：新增 **`tryParseModelJson(json)` 解析容错链**——依次尝试 ①原样 → ②`repairTruncatedJson` 补全 → ③还原双编码（`unescapeDoubleEncodedJson`：`\\"`→`\"`→`"`，只在常规解析失败后调用，正常 JSON 内的 `\"` 是合法字符串内容不能盲解）→ ④还原+补全 → ⑤**尾部修剪**（从后往前取最长可解析前缀，兜底多余闭合符/截断残留）；每级命中记不同 debug 日志（补全/还原/修剪）。`generateModelFromChat` 的解析块改走容错链。回归测试 10 例（单元：raw/repair/unescape/unescape-repair/trim/畸形 null；集成：多打 `}`、双编码截断、尾部垃圾，复现用户场景）。**约定：改生成解析时保持「先解析、失败才还原/修剪」的顺序——合法 JSON 里的 `\"` 不能碰**；字符串中间截断（`{"a":"b`）仍无法安全恢复（坑 42 保守决策保留），属已知边界。

### 3.24 宽松括号修复（2026-08-13，坑 94：坑 93 修后仍报"JSON 无法解析"）

> 坑 93 的容错链上线后，用户重试「三室一厅一厨」仍报错。新 debug 日志尾部为 `...}}]}]}}}`——合法结尾 `...}}]}]}}]}` 被模型写成「**少一个 `]`、多一个 `}`**」（错配闭合符）。

94. **模型收尾"错配闭合符"（`]` 写成 `}` / 多打 `}`）逃过全部既有容错**（用户反馈，2026-08-13）：`repairTruncatedJson` 遇错配闭合符（栈顶 `[` 却收到 `}`）返回 null；`tryParseModelJson` 的尾部修剪只找"合法前缀"，而错配发生在结构内部、`[`(ops 数组) 一直未闭合——不存在任何合法前缀。三路全灭 → 报错。修复（chat.ts）：新增 **`repairLenientJson`（宽松括号修复）**——字符串感知扫描，**跳过错配/多余的闭合符**（栈空或与栈顶不匹配的 `}`/`]` 直接丢弃），结尾再按括号栈补全缺失闭合符（含尾部逗号/空白剔除）；结果仍须通过 `JSON.parse` 才算数（修复后可能是语义截断的 JSON——比报错强，执行器逐条容错兜底）。接入容错链第 ③ 步（原样 → 截断补全 → **宽松修复** → 双编码还原 → 双编码+修复 → 尾部修剪），命中记「模型回复 JSON 含错配/多余闭合符，已宽松修复」。回归测试 7 例（单元：错配修复/多余闭合跳过/缺闭合补全/字符串未闭合拒绝/字符串内括号；链：错配形态 recovery=lenient；集成：`valid.slice(0,-2)+'}'` 复现用户日志形态成功生成）。

### 3.25 2026-08-14 代码审查批次（坑 105-114：重试语义 / 缓存键 / 提交语义 / 契约透传）

> 承接 3.24。坑 95-104（2026-08-13 晚：英文体验补齐、IndexedDB 容错门面、undo↔editOps 一致性、性能与 a11y、工程收尾）未单独入 notes，见 CHANGELOG「Unreleased」。

105. **流中途中断被自动重试（与注释承诺矛盾，重复计费）**（审查发现，2026-08-13）：`streamChatCompletion` 注释写"流中途中断不重试（避免重复计费）"，但 `reader.read()` 抛错被包成普通 `Error`，而 `isRetryableStreamError` 对普通 Error 无条件返回 true——流已产出大半内容（token 已计费）后中断，仍重新发起整次 POST（重复计费 + 界面先看一段内容再被整段替换）。修复（api.ts）：新增 **`StreamInterruptedError` 专属类型**（与 `StreamAbortedError` 并列），`isRetryableStreamError` 对其实返回 false；可重试仅限「连接建立前失败（fetch 抛错）」与 429/5xx（响应头未收到内容）。回归测试断言 fetch 只调用一次。**约定：可重试性必须按「服务端是否可能已产出内容」划分，普通 Error 不能一律可重试**。

106. **墙体内容签名缓存缺房间名 → 重命名房间后陈旧墙体方案**（审查发现，2026-08-13）：`wallPlanContentKey`（roomGeometry.ts）只收录 房间id + 足迹 + 开洞 + 入口参数，但 `computeWallPlan` 的门/墙推导高度依赖房间名（`isCorridorName`/`isOpenRoom`/`isPrivateRoom`/`isBathroomName`/`sharedWallOwner`/`bathroomOwner`、`hasCorridor` 预扫描、入口候选房间筛选）。重命名房间（属性面板/updateRoom）产生新场景引用（WeakMap 必 miss），但内容签名不变 → 命中陈旧单条目缓存，3D 渲染/平面图/点墙放门窗命中三处全部显示旧门墙，直到下次足迹/开洞变化才自愈。修复：签名补 `r.name`（成本可忽略）+ 回归测试（把主卧改成客厅 → 共享墙应为 open、不再命中旧 door）。**教训：内容签名必须覆盖消费函数读取的**全部**字段，名字参与几何推导的模块（roomGeometry）签名里必须有名字**。

107. **家具独立/靠墙词表未双语化**（审查发现，2026-08-13）：英文体验批次（坑 95-104）双语化了 `furniturePresets`/`roomGeometry` 与英文提示词，但 `furniturePlacement.FREE_STANDING_RE` 仍是纯中文——英文 UI 下 "Coffee Table"/"Dining Table"/"Chair"（含配套补全产出的英文名）全部被误当靠墙家具贴到墙上。修复：补英文等价词（coffee/dining/round/side/end/tea table、rug/carpet、chair/stool、bar、island，`\b` 边界防误伤 "armchair"），`isWallAnchored` 补英文用例。

108. **settings migrate 无条件重置 wireframe，用户偏好随每次升级静默丢失**（审查发现，2026-08-13）：`useSettingsStore.migrate` 固定返回 `wireframe: {enabled:false, lineWidth:1}`——注释意图是"v2 起默认关闭"（仅针对 v1 旧数据），但 migrate 对**任何版本差**（v1→v5、v2→v5、v4→v5）都会执行，v2+ 存档里用户显式开启的线框被强制重置。修复：用 zustand 传入的 `version` 参数门控——仅 `version < 2` 强制关，v2+ 保留 `rest.wireframe ?? 默认`。回归测试：v4 存档 enabled:true/lineWidth:3 迁移后保留；v1 存档仍强制关。**教训：migrate 的"历史修正"必须按版本号作用域化，不能作用于所有旧版本**；既有迁移测试恰好都用 enabled:false 造数据掩盖了此问题。

109. **拖拽提交的幽灵历史 + 脏标记单向卡死**（审查发现，2026-08-13）：① `commitDrag`/`commitPlanEdit` 只按**引用**比较 `scene === baseScene`——拖回原位时引用必不同，无条件压入一条"内容完全相同"的撤销条目（撤销一次无视觉变化）；且旧实现若直接保留预览场景，越墙拖拽被约束弹回原位时（内容与拖拽前一致）场景停在未约束位置。② `useDirtyTracking` 订阅只在「干净 → 变化」时置脏一次，拖走再精确拖回已保存位置后 `dirty` 永远卡 true（刷新前误判未保存）。修复（useModelStore）：抽 **`commitEdit`** 统一两个提交点——场景**必收敛为 `normalizeContainment` 后的版本**（预览可能停在越界位置），但 `editDiffToOps` 内容 diff 为空时**不压历史、不追加编辑日志**（返回仅含 scene，不动 past/future、不破坏 redo）；所有离散提交点（commitDrag/commitPlanEdit/applyPlanOps/translateSelected/resetSelectedPosition/updateSelected）调 `syncDirtyWithSaved` 做一次全量比对（与撤销/重做同一机制，高频预览路径不参与）。**约定：拖拽提交的"有无变化"判定必须走内容 diff（editDiffToOps 有 EPSILON 容差），不能靠引用比较；脏标记清除只在离散提交点做全量比对**。

110. **模态对话框打开时全局快捷键仍作用于背后场景**（审查发现，2026-08-13）：`useKeyboardShortcuts` 只排除 INPUT/TEXTAREA 聚焦，未检测 `[role="dialog"]`——确认框弹出时 Ctrl+Z/Ctrl+Y/R/方向键仍撤销模型/复位视角，与对话框按钮语义脱节（键盘用户尤其危险）。修复：`onKey` 开头 `document.querySelector('[role="dialog"]')` 即 return（应用内全部对话框经通用 Dialog 渲染，均带 role="dialog"）。**约定：新增全局快捷键/全局点击处理器时，先问"模态打开时是否应该失效"**。

111. **v2 快照容错路径丢 rotationY/relativeTo（与手写 ops 不等价）**（审查发现，2026-08-13）：`diffFurniture` 不比对 `rotationY`（快照里家具旋转修改静默丢弃，addFurniture 却透传）；`roomSpecFromV2` 与 addRoom diff 不透传 `relativeTo`（仅靠贴靠定位的新房间在 custom 模式下落到原点重叠/东侧兜底——注释明确写"全量透传（历史坑）"唯独漏了它）。修复（executor/diff.ts）：两处补透传 + 回归测试（新房间 relativeTo 贴靠 + 已有家具 rotationY 变化产出 updateFurniture 补丁）。**约定：快照适配器与 ops 契约必须逐字段核对（提示词/类型/op 三层同步），"补 position 时顺带核对同层可选字段"**。

112. **applyOpenings 按过滤后数组下标取边，退化边足迹下开洞落错墙**（审查发现，2026-08-13）：`footprintEdges` 过滤 `length < EPSILON` 的退化边，`applyOpenings` 却 `p.edges[op.edgeIndex]` 直接按下标取值——顶点环含退化边（如重复点）时过滤后数组比环短，`edgeIndex` 错位（环下标 3=北边会取到西边）或越界静默跳过。修复（roomGeometry.ts）：新增 **`edgeByRingIndex`**——沿顶点环按几何匹配（axis/line/start/length 逐一比对，与 `planEdit.ringIndexOf` 互逆），退化边/越界返回 undefined；回归测试构造含退化边的 5 点环。**约定：`Opening.edgeIndex` 的消费方必须从顶点环解析（坑 39），不能直接索引渲染侧过滤后的数组**。

113. **ConfirmProvider 重入悬挂**（审查发现，2026-08-13）：`confirm()`/`alertMessage()` 直接 `setState` 覆盖当前对话框——异步处理链连续触发时前一个 Promise 永不 resolve，调用方 `await` 永久挂起。修复（ConfirmDialog.tsx）：**请求队列化**——`queueRef` + 当前框 ref，关闭后按序弹下一个（setState 只是渲染镜像，出队逻辑放 ref 避免严格模式双调）；Provider 卸载时兜底 resolve(false)。回归测试：同一异步链 confirm→alert→confirm 全部按序拿到结果。

114. **截图竞态：2 rAF 无提交保障 + 重叠调用互相复位**（审查发现，2026-08-13）：`captureScreenshot` 置 `screenshotMode` 后只等 2 个 rAF 就 `toDataURL`——React 18 并发调度不保证两帧内提交（主线程忙时截到带网格/选中框的画面）；连续两次截图时先发请求的 rAF 链会把 mode 复位，后发请求截到已恢复的脏画面。修复（SceneViewer）：`flushSync` 同步提交状态（rAF 留给 WebGL 帧循环绘制）+ **请求序号**（`screenshotSeqRef`，只有最新请求有权复位 mode）。

### 3.26 react-router v7 升级（2026-08-14，坑 115：依赖线 EOL 风险收尾）

115. **react-router v6 线 2 个 Moderate 无修复版本（依赖线 EOL 风险）**（review-followup.md C1 排期落地，2026-08-14）：`npm audit` 报 v6 线 CVE-2025-68470（open redirect）与 GHSA-337j（SSR deserializeErrors）均**无修复**，v6 线已 EOL；本项目 CSR-only 且路由全硬编码实际不可达（非活动漏洞），但审计门长期挂账不是终点。修复：① `react-router-dom` 升 `^7`（v7 起为 `react-router` 的再导出包，本项目 import 全走 react-router-dom，应用代码零改动）；② **删除全部 `future={{ v7_startTransition: true, v7_relativeSplatPath: true }}`**——`src/main.tsx` 的 BrowserRouter 与 `HomePage.test.tsx`/`HomeToolbar.test.tsx` 两处 MemoryRouter（v7 已默认开启且类型上不再接受该 prop，保留即报错）；③ API 兼容确认：项目只用声明式模式（BrowserRouter/Routes/Route/Navigate/NavLink/Link/Outlet），v7 全兼容；④ 全门（lint/format/typecheck/test 704/build）绿 + 生产构建深链接回归（`/WordCraft/settings`、`/WordCraft/?/settings` 均 200 回退 index.html——`public/404.html` + `index.html` 的 `?/` 还原脚本与路由版本无关，坑 89 约定未受影响）；⑤ `npm audit --omit=dev` **0 vulnerabilities**。**教训：依赖线出现"无修复漏洞"时尽早升主版本（v6.22+ 可先行打开 v7 future 标志位，让正式升级退化为纯删代码），拖到 EOL 后 audit 永红且迁移窗口变窄**。

### 3.27 灶台闪烁根因 + 地面材质 + 清理批次（2026-08-14，坑 116-117）

> 用户反馈三件事：① 灶台一部分在移动摄像头时闪烁（停止移动一段时间后消失）——坑 88 修过的老症状复发；② 室外地面"光秃秃、很粗糙"，要求更换材质；③ `docs/ui-preview.html`（早期 UI 视觉稿）确认无用，删除。

116. **灶台炉头「嵌入台面 1mm」在平视掠射角下与台面顶面深度竞争（z-fighting 复现）**（用户反馈，2026-08-14）：坑 88 修灶台时把炉头改为「顶面高出 1.9cm、**底面嵌入台面 1mm**」——这 1mm 嵌入环带（圆柱侧面在台面顶面下方的部分）在**接近水平的视角**（相机高度 ≈ 台面高度）下与台面顶面投影重叠在同一像素带：1mm 垂直差在水平视线下**投影偏移 <1px** 且**几乎不投影到视线深度**（深度差 ≈ 0）——24 位深度缓冲无法区分两个片元，胜负随光栅化抖动 → **移动摄像头时持续闪烁，停止后视角固定、深度胜负稳定才消失**（与坑 88 用户原话"停止移动相机后一段时间才消失"同一机理）。坑 88 的共面审计「**圆柱部件无平面，跳过**」——炉头（cylinder）与台面的近共面不在审计范围，漏网至今。**顺带审计升级发现圆桌（roundTable）中柱底盖与底座底盖同在地板平面（y=0）同法向（朝下）共面**——从正下方看两片元深度相同互掐（用户未报但同类缺陷）。修复（furniturePresets.ts）：① 炉头**整体悬浮台面上方**——底面 +3mm、顶面 +2.3cm（原 +1.9cm）——悬浮使投影偏移 >1px（3mm×1158px/3m ≈ 1.2px），环带与台面顶面无像素重叠、任何视角无深度竞争，正常俯视下 3mm 缝隙不可见；② 圆桌中柱底面抬离地板 1mm——底盖平面离开底座底盖平面，且底盖仍在底座内部（y=0.001 < baseH）任何视角被底座遮挡、永远不可见；③ **共面审计纳入圆柱顶盖/底盖圆面**（disc-disc 圆心距、disc-rect 最近点距离，`furniturePresets.test.ts` 复用既有全种类 × 全档尺寸 × 四朝向矩阵）——今后圆柱部件与任何 box/圆柱的同平面重叠都会被拦截。**教训：①「嵌入/悬浮」量存在 1~2.5mm 的"闪烁带"**——投影偏移 <1px 时嵌入环带与承接面在平视下同像素同深度互掐；要么不嵌入（悬浮 ≥3mm），要么嵌入足够深（≥3mm，投影分离），0.5~2.5mm 区间最危险；**② 共面审计不得跳过圆柱**——顶盖/底盖是平面圆面，与 box 面一样参与互掐。回归：审计 117 用例全绿（含新增 disc 检测路径）。

117. **室外草地"光秃秃、很粗糙"，二轮反馈"像冬天地面、要春天感"（用户反馈，2026-08-14）**：旧 `drawGrass`（materials.ts）只有 1×2px 大颗粒短划 + 纯灰噪声——平铺 2m/张时近看是 1.5×3cm 的块状颗粒（粗糙），远看一片平灰无内容（光秃）。**一轮修复**：重写草地纹理——低频大尺度色差 + 中频柔和起伏 + 高密度细长草叶竖划（1×3~1×5px × 9000）+ 色相微偏（暖/冷）+ 稀疏枯草短划 + 草丛斑块保留。**二轮反馈（同一坑续）**："还是不行，和冬天的地面一样，毫无生机"——根因是 **tint 乘算体系下色相由 GROUND_COLOR 主导**：纹理怎么丰富，乘灰绿 `#a8b795`（饱和度仅 0.19）后整体仍是冬天枯草灰。修复：① **GROUND_COLOR 灰绿 → 春草嫩绿 `#8ec96e`**（饱和度 0.45，乘算后平均色 (102,145,79) 鲜嫩绿）；② 纹理**去枯草**（春天无枯黄）、亮划偏多（阳光草尖）、冷暖色差改为"亮区偏暖黄绿/暗区偏冷蓝绿"（阳光感）；③ **稀疏淡黄小花点缀**（1~2px × 240，纹理 R 通道取 255 上限——乘算 tint 的 R 系数 ~0.56 限制所有像素 R ≤ 142，255 是花点"最亮"的极限）；④ **地平线雾色微调**（米黄 `#e8e3d4` → 淡绿白 `#e7ecd9`，远景不再融入冬日米黄）。**回归防线**：`materials.test.ts` 新增草地测试（mock canvas 渲染纹理 × tint，断言饱和度 >0.35、G 主导、花色点缀 100~2%）——防止未来把草地改回灰绿/枯黄。**教训：程序化纹理 + tint 乘算的视觉结果 = tint 色相 × 纹理明暗，改"观感"要改 tint（色相/饱和度）而不只是纹理细节；纯函数纹理无法直接预览，用 mock canvas 渲染 + 数值断言（饱和度/平均色）做回归防线**。

118. **`docs/ui-preview.html` 删除（清理，2026-08-14）**：2026-08-12 全新 UI 改版用的静态视觉稿（已标注"仅供参考"），改版早已落地、文件与实际实现脱节，用户确认无用。删除文件；design.md/history.md 中"基于 ui-preview.html"的历史表述保留但标注文件已删除（仅历史参考）。

## 6. 快速文件地图

| 需求 | 改哪里 |
|------|--------|
| 生成链路/提示词（ops 契约 + 场景摘要 + 编辑日志 + 快照容错 + **macro.name 容错修复【2026-08-12】**） | `lib/chat.ts`（`buildSystemPrompt`/`buildSceneSummary`/`buildEditOpsLog`/`resolveRawOutput`/`parseOps`/`repairMacroName`） |
| 双向同步（手动编辑 → op 日志）【P3 新增】 | `lib/editOps.ts`（`editDiffToOps`）+ `useModelStore`（提交处记录）+ `useChatStore.editOps`/`toChatHistory` |
| ops 执行器（逐条容错/macro/addRoom 贴靠/家具/开洞/**splitRoom/mergeRoom【P4】**/**房间按名称引用【2026-08-12】**） | `lib/executor/`（2026-08-13 由单文件拆为目录：`index.ts` 门面 + `core.ts` executeOps/applyOp + `rooms.ts` + `furniture.ts` + `openings.ts` + `diff.ts` + `shared.ts`；`findRoom`/`mapRoom` 在 shared）【新增】 |
| 平面图编辑纯函数（网格吸附/正交顶点拖拽/自交校验/墙命中/平移吸附/拆合布局）【P4】 | `lib/planEdit.ts`（`snapToGrid`/`dragVertexFootprint`/`footprintValid`/`hitWallOnEdge`/`snapRoomTranslation`/`splitRoomLayout`/`mergeRoomsLayout`）【新增】 |
| ops 契约类型 | `types/ops.ts`【新增】 |
| ops Zod 校验（判别联合白名单） | `schemas/ops.schema.ts`【新增】 |
| 布局/平铺（**custom 房间 relativeTo 贴靠【2026-08-12】**/**嵌套避让父房间门区【2026-08-12】**/**auto 分支先去首个 normalize【2026-08-12】**） | `lib/layout.ts`（`makeRoom` 导出；`resolveLayout`/`resolveCustom`/`avoidNestedDoorZones`） |
| v3 足迹几何（包围盒/平移/缩放/节点访问器） | `lib/footprint.ts` |
| v1→v3 迁移（项目 JSON/分享口令/持久化） | `lib/migration.ts`（`migrateModel` 幂等纯函数） |
| 家具常理摆放（贴墙/旋转/避门口/避内卫/**迭代滑动【2026-08-12】**） | `lib/furniturePlacement.ts` |
| 门口禁区提取 | `lib/roomGeometry.ts`（`computeDoorZones`/`DOOR_CLEARANCE`） |
| 墙体/门/窗/开放空间（足迹边分段 + 显式开洞覆盖层 + 渲染锚点/段世界区间 + **hasCorridor 门控【2026-08-12】** + **入户门与开洞互让【2026-08-12】**） | `lib/roomGeometry.ts`（`computeWallPlan`/`applyOpenings`/`addEntranceDoor`/`placeEntranceDoorOnEdge`/`footprintEdges`/`edgeOf`/`wallGroupPosition`/`segmentWorldRange`） |
| v2 契约 | `types/model.ts`、`schemas/model.schema.ts` |
| v3 模型类型 | `types/model.ts` |
| 渲染（含 2026-08-12 浅色主题换肤：背景/网格/选中高亮/中性色） | `components/viewport/*`（核心 `ModelNodeView.tsx`：Shape 足迹地板 + 沿边墙段 + window 窗洞；`Viewport3D.tsx` 背景与网格色） |
| 属性面板 UI（**头部可拖动【2026-08-12】**） | `components/viewport/PropertyPanel.tsx`（房间尺寸/坐标经 `nodeDims`/`nodePosition` 派生） |
| 编辑提交/撤销重做（**commitEdit 统一拖拽提交：内容 diff 为空不压历史【2026-08-14 坑 109】**） | `store/useModelStore.ts`（persist migrate）、`lib/modelTree.ts`（normalizeContainment 约束进墙 + 推出嵌套占地**与门口通道**、updateNodeFootprint/removeNode、translateRoomContents 移动带动家具） |
| 状态 | `store/*` |
| 家具部件模型（分类/拼装/包围盒） | `lib/furniturePresets.ts` + `ModelNodeView.tsx`（`FurnitureMesh`） |
| 项目库 UI/保存/守卫 | `ProjectLibraryDialog.tsx` + `HomePage.tsx` + `db/database.ts` + `store/useProjectStore.ts` |
| 2D 平面图（取景/标注） | `lib/planGeometry.ts`（足迹推导包围盒）、`PlanRig.tsx`、`PlanAnnotations.tsx`、`SceneViewer.tsx` |
| 平面图增强（家具足迹/门窗符号/尺寸线 + 尺寸开关）【2026-08-10】 | `PlanEnhancements.tsx` + `lib/planGeometry.ts`（`doorLeafLine`/`doorArcPoints`/`windowHatchLines`/`roomDimLines`）+ `useModelStore.showPlanDims` + `ModelNodeView`（planMode 跳过 3D 家具）+ HomePage 工具栏第二行 |
| 移动房间带动家具【2026-08-10】 | `lib/modelTree.ts`（`translateRoomContents`：足迹 + 家具 + 嵌套递归同量平移；`updateNodePosition`/`updateNodeFields`/`updateNodeFootprint` 纯平移检测） |
| 平面图自由编辑交互层【P4】 | `PlanEditLayer.tsx`（工具手势/命中/拖拽）+ `useModelStore`（`planTool`/`openingKind`/`previewFootprint`/`commitPlanEdit`/`applyPlanOps`）+ HomePage 工具栏 |
| 共享配色（2D/3D 一致，2026-08-12 按浅底重调） | `lib/palette.ts` |
| 房屋造型材质层（纹理/踢脚线/门套/窗框/勒脚/地面/阴影，2026-08-13） | `lib/materials.ts`（程序化纹理 + 材质分类 + `uvMode` 世界米/归一化 UV 双路径 + `getWorldUvTexture`，坑 78）+ `palette.ts`（墙/勒脚/屋顶/地面色 + hex 工具）+ `ModelNodeView.tsx`（墙多材质/踢脚线/门套/窗框/勒脚/地板与家具材质 + 共面错位常量 `BASE_CLEARANCE` 等，坑 77）+ `GroundView.tsx`（草地 + 石板小径对齐门洞）+ `SceneViewer.tsx`（ACES/软阴影/天空/雾/环境反射桥/调光）+ `useSettingsStore`（`shadows` 开关，v5 迁移，坑 79） |
| 材质层写实化与修复（ACES/天空/雾/环境反射/色板/纹理重绘/屋顶移除/共面错位，2026-08-13 晚，坑 77-79） | `SceneViewer.tsx`（ACES + PCFSoft + `<Sky>` + `<fog>` + `EnvironmentBridge` + 重配光 + 动态阴影边界）+ `palette.ts`（外墙近白/屋顶深暖灰/草地灰绿/走廊暖灰褐）+ `materials.ts`（木地板/草地/抹灰 `plasterWall` 重绘 + tint 向暖白 80% + UV 修复）+ `ModelNodeView.tsx`（反射玻璃/基座勒脚/门横杠移除/共面错位）+ `GroundView.tsx`（石板对齐门洞）+ `RoofView.tsx` 删除 + `useSettingsStore`（v5 剔除 `roof`） |
| Gizmo 编辑 | `GizmoControls.tsx` + `SceneViewer.tsx` + `PropertyPanel.tsx` + `useModelStore.ts` |
| 截图分享/口令（**顶栏截图按钮【2026-08-12】**） | `ShareDialog.tsx` + `HomePage.tsx`（`handleScreenshot`）+ `SceneViewer.tsx` + `lib/watermark.ts` + `lib/compression.ts`（`wc3:` 前缀）+ `store/useShareStore.ts` |
| 竖屏横屏引导 + 窄横屏布局【2026-08-10】 | `components/ui/OrientationGuard.tsx`（JS 视口判定：竖屏覆盖层 + `wc-compact` 类）+ `App.tsx`（包裹整棵路由）+ `index.html`（内联脚本首帧预置类）+ `styles/mobile.css`（覆盖层样式 + `.wc-compact` 门控紧凑布局 + 桌面窄窗口降级）；判定阈值共享 `lib/viewport.ts`（`isCompactViewport`/`isPortraitBlocked`，2026-08-13 起与 `hooks/useMobileCompact` 同源）+ `.scene-canvas` `touch-action: none` |
| 全新 UI（顶栏/抽屉/空态/图标）【2026-08-12】 | `components/ui/HomeToolbar.tsx` + `ChatDrawer.tsx` + `EmptyStateCard.tsx` + `icons.tsx` + `components/layout/AppShell.tsx`（无侧边栏）+ `styles/variables.css`（:root 暖色浅色变量，2026-08-13 起样式按域拆分）+ `SettingsPage.tsx`（返回首页入口） |
| 生成竞态防护（场景引用快照 + 冲突确认，坑 70）【2026-08-13】 | `hooks/useGeneration.ts`（`send`：`baseScene` 快照 + `useConfirm` 冲突确认（坑 90 起应用内对话框，非 window.confirm）+ 无 key 不清草稿；2026-08-14 修正文件地图：原标 HomePage 已随坑 C12 拆出） |
| 平面图工具栏（桌面工具行 + 移动端弹出面板）【2026-08-13 从 HomePage 拆出】 | `components/ui/PlanToolbar.tsx`（工具清单 `TOOLS` 单一定义，移动/桌面两分支共用；选择工具即关闭弹出面板） |
| 调试日志面板 / 键盘快捷键 / 紧凑视口判定【2026-08-13 从 HomePage 拆出】 | `components/ui/DebugPanel.tsx`（含 `debugLog.formatDebugText` 复制/下载）+ `hooks/useKeyboardShortcuts.ts`（方向键/R/撤销重做）+ `hooks/useMobileCompact.ts` + `lib/viewport.ts`（与 OrientationGuard 共享阈值） |
| HTTP 请求（fetch 统一 + 连通性检测降级 + **流中途中断不重试 StreamInterruptedError【2026-08-14 坑 105】**）【2026-08-13 移除 axios】 | `lib/api.ts`（`streamChatCompletion`/`testConnection`/`describeHttpError`；`testConnection` 400 时 `max_tokens` → `max_completion_tokens` 重试一次） |
| 样式（按域拆分，@import 顺序 = 层叠顺序）【2026-08-13】 | `styles/*.css`（variables/base/home/toolbar/chat/property/compass/debug/dialog/settings/project/share/plan/mobile/error-boundary；`global.css` 仅 @import 链） |
| 平面几何共享纯函数（重叠判定/房间平移/足迹相等/嵌套落点符号/名称回退查找）【2026-08-13 审查批次】 | `lib/geometry.ts`（`rectsOverlap`/`halfRectOverlaps`/`translateRoom`/`sameFootprint`/`NEST_CORNER`/`NEST_CORNER_ORDER`/`findRoomInList`）【新增】 |
| 跨模块几何/布局常量（单一来源）【2026-08-13 审查批次】 | `lib/constants.ts`（`EPSILON`/`WALL_THICKNESS`/`ADJACENCY_GAP`/`DOOR_CLEARANCE`/`DOOR_WIDTH`/`DEFAULT_HEIGHT`/`ROOM_SPACING`/`DEFAULT_CORRIDOR_WIDTH`；roomGeometry 同名常量改自此再导出）【新增】 |
| 通用对话框（a11y：aria-labelledby/焦点陷阱/Escape/焦点归还）【2026-08-13 审查批次】 | `components/ui/Dialog.tsx`（ShareDialog/ProjectLibraryDialog/HelpDialog 统一使用）【新增】 |
| 对话生成链路 / 项目库脏标记【2026-08-13 审查批次从 HomePage 拆出】 | `hooks/useGeneration.ts`（send/撤销生成/生成计时/竞态防护）+ `hooks/useDirtyTracking.ts`（savedJson 快照比对订阅）+ `store/useProjectStore.ts`（`savedJson`/`commitSavedScene`/`syncDirtyWithSaved`） |
| v3 数据入口结构校验【2026-08-13 审查批次，坑 74】 | `schemas/model.schema.ts`（`sceneModelV3Schema`）+ `lib/migration.ts`（v3 分支校验通过才放行） |
| 应用版本号（状态栏展示）【2026-08-13】 | `vite.config.ts`（define `__APP_VERSION__` ← package.json）+ `src/vite-env.d.ts` 声明 + `HomePage.tsx` 状态栏 |
| 墙体方案共享缓存（坑 72/坑 106：内容签名含**房间名**，重命名房间即失效）【2026-08-13】 | `lib/roomGeometry.ts`（`computeAllWallPlansCached`，WeakMap 按场景引用 + 单条目内容签名）+ `Viewport3D`/`PlanEnhancements`/`lib/planEdit.ts`（`collectWallHitEdges`） |
| 平面图取景依赖包围盒数值（坑 73）【2026-08-13】 | `PlanRig.tsx`（取景 spec 按包围盒数值 memo，effect 依赖 spec 引用） |
| 顶层错误边界【2026-08-13】 | `components/ui/ErrorBoundary.tsx` + `main.tsx`（包裹路由）+ `styles/error-boundary.css`（兜底页）+ i18n `error.boundary*` |
| CI 质量门（lint/format:check/typecheck/test）【2026-08-13】 | `.github/workflows/ci.yml`（PR + main 推送）+ `package.json`（`typecheck` 脚本；format:check 于 2026-08-13 全仓格式收敛后正式入门） |
| i18n | `i18n/translations.ts`（zh 为真源） |
| 拖拽预览抑制持久化（坑 80）【2026-08-13 审查批次后续】 | `useModelStore.ts`（`previewAwareStorage` 存储层开关 + `withoutPersist` 包裹 preview 系列；persist `storage: createJSONStorage`） |
| 对话消息剥离场景快照持久化（坑 81）【2026-08-13 审查批次后续】 | `useChatStore.ts`（partialize/migrate 剥离 `model`，persist 升 v3） |
| addRoom position 契约贯通（坑 82）【2026-08-13 审查批次后续】 | `types/ops.ts` + `schemas/ops.schema.ts`（`addRoom.position`）+ `executor/rooms.ts`（落点优先级 footprint > position > relativeTo > 东侧）+ `executor/diff.ts`（快照路径全字段透传含 rotationY/description）+ `chat.ts` 提示词 |
| setOpenings side 可选（坑 83）【2026-08-13 审查批次后续】 | `types/ops.ts` + `schemas/ops.schema.ts`（side 可选，跨字段约束在执行器）+ `executor/openings.ts`（兜底校验 + 错误消息区分来源）+ `PlanEditLayer.tsx`（删除四处 `as Op`） |
| 地板几何内容签名 memo（坑 84）【2026-08-13 审查批次后续】 | `ModelNodeView.tsx`（`wallPlanKey` WeakMap 内容签名 + `floorShape` useMemo） |
| 工程化（format 门修复/CI build 门/deploy 测试门/three-stdlib/audit）【2026-08-13 审查批次后续】 | `.github/workflows/ci.yml`、`deploy.yml`、`package.json`（`three-stdlib`） |
| 全屋唯一卫生间公共语义（坑 86）【2026-08-13 用户反馈】 | `lib/roomGeometry.ts`（`computeWallPlan` 的 `bathroomDoorTargets` 预扫描：顶层卫生间计数 + 走廊 > 开放空间 > 邻居 id 最小） |
| 家具常配套件补全（坑 87）【2026-08-13 用户反馈】 | `lib/furnitureCompleteness.ts`（`completeRoomFurniture`/`hasExcludedCompleteness`，新模块）+ `furniturePlacement.ts`（visitRoom 接入）+ `chat.ts` 提示词第 6 条（自动补齐说明 + description 排除通道） |
| 渲染共面 z-fighting 审计（坑 88）【2026-08-13 用户反馈】 | `ModelNodeView.tsx`（踢脚线/勒脚端盖内收 `END_CLEAR` 2mm，墙转角不再互掐）+ `lib/furniturePresets.ts`（沙发扶手/靠背/灶台控制条与炉头/浴缸内胆/书架背板/梳妆镜/床头板/水箱/龙头/电视屏逐对错位）+ `furniturePresets.test.ts` 共面审计 61 用例 |
| 深链接 404 回退（坑 89）【2026-08-13】 | `public/404.html`（路径编码进查询串重定向到首页）+ `index.html` 内联脚本（`?/` 前缀 → `history.replaceState` 还原路径）；改 `vite.config.ts` 的 `base`/仓库名时同步 `pathSegmentsToKeep` |
| 应用内确认/提示对话框（坑 90）【2026-08-13】 | `components/ui/ConfirmDialog.tsx`（`ConfirmProvider`，挂 `main.tsx`）+ `components/ui/useConfirm.ts`（`useConfirm()`：`confirm`/`alertMessage`，独立文件避 fast-refresh 告警）+ `styles/dialog.css`（`.dialog__message`）；替换 HomePage/useGeneration/ProjectLibraryDialog/ShareDialog/PlanEditLayer 共 10 处 `window.confirm/alert` |
| localStorage 写入防护（坑 91）【2026-08-13】 | `lib/safeStorage.ts`（`safeLocalStorage: StateStorage`，读写删 try/catch + 一次性 warn）【新增】；五个 store persist 全部改走它（settings/chat/model/project/share），`previewAwareStorage` 复用 |
| `noUncheckedIndexedAccess` 开启（坑 92）【2026-08-13】 | `tsconfig.json`（`noUncheckedIndexedAccess: true`）；源码/测试共 383 处索引访问收敛（循环边界内与长度守卫处加 `!`，schema 保证的 `levels[0]` 加 `!`） |
| 生成解析容错链（坑 93/94）【2026-08-13】 | `lib/chat.ts`（`tryParseModelJson` 容错链：原样 → 截断补全 → `repairLenientJson` 宽松括号修复（错配/多余闭合符跳过，坑 94）→ 还原双编码 → 尾部修剪；`unescapeDoubleEncodedJson` 只在解析失败后调用）+ `chat.test.ts` 17 例回归 |
