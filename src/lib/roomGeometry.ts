import type { ContainerNode, Position } from '../types/model'

export type DoorDirection = 'north' | 'south' | 'east' | 'west'

/** 墙体厚度（米） */
export const WALL_THICKNESS = 0.15
/** 门洞宽度（米） */
export const DOOR_WIDTH = 0.9
/** 相邻房间判定：两面墙之间的最大间隙（米） */
export const ADJACENCY_GAP = 0.4

/** 判断房间名是否为走廊/连廊（共享墙优先由非走廊房间持有） */
export function isCorridorName(name: string): boolean {
  return (
    name.includes('走廊') ||
    name.includes('连廊') ||
    name.includes('过道') ||
    name.includes('通道')
  )
}

/** 判断是否为开放空间（客厅/餐厅/厨房等）：与走廊/开放空间之间不设墙 */
export function isOpenRoom(name: string): boolean {
  return /客厅|餐厅|厨房|起居室|玄关|门厅|走廊|连廊|过道|通道|中庭/.test(name)
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

function rangeOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 <= b1 && b0 <= a1
}

/** 计算两房间相邻时各自面向对方的墙 */
function facingWalls(
  a: ContainerNode,
  b: ContainerNode,
): { a?: DoorDirection; b?: DoorDirection } {
  const aHx = a.dimensions.length / 2
  const aHz = a.dimensions.width / 2
  const bHx = b.dimensions.length / 2
  const bHz = b.dimensions.width / 2
  const ax0 = a.position.x - aHx
  const ax1 = a.position.x + aHx
  const az0 = a.position.z - aHz
  const az1 = a.position.z + aHz
  const bx0 = b.position.x - bHx
  const bx1 = b.position.x + bHx
  const bz0 = b.position.z - bHz
  const bz1 = b.position.z + bHz

  const xOverlap = rangeOverlap(ax0, ax1, bx0, bx1)
  const zOverlap = rangeOverlap(az0, az1, bz0, bz1)

  if (xOverlap) {
    if (Math.abs(az1 - bz0) <= ADJACENCY_GAP) return { a: 'north', b: 'south' }
    if (Math.abs(az0 - bz1) <= ADJACENCY_GAP) return { a: 'south', b: 'north' }
  }
  if (zOverlap) {
    if (Math.abs(ax1 - bx0) <= ADJACENCY_GAP) return { a: 'east', b: 'west' }
    if (Math.abs(ax0 - bx1) <= ADJACENCY_GAP) return { a: 'west', b: 'east' }
  }
  return {}
}

/** 单面墙的渲染方案 */
export interface WallFace {
  /** 本房间是否渲染这面墙（共享墙只由一方渲染，避免双墙） */
  render: boolean
  /** 这面墙上是否有门洞 */
  hasDoor: boolean
  /** 是否为与相邻房间/走廊共用的墙 */
  shared: boolean
}

/** 一个房间四面墙的渲染方案 */
export interface WallPlan {
  north: WallFace
  south: WallFace
  east: WallFace
  west: WallFace
}

function freshPlan(): WallPlan {
  return {
    north: { render: true, hasDoor: false, shared: false },
    south: { render: true, hasDoor: false, shared: false },
    east: { render: true, hasDoor: false, shared: false },
    west: { render: true, hasDoor: false, shared: false },
  }
}

/** 无相邻信息时的兜底方案：四面墙渲染，朝整屋中心的墙开门 */
export function defaultWallPlan(room: ContainerNode): WallPlan {
  const plan = freshPlan()
  plan[doorDirection(room)].hasDoor = true
  return plan
}

export interface WallPlanOptions {
  /** 入户大门所在方向（房屋外墙） */
  entrance?: DoorDirection
  /** 入户门开在哪个房间的外墙（优先于边界推断） */
  entranceRoomId?: string
}

/** 在入口侧的边界外墙开入户门：优先指定房间，其次走廊/开放空间 */
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
    // 入口侧边界坐标
    const coord = (r: ContainerNode) =>
      entrance === 'south'
        ? r.position.z - r.dimensions.width / 2
        : entrance === 'north'
          ? r.position.z + r.dimensions.width / 2
          : entrance === 'west'
            ? r.position.x - r.dimensions.length / 2
            : r.position.x + r.dimensions.length / 2
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

  const face = plan.get(target.id)![entrance]
  // 只有外墙（非共享）才开门
  if (face.render) face.hasDoor = true
}

/**
 * 计算所有房间的墙体方案：
 * - 相邻房间共用的墙只渲染一堵，由非走廊房间持有（否则 id 较小者持有）。
 * - 若共享墙两侧都是开放空间（如客厅与走廊），则不渲染墙（开放连通）。
 * - 外墙始终保留；入口侧外墙开入户大门。
 * - 无任何相邻房间时，兜底开一扇朝向整屋中心的门。
 */
export function computeWallPlan(
  rooms: ContainerNode[],
  options: WallPlanOptions = {},
): Map<string, WallPlan> {
  const plan = new Map<string, WallPlan>()
  for (const room of rooms) {
    plan.set(room.id, freshPlan())
  }

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]
      const b = rooms[j]
      const dirs = facingWalls(a, b)
      if (!dirs.a || !dirs.b) continue
      const aFace = plan.get(a.id)![dirs.a]
      const bFace = plan.get(b.id)![dirs.b]
      aFace.shared = true
      bFace.shared = true

      // 两侧都是开放空间：开放连通，不设墙
      if (isOpenRoom(a.name) && isOpenRoom(b.name)) {
        aFace.render = false
        aFace.hasDoor = false
        bFace.render = false
        bFace.hasDoor = false
        continue
      }

      // 持有方：非走廊优先；同为走廊/房间时取 id 较小者（确定性）
      const aIsCorridor = isCorridorName(a.name)
      const bIsCorridor = isCorridorName(b.name)
      const aOwns = aIsCorridor !== bIsCorridor ? !aIsCorridor : a.id < b.id
      if (aOwns) {
        aFace.render = true
        aFace.hasDoor = true
        bFace.render = false
        bFace.hasDoor = false
      } else {
        aFace.render = false
        aFace.hasDoor = false
        bFace.render = true
        bFace.hasDoor = true
      }
    }
  }

  // 无任何相邻房间的房间，兜底开门
  for (const room of rooms) {
    const p = plan.get(room.id)!
    const hasAnyDoor = p.north.hasDoor || p.south.hasDoor || p.east.hasDoor || p.west.hasDoor
    if (!hasAnyDoor) {
      p[doorDirection(room)].hasDoor = true
    }
  }

  addEntranceDoor(plan, rooms, options)
  return plan
}
