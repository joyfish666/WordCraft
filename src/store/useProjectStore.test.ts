import { beforeEach, describe, expect, it } from 'vitest'
import { syncDirtyWithSaved, useProjectStore } from './useProjectStore'

beforeEach(() => {
  localStorage.clear()
  useProjectStore.setState({ currentId: null, currentName: null, dirty: false, savedJson: null })
})

describe('useProjectStore', () => {
  it('setProject 绑定项目并清空脏标记', () => {
    useProjectStore.getState().markDirty()
    useProjectStore.getState().setProject(1, '我的房子')
    expect(useProjectStore.getState().currentId).toBe(1)
    expect(useProjectStore.getState().currentName).toBe('我的房子')
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('clearProject 解绑并清空', () => {
    useProjectStore.getState().setProject(1, '我的房子')
    useProjectStore.getState().markDirty()
    useProjectStore.getState().clearProject()
    expect(useProjectStore.getState().currentId).toBeNull()
    expect(useProjectStore.getState().currentName).toBeNull()
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('markDirty / markSaved 切换脏标记', () => {
    useProjectStore.getState().markDirty()
    expect(useProjectStore.getState().dirty).toBe(true)
    useProjectStore.getState().markSaved()
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('setCurrentName 重命名当前项目但不影响脏标记', () => {
    useProjectStore.getState().setProject(1, '旧名')
    useProjectStore.getState().markDirty()
    useProjectStore.getState().setCurrentName('新名')
    expect(useProjectStore.getState().currentName).toBe('新名')
    expect(useProjectStore.getState().currentId).toBe(1)
    expect(useProjectStore.getState().dirty).toBe(true)
  })

  it('persist 只持久化 currentId/currentName，不持久化 dirty', () => {
    useProjectStore.getState().setProject(7, '持久化测试')
    useProjectStore.getState().markDirty()
    const raw = localStorage.getItem('wordcraft.project') ?? ''
    expect(raw).toContain('"currentId":7')
    expect(raw).toContain('"currentName":"持久化测试"')
    expect(raw).not.toContain('dirty')
    expect(raw).not.toContain('savedJson')
  })

  it('commitSavedScene 记录已保存快照并清空脏标记', () => {
    useProjectStore.getState().markDirty()
    useProjectStore.getState().commitSavedScene('{"version":3}')
    expect(useProjectStore.getState().savedJson).toBe('{"version":3}')
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('clearProject 解绑同时清空已保存快照', () => {
    useProjectStore.getState().setProject(1, '我的房子')
    useProjectStore.getState().commitSavedScene('{"version":3}')
    useProjectStore.getState().clearProject()
    expect(useProjectStore.getState().currentId).toBeNull()
    expect(useProjectStore.getState().savedJson).toBeNull()
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('syncDirtyWithSaved：场景回到已保存快照时清除脏标记', () => {
    useProjectStore.getState().setProject(1, '我的房子')
    useProjectStore.getState().commitSavedScene('{"version":3}')
    useProjectStore.getState().markDirty()
    syncDirtyWithSaved({
      version: 3,
      root: { id: 'h', type: 'house', name: '屋', levels: [] },
    } as never)
    expect(useProjectStore.getState().dirty).toBe(true) // JSON 不一致，保持脏
    syncDirtyWithSaved(JSON.parse('{"version":3}'))
    expect(useProjectStore.getState().dirty).toBe(false) // 回到已保存状态，清除
  })

  it('syncDirtyWithSaved：无项目或未脏时不比对', () => {
    useProjectStore.getState().commitSavedScene('{"version":3}')
    syncDirtyWithSaved(null)
    expect(useProjectStore.getState().dirty).toBe(false)
    // savedJson 为 null 时永不比对相等（clearProject 只清脏、不建快照）
    useProjectStore.getState().clearProject()
    useProjectStore.getState().setProject(1, '我的房子')
    useProjectStore.getState().markDirty()
    syncDirtyWithSaved(JSON.parse('{"version":3}'))
    expect(useProjectStore.getState().dirty).toBe(true)
  })
})
