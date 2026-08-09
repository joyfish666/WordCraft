import type { Dimensions, FurnitureNode, HouseNode, ModelNode, Position, RoomNode, SceneModel } from '../types/model'
import { footprintBounds, footprintCenter, resizeFootprint, translateFootprint } from './footprint'
import { WALL_THICKNESS } from './roomGeometry'

/**
 * 深度优先遍历树中的所有节点。
 * 根节点本身也会被访问。
 */
export function walk(node: ModelNode, visit: (n: ModelNode) => void): void {
  visit(node)
  if (isContainer(node)) {
    if (node.type === 'house') {
      for (const level of node.levels) {
        for (const room of level.rooms) {
          walk(room, visit)
        }
      }
    } else {
      for (const child of node.furniture) {
        walk(child, visit)
      }
      for (const child of node.nestedRooms) {
        walk(child, visit)
      }
    }
  }
}

/** 是否为容器节点（房间 / 整屋） */
export function isContainer(node: ModelNode): node is HouseNode | RoomNode {
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
      const children: ModelNode[] =
        node.type === 'house'
          ? node.levels.flatMap((l) => l.rooms)
          : [...node.furniture, ...node.nestedRooms]
      for (const child of children) {
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

/** 不可变更新：将指定节点的 position 替换为新值（房间 → 平移足迹），返回新的树 */
export function updateNodePosition(root: ModelNode, id: string, position: Position): ModelNode {
  if (root.id === id) {
    if (root.type === 'room') {
      const c = footprintCenter(root.footprint)
      return { ...root, footprint: translateFootprint(root.footprint, position.x - c.x, position.z - c.z) }
    }
    if (root.type === 'house') return root // 整屋无 position 字段
    return { ...root, position }
  }
  if (isContainer(root)) {
    const children: ModelNode[] =
      root.type === 'house'
        ? root.levels.flatMap((l) => l.rooms)
        : [...root.furniture, ...root.nestedRooms]
    let changed = false
    const mapped = children.map((c) => {
      const next = updateNodePosition(c, id, position)
      if (next !== c) changed = true
      return next
    })
    if (!changed) return root
    return rebuildContainer(root, mapped)
  }
  return root
}

/** 按新的子节点列表重建容器（楼层/房间），子节点结构不变时引用不变 */
function rebuildContainer(root: HouseNode | RoomNode, children: ModelNode[]): ModelNode {
  if (root.type === 'house') {
    const rooms = children as RoomNode[]
    const level = root.levels[0]
    if (level.rooms.length === rooms.length) {
      return { ...root, levels: [{ ...level, rooms }] }
    }
    return root
  }
  const furniture = children.filter((c): c is FurnitureNode => c.type === 'furniture')
  const nestedRooms = children.filter((c): c is RoomNode => c.type === 'room')
  return { ...root, furniture, nestedRooms }
}

/** 节点字段补丁：名称 / 尺寸（部分） / 位置（部分），未提供的字段保持原值 */
export interface NodeFieldsPatch {
  name?: string
  dimensions?: Partial<Dimensions>
  position?: Partial<Position>
}

/**
 * 不可变更新：将指定节点的 name / dimensions / position 按补丁合并替换。
 * - 家具：直接写字段；房间：dimensions → 缩放足迹（height → 层高）、position → 平移足迹；
 * - 整屋：仅 name 有效。
 * 未命中节点或补丁为空时返回原树（引用不变），便于调用方短路跳过。
 */
export function updateNodeFields(root: ModelNode, id: string, patch: NodeFieldsPatch): ModelNode {
  if (root.id === id) {
    if (!patch.name && !patch.dimensions && !patch.position) return root
    if (root.type === 'house') {
      if (!patch.name) return root
      return { ...root, name: patch.name }
    }
    if (root.type === 'room') {
      const next: RoomNode = { ...root }
      if (patch.name !== undefined) next.name = patch.name
      if (patch.dimensions) {
        const d = patch.dimensions
        if (d.length !== undefined || d.width !== undefined) {
          const cur = roomDimsRect(root)
          next.footprint = resizeFootprint(
            root.footprint,
            d.length ?? cur.length,
            d.width ?? cur.width,
          )
        }
        if (d.height !== undefined) next.height = d.height
      }
      if (patch.position) {
        const c = footprintCenter(root.footprint)
        const dx = (patch.position.x ?? c.x) - c.x
        const dz = (patch.position.z ?? c.z) - c.z
        if (dx !== 0 || dz !== 0) next.footprint = translateFootprint(root.footprint, dx, dz)
      }
      return next
    }
    const next: FurnitureNode = { ...root }
    if (patch.name !== undefined) next.name = patch.name
    if (patch.dimensions) next.dimensions = { ...root.dimensions, ...patch.dimensions }
    if (patch.position) next.position = { ...root.position, ...patch.position }
    return next
  }
  if (isContainer(root)) {
    const children: ModelNode[] =
      root.type === 'house'
        ? root.levels.flatMap((l) => l.rooms)
        : [...root.furniture, ...root.nestedRooms]
    let changed = false
    const mapped = children.map((c) => {
      const next = updateNodeFields(c, id, patch)
      if (next !== c) changed = true
      return next
    })
    if (!changed) return root
    return rebuildContainer(root, mapped)
  }
  return root
}

/** 房间足迹包围盒尺寸（局部辅助） */
function roomDimsRect(room: RoomNode): { length: number; width: number } {
  const b = footprintBounds(room.footprint)
  return { length: b.maxX - b.minX, width: b.maxZ - b.minZ }
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

/** 嵌套房间的禁止进入区：足迹包围盒 + 墙厚外扩 */
function nestedKeepOut(room: RoomNode): Rect {
  const b = footprintBounds(room.footprint)
  return {
    minX: b.minX - WALL_THICKNESS,
    maxX: b.maxX + WALL_THICKNESS,
    minZ: b.minZ - WALL_THICKNESS,
    maxZ: b.maxZ + WALL_THICKNESS,
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
 * 容器边界按墙体厚度内缩（沿足迹包围盒）；家具保持自身半宽/半深余量。
 */
export function normalizeContainment(scene: SceneModel): SceneModel {
  return { ...scene, root: containChildren(scene.root) as SceneModel['root'] }
}

function containChildren(container: HouseNode | RoomNode): HouseNode | RoomNode {
  if (container.type === 'house') {
    return {
      ...container,
      levels: container.levels.map((level) => ({ ...level, rooms: level.rooms.map(containRoom) })),
    }
  }
  return containRoom(container)
}

function containRoom(room: RoomNode): RoomNode {
  const b = footprintBounds(room.footprint)
  const minX = b.minX + WALL_THICKNESS
  const maxX = b.maxX - WALL_THICKNESS
  const minZ = b.minZ + WALL_THICKNESS
  const maxZ = b.maxZ - WALL_THICKNESS
  const bounds: Rect = { minX, maxX, minZ, maxZ }

  // 嵌套子房间的禁止进入区：父房间家具须避开
  const nestedKeepOuts: Rect[] = room.nestedRooms.map(nestedKeepOut)

  const furniture = room.furniture.map((child) => {
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

  // 嵌套房间：整体约束进父房间内部（平移足迹），再递归约束其家具
  const nestedRooms = room.nestedRooms.map((child) => {
    const c = footprintCenter(child.footprint)
    const cb = footprintBounds(child.footprint)
    const hx = (cb.maxX - cb.minX) / 2
    const hz = (cb.maxZ - cb.minZ) / 2
    const moved = containRoom(child)
    const nc = footprintCenter(moved.footprint)
    const targetX = clampTo(nc.x, minX + hx, maxX - hx)
    const targetZ = clampTo(nc.z, minZ + hz, maxZ - hz)
    const dx = targetX - c.x
    const dz = targetZ - c.z
    if (dx === 0 && dz === 0) return moved
    return containRoom({
      ...moved,
      footprint: translateFootprint(moved.footprint, dx, dz),
    })
  })

  return { ...room, furniture, nestedRooms }
}
