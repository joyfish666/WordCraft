import '@testing-library/jest-dom/vitest'
// jsdom 无原生 IndexedDB，注入 fake-indexeddb 供 Dexie（本地项目库）测试使用
import 'fake-indexeddb/auto'

// 测试环境默认中文界面：jsdom 的 navigator.language 为 en-US，而应用语言默认跟随系统，
// 既有测试断言基于中文文案（按钮/对话框/提示）；英文路径由专门用例显式切换语言覆盖。
Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true })
