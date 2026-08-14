import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSampleModel } from '../lib/sampleModel'
import { useChatStore } from '../store/useChatStore'
import { useModelStore } from '../store/useModelStore'
import { useProjectStore } from '../store/useProjectStore'
import { useDirtyTracking } from './useDirtyTracking'

/**
 * useDirtyTracking 单元测试（坑 75 收敛后的语义）：
 * - 首帧基线：挂载时已有项目但无 savedJson → 以当前场景为基线，不误标脏；
 * - 干净 → 场景变化 → 置脏一次；脏后连续变化不重复比对（高频预览路径零 stringify）；
 * - 变化后回到已保存内容 → 清除脏标记（离散提交点的 syncDirtyWithSaved 全量比对）。
 * 全部通过真实 store + renderHook 断言，不 mock 订阅。
 */

function resetStores() {
  localStorage.clear()
  useChatStore.setState({ messages: [], isGenerating: false, generationStack: [], editOps: [] })
  useModelStore.setState({
    scene: null,
    selectedId: null,
    focusId: null,
    stepSize: 0.5,
    gizmoMode: 'translate',
    planTool: 'select',
    openingKind: 'door',
    showPlanDims: true,
    screenshotMode: false,
    initialPositions: {},
    past: [],
    future: [],
  })
  useProjectStore.setState({ currentId: null, currentName: null, dirty: false, savedJson: null })
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  cleanup()
})

describe('useDirtyTracking', () => {
  it('挂载时已有项目但无快照 → 以当前场景为基线，不误标脏', () => {
    const scene = createSampleModel()
    useModelStore.getState().setScene(scene)
    useProjectStore.setState({ currentId: 1, currentName: '旧项目', dirty: false, savedJson: null })
    renderHook(() => useDirtyTracking(useModelStore.getState().scene))
    const ps = useProjectStore.getState()
    expect(ps.savedJson).toBe(JSON.stringify(scene))
    expect(ps.dirty).toBe(false)
  })

  it('干净 → 场景变化 → 置脏', () => {
    const scene = createSampleModel()
    useModelStore.getState().setScene(scene)
    useProjectStore.setState({
      currentId: 1,
      currentName: '旧项目',
      dirty: false,
      savedJson: JSON.stringify(scene),
    })
    renderHook(() => useDirtyTracking(useModelStore.getState().scene))
    useModelStore.getState().selectNode('sofa-living')
    useModelStore.getState().translateSelected(1, 0, 0)
    expect(useProjectStore.getState().dirty).toBe(true)
    // savedJson 保持「已保存」快照，不被脏场景覆盖
    expect(useProjectStore.getState().savedJson).toBe(JSON.stringify(scene))
  })

  it('脏后再连续变化不重复比对（只置脏一次，坑 75 语义）', () => {
    const scene = createSampleModel()
    useModelStore.getState().setScene(scene)
    useProjectStore.setState({
      currentId: 1,
      currentName: '旧项目',
      dirty: false,
      savedJson: JSON.stringify(scene),
    })
    renderHook(() => useDirtyTracking(useModelStore.getState().scene))
    useModelStore.getState().selectNode('sofa-living')
    // spyOn 默认保留原行为：markDirty 仍会置脏，同时可计数调用次数
    const markDirtySpy = vi.spyOn(useProjectStore.getState(), 'markDirty')
    // 第一次变化（干净 → 脏）：订阅做一次全量比对 → 置脏
    useModelStore.getState().translateSelected(1, 0, 0)
    expect(markDirtySpy).toHaveBeenCalledTimes(1)
    expect(useProjectStore.getState().dirty).toBe(true)
    // 脏后再变化：订阅跳过比对（不再次调用 markDirty）
    useModelStore.getState().previewSelected({ position: { x: 2 } })
    expect(markDirtySpy).toHaveBeenCalledTimes(1)
    expect(useProjectStore.getState().dirty).toBe(true)
    markDirtySpy.mockRestore()
  })

  it('变化后回到 savedJson 内容 → 清除脏标记（离散提交点全量比对）', () => {
    const scene = createSampleModel()
    useModelStore.getState().setScene(scene)
    useProjectStore.setState({
      currentId: 1,
      currentName: '旧项目',
      dirty: false,
      savedJson: JSON.stringify(scene),
    })
    renderHook(() => useDirtyTracking(useModelStore.getState().scene))
    useModelStore.getState().selectNode('sofa-living')
    useModelStore.getState().translateSelected(1, 0, 0)
    expect(useProjectStore.getState().dirty).toBe(true)
    // 精确移回原位 → 内容与已保存快照一致 → 清脏
    useModelStore.getState().translateSelected(-1, 0, 0)
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('游离新场景（无项目）变化不置脏、不建基线', () => {
    const scene = createSampleModel()
    useModelStore.getState().setScene(scene)
    renderHook(() => useDirtyTracking(useModelStore.getState().scene))
    useModelStore.getState().selectNode('sofa-living')
    useModelStore.getState().translateSelected(1, 0, 0)
    expect(useProjectStore.getState().dirty).toBe(false)
    expect(useProjectStore.getState().savedJson).toBeNull()
  })
})
