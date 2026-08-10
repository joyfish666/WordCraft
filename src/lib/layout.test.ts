import { describe, expect, it } from 'vitest'
import { houseLevelsBounds, roomCenter } from './footprint'
import { findNodeById, isContainer, walk } from './modelTree'
import { resolveLayout } from './layout'
import { computeAllWallPlans, computeWallPlan, edgeOf } from './roomGeometry'
import type { FurnitureNode, RoomNode, RoomNodeV2, SceneModelV2 } from '../types/model'

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

/** 顶层房间列表 */
function topRooms(model: ReturnType<typeof resolveLayout>): RoomNode[] {
  return model.root.levels[0].rooms
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
    const bounds = houseLevelsBounds(model.root)!
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(0, 5)
    expect((bounds.minZ + bounds.maxZ) / 2).toBeCloseTo(0, 5)
    expect(topRooms(model).some((c) => c.name === '走廊')).toBe(true)
    expect(model.root.entranceRoomId).toBe('living')
    const master = findNodeById(model.root, 'master')!
    const living = findNodeById(model.root, 'living')!
    const bed2 = findNodeById(model.root, 'bed2')!
    // 入口客厅强制在南侧（z<0），主卧也在南侧，次卧在北侧
    expect(roomCenter(living as RoomNode).z).toBeLessThan(0)
    expect(roomCenter(master as RoomNode).z).toBeLessThan(0)
    expect(roomCenter(bed2 as RoomNode).z).toBeGreaterThan(0)
    // 入口排最前（同一侧沿走廊 x 最小）
    expect(roomCenter(living as RoomNode).x).toBeLessThan(roomCenter(master as RoomNode).x)
  })

  it('单房间时无需走廊，房间居中', () => {
    const model = resolveLayout(
      scene({
        layout: { mode: 'auto', template: 'corridor' },
        children: [roomV2('studio', '工作室', 4, 3)],
      }),
    )
    expect(topRooms(model).some((c) => c.name === '走廊')).toBe(false)
    const studio = findNodeById(model.root, 'studio')!
    expect(roomCenter(studio as RoomNode).z).toBeCloseTo(0)
  })

  it('未指定 side 的房间自动分配到走廊两侧（避免全挤一侧）', () => {
    const model = resolveLayout(
      scene({
        layout: { mode: 'auto', template: 'corridor', corridor: { width: 1.2, entranceRoomId: 'living' } },
        children: [
          roomV2('living', '客厅', 6, 4.5, 'left'),
          roomV2('kitchen', '厨房', 3, 3), // 未指定 side
          roomV2('dining', '餐厅', 3, 3), // 未指定 side
          roomV2('master', '主卧', 4, 3.5), // 未指定 side
        ],
      }),
    )
    const rooms = topRooms(model)
    const unassigned = rooms.filter((c) => c.id !== 'living')
    // 入口客厅在南侧；未指定 side 的房间被分到两侧（不全挤一侧）
    expect(roomCenter(rooms.find((c) => c.id === 'living')!).z).toBeLessThan(0)
    expect(unassigned.some((c) => roomCenter(c).z > 0)).toBe(true)
    expect(unassigned.some((c) => roomCenter(c).z < 0)).toBe(true)
  })

  it('入口房间名字含「走廊」（如"入口走廊"）也保留为真实房间，大门开在其南墙', () => {
    const model = resolveLayout(
      scene({
        layout: { mode: 'auto', template: 'corridor', corridor: { width: 1.2, entranceRoomId: 'corridor_entrance' } },
        children: [
          roomV2('corridor_entrance', '入口走廊', 2, 1.2, 'left'),
          roomV2('living', '客厅', 6, 4.5, 'left'),
          roomV2('master', '主卧', 4.5, 3.5, 'right'),
        ],
      }),
    )
    const entrance = findNodeById(model.root, 'corridor_entrance')
    expect(entrance).toBeDefined() // 未被 isCorridorName 过滤掉
    const rooms = topRooms(model)
    const plan = computeWallPlan(rooms, { entrance: 'south', entranceRoomId: 'corridor_entrance' })
    // 入户门开在入口房间南墙；客厅南墙无入户门
    expect(edgeOf(plan.get('corridor_entrance')!, 'south')!.segments.some((s) => s.kind === 'door' && s.entrance)).toBe(true)
    expect(edgeOf(plan.get('living')!, 'south')!.segments.some((s) => s.entrance)).toBe(false)
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
    const bounds = houseLevelsBounds(model.root)!
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(0, 5)
    expect((bounds.minZ + bounds.maxZ) / 2).toBeCloseTo(0, 5)
    // 相对关系：主卧在客厅北侧、次卧在南侧、厨房在东侧
    expect(roomCenter(master as RoomNode).z).toBeGreaterThan(roomCenter(living as RoomNode).z)
    expect(roomCenter(bed2 as RoomNode).z).toBeLessThan(roomCenter(living as RoomNode).z)
    expect(roomCenter(kitchen as RoomNode).x).toBeGreaterThan(roomCenter(living as RoomNode).x)
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
    const rooms = topRooms(model).filter((c) => c.id !== 'living')
    const z = rooms.map((c) => roomCenter(c).z)
    const x = rooms.map((c) => roomCenter(c).x)
    expect(z.some((v) => v > 0)).toBe(true)
    expect(z.some((v) => v < 0)).toBe(true)
    expect(x.some((v) => v > 0)).toBe(true)
    expect(x.some((v) => v < 0)).toBe(true)
  })
})

describe('resolveLayout - custom 自由型', () => {
  it('家具相对房间中心偏移为绝对坐标', () => {
    // 用独立家具（茶几）测相对→绝对转换，避免被家具常理贴墙逻辑挪动；
    // z 取 0 落在南北两个门口通道（入户门 + 兜底门）之间，normalizeContainment 不会推出堵门家具
    const model = resolveLayout(
      scene({
        children: [
          roomV2('r1', '客厅', 3, 3, undefined, [{ id: '茶几', x: 0.5, z: 0 }]),
        ],
      }),
    )
    const room = findNodeById(model.root, 'r1')!
    if (!isContainer(room) || room.type !== 'room') throw new Error('expect room')
    const table = room.furniture.find((c) => c.id === '茶几')
    // 房间在自定义坐标（未提供 → 原点），家具 = 房间中心 + 相对偏移
    expect(table?.position.x).toBeCloseTo(0.5)
    expect(table?.position.z).toBeCloseTo(0)
    expect(table?.position.y).toBeCloseTo(0.25)
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
    expect(roomCenter(a as RoomNode).x).toBeCloseTo(0)
    expect(roomCenter(a as RoomNode).z).toBeCloseTo(0)
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
    const bounds = houseLevelsBounds(model.root)!
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(0, 5)
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(0)
    expect(bounds.maxZ - bounds.minZ).toBeGreaterThan(0)
    // 所有房间在整屋范围内
    for (const c of topRooms(model)) {
      const cb = roomBoundsOf(c)
      expect(cb.minX).toBeGreaterThanOrEqual(bounds.minX - 1e-6)
      expect(cb.maxX).toBeLessThanOrEqual(bounds.maxX + 1e-6)
      expect(cb.minZ).toBeGreaterThanOrEqual(bounds.minZ - 1e-6)
      expect(cb.maxZ).toBeLessThanOrEqual(bounds.maxZ + 1e-6)
    }
  })
})

function roomBoundsOf(r: RoomNode): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of r.footprint) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  return { minX, maxX, minZ, maxZ }
}

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
    const rooms: RoomNode[] = []
    walk(model.root, (n) => {
      if (n.type === 'room') rooms.push(n as RoomNode)
    })
    const plan = computeWallPlan(rooms, { entrance: 'south', entranceRoomId: 'living_room' })
    const b1 = plan.get('bedroom1')!
    const b2 = plan.get('bedroom2')!
    // 主卧卫生间与主卧之间：墙开门（由主卧侧持有渲染）
    expect(edgeOf(b1, 'east')!.segments.some((s) => s.kind === 'door')).toBe(true)
    // 主卧卫生间与次卧一之间的墙为实心（不开门）——由次卧一侧渲染
    expect(edgeOf(b2, 'west')!.segments.some((s) => s.kind === 'wall')).toBe(true)
    expect(edgeOf(b2, 'west')!.segments.some((s) => s.kind === 'door')).toBe(false)
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
    if (bedroom && isContainer(bedroom) && bedroom.type === 'room') {
      expect(bedroom.nestedRooms.some((c) => c.id === 'bathroom1')).toBe(true)
    }
    expect(topRooms(model).some((c) => c.name === '主卧卫生间')).toBe(false)
    // 主卧的家具仍在主卧内
    expect(findNodeById(model.root, 'bed')).not.toBeNull()
    // 卫生间位于卧室内部
    const bath = findNodeById(model.root, 'bathroom1')
    expect(bath).not.toBeNull()
    if (bedroom && bath && isContainer(bedroom) && isContainer(bath)) {
      const bb = roomBoundsOf(bedroom as RoomNode)
      const bc = roomCenter(bath as RoomNode)
      expect(bc.x).toBeGreaterThanOrEqual(bb.minX)
      expect(bc.x).toBeLessThanOrEqual(bb.maxX)
      expect(bc.z).toBeGreaterThanOrEqual(bb.minZ)
      expect(bc.z).toBeLessThanOrEqual(bb.maxZ)
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
      // side:north → 靠西北角（z 偏北、x 偏西），贴两面墙而非居中贴单边
      expect(roomCenter(bath as RoomNode).z).toBeGreaterThan(roomCenter(bedroom as RoomNode).z)
      expect(roomCenter(bath as RoomNode).x).toBeLessThan(roomCenter(bedroom as RoomNode).x)
      // 仍在卧室范围内
      const bb = roomBoundsOf(bedroom as RoomNode)
      expect(roomCenter(bath as RoomNode).z).toBeLessThan(bb.maxZ)
      expect(roomCenter(bath as RoomNode).x).toBeGreaterThanOrEqual(bb.minX)
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
            children: [{ id: 'bathroom1', type: 'room', name: '主卧卫生间', dimensions: { length: 2, width: 1.8, height: 2.8 }, children: [] }],
          },
        ],
      },
    }
    const model = resolveLayout(v2)
    const bedroom = findNodeById(model.root, 'bedroom1')
    const bath = findNodeById(model.root, 'bathroom1')
    if (bedroom && bath && isContainer(bedroom) && isContainer(bath)) {
      // 不位于中心：x 或 z 至少偏离一半自身尺寸
      expect(
        Math.abs(roomCenter(bath as RoomNode).x - roomCenter(bedroom as RoomNode).x),
      ).toBeGreaterThan(footprintHalfX(bath as RoomNode) / 2)
      expect(
        Math.abs(roomCenter(bath as RoomNode).z - roomCenter(bedroom as RoomNode).z),
      ).toBeGreaterThan(footprintHalfZ(bath as RoomNode) / 2)
    }
  })

  it('已解析模型调用 computeAllWallPlans：嵌套卫生间边界墙 open、门面有 door', () => {
    const v2: SceneModelV2 = {
      version: 2,
      root: {
        id: 'h',
        type: 'house',
        name: '带内卫',
        dimensions: { length: 12, width: 9, height: 2.8 },
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
            children: [{ id: 'bathroom1', type: 'room', name: '主卧卫生间', dimensions: { length: 2, width: 1.8, height: 2.8 }, side: 'north', children: [] }],
          },
        ],
      },
    }
    const model = resolveLayout(v2)
    const rooms = topRooms(model)
    const plan = computeAllWallPlans(rooms, { entrance: 'south', entranceRoomId: 'living_room' })
    const bath = plan.get('bathroom1')
    expect(bath).toBeDefined()
    if (!bath) return
    // 角落嵌套：贴父墙的两面 open（由外层墙围护），另两面为内部分隔墙
    const wallFaces = bath.edges.filter((e) => e.segments.some((s) => s.kind === 'wall'))
    const openFaces = bath.edges.filter((e) => e.segments.some((s) => s.kind === 'open'))
    expect(wallFaces.length).toBe(2)
    expect(openFaces.length).toBe(2)
    // 恰一面有门（朝父房间中心）
    const doorFaces = bath.edges.filter((e) => e.segments.some((s) => s.kind === 'door'))
    expect(doorFaces.length).toBe(1)
  })

  it('走廊卫生间只与走廊开门，不连厨房', () => {
    const model = resolveLayout(twoBathScene())
    const rooms: RoomNode[] = []
    walk(model.root, (n) => {
      if (n.type === 'room') rooms.push(n as RoomNode)
    })
    const plan = computeWallPlan(rooms, { entrance: 'south', entranceRoomId: 'living_room' })
    const cb = plan.get('corridor_bathroom')!
    // 与走廊相连（北墙开门）
    expect(edgeOf(cb, 'north')!.segments.some((s) => s.kind === 'door')).toBe(true)
    // 与厨房之间不开门（实心墙）
    expect(edgeOf(cb, 'west')!.segments.some((s) => s.kind === 'door')).toBe(false)
  })
})

function footprintHalfX(r: RoomNode): number {
  let minX = Infinity
  let maxX = -Infinity
  for (const p of r.footprint) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
  }
  return (maxX - minX) / 2
}

function footprintHalfZ(r: RoomNode): number {
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of r.footprint) {
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  return (maxZ - minZ) / 2
}

describe('resolveLayout - 家具常理摆放（贴墙 + 避让嵌套卫生间 + 避让门口）', () => {
  it('主卧双人床贴墙、不重叠内嵌卫生间、不堵门口', () => {
    const v2: SceneModelV2 = {
      version: 2,
      root: {
        id: 'h',
        type: 'house',
        name: '带内卫',
        dimensions: { length: 12, width: 9, height: 2.8 },
        position: { x: 0, y: 0, z: 0 },
        layout: { mode: 'auto', template: 'corridor', corridor: { width: 1.2, entranceRoomId: 'living_room' } },
        children: [
          { id: 'living_room', type: 'room', name: '客厅', dimensions: { length: 6, width: 4.5, height: 2.8 }, side: 'left', children: [] },
          {
            id: 'bedroom1',
            type: 'room',
            name: '主卧',
            dimensions: { length: 4.5, width: 3.5, height: 2.8 },
            side: 'right',
            children: [
              { id: 'bed', type: 'furniture', name: '双人床', dimensions: { length: 2, width: 1.5, height: 0.5 }, position: { x: 0, y: 0.25, z: -0.8 } },
              { id: 'bathroom1', type: 'room', name: '主卧卫生间', dimensions: { length: 2, width: 1.8, height: 2.8 }, side: 'north', children: [] },
            ],
          },
        ],
      },
    }
    const model = resolveLayout(v2)
    const bedroom = findNodeById(model.root, 'bedroom1') as RoomNode
    const bed = findNodeById(model.root, 'bed') as FurnitureNode
    const bath = findNodeById(model.root, 'bathroom1') as RoomNode
    const bb = roomBoundsOf(bedroom)
    const bc = bed.position
    const bhx = bed.dimensions.length / 2
    const bhz = bed.dimensions.width / 2
    const innerMinX = bb.minX + 0.15
    const innerMaxX = bb.maxX - 0.15
    const innerMinZ = bb.minZ + 0.15
    const innerMaxZ = bb.maxZ - 0.15

    // 床贴某面墙内壁（不悬空在中间）
    const flushWall =
      Math.abs(bc.x - (innerMinX + bhx)) < 1e-6 ||
      Math.abs(bc.x - (innerMaxX - bhx)) < 1e-6 ||
      Math.abs(bc.z - (innerMinZ + bhz)) < 1e-6 ||
      Math.abs(bc.z - (innerMaxZ - bhz)) < 1e-6
    expect(flushWall).toBe(true)

    // 不与卫生间禁区（足迹 + 墙厚外扩）重叠；允许贴边（共享墙）的浮点误差
    const EPS = 1e-6
    const kb = roomBoundsOf(bath)
    const kMinX = kb.minX - 0.15
    const kMaxX = kb.maxX + 0.15
    const kMinZ = kb.minZ - 0.15
    const kMaxZ = kb.maxZ + 0.15
    const bathOverlap =
      bc.x + bhx > kMinX + EPS &&
      bc.x - bhx < kMaxX - EPS &&
      bc.z + bhz > kMinZ + EPS &&
      bc.z - bhz < kMaxZ - EPS
    expect(bathOverlap).toBe(false)

    // 不堵门口：主卧南墙（贴走廊）居中开门，门宽 0.9 → 禁区 x ∈ [门中心±0.45]，z 从南墙内壁向室内 1.0
    const doorMinX = roomCenter(bedroom).x - 0.45
    const doorMaxX = roomCenter(bedroom).x + 0.45
    const doorOverlap =
      bc.x + bhx > doorMinX + EPS &&
      bc.x - bhx < doorMaxX - EPS &&
      bc.z + bhz > innerMinZ + EPS &&
      bc.z - bhz < innerMinZ + 1.0 - EPS
    expect(doorOverlap).toBe(false)
  })
})
