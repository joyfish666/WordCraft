import { logDebug } from './debugLog'
import { isContainer, normalizeContainment } from './modelTree'
import { WALL_THICKNESS, isCorridorName } from './roomGeometry'
import type {
  ContainerNode,
  FurnitureNode,
  HouseNodeV2,
  Position,
  RoomNodeV2,
  SceneModel,
  SceneModelV2,
} from '../types/model'

const DEFAULT_CORRIDOR_WIDTH = 1.2
const DEFAULT_ROOM_HEIGHT = 2.8

const SIDES = ['north', 'south', 'east', 'west'] as const
type LivingSide = (typeof SIDES)[number]

/**
 * 将 v2 语义模型解析为 v1 绝对坐标模型（供渲染/存储/墙体方案消费）。
 * - auto 模式：由布局引擎确定性平铺（走廊型 / 客厅居中型）
 * - custom 模式：使用 LLM 提供的房间绝对坐标
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
  const model = normalizeContainment({ version: 1, root })
  logDebug('布局解析完成', {
    house: model.root.name,
    houseDimensions: model.root.dimensions,
    rooms: model.root.children.map((c) => ({
      name: c.name,
      position: c.position,
      dimensions: c.dimensions,
      furniture: c.type === 'room' ? c.children.length : 0,
    })),
  })
  return model
}

function resolveHouse(house: HouseNodeV2): ContainerNode {
  const layout = house.layout
  if (layout.mode === 'auto') {
    return layout.template === 'corridor' ? resolveCorridor(house) : resolveLiving(house)
  }
  return resolveCustom(house)
}

/** 由 RoomNodeV2 构建 ContainerNode：房间居地面，家具相对房间中心偏移为绝对坐标 */
function makeRoom(r: RoomNodeV2, cx: number, cz: number): ContainerNode {
  const H = r.dimensions.height
  const children: FurnitureNode[] = r.children.map((f) => ({
    id: f.id,
    type: f.type,
    name: f.name,
    dimensions: f.dimensions,
    position: { x: cx + f.position.x, y: f.position.y, z: cz + f.position.z },
    rotationY: f.rotationY,
    description: f.description,
  }))
  return {
    id: r.id,
    type: 'room',
    name: r.name,
    dimensions: r.dimensions,
    position: { x: cx, y: H / 2, z: cz },
    children,
  }
}

/** 求所有房间+走廊的包围盒并平移到整屋中心（原点），返回整屋根节点 */
function finalizeHouse(house: HouseNodeV2, children: ContainerNode[]): ContainerNode {
  if (children.length === 0) {
    return {
      id: house.id,
      type: 'house',
      name: house.name,
      dimensions: { length: 4, width: 3, height: 2.8 },
      position: { x: 0, y: 0, z: 0 },
      children,
    }
  }
  const xs: number[] = []
  const zs: number[] = []
  let maxTop = 0
  for (const c of children) {
    xs.push(c.position.x - c.dimensions.length / 2, c.position.x + c.dimensions.length / 2)
    zs.push(c.position.z - c.dimensions.width / 2, c.position.z + c.dimensions.width / 2)
    maxTop = Math.max(maxTop, c.position.y + c.dimensions.height / 2)
  }
  const minX = Math.min(...xs) - WALL_THICKNESS
  const maxX = Math.max(...xs) + WALL_THICKNESS
  const minZ = Math.min(...zs) - WALL_THICKNESS
  const maxZ = Math.max(...zs) + WALL_THICKNESS
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2

  return {
    id: house.id,
    type: 'house',
    name: house.name,
    dimensions: {
      length: maxX - minX,
      width: maxZ - minZ,
      height: Math.max(maxTop, house.dimensions.height),
    },
    position: { x: 0, y: 0, z: 0 },
    // 记录入户房间，供墙体方案在南外墙开入户门
    entranceRoomId:
      house.layout.mode === 'auto' && house.layout.template === 'corridor'
        ? house.layout.corridor?.entranceRoomId
        : undefined,
    children: children.map((c) => translateNode(c, -centerX, -centerZ)),
  }
}

/** 平移一个容器节点（含其子节点与家具），保持相对关系 */
function translateNode(node: ContainerNode, dx: number, dz: number): ContainerNode {
  return {
    ...node,
    position: { ...node.position, x: node.position.x + dx, z: node.position.z + dz },
    children: node.children.map((c) =>
      isContainer(c) ? translateNode(c, dx, dz) : shiftPosition(c, dx, dz),
    ),
  }
}

function shiftPosition<T extends { position: Position }>(node: T, dx: number, dz: number): T {
  return { ...node, position: { ...node.position, x: node.position.x + dx, z: node.position.z + dz } }
}

// ---------------------------------------------------------------------------
// 走廊型
// ---------------------------------------------------------------------------

function resolveCorridor(house: HouseNodeV2): ContainerNode {
  const rooms = house.children.filter((r) => !isCorridorName(r.name))
  const layout = house.layout
  const corridorWidth = layout.mode === 'auto' && layout.template === 'corridor'
    ? (layout.corridor?.width ?? DEFAULT_CORRIDOR_WIDTH)
    : DEFAULT_CORRIDOR_WIDTH
  const entranceId =
    layout.mode === 'auto' && layout.template === 'corridor'
      ? layout.corridor?.entranceRoomId
      : undefined

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

  // 房间沿走廊两侧顺序堆叠，墙与走廊无缝贴合
  const cursor = { left: 0, right: 0 }
  const placed: ContainerNode[] = ordered.map((r) => {
    const along = r.dimensions.length
    const depth = r.dimensions.width
    const isEntrance = r.id === entranceId
    const side = isEntrance || r.side === 'left' ? 'left' : 'right'
    const sign = side === 'left' ? -1 : 1
    const x0 = cursor[side]
    const cx = x0 + along / 2
    const cz = sign * (corridorWidth / 2 + depth / 2)
    cursor[side] = x0 + along
    return makeRoom(r, cx, cz)
  })

  const totalLength = Math.max(cursor.left, cursor.right)
  const corridorH = Math.max(...ordered.map((r) => r.dimensions.height), DEFAULT_ROOM_HEIGHT)

  const corridor: ContainerNode = {
    id: 'corridor',
    type: 'room',
    name: '走廊',
    dimensions: { length: totalLength, width: corridorWidth, height: corridorH },
    position: { x: totalLength / 2, y: corridorH / 2, z: 0 },
    children: [],
  }

  return finalizeHouse(house, [corridor, ...placed])
}

// ---------------------------------------------------------------------------
// 客厅居中型
// ---------------------------------------------------------------------------

function resolveLiving(house: HouseNodeV2): ContainerNode {
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
function placeRow(
  sideRooms: RoomNodeV2[],
  side: LivingSide,
  cl: number,
  cw: number,
): ContainerNode[] {
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

function resolveCustom(house: HouseNodeV2): ContainerNode {
  const children = house.children.map((r) => makeRoom(r, r.position?.x ?? 0, r.position?.z ?? 0))
  return finalizeHouse(house, children)
}
