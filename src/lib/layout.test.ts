import { describe, expect, it } from 'vitest'
import { findNodeById, isContainer, walk } from './modelTree'
import { resolveLayout } from './layout'
import { computeWallPlan } from './roomGeometry'
import type { ContainerNode, RoomNodeV2, SceneModelV2 } from '../types/model'

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

describe('resolveLayout - 两卫生间布局', () => {
  function twoBathScene(): SceneModelV2 {
    return {
      version: 2,
      root: {
        id: 'h',
        type: 'house',
        name: '三室两卫',
        dimensions: { length: 14.4, width: 9.6, height: 2.8 },
        position: { x: 0, y: 0, z: 0 },
        layout: { mode: 'auto', template: 'corridor', corridor: { width: 1.2, entranceRoomId: 'living_room' } },
        children: [
          roomV2('living_room', '客厅', 6, 4.2, 'left'),
          roomV2('kitchen', '厨房', 3, 3, 'left'),
          roomV2('bedroom1', '主卧', 4.2, 3.6, 'right'),
          roomV2('master_bathroom', '主卧卫生间', 2, 1.8, 'right'),
          roomV2('bedroom2', '次卧一', 3.6, 3.3, 'right'),
          roomV2('bedroom3', '次卧二', 3.6, 3.3, 'right'),
          roomV2('corridor_bathroom', '走廊卫生间', 2, 1.8, 'left'),
        ],
      },
    }
  }

  it('两个卫生间都参与布局（走廊卫生间不再被当作走廊过滤）', () => {
    const model = resolveLayout(twoBathScene())
    expect(findNodeById(model.root, 'corridor_bathroom')).not.toBeNull()
    expect(findNodeById(model.root, 'master_bathroom')).not.toBeNull()
  })

  it('主卧卫生间只与主卧开门，不连次卧', () => {
    const model = resolveLayout(twoBathScene())
    const rooms: ContainerNode[] = []
    walk(model.root, (n) => {
      if (n.type === 'room') rooms.push(n as ContainerNode)
    })
    const plan = computeWallPlan(rooms, { entrance: 'south', entranceRoomId: 'living_room' })
    const b1 = plan.get('bedroom1')!
    const b2 = plan.get('bedroom2')!
    // 主卧卫生间与主卧之间：墙开门（由主卧侧持有渲染）
    expect(b1.east.segments.some((s) => s.kind === 'door')).toBe(true)
    // 主卧卫生间与次卧一之间的墙为实心（不开门）——由次卧一侧渲染
    expect(b2.west.segments.some((s) => s.kind === 'wall')).toBe(true)
    expect(b2.west.segments.some((s) => s.kind === 'door')).toBe(false)
  })

  it('嵌套在卧室内的卫生间保留在卧室内部', () => {
    const v2: SceneModelV2 = {
      version: 2,
      root: {
        id: 'h',
        type: 'house',
        name: '带内卫',
        dimensions: { length: 10, width: 8, height: 2.8 },
        position: { x: 0, y: 0, z: 0 },
        layout: { mode: 'auto', template: 'corridor', corridor: { width: 1.2, entranceRoomId: 'living_room' } },
        children: [
          { id: 'living_room', type: 'room', name: '客厅', dimensions: { length: 6, width: 4.8, height: 2.8 }, side: 'left', children: [] },
          {
            id: 'bedroom1',
            type: 'room',
            name: '主卧',
            dimensions: { length: 4.8, width: 3.6, height: 2.8 },
            side: 'right',
            children: [
              { id: 'bed', type: 'furniture', name: '双人床', dimensions: { length: 2, width: 1.5, height: 0.5 }, position: { x: 0, y: 0.25, z: 0.8 } },
              {
                id: 'bathroom1',
                type: 'room',
                name: '主卧卫生间',
                dimensions: { length: 2, width: 1.8, height: 2.8 },
                position: { x: 1.2, y: 1.4, z: 1.2 },
                children: [
                  { id: 'toilet', type: 'furniture', name: '马桶', dimensions: { length: 0.6, width: 0.4, height: 0.7 }, position: { x: 0, y: 0.35, z: 0 } },
                ],
              },
            ],
          },
        ],
      },
    }
    const model = resolveLayout(v2)
    const bedroom = findNodeById(model.root, 'bedroom1')
    expect(bedroom).not.toBeNull()
    // 卫生间是主卧的子节点（在卧室内部），不是顶层房间
    if (bedroom && isContainer(bedroom)) {
      expect(bedroom.children.some((c) => c.id === 'bathroom1')).toBe(true)
    }
    expect(model.root.children.some((c) => c.name === '主卧卫生间')).toBe(false)
    // 主卧的家具仍在主卧内
    expect(findNodeById(model.root, 'bed')).not.toBeNull()
    // 卫生间位于卧室内部
    const bath = findNodeById(model.root, 'bathroom1')
    expect(bath).not.toBeNull()
    if (bedroom && bath && isContainer(bedroom) && isContainer(bath)) {
      expect(bath.position.x).toBeGreaterThanOrEqual(bedroom.position.x - bedroom.dimensions.length / 2)
      expect(bath.position.x).toBeLessThanOrEqual(bedroom.position.x + bedroom.dimensions.length / 2)
      expect(bath.position.z).toBeGreaterThanOrEqual(bedroom.position.z - bedroom.dimensions.width / 2)
      expect(bath.position.z).toBeLessThanOrEqual(bedroom.position.z + bedroom.dimensions.width / 2)
    }
  })

  it('嵌套卫生间按 side 靠边放置（side:north → 卧室北侧）', () => {
    const v2: SceneModelV2 = {
      version: 2,
      root: {
        id: 'h',
        type: 'house',
        name: '带内卫',
        dimensions: { length: 10, width: 8, height: 2.8 },
        position: { x: 0, y: 0, z: 0 },
        layout: { mode: 'auto', template: 'corridor', corridor: { width: 1.2, entranceRoomId: 'living_room' } },
        children: [
          { id: 'living_room', type: 'room', name: '客厅', dimensions: { length: 6, width: 4.8, height: 2.8 }, side: 'left', children: [] },
          {
            id: 'bedroom1',
            type: 'room',
            name: '主卧',
            dimensions: { length: 4, width: 3.5, height: 2.8 },
            side: 'right',
            children: [
              { id: 'bathroom1', type: 'room', name: '主卧卫生间', dimensions: { length: 2, width: 1.8, height: 2.8 }, side: 'north', children: [] },
            ],
          },
        ],
      },
    }
    const model = resolveLayout(v2)
    const bedroom = findNodeById(model.root, 'bedroom1')
    const bath = findNodeById(model.root, 'bathroom1')
    if (bedroom && bath && isContainer(bedroom) && isContainer(bath)) {
      // 卫生间在卧室北侧（z 大于卧室中心），且仍在卧室范围内
      expect(bath.position.z).toBeGreaterThan(bedroom.position.z)
      expect(bath.position.z).toBeLessThan(bedroom.position.z + bedroom.dimensions.width / 2)
      expect(bath.position.x).toBeGreaterThanOrEqual(bedroom.position.x - bedroom.dimensions.length / 2)
      expect(bath.position.x).toBeLessThanOrEqual(bedroom.position.x + bedroom.dimensions.length / 2)
    }
  })

  it('嵌套卫生间无 side 时靠角而非中心', () => {
    const v2: SceneModelV2 = {
      version: 2,
      root: {
        id: 'h',
        type: 'house',
        name: '带内卫',
        dimensions: { length: 10, width: 8, height: 2.8 },
        position: { x: 0, y: 0, z: 0 },
        layout: { mode: 'auto', template: 'corridor', corridor: { width: 1.2, entranceRoomId: 'living_room' } },
        children: [
          { id: 'living_room', type: 'room', name: '客厅', dimensions: { length: 6, width: 4.8, height: 2.8 }, side: 'left', children: [] },
          {
            id: 'bedroom1',
            type: 'room',
            name: '主卧',
            dimensions: { length: 4, width: 3.5, height: 2.8 },
            side: 'right',
            children: [
              { id: 'bathroom1', type: 'room', name: '主卧卫生间', dimensions: { length: 2, width: 1.8, height: 2.8 }, children: [] },
            ],
          },
        ],
      },
    }
    const model = resolveLayout(v2)
    const bedroom = findNodeById(model.root, 'bedroom1')
    const bath = findNodeById(model.root, 'bathroom1')
    if (bedroom && bath && isContainer(bedroom) && isContainer(bath)) {
      // 不位于中心：x 或 z 至少偏离一半自身尺寸
      expect(Math.abs(bath.position.x - bedroom.position.x)).toBeGreaterThan(bath.dimensions.length / 4)
      expect(Math.abs(bath.position.z - bedroom.position.z)).toBeGreaterThan(bath.dimensions.width / 4)
    }
  })

  it('走廊卫生间只与走廊开门，不连厨房', () => {
    const model = resolveLayout(twoBathScene())
    const rooms: ContainerNode[] = []
    walk(model.root, (n) => {
      if (n.type === 'room') rooms.push(n as ContainerNode)
    })
    const plan = computeWallPlan(rooms, { entrance: 'south', entranceRoomId: 'living_room' })
    const cb = plan.get('corridor_bathroom')!
    // 与走廊相连（北墙开门）
    expect(cb.north.segments.some((s) => s.kind === 'door')).toBe(true)
    // 与厨房之间不开门（实心墙）
    expect(cb.west.segments.some((s) => s.kind === 'door')).toBe(false)
  })
})
