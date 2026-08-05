import type { ContainerNode, ModelNode, Position, SceneModel } from '../types/model'
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

/** 将数值限制到 [min,max]；区间非法（min>max，容器过小）时返回中点 */
function clampTo(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2
  return Math.min(Math.max(value, min), max)
}

/**
 * 将每个容器内的家具约束在墙体之内，避免家具与墙/门重叠。
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
    return {
      ...child,
      position: {
        x: clampTo(child.position.x, minX + hx, maxX - hx),
        y: child.position.y,
        z: clampTo(child.position.z, minZ + hz, maxZ - hz),
      },
    }
  })
  return { ...container, children }
}
