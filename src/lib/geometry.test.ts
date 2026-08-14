import { describe, expect, it } from 'vitest'
import {
  edgeMetaOf,
  findRoomInList,
  halfRectOverlaps,
  rectsOverlap,
  sameFootprint,
  translateRoom,
  type Rect,
} from './geometry'
import type { Point2D, RoomNode } from '../types/model'

function rect(minX: number, maxX: number, minZ: number, maxZ: number): Rect {
  return { minX, maxX, minZ, maxZ }
}

/** 4 点矩形足迹（西南角起逆时针，坑 39 约定：0=南 1=东 2=北 3=西） */
function rectFootprint(minX: number, maxX: number, minZ: number, maxZ: number): Point2D[] {
  return [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ]
}

describe('rectsOverlap / halfRectOverlaps（贴边不算重叠，坑 35/47）', () => {
  it('分离矩形不重叠', () => {
    expect(rectsOverlap(rect(0, 1, 0, 1), rect(2, 3, 0, 1))).toBe(false)
    expect(rectsOverlap(rect(0, 1, 0, 1), rect(0, 1, 2, 3))).toBe(false)
  })

  it('贴边（共享一条边）不算重叠', () => {
    expect(rectsOverlap(rect(0, 1, 0, 1), rect(1, 2, 0, 1))).toBe(false)
    expect(rectsOverlap(rect(0, 1, 0, 1), rect(0, 1, 1, 2))).toBe(false)
  })

  it('浮点噪声贴边（差 1e-9）不算重叠', () => {
    expect(rectsOverlap(rect(0, 1, 0, 1), rect(1 - 1e-9, 2, 0, 1))).toBe(false)
  })

  it('真实重叠返回 true（含部分重叠）', () => {
    expect(rectsOverlap(rect(0, 2, 0, 2), rect(1, 3, 1, 3))).toBe(true)
    expect(rectsOverlap(rect(0, 2, 0, 2), rect(0.5, 1.5, 0.5, 1.5))).toBe(true)
  })

  it('halfRectOverlaps：中心+半宽与禁区（贴边不算重叠）', () => {
    // 中心 (0,0)、半宽 1 的家具：贴禁区边不算重叠
    expect(halfRectOverlaps(0, 0, 1, 1, rect(1, 2, -1, 1))).toBe(false)
    expect(halfRectOverlaps(0, 0, 1, 1, rect(1.0000001, 2, -1, 1))).toBe(false)
    // 越过边界 0.1 即重叠
    expect(halfRectOverlaps(0, 0, 1.1, 1, rect(1, 2, -1, 1))).toBe(true)
  })
})

describe('sameFootprint', () => {
  it('逐点相等返回 true', () => {
    const a = rectFootprint(0, 4, 0, 3)
    expect(sameFootprint(a, rectFootprint(0, 4, 0, 3))).toBe(true)
  })

  it('长度不等返回 false', () => {
    const a = rectFootprint(0, 4, 0, 3)
    expect(sameFootprint(a, a.slice(0, 3))).toBe(false)
  })

  it('逐点差（含浮点噪声）返回 false', () => {
    const a = rectFootprint(0, 4, 0, 3)
    const b = a.map((p) => ({ x: p.x + 1e-3, z: p.z }))
    expect(sameFootprint(a, b)).toBe(false)
  })
})

describe('translateRoom（移动房间带动家具与嵌套，保持相对关系）', () => {
  function roomWithNested(): RoomNode {
    return {
      id: 'r',
      name: '主卧',
      type: 'room',
      footprint: rectFootprint(0, 5, 0, 4),
      height: 2.8,
      doors: [],
      windows: [],
      furniture: [
        {
          id: 'f1',
          name: '床',
          type: 'furniture',
          dimensions: { length: 2, width: 1.5, height: 0.5 },
          position: { x: 1, y: 0.25, z: 1 },
        },
      ],
      nestedRooms: [
        {
          id: 'bath',
          name: '卫生间',
          type: 'room',
          footprint: rectFootprint(4, 5, 3, 4),
          height: 2.8,
          doors: [],
          windows: [],
          furniture: [
            {
              id: 'f2',
              name: '马桶',
              type: 'furniture',
              dimensions: { length: 0.6, width: 0.5, height: 0.4 },
              position: { x: 4.5, y: 0.2, z: 3.5 },
            },
          ],
          nestedRooms: [],
        },
      ],
    }
  }

  it('足迹/家具/嵌套房间递归同量平移，内部相对关系不变', () => {
    const room = translateRoom(roomWithNested(), 3, -2)
    expect(room.footprint[0]).toEqual({ x: 3, z: -2 })
    expect(room.furniture[0]!.position).toEqual({ x: 4, y: 0.25, z: -1 })
    const bath = room.nestedRooms[0]!
    expect(bath.footprint[0]).toEqual({ x: 7, z: 1 })
    // 嵌套房间内的家具也平移
    expect(bath.furniture[0]!.position).toEqual({ x: 7.5, y: 0.2, z: 1.5 })
    // 相对关系：床相对房间中心 (2.5, 2) 偏移 (-1.5, -1) 保持不变
    const center = { x: (3 + 8) / 2, z: (-2 + 2) / 2 }
    expect(room.furniture[0]!.position.x - center.x).toBeCloseTo(-1.5, 9)
    expect(room.furniture[0]!.position.z - center.z).toBeCloseTo(-1, 9)
  })
})

describe('findRoomInList（id 优先、名称回退，坑 71）', () => {
  const rooms: RoomNode[] = [
    {
      id: 'r1',
      name: '客厅',
      type: 'room',
      footprint: rectFootprint(0, 5, 0, 4),
      height: 2.8,
      doors: [],
      windows: [],
      furniture: [],
      nestedRooms: [
        {
          id: 'r2',
          name: '主卧卫生间',
          type: 'room',
          footprint: rectFootprint(4, 5, 3, 4),
          height: 2.8,
          doors: [],
          windows: [],
          furniture: [],
          nestedRooms: [],
        },
      ],
    },
    {
      id: 'r3',
      name: '书房',
      type: 'room',
      footprint: rectFootprint(0, 5, 0, 4),
      height: 2.8,
      doors: [],
      windows: [],
      furniture: [],
      nestedRooms: [],
    },
  ]

  it('id 精确命中优先于名称', () => {
    expect(findRoomInList(rooms, 'r1')?.name).toBe('客厅')
    expect(findRoomInList(rooms, '客厅')?.id).toBe('r1')
  })

  it('名称回退命中嵌套房间（深度优先）', () => {
    expect(findRoomInList(rooms, '主卧卫生间')?.id).toBe('r2')
  })

  it('名称恰为他人 id 时按 id 命中（id 优先语义）', () => {
    // 把 r3 的名字改成 r1 的 id，查 'r1' 应命中 id=r1 的房间而非名字巧合的房间
    const [a, , c] = rooms
    const weird: RoomNode[] = [a!, { ...c!, name: 'r1' }]
    expect(findRoomInList(weird, 'r1')?.id).toBe('r1')
    expect(findRoomInList(weird, 'r1')?.name).toBe('客厅')
  })

  it('未命中返回 null', () => {
    expect(findRoomInList(rooms, '不存在')).toBeNull()
  })
})

describe('edgeMetaOf（环边统一解析：axis/line/start/length/dir，坑 39 约定）', () => {
  it('矩形足迹四边：0=南 1=东 2=北 3=西，start 取 min 端（坑 37）', () => {
    const fp = rectFootprint(1, 5, 2, 6)
    const south = edgeMetaOf(fp, 0)!
    expect(south).toMatchObject({ axis: 'x', line: 2, start: 1, length: 4, dir: 'south' })
    const east = edgeMetaOf(fp, 1)!
    expect(east).toMatchObject({ axis: 'z', line: 5, start: 2, length: 4, dir: 'east' })
    const north = edgeMetaOf(fp, 2)!
    expect(north).toMatchObject({ axis: 'x', line: 6, start: 1, length: 4, dir: 'north' })
    const west = edgeMetaOf(fp, 3)!
    expect(west).toMatchObject({ axis: 'z', line: 1, start: 2, length: 4, dir: 'west' })
  })

  it('负下标/越界下标回绕到环内', () => {
    const fp = rectFootprint(0, 4, 0, 3)
    expect(edgeMetaOf(fp, -1)!.dir).toBe('west')
    expect(edgeMetaOf(fp, 4)!.dir).toBe('south')
  })

  it('非轴对齐边返回 null', () => {
    const fp: Point2D[] = [
      { x: 0, z: 0 },
      { x: 2, z: 1 }, // 斜边
      { x: 2, z: 2 },
      { x: 0, z: 2 },
    ]
    expect(edgeMetaOf(fp, 0)).toBeNull()
    expect(edgeMetaOf(fp, 1)).not.toBeNull()
  })

  it('退化（零长）边返回 null', () => {
    const fp: Point2D[] = [
      { x: 0, z: 0 },
      { x: 0, z: 0 }, // 重复点 = 零长边
      { x: 2, z: 0 },
      { x: 2, z: 2 },
      { x: 0, z: 2 },
    ]
    expect(edgeMetaOf(fp, 0)).toBeNull()
    // 退化边之后的下标按几何匹配，不因过滤错位（坑 112 回归）
    expect(edgeMetaOf(fp, 2)!.dir).toBe('east')
  })

  it('L 形足迹：同方向多边各自按常量线判定方向', () => {
    // L 形：西侧凹陷（0,0)→(3,0)→(3,1)→(1,1)→(1,3)→(0,3)
    const fp: Point2D[] = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 1 },
      { x: 1, z: 1 },
      { x: 1, z: 3 },
      { x: 0, z: 3 },
    ]
    expect(edgeMetaOf(fp, 0)!.dir).toBe('south') // 南墙 (0,0)-(3,0)
    expect(edgeMetaOf(fp, 1)!.dir).toBe('east') // 东墙 (3,0)-(3,1)
    // 凹边 (3,1)-(1,1) 的常量线 z=1 低于包围盒中心 z=1.5 → 判 south：
    // 与既有实现（footprintEdges/edgeDirIndex 等）的「常量线 vs 包围盒中心」约定一致，
    // 凹多边形的方向为近似判定（渲染/门推导按此确定性工作）
    expect(edgeMetaOf(fp, 2)!.dir).toBe('south')
    expect(edgeMetaOf(fp, 3)!.dir).toBe('west') // 西墙内段 (1,1)-(1,3)
    expect(edgeMetaOf(fp, 4)!.dir).toBe('north') // 凸出北段 (1,3)-(0,3)
    expect(edgeMetaOf(fp, 5)!.dir).toBe('west') // 西墙外段 (0,3)-(0,0)
  })

  it('空环返回 null', () => {
    expect(edgeMetaOf([], 0)).toBeNull()
  })
})
