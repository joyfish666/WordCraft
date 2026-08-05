import { describe, expect, it } from 'vitest'
import { findNodeById, isContainer } from './modelTree'
import { resolveLayout } from './layout'
import type { RoomNodeV2, SceneModelV2 } from '../types/model'

function roomV2(
  id: string,
  name: string,
  length: number,
  width: number,
  side?: string,
  furniture: { id: string; x: number; z: number }[] = [],
): RoomNodeV2 {
  return {
    id,
    type: 'room',
    name,
    dimensions: { length, width, height: 2.8 },
    side,
    children: furniture.map((f) => ({
      id: f.id,
      type: 'furniture',
      name: f.id,
      dimensions: { length: 1, width: 0.5, height: 0.5 },
      position: { x: f.x, y: 0.25, z: f.z },
    })),
  }
}

function scene(root: Partial<SceneModelV2['root']> & { children: RoomNodeV2[] }): SceneModelV2 {
  return {
    version: 2,
    root: {
      id: 'h1',
      type: 'house',
      name: '示例房',
      dimensions: { length: 7, width: 4, height: 2.8 },
      position: { x: 0, y: 0, z: 0 },
      layout: { mode: 'custom' },
      ...root,
    },
  }
}

describe('resolveLayout - corridor 走廊型', () => {
  it('房间分布在走廊两侧，客厅（入口）强制置于南侧并排最前', () => {
    const model = resolveLayout(
      scene({
        layout: {
          mode: 'auto',
          template: 'corridor',
          corridor: { width: 1.2, entranceRoomId: 'living' },
        },
        children: [
          roomV2('master', '主卧', 3, 3, 'left'),
          roomV2('living', '客厅', 4, 3, 'right'),
          roomV2('bed2', '次卧', 3, 3, 'right'),
        ],
      }),
    )
    // 整屋居中于原点，含走廊，入口房间已标记
    expect(model.root.position).toEqual({ x: 0, y: 0, z: 0 })
    expect(model.root.children.some((c) => c.name === '走廊')).toBe(true)
    expect(model.root.entranceRoomId).toBe('living')
    const master = findNodeById(model.root, 'master')!
    const living = findNodeById(model.root, 'living')!
    const bed2 = findNodeById(model.root, 'bed2')!
    // 入口客厅强制在南侧（z<0），主卧也在南侧，次卧在北侧
    expect(living.position.z).toBeLessThan(0)
    expect(master.position.z).toBeLessThan(0)
    expect(bed2.position.z).toBeGreaterThan(0)
    // 入口排最前（同一侧沿走廊 x 最小）
    expect(living.position.x).toBeLessThan(master.position.x)
  })

  it('单房间时无需走廊，房间居中', () => {
    const model = resolveLayout(
      scene({
        layout: { mode: 'auto', template: 'corridor' },
        children: [roomV2('studio', '工作室', 4, 3)],
      }),
    )
    expect(model.root.children.some((c) => c.name === '走廊')).toBe(false)
    const studio = findNodeById(model.root, 'studio')!
    expect(studio.position.z).toBeCloseTo(0)
  })
})

describe('resolveLayout - living 客厅居中型', () => {
  it('客厅居中于原点，其他房间围绕客厅分布', () => {
    const model = resolveLayout(
      scene({
        layout: { mode: 'auto', template: 'living', centerRoomId: 'living' },
        children: [
          roomV2('living', '客厅', 4, 3),
          roomV2('master', '主卧', 3, 3, 'north'),
          roomV2('kitchen', '厨房', 3, 2.5, 'east'),
          roomV2('bed2', '次卧', 3, 3, 'south'),
        ],
      }),
    )
    const living = findNodeById(model.root, 'living')!
    const master = findNodeById(model.root, 'master')!
    const kitchen = findNodeById(model.root, 'kitchen')!
    const bed2 = findNodeById(model.root, 'bed2')!
    // 整屋居中于原点
    expect(model.root.position).toEqual({ x: 0, y: 0, z: 0 })
    // 相对关系：主卧在客厅北侧、次卧在南侧、厨房在东侧
    expect(master.position.z).toBeGreaterThan(living.position.z)
    expect(bed2.position.z).toBeLessThan(living.position.z)
    expect(kitchen.position.x).toBeGreaterThan(living.position.x)
  })

  it('未给 side 的房间自动轮转到最少的一侧', () => {
    const model = resolveLayout(
      scene({
        layout: { mode: 'auto', template: 'living', centerRoomId: 'living' },
        children: [
          roomV2('living', '客厅', 4, 3),
          roomV2('r1', '房1', 3, 3),
          roomV2('r2', '房2', 3, 3),
          roomV2('r3', '房3', 3, 3),
          roomV2('r4', '房4', 3, 3),
        ],
      }),
    )
    // 四边各分到一个房间
    const z = model.root.children.filter((c) => isContainer(c) && c.id !== 'living').map((c) => c.position.z)
    const x = model.root.children.filter((c) => isContainer(c) && c.id !== 'living').map((c) => c.position.x)
    expect(z.some((v) => v > 0)).toBe(true)
    expect(z.some((v) => v < 0)).toBe(true)
    expect(x.some((v) => v > 0)).toBe(true)
    expect(x.some((v) => v < 0)).toBe(true)
  })
})

describe('resolveLayout - custom 自由型', () => {
  it('家具相对房间中心偏移为绝对坐标', () => {
    const model = resolveLayout(
      scene({
        children: [
          roomV2('r1', '主卧', 3, 3, undefined, [{ id: 'bed', x: 0.5, z: -0.3 }]),
        ],
      }),
    )
    const room = findNodeById(model.root, 'r1')!
    if (!isContainer(room)) throw new Error('expect room')
    const bed = room.children.find((c) => c.id === 'bed')
    // 房间在自定义坐标（未提供 → 原点），家具 = 房间中心 + 相对偏移
    expect(bed?.position.x).toBeCloseTo(0.5)
    expect(bed?.position.z).toBeCloseTo(-0.3)
    expect(bed?.position.y).toBeCloseTo(0.25)
  })

  it('房间使用提供的绝对坐标并整体居中', () => {
    const model = resolveLayout(
      scene({
        children: [
          { ...roomV2('a', '房A', 3, 3), position: { x: 5, y: 1.4, z: 2 } },
        ],
      }),
    )
    const a = findNodeById(model.root, 'a')!
    // 单个房间整体平移到原点
    expect(a.position.x).toBeCloseTo(0)
    expect(a.position.z).toBeCloseTo(0)
  })
})

describe('resolveLayout - 整屋包围盒', () => {
  it('整屋尺寸覆盖所有房间，位置在原点', () => {
    const model = resolveLayout(
      scene({
        layout: { mode: 'auto', template: 'corridor' },
        children: [
          roomV2('master', '主卧', 3, 3, 'left'),
          roomV2('living', '客厅', 4, 3, 'right'),
        ],
      }),
    )
    expect(model.root.position).toEqual({ x: 0, y: 0, z: 0 })
    expect(model.root.dimensions.length).toBeGreaterThan(0)
    expect(model.root.dimensions.width).toBeGreaterThan(0)
    // 所有房间在整屋范围内
    for (const c of model.root.children) {
      if (!isContainer(c)) continue
      const halfL = c.dimensions.length / 2
      const halfW = c.dimensions.width / 2
      expect(c.position.x - halfL).toBeGreaterThanOrEqual(-model.root.dimensions.length / 2)
      expect(c.position.x + halfL).toBeLessThanOrEqual(model.root.dimensions.length / 2)
      expect(c.position.z - halfW).toBeGreaterThanOrEqual(-model.root.dimensions.width / 2)
      expect(c.position.z + halfW).toBeLessThanOrEqual(model.root.dimensions.width / 2)
    }
  })
})
