import type { ContainerNode, Dimensions, ModelNode, Position, SceneModel } from '../types/model'
import { WALL_THICKNESS } from './roomGeometry'

/**
 * 深度优先遍历树中的所有节点。
 * 根节点本身也会被访问。
 */
export function walk(node: ModelNode, visit: (n: ModelNode) => void): void {
  visit(node)
  if (isContainer(node)) {
    for (const child of node.children) {
      walk(child, visit)
    }
  }
}

/** 是否为容器节点（房间 / 整屋） */
export function isContainer(node: ModelNode): node is Extract<ModelNode, { children: ModelNode[] }> {
  return node.type === 'room' || node.type === 'house'
}

/** 按 id 查找节点 */
export function findNodeById(root: ModelNode, id: string): ModelNode | null {
  let found: ModelNode | null = null
  walk(root, (n) => {
    if (n.id === id) found = n
  })
  return found
}

/** 获取根节点到目标节点的完整路径（含目标自身），用于面包屑导航 */
export function getPathToNode(root: ModelNode, id: string): ModelNode[] {
  const path: ModelNode[] = []
  const dfs = (node: ModelNode): boolean => {
    path.push(node)
    if (node.id === id) return true
    if (isContainer(node)) {
      for (const child of node.children) {
        if (dfs(child)) return true
      }
    }
    path.pop()
    return false
  }
  dfs(root)
  return path
}

/** 统计树中模块总数（含根节点） */
export function countNodes(root: ModelNode): number {
  let count = 0
  walk(root, () => {
    count += 1
  })
  return count
}

/** 不可变更新：将指定节点的 position 替换为新值，返回新的树 */
export function updateNodePosition(root: ModelNode, id: string, position: Position): ModelNode {
  if (root.id === id) return { ...root, position }
  if (isContainer(root)) {
    return { ...root, children: root.children.map((c) => updateNodePosition(c, id, position)) }
  }
  return root
}

/** 节点字段补丁：名称 / 尺寸（部分） / 位置（部分），未提供的字段保持原值 */
export interface NodeFieldsPatch {
  name?: string
  dimensions?: Partial<Dimensions>
  position?: Partial<Position>
}

/**
 * 不可变更新：将指定节点的 name / dimensions / position 按补丁合并替换。
 * 未命中节点或补丁为空时返回原树（引用不变），便于调用方短路跳过。
 */
export function updateNodeFields(root: ModelNode, id: string, patch: NodeFieldsPatch): ModelNode {
  if (root.id === id) {
    if (!patch.name && !patch.dimensions && !patch.position) return root
    const next: ModelNode = { ...root }
    if (patch.name !== undefined) next.name = patch.name
    if (patch.dimensions) next.dimensions = { ...root.dimensions, ...patch.dimensions }
    if (patch.position) next.position = { ...root.position, ...patch.position }
    return next
  }
  if (isContainer(root)) {
    let changed = false
    const children = root.children.map((c) => {
      const next = updateNodeFields(c, id, patch)
      if (next !== c) changed = true
      return next
    })
    if (!changed) return root
    return { ...root, children }
  }
  return root
}

/** 将数值限制到 [min,max]；区间非法（min>max，容器过小）时返回中点 */
function clampTo(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2
  return Math.min(Math.max(value, min), max)
}

// ---------------------------------------------------------------------------
// 真·内嵌嵌套房间：父房间内嵌套子房间（如主卧卫生间）占用一块空间，
// 父房间家具须被推出其占地（足迹 + 墙厚外扩），而非只约束进父墙内。
// ---------------------------------------------------------------------------

/** 平面矩形（世界坐标，x/z） */
interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** 嵌套房间的禁止进入区：足迹 + 墙厚外扩 */
function nestedKeepOut(room: ContainerNode): Rect {
  const hx = room.dimensions.length / 2 + WALL_THICKNESS
  const hz = room.dimensions.width / 2 + WALL_THICKNESS
  return {
    minX: room.position.x - hx,
    maxX: room.position.x + hx,
    minZ: room.position.z - hz,
    maxZ: room.position.z + hz,
  }
}

/** 家具（半宽 hx/hz）是否与禁区重叠 */
function overlapsRect(x: number, z: number, hx: number, hz: number, k: Rect): boolean {
  return x + hx > k.minX && x - hx < k.maxX && z + hz > k.minZ && z - hz < k.maxZ
}

/** 最小穿透推挤：把家具沿穿透最小的轴推出禁区（≤3 次迭代），再夹回墙内；y 保持不变 */
function pushOutOfRects(
  x: number,
  z: number,
  hx: number,
  hz: number,
  keepOuts: Rect[],
  bounds: Rect,
): { x: number; z: number } {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false
    for (const k of keepOuts) {
      if (!overlapsRect(x, z, hx, hz, k)) continue
      const cx = (k.minX + k.maxX) / 2
      const cz = (k.minZ + k.maxZ) / 2
      const penX = hx + (k.maxX - k.minX) / 2 - Math.abs(x - cx)
      const penZ = hz + (k.maxZ - k.minZ) / 2 - Math.abs(z - cz)
      if (penX <= penZ) x += x >= cx ? penX : -penX
      else z += z >= cz ? penZ : -penZ
      moved = true
    }
    if (!moved) break
  }
  x = clampTo(x, bounds.minX + hx, bounds.maxX - hx)
  z = clampTo(z, bounds.minZ + hz, bounds.maxZ - hz)
  return { x, z }
}

/**
 * 将每个容器内的家具约束在墙体之内，避免家具与墙/门重叠；
 * 父房间内若有嵌套子房间，家具还要被推出其占地（真·内嵌：父房间可用空间减去嵌套占地）。
 * 容器边界按墙体厚度内缩；家具保持自身半宽/半深余量。
 */
export function normalizeContainment(scene: SceneModel): SceneModel {
  return { ...scene, root: containChildren(scene.root) }
}

function containChildren(container: ContainerNode): ContainerNode {
  const minX = container.position.x - container.dimensions.length / 2 + WALL_THICKNESS
  const maxX = container.position.x + container.dimensions.length / 2 - WALL_THICKNESS
  const minZ = container.position.z - container.dimensions.width / 2 + WALL_THICKNESS
  const maxZ = container.position.z + container.dimensions.width / 2 - WALL_THICKNESS
  const bounds: Rect = { minX, maxX, minZ, maxZ }

  // 父房间内嵌套子房间的禁止进入区：父房间家具须避开（仅父是房间时生效；顶层房间父是整屋不处理）
  const nestedKeepOuts: Rect[] =
    container.type === 'room'
      ? container.children.filter((c): c is ContainerNode => c.type === 'room').map(nestedKeepOut)
      : []

  const children = container.children.map((child) => {
    if (isContainer(child)) {
      // 嵌套房间（如卧室内卫生间，父节点是房间）：整体约束进父房间内部，再递归约束其家具。
      // 顶层房间（父节点是整屋）由布局引擎放置，不约束位置。
      if (container.type === 'room') {
        const hx = child.dimensions.length / 2
        const hz = child.dimensions.width / 2
        return containChildren({
          ...child,
          position: {
            x: clampTo(child.position.x, minX + hx, maxX - hx),
            y: child.position.y,
            z: clampTo(child.position.z, minZ + hz, maxZ - hz),
          },
        })
      }
      return containChildren(child)
    }
    const hx = child.dimensions.length / 2
    const hz = child.dimensions.width / 2
    let x = clampTo(child.position.x, minX + hx, maxX - hx)
    let z = clampTo(child.position.z, minZ + hz, maxZ - hz)
    // 真·内嵌：把家具推出嵌套子房间占地（生成时由 furniturePlacement 负责，这里兜底手动编辑/加载）
    if (nestedKeepOuts.length > 0) {
      const pushed = pushOutOfRects(x, z, hx, hz, nestedKeepOuts, bounds)
      x = pushed.x
      z = pushed.z
    }
    return { ...child, position: { ...child.position, x, z } }
  })
  return { ...container, children }
}
