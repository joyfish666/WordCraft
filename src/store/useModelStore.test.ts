import { beforeEach, describe, expect, it } from 'vitest'
import { findNodeById } from '../lib/modelTree'
import { createSampleModel } from '../lib/sampleModel'
import { useModelStore } from './useModelStore'

beforeEach(() => {
  localStorage.clear()
  useModelStore.setState({
    scene: null,
    selectedId: null,
    focusId: null,
    stepSize: 0.5,
    initialPositions: {},
  })
})

describe('useModelStore', () => {
  it('setScene 快照各节点初始位置并重置选中/聚焦', () => {
    useModelStore.getState().selectNode('bed-master')
    useModelStore.getState().setFocus('room-master')
    const scene = createSampleModel()
    useModelStore.getState().setScene(scene)
    const state = useModelStore.getState()
    expect(state.selectedId).toBeNull()
    expect(state.focusId).toBeNull()
    expect(state.initialPositions['bed-master']).toEqual(findNodeById(scene.root, 'bed-master')!.position)
  })

  it('translateSelected 按增量移动选中模块', () => {
    useModelStore.getState().setScene(createSampleModel())
    const original = findNodeById(useModelStore.getState().scene!.root, 'bed-master')!.position
    useModelStore.getState().selectNode('bed-master')
    useModelStore.getState().translateSelected(1, 0, -0.5)
    const moved = findNodeById(useModelStore.getState().scene!.root, 'bed-master')!.position
    expect(moved.x).toBe(original.x + 1)
    expect(moved.z).toBe(original.z - 0.5)
    expect(moved.y).toBe(original.y)
  })

  it('未选中模块时移动无效', () => {
    useModelStore.getState().setScene(createSampleModel())
    const scene = useModelStore.getState().scene
    useModelStore.getState().translateSelected(1, 0, 0)
    expect(useModelStore.getState().scene).toBe(scene)
  })

  it('resetSelectedPosition 恢复初始位置', () => {
    useModelStore.getState().setScene(createSampleModel())
    const original = findNodeById(useModelStore.getState().scene!.root, 'bed-master')!.position
    useModelStore.getState().selectNode('bed-master')
    useModelStore.getState().translateSelected(2, 1, 0)
    expect(findNodeById(useModelStore.getState().scene!.root, 'bed-master')!.position.x).not.toBe(
      original.x,
    )
    useModelStore.getState().resetSelectedPosition()
    expect(findNodeById(useModelStore.getState().scene!.root, 'bed-master')!.position).toEqual(
      original,
    )
  })

  it('setFocus / setStepSize 状态可独立设置', () => {
    useModelStore.getState().setFocus('room-master')
    useModelStore.getState().setStepSize(1)
    const state = useModelStore.getState()
    expect(state.focusId).toBe('room-master')
    expect(state.stepSize).toBe(1)
  })
})
