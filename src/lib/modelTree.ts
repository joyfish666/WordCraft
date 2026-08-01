import type { ModelNode, Position } from '../types/model'

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
