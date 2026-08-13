import { describe, expect, it } from 'vitest'
import {
  collectWallHitEdges,
  dragVertexFootprint,
  footprintIsRect,
  footprintValid,
  hitWallOnEdge,
  mergeRoomsLayout,
  nearestFootprintVertex,
  pointInFootprint,
  segmentsIntersect,
  snapRoomTranslation,
  snapToGrid,
  splitRoomLayout,
  unionRectOf,
} from './planEdit'
import { footprintBounds } from './footprint'
import { emptyScene, executeOps } from './executor'
import { WALL_THICKNESS } from './roomGeometry'
import type { Point2D, RoomNode, SceneModel } from '../types/model'
import type { Op } from '../types/ops'

const rect = (cx: number, cz: number, len: number, wid: number): Point2D[] => [
  { x: cx - len / 2, z: cz - wid / 2 },
  { x: cx + len / 2, z: cz - wid / 2 },
  { x: cx + len / 2, z: cz + wid / 2 },
  { x: cx - len / 2, z: cz + wid / 2 },
]

/** 便捷：4×3 矩形房间（含家具/嵌套/开洞），custom 平铺 */
function baseScene(): SceneModel {
  return executeOps(emptyScene(), [
    {
      op: 'macro',
      name: 'custom',
      params: {
        rooms: [
          {
            id: 'r',
            name: '客厅',
            dimensions: { length: 4, width: 3, height: 2.8 },
            position: { x: 0, y: 1.4, z: 0 },
          },
        ],
      },
    },
  ] as Op[]).scene
}

function roomOf(scene: SceneModel, id = 'r'): RoomNode {
  const found = (scene.root.levels[0]!.rooms.find((r) => r.id === id) ?? null) as RoomNode | null
  if (!found) throw new Error(`room ${id} not found`)
  return found
}

describe('planEdit - 网格吸附与足迹校验', () => {
  it('snapToGrid 吸附到 0.1 整数倍', () => {
    expect(snapToGrid(1.2345)).toBeCloseTo(1.2, 10)
    expect(snapToGrid(-0.96)).toBeCloseTo(-1.0, 10)
    expect(snapToGrid(2.0)).toBeCloseTo(2.0, 10)
  })

  it('pointInFootprint：矩形与 L 形命中/未命中', () => {
    expect(pointInFootprint(rect(0, 0, 4, 3), 0, 0)).toBe(true)
    expect(pointInFootprint(rect(0, 0, 4, 3), 2.1, 0)).toBe(false)
    const l: Point2D[] = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 3 },
      { x: 1.5, z: 3 },
      { x: 1.5, z: 1.5 },
      { x: 0, z: 1.5 },
    ]
    // 南排 + 东北角为内部，西北缺口为外部
    expect(pointInFootprint(l, 0.5, 0.5)).toBe(true)
    expect(pointInFootprint(l, 2, 0.5)).toBe(true)
    expect(pointInFootprint(l, 2, 2)).toBe(true)
    expect(pointInFootprint(l, 0.25, 2)).toBe(false)
    expect(pointInFootprint(l, 1.2, 2.2)).toBe(false)
  })

  it('footprintIsRect：矩形是，L 形/五点环不是', () => {
    expect(footprintIsRect(rect(0, 0, 4, 3))).toBe(true)
    expect(
      footprintIsRect([
        { x: 0, z: 0 },
        { x: 3, z: 0 },
        { x: 3, z: 3 },
        { x: 1.5, z: 3 },
        { x: 1.5, z: 1.5 },
        { x: 0, z: 1.5 },
      ]),
    ).toBe(false)
  })

  it('segmentsIntersect：垂直/共线/贴边判定', () => {
    // 垂直相交
    expect(
      segmentsIntersect({ x: 0, z: -1 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 1, z: 0 }),
    ).toBe(true)
    // 平行不共线
    expect(segmentsIntersect({ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 0, z: 1 }, { x: 2, z: 1 })).toBe(
      false,
    )
    // 共线区间分离
    expect(segmentsIntersect({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 })).toBe(
      false,
    )
    // 共线端点贴边 → 相交（自触非法）
    expect(segmentsIntersect({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 })).toBe(
      true,
    )
  })

  it('footprintValid：拒绝非正交/过短/自交', () => {
    expect(footprintValid(rect(0, 0, 4, 3))).toBe(true)
    // 非正交边
    expect(
      footprintValid([
        { x: 0, z: 0 },
        { x: 3, z: 1 },
        { x: 3, z: 3 },
        { x: 0, z: 3 },
      ]),
    ).toBe(false)
    // 过短边（< 0.3）
    expect(
      footprintValid([
        { x: 0, z: 0 },
        { x: 0.1, z: 0 },
        { x: 0.1, z: 3 },
        { x: 0, z: 3 },
      ]),
    ).toBe(false)
    // 自交（沙漏形）
    expect(
      footprintValid([
        { x: -1, z: -1 },
        { x: 1, z: -1 },
        { x: -1, z: 1 },
        { x: 1, z: 1 },
      ]),
    ).toBe(false)
  })
})

describe('planEdit - 顶点拖拽（正交约束）', () => {
  it('拖东南角：被拖顶点取指针网格点，相邻顶点沿边滑行，其余不动', () => {
    const fp = rect(0, 0, 4, 3) // 西南(-2,-1.5) 东南(2,-1.5) 东北(2,1.5) 西北(-2,1.5)
    // 拖东南角（idx=1）到 (1, 2)：前驱（西南角）z 滑到 2，后继（东北角）x 滑到 1
    const next = dragVertexFootprint(fp, 1, { x: 1, z: 2 })!
    expect(next[0]).toEqual({ x: -2, z: 2 }) // 西南角沿西墙滑行
    expect(next[1]).toEqual({ x: 1, z: 2 })
    expect(next[2]).toEqual({ x: 1, z: 1.5 }) // 东北角沿北墙滑行
    expect(next[3]).toEqual({ x: -2, z: 1.5 })
    expect(footprintValid(next)).toBe(true)
    // 指针自动网格吸附
    const snapped = dragVertexFootprint(fp, 1, { x: 1.043, z: 1.987 })!
    expect(snapped[1]!.x).toBeCloseTo(1, 10)
    expect(snapped[1]!.z).toBeCloseTo(2, 10)
  })

  it('拖西北角（垂直边在前）对称成立', () => {
    const fp = rect(0, 0, 4, 3)
    const next = dragVertexFootprint(fp, 3, { x: -1, z: 2 })!
    expect(next[2]).toEqual({ x: 2, z: 2 }) // 东北角沿北墙滑行
    expect(next[3]).toEqual({ x: -1, z: 2 })
    expect(next[0]).toEqual({ x: -1, z: -1.5 }) // 西南角沿南墙滑行
    expect(next[1]).toEqual({ x: 2, z: -1.5 })
  })

  it('拖出退化（边过短）/ 自交 → 拒绝返回 null', () => {
    const fp = rect(0, 0, 4, 3)
    // 东南角拖到与西墙距离 < 0.3 → 南边过短
    const tooShort = dragVertexFootprint(fp, 1, { x: -1.9, z: 1.6 })
    expect(tooShort).toBeNull()
    // 非正交足迹直接拒绝
    const bad = dragVertexFootprint(
      [
        { x: 0, z: 0 },
        { x: 3, z: 1 },
        { x: 3, z: 3 },
        { x: 0, z: 3 },
      ],
      1,
      { x: 2, z: 1 },
    )
    expect(bad).toBeNull()
  })

  it('L 形拖内凹角拖出边界 → 边相交自交拒绝', () => {
    const l: Point2D[] = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 3 },
      { x: 1.5, z: 3 },
      { x: 1.5, z: 1.5 },
      { x: 0, z: 1.5 },
    ]
    // 内凹角拖到南排上方：拖出的边与东墙（x=3）相交 → 自交拒绝
    const crossed = dragVertexFootprint(l, 4, { x: 3.5, z: 0.5 })
    expect(crossed).toBeNull()
  })

  it('L 形足迹拖顶点：拖出内凹角形成合法正交多边形', () => {
    const l: Point2D[] = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 3 },
      { x: 1.5, z: 3 },
      { x: 1.5, z: 1.5 },
      { x: 0, z: 1.5 },
    ]
    // 拖内凹角 (1.5, 1.5) 到 (2, 2)：前驱 (1.5,3) 沿 x=1.5 滑到 (2,3)，后继 (0,1.5) 沿 z=1.5 滑到 (0,2)
    const next = dragVertexFootprint(l, 4, { x: 2, z: 2 })!
    expect(next[3]).toEqual({ x: 2, z: 3 })
    expect(next[4]).toEqual({ x: 2, z: 2 })
    expect(next[5]).toEqual({ x: 0, z: 2 })
    expect(footprintValid(next)).toBe(true)
  })

  it('nearestFootprintVertex 命中阈值内的顶点', () => {
    const fp = rect(0, 0, 4, 3)
    expect(nearestFootprintVertex(fp, 2.1, -1.4)).toBe(1)
    expect(nearestFootprintVertex(fp, 5, 5)).toBeNull()
  })
})

describe('planEdit - 平移贴墙吸附', () => {
  it('邻居墙线差 ≤ 阈值时吸附对齐', () => {
    const moving = rect(2, 0, 3, 3)
    const neighbor = rect(-3, 0, 3, 3) // 西侧房间，东墙 x=-1.5
    // 拖到东墙线差 0.2（< 0.25）处：移动后西墙 x = 2-1.5+dx ... 计算：移动后 moving 中心 x = 2+dx，
    // 西墙 = 2+dx-1.5。要与邻居东墙 -1.5 对齐 → dx = -1.5 - 0.5 = -2 → 吸附到 -2（而非原 dx=-1.8）
    const r = snapRoomTranslation(moving, [neighbor], -1.8, 0)
    expect(r.dx).toBeCloseTo(-2, 10)
    expect(r.dz).toBeCloseTo(0, 10)
  })

  it('网格吸附先于边对齐；线差过大不吸附', () => {
    const moving = rect(2, 0, 3, 3)
    const neighbor = rect(-3, 0, 3, 3)
    const far = snapRoomTranslation(moving, [neighbor], -1.2, 0) // 线差 0.3 > 0.25
    expect(far.dx).toBeCloseTo(-1.2, 10)
    const grid = snapRoomTranslation(moving, [], 0.043, -0.087)
    expect(grid.dx).toBeCloseTo(0, 10)
    expect(grid.dz).toBeCloseTo(-0.1, 10)
  })

  it('区间无重叠的邻居边不吸附（防垂直错位）', () => {
    const moving = rect(2, 0, 3, 3) // z ∈ [-1.5, 1.5]
    const neighbor = rect(-3, 8, 3, 3) // 东墙 z ∈ [6.5, 9.5] 与移动房间无重叠
    const r = snapRoomTranslation(moving, [neighbor], -1.6, 0)
    expect(r.dx).toBeCloseTo(-1.6, 10)
  })
})

describe('planEdit - 拆房布局', () => {
  it('splitRoomLayout 竖切：家具/嵌套按中心归属、开洞重映射、非矩形/太靠边拒绝', () => {
    const scene = baseScene()
    const room: RoomNode = {
      ...roomOf(scene),
      furniture: [
        {
          id: 'f1',
          type: 'furniture',
          name: '沙发',
          dimensions: { length: 2, width: 0.9, height: 0.9 },
          position: { x: -1, y: 0.45, z: 0 },
        },
        {
          id: 'f2',
          type: 'furniture',
          name: '茶几',
          dimensions: { length: 0.8, width: 0.6, height: 0.4 },
          position: { x: 1, y: 0.2, z: 0 },
        },
      ],
      nestedRooms: [
        {
          id: 'n',
          type: 'room',
          name: '主卧卫生间',
          footprint: rect(1.4, 0, 1.2, 1.2),
          height: 2.8,
          doors: [],
          windows: [],
          furniture: [],
          nestedRooms: [],
        },
      ],
      doors: [{ edgeIndex: 1, from: 0.5, to: 1.4, width: 0.9 }], // 东墙门 → b
      windows: [
        { edgeIndex: 0, from: 0.5, to: 2.0, width: 1.5 }, // 南墙窗，world x ∈ [-1.5, 0] → a
        { edgeIndex: 2, from: 1.0, to: 3.0, width: 2.0 }, // 北墙窗，world x ∈ [-1, 1] 跨切线 → 丢弃
      ],
    }
    const split = splitRoomLayout(room, 'x', 0.0, 'r2', '客厅2')!
    const a = split.a
    const b = split.b
    const ab = footprintBounds(a.footprint)
    const bb = footprintBounds(b.footprint)
    expect(ab.maxX).toBeCloseTo(0, 5)
    expect(bb.minX).toBeCloseTo(0, 5)
    // 家具归属
    expect(a.furniture.map((f) => f.id)).toEqual(['f1'])
    expect(b.furniture.map((f) => f.id)).toEqual(['f2'])
    // 嵌套归属（中心 x=1.4 → b）
    expect(a.nestedRooms).toHaveLength(0)
    expect(b.nestedRooms.map((n) => n.id)).toEqual(['n'])
    // 开洞：南墙窗 → a（局部不变）；东墙门 → b（东墙起点不变）；北墙窗跨切线 → 丢弃
    expect(a.doors).toHaveLength(0)
    expect(a.windows).toHaveLength(1)
    expect(a.windows[0]!.edgeIndex).toBe(0)
    expect(a.windows[0]!.from).toBeCloseTo(0.5, 5)
    expect(a.windows[0]!.to).toBeCloseTo(2.0, 5)
    expect(b.doors).toHaveLength(1)
    expect(b.doors[0]!.edgeIndex).toBe(1)
    expect(b.windows).toHaveLength(0)
    // 拒绝：非矩形 / 切线太靠边（0.1 < 1m）
    const l: Point2D[] = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 3 },
      { x: 1.5, z: 3 },
      { x: 1.5, z: 1.5 },
      { x: 0, z: 1.5 },
    ]
    expect(splitRoomLayout({ ...room, footprint: l }, 'x', 1.0, 'r2', 'r2')).toBeNull()
    expect(splitRoomLayout(room, 'x', -1.9, 'r2', 'r2')).toBeNull()
  })
})

describe('planEdit - 合并布局', () => {
  it('unionRectOf：并集矩形判定', () => {
    const a = { minX: -3, maxX: 0, minZ: -1.5, maxZ: 1.5 }
    const b = { minX: 0, maxX: 3, minZ: -1.5, maxZ: 1.5 }
    expect(unionRectOf(a, b)).toEqual({ minX: -3, maxX: 3, minZ: -1.5, maxZ: 1.5 })
    // 错位 → 非矩形
    expect(unionRectOf(a, { ...b, minZ: -1, maxZ: 2 })).toBeNull()
  })

  it('mergeRoomsLayout：家具/嵌套并入、开洞重映射（共墙丢弃、东墙平移）', () => {
    const scene = baseScene()
    const keep: RoomNode = {
      ...roomOf(scene),
      name: '客厅',
      furniture: [
        {
          id: 'f1',
          type: 'furniture',
          name: '沙发',
          dimensions: { length: 2, width: 0.9, height: 0.9 },
          position: { x: -1, y: 0.45, z: 0 },
        },
      ],
      doors: [
        { edgeIndex: 1, from: 0.5, to: 1.4, width: 0.9 }, // 东墙门（共墙）→ 合并后丢弃
        { edgeIndex: 0, from: 0.5, to: 1.5, width: 1.0 }, // 南墙窗 → 保留（起点不变）
      ],
      windows: [],
      nestedRooms: [
        {
          id: 'n',
          type: 'room',
          name: '主卧卫生间',
          footprint: rect(1.4, 0, 1.2, 1.2),
          height: 2.8,
          doors: [],
          windows: [],
          furniture: [],
          nestedRooms: [],
        },
      ],
    }
    const remove: RoomNode = {
      ...roomOf(scene),
      id: 'b',
      name: '餐厅',
      footprint: rect(3, 0, 2, 3), // x ∈ [2, 4]
      furniture: [
        {
          id: 'f2',
          type: 'furniture',
          name: '餐桌',
          dimensions: { length: 1.2, width: 0.8, height: 0.75 },
          position: { x: 3.2, y: 0.375, z: 0 },
        },
      ],
      doors: [
        { edgeIndex: 1, from: 0.5, to: 1.4, width: 0.9 }, // 东墙门 → 保留（合并后东墙起点 minZ 不变）
      ],
      windows: [{ edgeIndex: 0, from: 0.5, to: 1.5, width: 1.0 }], // 南墙窗 → 保留，平移 +4（新 minX=4）
      nestedRooms: [],
    }
    const merged = mergeRoomsLayout(keep, remove)!
    const mb = footprintBounds(merged.footprint)
    expect(mb.maxX - mb.minX).toBeCloseTo(6, 5)
    expect(merged.furniture.map((f) => f.id).sort()).toEqual(['f1', 'f2'])
    expect(merged.nestedRooms.map((n) => n.id)).toEqual(['n'])
    // keep 的南墙门保留（起点不变）；remove 的东墙门保留（合并后东墙起点 minZ 不变）；共墙上的门丢弃
    expect(merged.doors).toHaveLength(2)
    const keepDoor = merged.doors.find((d) => d.edgeIndex === 0)!
    expect(keepDoor.from).toBeCloseTo(0.5, 5)
    const removeDoor = merged.doors.find((d) => d.edgeIndex === 1)!
    expect(removeDoor.from).toBeCloseTo(0.5, 5)
    // remove 的南墙窗保留并平移到合并后的南墙（起点 -2 → from 4.5）
    expect(merged.windows).toHaveLength(1)
    const removeWin = merged.windows.find((w) => w.from > 3)!
    expect(removeWin.from).toBeCloseTo(0.5 + 4, 5)
  })

  it('mergeRoomsLayout：非矩形/并集非矩形返回 null', () => {
    const scene = baseScene()
    const keep = roomOf(scene)
    const l: Point2D[] = [
      { x: 4, z: 0 },
      { x: 7, z: 0 },
      { x: 7, z: 3 },
      { x: 5.5, z: 3 },
      { x: 5.5, z: 1.5 },
      { x: 4, z: 1.5 },
    ]
    expect(mergeRoomsLayout(keep, { ...keep, id: 'l', footprint: l })).toBeNull()
    expect(mergeRoomsLayout(keep, { ...keep, id: 'b', footprint: rect(3, 1, 2, 2) })).toBeNull()
  })
})

describe('planEdit - 墙命中（点墙放门窗）', () => {
  it('collectWallHitEdges 与 hitWallOnEdge：命中实心墙/入户门段、区分房间', () => {
    const scene = baseScene()
    const edges = collectWallHitEdges(scene, 'south')
    // 南墙（z=-1.5）偏侧命中实心墙：中点在 (1.5, -1.5)
    const hit = hitWallOnEdge(edges, 1.5, -1.4)!
    expect(hit.edge.roomId).toBe('r')
    expect(hit.edge.ringIndex).toBe(0) // 南墙
    expect(hit.seg.kind).toBe('wall')
    expect(hit.along).toBeCloseTo(1.5, 5) // 沿边世界坐标（边起点 minX=-2 为 0 约定）
    // 南墙正中是入户门段（入口方向 south，唯一房间即入口房间）
    const entrance = hitWallOnEdge(edges, 0, -1.4)!
    expect(entrance.seg.kind).toBe('door')
    expect(entrance.seg.entrance).toBe(true)
    // 距墙太远 → 未命中
    expect(hitWallOnEdge(edges, 0, 2)).toBeNull()
    // 命中另一面墙（东墙 x=2）
    const east = hitWallOnEdge(edges, 1.9, 0)!
    expect(east.edge.ringIndex).toBe(1)
  })

  it('显式开洞后命中的是 door 段（可据此删除开洞）', () => {
    const scene = executeOps(baseScene(), [
      { op: 'setOpenings', roomId: 'r', side: 'south', kind: 'door' },
    ] as Op[]).scene
    const edges = collectWallHitEdges(scene, 'south')
    // 门居中在南墙 local [1.55, 2.45] → world x ∈ [-0.45, 0.45]
    const hit = hitWallOnEdge(edges, 0, -1.4)!
    expect(hit.seg.kind).toBe('door')
    // 门外的墙仍是 wall
    const wall = hitWallOnEdge(edges, 1.5, -1.4)!
    expect(wall.seg.kind).toBe('wall')
  })

  it('WALL_THICKNESS 外扩墙与相邻房间的墙都能命中', () => {
    const scene = executeOps(emptyScene(), [
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'a',
              name: '客厅',
              dimensions: { length: 3, width: 3, height: 2.8 },
              position: { x: -1.5, y: 1.4, z: 0 },
            },
            {
              id: 'b',
              name: '卧室',
              dimensions: { length: 3, width: 3, height: 2.8 },
              position: { x: 1.5, y: 1.4, z: 0 },
            },
          ],
        },
      },
    ] as Op[]).scene
    const edges = collectWallHitEdges(scene, 'south')
    // 两房间共墙 x=0（共享墙只由一方渲染为实心/门）
    const shared = hitWallOnEdge(edges, 0, -1.4)
    expect(shared).not.toBeNull()
    const totalWall = edges
      .filter((e) => Math.abs(e.line - 0) < WALL_THICKNESS + 1e-6)
      .map((e) => e.segments.filter((s) => s.kind !== 'open').length)
    // 至少一方渲染实心墙/门（非 open）
    expect(totalWall.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })
})
