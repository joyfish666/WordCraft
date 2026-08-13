import type { StateStorage } from 'zustand/middleware'

let quotaWarned = false

/**
 * localStorage 写失败（超出 5MB 配额 / 隐私模式禁用）时降级为静默丢弃 + 一次性警告，
 * 不打断编辑流程（persist 每次 setState 同步写，抛错会中断当前操作）。
 */
function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (error) {
    if (!quotaWarned) {
      quotaWarned = true
      console.warn('[wordcraft] localStorage 写入失败（可能超出配额），已跳过本次持久化', error)
    }
  }
}

/** 读/写/删全部 try/catch 的安全 localStorage（zustand persist 存储层，替代裸 localStorage） */
export const safeLocalStorage: StateStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: safeSetItem,
  removeItem: (key) => {
    try {
      localStorage.removeItem(key)
    } catch {
      // 清除失败无副作用，静默忽略
    }
  },
}
