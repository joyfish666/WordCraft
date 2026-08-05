import type { ContainerNode, Position } from '../types/model'

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
  return /客厅|餐厅|厨房|起居室|玄关|门厅|走廊|连廊|过道|通道|中庭/.test(name) && !ROOM_TYPE_RE.test(name)
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

/**
 * 兜底计算房间门的朝向：指向整屋中心（整屋中心约定为原点）。
 * 仅用于没有任何相邻房间的房间。
 */
export function doorDirection(room: { position: Position }): DoorDirection {
  const vx = -room.position.x
  const vz = -room.position.z
  const absX = Math.abs(vx)
  const absZ = Math.abs(vz)
  if (absX < 0.5 && absZ < 0.5) return 'north'
  if (absX >= absZ) return vx > 0 ? 'east' : 'west'
  return vz > 0 ? 'north' : 'south'
}

// ---------------------------------------------------------------------------
// 墙段模型：每面墙按相邻关系切成若干段，段类型决定渲染方式
// ---------------------------------------------------------------------------

export type WallSegmentKind = 'wall' | 'door' | 'open'

export interface WallSegment {
  /** 沿墙方向的区间（局部坐标，墙中心为 0，单位米） */
  from: number
  to: number
  kind: WallSegmentKind
  /** 是否为入户门（用于渲染醒目标记） */
  entrance?: boolean
}

export interface WallFace {
  /** 该墙是否与相邻房间共用（影响地板外扩） */
  shared: boolean
  /** 本房间在该墙上渲染的墙段（'open' 表示留空） */
  segments: WallSegment[]
}

export interface WallPlan {
  north: WallFace
  south: WallFace
  east: WallFace
  west: WallFace
}

interface WallInfo {
  axis: 'x' | 'z'
  length: number
  /** 墙所在的固定坐标（垂直方向） */
  line: number
  /** 沿墙方向的起始坐标 */
  start: number
}

function wallInfo(R: ContainerNode, dir: DoorDirection): WallInfo {
  const L = R.dimensions.length
  const W = R.dimensions.width
  if (dir === 'north') return { axis: 'x', length: L, line: R.position.z + W / 2, start: R.position.x - L / 2 }
  if (dir === 'south') return { axis: 'x', length: L, line: R.position.z - W / 2, start: R.position.x - L / 2 }
  if (dir === 'east') return { axis: 'z', length: W, line: R.position.x + L / 2, start: R.position.z - W / 2 }
  return { axis: 'z', length: W, line: R.position.x - L / 2, start: R.position.z - W / 2 }
}

interface NeighborAlongWall {
  room: ContainerNode
  /** 墙局部坐标（中心为 0） */
  from: number
  to: number
}

/** 找出沿某面墙相邻（对侧墙同线且有重叠）的所有房间及其重叠区间 */
function neighborsAlongWall(R: ContainerNode, dir: DoorDirection, rooms: ContainerNode[]): NeighborAlongWall[] {
  const info = wallInfo(R, dir)
  const result: NeighborAlongWall[] = []
  for (const N of rooms) {
    if (N.id === R.id) continue
    const nInfo = wallInfo(N, OPPOSITE[dir])
    if (Math.abs(info.line - nInfo.line) > ADJACENCY_GAP) continue
    const worldFrom = Math.max(info.start, nInfo.start)
    const worldTo = Math.min(info.start + info.length, nInfo.start + nInfo.length)
    if (worldTo - worldFrom < 1e-6) continue
    const half = info.length / 2
    result.push({ room: N, from: worldFrom - info.start - half, to: worldTo - info.start - half })
  }
  return result
}

/** 在 [from,to] 区间上应用指定类型，切分并覆盖既有墙段 */
function splitSegments(segs: WallSegment[], from: number, to: number, kind: WallSegmentKind): WallSegment[] {
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

/** 在墙段 [from,to] 范围内靠近中心的位置开一扇门（选择最近的实体墙段） */
function addDoorOnFace(face: WallFace, from: number, to: number, markEntrance = false): void {
  const center = (from + to) / 2
  let best: { s: WallSegment; a: number; b: number } | null = null
  let bestDist = Infinity
  for (const s of face.segments) {
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
  face.segments = splitSegments(face.segments, d0, d1, 'door')
  if (markEntrance) {
    // 标记刚创建的入户门段
    face.segments = face.segments.map((s) =>
      s.kind === 'door' && Math.abs(s.from - d0) < 1e-6 && Math.abs(s.to - d1) < 1e-6
        ? { ...s, entrance: true }
        : s,
    )
  }
}

function hasAnyDoor(p: WallPlan): boolean {
  return WALL_DIRECTIONS.some((d) => p[d].segments.some((s) => s.kind === 'door'))
}

/** 共享墙持有方：非走廊优先；同为走廊/房间时取 id 较小者（确定性） */
function ownerIsA(a: ContainerNode, b: ContainerNode): boolean {
  const aC = isCorridorName(a.name)
  const bC = isCorridorName(b.name)
  return aC !== bC ? !aC : a.id < b.id
}

/** 四面实体墙 + 指定方向开一扇门 */
export function wallPlanWithDoor(room: ContainerNode, dir: DoorDirection): WallPlan {
  const makeFace = (d: DoorDirection): WallFace => {
    const half = wallInfo(room, d).length / 2
    return { shared: false, segments: [{ from: -half, to: half, kind: 'wall' }] }
  }
  const plan: WallPlan = {
    north: makeFace('north'),
    south: makeFace('south'),
    east: makeFace('east'),
    west: makeFace('west'),
  }
  const info = wallInfo(room, dir)
  addDoorOnFace(plan[dir], -info.length / 2, info.length / 2)
  return plan
}

/** 无相邻信息时的兜底方案：四面墙实体，朝整屋中心的墙开门 */
export function defaultWallPlan(room: ContainerNode): WallPlan {
  return wallPlanWithDoor(room, doorDirection(room))
}

export interface WallPlanOptions {
  /** 入户大门所在方向（房屋外墙） */
  entrance?: DoorDirection
  /** 入户门开在哪个房间的外墙（优先于边界推断） */
  entranceRoomId?: string
}

/** 在入口房间（或入口侧边界房间）的外墙居中开入户门 */
function addEntranceDoor(
  plan: Map<string, WallPlan>,
  rooms: ContainerNode[],
  options: WallPlanOptions,
): void {
  const { entrance, entranceRoomId } = options
  if (!entrance || rooms.length === 0) return

  let target: ContainerNode | undefined
  if (entranceRoomId) {
    target = rooms.find((r) => r.id === entranceRoomId)
  }
  if (!target) {
    const coord = (r: ContainerNode) => wallInfo(r, entrance).line
    const boundary =
      entrance === 'south' || entrance === 'west'
        ? Math.min(...rooms.map(coord))
        : Math.max(...rooms.map(coord))
    const candidates = rooms.filter((r) => Math.abs(coord(r) - boundary) < 1e-6)
    target =
      candidates.find((r) => isCorridorName(r.name)) ??
      candidates.find((r) => isOpenRoom(r.name)) ??
      candidates[0]
  }
  if (!target) return
  const info = wallInfo(target, entrance)
  addDoorOnFace(plan.get(target.id)![entrance], -info.length / 2, info.length / 2, true)
}

/**
 * 计算所有房间的分段墙体方案：
 * - 每面墙按相邻房间切分成段：实体 / 门 / 留空（开放）。
 * - 相邻共用墙只由一方渲染（非走廊优先）；两侧都是开放空间则不设墙。
 * - 部分被相邻房间占用的墙，其余部分按外墙渲染（保证不向外部开口）。
 * - 私密房间（卧室/书房）之间不直接开门，经走廊/卫生间连通。
 * - 外墙始终保留；入口侧外墙居中开入户门。
 */
export function computeWallPlan(
  rooms: ContainerNode[],
  options: WallPlanOptions = {},
): Map<string, WallPlan> {
  const plan = new Map<string, WallPlan>()
  for (const R of rooms) {
    const makeFace = (dir: DoorDirection): WallFace => {
      const half = wallInfo(R, dir).length / 2
      return { shared: false, segments: [{ from: -half, to: half, kind: 'wall' }] }
    }
    plan.set(R.id, {
      north: makeFace('north'),
      south: makeFace('south'),
      east: makeFace('east'),
      west: makeFace('west'),
    })
  }

  for (const R of rooms) {
    for (const dir of WALL_DIRECTIONS) {
      const face = plan.get(R.id)![dir]
      const neighbors = neighborsAlongWall(R, dir, rooms)
      if (neighbors.length === 0) continue
      face.shared = true
      let segs = face.segments
      for (const nb of neighbors) {
        const N = nb.room
        if (isOpenRoom(R.name) && isOpenRoom(N.name)) {
          segs = splitSegments(segs, nb.from, nb.to, 'open')
          continue
        }
        if (ownerIsA(R, N)) {
          // 决定是否开门：
          // - 涉及卫生间时，用卫生间的归属规则（主卧卫生间→主卧、走廊卫生间→走廊），其余连接为实心墙
          // - 公共卫生间（归属名在房间列表中不存在，如"公共卫生间"）允许与走廊开门
          // - 两侧都不是卫生间且都是私密房间（卧室/书房）时，不直接开门
          const rBath = bathroomOwner(R.name)
          const nBath = bathroomOwner(N.name)
          let hasDoor = true
          if (rBath || nBath) {
            hasDoor = (rBath ? N.name === rBath : false) || (nBath ? R.name === nBath : false)
            if (!hasDoor) {
              // 归属房间不存在 → 视为公共卫生间，可与走廊开门
              hasDoor =
                (rBath ? isCorridorName(N.name) && !rooms.some((x) => x.name === rBath) : false) ||
                (nBath ? isCorridorName(R.name) && !rooms.some((x) => x.name === nBath) : false)
            }
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
      face.segments = segs
    }
  }

  // 完全没有相邻房间的房间：朝整屋中心的墙兜底开门
  // （避免在私密房间相邻且不开门时，又被兜底强制开一扇门）
  for (const R of rooms) {
    const p = plan.get(R.id)!
    const hasShared = WALL_DIRECTIONS.some((d) => p[d].shared)
    if (!hasShared && !hasAnyDoor(p)) {
      const info = wallInfo(R, doorDirection(R))
      addDoorOnFace(p[doorDirection(R)], -info.length / 2, info.length / 2)
    }
  }

  addEntranceDoor(plan, rooms, options)
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
  rooms: ContainerNode[],
  options: WallPlanOptions = {},
): Map<string, DoorZoneInfo[]> {
  const plan = computeWallPlan(rooms, options)
  const result = new Map<string, DoorZoneInfo[]>()
  for (const R of rooms) {
    const zones: DoorZoneInfo[] = []
    for (const dir of WALL_DIRECTIONS) {
      const info = wallInfo(R, dir)
      for (const seg of plan.get(R.id)![dir].segments) {
        if (seg.kind !== 'door') continue
        zones.push({ dir, along: info.start + info.length / 2 + (seg.from + seg.to) / 2 })
      }
    }
    result.set(R.id, zones)
  }
  return result
}
