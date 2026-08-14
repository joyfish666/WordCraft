import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import { createDedupeStorage, safeLocalStorage } from './safeStorage'

interface MemoryBase {
  storage: StateStorage
  setCalls: number
  getCalls: number
  removeCalls: number
  /** 模拟其他标签页/测试直接改写底层内容（不计入 setCalls，只改内容） */
  externalSet: (name: string, value: string) => void
  /** 模拟其他标签页/测试直接清空底层内容（不计入 removeCalls，只改内容） */
  externalRemove: (name: string) => void
}

/** 内存版底层存储：记录调用次数，供断言「去重跳过 / 缓存失效写回」语义 */
function memoryBase(initial: Record<string, string> = {}): MemoryBase {
  const map = new Map(Object.entries(initial))
  const record: MemoryBase = {
    storage: {
      getItem: (name) => {
        record.getCalls += 1
        const v = map.get(name)
        return v === undefined ? null : v
      },
      setItem: (name, value) => {
        record.setCalls += 1
        map.set(name, value)
      },
      removeItem: (name) => {
        record.removeCalls += 1
        map.delete(name)
      },
    },
    setCalls: 0,
    getCalls: 0,
    removeCalls: 0,
    externalSet: (name, value) => map.set(name, value),
    externalRemove: (name) => map.delete(name),
  }
  return record
}

describe('createDedupeStorage（内容去重存储层，坑 80 承重墙）', () => {
  it('写两次相同值：底层只 setItem 一次（去重命中）', () => {
    const base = memoryBase()
    const dedupe = createDedupeStorage(base.storage)
    dedupe.setItem('k', 'v')
    dedupe.setItem('k', 'v')
    expect(base.setCalls).toBe(1)
    expect(base.storage.getItem('k')).toBe('v')
  })

  it('不同键独立去重，相同值互不干扰', () => {
    const base = memoryBase()
    const dedupe = createDedupeStorage(base.storage)
    dedupe.setItem('a', '1')
    dedupe.setItem('b', '1')
    dedupe.setItem('a', '1')
    dedupe.setItem('b', '1')
    expect(base.setCalls).toBe(2)
  })

  it('底层被外部清空（removeItem）后再写相同值 → 缓存失效，真正写回', () => {
    const base = memoryBase()
    const dedupe = createDedupeStorage(base.storage)
    dedupe.setItem('k', 'v')
    base.externalRemove('k') // 绕过 dedupe 直接把底层清空
    dedupe.setItem('k', 'v')
    expect(base.setCalls).toBe(2)
    expect(base.storage.getItem('k')).toBe('v')
  })

  it('底层被外部改写为不同值后再写原值 → 以底层实际内容为准，写回', () => {
    const base = memoryBase()
    const dedupe = createDedupeStorage(base.storage)
    dedupe.setItem('k', 'v')
    base.externalSet('k', 'other') // 外部改写
    dedupe.setItem('k', 'v')
    expect(base.setCalls).toBe(2)
    expect(base.storage.getItem('k')).toBe('v')
  })

  it('底层已有同值但缓存键为空（本会话未写过）时正常写入', () => {
    const base = memoryBase({ k: 'v' })
    const dedupe = createDedupeStorage(base.storage)
    dedupe.setItem('k', 'v')
    expect(base.setCalls).toBe(1)
  })

  it('removeItem 清空缓存：清除后再次写相同值 → 真正写回', () => {
    const base = memoryBase()
    const dedupe = createDedupeStorage(base.storage)
    dedupe.setItem('k', 'v')
    dedupe.removeItem('k')
    expect(base.removeCalls).toBe(1)
    dedupe.setItem('k', 'v')
    expect(base.setCalls).toBe(2)
  })

  it('getItem 直接透传底层（不缓存读取，外部改写立即可见）', () => {
    const base = memoryBase({ k: 'v' })
    const dedupe = createDedupeStorage(base.storage)
    expect(dedupe.getItem('k')).toBe('v')
    base.externalSet('k', 'new')
    expect(dedupe.getItem('k')).toBe('new')
  })

  it('底层 getItem 抛错不阻塞写入（读失败继续走写入路径）', () => {
    const record = { setCalls: 0 }
    const dedupe = createDedupeStorage({
      getItem: () => {
        throw new Error('read fail')
      },
      setItem: () => {
        record.setCalls += 1
      },
      removeItem: () => {},
    })
    expect(() => dedupe.setItem('k', 'v')).not.toThrow()
    expect(record.setCalls).toBe(1)
  })
})

describe('safeLocalStorage（读写删全 try/catch 降级）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('setItem 抛错（配额满/隐私模式）时静默降级 + 一次性警告，不中断调用方', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // jsdom 的 localStorage 方法是 Storage 原型上的绑定方法，spyOn 实例不生效（vitest 静默无效）
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => safeLocalStorage.setItem('k', 'v')).not.toThrow()
    expect(() => safeLocalStorage.setItem('k', 'v2')).not.toThrow()
    // 同一会话只警告一次，不刷屏
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('getItem 抛错时返回 null（不向上抛）', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(safeLocalStorage.getItem('k')).toBeNull()
  })

  it('removeItem 抛错时静默忽略', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => safeLocalStorage.removeItem('k')).not.toThrow()
  })

  it('正常读写删透传 localStorage', () => {
    safeLocalStorage.setItem('k', 'v')
    expect(safeLocalStorage.getItem('k')).toBe('v')
    safeLocalStorage.removeItem('k')
    expect(safeLocalStorage.getItem('k')).toBeNull()
  })
})
