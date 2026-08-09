import type { RoomNode } from '../types/model'
import { footprintCenter } from './footprint'

export type DoorDirection = 'north' | 'south' | 'east' | 'west'

/** 墙体厚度（米） */
export const WALL_THICKNESS = 0.15
/** 门洞宽度（米） */
export const DOOR_WIDTH = 0.9
/** 相邻房间判定：两面墙之间的最大间隙（米） */
export const ADJACENCY_GAP = 0.4

export const WALL_DIRECTIONS: DoorDirection[] = ['north', 'south', 'east', 'west']

const OPPOSITE: Record<DoorDirection, DoorDirection> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
}

/** 封闭房间类型词：名字包含这些词的复合名（如"走廊卫生间"）不应被当作走廊/开放空间 */
const ROOM_TYPE_RE = /卫生间|浴室|卧室|书房|厕所|储物|衣帽|阳台/

/** 判断房间名是否为走廊/连廊（排除"走廊卫生间"等复合名） */
export function isCorridorName(name: string): boolean {
  return /走廊|连廊|过道|通道/.test(name) && !ROOM_TYPE_RE.test(name)
}

/** 判断是否为开放空间（客厅/餐厅/厨房等）：与走廊/开放空间之间不设墙 */
export function isOpenRoom(name: string): boolean {
  return (
    /客厅|餐厅|厨房|起居室|玄关|门厅|走廊|连廊|过道|通道|中庭/.test(name) &&
    !ROOM_TYPE_RE.test(name)
  )
}

/** 判断是否为私密房间（卧室/书房等）：彼此之间不直接开门，经走廊/卫生间连通 */
export function isPrivateRoom(name: string): boolean {
  return /卧室|主卧|次卧|书房|客房|儿童房|榻榻米/.test(name)
}

/** 卫生间的归属房间名：'主卧卫生间'→'主卧'，'走廊卫生间'→'走廊'；非卫生间返回 null */
export function bathroomOwner(name: string): string | null {
  const idx = name.indexOf('卫生间')
  if (idx <= 0) return null
  return name.slice(0, idx)
}

/** 是否为卫生间类房间（命名归属如"主卧卫生间"，或普通"卫生间/浴室/厕所"） */
function isBathroomName(name: string): boolean {
  return bathroomOwner(name) !== null || /卫生间|浴室|厕所/.test(name)
}

/**
 * 兜底计算房间门的朝向：指向整屋中心（整屋中心约定为原点）。
 * 仅用于没有任何相邻房间的房间。
 */
export function doorDirection(room: RoomNode): DoorDirection {
  const c = footprintCenter(room.footprint)
  const vx = -c.x
  const vz = -c.z
  const absX = Math.abs(vx)
  const absZ = Math.abs(vz)
  if (absX < 0.5 && absZ < 0.5) return 'north'
  if (absX >= absZ) return vx > 0 ? 'east' : 'west'
  return vz > 0 ? 'north' : 'south'
}

// ---------------------------------------------------------------------------
// 墙段模型：沿足迹边切分墙段，段类型决定渲染方式
// ---------------------------------------------------------------------------

export type WallSegmentKind = 'wall' | 'door' | 'open' | 'window'

export interface WallSegment {
  /** 沿边方向的区间（局部坐标，边起点为 0，单位米） */
  from: number
  to: number
  kind: WallSegmentKind
  /** 是否为入户门（用于渲染醒目标记） */
  entrance?: boolean
}

/**
 * 一条足迹边的墙体信息：沿边方向（局部 +轴）展开的墙段列表。
 * - 轴对齐正交边：axis 'x' 水平（局部方向 +x）、'z' 垂直（局部方向 +z）；
 * - line 为垂直方向的固定世界坐标，start 为沿边方向起点的世界坐标；
 * - 渲染局部方向与边方向统一（axis 'x' 旋转 0、'z' 旋转 -90°），避免镜像错位（坑 1）。
 */
export interface WallEdge {
  axis: 'x' | 'z'
  line: number
  start: number
  length: number
  /** 外向法线方向 */
  dir: DoorDirection
  /** 该边是否与相邻房间共用（影响地板外扩） */
  shared: boolean
  segments: WallSegment[]
  /** 所属房间 id（computeWallPlan 构造时写入，供邻居查询） */
  roomId?: string
}

export interface WallPlan {
  /** 与 RoomNode.footprint 顶点环一一对应（含退化边过滤）的边 */
  edges: WallEdge[]
}

/** 取指定方向（外向法线）的边；矩形房间每方向恰一条 */
export function edgeOf(plan: WallPlan, dir: DoorDirection): WallEdge | undefined {
  return plan.edges.find((e) => e.dir === dir)
}

/**
 * 墙组的世界锚点：墙段局部坐标以**边起点为 0**（坑 37），
 * 渲染 group 必须锚在边起点（start），世界映射 = start + local；
 * 锚在边中点会让整段墙的中心点偏到边的终点（偏移半个边长，P1 回归实录见 notes 坑 41）。
 * 轴 'x' 边平放；轴 'z' 边渲染时 -90° 旋转（局部 +x → 世界 +z）。
 */
export function wallGroupPosition(
  edge: { axis: 'x' | 'z'; start: number; line: number },
  baseY: number,
): [number, number, number] {
  return edge.axis === 'x' ? [edge.start, baseY, edge.line] : [edge.line, baseY, edge.start]
}

/** 墙段的世界区间（段局部坐标以边起点为 0，坑 37）：世界 = start + [from, to] */
export function segmentWorldRange(edge: WallEdge, seg: WallSegment): { from: number; to: number } {
  return { from: edge.start + seg.from, to: edge.start + seg.to }
}

/** 由房间足迹构造各边墙段（基座：整段实心墙，暂不开洞；段局部坐标以边起点为 0） */
export function footprintEdges(room: RoomNode): WallEdge[] {
  const fp = room.footprint
  const center = footprintCenter(fp)
  const edges: WallEdge[] = []
  const n = fp.length
  for (let i = 0; i < n; i++) {
    const a = fp[i]
    const b = fp[(i + 1) % n]
    const EPS = 1e-6
    let axis: 'x' | 'z'
    let line: number
    let start: number
    let length: number
    let dir: DoorDirection
    if (Math.abs(a.z - b.z) < EPS) {
      // 水平边（沿 x）
      axis = 'x'
      line = a.z
      start = Math.min(a.x, b.x)
      length = Math.abs(b.x - a.x)
      dir = line > center.z + EPS ? 'north' : 'south'
    } else {
      // 垂直边（沿 z）
      axis = 'z'
      line = a.x
      start = Math.min(a.z, b.z)
      length = Math.abs(b.z - a.z)
      dir = line > center.x + EPS ? 'east' : 'west'
    }
    if (length < EPS) continue
    edges.push({
      axis,
      line,
      start,
      length,
      dir,
      shared: false,
      segments: [{ from: 0, to: length, kind: 'wall' }],
    })
  }
  return edges
}

/** 在墙段 [from,to] 范围内靠近中心的位置开一扇门（选择最近的实体墙段） */
function addDoorOnFace(edge: WallEdge, from: number, to: number, markEntrance = false): void {
  const center = (from + to) / 2
  let best: { s: WallSegment; a: number; b: number } | null = null
  let bestDist = Infinity
  for (const s of edge.segments) {
    if (s.kind !== 'wall') continue
    const a = Math.max(s.from, from)
    const b = Math.min(s.to, to)
    if (b - a < 1e-6) continue
    const d = Math.abs((a + b) / 2 - center)
    if (d < bestDist) {
      bestDist = d
      best = { s, a, b }
    }
  }
  if (!best) return
  const segLen = best.b - best.a
  const doorW = Math.min(DOOR_WIDTH, segLen)
  const mid = (best.a + best.b) / 2
  const d0 = mid - doorW / 2
  const d1 = mid + doorW / 2
  edge.segments = splitSegments(edge.segments, d0, d1, 'door')
  if (markEntrance) {
    // 标记刚创建的入户门段
    edge.segments = edge.segments.map((s) =>
      s.kind === 'door' && Math.abs(s.from - d0) < 1e-6 && Math.abs(s.to - d1) < 1e-6
        ? { ...s, entrance: true }
        : s,
    )
  }
}

/** 在 [from,to] 区间上应用指定类型，切分并覆盖既有墙段 */
function splitSegments(
  segs: WallSegment[],
  from: number,
  to: number,
  kind: WallSegmentKind,
): WallSegment[] {
  const out: WallSegment[] = []
  for (const s of segs) {
    if (to <= s.from || from >= s.to) {
      out.push(s)
      continue
    }
    if (s.from < from) out.push({ ...s, to: from })
    out.push({ from: Math.max(s.from, from), to: Math.min(s.to, to), kind })
    if (s.to > to) out.push({ ...s, from: to })
  }
  return out
}

function hasAnyDoor(p: WallPlan): boolean {
  return p.edges.some((e) => e.segments.some((s) => s.kind === 'door'))
}

/** 共享墙持有方：非走廊优先；同为走廊/房间时取 id 较小者（确定性） */
function ownerIsA(a: RoomNode, b: RoomNode): boolean {
  const aC = isCorridorName(a.name)
  const bC = isCorridorName(b.name)
  return aC !== bC ? !aC : a.id < b.id
}

/** 四面实体墙 + 指定方向开一扇门（嵌套房间 / 无相邻信息兜底用） */
export function wallPlanWithDoor(room: RoomNode, dir: DoorDirection): WallPlan {
  const plan: WallPlan = { edges: footprintEdges(room) }
  const target = plan.edges.find((e) => e.dir === dir)
  if (target) addDoorOnFace(target, 0, target.length)
  return plan
}

/** 无相邻信息时的兜底方案：四面墙实体，朝整屋中心的墙开门 */
export function defaultWallPlan(room: RoomNode): WallPlan {
  return wallPlanWithDoor(room, doorDirection(room))
}

/** 嵌套房间的门朝向：指向父房间中心（从父房间进嵌套房间） */
export function nestedDoorDirection(
  node: RoomNode,
  parentCenter: { x: number; z: number },
): DoorDirection {
  const c = footprintCenter(node.footprint)
  const dx = parentCenter.x - c.x
  const dz = parentCenter.z - c.z
  return Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'north' : 'south'
}

export interface WallPlanOptions {
  /** 入户大门所在方向（房屋外墙） */
  entrance?: DoorDirection
  /** 入户门开在哪个房间的外墙（优先于边界推断） */
  entranceRoomId?: string
}

interface NeighborAlongEdge {
  room: RoomNode
  /** 墙局部坐标（边起点为 0） */
  from: number
  to: number
}

// ---------------------------------------------------------------------------
// 显式开洞覆盖层：RoomNode.doors / windows 覆盖推导结果（设计 §3.2）
// ---------------------------------------------------------------------------

/**
 * 应用显式开洞：只覆盖实心墙段（open 开放连通处不重复开洞）。
 * from/to 为开洞在边上的局部区间，超出边范围自动截断；无效开洞静默跳过。
 */
export function applyOpenings(plan: Map<string, WallPlan>, rooms: RoomNode[]): void {
  for (const room of rooms) {
    const p = plan.get(room.id)
    if (!p) continue
    for (const kind of ['doors', 'windows'] as const) {
      for (const op of room[kind]) {
        const edge = p.edges[op.edgeIndex]
        if (!edge) continue
        const from = Math.min(Math.max(op.from, 0), edge.length)
        const to = Math.min(Math.max(op.to, from), edge.length)
        if (to - from < 1e-6) continue
        const out: WallSegment[] = []
        for (const s of edge.segments) {
          if (s.kind !== 'wall' || to <= s.from || from >= s.to) {
            out.push(s)
            continue
          }
          if (s.from < from) out.push({ ...s, to: from })
          out.push({
            from: Math.max(s.from, from),
            to: Math.min(s.to, to),
            kind: kind === 'doors' ? 'door' : 'window',
          })
          if (s.to > to) out.push({ ...s, from: to })
        }
        edge.segments = out
      }
    }
  }
}

/**
 * 计算所有房间的分段墙体方案：
 * - 每面墙（足迹边）按相邻房间切分成段：实体 / 门 / 留空（开放）/ 窗（显式开洞）。
 * - 相邻共用墙只由一方渲染（非走廊优先）；两侧都是开放空间则不设墙。
 * - 部分被相邻房间占用的墙，其余部分按外墙渲染（保证不向外部开口）。
 * - 私密房间（卧室/书房）之间不直接开门，经走廊/卫生间连通。
 * - 外墙始终保留；入口侧外墙居中开入户门。
 * - 显式开洞（RoomNode.doors / windows）覆盖推导结果。
 */
export function computeWallPlan(
  rooms: RoomNode[],
  options: WallPlanOptions = {},
): Map<string, WallPlan> {
  const plan = new Map<string, WallPlan>()
  const edgesByRoom = new Map<string, WallEdge[]>()
  for (const R of rooms) {
    const edges = footprintEdges(R)
    edgesByRoom.set(R.id, edges)
    plan.set(R.id, {
      edges: edges.map((e) => ({ ...e, roomId: R.id })),
    })
  }

  // 卫生间唯一门预扫描：每间卫生间至多一扇推导门（用户显式 setOpenings 可另加）。
  // 优先级：命名归属房间（主卧卫生间 → 主卧）> 走廊 > 邻居中 id 最小者（确定性）；
  // 目标集合为空（无邻居）时该卫生间不参与开门判定。
  const bathroomDoorTargets = new Map<string, Set<string>>()
  for (const R of rooms) {
    if (!isBathroomName(R.name)) continue
    const nbs: RoomNode[] = []
    for (const edge of plan.get(R.id)!.edges) {
      for (const nb of neighborsAlongEdge(edge, rooms, edgesByRoom)) {
        if (!nbs.some((x) => x.id === nb.room.id)) nbs.push(nb.room)
      }
    }
    if (nbs.length === 0) continue
    let targets: RoomNode[]
    const owner = bathroomOwner(R.name)
    const owned = owner !== null ? nbs.filter((x) => x.name === owner) : []
    if (owned.length > 0) {
      targets = owned
    } else {
      const corridor = nbs.filter((x) => isCorridorName(x.name))
      targets =
        corridor.length > 0
          ? corridor
          : [...nbs].sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, 1)
    }
    bathroomDoorTargets.set(R.id, new Set(targets.map((t) => t.id)))
  }

  for (const R of rooms) {
    const p = plan.get(R.id)!
    for (let i = 0; i < p.edges.length; i++) {
      const edge = p.edges[i]
      const neighbors = neighborsAlongEdge(edge, rooms, edgesByRoom)
      if (neighbors.length === 0) continue
      edge.shared = true
      let segs = edge.segments
      for (const nb of neighbors) {
        const N = nb.room
        if (isOpenRoom(R.name) && isOpenRoom(N.name)) {
          segs = splitSegments(segs, nb.from, nb.to, 'open')
          continue
        }
        if (ownerIsA(R, N)) {
          // 决定是否开门：
          // - 卫生间（含归属/公共/普通）走唯一门规则：命名归属房间（主卧卫生间→主卧）
          //   或走廊优先（公共/普通卫生间默认只开一扇门，用户显式 setOpenings 可另加）
          // - 两侧都不是卫生间且都是私密房间（卧室/书房）时，不直接开门
          // - 私密房间不直连非走廊开放空间（厨房/客厅/餐厅），只连走廊
          const rTargets = bathroomDoorTargets.get(R.id)
          const nTargets = bathroomDoorTargets.get(N.id)
          let hasDoor = true
          if (rTargets || nTargets) {
            hasDoor =
              (rTargets ? rTargets.has(N.id) : false) || (nTargets ? nTargets.has(R.id) : false)
          } else {
            const rPrivate = isPrivateRoom(R.name)
            const nPrivate = isPrivateRoom(N.name)
            if (rPrivate && nPrivate) {
              // 卧室之间不互开门
              hasDoor = false
            } else if (
              (rPrivate && isOpenRoom(N.name) && !isCorridorName(N.name)) ||
              (nPrivate && isOpenRoom(R.name) && !isCorridorName(R.name))
            ) {
              // 私密房间（卧室/书房）不直连非走廊开放空间（厨房/客厅/餐厅），只连走廊
              hasDoor = false
            }
          }
          segs = splitSegments(segs, nb.from, nb.to, hasDoor ? 'door' : 'wall')
        } else {
          segs = splitSegments(segs, nb.from, nb.to, 'open')
        }
      }
      edge.segments = segs
    }
  }

  // 显式开洞覆盖层（含窗段；门段同样影响兜底判定）
  applyOpenings(plan, rooms)

  // 完全没有相邻房间的房间：朝整屋中心的墙兜底开门
  // （避免在私密房间相邻且不开门时，又被兜底强制开一扇门）
  for (const R of rooms) {
    const p = plan.get(R.id)!
    const hasShared = p.edges.some((e) => e.shared)
    if (!hasShared && !hasAnyDoor(p)) {
      const dir = doorDirection(R)
      const edge = p.edges.find((e) => e.dir === dir)
      if (edge) addDoorOnFace(edge, 0, edge.length)
    }
  }

  addEntranceDoor(plan, rooms, options)
  return plan
}

/** 在入口房间（或入口侧边界房间）的外墙居中开入户门 */
function addEntranceDoor(
  plan: Map<string, WallPlan>,
  rooms: RoomNode[],
  options: WallPlanOptions,
): void {
  const { entrance, entranceRoomId } = options
  if (!entrance || rooms.length === 0) return

  const lineOf = (r: RoomNode): number | null => {
    const e = edgeOf(plan.get(r.id)!, entrance)
    return e ? e.line : null
  }

  let target: RoomNode | undefined
  if (entranceRoomId) {
    target = rooms.find((r) => r.id === entranceRoomId)
  }
  if (!target) {
    const lines = rooms.map(lineOf).filter((l): l is number => l !== null)
    if (lines.length === 0) return
    const boundary =
      entrance === 'south' || entrance === 'west' ? Math.min(...lines) : Math.max(...lines)
    const candidates = rooms.filter((r) => {
      const l = lineOf(r)
      return l !== null && Math.abs(l - boundary) < 1e-6
    })
    target =
      candidates.find((r) => isCorridorName(r.name)) ??
      candidates.find((r) => isOpenRoom(r.name)) ??
      candidates[0]
  }
  if (!target) return
  const edge = edgeOf(plan.get(target.id)!, entrance)
  if (!edge) return
  addDoorOnFace(edge, 0, edge.length, true)
}

/**
 * 计算嵌套房间的墙体方案：与已渲染墙共线的边不再重复渲染（由外层墙围护），
 * 其余边为内部分隔墙，门开在朝父房间中心的一面。
 *
 * 覆盖判定用「全量墙线并集查询」：遍历所有已有方案，收集落在同一世界墙线上
 * （|line 差| ≤ WALL_THICKNESS）的所有非 'open' 墙/门段（映射到世界区间），
 * 只要嵌套墙的世界区间被任一房间渲染的墙覆盖即视为已围护。这比只查父房间自身
 * 方案可靠：父墙共享给邻居时父方案该区间是 'open'，但邻居在同线处渲染了墙，
 * 并集查询能正确命中，避免背靠背双重墙。
 */
/** 清理墙段：去除长度 < EPS 的浮点噪声段，并合并相邻同类型段 */
function cleanSegments(segs: WallSegment[]): WallSegment[] {
  const EPS = 1e-6
  const out: WallSegment[] = []
  for (const s of segs) {
    if (s.to - s.from < EPS) continue
    const last = out[out.length - 1]
    if (last && last.kind === s.kind && Math.abs(last.to - s.from) < EPS) {
      last.to = Math.max(last.to, s.to)
      last.entrance = last.entrance || s.entrance
      continue
    }
    out.push({ ...s })
  }
  return out
}

export function nestedWallPlan(
  node: RoomNode,
  parent: RoomNode,
  plan: Map<string, WallPlan>,
  roomById: Map<string, RoomNode>,
): WallPlan {
  // 基座：四面整段实心墙（暂不开门）
  const result: WallPlan = {
    edges: footprintEdges(node),
  }

  // 每面：把被同线墙覆盖的世界区间切为 'open'（跳过渲染，由外层墙围护）
  for (const edge of result.edges) {
    const covered: { from: number; to: number }[] = []
    for (const [, r] of roomById) {
      const rPlan = plan.get(r.id)
      if (!rPlan) continue
      for (const rEdge of rPlan.edges) {
        if (rEdge.axis !== edge.axis) continue
        // 用 WALL_THICKNESS + ε 容忍浮点贴边（平铺/平移会引入 ~1e-13 噪声）
        if (Math.abs(rEdge.line - edge.line) > WALL_THICKNESS + 1e-6) continue
        for (const seg of rEdge.segments) {
          if (seg.kind === 'open') continue
          const overFrom = Math.max(rEdge.start + seg.from, edge.start)
          const overTo = Math.min(rEdge.start + seg.to, edge.start + edge.length)
          if (overTo - overFrom >= 1e-6) covered.push({ from: overFrom, to: overTo })
        }
      }
    }
    if (covered.length === 0) continue
    covered.sort((a, b) => a.from - b.from)
    const merged: { from: number; to: number }[] = []
    for (const c of covered) {
      const last = merged[merged.length - 1]
      if (last && c.from <= last.to) last.to = Math.max(last.to, c.to)
      else merged.push({ ...c })
    }
    let segs = edge.segments
    for (const c of merged) {
      segs = splitSegments(segs, c.from - edge.start, c.to - edge.start, 'open')
    }
    segs = cleanSegments(segs)
    // 整面被覆盖 → 单段 open 且 shared:true（地板不再外扩，贴外墙内侧）
    const fullyOpen = segs.length === 1 && segs[0].kind === 'open'
    edge.shared = fullyOpen
    edge.segments = segs
  }

  // 开门：优先朝父中心的面；该面无实体墙（被全覆盖）时改到最近含 wall 的面；
  // 四面都无 wall（嵌套房间≈父房间的退化情形）则不开门，不 crash。
  const preferred = nestedDoorDirection(node, footprintCenter(parent.footprint))
  const hasWall = (e: WallEdge) => e.segments.some((s) => s.kind === 'wall')
  const order: DoorDirection[] = ['north', 'east', 'south', 'west']
  const pIdx = order.indexOf(preferred)
  const dist = (d: DoorDirection) => {
    const diff = Math.abs(order.indexOf(d) - pIdx)
    return Math.min(diff, 4 - diff)
  }
  let doorEdge: WallEdge | null =
    result.edges.find((e) => e.dir === preferred && hasWall(e)) ?? null
  if (!doorEdge) {
    const candidates = result.edges.filter(hasWall).sort((a, b) => dist(a.dir) - dist(b.dir))
    doorEdge = candidates[0] ?? null
  }
  if (doorEdge) addDoorOnFace(doorEdge, 0, doorEdge.length)

  return result
}

/**
 * 计算整屋所有房间（含嵌套）的墙体方案：顶层走 computeWallPlan（共享墙去重/开放空间/入户门），
 * 再自上而下为每个嵌套房间补算 nestedWallPlan，写入同一 Map。
 * 渲染层现有 wallPlan.get(id) 主路径即可命中嵌套房间。
 */
export function computeAllWallPlans(
  rooms: RoomNode[],
  options: WallPlanOptions = {},
): Map<string, WallPlan> {
  const plan = computeWallPlan(rooms, options)
  const roomById = new Map<string, RoomNode>()
  const collect = (r: RoomNode): void => {
    roomById.set(r.id, r)
    for (const c of r.nestedRooms) collect(c)
  }
  for (const r of rooms) collect(r)
  const applyNested = (r: RoomNode): void => {
    for (const nested of r.nestedRooms) {
      plan.set(nested.id, nestedWallPlan(nested, r, plan, roomById))
      applyNested(nested)
    }
  }
  for (const r of rooms) applyNested(r)
  return plan
}

/** 门口禁入区深度（米）：从墙内壁向室内，家具不得占据门口通道 */
export const DOOR_CLEARANCE = 1.0

/** 一个房间的门口位置（世界坐标，沿墙方向） */
export interface DoorZoneInfo {
  /** 门所在墙（决定朝向与向室内方向） */
  dir: DoorDirection
  /** 门中心的沿墙世界坐标 */
  along: number
}

/**
 * 提取每个顶层房间的门洞位置（含入户门），供家具常理摆放避让门口。
 * 与渲染用 computeWallPlan 同源，保证与渲染门洞一致。
 */
export function computeDoorZones(
  rooms: RoomNode[],
  options: WallPlanOptions = {},
): Map<string, DoorZoneInfo[]> {
  const plan = computeWallPlan(rooms, options)
  const result = new Map<string, DoorZoneInfo[]>()
  for (const R of rooms) {
    const zones: DoorZoneInfo[] = []
    const p = plan.get(R.id)!
    for (const edge of p.edges) {
      for (const seg of edge.segments) {
        if (seg.kind !== 'door') continue
        zones.push({ dir: edge.dir, along: edge.start + (seg.from + seg.to) / 2 })
      }
    }
    result.set(R.id, zones)
  }
  return result
}

/** 沿某边与对侧房间求邻居（内部辅助：供 computeWallPlan 使用） */
function neighborsAlongEdge(
  edge: WallEdge,
  rooms: RoomNode[],
  edgesByRoom: Map<string, WallEdge[]>,
): NeighborAlongEdge[] {
  const result: NeighborAlongEdge[] = []
  for (const N of rooms) {
    if (N.id === edge.roomId) continue
    for (const nEdge of edgesByRoom.get(N.id) ?? []) {
      if (nEdge.dir !== OPPOSITE[edge.dir]) continue
      if (Math.abs(edge.line - nEdge.line) > ADJACENCY_GAP) continue
      const worldFrom = Math.max(edge.start, nEdge.start)
      const worldTo = Math.min(edge.start + edge.length, nEdge.start + nEdge.length)
      if (worldTo - worldFrom < 1e-6) continue
      result.push({ room: N, from: worldFrom - edge.start, to: worldTo - edge.start })
    }
  }
  return result
}
