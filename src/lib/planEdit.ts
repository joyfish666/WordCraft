import { walkRooms } from './planGeometry'
import { computeAllWallPlansCached, type WallSegment } from './roomGeometry'
import { footprintBounds, footprintCenter, rectFootprint, translateFootprint, type Bounds } from './footprint'
import type { Opening, Point2D, RoomNode, SceneModel } from '../types/model'
import type { Dir } from '../types/ops'

/**
 * 平面图自由编辑（design.md §6，P4）的纯几何函数：
 * 网格吸附、正交顶点拖拽、足迹合法性校验、房间/墙命中、平移贴墙吸附、拆房/合并布局。
 * 全部无副作用，编辑器（PlanEditLayer）与执行器（executor.ts）共用；
 * 顶点的正交约束（边保持水平/垂直）与自交拒绝（notes §5.5）在这里统一实现。
 */

/** 网格吸附步长（米）：编辑坐标一律吸附到 0.1 的整数倍，保证确定性 */
export const SNAP_STEP = 0.1
/** 顶点拖拽后每条边的最小长度（米）：过短视为退化，拒绝 */
export const MIN_EDGE_LENGTH = 0.3
/** 拆房/合并的最小房间边长（米） */
export const MIN_ROOM_SIDE = 1.0
/** 点墙放门窗时指针距墙线的最大距离（米） */
export const WALL_HIT_THRESHOLD = 0.4
/** 拖房间平移时贴墙吸附的最大线差（米） */
export const WALL_SNAP_THRESHOLD = 0.25
/** 窗洞默认宽度（米），与执行器 setOpenings 默认一致 */
export const WINDOW_WIDTH = 1.5

const EPS = 1e-6

/** 数值吸附到网格：四舍五入到 step 的整数倍 */
export function snapToGrid(v: number, step = SNAP_STEP): number {
  return Math.round(v / step) * step
}

/** 点吸附到网格 */
export function snapPoint(p: Point2D): Point2D {
  return { x: snapToGrid(p.x), z: snapToGrid(p.z) }
}

/** 点是否落在足迹内部（射线法，含边界） */
export function pointInFootprint(fp: Point2D[], x: number, z: number): boolean {
  let inside = false
  const n = fp.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = fp[i]
    const b = fp[j]
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** 是否为矩形足迹（4 个顶点的轴对齐正交环且面积非零） */
export function footprintIsRect(fp: Point2D[]): boolean {
  if (fp.length !== 4) return false
  const b = footprintBounds(fp)
  const area = (b.maxX - b.minX) * (b.maxZ - b.minZ)
  if (area < MIN_EDGE_LENGTH * MIN_EDGE_LENGTH) return false
  // 四顶点必须落在包围盒角上（轴对齐正交环且不自交）
  const corners = [
    { x: b.minX, z: b.minZ },
    { x: b.maxX, z: b.minZ },
    { x: b.maxX, z: b.maxZ },
    { x: b.minX, z: b.maxZ },
  ]
  for (const p of fp) {
    if (!corners.some((c) => Math.abs(c.x - p.x) < EPS && Math.abs(c.z - p.z) < EPS)) return false
  }
  return true
}

/** 轴对齐线段区间重叠（含贴边：自触视为非法，notes §5.5 自交拒绝） */
function rangesOverlap(a1: number, a2: number, b1: number, b2: number): boolean {
  const lo = Math.max(Math.min(a1, a2), Math.min(b1, b2))
  const hi = Math.min(Math.max(a1, a2), Math.max(b1, b2))
  return hi - lo >= -EPS
}

/** 轴对齐线段是否相交（平行共线看区间重叠；垂直看交点落入两段区间） */
export function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const aH = Math.abs(a.z - b.z) < EPS
  const cH = Math.abs(c.z - d.z) < EPS
  if (aH === cH) {
    if (aH) {
      if (Math.abs(a.z - c.z) >= EPS) return false
      return rangesOverlap(a.x, b.x, c.x, d.x)
    }
    if (Math.abs(a.x - c.x) >= EPS) return false
    return rangesOverlap(a.z, b.z, c.z, d.z)
  }
  const horiz = aH ? a : c
  const hEnd = aH ? b : d
  const vert = aH ? c : a
  const vEnd = aH ? d : b
  const hx = [Math.min(horiz.x, hEnd.x), Math.max(horiz.x, hEnd.x)] as const
  const vz = [Math.min(vert.z, vEnd.z), Math.max(vert.z, vEnd.z)] as const
  return (
    vert.x >= hx[0] - EPS &&
    vert.x <= hx[1] + EPS &&
    horiz.z >= vz[0] - EPS &&
    horiz.z <= vz[1] + EPS
  )
}

/**
 * 足迹合法性（notes §5.5，P4 顶点约束）：
 * - 每边轴对齐（水平/垂直）且长度 ≥ minEdge；
 * - 非相邻边不得相交（含贴边自触：自交/自触多边形拒绝）。
 */
export function footprintValid(fp: Point2D[], opts?: { minEdge?: number }): boolean {
  const minEdge = opts?.minEdge ?? MIN_EDGE_LENGTH
  const n = fp.length
  if (n < 4) return false
  for (let i = 0; i < n; i++) {
    const a = fp[i]
    const b = fp[(i + 1) % n]
    const h = Math.abs(a.z - b.z) < EPS
    const v = Math.abs(a.x - b.x) < EPS
    if (!h && !v) return false
    const len = h ? Math.abs(b.x - a.x) : Math.abs(b.z - a.z)
    if (len < minEdge) return false
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    for (let k = i + 2; k < n; k++) {
      const l = (k + 1) % n
      if (j === k || i === l) continue // 相邻边共享顶点，跳过
      if (segmentsIntersect(fp[i], fp[j], fp[k], fp[l])) return false
    }
  }
  return true
}

/**
 * 正交约束拖顶点（设计 §6「拖顶点改足迹形状」）：
 * 拖动顶点 i 时，与其相邻的两条边保持水平/垂直——被拖顶点取指针网格点，
 * 前驱顶点沿其所属边滑行（只改一个坐标）、后继顶点同理，其余顶点不动。
 * 结果不满足 footprintValid（退化/自交）时返回 null（拒绝该次拖拽）。
 */
export function dragVertexFootprint(
  fp: Point2D[],
  i: number,
  target: Point2D,
): Point2D[] | null {
  const n = fp.length
  if (n < 4) return null
  const idx = ((i % n) + n) % n
  const p = fp[idx]
  const prev = fp[(idx - 1 + n) % n]
  const next = fp[(idx + 1) % n]
  const t = snapPoint(target)
  const out = fp.map((pt) => ({ ...pt }))
  const prevEdgeH = Math.abs(prev.z - p.z) < EPS // 边 idx-1 水平
  const nextEdgeH = Math.abs(p.z - next.z) < EPS // 边 idx 水平
  if (prevEdgeH && !nextEdgeH) {
    // 边 idx-1 水平（prev.z 固定线）、边 idx 垂直（next.x 固定线）
    out[idx] = { x: t.x, z: t.z }
    out[(idx - 1 + n) % n] = { x: prev.x, z: t.z }
    out[(idx + 1) % n] = { x: t.x, z: next.z }
  } else if (!prevEdgeH && nextEdgeH) {
    out[idx] = { x: t.x, z: t.z }
    out[(idx - 1 + n) % n] = { x: t.x, z: prev.z }
    out[(idx + 1) % n] = { x: next.x, z: t.z }
  } else {
    return null // 相邻两边同为水平/垂直：非正交足迹，无法安全拖拽
  }
  return footprintValid(out) ? out : null
}

/** 距离某点最近的足迹顶点（≤ maxDist 时命中，否则 null） */
export function nearestFootprintVertex(
  fp: Point2D[],
  x: number,
  z: number,
  maxDist = 0.4,
): number | null {
  let best = -1
  let bestD = maxDist
  for (let i = 0; i < fp.length; i++) {
    const d = Math.hypot(fp[i].x - x, fp[i].z - z)
    if (d <= bestD) {
      bestD = d
      best = i
    }
  }
  return best >= 0 ? best : null
}

/**
 * 平移贴墙吸附（设计 §6「拖房间平移 … + 邻墙吸附」）：
 * 先网格吸附，再把与邻居边「共线（线差 ≤ threshold）且区间重叠 ≥ 0.5m」的
 * 边对齐到邻居边线（两根轴独立，各取线差最小的邻居）。
 */
export function snapRoomTranslation(
  fp: Point2D[],
  others: Point2D[][],
  dx: number,
  dz: number,
  threshold = WALL_SNAP_THRESHOLD,
): { dx: number; dz: number } {
  dx = snapToGrid(dx)
  dz = snapToGrid(dz)
  const moved = translateFootprint(fp, dx, dz)
  const mb = footprintBounds(moved)

  interface Edge {
    line: number
    a: number
    b: number
  }
  const edgesOf = (f: Point2D[]): { x: Edge[]; z: Edge[] } => {
    const x: Edge[] = []
    const z: Edge[] = []
    for (let i = 0; i < f.length; i++) {
      const p = f[i]
      const q = f[(i + 1) % f.length]
      if (Math.abs(p.z - q.z) < EPS) {
        x.push({ line: p.z, a: Math.min(p.x, q.x), b: Math.max(p.x, q.x) })
      } else {
        z.push({ line: p.x, a: Math.min(p.z, q.z), b: Math.max(p.z, q.z) })
      }
    }
    return { x, z }
  }
  const theirs = others.map(edgesOf)
  const MIN_OVERLAP = 0.5

  const align = (axis: 'x' | 'z', myLines: number[], myRange: [number, number]): number => {
    let best: number | null = null
    let bestDiff = threshold
    for (const line of myLines) {
      for (const other of theirs) {
        for (const e of other[axis]) {
          const diff = Math.abs(e.line - line)
          if (diff > bestDiff) continue
          const overlap = Math.min(myRange[1], e.b) - Math.max(myRange[0], e.a)
          if (overlap < MIN_OVERLAP) continue
          bestDiff = diff
          best = e.line - line
        }
      }
    }
    return best ?? 0
  }

  // 垂直边（z 方向边，常量线为 x）对齐 → 修正 dx；水平边（x 方向边，常量线为 z）对齐 → 修正 dz
  const dxSnap = align('z', [mb.minX, mb.maxX], [mb.minZ, mb.maxZ])
  const dzSnap = align('x', [mb.minZ, mb.maxZ], [mb.minX, mb.maxX])
  return { dx: dx + dxSnap, dz: dz + dzSnap }
}

// ---------------------------------------------------------------------------
// 拆房 / 合并（P4：画墙拆房间 / 合并房间；executor 的 splitRoom/mergeRoom 调用）
// ---------------------------------------------------------------------------

/** 足迹第 i 条边的外向法线方向（按几何判定，不依赖环起点） */
function edgeDirOf(fp: Point2D[], i: number): Dir | null {
  const n = fp.length
  const idx = ((i % n) + n) % n
  const a = fp[idx]
  const b = fp[(idx + 1) % n]
  const h = Math.abs(a.z - b.z) < EPS
  const v = Math.abs(a.x - b.x) < EPS
  if (!h && !v) return null
  const c = footprintBounds(fp)
  if (h) return a.z > c.minZ + (c.maxZ - c.minZ) / 2 ? 'north' : 'south'
  return a.x > c.minX + (c.maxX - c.minX) / 2 ? 'east' : 'west'
}

/** 方向对应的矩形足迹边下标（坑 39 约定：0=南 1=东 2=北 3=西） */
function rectEdgeIndexByDir(dir: Dir): number {
  switch (dir) {
    case 'south':
      return 0
    case 'east':
      return 1
    case 'north':
      return 2
    case 'west':
      return 3
  }
}

/** 方向对应的包围盒边线 */
function lineOf(b: Bounds, dir: Dir): number {
  switch (dir) {
    case 'south':
      return b.minZ
    case 'north':
      return b.maxZ
    case 'east':
      return b.maxX
    case 'west':
      return b.minX
  }
}

/** 方向的沿边轴：南/北边沿 x（起点 = minX），东/西边沿 z（起点 = minZ） */
function alongAxisOf(dir: Dir): 'x' | 'z' {
  return dir === 'south' || dir === 'north' ? 'x' : 'z'
}

/**
 * 把矩形房间的显式开洞映射到新矩形（split/merge 共用）：
 * - 与新矩形同向且共线的边：局部区间按新边起点平移（±EPS 容忍浮点）；
 * - 变成内部墙的边（线不在新矩形边界上）丢弃；
 * - split 时平行于切线的边按切线归属 A/B，跨切线的丢弃。
 */
function remapRectOpenings(
  oldFp: Point2D[],
  newBounds: Bounds,
  openings: Opening[],
  opts: { cutAxis?: 'x' | 'z'; cutPos?: number; keepSide?: 'a' | 'b' } = {},
): Opening[] {
  const oldBounds = footprintBounds(oldFp)
  const out: Opening[] = []
  for (const o of openings) {
    const dir = edgeDirOf(oldFp, o.edgeIndex)
    if (!dir) continue
    if (Math.abs(lineOf(oldBounds, dir) - lineOf(newBounds, dir)) > EPS) continue // 内部墙，丢弃
    const alongX = alongAxisOf(dir) === 'x'
    const oldStart = alongX ? oldBounds.minX : oldBounds.minZ
    const wFrom = oldStart + o.from
    const wTo = oldStart + o.to
    // 平行于切线的边：按切线位置归属 A/B（跨切线丢弃）
    if (opts.cutAxis !== undefined && opts.cutPos !== undefined && alongAxisOf(dir) === opts.cutAxis) {
      const cutPos = opts.cutPos
      if (wTo <= cutPos + EPS) {
        if (opts.keepSide === 'b') continue // 在 A 侧
      } else if (wFrom >= cutPos - EPS) {
        if (opts.keepSide === 'a') continue // 在 B 侧
      } else {
        continue // 跨切线，丢弃
      }
    }
    const newStart = alongX ? newBounds.minX : newBounds.minZ
    const len = alongX ? newBounds.maxX - newBounds.minX : newBounds.maxZ - newBounds.minZ
    const from = Math.min(Math.max(wFrom - newStart, 0), len)
    const to = Math.min(Math.max(wTo - newStart, from), len)
    if (to - from < 1e-6) continue
    out.push({ edgeIndex: rectEdgeIndexByDir(dir), from, to, width: to - from })
  }
  return out
}

/**
 * 拆房布局（画墙拆房间）：矩形房间沿 axis（'x' 竖切 / 'z' 横切）在 position 处切成两间。
 * 原房间保留 id 与西/南部分（a），新房间（b）排到东/北侧；
 * 家具与嵌套房间按中心归属两半；显式开洞按边重映射（跨切线丢弃）。
 * 不满足条件（非矩形 / 切线太靠边）返回 null。
 */
export function splitRoomLayout(
  room: RoomNode,
  axis: 'x' | 'z',
  position: number,
  newId: string,
  newName: string,
): { a: RoomNode; b: RoomNode } | null {
  if (!footprintIsRect(room.footprint)) return null
  const b = footprintBounds(room.footprint)
  const min = axis === 'x' ? b.minX : b.minZ
  const max = axis === 'x' ? b.maxX : b.maxZ
  if (position - min < MIN_ROOM_SIDE || max - position < MIN_ROOM_SIDE) return null

  const aRect =
    axis === 'x'
      ? rectFootprint((b.minX + position) / 2, (b.minZ + b.maxZ) / 2, position - b.minX, b.maxZ - b.minZ)
      : rectFootprint((b.minX + b.maxX) / 2, (b.minZ + position) / 2, b.maxX - b.minX, position - b.minZ)
  const bRect =
    axis === 'x'
      ? rectFootprint((position + b.maxX) / 2, (b.minZ + b.maxZ) / 2, b.maxX - position, b.maxZ - b.minZ)
      : rectFootprint((b.minX + b.maxX) / 2, (position + b.maxZ) / 2, b.maxX - b.minX, b.maxZ - position)

  const inA = (p: Point2D): boolean =>
    axis === 'x' ? p.x < position - EPS : p.z < position - EPS
  const inB = (p: Point2D): boolean =>
    axis === 'x' ? p.x > position + EPS : p.z > position + EPS
  const sideOf = (p: Point2D): boolean => {
    if (inA(p)) return true
    if (inB(p)) return false
    return true // 恰在切线上：归 A（西/南侧，确定性）
  }

  const splitFurniture = room.furniture.reduce<{ a: RoomNode['furniture']; b: RoomNode['furniture'] }>(
    (acc, f) => {
      acc[sideOf(f.position) ? 'a' : 'b'].push({ ...f })
      return acc
    },
    { a: [], b: [] },
  )
  const splitNested = room.nestedRooms.reduce<{ a: RoomNode['nestedRooms']; b: RoomNode['nestedRooms'] }>(
    (acc, n) => {
      acc[sideOf(footprintCenter(n.footprint)) ? 'a' : 'b'].push({ ...n })
      return acc
    },
    { a: [], b: [] },
  )

  const ab = footprintBounds(aRect)
  const bb = footprintBounds(bRect)
  const remap = (openings: Opening[]): { a: Opening[]; b: Opening[] } => ({
    a: remapRectOpenings(room.footprint, ab, openings, {
      cutAxis: axis,
      cutPos: position,
      keepSide: 'a',
    }),
    b: remapRectOpenings(room.footprint, bb, openings, {
      cutAxis: axis,
      cutPos: position,
      keepSide: 'b',
    }),
  })

  const doors = remap(room.doors)
  const windows = remap(room.windows)

  return {
    a: {
      ...room,
      footprint: aRect,
      doors: doors.a,
      windows: windows.a,
      furniture: splitFurniture.a,
      nestedRooms: splitNested.a,
    },
    b: {
      id: newId,
      type: 'room',
      name: newName,
      footprint: bRect,
      height: room.height,
      doors: doors.b,
      windows: windows.b,
      furniture: splitFurniture.b,
      nestedRooms: splitNested.b,
    },
  }
}

/** 两个矩形房间的并集是否为合法矩形（面积守恒），是则返回并集包围盒 */
export function unionRectOf(a: Bounds, c: Bounds): Bounds | null {
  const b = {
    minX: Math.min(a.minX, c.minX),
    maxX: Math.max(a.maxX, c.maxX),
    minZ: Math.min(a.minZ, c.minZ),
    maxZ: Math.max(a.maxZ, c.maxZ),
  }
  const unionArea = (b.maxX - b.minX) * (b.maxZ - b.minZ)
  const sumArea =
    (a.maxX - a.minX) * (a.maxZ - a.minZ) + (c.maxX - c.minX) * (c.maxZ - c.minZ)
  if (Math.abs(unionArea - sumArea) > 1e-6) return null
  return b
}

/**
 * 合并布局（合并房间）：keep 与 remove 并集为合法矩形时合并。
 * keep 保留 id/名称，层高取两者较大值；家具/嵌套房间保持世界坐标直接并入；
 * 显式开洞重映射（变成内部墙的边丢弃，其余按新边起点平移）。
 * 不满足条件返回 null。
 */
export function mergeRoomsLayout(keep: RoomNode, remove: RoomNode): RoomNode | null {
  if (!footprintIsRect(keep.footprint) || !footprintIsRect(remove.footprint)) return null
  const kb = footprintBounds(keep.footprint)
  const rb = footprintBounds(remove.footprint)
  const union = unionRectOf(kb, rb)
  if (!union) return null

  return {
    ...keep,
    footprint: rectFootprint(
      (union.minX + union.maxX) / 2,
      (union.minZ + union.maxZ) / 2,
      union.maxX - union.minX,
      union.maxZ - union.minZ,
    ),
    height: Math.max(keep.height, remove.height),
    furniture: [...keep.furniture, ...remove.furniture],
    nestedRooms: [...keep.nestedRooms, ...remove.nestedRooms],
    doors: [...remapRectOpenings(keep.footprint, union, keep.doors), ...remapRectOpenings(remove.footprint, union, remove.doors)],
    windows: [
      ...remapRectOpenings(keep.footprint, union, keep.windows),
      ...remapRectOpenings(remove.footprint, union, remove.windows),
    ],
  }
}

// ---------------------------------------------------------------------------
// 墙命中（点墙放门窗）：把墙体方案的每段映射成可命中的边（含 footprint 边下标）
// ---------------------------------------------------------------------------

export interface WallHitEdge {
  roomId: string
  /** footprint 顶点环边下标（Opening.edgeIndex 约定，坑 39） */
  ringIndex: number
  axis: 'x' | 'z'
  line: number
  start: number
  length: number
  dir: Dir
  segments: WallSegment[]
}

/** 收集整屋（含嵌套）可命中的墙边：与渲染用 computeAllWallPlans 同源，段几何一致。
 *  走共享缓存（坑 72）：渲染层三个组件同场景引用只算一次墙体方案。 */
export function collectWallHitEdges(
  scene: SceneModel,
  entranceDir: Dir,
  entranceRoomId?: string,
): WallHitEdge[] {
  const plans = computeAllWallPlansCached(scene, entranceDir, entranceRoomId)
  const out: WallHitEdge[] = []
  for (const info of walkRooms(scene.root)) {
    const plan = plans.get(info.node.id)
    if (!plan) continue
    for (const e of plan.edges) {
      const ringIndex = ringIndexOf(info.node.footprint, e)
      if (ringIndex < 0) continue
      out.push({
        roomId: info.node.id,
        ringIndex,
        axis: e.axis,
        line: e.line,
        start: e.start,
        length: e.length,
        dir: e.dir,
        segments: e.segments,
      })
    }
  }
  return out
}

/** 按几何匹配 footprint 顶点环边下标（与 footprintEdges 同约定；退化边无匹配返回 -1） */
function ringIndexOf(
  fp: Point2D[],
  e: { axis: 'x' | 'z'; line: number; start: number; length: number },
): number {
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i]
    const b = fp[(i + 1) % fp.length]
    let axis: 'x' | 'z'
    let line: number
    let start: number
    let length: number
    if (Math.abs(a.z - b.z) < EPS) {
      axis = 'x'
      line = a.z
      start = Math.min(a.x, b.x)
      length = Math.abs(b.x - a.x)
    } else if (Math.abs(a.x - b.x) < EPS) {
      axis = 'z'
      line = a.x
      start = Math.min(a.z, b.z)
      length = Math.abs(b.z - a.z)
    } else {
      continue
    }
    if (
      axis === e.axis &&
      Math.abs(line - e.line) < EPS &&
      Math.abs(start - e.start) < EPS &&
      Math.abs(length - e.length) < EPS
    ) {
      return i
    }
  }
  return -1
}

export interface WallHit {
  edge: WallHitEdge
  /** 命中的墙段（wall/door/window/open） */
  seg: WallSegment
  /** 命中点沿边方向的世界坐标（边起点为 0 约定，坑 37） */
  along: number
}

/** 命中测试：指针点（世界 x/z）距某墙边线 ≤ threshold 且沿边落在某段范围内时返回最近命中 */
export function hitWallOnEdge(
  edges: WallHitEdge[],
  x: number,
  z: number,
  threshold = WALL_HIT_THRESHOLD,
): WallHit | null {
  let best: WallHit | null = null
  let bestDist = threshold
  for (const e of edges) {
    const d = e.axis === 'x' ? Math.abs(z - e.line) : Math.abs(x - e.line)
    if (d > bestDist) continue
    const along = e.axis === 'x' ? x : z
    for (const seg of e.segments) {
      const from = e.start + seg.from
      const to = e.start + seg.to
      if (along < from - 0.15 || along > to + 0.15) continue
      if (d < bestDist || (d === bestDist && best === null)) {
        best = { edge: e, seg, along }
        bestDist = d
      }
    }
  }
  return best
}

/** 共享墙的渲染侧方向（splitRoom 开门用）：'x' 竖切共享东/西墙，'z' 横切共享北/南墙 */
export function sharedWallEdgeDir(axis: 'x' | 'z', ownerIsA: boolean): Dir {
  return axis === 'x' ? (ownerIsA ? 'east' : 'west') : ownerIsA ? 'north' : 'south'
}
