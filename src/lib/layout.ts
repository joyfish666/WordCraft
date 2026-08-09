import { logDebug } from './debugLog'
import { footprintCenter, levelHeight, rectFootprint, translateFootprint } from './footprint'
import { applyFurnitureConventions } from './furniturePlacement'
import { normalizeContainment } from './modelTree'
import { WALL_THICKNESS, isCorridorName } from './roomGeometry'
import type {
  FurnitureNode,
  FurnitureNodeV2,
  HouseNode,
  HouseNodeV2,
  LevelNode,
  Point2D,
  RoomNode,
  RoomNodeV2,
  SceneModel,
  SceneModelV2,
} from '../types/model'

const DEFAULT_CORRIDOR_WIDTH = 1.2
const DEFAULT_ROOM_HEIGHT = 2.8

const SIDES = ['north', 'south', 'east', 'west'] as const
type LivingSide = (typeof SIDES)[number]

/**
 * 将 v2 语义模型解析为 v3 绝对坐标模型（足迹几何，供渲染/存储/墙体方案消费）。
 * - auto 模式：由布局引擎确定性平铺（走廊型 / 客厅居中型）
 * - custom 模式：使用 LLM 提供的房间绝对坐标
 * - 房间一律转为 4 点矩形足迹（v3 支持任意正交多边形，P1 平铺仍为矩形）
 * - 家具位置统一由「相对房间中心」偏移为绝对坐标，并经 normalizeContainment 约束进墙内
 */
export function resolveLayout(scene: SceneModelV2): SceneModel {
  const layout = scene.root.layout
  logDebug('布局引擎开始', {
    mode: layout.mode,
    template: layout.mode === 'auto' ? layout.template : 'custom',
    house: scene.root.name,
  })
  const root = resolveHouse(scene.root)
  let model = normalizeContainment({ version: 3, root })
  // 常规布局（auto）按家具常理贴墙放置；custom 自由布局保留大模型的显式坐标
  if (layout.mode === 'auto') {
    model = applyFurnitureConventions(model)
    model = normalizeContainment(model)
  }
  const rooms = model.root.levels[0].rooms
  logDebug('布局解析完成', {
    house: model.root.name,
    rooms: rooms.map((c) => ({
      name: c.name,
      center: centerOf(c),
      dims: dimsOf(c),
      furniture: c.furniture.length,
    })),
  })
  return model
}

function centerOf(r: RoomNode): { x: number; z: number } {
  let sx = 0
  let sz = 0
  for (const p of r.footprint) {
    sx += p.x
    sz += p.z
  }
  const n = r.footprint.length
  return n > 0 ? { x: sx / n, z: sz / n } : { x: 0, z: 0 }
}

function dimsOf(r: RoomNode): { length: number; width: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of r.footprint) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  return { length: maxX - minX, width: maxZ - minZ }
}

function resolveHouse(house: HouseNodeV2): HouseNode {
  const layout = house.layout
  if (layout.mode === 'auto') {
    return layout.template === 'corridor' ? resolveCorridor(house) : resolveLiving(house)
  }
  return resolveCustom(house)
}

/**
 * 计算嵌套房间在父房间内的相对位置（相对父中心）：
 * - 有 side 提示（north/south/east/west）→ 靠父房间对应方向的**角落**（贴两面墙，符合常理）
 * - 无 side 但有 position → 用相对偏移
 * - 均无 → 按常理靠父房间东北角
 * 结果会约束在父房间内部（去墙厚），normalizeContainment 也会再次兜底。
 */
function placeNested(
  n: RoomNodeV2,
  parentLen: number,
  parentWid: number,
): { x: number; z: number } {
  const halfX = Math.max(0, (parentLen - n.dimensions.length) / 2 - WALL_THICKNESS)
  const halfZ = Math.max(0, (parentWid - n.dimensions.width) / 2 - WALL_THICKNESS)

  let x = 0
  let z = 0
  switch (n.side) {
    case 'north':
      x = -halfX
      z = halfZ
      break
    case 'south':
      x = halfX
      z = -halfZ
      break
    case 'east':
      x = halfX
      z = halfZ
      break
    case 'west':
      x = -halfX
      z = -halfZ
      break
    default:
      if (n.position) {
        x = n.position.x
        z = n.position.z
      } else {
        // 常理：靠东北角
        x = halfX
        z = halfZ
      }
  }
  x = Math.min(Math.max(x, -halfX), halfX)
  z = Math.min(Math.max(z, -halfZ), halfZ)
  return { x, z }
}

/**
 * 由 RoomNodeV2 构建 v3 RoomNode：矩形足迹居地面，家具相对房间中心偏移为绝对坐标；
 * 嵌套子房间（如卧室内卫生间）保留在父房间内部，按 side/常理角落放置。
 * footprint 参数：custom 模式显式顶点环（世界坐标），提供时优先于 dimensions 矩形。
 */
export function makeRoom(r: RoomNodeV2, cx: number, cz: number, footprint?: Point2D[]): RoomNode {
  const H = r.dimensions.height
  // 显式 footprint 时以足迹中心为家具锚点；否则以矩形中心为锚点
  const anchor = footprint && footprint.length >= 4 ? footprintCenter(footprint) : { x: cx, z: cz }
  const furniture = r.children.filter((c) => c.type !== 'room') as FurnitureNodeV2[]
  const nested = r.children.filter((c) => c.type === 'room') as RoomNodeV2[]
  return {
    id: r.id,
    type: 'room',
    name: r.name,
    footprint:
      footprint && footprint.length >= 4
        ? footprint
        : rectFootprint(cx, cz, r.dimensions.length, r.dimensions.width),
    height: H,
    doors: [],
    windows: [],
    furniture: furniture.map((f): FurnitureNode => ({
      id: f.id,
      type: 'furniture',
      name: f.name,
      dimensions: f.dimensions,
      position: { x: anchor.x + f.position.x, y: f.position.y, z: anchor.z + f.position.z },
      rotationY: f.rotationY,
      description: f.description,
    })),
    nestedRooms: nested.map((n) => {
      const rel = placeNested(n, r.dimensions.length, r.dimensions.width)
      return makeRoom(n, anchor.x + rel.x, anchor.z + rel.z)
    }),
  }
}

/** 求所有房间足迹的包围盒并平移到整屋中心（原点），返回 v3 整屋根节点（单层） */
function finalizeHouse(house: HouseNodeV2, rooms: RoomNode[]): HouseNode {
  const roomId = `level-${house.id}`
  if (rooms.length === 0) {
    return {
      id: house.id,
      type: 'house',
      name: house.name,
      levels: [{ id: roomId, height: house.dimensions.height, rooms: [] }],
      ...(house.layout.mode === 'auto' && house.layout.template === 'corridor'
        ? { entranceRoomId: house.layout.corridor?.entranceRoomId }
        : {}),
    }
  }
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const r of rooms) {
    for (const p of r.footprint) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.z < minZ) minZ = p.z
      if (p.z > maxZ) maxZ = p.z
    }
  }
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2
  // 平移整棵树（顶层 + 嵌套房间足迹 + 家具），保持相对关系
  const centered = rooms.map((r) => translateRoom(r, -centerX, -centerZ))

  const level: LevelNode = {
    id: roomId,
    height: Math.max(levelHeight(centered), house.dimensions.height),
    rooms: centered,
  }
  return {
    id: house.id,
    type: 'house',
    name: house.name,
    // 记录入户房间，供墙体方案在南外墙开入户门
    ...(house.layout.mode === 'auto' && house.layout.template === 'corridor'
      ? { entranceRoomId: house.layout.corridor?.entranceRoomId }
      : {}),
    levels: [level],
  }
}

/** 平移一个房间（含其家具与嵌套房间足迹），保持相对关系 */
function translateRoom(node: RoomNode, dx: number, dz: number): RoomNode {
  return {
    ...node,
    footprint: translateFootprint(node.footprint, dx, dz),
    furniture: node.furniture.map((f) => ({
      ...f,
      position: { ...f.position, x: f.position.x + dx, z: f.position.z + dz },
    })),
    nestedRooms: node.nestedRooms.map((n) => translateRoom(n, dx, dz)),
  }
}

// ---------------------------------------------------------------------------
// 走廊型
// ---------------------------------------------------------------------------

function resolveCorridor(house: HouseNodeV2): HouseNode {
  const layout = house.layout
  const corridorWidth =
    layout.mode === 'auto' && layout.template === 'corridor'
      ? (layout.corridor?.width ?? DEFAULT_CORRIDOR_WIDTH)
      : DEFAULT_CORRIDOR_WIDTH
  const entranceId =
    layout.mode === 'auto' && layout.template === 'corridor'
      ? layout.corridor?.entranceRoomId
      : undefined
  // 入口房间即使名字含「走廊」（如"入口走廊"）也保留为真实房间，否则会被当走廊过滤掉，
  // entranceRoomId 指向不存在房间 → 大门回退到南边界房间，改大门位置无反应
  const rooms = house.children.filter((r) => !isCorridorName(r.name) || r.id === entranceId)

  // 入口房间放最前（近走廊 x=0 入口端），并强制置于走廊南侧（left），保证入户门在南外墙
  const ordered = entranceId
    ? [...rooms].sort((a, b) => {
        if (a.id === entranceId) return -1
        if (b.id === entranceId) return 1
        return 0
      })
    : rooms

  // 单房间：无需走廊，房间居中
  if (ordered.length <= 1) {
    const single = ordered[0]
    return finalizeHouse(house, single ? [makeRoom(single, 0, 0)] : [])
  }

  // 房间沿走廊两侧顺序堆叠，墙与走廊无缝贴合。
  // 未指定 side 的房间自动分到两侧（入口固定南侧），使两侧总长尽量均衡，
  // 避免所有房间挤在同一侧导致布局单一
  const sideOf: Array<'left' | 'right' | undefined> = ordered.map((r) =>
    r.id === entranceId
      ? 'left'
      : r.side === 'left' || r.side === 'right'
        ? (r.side as 'left' | 'right')
        : undefined,
  )
  const totals = { left: 0, right: 0 }
  sideOf.forEach((s, i) => {
    if (s) totals[s] += ordered[i].dimensions.length
  })
  sideOf.forEach((s, i) => {
    if (s) return
    const side = totals.left <= totals.right ? 'left' : 'right'
    sideOf[i] = side
    totals[side] += ordered[i].dimensions.length
  })

  const cursor = { left: 0, right: 0 }
  const placed: RoomNode[] = ordered.map((r, i) => {
    const along = r.dimensions.length
    const depth = r.dimensions.width
    const side = sideOf[i]!
    const sign = side === 'left' ? -1 : 1
    const x0 = cursor[side]
    const cx = x0 + along / 2
    const cz = sign * (corridorWidth / 2 + depth / 2)
    cursor[side] = x0 + along
    return makeRoom(r, cx, cz)
  })

  const totalLength = Math.max(cursor.left, cursor.right)
  const corridorH = Math.max(...ordered.map((r) => r.dimensions.height), DEFAULT_ROOM_HEIGHT)

  const corridor: RoomNode = {
    id: 'corridor',
    type: 'room',
    name: '走廊',
    footprint: rectFootprint(totalLength / 2, 0, totalLength, corridorWidth),
    height: corridorH,
    doors: [],
    windows: [],
    furniture: [],
    nestedRooms: [],
  }

  return finalizeHouse(house, [corridor, ...placed])
}

// ---------------------------------------------------------------------------
// 客厅居中型
// ---------------------------------------------------------------------------

function resolveLiving(house: HouseNodeV2): HouseNode {
  const rooms = house.children.filter((r) => !isCorridorName(r.name))
  const layout = house.layout
  const centerId = layout.mode === 'auto' && layout.template === 'living' ? layout.centerRoomId : ''
  const centerRoom = rooms.find((r) => r.id === centerId) ?? rooms[0]
  if (!centerRoom) return finalizeHouse(house, [])

  const centerNode = makeRoom(centerRoom, 0, 0)
  const cl = centerRoom.dimensions.length
  const cw = centerRoom.dimensions.width
  const others = rooms.filter((r) => r !== centerRoom)

  // 房间按 side 分组到中心房间四边；未给 side 时轮转到最少的一侧
  const bySide: Record<LivingSide, RoomNodeV2[]> = { north: [], south: [], east: [], west: [] }
  const counts: Record<LivingSide, number> = { north: 0, south: 0, east: 0, west: 0 }
  for (const r of others) {
    const side = (SIDES as readonly string[]).includes(r.side ?? '')
      ? (r.side as LivingSide)
      : leastLoaded(counts)
    bySide[side].push(r)
    counts[side] += 1
  }

  const placed = [
    centerNode,
    ...placeRow(bySide.north, 'north', cl, cw),
    ...placeRow(bySide.south, 'south', cl, cw),
    ...placeRow(bySide.east, 'east', cl, cw),
    ...placeRow(bySide.west, 'west', cl, cw),
  ]
  return finalizeHouse(house, placed)
}

function leastLoaded(counts: Record<LivingSide, number>): LivingSide {
  return SIDES.reduce((a, b) => (counts[a] <= counts[b] ? a : b))
}

/** 沿中心房间某一边排成一排，贴邻中心，行内房间无缝相连 */
function placeRow(sideRooms: RoomNodeV2[], side: LivingSide, cl: number, cw: number): RoomNode[] {
  const horizontal = side === 'north' || side === 'south'
  const along = (r: RoomNodeV2) => (horizontal ? r.dimensions.length : r.dimensions.width)
  const depth = (r: RoomNodeV2) => (horizontal ? r.dimensions.width : r.dimensions.length)
  const total = sideRooms.reduce((s, r) => s + along(r), 0)
  const sign = side === 'north' || side === 'east' ? 1 : -1
  const offset = horizontal ? cw / 2 : cl / 2
  let cursor = -total / 2
  return sideRooms.map((r) => {
    const a = along(r)
    const d = depth(r)
    const center = cursor + a / 2
    cursor += a
    const cx = horizontal ? center : sign * (offset + d / 2)
    const cz = horizontal ? sign * (offset + d / 2) : center
    return makeRoom(r, cx, cz)
  })
}

// ---------------------------------------------------------------------------
// 自由型
// ---------------------------------------------------------------------------

function resolveCustom(house: HouseNodeV2): HouseNode {
  const children = house.children.map((r) =>
    makeRoom(r, r.position?.x ?? 0, r.position?.z ?? 0, r.footprint),
  )
  return finalizeHouse(house, children)
}
