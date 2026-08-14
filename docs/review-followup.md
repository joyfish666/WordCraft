# 言筑（WordCraft）审查遗留任务交接文档

> 本文件是给后续执行 agent 的**自包含任务清单**（2026-08-14 全面审查 + P0/P1/P2 落地批次之后的遗留项）。
> 完成某项后请同步更新本文档（勾选 + 记录提交号），全部完成后可删除本文件或将剩余项并入 docs/notes.md。
> 配套必读：`docs/notes.md`（踩坑记录，改代码前先读）、`docs/architecture.md`（现行实现）。

## 0. 当前基线（先确认再动手）

- 项目：`C:\Users\wang\Desktop\vscode\wordcraft`，纯前端（React 18 + R3F + zustand + Vite），分支 `main`
- **654 用例全绿（42 个测试文件）**、typecheck/lint/format:check 全过、工作树干净（截至 5 个提交：271d834 → 9d19f10）
- 质量门：`npm run typecheck` / `npm run lint` / `npm run format:check` / `npm test`（Windows 下用 `npm.cmd`）
- 测试基线确认：动手前先跑一次 `npm.cmd test`，确认 654 全绿再开始

### 执行规范（务必遵守，全是踩过的坑）

1. **每项独立提交**，中文提交信息，前缀风格见 `git log`（fix:/refactor:/perf:/test:/docs:），每项提交前跑全门；
2. **不要在测试运行中编辑被测文件**（vitest/esbuild 会管道竞态报 Socket 错）；等后台测试结束再改；
3. **不要用 PowerShell 的 `Set-Content` 写源文件**（破坏 UTF-8/行尾，文件会变无效 UTF-8）——一律用 write/edit 工具；
4. `git core.autocrlf=true`：**`git stash`/`git stash pop` 会把工作树转 CRLF**，导致 `prettier --check` 报大量假阳性——遇到时 `npm.cmd run format` 归一化 + `git add -u` 刷新 stat 缓存即可，内容并未真变（可用 `git hash-object` 对比验证）；
5. 新增/修改用例后**同步文档**：README 双语与 `docs/architecture.md` §9 的测试数、CHANGELOG.md 追加条目；
6. 沙箱提示：若命令被文件沙箱拦截（EPERM），用完整权限重跑同一命令（本会话已获批）。

---

## A 组：测试补缺（低成本高价值，建议先做，约 20 个新用例）

> ✅ 全部完成（2026-08-14，A1 `b8b6d78` / A2 `a77097b` / A3 `ccbd440` / A4 `7bf40e0`，704 用例全绿）

### A1. `safeStorage.createDedupeStorage` 边界单测（新文件 `src/lib/safeStorage.test.ts`）✅ `b8b6d78`

- 现状：`src/lib/safeStorage.ts`（58 行）。`createDedupeStorage`（46-70 行）的注释承诺：「缓存命中 + 底层内容一致才跳过写入；底层被外部清空/改写后应写回」（52-63 行）；`safeLocalStorage`（21-37 行）try/catch 降级。**这些分支零直测**——该存储层是「拖拽预览不写 localStorage」（坑 80）的承重墙，坏一处 = 静默丢数据。
- 补什么：
  - 写两次相同值 → 底层只 `setItem` 一次（去重命中）；
  - 底层被外部 `removeItem` 清空后再写 → 真正写回（缓存失效路径）；
  - 底层被外部改写为不同值后再写 → 写回；
  - `removeItem` 调用清缓存；
  - `safeLocalStorage` 在 `setItem` 抛错时静默降级（用 mock 或注入抛错 storage）。
- 参考：`useModelStore.test.ts` 已间接覆盖落盘，但没覆盖失效路径。

### A2. store persist 迁移（rehydrate）端到端用例 ✅ `a77097b`

- 现状：`useModelStore.test.ts` / `useChatStore.test.ts` 全部用 `setState` 重置，**绕过 persist.migrate**；迁移分支目前只有 `useSettingsStore.test.ts`（69-143 行）端到端覆盖过。
- 补什么（各自 1-2 例）：
  - `useModelStore`（persist version 2，migrate 调 `migrateModel`）：localStorage 写入旧 v1 场景 JSON → `useModelStore.persist.rehydrate()` → 断言迁移为 v3（有 `levels[0].rooms`）；
  - `useChatStore`（persist version 3，migrate 剥离 `model`）：写入 v2 格式（消息带 `model`）→ rehydrate → 断言消息无 `model` 字段。
- 手法参照 `useSettingsStore.test.ts:69-143`（`localStorage.setItem` 造存档 → `rehydrate()` → 断言）；注意两个 store 是单例，`beforeEach` 里 `localStorage.clear()` + `setState` 重置隔离。

### A3. `useDirtyTracking.test.tsx`（`src/hooks/useDirtyTracking.ts`，36 行）✅ `ccbd440`

- 逻辑：① 挂载时若 `currentId !== null && savedJson === null` 以当前场景为基线；② 订阅 `useModelStore` 场景变化，仅「干净 → 变化」时比对一次（`JSON.stringify` vs `savedJson`）；③ 已脏时跳过逐帧比对。
- 补什么（renderHook + 真实 store）：
  - 首帧基线：挂载前设 `currentId` 且无 savedJson → 挂载后 `savedJson` 被填充、不误标脏；
  - 干净 → 场景变化 → dirty=true；
  - 脏后再连续变化 → 不重复比对（可用 spy 计数验证 stringify 次数有限）；
  - 变化后回到 savedJson 内容 → markSaved。
- 注意：subscribe 语义是 `useModelStore.subscribe((state, prev) => ...)`。

### A4. `useMobileCompact.test.tsx`（`src/hooks/useMobileCompact.ts`，15 行）✅ `7bf40e0`

- 逻辑：按 `isCompactViewport`（`lib/viewport.ts`，阈值宽 ≤760 或 高 ≤480）返回布尔，监听 resize。
- 补什么：初始宽视口 false → `Object.defineProperty(window, 'innerWidth', {value: 700})` + `window.dispatchEvent(new Event('resize'))` → true；反方向恢复 false；卸载移除监听。
- 手法参照 `OrientationGuard.test.tsx`（已有同款视口模拟）。

## B 组：页面/组件测试 + 顺手小项

> ✅ 全部完成（2026-08-14，B1 `612be91` / B2 `d543bc9` / B3 `b8e0a34`）

### B1. `SettingsPage.test.tsx`（新文件）——目前唯一零测试的页面 ✅ `612be91`

- 覆盖：API Key 添加（表单提交 → store 增条目 + 首条自动激活）、删除、radio 激活切换、默认 Base URL/模型输入、连通性检测（mock `src/lib/api` 的 `testConnection`：成功/失败文案）、语言跟随系统（切 en）。
- 页面 jsdom 可渲染（无 WebGL 依赖）；注意 `runTest` 是异步（aliveRef 守卫），断言用 `findBy*`。

### B2. 通用组件 a11y 行为测试（`Dialog.test.tsx` 等）✅ `d543bc9`

- `Dialog.tsx`（93 行）：打开聚焦首个可聚焦元素、Tab 焦点陷阱（首尾循环）、Escape 关闭、遮罩点击关闭、关闭焦点归还、滚动锁；**Dialog 用 createPortal 到 document.body**，断言要查 body。
- `Button.tsx` / `Input.tsx`：禁用态、变体类名、onClick 不触发（disabled）。
- 注意 `ConfirmDialog.test.tsx` 已覆盖队列，别重复。

### B3. 顺手两行 ✅ `b8e0a34`

- `README.md:87`（英文 FAQ）：Key 存储描述 "IndexedDB/localStorage" → 只写 "localStorage"（Key 实际只在 localStorage，IndexedDB 是项目库；`README-zh.md` 对应处已正确）；
- `.gitignore` 补一行 `.env*`（当前无 `import.meta.env` 使用，纯防御）。

## C 组：单独排期 / 建议不做

### C1. react-router v6 → v7（⏳ 单独排期，本次未执行）

- 动机：`npm audit` 报 v6 线 2 个 moderate（CVE-2025-68470 open redirect、GHSA-337j SSR deserializeErrors）**无修复**；本项目 CSR-only 且路由全硬编码，实际不可达，属依赖线 EOL 风险非活动漏洞。
- 步骤：
  1. `react-router-dom` 升 `^7`；
  2. **删掉 `src/main.tsx` 的 `future={{ v7_startTransition: true, v7_relativeSplatPath: true }}`**（v7 已默认，保留会报错）；
  3. API 兼容确认（本项目只用 BrowserRouter/Routes/Route/Navigate/NavLink/Link，v7 兼容）；
  4. 全门 + **手工回归深链接**：直接访问/刷新 `/WordCraft/settings` 不 404（`public/404.html` + `index.html` 的 `?/` 还原脚本，v7 相对路径语义变化最可能影响这里）；
  5. 验证 `npm audit --omit=dev` 清零。

### C2. user-event 迁移（试点，不全量）

- 现状：`@testing-library/user-event@^14.5.2` 已装但 **0 处使用**（全套 91 处交互都是 fireEvent）。
- 试点：`ChatDrawer.test.tsx`（Enter/Shift+Enter 语义最重）与 `PropertyPanel.test.tsx` 改 `userEvent.type/click/keyboard`（注意 `await`）。
- 若试点收益不明显或成本失控：**从 package.json devDependencies 移除 user-event**，不做全量迁移。

### C3. 不建议做（已确认不做，原因见下）

- `Compass`/`PlanEditLayer` 组件测试：`CornerCompassSensor` 是 R3F `useFrame` 每帧逻辑、`WorldCompass` 是 drei `<Html>`——jsdom 无 WebGL/Canvas，硬测只能得到「渲染不崩」的低价值断言；可测的纯几何已由 `planGeometry.test.ts`/`planEdit.test.ts` 覆盖。
- `useDirtyTracking`/`useMobileCompact` 之外的 viewport 组件渲染测试同理（`HomePage.test.tsx` 已 mock 掉 SceneViewer，属既定策略）。

---

## 完成检查清单（每项提交前）

- [x] `npm.cmd run typecheck` ✅ `npm run lint` ✅ `npm run format:check` ✅ `npm test`（49 文件全绿，704 用例，2026-08-14）
- [x] 提交信息中文、前缀规范、单提交单主题
- [x] README 双语 + `docs/architecture.md` §9 测试数同步（654 → 704）；CHANGELOG.md 追加条目
- [x] 本文档勾选该项并记提交号（A1 `b8b6d78` / A2 `a77097b` / A3 `ccbd440` / A4 `7bf40e0` / B1 `612be91` / B2 `d543bc9` / B3 `b8e0a34`）

## 关键文件地图（需要时查 docs/notes.md §6 全量版）

| 需求 | 文件 |
|---|---|
| 存储层 dedupe / safeLocalStorage | `src/lib/safeStorage.ts` |
| persist 迁移（version 2/3） | `src/store/useModelStore.ts`（migrate→migrateModel）、`src/store/useChatStore.ts`（剥离 model） |
| 脏标记订阅 | `src/hooks/useDirtyTracking.ts` + `src/store/useProjectStore.ts`（savedJson/commitSavedScene/syncDirtyWithSaved） |
| 紧凑视口判定 | `src/hooks/useMobileCompact.ts` + `src/lib/viewport.ts`（阈值与 OrientationGuard 共享） |
| 设置页 | `src/pages/SettingsPage.tsx`（testConnection 在 `src/lib/api.ts`） |
| 通用对话框 | `src/components/ui/Dialog.tsx`（portal/焦点陷阱） |
| 路由入口 | `src/main.tsx`（future flags）、`public/404.html` + `index.html`（深链接回退） |
| 测试数/文档同步 | README.md / README-zh.md / docs/architecture.md §9 / CHANGELOG.md |
