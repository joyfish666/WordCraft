# 言筑（WordCraft）

> 纯前端「文生 3D」房屋设计器——用一句话描述你的房子，AI 生成可编辑的 3D 空间模型。

🚀 **在线体验**：https://joyfish666.github.io/WordCraft/（GitHub Pages · 零后端 · 数据全在本地，随推送自动更新）

📄 [English README](README.md) · [技术架构](docs/architecture.md) · [项目交接](docs/handoff.md)

## 核心特性

- 🚀 **文生 3D**：一句话描述需求（如"三室一厅一厨，主卧带卫生间"），大模型输出语义契约，代码确定性平铺成 3D 户型
- 🎨 **极简视觉**：线框 + 色块，专注结构与尺寸，无材质光影负担
- 🔧 **精准编辑**：属性面板（精确数值）+ Gizmo 手柄（直观拖动）双模式，支持撤销/重做
- 🔒 **隐私优先**：纯前端，对话 / 模型 / API Key 全存本地，Key 自己掌控
- 📤 **便捷分享**：一键生成高清设计图 + 分享口令，粘贴即可还原
- 🌐 **开源协作**：MIT 开源，欢迎贡献

## 快速开始

1. **填 Key**：设置页填入大模型 API Key（默认 DeepSeek，支持 OpenAI 兼容接口）
2. **生成**：首页对话框输入需求 → 生成 3D 模型；可多轮对话修改细节
3. **编辑**：点击 3D 场景中的房间/家具 → 右侧属性面板改尺寸/位置，或选中后用 Gizmo 手柄拖动
4. **看平面图**：左上角「3D / 平面图」一键切换俯视图
5. **分享**：工具栏「分享」生成高清设计图 + 口令，对方粘贴口令即可还原

> 首次使用可点「加载示例」查看现成户型。

## 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 前端框架 | **React 18** | 组件化开发，生态成熟，适合开源项目 |
| 3D 渲染 | **React Three Fiber** | 声明式 Three.js 封装，React 组件构建 3D 场景 |
| 3D 交互 | **@react-three/drei** | OrbitControls（视角）、TransformControls（Gizmo 编辑）等实用组件 |
| 状态管理 | **Zustand** | 轻量级状态管理，适合编辑器类应用的全局状态 |
| 数据验证 | **Zod** | 定义 LLM 输出的 JSON Schema，确保数据结构正确性 |
| 本地存储 | **IndexedDB (Dexie.js)** | 存储大型模型数据和用户配置 |
| 口令压缩 | **lz-string** | 高效的 JSON 数据压缩算法 |
| HTTP 请求 | **Axios** | 处理 API 请求，支持拦截器与错误处理 |
| 构建工具 | **Vite** | 快速的开发构建工具 |
| 测试框架 | **Vitest + Testing Library** | 单元测试与组件测试（190 用例） |

## 当前实现进度

- **v1.4.0** 家具部件模型（13 类家具按名称拼装、朝向跟随墙）· 走廊布局两侧自动均衡 · 入口房间保留 · 家具完整性提示
- **v1.3.0** 真·内嵌嵌套房间 · Gizmo 辅助编辑 · 截图分享 + 口令
- **v1.2.0** 中英双语切换
- **v1.1.0** 本地项目库 · 2D 俯视平面图
- **v1.0.0** 对话生成 · 属性面板编辑 · 撤销/重做 · GitHub Pages 部署

## 路线图

- [ ] 移动端基础适配
- [ ] 2D 平面图增强（家具足迹 / 门洞符号 / 尺寸标注）
- [ ] 性能优化、更多家具种类
- [ ] 协作编辑、更多 LLM 接入

## 贡献指南

1. **Fork** 仓库：https://github.com/joyfish666/WordCraft
2. **创建分支**：`git checkout -b feature/amazing-feature`
3. **提交**：`git commit -m 'feat: add amazing feature'`
4. **推送**：`git push origin feature/amazing-feature`
5. **创建 Pull Request**

代码规范：遵循 ESLint + Prettier；确保 `npm test` 全绿。

## 许可证

MIT — 详见 [LICENSE](LICENSE) 文件。

## 联系方式

- 项目主页：https://github.com/joyfish666/WordCraft
- 问题反馈：https://github.com/joyfish666/WordCraft/issues
- 讨论区：https://github.com/joyfish666/WordCraft/discussions

---

**最后更新**：2026-08-07 · **维护者**：JoyFish
