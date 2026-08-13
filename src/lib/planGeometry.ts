import { translate, type Lang } from '../i18n/translations'
import { footprintBounds, houseLevelsBounds } from './footprint'
import { WALL_THICKNESS, type WallEdge, type WallSegment } from './roomGeometry'
import type { HouseNode, RoomNode, SceneModel } from '../types/model'

/**
 * 2D 俯视平面图所需的纯几何函数：整屋包围盒、房间遍历、尺寸线与正交相机取景。
 * 全部无副作用，便于单元测试；渲染层（PlanRig / PlanAnnotations）消费这里的结果。
 */

/** 整屋在 XZ 平面上的包围盒（世界坐标，米） */
export interface Bounds2D {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  centerX: number
  centerZ: number
  /** x 方向跨度（总长） */
  width: number
  /** z 方向跨度（总宽） */
  height: number
}

/**
 * 整屋包围盒：所有顶层房间足迹的并集包围盒外扩一个墙厚（兼容旧 house.dimensions 语义）。
 * 空场景回退到 4×3 的取景盒。
 */
export function houseBounds(scene: SceneModel): Bounds2D {
  const bounds = houseLevelsBounds(scene.root)
  if (!bounds) {
    return { minX: -2, maxX: 2, minZ: -1.5, maxZ: 1.5, centerX: 0, centerZ: 0, width: 4, height: 3 }
  }
  const minX = bounds.minX - WALL_THICKNESS
  const maxX = bounds.maxX + WALL_THICKNESS
  const minZ = bounds.minZ - WALL_THICKNESS
  const maxZ = bounds.maxZ + WALL_THICKNESS
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: maxX - minX,
    height: maxZ - minZ,
  }
}

/** 数值展示：去尾零，最多 2 位小数 */
export function fmt(n: number): string {
  return String(parseFloat(n.toFixed(2)))
}

export interface RoomPlanInfo {
  node: RoomNode
  /** 该房间在其父容器同级（含家具）中的下标，与 3D 配色映射一致 */
  siblingIndex: number
  /** 层级深度：顶层房间 = 1，嵌套子房间（如卧内卫生间）= 2 */
  depth: number
}

/** 递归收集所有房间（含嵌套），用于绘制标签与颜色映射 */
export function walkRooms(root: HouseNode): RoomPlanInfo[] {
  const result: RoomPlanInfo[] = []
  const level = root.levels[0]
  if (!level) return result
  // 嵌套房间在其父容器同级（家具 + 嵌套房间）中的下标 = 家具数 + 嵌套下标，与 3D 配色一致
  const visit = (node: RoomNode, depth: number) => {
    node.nestedRooms.forEach((child, i) => {
      result.push({ node: child, siblingIndex: node.furniture.length + i, depth })
      visit(child, depth + 1)
    })
  }
  level.rooms.forEach((child, i) => {
    result.push({ node: child, siblingIndex: i, depth: 1 })
    visit(child, 2)
  })
  return result
}

/** 一条尺寸线：直线段 + 文案（端部刻度由渲染层绘制） */
export interface DimLine {
  from: [number, number, number]
  to: [number, number, number]
  label: string
}

/**
 * 整屋外廓尺寸线：南侧总长 + 东侧总宽，绘制在包围盒外（offset 米）、y 高度处（应高于墙顶）。
 * 标签随语言（lang 缺省 zh）。
 */
export function dimensionLines(
  bounds: Bounds2D,
  opts: { offset?: number; y: number; lang?: Lang },
): DimLine[] {
  const { offset = 0.6, y, lang = 'zh' } = opts
  return [
    {
      from: [bounds.minX, y, bounds.minZ - offset],
      to: [bounds.maxX, y, bounds.minZ - offset],
      label: translate(lang, 'plan.length', { width: fmt(bounds.width) }),
    },
    {
      from: [bounds.maxX + offset, y, bounds.minZ],
      to: [bounds.maxX + offset, y, bounds.maxZ],
      label: translate(lang, 'plan.width', { height: fmt(bounds.height) }),
    },
  ]
}

/** 正交俯视相机的取景参数 */
export interface PlanCameraSpec {
  position: [number, number, number]
  target: [number, number, number]
  zoom: number
  near: number
  far: number
}

/**
 * 正交取景：使包围盒以 marginRatio 比例适配视口像素尺寸。
 * drei OrthographicCamera 的 frustum 恒等于视口像素尺寸（zoom=1），
 * 故可见世界宽度 = size.width / zoom。
 * 空场景（bounds=null）回退到取景原点，仍能看到网格。
 */
export function computePlanCamera(
  bounds: Bounds2D | null,
  size: { width: number; height: number },
  marginRatio = 0.9,
): PlanCameraSpec {
  const CAMERA_Y = 60
  const near = 1
  const far = 300
  if (!bounds || size.width <= 0 || size.height <= 0) {
    return { position: [0, CAMERA_Y, 0], target: [0, 0, 0], zoom: 20, near, far }
  }
  const fitX = bounds.width + 2
  const fitZ = bounds.height + 2
  const zoom = Math.min(size.width / fitX, size.height / fitZ) * marginRatio
  return {
    position: [bounds.centerX, CAMERA_Y, bounds.centerZ],
    target: [bounds.centerX, 0, bounds.centerZ],
    zoom,
    near,
    far,
  }
}

/** 便捷：整屋包围盒（含墙厚外扩），供渲染层（房屋线框盒）使用 */
export function houseBoundsFromRooms(rooms: RoomNode[]): Bounds2D {
  const union = (() => {
    if (rooms.length === 0) return null
    const list = rooms.map((r) => footprintBounds(r.footprint))
    return {
      minX: Math.min(...list.map((b) => b.minX)),
      maxX: Math.max(...list.map((b) => b.maxX)),
      minZ: Math.min(...list.map((b) => b.minZ)),
      maxZ: Math.max(...list.map((b) => b.maxZ)),
    }
  })()
  if (!union) {
    return { minX: -2, maxX: 2, minZ: -1.5, maxZ: 1.5, centerX: 0, centerZ: 0, width: 4, height: 3 }
  }
  const minX = union.minX - WALL_THICKNESS
  const maxX = union.maxX + WALL_THICKNESS
  const minZ = union.minZ - WALL_THICKNESS
  const maxZ = union.maxZ + WALL_THICKNESS
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: maxX - minX,
    height: maxZ - minZ,
  }
}

// ---------------------------------------------------------------------------
// 2D 平面图门窗符号与房间尺寸标注（平面图增强，纯函数供 PlanEnhancements 消费）
// ---------------------------------------------------------------------------

/** 墙段起点/终点的世界坐标（段局部坐标以边起点为 0，坑 37：世界 = start + local） */
function segmentPoint(edge: WallEdge, local: number, y: number): [number, number, number] {
  const along = edge.start + local
  return edge.axis === 'x' ? [along, y, edge.line] : [edge.line, y, along]
}

/** 边的内向偏移方向（房间内部 = 外向法线的反向） */
function inwardOffset(edge: WallEdge): { dx: number; dz: number } {
  switch (edge.dir) {
    case 'north':
      return { dx: 0, dz: -1 }
    case 'south':
      return { dx: 0, dz: 1 }
    case 'east':
      return { dx: -1, dz: 0 }
    case 'west':
      return { dx: 1, dz: 0 }
  }
}

/**
 * 门扇线：从铰链端（段起点一侧的门框角）垂直进入房间，长度 = 门洞宽。
 * 与经典制图符号一致：门扇画在房间内部，朝向房间内。
 */
export function doorLeafLine(
  edge: WallEdge,
  seg: WallSegment,
  y: number,
): [[number, number, number], [number, number, number]] {
  const a = segmentPoint(edge, seg.from, y)
  const dir = inwardOffset(edge)
  const width = seg.to - seg.from
  return [a, [a[0] + dir.dx * width, y, a[2] + dir.dz * width]]
}

/**
 * 门扇开启弧线：以铰链端为圆心、门洞宽为半径，从门扇端点扫到洞口另一端。
 * 两射线垂直 → 唯一 90° 短弧（atan2 差值恒为 ±π/2），弧线自然落在房间内、
 * 且沿墙方向不越出洞口区间（与 3D 渲染的墙段同源）。
 * 首尾点精确取门扇端点与洞口另一端，避免浮点缝隙。
 */
export function doorArcPoints(
  edge: WallEdge,
  seg: WallSegment,
  y: number,
  steps = 10,
): [number, number, number][] {
  const a = segmentPoint(edge, seg.from, y)
  const b = segmentPoint(edge, seg.to, y)
  const dir = inwardOffset(edge)
  const width = seg.to - seg.from
  const angE = Math.atan2(dir.dz, dir.dx)
  const angB = Math.atan2(b[2] - a[2], b[0] - a[0])
  const d = angB - angE
  const pts: [number, number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    if (t === 0) {
      pts.push([a[0] + dir.dx * width, y, a[2] + dir.dz * width])
      continue
    }
    if (t === 1) {
      pts.push(b)
      continue
    }
    const ang = angE + d * t
    pts.push([a[0] + Math.cos(ang) * width, y, a[2] + Math.sin(ang) * width])
  }
  return pts
}

/**
 * 窗洞符号：两条与墙平行的短线，向内偏移 0.1 / 0.22 米（经典双线示意），
 * 跨度 = 窗洞宽。颜色由渲染层指定（浅蓝，与 3D 窗玻璃/门窗工具标记一致）。
 */
export function windowHatchLines(
  edge: WallEdge,
  seg: WallSegment,
  y: number,
): Array<[[number, number, number], [number, number, number]]> {
  const a = segmentPoint(edge, seg.from, y)
  const b = segmentPoint(edge, seg.to, y)
  const dir = inwardOffset(edge)
  return [0.1, 0.22].map((o) => [
    [a[0] + dir.dx * o, y, a[2] + dir.dz * o],
    [b[0] + dir.dx * o, y, b[2] + dir.dz * o],
  ])
}

/** 房间尺寸线的最小边长（小于此值的房间不画内部尺寸线，避免小房间标注拥挤） */
export const MIN_DIM_SIDE = 2

/**
 * 房间内部尺寸线：南侧（水平）标长度、西侧（竖直）标宽度，
 * 向内偏移 offset（应大于墙厚），端部刻度与文案由渲染层绘制。
 * 尺寸过小的边（< MIN_DIM_SIDE）跳过。
 */
export function roomDimLines(room: RoomNode, opts: { y: number; offset?: number }): DimLine[] {
  const { y, offset = 0.4 } = opts
  const b = footprintBounds(room.footprint)
  const len = b.maxX - b.minX
  const wid = b.maxZ - b.minZ
  const lines: DimLine[] = []
  if (len >= MIN_DIM_SIDE) {
    lines.push({
      from: [b.minX + offset, y, b.minZ + offset],
      to: [b.maxX - offset, y, b.minZ + offset],
      label: fmt(len),
    })
  }
  if (wid >= MIN_DIM_SIDE) {
    lines.push({
      from: [b.minX + offset, y, b.minZ + offset],
      to: [b.minX + offset, y, b.maxZ - offset],
      label: fmt(wid),
    })
  }
  return lines
}
