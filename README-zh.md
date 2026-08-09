# 言筑（WordCraft）

> 纯前端「文生 3D」房屋设计器——用一句话描述你的房子，AI 生成可编辑的 3D 空间模型。

🚀 **在线体验**：<https://joyfish666.github.io/WordCraft/>

- GitHub Pages 部署 · 零后端 · 数据全在本地
- 首次打开可点「加载示例」查看现成户型

📄 [English README](README.md) · [设计方案](docs/design.md) · [技术架构](docs/architecture.md) · [版本演进](docs/history.md) · [开发注意事项](docs/notes.md)

## 核心特性

- 🚀 **文生 3D**：一句话描述需求（如"三室一厅一厨，主卧带卫生间"），大模型输出操作序列（ops），代码逐条确定性执行成 3D 户型，多轮对话只做局部修改
- 🔄 **双向同步**：手动编辑（拖拽/改尺寸）自动记录为操作日志回流对话——AI 始终基于你改过的版本继续，不会被旧快照覆盖
- 🎨 **极简视觉**：线框 + 色块，专注结构与尺寸，无材质光影负担
- 🧭 **方向一致**：世界锚定罗盘 + 右上角投影罗盘；3D 与平面图同向——**上北下南、左西右东**（标准地图方向），东/西/南/北处处一致
- 🔧 **精准编辑**：属性面板（精确数值）+ Gizmo 手柄（直观拖动）双模式，支持撤销/重做；**平面图自由编辑**（拖顶点改形状 / 拖房间 / 点墙放门窗 / 画墙拆房 / 合并房间，全操作可撤销并回流对话）
- 🔒 **隐私优先**：纯前端，对话 / 模型 / API Key 全存本地，Key 自己掌控
- 📤 **便捷分享**：一键生成高清设计图 + 分享口令，粘贴即可还原
- 🌐 **开源协作**：MIT 开源，欢迎贡献

## 快速开始

1. **填 Key**：设置页填入大模型 API Key（默认 DeepSeek，支持 OpenAI 兼容接口）
2. **生成**：首页对话框输入需求 → 生成 3D 模型；可多轮对话修改细节
3. **编辑**：点击 3D 场景中的房间/家具 → 右侧属性面板改尺寸/位置，或选中后用 Gizmo 手柄拖动
4. **看平面图**：左上角「3D / 平面图」一键切换俯视图；平面图模式下用左上工具栏直接编辑（移动/拖顶点/放门窗/拆房/合并）
5. **分享**：工具栏「分享」生成高清设计图 + 口令，对方粘贴口令即可还原

## 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 前端框架 | **React 18** | 组件化开发，生态成熟 |
| 3D 渲染 | **React Three Fiber** | 声明式 Three.js 封装，React 组件构建 3D 场景 |
| 3D 交互 | **@react-three/drei** | OrbitControls（视角）、TransformControls（Gizmo 编辑）等 |
| 状态管理 | **Zustand** | 轻量级全局状态，适合编辑器类应用 |
| 数据验证 | **Zod** | 定义 LLM 输出的 JSON Schema，确保数据结构正确性 |
| 本地存储 | **IndexedDB (Dexie.js)** | 存储大型模型数据和用户配置 |
| 口令压缩 | **lz-string** | 高效的 JSON 数据压缩算法 |
| HTTP 请求 | **Axios** | 处理 API 请求，支持拦截器与错误处理 |
| 构建工具 | **Vite** | 快速的开发构建工具 |
| 测试框架 | **Vitest + Testing Library** | 单元测试与组件测试（343 用例） |

## 项目文档

| 文档 | 内容 |
|------|------|
| [docs/design.md](docs/design.md) | 当前设计方案：v3 架构（操作契约 + 足迹几何 + 双向同步 + 平面图自由编辑，P1/P2/P3/P4 已实施） |
| [docs/architecture.md](docs/architecture.md) | 现行实现的技术架构与数据契约（v3 足迹模型 + ops 操作契约） |
| [docs/history.md](docs/history.md) | 三代架构演进的关键决策记录 |
| [docs/notes.md](docs/notes.md) | 开发注意事项与踩坑记录，改代码前必读 |

## 本地开发

```bash
npm install
npm run dev      # 开发，http://localhost:5173
npm run test     # Vitest 单元测试
npm run lint     # ESLint
npm run build    # 类型检查 + 构建
```

## 路线图

- [ ] **v3 自由设计**：~~P1 数据模型 v3~~（足迹几何 + 迁移 + window 段，✅ 已完成）→ ~~P2 契约动词化~~（操作序列 + 执行器 + 提示词重写，✅ 已完成）→ ~~P3 双向同步~~（编辑日志回流对话 + 上下文精简，✅ 已完成）→ ~~P4 平面图自由编辑~~（拖顶点/拖房间/点墙放门窗/画墙拆房/合并房间，全操作可撤销，✅ 已完成）
- [ ] 移动端基础适配
- [ ] 2D 平面图增强（家具足迹 / 门洞符号 / 尺寸标注）
- [ ] 更多家具种类、性能优化
- [ ] 协作编辑、更多 LLM 接入

## 贡献指南

1. **Fork** 仓库：https://github.com/joyfish666/WordCraft
2. **创建分支**：`git checkout -b feature/amazing-feature`
3. **提交**：`git commit -m 'feat: add amazing feature'`
4. **推送**：`git push origin feature/amazing-feature`
5. **创建 Pull Request**

代码规范：遵循 ESLint + Prettier；确保 `npm test` 全绿。改代码前请先阅读 [开发注意事项](docs/notes.md)。

## 许可证

MIT — 详见 [LICENSE](LICENSE) 文件。

## 联系方式

- 项目主页：https://github.com/joyfish666/WordCraft
- 问题反馈：https://github.com/joyfish666/WordCraft/issues
- 讨论区：https://github.com/joyfish666/WordCraft/discussions
