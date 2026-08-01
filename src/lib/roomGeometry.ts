import type { ContainerNode, Position } from '../types/model'

export type DoorDirection = 'north' | 'south' | 'east' | 'west'

/** 墙体厚度（米） */
export const WALL_THICKNESS = 0.15
/** 门洞宽度（米） */
export const DOOR_WIDTH = 0.9
/** 相邻房间判定：两面墙之间的最大间隙（米） */
export const ADJACENCY_GAP = 0.4

/**
 * 兜底计算房间门的朝向：指向整屋中心（整屋中心约定为原点）。
 * 房间位于中心时默认朝北。仅用于房间没有任何相邻房间时。
 */
export function doorDirection(room: { position: Position }): DoorDirection {
  // 从房间指向整屋中心的向量
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

/** 计算两房间相邻时，各自在共用墙上开门的朝向 */
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
    // b 在 a 北侧：a 北墙与 b 南墙相邻
    if (Math.abs(az1 - bz0) <= ADJACENCY_GAP) return { a: 'north', b: 'south' }
    // b 在 a 南侧：a 南墙与 b 北墙相邻
    if (Math.abs(az0 - bz1) <= ADJACENCY_GAP) return { a: 'south', b: 'north' }
  }
  if (zOverlap) {
    // b 在 a 东侧：a 东墙与 b 西墙相邻
    if (Math.abs(ax1 - bx0) <= ADJACENCY_GAP) return { a: 'east', b: 'west' }
    // b 在 a 西侧：a 西墙与 b 东墙相邻
    if (Math.abs(ax0 - bx1) <= ADJACENCY_GAP) return { a: 'west', b: 'east' }
  }
  return {}
}

/**
 * 计算所有房间的房门朝向：每面与相邻房间/走廊共用的墙都会开一个门，
 * 从而通过门可到达任意房间（允许经由其他房间通行，无需都经过走廊）。
 */
export function computeDoorWalls(rooms: ContainerNode[]): Map<string, DoorDirection[]> {
  const result = new Map<string, DoorDirection[]>()
  for (const room of rooms) {
    result.set(room.id, [])
  }
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const dirs = facingWalls(rooms[i], rooms[j])
      if (dirs.a) result.get(rooms[i].id)!.push(dirs.a)
      if (dirs.b) result.get(rooms[j].id)!.push(dirs.b)
    }
  }
  return result
}
