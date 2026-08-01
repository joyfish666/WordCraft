import type { Position } from '../types/model'

export type DoorDirection = 'north' | 'south' | 'east' | 'west'

/** 判断房间名是否为走廊/连廊（渲染为无墙通道） */
export function isCorridorName(name: string): boolean {
  return (
    name.includes('走廊') ||
    name.includes('连廊') ||
    name.includes('过道') ||
    name.includes('通道')
  )
}

/**
 * 计算房间门的朝向：指向整屋中心（整屋中心约定为原点）。
 * 门开在离整屋中心最近的那面墙上，房间位于中心时默认朝北。
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
