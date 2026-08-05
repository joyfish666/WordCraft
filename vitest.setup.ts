import '@testing-library/jest-dom/vitest'
// jsdom 无原生 IndexedDB，注入 fake-indexeddb 供 Dexie（本地项目库）测试使用
import 'fake-indexeddb/auto'
