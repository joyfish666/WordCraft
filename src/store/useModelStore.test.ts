import { beforeEach, describe, expect, it } from 'vitest'
import { footprintBounds } from '../lib/footprint'
import { findNodeById } from '../lib/modelTree'
import { createSampleModel } from '../lib/sampleModel'
import { useChatStore } from './useChatStore'
import { useModelStore } from './useModelStore'
import type { FurnitureNode, ModelNode, RoomNode } from '../types/model'

/** 从当前 store 场景取家具节点（测试断言目标均为家具） */
function furnitureById(id: string): FurnitureNode {
  const n = findNodeById(useModelStore.getState().scene!.root, id) as ModelNode | null
  if (!n || n.type !== 'furniture') throw new Error(`expect furniture: ${id}`)
  return n
}

beforeEach(() => {
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
    expect(state.initialPositions['bed-master']).toEqual(furnitureById('bed-master').position)
  })

  it('translateSelected 按增量移动选中模块', () => {
    useModelStore.getState().setScene(createSampleModel())
    const original = furnitureById('bed-master').position
    useModelStore.getState().selectNode('bed-master')
    useModelStore.getState().translateSelected(1, 0, -0.5)
    const moved = furnitureById('bed-master').position
    expect(moved.x).toBe(original.x + 1)
    expect(moved.z).toBe(original.z - 0.5)
    expect(moved.y).toBe(original.y)
  })

  it('拖拽预览不写 localStorage；提交类操作写回（坑 75 姊妹：预览每帧全场景序列化）', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('bed-master')
    // 提交类操作（translateSelected）→ 持久化
    useModelStore.getState().translateSelected(0.5, 0, 0)
    const committed = furnitureById('bed-master').position
    const persisted = (
      JSON.parse(localStorage.getItem('wordcraft.model')!).state as {
        scene: { root: { name: string } }
      }
    ).scene
    expect(persisted.root.name).toBe(useModelStore.getState().scene!.root.name)
    // 预览操作（previewSelected）→ 内存更新但 localStorage 保持提交时的场景不变
    const sceneBefore = useModelStore.getState().scene
    useModelStore.getState().previewSelected({
      position: { x: committed.x + 2, y: committed.y, z: committed.z },
    })
    expect(useModelStore.getState().scene).not.toBe(sceneBefore) // 内存已更新（预览生效）
    const persistedAfter = JSON.parse(localStorage.getItem('wordcraft.model')!).state
    expect(JSON.stringify(persistedAfter)).toBe(JSON.stringify({ scene: persisted }))
    // 提交（commitDrag）后恢复持久化
    useModelStore.getState().commitDrag(sceneBefore)
    const persistedCommit = JSON.parse(localStorage.getItem('wordcraft.model')!).state.scene
    expect(persistedCommit.root.name).toBe(useModelStore.getState().scene!.root.name)
  })

  it('未选中模块时移动无效', () => {
    useModelStore.getState().setScene(createSampleModel())
    const scene = useModelStore.getState().scene
    useModelStore.getState().translateSelected(1, 0, 0)
    expect(useModelStore.getState().scene).toBe(scene)
  })

  it('resetSelectedPosition 恢复初始位置', () => {
    useModelStore.getState().setScene(createSampleModel())
    const original = furnitureById('bed-master').position
    useModelStore.getState().selectNode('bed-master')
    useModelStore.getState().translateSelected(2, 1, 0)
    expect(furnitureById('bed-master').position.x).not.toBe(original.x)
    useModelStore.getState().resetSelectedPosition()
    expect(furnitureById('bed-master').position).toEqual(original)
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
    const bed = furnitureById('bed-master')
    expect(bed.name).toBe('加大床')
    // 示例床已旋转为 1.5×2.0，只补 width → 1.8
    expect(bed.dimensions).toEqual({ length: 1.5, width: 1.8, height: 0.5 })
  })

  it('updateSelected 提交后把越墙字段约束进墙内', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('bed-master')
    // 床已旋转（半宽 0.75）；-2 出界 → 拉回墙内，且不压嵌套卫生间占地（坑 47）
    useModelStore.getState().updateSelected({ position: { x: -2 } })
    const bed = furnitureById('bed-master')
    expect(bed.position.x).toBeGreaterThanOrEqual(-1.6)
    expect(bed.position.x).toBeLessThanOrEqual(1.1)
    const bath = findNodeById(useModelStore.getState().scene!.root, 'bath-master') as RoomNode
    const kb = footprintBounds(bath.footprint)
    const overlapsBath =
      bed.position.x + bed.dimensions.length / 2 > kb.minX + 1e-6 &&
      bed.position.x - bed.dimensions.length / 2 < kb.maxX - 1e-6 &&
      bed.position.z + bed.dimensions.width / 2 > kb.minZ + 1e-6 &&
      bed.position.z - bed.dimensions.width / 2 < kb.maxZ - 1e-6
    expect(overlapsBath).toBe(false)
  })

  it('undo / redo 回退与重做编辑', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('bed-master')
    // 床已旋转（Z 半宽 1.0），可活动范围 [2.0, 3.7]，取 2.5 在界内
    useModelStore.getState().updateSelected({ position: { z: 2.5 } })
    expect(furnitureById('bed-master').position.z).toBe(2.5)
    useModelStore.getState().undo()
    // 撤销回到床的原始位置（现贴北墙 z=2.0）
    expect(furnitureById('bed-master').position.z).toBeCloseTo(2, 5)
    useModelStore.getState().redo()
    expect(furnitureById('bed-master').position.z).toBe(2.5)
  })

  it('translateSelected / resetSelectedPosition 每次调用记入历史', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('bed-master')
    const originalX = furnitureById('bed-master').position.x
    useModelStore.getState().translateSelected(1, 0, 0)
    useModelStore.getState().translateSelected(1, 0, 0)
    useModelStore.getState().undo()
    expect(furnitureById('bed-master').position.x).toBe(originalX + 1)
    useModelStore.getState().resetSelectedPosition()
    useModelStore.getState().undo()
    expect(furnitureById('bed-master').position.x).toBe(originalX + 1)
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
    const bed = furnitureById('bed-master')
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

  it('commitDrag 把越墙预览约束回墙内；约束弹回原位时不压幽灵历史', () => {
    useModelStore.getState().setScene(createSampleModel())
    const base = useModelStore.getState().scene
    useModelStore.getState().selectNode('bed-master')
    useModelStore.getState().previewSelected({ position: { x: -2 } }) // 越墙
    useModelStore.getState().commitDrag(base)
    const bed = furnitureById('bed-master')
    // 拉回墙内（床半宽 0.75），且不压嵌套卫生间占地（坑 47）
    expect(bed.position.x).toBeGreaterThanOrEqual(-1.6)
    expect(bed.position.x).toBeLessThanOrEqual(1.1)
    const bath = findNodeById(useModelStore.getState().scene!.root, 'bath-master') as RoomNode
    const kb = footprintBounds(bath.footprint)
    const overlapsBath =
      bed.position.x + bed.dimensions.length / 2 > kb.minX + 1e-6 &&
      bed.position.x - bed.dimensions.length / 2 < kb.maxX - 1e-6 &&
      bed.position.z + bed.dimensions.width / 2 > kb.minZ + 1e-6 &&
      bed.position.z - bed.dimensions.width / 2 < kb.maxZ - 1e-6
    expect(overlapsBath).toBe(false)
    // 越墙拖拽被约束后恰好弹回原位（内容与拖拽前一致）→ 不压历史（消除幽灵撤销条目）
    expect(useModelStore.getState().past.length).toBe(0)
    // 床回到拖拽前位置（约束计算会引入 ~1e-16 浮点噪声，按容差断言）
    const original = (findNodeById(base!.root, 'bed-master') as FurnitureNode).position.x
    expect(Math.abs(bed.position.x - original)).toBeLessThan(1e-6)
    // 把床拖到墙内另一位置 → 有实际变化才记历史（x=1 在墙内且不在嵌套卫生间占地）
    useModelStore.getState().previewSelected({ position: { x: 1 } })
    useModelStore.getState().commitDrag(base)
    expect(useModelStore.getState().past.length).toBe(1)
    // 撤销回到拖拽前
    useModelStore.getState().undo()
    expect(furnitureById('bed-master').position.x).toBe(
      (findNodeById(base!.root, 'bed-master') as FurnitureNode).position.x,
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

describe('useModelStore 手动编辑 → 编辑操作日志（P3 双向同步）', () => {
  it('translateSelected 移动家具时记录 updateFurniture op', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('sofa-living')
    useModelStore.getState().translateSelected(1, 0, 0)
    const ops = useChatStore.getState().editOps
    expect(ops).toHaveLength(1)
    const op = ops[0]!
    expect(op.op).toBe('updateFurniture')
    if (op.op !== 'updateFurniture') return
    expect(op.id).toBe('sofa-living')
    expect(op.roomId).toBe('room-living')
    expect(op.patch.position).toBeDefined()
  })

  it('移动房间时记录 updateRoom footprint op', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('room-living')
    useModelStore.getState().translateSelected(2, 0, 0)
    const ops = useChatStore.getState().editOps
    expect(ops).toHaveLength(1)
    const op = ops[0]!
    expect(op.op).toBe('updateRoom')
    if (op.op !== 'updateRoom') return
    expect(op.id).toBe('room-living')
    expect(op.patch.footprint).toHaveLength(4)
  })

  it('resetSelectedPosition 也记录 op（复位属于一次编辑）', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('sofa-living')
    useModelStore.getState().translateSelected(1, 0, 0)
    useModelStore.getState().resetSelectedPosition()
    expect(useChatStore.getState().editOps).toHaveLength(2)
  })

  it('updateSelected 改名/改尺寸记录对应 op', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('wardrobe-master')
    useModelStore.getState().updateSelected({ name: '大衣柜', dimensions: { width: 0.8 } })
    const ops = useChatStore.getState().editOps
    expect(ops).toHaveLength(1)
    const op = ops[0]!
    expect(op.op).toBe('updateFurniture')
    if (op.op !== 'updateFurniture') return
    expect(op.patch.name).toBe('大衣柜')
    // patch 携带编辑后的全量尺寸（编辑前的长宽可能已交换/旋转，以实际状态为准）
    expect(op.patch.dimensions).toEqual(furnitureById('wardrobe-master').dimensions)
    expect(op.patch.dimensions!.width).toBe(0.8)
  })

  it('空补丁不记录 op', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('bed-master')
    useModelStore.getState().updateSelected({})
    expect(useChatStore.getState().editOps).toHaveLength(0)
  })

  it('commitDrag 把整次拖拽记为一条 op', () => {
    useModelStore.getState().setScene(createSampleModel())
    const base = useModelStore.getState().scene
    useModelStore.getState().selectNode('bed-master')
    useModelStore.getState().previewSelected({ position: { z: 2.5 } })
    useModelStore.getState().commitDrag(base)
    expect(useChatStore.getState().editOps).toHaveLength(1)
    const op = useChatStore.getState().editOps[0]!
    expect(op.op).toBe('updateFurniture')
  })

  it('setScene 载入新场景时清空编辑日志（旧日志描述的是已替换的场景）', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('sofa-living')
    useModelStore.getState().translateSelected(1, 0, 0)
    expect(useChatStore.getState().editOps).toHaveLength(1)
    useModelStore.getState().setScene(createSampleModel())
    expect(useChatStore.getState().editOps).toHaveLength(0)
  })

  it('resetScene 清空编辑日志', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().selectNode('sofa-living')
    useModelStore.getState().translateSelected(1, 0, 0)
    useModelStore.getState().resetScene()
    expect(useChatStore.getState().editOps).toHaveLength(0)
  })
})

describe('useModelStore 平面图编辑（P4）', () => {
  it('planTool 会话内可切换；setScene 载入新场景复位为 select', () => {
    useModelStore.getState().setPlanTool('vertex')
    expect(useModelStore.getState().planTool).toBe('vertex')
    useModelStore.getState().setScene(createSampleModel())
    expect(useModelStore.getState().planTool).toBe('select')
  })

  it('showPlanDims 会话内可切换（默认显示，关闭后不随 setScene 复位）', () => {
    expect(useModelStore.getState().showPlanDims).toBe(true)
    useModelStore.getState().setShowPlanDims(false)
    expect(useModelStore.getState().showPlanDims).toBe(false)
    // 视图偏好与场景无关：载入新场景保持用户选择
    useModelStore.getState().setScene(createSampleModel())
    expect(useModelStore.getState().showPlanDims).toBe(false)
  })

  it('previewFootprint 实时替换房间足迹（不记历史、不记录编辑日志）', () => {
    useModelStore.getState().setScene(createSampleModel())
    const room = findNodeById(useModelStore.getState().scene!.root, 'room-master') as RoomNode
    const base = useModelStore.getState().scene!
    const shifted = room.footprint.map((p) => ({ x: p.x + 1, z: p.z }))
    useModelStore.getState().previewFootprint('room-master', shifted)
    const after = findNodeById(useModelStore.getState().scene!.root, 'room-master') as RoomNode
    expect(after.footprint[0]!.x).toBeCloseTo(room.footprint[0]!.x + 1, 5)
    expect(useModelStore.getState().past).toHaveLength(0)
    expect(useChatStore.getState().editOps).toHaveLength(0)
    // commitPlanEdit：压入拖拽前快照 + 记录一条 updateRoom footprint op
    useModelStore.getState().commitPlanEdit(base, 'room-master')
    expect(useModelStore.getState().past).toHaveLength(1)
    expect(useChatStore.getState().editOps).toHaveLength(1)
    expect(useChatStore.getState().editOps[0]).toMatchObject({
      op: 'updateRoom',
      id: 'room-master',
    })
    // 撤销回到拖拽前
    useModelStore.getState().undo()
    const undone = findNodeById(useModelStore.getState().scene!.root, 'room-master') as RoomNode
    expect(undone.footprint[0]!.x).toBeCloseTo(room.footprint[0]!.x, 5)
  })

  it('commitPlanEdit 无变化（场景引用相同）不记历史', () => {
    useModelStore.getState().setScene(createSampleModel())
    const base = useModelStore.getState().scene!
    useModelStore.getState().commitPlanEdit(base, 'room-master')
    expect(useModelStore.getState().past).toHaveLength(0)
    expect(useChatStore.getState().editOps).toHaveLength(0)
  })

  it('applyPlanOps 执行 setOpenings：更新场景 + 记历史 + 追加编辑日志', () => {
    useModelStore.getState().setScene(createSampleModel())
    const before = useModelStore.getState().scene!
    useModelStore.getState().applyPlanOps([
      {
        op: 'setOpenings',
        roomId: 'room-master',
        side: 'north',
        kind: 'window',
        edgeIndex: 2,
        from: 1,
        to: 2.5,
      },
    ])
    const room = findNodeById(useModelStore.getState().scene!.root, 'room-master') as RoomNode
    expect(room.windows).toHaveLength(1)
    expect(room.windows[0]!.edgeIndex).toBe(2)
    expect(useModelStore.getState().past).toHaveLength(1)
    expect(useModelStore.getState().past[0]!.scene).toBe(before)
    expect(useChatStore.getState().editOps).toHaveLength(1)
    expect(useChatStore.getState().editOps[0]).toMatchObject({
      op: 'setOpenings',
      roomId: 'room-master',
    })
  })

  it('applyPlanOps 空列表 / 全部失败 / 无实际变化时不记历史', () => {
    useModelStore.getState().setScene(createSampleModel())
    useModelStore.getState().applyPlanOps([])
    expect(useModelStore.getState().past).toHaveLength(0)
    // 房间不存在 → 单条跳过（applied 0）不记历史
    useModelStore
      .getState()
      .applyPlanOps([{ op: 'setOpenings', roomId: 'ghost', side: 'north', kind: 'door' }])
    expect(useModelStore.getState().past).toHaveLength(0)
    expect(useChatStore.getState().editOps).toHaveLength(0)
    // 同边同区间开洞重复 → 执行后 JSON 相同，不记历史
    useModelStore.getState().applyPlanOps([
      {
        op: 'setOpenings',
        roomId: 'room-master',
        side: 'north',
        kind: 'window',
        edgeIndex: 2,
        from: 1,
        to: 2.5,
      },
    ])
    const pastLen = useModelStore.getState().past.length
    useModelStore.getState().applyPlanOps([
      {
        op: 'setOpenings',
        roomId: 'room-master',
        side: 'north',
        kind: 'window',
        edgeIndex: 2,
        from: 1,
        to: 2.5,
      },
    ])
    expect(useModelStore.getState().past.length).toBe(pastLen)
    expect(useChatStore.getState().editOps).toHaveLength(1)
  })

  it('applyPlanOps 拆房 splitRoom：两个房间 + 可撤销 + 编辑日志', () => {
    useModelStore.getState().setScene(createSampleModel())
    const before = useModelStore.getState().scene!
    const beforeCount = before.root.levels[0]!.rooms.length
    useModelStore
      .getState()
      .applyPlanOps([{ op: 'splitRoom', id: 'room-master', axis: 'x', position: 0 }])
    const rooms = useModelStore.getState().scene!.root.levels[0]!.rooms
    expect(rooms).toHaveLength(beforeCount + 1)
    expect(rooms.some((r) => r.id === 'room-master')).toBe(true)
    // 撤销后编辑日志与场景同步裁剪：不再向 LLM 注入「已不存在的手动修改」（undo↔editOps 一致性）
    useModelStore.getState().undo()
    expect(useModelStore.getState().scene).toBe(before)
    expect(useChatStore.getState().editOps).toHaveLength(0)
    // redo 后编辑日志恢复
    useModelStore.getState().redo()
    expect(useChatStore.getState().editOps).toHaveLength(1)
    expect(useChatStore.getState().editOps[0]).toMatchObject({ op: 'splitRoom' })
  })
})
