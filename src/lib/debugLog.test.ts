import { beforeEach, describe, expect, it } from 'vitest'
import { clearDebug, getDebugEntries, logDebug } from './debugLog'
import { useSettingsStore } from '../store/useSettingsStore'

beforeEach(() => {
  clearDebug()
  useSettingsStore.setState({ debugMode: false })
})

describe('debugLog', () => {
  it('调试模式关闭时不记录', () => {
    logDebug('消息')
    expect(getDebugEntries()).toHaveLength(0)
  })

  it('调试模式开启时记录并携带详情', () => {
    useSettingsStore.setState({ debugMode: true })
    logDebug('平铺完成', { rooms: 3 })
    const entries = getDebugEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].message).toBe('平铺完成')
    expect(entries[0].detail).toContain('"rooms": 3')
  })

  it('clearDebug 清空日志', () => {
    useSettingsStore.setState({ debugMode: true })
    logDebug('a')
    clearDebug()
    expect(getDebugEntries()).toHaveLength(0)
  })
})
