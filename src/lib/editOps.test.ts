import { describe, expect, it } from 'vitest'
import { editDiffToOps } from './editOps'
import { createSampleModel } from './sampleModel'
import { footprintCenter, translateFootprint } from './footprint'
import {
  findNodeById,
  normalizeContainment,
  updateNodeFields,
  updateNodePosition,
} from './modelTree'
import type { FurnitureNode, RoomNode, SceneModel } from '../types/model'

const sample = (): SceneModel => createSampleModel()

/** 按 id 取家具 */
function furniture(scene: SceneModel, id: string): FurnitureNode {
  const n = findNodeById(scene.root, id)
  if (!n || n.type !== 'furniture') throw new Error(`expect furniture: ${id}`)
  return n
}

/** 按 id 取房间 */
function room(scene: SceneModel, id: string): RoomNode {
  const n = findNodeById(scene.root, id)
  if (!n || n.type !== 'room') throw new Error(`expect room: ${id}`)
  return n
}

describe('editDiffToOps（手动编辑 → op，P3 双向同步）', () => {
  it('移动家具 → updateFurniture，position 换算为相对所在房间中心', () => {
    const before = sample()
    const sofa = furniture(before, 'sofa-living')
    const next = {
      ...before,
      root: updateNodePosition(before.root, 'sofa-living', {
        x: sofa.position.x + 1,
        y: sofa.position.y,
        z: sofa.position.z - 0.5,
      }) as SceneModel['root'],
    }
    const ops = editDiffToOps(before, next, 'sofa-living')
    expect(ops).toHaveLength(1)
    const op = ops[0]
    expect(op.op).toBe('updateFurniture')
    if (op.op !== 'updateFurniture') return
    expect(op.roomId).toBe('room-living')
    expect(op.id).toBe('sofa-living')
    // 相对坐标 = 绝对坐标 - 所在房间中心（x/z），y 为高度一半（v2 语义）
    const c = footprintCenter(room(next, 'room-living').footprint)
    const after = furniture(next, 'sofa-living')
    expect(op.patch.position).toEqual({
      x: after.position.x - c.x,
      y: after.position.y,
      z: after.position.z - c.z,
    })
  })

  it('移动房间 → updateRoom.patch.footprint（世界坐标顶点环）', () => {
    const before = sample()
    const living = room(before, 'room-living')
    const c = footprintCenter(living.footprint)
    const next = {
      ...before,
      root: updateNodePosition(before.root, 'room-living', {
        x: c.x + 2,
        y: living.height / 2,
        z: c.z + 1,
      }) as SceneModel['root'],
    }
    const ops = editDiffToOps(before, next, 'room-living')
    expect(ops).toHaveLength(1)
    const op = ops[0]
    expect(op.op).toBe('updateRoom')
    if (op.op !== 'updateRoom') return
    expect(op.patch.footprint).toEqual(translateFootprint(living.footprint, 2, 1))
  })

  it('改房间尺寸/名称 → updateRoom patch（尺寸变化表现为 footprint 顶点环）', () => {
    const before = sample()
    const next = {
      ...before,
      root: updateNodeFields(before.root, 'room-living', {
        name: '大客厅',
        dimensions: { length: 7 },
      }) as SceneModel['root'],
    }
    const ops = editDiffToOps(before, next, 'room-living')
    expect(ops).toHaveLength(1)
    const op = ops[0]
    expect(op.op).toBe('updateRoom')
    if (op.op !== 'updateRoom') return
    expect(op.patch.name).toBe('大客厅')
    const pts = op.patch.footprint!
    const xs = pts.map((p) => p.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(7, 5)
  })

  it('只改层高 → updateRoom patch.dimensions.height（footprint 不变）', () => {
    const before = sample()
    const next = {
      ...before,
      root: updateNodeFields(before.root, 'room-kitchen', {
        dimensions: { height: 3.2 },
      }) as SceneModel['root'],
    }
    const ops = editDiffToOps(before, next, 'room-kitchen')
    expect(ops).toHaveLength(1)
    const op = ops[0]
    expect(op.op).toBe('updateRoom')
    if (op.op !== 'updateRoom') return
    expect(op.patch.footprint).toBeUndefined()
    expect(op.patch.dimensions).toEqual({ height: 3.2 })
  })

  it('改家具尺寸/名称 → updateFurniture patch（全量尺寸）', () => {
    const before = sample()
    const next = {
      ...before,
      root: updateNodeFields(before.root, 'wardrobe-master', {
        name: '大衣柜',
        dimensions: { width: 0.8 },
      }) as SceneModel['root'],
    }
    const ops = editDiffToOps(before, next, 'wardrobe-master')
    expect(ops).toHaveLength(1)
    const op = ops[0]
    expect(op.op).toBe('updateFurniture')
    if (op.op !== 'updateFurniture') return
    expect(op.roomId).toBe('room-master')
    expect(op.patch.name).toBe('大衣柜')
    // patch 携带编辑后的全量尺寸（编辑前的长宽可能已交换/旋转，以实际状态为准）
    expect(op.patch.dimensions).toEqual(furniture(next, 'wardrobe-master').dimensions)
    expect(op.patch.dimensions!.width).toBe(0.8)
  })

  it('编辑后 normalizeContainment 约束的位置变化也能被捕获（与真实提交一致）', () => {
    const before = sample()
    // 把主卧床头柜拖进门口通道（门区中心），normalizeContainment 会把它推出门口禁区
    const next = normalizeContainment({
      ...before,
      root: updateNodeFields(before.root, 'nightstand-master', {
        position: { x: -0.25, z: 1.5 },
      }) as SceneModel['root'],
    })
    const ops = editDiffToOps(before, next, 'nightstand-master')
    expect(ops).toHaveLength(1)
    expect(ops[0].op).toBe('updateFurniture')
  })

  it('无实际变化 → 空数组（不记录日志）', () => {
    const scene = sample()
    const deepCopy = JSON.parse(JSON.stringify(scene)) as SceneModel
    expect(editDiffToOps(scene, deepCopy, 'bed-master')).toEqual([])
  })

  it('节点不存在 → 空数组', () => {
    const before = sample()
    const after = JSON.parse(JSON.stringify(before)) as SceneModel
    expect(editDiffToOps(before, after, 'ghost')).toEqual([])
  })

  it('整屋改名 → setHouse', () => {
    const before = sample()
    const after = JSON.parse(JSON.stringify(before)) as SceneModel
    after.root.name = '新名字'
    const ops = editDiffToOps(before, after, 'house-sample')
    expect(ops).toEqual([{ op: 'setHouse', name: '新名字' }])
  })

  it('嵌套房间内家具移动 → updateFurniture 归属最内层房间 id', () => {
    const before = sample()
    const toilet = furniture(before, 'toilet-master')
    const next = {
      ...before,
      root: updateNodePosition(before.root, 'toilet-master', {
        x: toilet.position.x + 0.3,
        y: toilet.position.y,
        z: toilet.position.z,
      }) as SceneModel['root'],
    }
    const ops = editDiffToOps(before, next, 'toilet-master')
    expect(ops).toHaveLength(1)
    expect(ops[0].op).toBe('updateFurniture')
    if (ops[0].op !== 'updateFurniture') return
    expect(ops[0].roomId).toBe('bath-master')
  })
})
