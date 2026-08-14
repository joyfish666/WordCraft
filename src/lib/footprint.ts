import type {
  Dimensions,
  FurnitureNode,
  HouseNode,
  Point2D,
  Position,
  RoomNode,
} from '../types/model'
import { DEFAULT_HEIGHT } from './constants'

/**
 * v3 足迹几何（footprint）纯函数：包围盒 / 中心 / 平移 / 缩放 / 矩形构造。
 * 全部无副作用，供布局引擎、墙体方案、约束、渲染与 2D 平面图消费。
 * 矩形房间 = 4 点足迹特例，dimensions 可由足迹推导（包围盒）。
 */

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** 由矩形中心与尺寸构造 4 点足迹（逆时针：西南 → 东南 → 东北 → 西北） */
export function rectFootprint(cx: number, cz: number, length: number, width: number): Point2D[] {
  return [
    { x: cx - length / 2, z: cz - width / 2 },
    { x: cx + length / 2, z: cz - width / 2 },
    { x: cx + length / 2, z: cz + width / 2 },
    { x: cx - length / 2, z: cz + width / 2 },
  ]
}

/** 足迹的轴向包围盒（沿足迹边：正交多边形） */
export function footprintBounds(footprint: Point2D[]): Bounds {
  if (footprint.length === 0) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of footprint) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  return { minX, maxX, minZ, maxZ }
}

/** 足迹中心（包围盒中心） */
export function footprintCenter(footprint: Point2D[]): { x: number; z: number } {
  const b = footprintBounds(footprint)
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }
}

/** 足迹包围盒尺寸 */
export function footprintDims(footprint: Point2D[]): { length: number; width: number } {
  const b = footprintBounds(footprint)
  return { length: b.maxX - b.minX, width: b.maxZ - b.minZ }
}

/** 平移足迹（dx/dz 为世界坐标增量） */
export function translateFootprint(footprint: Point2D[], dx: number, dz: number): Point2D[] {
  return footprint.map((p) => ({ x: p.x + dx, z: p.z + dz }))
}

/**
 * 缩放足迹：保持包围盒中心不变，把包围盒尺寸调整为 length×width。
 * 对矩形（4 点足迹）即精确改尺寸；对一般正交多边形按包围盒比例缩放（P1 无多边形输入，安全）。
 */
export function resizeFootprint(footprint: Point2D[], length: number, width: number): Point2D[] {
  const b = footprintBounds(footprint)
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minZ + b.maxZ) / 2
  const len = Math.max(b.maxX - b.minX, 1e-6)
  const wid = Math.max(b.maxZ - b.minZ, 1e-6)
  return footprint.map((p) => ({
    x: cx + ((p.x - cx) * length) / len,
    z: cz + ((p.z - cz) * width) / wid,
  }))
}

/** 多个足迹的并集包围盒；空列表返回 null */
export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null
  return {
    minX: Math.min(...list.map((b) => b.minX)),
    maxX: Math.max(...list.map((b) => b.maxX)),
    minZ: Math.min(...list.map((b) => b.minZ)),
    maxZ: Math.max(...list.map((b) => b.maxZ)),
  }
}

// ---------------------------------------------------------------------------
// 节点访问器：v3 房间无 position/dimensions 字段，统一由此派生
// ---------------------------------------------------------------------------

/** 房间中心（包围盒中心；y 兼容旧模型：层高一半，用于展示/Gizmo 代理） */
export function roomCenter(room: RoomNode): Position {
  const c = footprintCenter(room.footprint)
  return { x: c.x, y: room.height / 2, z: c.z }
}

/** 房间包围盒尺寸（length/width）与层高 */
export function roomDims(room: RoomNode): Dimensions {
  const d = footprintDims(room.footprint)
  return { length: d.length, width: d.width, height: room.height }
}

/** 整屋包围盒（含墙厚外扩语义由调用方决定）：所有楼层房间足迹的并集 */
export function houseLevelsBounds(house: HouseNode): Bounds | null {
  const roomBounds = (room: RoomNode): Bounds[] => [
    footprintBounds(room.footprint),
    ...room.nestedRooms.flatMap(roomBounds),
  ]
  const bounds = house.levels.flatMap((l) => l.rooms.flatMap(roomBounds))
  return unionBounds(bounds)
}

/** 整屋展示用尺寸（length/width = 足迹并集；height = 最高楼层净高） */
export function houseDims(house: HouseNode): Dimensions {
  const b = houseLevelsBounds(house)
  const height = Math.max(...house.levels.map((l) => l.height), DEFAULT_HEIGHT)
  if (!b) return { length: 4, width: 3, height }
  return { length: b.maxX - b.minX, width: b.maxZ - b.minZ, height }
}

/** 任意节点的展示位置（家具直接用 position；房间用足迹中心；整屋用原点） */
export function nodePosition(node: HouseNode | RoomNode | FurnitureNode): Position {
  if (node.type === 'house') return { x: 0, y: 0, z: 0 }
  if (node.type === 'room') return roomCenter(node)
  return node.position
}

/** 任意节点的展示尺寸（家具直接用 dimensions；房间用足迹包围盒 + 层高；整屋用并集） */
export function nodeDims(node: HouseNode | RoomNode | FurnitureNode): Dimensions {
  if (node.type === 'house') return houseDims(node)
  if (node.type === 'room') return roomDims(node)
  return node.dimensions
}

/** 楼层高度：取该层房间最大层高 */
export function levelHeight(rooms: RoomNode[]): number {
  return Math.max(...rooms.map((r) => r.height), DEFAULT_HEIGHT)
}
