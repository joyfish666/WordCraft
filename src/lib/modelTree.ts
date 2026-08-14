import type {
  Dimensions,
  FurnitureNode,
  HouseNode,
  ModelNode,
  Point2D,
  Position,
  RoomNode,
  SceneModel,
} from '../types/model'
import { footprintBounds, footprintCenter, resizeFootprint, translateFootprint } from './footprint'
import { doorZoneRect } from './furniturePlacement'
import {
  halfRectOverlaps,
  nestedKeepOutRect,
  roomInnerBounds,
  translateRoom,
  type Rect,
} from './geometry'
import { computeDoorZones, type DoorZoneInfo } from './roomGeometry'

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

/** 平移房间（足迹 + 家具 + 嵌套房间，递归），保持内部相对关系。同源实现见 geometry.translateRoom */
export { translateRoom as translateRoomContents } from './geometry'

/**
 * 纯平移校验容差（米）：同一足迹平移前后逐顶点位移应完全一致（同一批算术，
 * 浮点误差 ~1e-13 量级），用比 EPSILON 更紧的 1e-9 区分「纯平移」与「改形状」——
 * 判定错误会导致编辑日志把改形状误记为平移（回放错位）。
 */
const TRANSLATION_EPSILON = 1e-9

/** 判断新足迹是否为旧足迹的纯平移（每顶点位移一致）；非纯平移（改形状/缩放）返回 null */
function footprintTranslation(
  before: Point2D[],
  after: Point2D[],
): { dx: number; dz: number } | null {
  if (before.length !== after.length || before.length === 0) return null
  const dx = after[0]!.x - before[0]!.x
  const dz = after[0]!.z - before[0]!.z
  if (dx === 0 && dz === 0) return null
  for (let i = 1; i < before.length; i++) {
    if (Math.abs(after[i]!.x - before[i]!.x - dx) > TRANSLATION_EPSILON) return null
    if (Math.abs(after[i]!.z - before[i]!.z - dz) > TRANSLATION_EPSILON) return null
  }
  return { dx, dz }
}

/** 不可变更新：将指定节点的 position 替换为新值（房间 → 平移足迹），返回新的树 */
export function updateNodePosition(root: ModelNode, id: string, position: Position): ModelNode {
  if (root.id === id) {
    if (root.type === 'room') {
      const c = footprintCenter(root.footprint)
      return translateRoom(root, position.x - c.x, position.z - c.z)
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

/** 不可变更新：将指定房间的足迹替换为新顶点环，返回新的树 */
export function updateNodeFootprint(root: ModelNode, id: string, footprint: Point2D[]): ModelNode {
  if (root.id === id) {
    if (root.type !== 'room') return root // 仅房间有足迹
    // 足迹变化是纯平移时（如编辑日志回放 updateRoom.patch.footprint 的房间移动），
    // 家具与嵌套房间须同步平移，与 updateNodePosition/updateNodeFields 行为一致
    const t = footprintTranslation(root.footprint, footprint)
    if (t) return translateRoom(root, t.dx, t.dz)
    return { ...root, footprint }
  }
  if (isContainer(root)) {
    const children: ModelNode[] =
      root.type === 'house'
        ? root.levels.flatMap((l) => l.rooms)
        : [...root.furniture, ...root.nestedRooms]
    let changed = false
    const mapped = children.map((c) => {
      const next = updateNodeFootprint(c, id, footprint)
      if (next !== c) changed = true
      return next
    })
    if (!changed) return root
    return rebuildContainer(root, mapped)
  }
  return root
}

/**
 * 不可变删除：将指定节点从其父容器移除（房间/家具通用）。
 * id 命中根节点本身时不做任何删除（整屋不可移除），返回原树。
 * 注意：删除会改变容器子节点数量，不走 rebuildContainer（其长度守卫面向更新场景）。
 */
export function removeNode(root: ModelNode, id: string): ModelNode {
  if (root.id === id) return root
  if (root.type === 'house') {
    const level = root.levels[0]!
    const rooms = level.rooms
    const remaining = rooms.filter((r) => r.id !== id)
    if (remaining.length < rooms.length) {
      return { ...root, levels: [{ ...level, rooms: remaining }] }
    }
    let changed = false
    const mapped = rooms.map((r) => {
      const next = removeNode(r, id)
      if (next !== r) changed = true
      return next
    })
    if (!changed) return root
    return { ...root, levels: [{ ...level, rooms: mapped as RoomNode[] }] }
  }
  if (root.type === 'room') {
    const furniture = root.furniture.filter((f) => f.id !== id)
    const nestedRooms = root.nestedRooms.filter((r) => r.id !== id)
    const directlyRemoved =
      furniture.length < root.furniture.length || nestedRooms.length < root.nestedRooms.length
    if (directlyRemoved) {
      return { ...root, furniture, nestedRooms }
    }
    let changed = false
    const nextFurniture = root.furniture.map((f) => {
      const next = removeNode(f, id)
      if (next !== f) changed = true
      return next
    })
    const nextNested = root.nestedRooms.map((r) => {
      const next = removeNode(r, id)
      if (next !== r) changed = true
      return next
    })
    if (!changed) return root
    return {
      ...root,
      furniture: nextFurniture as FurnitureNode[],
      nestedRooms: nextNested as RoomNode[],
    }
  }
  return root
}

/** 按新的子节点列表重建容器（楼层/房间），子节点结构不变时引用不变 */
function rebuildContainer(root: HouseNode | RoomNode, children: ModelNode[]): ModelNode {
  if (root.type === 'house') {
    const rooms = children as RoomNode[]
    const level = root.levels[0]!
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
      let next: RoomNode = { ...root }
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
        if (dx !== 0 || dz !== 0) next = translateRoom(next, dx, dz)
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
// （嵌套禁入区/墙内活动区的共享实现见 geometry.nestedKeepOutRect / roomInnerBounds）

/**
 * 推出禁区（≤4 次迭代）：对每个禁区生成候选 = 沿 X/Z 最小穿透推出 + 四个方向
 * 「完全退出」（移动到禁区边界外侧）的钳制结果，选择重叠数最少的候选（优先完全避开）。
 * 候选对**所有**禁区生成（不只当前重叠的）——只对当前重叠禁区取候选时，
 * 家具推出 A 可能恰好撞进 B（如卫生间旁的门区），重叠数不变被拒绝而原地不动（几何有解但找不到）。
 * 旧实现只沿最小穿透轴推一次再钳制——① 钳制会把家具拉回禁区（家具贴墙时尤其明显）；
 * ② 完全在禁区内的家具（nestRoom 把卫生间嵌进已有家具的房间时）最小穿透推不出去；
 * ③ 贴边浮点噪声被判为重叠。三处都导致家具与嵌套房间可见重叠（坑 47）。
 */
function pushOutOfRects(
  x: number,
  z: number,
  hx: number,
  hz: number,
  keepOuts: Rect[],
  bounds: Rect,
): { x: number; z: number } {
  const clampPos = (px: number, pz: number): { x: number; z: number } => ({
    x: clampTo(px, bounds.minX + hx, bounds.maxX - hx),
    z: clampTo(pz, bounds.minZ + hz, bounds.maxZ - hz),
  })
  const overlapCount = (px: number, pz: number): number =>
    keepOuts.reduce((n, k) => n + (halfRectOverlaps(px, pz, hx, hz, k) ? 1 : 0), 0)
  for (let iter = 0; iter < 4; iter++) {
    const current = overlapCount(x, z)
    if (current === 0) break
    let best: { x: number; z: number } | null = null
    let bestCount = Infinity
    for (const k of keepOuts) {
      const cx = (k.minX + k.maxX) / 2
      const cz = (k.minZ + k.maxZ) / 2
      const penX = hx + (k.maxX - k.minX) / 2 - Math.abs(x - cx)
      const penZ = hz + (k.maxZ - k.minZ) / 2 - Math.abs(z - cz)
      const candidates = [
        clampPos(x + (x >= cx ? penX : -penX), z),
        clampPos(x, z + (z >= cz ? penZ : -penZ)),
        clampPos(k.minX - hx, z),
        clampPos(k.maxX + hx, z),
        clampPos(x, k.minZ - hz),
        clampPos(x, k.maxZ + hz),
      ]
      for (const cand of candidates) {
        const n = overlapCount(cand.x, cand.z)
        if (n < bestCount || (n === bestCount && best === null)) {
          best = cand
          bestCount = n
        }
      }
    }
    if (!best || bestCount >= current) break // 无改进（几何上放不下），接受当前结果
    x = best.x
    z = best.z
  }
  return { x, z }
}

/**
 * 将每个容器内的家具约束在墙体之内，避免家具与墙/门重叠；
 * 父房间内若有嵌套子房间，家具还要被推出其占地（真·内嵌：父房间可用空间减去嵌套占地）。
 * 房间门口（含入户门）也是禁止进入区（与渲染/常理摆放同源）：手动编辑把家具拖进
 * 门口通道时会被推开，与生成路径行为一致。
 * 容器边界按墙体厚度内缩（沿足迹包围盒）；家具保持自身半宽/半深余量。
 */
export function normalizeContainment(scene: SceneModel): SceneModel {
  const rooms = scene.root.levels[0]?.rooms ?? []
  const doorZones = computeDoorZones(rooms, {
    entrance: scene.root.entranceDir ?? 'south',
    entranceRoomId: scene.root.entranceRoomId,
  })
  return { ...scene, root: containChildren(scene.root, doorZones) as SceneModel['root'] }
}

function containChildren(
  container: HouseNode | RoomNode,
  doorZones: Map<string, DoorZoneInfo[]>,
): HouseNode | RoomNode {
  if (container.type === 'house') {
    return {
      ...container,
      levels: container.levels.map((level) => ({
        ...level,
        rooms: level.rooms.map((r) => containRoom(r, doorZones)),
      })),
    }
  }
  return containRoom(container, doorZones)
}

function containRoom(room: RoomNode, doorZones: Map<string, DoorZoneInfo[]>): RoomNode {
  const bounds: Rect = roomInnerBounds(room)

  // 嵌套子房间的禁止进入区：父房间家具须避开
  const nestedKeepOuts: Rect[] = room.nestedRooms.map(nestedKeepOutRect)
  // 房间门口通道的禁止进入区（与渲染/常理摆放同源）；嵌套房间无门区条目（computeDoorZones 只遍历顶层）
  const doorKeepOuts: Rect[] = (doorZones.get(room.id) ?? []).map((z) => doorZoneRect(room, z))
  const keepOuts = [...nestedKeepOuts, ...doorKeepOuts]

  const furniture = room.furniture.map((child) => {
    const hx = child.dimensions.length / 2
    const hz = child.dimensions.width / 2
    let x = clampTo(child.position.x, bounds.minX + hx, bounds.maxX - hx)
    let z = clampTo(child.position.z, bounds.minZ + hz, bounds.maxZ - hz)
    // 真·内嵌：把家具推出嵌套子房间占地与门口通道（生成时由 furniturePlacement 负责，这里兜底手动编辑/加载）
    if (keepOuts.length > 0) {
      const pushed = pushOutOfRects(x, z, hx, hz, keepOuts, bounds)
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
    const moved = containRoom(child, doorZones)
    const nc = footprintCenter(moved.footprint)
    const targetX = clampTo(nc.x, bounds.minX + hx, bounds.maxX - hx)
    const targetZ = clampTo(nc.z, bounds.minZ + hz, bounds.maxZ - hz)
    const dx = targetX - c.x
    const dz = targetZ - c.z
    if (dx === 0 && dz === 0) return moved
    return containRoom(
      { ...moved, footprint: translateFootprint(moved.footprint, dx, dz) },
      doorZones,
    )
  })

  return { ...room, furniture, nestedRooms }
}
