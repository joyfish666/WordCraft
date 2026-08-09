import { translate, type Lang } from '../i18n/translations'
import { footprintBounds, houseLevelsBounds } from './footprint'
import { WALL_THICKNESS } from './roomGeometry'
import type { Dimensions, HouseNode, RoomNode, SceneModel } from '../types/model'

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

/** 房间标签文案："主卧 3×3" */
export function roomLabelText(name: string, dims: Dimensions): string {
  return `${name} ${fmt(dims.length)}×${fmt(dims.width)}`
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
