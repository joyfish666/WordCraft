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

/**
 * 内容去重存储层：写入内容与上次相同时跳过（zustand persist 在**每次** setState 后都会
 * 序列化并调用 setItem——纯 UI 状态变更（selectNode/planTool 等）的 partialize 结果相同，
 * 全场景 JSON.stringify + 写盘是纯浪费；去重后此类写入零成本）。
 * 跳过前比对底层存储的实际内容：外部清空（测试/其他标签页）后缓存失效仍会正确写回。
 * 注意：仅适合「键→值」内容型存储；若写入语义依赖调用次数（如计数器）则不适用。
 */
export function createDedupeStorage(
  base: Pick<StateStorage, 'getItem' | 'setItem' | 'removeItem'>,
): StateStorage {
  const lastWritten = new Map<string, string>()
  return {
    getItem: (name) => base.getItem(name),
    setItem: (name, value) => {
      // 缓存命中 + 底层内容一致才跳过（读比写便宜一个量级；漏写比多写危害大得多）
      let stored: string | null = null
      try {
        const raw = base.getItem(name)
        stored = typeof raw === 'string' ? raw : null
      } catch {
        // 读失败不阻塞，继续走写入路径
      }
      if (lastWritten.get(name) === value && stored === value) return
      lastWritten.set(name, value)
      base.setItem(name, value)
    },
    removeItem: (name) => {
      lastWritten.delete(name)
      base.removeItem(name)
    },
  }
}
