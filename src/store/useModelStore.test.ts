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
    gizmoMode: 'translate',
    screenshotMode: false,
    initialPositions: {},
    past: [],
    future: [],
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

  it('updateSelected 更新选中节点字段（名称/尺寸）', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('bed-master')
    useModelStore.getState().updateSelected({ name: '加大床', dimensions: { width: 1.8 } })
    const bed = findNodeById(useModelStore.getState().scene!.root, 'bed-master')!
    expect(bed.name).toBe('加大床')
    // 示例床已旋转为 1.5×2.0，只补 width → 1.8
    expect(bed.dimensions).toEqual({ length: 1.5, width: 1.8, height: 0.5 })
  })

  it('updateSelected 提交后把越墙字段约束进墙内', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('bed-master')
    // 床已旋转（半宽 0.75），主卧内缩后可活动 X ∈ [-1.6, 1.1]；-2 出界 → 拉到 -1.6
    useModelStore.getState().updateSelected({ position: { x: -2 } })
    const bed = findNodeById(useModelStore.getState().scene!.root, 'bed-master')!
    expect(bed.position.x).toBe(-1.6)
  })

  it('undo / redo 回退与重做编辑', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('bed-master')
    // 床已旋转（Z 半宽 1.0），可活动范围 [2.0, 3.7]，取 2.5 在界内
    useModelStore.getState().updateSelected({ position: { z: 2.5 } })
    expect(findNodeById(useModelStore.getState().scene!.root, 'bed-master')!.position.z).toBe(2.5)
    useModelStore.getState().undo()
    // 撤销回到床的原始位置（现贴北墙 z=2.0）
    expect(findNodeById(useModelStore.getState().scene!.root, 'bed-master')!.position.z).toBeCloseTo(2, 5)
    useModelStore.getState().redo()
    expect(findNodeById(useModelStore.getState().scene!.root, 'bed-master')!.position.z).toBe(2.5)
  })

  it('translateSelected / resetSelectedPosition 每次调用记入历史', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('bed-master')
    const originalX = findNodeById(useModelStore.getState().scene!.root, 'bed-master')!.position.x
    useModelStore.getState().translateSelected(1, 0, 0)
    useModelStore.getState().translateSelected(1, 0, 0)
    useModelStore.getState().undo()
    expect(findNodeById(useModelStore.getState().scene!.root, 'bed-master')!.position.x).toBe(originalX + 1)
    useModelStore.getState().resetSelectedPosition()
    useModelStore.getState().undo()
    expect(findNodeById(useModelStore.getState().scene!.root, 'bed-master')!.position.x).toBe(originalX + 1)
  })

  it('新编辑使重做历史失效；setScene 载入新模型清空历史', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('bed-master')
    useModelStore.getState().translateSelected(1, 0, 0)
    useModelStore.getState().undo()
    expect(useModelStore.getState().future.length).toBe(1)
    useModelStore.getState().translateSelected(-1, 0, 0) // 新编辑清空 future
    expect(useModelStore.getState().future.length).toBe(0)
    expect(useModelStore.getState().past.length).toBeGreaterThan(0)
    useModelStore.getState().setScene(createSampleModel())
    expect(useModelStore.getState().past.length).toBe(0)
    expect(useModelStore.getState().future.length).toBe(0)
  })

  it('空补丁不产生历史记录', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('bed-master')
    useModelStore.getState().updateSelected({})
    expect(useModelStore.getState().past.length).toBe(0)
  })

  it('gizmoMode / screenshotMode 可独立设置（会话内不持久化）', () => {
    useModelStore.getState().setGizmoMode('scale')
    useModelStore.getState().setScreenshotMode(true)
    expect(useModelStore.getState().gizmoMode).toBe('scale')
    expect(useModelStore.getState().screenshotMode).toBe(true)
  })

  it('previewSelected 实时预览不记历史、不约束', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('bed-master')
    // 把床移到界外（越墙）
    useModelStore.getState().previewSelected({ position: { x: -2 } })
    const bed = findNodeById(useModelStore.getState().scene!.root, 'bed-master')!
    expect(bed.position.x).toBe(-2) // 拖拽中不约束
    expect(useModelStore.getState().past.length).toBe(0) // 不记历史
  })

  it('previewSelected 未选中 / 空补丁不产生新场景', () => {
    useModelStore.getState().setScene(createSampleModel())
    const scene = useModelStore.getState().scene
    useModelStore.getState().previewSelected({})
    expect(useModelStore.getState().scene).toBe(scene)
    useModelStore.getState().selectNode(null)
    useModelStore.getState().previewSelected({ position: { x: 1 } })
    expect(useModelStore.getState().scene).toBe(scene)
  })

  it('commitDrag 记录一次历史并把越墙预览约束回墙内', () => {
    useModelStore.getState().setScene(createSampleModel())
    const base = useModelStore.getState().scene
    useModelStore.getState().selectNode('bed-master')
    useModelStore.getState().previewSelected({ position: { x: -2 } }) // 越墙
    useModelStore.getState().commitDrag(base)
    const bed = findNodeById(useModelStore.getState().scene!.root, 'bed-master')!
    // 床已旋转（半宽 0.75），主卧可活动 X ∈ [-1.6, 1.1]；-2 → 拉回 -1.6
    expect(bed.position.x).toBe(-1.6)
    expect(useModelStore.getState().past.length).toBe(1)
    // 撤销回到拖拽前
    useModelStore.getState().undo()
    expect(findNodeById(useModelStore.getState().scene!.root, 'bed-master')!.position.x).toBe(
      findNodeById(base!.root, 'bed-master')!.position.x,
    )
  })

  it('commitDrag 无变化时不记历史', () => {
    useModelStore.getState().setScene(createSampleModel())
    const base = useModelStore.getState().scene
    useModelStore.getState().selectNode('bed-master')
    useModelStore.getState().commitDrag(base)
    expect(useModelStore.getState().past.length).toBe(0)
  })
})
