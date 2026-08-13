import { logDebug } from './debugLog'
import { footprintBounds, footprintCenter, levelHeight, rectFootprint } from './footprint'
import { applyFurnitureConventions, doorZoneRect } from './furniturePlacement'
import { DEFAULT_CORRIDOR_WIDTH } from './constants'
import { findRoomInList, halfRectOverlaps, NEST_CORNER_ORDER, translateRoom } from './geometry'
import { normalizeContainment } from './modelTree'
import { WALL_THICKNESS, computeDoorZones, isCorridorName } from './roomGeometry'
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
  // 嵌套房间避开父房间门口禁区（坑 47 同款，macro 路径的 placeNested 不含避让——
  // 内卫落在东北角可能压住父房间朝走廊的门，门后无墙）
  let model = avoidNestedDoorZones({ version: 3, root })
  if (layout.mode === 'auto') {
    // 常理摆放自带约束（贴墙/避让门口/避让嵌套卫生间/约束进墙），无需先 normalize——
    // 若先 normalize 再摆放：家具会被推到"零重叠但位置差"的角落（如床被推出门口
    // 禁区后悬在房间中部），后续"就近贴墙"会被带偏，把本该留给其他家具的墙面占掉
    // （复现：主卧床被推北上墙，衣柜无处可放、与床重叠）
    model = applyFurnitureConventions(model)
    model = normalizeContainment(model)
    return withLayoutLog(model)
  }
  // custom 自由布局保留大模型的显式坐标，仅约束进墙/推出嵌套占地与门口
  return withLayoutLog(normalizeContainment(model))
}

/** 嵌套房间落点候选符号（与 executor.nestRoom 的坑 47 避让顺序一致：东北/西北/东南/西南，同源见 geometry） */

/**
 * 嵌套房间避开父房间门口禁区（坑 47 的布局引擎版本）：
 * placeNested 按角落规则落位时只看父房间尺寸，不看父房间的门洞——卫生间落在
 * 东北角可能恰好压在父房间朝走廊的门正下方（门后无墙、透过门洞看进卫生间）。
 * 布局完成后统一检查（与渲染的 computeDoorZones 同源，含入户门）：
 * 嵌套房间与父房间门区重叠时，按 东北/西北/东南/西南 确定性顺序移到
 * 第一个不冲突的角；全部冲突保持原位。嵌套房间的嵌套房间递归处理。
 */
function avoidNestedDoorZones(model: SceneModel): SceneModel {
  const rooms = model.root.levels[0]!.rooms
  const doorZones = computeDoorZones(rooms, {
    entrance: model.root.entranceDir ?? 'south',
    entranceRoomId: model.root.entranceRoomId,
  })
  const fixRoom = (room: RoomNode): RoomNode => {
    // 先修自身嵌套房间的内部（递归），再修本房间的嵌套房间
    const nested = room.nestedRooms.map(fixRoom)
    const rects = (doorZones.get(room.id) ?? []).map((z) => doorZoneRect(room, z))
    if (rects.length === 0) return { ...room, nestedRooms: nested }
    const pb = footprintBounds(room.footprint)
    const pc = footprintCenter(room.footprint)
    const fixed = nested.map((n) => {
      const nb = footprintBounds(n.footprint)
      const halfX = Math.max(0, (pb.maxX - pb.minX - (nb.maxX - nb.minX)) / 2 - WALL_THICKNESS)
      const halfZ = Math.max(0, (pb.maxZ - pb.minZ - (nb.maxZ - nb.minZ)) / 2 - WALL_THICKNESS)
      const hw = (nb.maxX - nb.minX) / 2
      const hd = (nb.maxZ - nb.minZ) / 2
      const overlap = (cx: number, cz: number): boolean =>
        rects.some((r) => halfRectOverlaps(cx, cz, hw, hd, r))
      const cur = footprintCenter(n.footprint)
      if (!overlap(cur.x, cur.z)) return n
      for (const corner of NEST_CORNER_ORDER) {
        const cx = pc.x + corner.x * halfX
        const cz = pc.z + corner.z * halfZ
        if (!overlap(cx, cz)) {
          return translateRoom(n, cx - cur.x, cz - cur.z)
        }
      }
      return n // 全部角都压门区（如门区过大）：保持原位
    })
    return { ...room, nestedRooms: fixed }
  }
  return {
    ...model,
    root: {
      ...model.root,
      levels: model.root.levels.map((level) => ({ ...level, rooms: level.rooms.map(fixRoom) })),
    },
  }
}

/** 布局完成的调试日志（resolveLayout 两个分支共用） */
function withLayoutLog(model: SceneModel): SceneModel {
  const rooms = model.root.levels[0]!.rooms
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

/** 平移房间（足迹 + 家具 + 嵌套房间，保持相对关系）同源实现见 geometry.translateRoom */

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
    if (s) totals[s] += ordered[i]!.dimensions.length
  })
  sideOf.forEach((s, i) => {
    if (s) return
    const side = totals.left <= totals.right ? 'left' : 'right'
    sideOf[i] = side
    totals[side] += ordered[i]!.dimensions.length
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
  // custom 模式：position/footprint 显式定位；否则若给了 relativeTo 就贴到
  // 前文已列出的房间的 dir 侧（无缝共墙，与 addRoom 的 relativeTo 同语义；
  // roomId 可用 id 或名称——LLM 常不给 id 直接用房间名）。都没有才落原点。
  const built: RoomNode[] = []
  for (const r of house.children) {
    let cx: number
    let cz: number
    if (r.position) {
      cx = r.position.x
      cz = r.position.z
    } else if (r.footprint) {
      const b = footprintBounds(r.footprint)
      cx = (b.minX + b.maxX) / 2
      cz = (b.minZ + b.maxZ) / 2
    } else if (r.relativeTo) {
      const target = findRoomInList(built, r.relativeTo!.roomId)
      if (target) {
        const tb = footprintBounds(target.footprint)
        const c = footprintCenter(target.footprint)
        const halfL = r.dimensions.length / 2
        const halfW = r.dimensions.width / 2
        switch (r.relativeTo.dir) {
          case 'north':
            cx = c.x
            cz = tb.maxZ + halfW
            break
          case 'south':
            cx = c.x
            cz = tb.minZ - halfW
            break
          case 'east':
            cx = tb.maxX + halfL
            cz = c.z
            break
          default:
            cx = tb.minX - halfL
            cz = c.z
        }
      } else {
        // 目标房间不在前文（或名称不匹配）：退回原点，避免布局失败
        cx = 0
        cz = 0
      }
    } else {
      cx = 0
      cz = 0
    }
    built.push(makeRoom(r, cx, cz, r.footprint))
  }
  return finalizeHouse(house, built)
}
