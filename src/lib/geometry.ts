import type { Point2D, RoomNode } from '../types/model'
import { EPSILON } from './constants'
import { translateFootprint } from './footprint'

/**
 * 平面几何共享纯函数（世界坐标 x/z）：
 * 重叠判定 / 房间平移 / 足迹相等 / 嵌套落点符号 / 按 id 或名称查找房间。
 * 此前散落在 executor/modelTree/furniturePlacement/layout 的同源实现统一收拢，
 * 避免「复制粘贴式」实现漂移（一处修容差、另一处漏修）。
 */

/** 平面轴对齐矩形（世界坐标，x/z） */
export interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** 两个轴对齐矩形是否重叠（贴边/浮点噪声不算重叠，坑 35/47） */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.minX < b.maxX - EPSILON &&
    a.maxX > b.minX + EPSILON &&
    a.minZ < b.maxZ - EPSILON &&
    a.maxZ > b.minZ + EPSILON
  )
}

/** 中心在 (x,z)、半宽 hx/hz 的家具矩形是否与禁区 k 重叠（贴边不算重叠） */
export function halfRectOverlaps(x: number, z: number, hx: number, hz: number, k: Rect): boolean {
  return (
    x + hx > k.minX + EPSILON &&
    x - hx < k.maxX - EPSILON &&
    z + hz > k.minZ + EPSILON &&
    z - hz < k.maxZ - EPSILON
  )
}

/**
 * 平移房间（足迹 + 家具 + 嵌套房间，递归），保持内部相对关系。
 * 房间位移必须整体携带内容：家具保持相对房间中心的位置、嵌套房间及其家具同步平移，
 * 否则 normalizeContainment 只会把家具钳制进（移动后的）房间边界，破坏相对布局。
 */
export function translateRoom(room: RoomNode, dx: number, dz: number): RoomNode {
  return {
    ...room,
    footprint: translateFootprint(room.footprint, dx, dz),
    furniture: room.furniture.map((f) => ({
      ...f,
      position: { ...f.position, x: f.position.x + dx, z: f.position.z + dz },
    })),
    nestedRooms: room.nestedRooms.map((n) => translateRoom(n, dx, dz)),
  }
}

/** 两个足迹逐点相等（长度一致且每点坐标差 ≤ EPSILON） */
export function sameFootprint(a: Point2D[], b: Point2D[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]!.x - b[i]!.x) > EPSILON || Math.abs(a[i]!.z - b[i]!.z) > EPSILON) return false
  }
  return true
}

/** 嵌套房间落点方向符号（north = +z，east = +x） */
export type Dir = 'north' | 'south' | 'east' | 'west'

/** 方向 → 角落符号（default 为东北角，与 NEST_CORNER_ORDER 首位一致） */
export const NEST_CORNER: Record<Dir | 'default', { x: number; z: number }> = {
  north: { x: -1, z: 1 },
  south: { x: 1, z: -1 },
  east: { x: 1, z: 1 },
  west: { x: -1, z: -1 },
  default: { x: 1, z: 1 },
}

/** 嵌套房间落点候选顺序：东北/西北/东南/西南（坑 47 避让顺序，与渲染/常理摆放同源） */
export const NEST_CORNER_ORDER: Array<{ x: number; z: number }> = [
  { x: 1, z: 1 },
  { x: -1, z: 1 },
  { x: 1, z: -1 },
  { x: -1, z: -1 },
]

/**
 * 递归查找房间（含嵌套）。ref 优先按 id 精确匹配；LLM 常不给房间 id 而直接用房间名
 * 引用（如 setOpenings 的 roomId、setHouse 的 entranceRoomId、relativeTo 的 roomId），
 * 因此 id 未命中时回退按名称匹配（遍历顺序首次命中，确定性）。
 */
export function findRoomInList(rooms: RoomNode[], ref: string): RoomNode | null {
  const byField = (field: 'id' | 'name'): RoomNode | null => {
    const dfs = (room: RoomNode): RoomNode | null => {
      if (room[field] === ref) return room
      for (const nested of room.nestedRooms) {
        const found = dfs(nested)
        if (found) return found
      }
      return null
    }
    for (const room of rooms) {
      const found = dfs(room)
      if (found) return found
    }
    return null
  }
  return byField('id') ?? byField('name')
}
