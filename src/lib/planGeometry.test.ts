import { describe, expect, it } from 'vitest'
import { createSampleModel } from '../lib/sampleModel'
import { rectFootprint } from './footprint'
import {
  computePlanCamera,
  dimensionLines,
  doorArcPoints,
  doorLeafLine,
  fmt,
  houseBounds,
  roomDimLines,
  walkRooms,
  windowHatchLines,
} from './planGeometry'
import { computeWallPlan, edgeOf, type WallEdge, type WallPlan } from './roomGeometry'
import type { RoomNode } from '../types/model'

const scene = createSampleModel()

describe('houseBounds', () => {
  it('整屋包围盒来自整屋节点尺寸（示例 12.3×10）', () => {
    expect(houseBounds(scene)).toEqual({
      minX: -6.15,
      maxX: 6.15,
      minZ: -5,
      maxZ: 5,
      centerX: 0,
      centerZ: 0,
      width: 12.3,
      height: 10,
    })
  })
})

describe('fmt', () => {
  it('fmt 去掉尾零，最多 2 位小数', () => {
    expect(fmt(7)).toBe('7')
    expect(fmt(3.5)).toBe('3.5')
    expect(fmt(3.333)).toBe('3.33')
    expect(fmt(0.125)).toBe('0.13')
  })
})

describe('walkRooms', () => {
  it('递归收集所有房间，含嵌套，深度优先', () => {
    const rooms = walkRooms(scene.root)
    expect(rooms.map((r) => r.node.name)).toEqual([
      '走廊',
      '客厅',
      '厨房',
      '餐厅',
      '主卧',
      '主卧卫生间',
      '次卧',
      '公共卫生间',
    ])
    expect(rooms.map((r) => r.depth)).toEqual([1, 1, 1, 1, 1, 2, 1, 1])
    // 嵌套卫生间深度 2（随父房间之后立即递归）
    expect(rooms[5]).toMatchObject({ node: { name: '主卧卫生间' }, depth: 2 })
  })
})

describe('dimensionLines', () => {
  it('南侧总长 + 东侧总宽，位于包围盒外', () => {
    const bounds = houseBounds(scene)
    const lines = dimensionLines(bounds, { y: 3.5 })
    expect(lines).toHaveLength(2)
    expect(lines[0].label).toBe('总长 12.3m')
    expect(lines[0].from).toEqual([-6.15, 3.5, -5.6])
    expect(lines[0].to).toEqual([6.15, 3.5, -5.6])
    expect(lines[1].label).toBe('总宽 10m')
    expect(lines[1].from).toEqual([6.75, 3.5, -5])
    expect(lines[1].to).toEqual([6.75, 3.5, 5])
  })
})

describe('computePlanCamera', () => {
  it('正交取景使包围盒适配视口，居中于整屋', () => {
    const spec = computePlanCamera(houseBounds(scene), { width: 800, height: 600 })
    expect(spec.position).toEqual([0, 60, 0])
    expect(spec.target).toEqual([0, 0, 0])
    const fitX = 12.3 + 2
    const fitZ = 10 + 2
    expect(spec.zoom).toBeCloseTo(Math.min(800 / fitX, 600 / fitZ) * 0.9, 5)
  })

  it('空场景回退到取景原点', () => {
    const spec = computePlanCamera(null, { width: 800, height: 600 })
    expect(spec.position).toEqual([0, 60, 0])
    expect(spec.zoom).toBe(20)
  })
})

describe('门窗符号（doorLeafLine / doorArcPoints / windowHatchLines）', () => {
  // 南墙：axis 'x'、line z=-1.5、start x=-2、dir south（房间在 +z 侧）
  const southEdge: WallEdge = {
    axis: 'x',
    line: -1.5,
    start: -2,
    length: 4,
    dir: 'south',
    shared: false,
    segments: [{ from: 1, to: 1.9, kind: 'door' }],
  }

  it('门扇线：从铰链端垂直进入房间（南墙 → +z），长度 = 门洞宽', () => {
    const [a, e] = doorLeafLine(southEdge, southEdge.segments[0], 0.2)
    expect(a).toEqual([-1, 0.2, -1.5])
    expect(e[0]).toBeCloseTo(-1, 5)
    expect(e[2]).toBeCloseTo(-0.6, 5)
  })

  it('北墙（dir north）门扇线进入 -z 方向', () => {
    const northEdge: WallEdge = {
      ...southEdge,
      line: 1.5,
      dir: 'north',
      segments: [{ from: 2, to: 2.9, kind: 'door' }],
    }
    const [, e] = doorLeafLine(northEdge, northEdge.segments[0], 0.2)
    expect(e[2]).toBeCloseTo(1.5 - 0.9, 5)
  })

  it('东墙（axis z、dir east）门扇线进入 -x 方向', () => {
    const eastEdge: WallEdge = {
      axis: 'z',
      line: 2,
      start: -1.5,
      length: 3,
      dir: 'east',
      shared: false,
      segments: [{ from: 1, to: 1.9, kind: 'door' }],
    }
    const [a, e] = doorLeafLine(eastEdge, eastEdge.segments[0], 0.2)
    expect(a).toEqual([2, 0.2, -0.5])
    expect(e[0]).toBeLessThan(2)
  })

  it('开启弧线：以铰链端为圆心扫到洞口另一端，全程在房间内且不越出洞口区间', () => {
    const pts = doorArcPoints(southEdge, southEdge.segments[0], 0.2)
    expect(pts).toHaveLength(11)
    // 首点 = 门扇端点，末点 = 洞口另一端（墙线上）
    expect(pts[0][0]).toBeCloseTo(-1, 5)
    expect(pts[0][2]).toBeCloseTo(-0.6, 5)
    expect(pts[10][0]).toBeCloseTo(-0.1, 5)
    expect(pts[10][2]).toBeCloseTo(-1.5, 5)
    // 半径恒 = 门洞宽
    for (const p of pts) {
      expect(Math.hypot(p[0] - -1, p[2] - -1.5)).toBeCloseTo(0.9, 5)
    }
    // 全程在房间内（z ≥ 墙线）且沿墙方向不越出洞口（x ∈ [-1, -0.1]）
    for (const p of pts) {
      expect(p[2]).toBeGreaterThanOrEqual(-1.5 - 1e-9)
      expect(p[0]).toBeGreaterThanOrEqual(-1 - 1e-9)
      expect(p[0]).toBeLessThanOrEqual(-0.1 + 1e-9)
    }
  })

  it('窗洞双线：两条平行短线向内偏移 0.1/0.22，跨度 = 窗宽', () => {
    const seg = { from: 2, to: 3.5, kind: 'window' as const }
    const lines = windowHatchLines(southEdge, seg, 0.2)
    expect(lines).toHaveLength(2)
    expect(lines[0][0]).toEqual([0, 0.2, -1.4])
    expect(lines[0][1]).toEqual([1.5, 0.2, -1.4])
    expect(lines[1][0]).toEqual([0, 0.2, -1.28])
    expect(lines[1][1]).toEqual([1.5, 0.2, -1.28])
  })

  it('与墙体方案同源：入户门段落在入口房间南墙，符号指向房间内部', () => {
    const room: RoomNode = {
      id: 'r',
      type: 'room',
      name: '客厅',
      footprint: rectFootprint(0, 0, 4, 3),
      height: 2.8,
      doors: [],
      windows: [],
      furniture: [],
      nestedRooms: [],
    }
    const plan = computeWallPlan([room], { entrance: 'south', entranceRoomId: 'r' }).get(
      'r',
    ) as WallPlan
    const south = edgeOf(plan, 'south')!
    const door = south.segments.find((s) => s.kind === 'door' && s.entrance)!
    const [, e] = doorLeafLine(south, door, 0.2)
    expect(e[2]).toBeGreaterThan(south.line) // 进入房间内部（z > 南墙线）
  })
})

describe('roomDimLines', () => {
  it('4×3 房间：南侧标长度（4）、西侧标宽度（3），向内偏移 0.4', () => {
    const room: RoomNode = {
      id: 'r',
      type: 'room',
      name: '客厅',
      footprint: rectFootprint(0, 0, 4, 3),
      height: 2.8,
      doors: [],
      windows: [],
      furniture: [],
      nestedRooms: [],
    }
    const lines = roomDimLines(room, { y: 0.35 })
    expect(lines).toHaveLength(2)
    expect(lines[0].from).toEqual([-1.6, 0.35, -1.1])
    expect(lines[0].to).toEqual([1.6, 0.35, -1.1])
    expect(lines[0].label).toBe('4')
    expect(lines[1].from).toEqual([-1.6, 0.35, -1.1])
    expect(lines[1].to).toEqual([-1.6, 0.35, 1.1])
    expect(lines[1].label).toBe('3')
  })

  it('过小的边（< 2m）跳过尺寸线', () => {
    const small: RoomNode = {
      id: 's',
      type: 'room',
      name: '卫生间',
      footprint: rectFootprint(0, 0, 1.5, 1.2),
      height: 2.8,
      doors: [],
      windows: [],
      furniture: [],
      nestedRooms: [],
    }
    expect(roomDimLines(small, { y: 0.35 })).toEqual([])
  })
})
