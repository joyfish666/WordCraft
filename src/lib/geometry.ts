import type { Point2D, RoomNode } from '../types/model'
import { EPSILON, WALL_THICKNESS } from './constants'
import { footprintBounds, translateFootprint } from './footprint'

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

/**
 * 嵌套房间沿单轴的角点偏移量（米）：(父边长 - 子边长)/2 再减去墙厚——
 * 子房间贴父房间某角时，其中心相对父中心的偏移（靠角 = 贴两面墙）。
 * 负值（子房间不小于父房间）钳 0。公式此前散落 layout/executor 三处，统一收拢
 * （2026-08-14 审查，坑 47 同源）。
 */
export function nestedCornerHalf(parent: number, child: number): number {
  return Math.max(0, (parent - child) / 2 - WALL_THICKNESS)
}

/** 嵌套房间的禁止进入区：足迹包围盒外扩一个墙厚（父房间家具不得进入，坑 47） */
export function nestedKeepOutRect(room: RoomNode): Rect {
  const b = footprintBounds(room.footprint)
  return {
    minX: b.minX - WALL_THICKNESS,
    maxX: b.maxX + WALL_THICKNESS,
    minZ: b.minZ - WALL_THICKNESS,
    maxZ: b.maxZ + WALL_THICKNESS,
  }
}

/** 房间墙内可活动区：足迹包围盒内缩一个墙厚（家具摆放/约束的硬边界） */
export function roomInnerBounds(room: RoomNode): Rect {
  const b = footprintBounds(room.footprint)
  return {
    minX: b.minX + WALL_THICKNESS,
    maxX: b.maxX - WALL_THICKNESS,
    minZ: b.minZ + WALL_THICKNESS,
    maxZ: b.maxZ - WALL_THICKNESS,
  }
}

/** 足迹边元数据：顶点环第 i 条边的几何解析（坑 39：边下标 = 顶点环边序号） */
export interface EdgeMeta {
  /** 沿边轴：水平边（常量线为 z）沿 x，垂直边（常量线为 x）沿 z */
  axis: 'x' | 'z'
  /** 垂直于沿边方向的固定世界坐标 */
  line: number
  /** 沿边方向的起点世界坐标（min 端；坑 37：段局部 0 = 边起点） */
  start: number
  /** 边长（米） */
  length: number
  /** 外向法线方向（该边常量线与足迹包围盒中心比较，确定性） */
  dir: Dir
}

/**
 * 足迹顶点环第 i 条边的几何元数据（统一解析，2026-08-14 审查收拢）：
 * 此前 footprintEdges / edgeByRingIndex / edgeDirIndex / findEdgeBySide /
 * edgeDirOf / ringIndexOf 各自实现同一「环边 → axis/line/start/length/dir」判定，
 * 容差写法与方向比较基准已出现分歧（如对非轴对齐边的处理不一）——
 * 收拢后所有消费方共用同一份解析，杜绝「一处修容差、另一处漏修」的漂移。
 * 非轴对齐边 / 退化（零长）边返回 null（调用方决定跳过或兜底）。
 */
export function edgeMetaOf(fp: Point2D[], i: number): EdgeMeta | null {
  const n = fp.length
  if (n === 0) return null
  const idx = ((i % n) + n) % n
  const a = fp[idx]!
  const b = fp[(idx + 1) % n]!
  const horizontal = Math.abs(a.z - b.z) < EPSILON
  const vertical = Math.abs(a.x - b.x) < EPSILON
  if (!horizontal && !vertical) return null
  const axis = horizontal ? 'x' : 'z'
  const line = horizontal ? a.z : a.x
  const start = horizontal ? Math.min(a.x, b.x) : Math.min(a.z, b.z)
  const length = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.z - a.z)
  if (length < EPSILON) return null
  const bbox = footprintBounds(fp)
  const center = horizontal ? (bbox.minZ + bbox.maxZ) / 2 : (bbox.minX + bbox.maxX) / 2
  const dir: Dir = horizontal
    ? line > center + EPSILON
      ? 'north'
      : 'south'
    : line > center + EPSILON
      ? 'east'
      : 'west'
  return { axis, line, start, length, dir }
}

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
