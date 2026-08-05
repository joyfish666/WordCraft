import type { ContainerNode, Dimensions, SceneModel } from '../types/model'

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

/** 整屋包围盒：直接取整屋节点尺寸（布局引擎保证 house.dimensions = 所有房间的包围盒） */
export function houseBounds(scene: SceneModel): Bounds2D {
  const root = scene.root
  const { length, width } = root.dimensions
  const cx = root.position.x
  const cz = root.position.z
  return {
    minX: cx - length / 2,
    maxX: cx + length / 2,
    minZ: cz - width / 2,
    maxZ: cz + width / 2,
    centerX: cx,
    centerZ: cz,
    width: length,
    height: width,
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
  node: ContainerNode
  /** 该房间在其父容器 children 中的下标（与 3D 配色映射一致） */
  siblingIndex: number
  /** 层级深度：顶层房间 = 1，嵌套子房间（如卧内卫生间）= 2 */
  depth: number
}

/** 递归收集所有房间（含嵌套），用于绘制标签与颜色映射 */
export function walkRooms(root: ContainerNode): RoomPlanInfo[] {
  const result: RoomPlanInfo[] = []
  const visit = (node: ContainerNode, depth: number) => {
    node.children.forEach((child, i) => {
      if (child.type === 'room') {
        result.push({ node: child, siblingIndex: i, depth })
        visit(child, depth + 1)
      }
    })
  }
  visit(root, 1)
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
 */
export function dimensionLines(bounds: Bounds2D, opts: { offset?: number; y: number }): DimLine[] {
  const { offset = 0.6, y } = opts
  return [
    {
      from: [bounds.minX, y, bounds.minZ - offset],
      to: [bounds.maxX, y, bounds.minZ - offset],
      label: `总长 ${fmt(bounds.width)}m`,
    },
    {
      from: [bounds.maxX + offset, y, bounds.minZ],
      to: [bounds.maxX + offset, y, bounds.maxZ],
      label: `总宽 ${fmt(bounds.height)}m`,
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
