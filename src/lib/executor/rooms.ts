import { ROOM_SPACING } from '../constants'
import { footprintBounds, footprintCenter, houseLevelsBounds } from '../footprint'
import { doorZoneRect } from '../furniturePlacement'
import { NEST_CORNER as GEOMETRY_NEST_CORNER, rectsOverlap, translateRoom } from '../geometry'
import { createId } from '../id'
import { makeRoom, resolveLayout } from '../layout'
import {
  findNodeById,
  removeNode,
  updateNodeFields,
  updateNodeFootprint,
  updateNodePosition,
} from '../modelTree'
import { mergeRoomsLayout, sharedWallEdgeDir, splitRoomLayout } from '../planEdit'
import {
  DOOR_WIDTH,
  WALL_THICKNESS,
  computeDoorZones,
  isCorridorName,
  sharedWallOwner,
} from '../roomGeometry'
import {
  DEFAULT_FURNITURE_DIMS,
  DEFAULT_ROOM_DIMS,
  edgeDirIndex,
  findRoom,
  isDescendantOf,
  liftToTopLevel,
  mapRoom,
  replaceRoom,
} from './shared'
import type { Dir, Op, RoomSpec } from '../../types/ops'
import type {
  FurnitureNodeV2,
  HouseNode,
  HouseNodeV2,
  RoomNode,
  RoomNodeV2,
  SceneModel,
} from '../../types/model'

// ---------------------------------------------------------------------------
// 整屋
// ---------------------------------------------------------------------------

export function applySetHouse(scene: SceneModel, op: Extract<Op, { op: 'setHouse' }>): SceneModel {
  if (
    op.name === undefined &&
    op.style === undefined &&
    op.entranceRoomId === undefined &&
    op.entranceDir === undefined
  )
    throw new Error('未提供任何修改（name/style/entranceRoomId/entranceDir 均缺省）')
  const next: HouseNode = { ...scene.root }
  if (op.name !== undefined) next.name = op.name
  if (op.style !== undefined) next.style = op.style
  if (op.entranceRoomId !== undefined) {
    // 入户门位置 = 入口房间（entranceRoomId）的入口方向外墙；目标房间必须存在。
    // findRoom 支持按名称回退（LLM 常不给 id），落库时存解析后的真实 id
    const room = findRoom(scene, op.entranceRoomId)
    if (!room) {
      throw new Error(`入口房间「${op.entranceRoomId}」不存在`)
    }
    next.entranceRoomId = room.id
  }
  if (op.entranceDir !== undefined) {
    next.entranceDir = op.entranceDir
  }
  return { ...scene, root: next }
}

// ---------------------------------------------------------------------------
// macro：整屋重建（复用旧布局引擎）
// ---------------------------------------------------------------------------

export function applyMacro(scene: SceneModel, op: Extract<Op, { op: 'macro' }>): SceneModel {
  const params = op.params ?? { rooms: [] }
  const rooms = params.rooms ?? []
  const houseV2: HouseNodeV2 = {
    id: scene.root.id, // 保持整屋 id 不变，多轮稳定性
    type: 'house',
    name: params.name ?? scene.root.name,
    dimensions: { length: 12, width: 8, height: 2.8 }, // 引擎重推，仅为结构占位
    position: { x: 0, y: 0, z: 0 },
    layout:
      op.name === 'corridor'
        ? {
            mode: 'auto',
            template: 'corridor',
            corridor: {
              width: params.corridor?.width,
              entranceRoomId: params.corridor?.entranceRoomId,
            },
          }
        : op.name === 'living'
          ? {
              mode: 'auto',
              template: 'living',
              centerRoomId: params.centerRoomId ?? rooms[0]?.id ?? '',
            }
          : { mode: 'custom' },
    children: rooms.map((r) => specToRoomV2(r)),
  }
  // 布局引擎重建整屋：保留用户设置的入户门方向（整屋属性，不随重排重置为南）
  const laid = resolveLayout({ version: 2, root: houseV2 })
  if (scene.root.entranceDir && laid.root.entranceDir !== scene.root.entranceDir) {
    return { ...laid, root: { ...laid.root, entranceDir: scene.root.entranceDir } }
  }
  return laid
}

// ---------------------------------------------------------------------------
// 房间
// ---------------------------------------------------------------------------

/** 无 relativeTo 时的落点：已有房间 → 排到整屋东侧（避免重叠）；空屋 → 原点 */
function defaultPlacement(scene: SceneModel, spec: RoomSpec): { x: number; z: number } {
  const rooms = scene.root.levels[0].rooms
  if (rooms.length === 0) return { x: 0, z: 0 }
  const b = houseLevelsBounds(scene.root) ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  const dims = spec.footprint ? footprintBounds(spec.footprint) : null
  const halfL = dims
    ? (dims.maxX - dims.minX) / 2
    : (spec.dimensions?.length ?? DEFAULT_ROOM_DIMS.length) / 2
  return { x: b.maxX + halfL + ROOM_SPACING, z: (b.minZ + b.maxZ) / 2 }
}

/** 贴到指定房间的 dir 一侧（无缝共墙：间隔 0，共享墙去重由墙体方案负责） */
function adjacentCenter(
  parent: RoomNode,
  dir: Dir,
  halfL: number,
  halfW: number,
): { x: number; z: number } {
  const b = footprintBounds(parent.footprint)
  const c = footprintCenter(parent.footprint)
  switch (dir) {
    case 'north':
      return { x: c.x, z: b.maxZ + halfW }
    case 'south':
      return { x: c.x, z: b.minZ - halfW }
    case 'east':
      return { x: b.maxX + halfL, z: c.z }
    case 'west':
      return { x: b.minX - halfL, z: c.z }
  }
}

/**
 * 贴靠落点修正（坑 46）：垂直于贴靠方向的轴，把被移动房间靠走廊一侧的边对齐到
 * 目标房间的同侧边线——走廊型布局中所有房间南边（北侧房）都压在走廊边线上，
 * 旧逻辑对齐到目标中心，房间宽度与目标不一致时会与走廊错位出缝隙（ADJACENCY_GAP
 * 容差内仍判相邻 → 有门但地板悬空）。目标就是走廊自身时不修正（语义模糊）。
 */
function alignAdjacentPlacement(
  scene: SceneModel,
  dir: Dir,
  target: RoomNode,
  roomBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  x: number,
  z: number,
): { x: number; z: number } {
  const corridor = scene.root.levels[0].rooms.find((r) => isCorridorName(r.name))
  if (!corridor || corridor.id === target.id) return { x, z }
  if (dir !== 'east' && dir !== 'west') return { x, z }
  const cc = footprintCenter(corridor.footprint)
  const tc = footprintCenter(target.footprint)
  // 目标相对走廊在哪一侧，就把被移动房间的同侧边对齐到目标的该侧边线
  const northOfCorridor = tc.z > cc.z
  const tb = footprintBounds(target.footprint)
  const line = northOfCorridor ? tb.minZ : tb.maxZ
  const halfW = (roomBounds.maxZ - roomBounds.minZ) / 2
  return { x, z: line + (northOfCorridor ? halfW : -halfW) }
}

export function applyAddRoom(scene: SceneModel, op: Extract<Op, { op: 'addRoom' }>): SceneModel {
  if (op.id && findNodeById(scene.root, op.id)) throw new Error(`id「${op.id}」已存在`)
  const spec: RoomSpec = {
    id: op.id,
    name: op.name,
    dimensions: op.dimensions,
    side: op.side,
    footprint: op.footprint,
    position: op.position,
    furniture: op.furniture,
    nestedRooms: op.nestedRooms,
  }
  // 落点优先级：显式 footprint（世界坐标顶点环，placement 仅作锚点推导）>
  // position（绝对位置，与 macro custom 房间规格同语义）> relativeTo 贴靠 > 东侧兜底
  const placement = spec.footprint
    ? { x: 0, z: 0 }
    : op.position
      ? { x: op.position.x, z: op.position.z }
      : op.relativeTo
        ? (() => {
            const parent = findRoom(scene, op.relativeTo.roomId)
            if (!parent) throw new Error(`relativeTo 房间「${op.relativeTo.roomId}」不存在`)
            const halfL = (op.dimensions?.length ?? DEFAULT_ROOM_DIMS.length) / 2
            const halfW = (op.dimensions?.width ?? DEFAULT_ROOM_DIMS.width) / 2
            // 与 moveRoom 同款：走廊边线对齐 + 与其他房间重叠时选空侧（坑 46/48）
            return pickFreePlacement(
              scene,
              '',
              parent,
              op.relativeTo.dir,
              { minX: -halfL, maxX: halfL, minZ: -halfW, maxZ: halfW },
              halfL,
              halfW,
            )
          })()
        : defaultPlacement(scene, spec)
  const room = makeRoom(specToRoomV2(spec), placement.x, placement.z, spec.footprint)
  const level = scene.root.levels[0]
  return {
    ...scene,
    root: { ...scene.root, levels: [{ ...level, rooms: [...level.rooms, room] }] },
  }
}

export function applyUpdateRoom(
  scene: SceneModel,
  op: Extract<Op, { op: 'updateRoom' }>,
): SceneModel {
  const room = findRoom(scene, op.id)
  if (!room) throw new Error(`房间「${op.id}」不存在`)
  // 先解析为真实 id（findRoom 支持按名称引用），后续 id-only 变更函数才能命中（坑 71）
  const roomId = room.id
  const { name, dimensions, footprint } = op.patch
  // side 为布置意图（仅 macro 平铺时生效）；对已平铺房间无几何意义，接受但忽略（坑 22 边界）
  let next: SceneModel = scene
  if (name !== undefined || dimensions !== undefined) {
    next = {
      ...next,
      root: updateNodeFields(next.root, roomId, { name, dimensions }) as SceneModel['root'],
    }
  }
  if (footprint) {
    next = {
      ...next,
      root: updateNodeFootprint(next.root, roomId, footprint) as SceneModel['root'],
    }
  }
  if (next === scene) throw new Error('补丁为空（无 name/dimensions/footprint）')
  return next
}

export function applyRemoveRoom(
  scene: SceneModel,
  op: Extract<Op, { op: 'removeRoom' }>,
): SceneModel {
  const room = findRoom(scene, op.id)
  if (!room) throw new Error(`房间「${op.id}」不存在`)
  const roomId = room.id
  let root = removeNode(scene.root, roomId) as SceneModel['root']
  // 删除的是入户房间时清空 entranceRoomId，避免大门悬空
  if (root.entranceRoomId === roomId) {
    root = { ...root, entranceRoomId: undefined }
  }
  return { ...scene, root }
}

export function applyMoveRoom(scene: SceneModel, op: Extract<Op, { op: 'moveRoom' }>): SceneModel {
  return moveAdjacent(scene, op.id, op.relativeTo, 'moveRoom')
}

/** 内嵌落点符号（与布局引擎 placeNested 的角落规则一致：side → 父房间对应角，默认东北角） */
const NEST_CORNER = GEOMETRY_NEST_CORNER

/**
 * nestRoom：把已有房间（顶层或已嵌套）移动到另一个房间内部成为嵌套子房间。
 * - 落点与布局引擎 placeNested 一致：父房间对应角（去墙厚余量），side 可指定；
 *   默认候选顺序 = 请求的 side 优先，其余按 东北/西北/东南/西南 依次尝试——
 *   **跳过与父房间门口禁区（doorZoneRect，含入户门）重叠的角**，避免嵌套房间
 *   压住房间的门（坑 47：门洞被嵌进房间挡死/门后无墙）；全部冲突时回退到请求的角。
 * - 家具与嵌套子房间随房间整体平移（保持相对关系）；
 * - 环检测：父房间不能是待移动房间的后代；
 * - 结束统一 normalizeContainment 会把房间约束进父房间内部（过大时居中兜底），
 *   并把父房间家具推出嵌套占地。
 */
export function applyNestRoom(scene: SceneModel, op: Extract<Op, { op: 'nestRoom' }>): SceneModel {
  if (op.id === op.into) throw new Error(`不能把房间「${op.id}」嵌套进自身`)
  const room = findRoom(scene, op.id)
  if (!room) throw new Error(`房间「${op.id}」不存在`)
  const parent = findRoom(scene, op.into)
  if (!parent) throw new Error(`父房间「${op.into}」不存在`)
  if (isDescendantOf(room, parent.id)) {
    throw new Error(`父房间「${op.into}」是「${op.id}」的嵌套子房间，嵌套会成环`)
  }
  // 从原父容器移除（顶层或已嵌套），再挂到父房间 nestedRooms（按真实 id，名称引用已解析，坑 71）
  const removed = { ...scene, root: removeNode(scene.root, room.id) as SceneModel['root'] }
  const rb = footprintBounds(room.footprint)
  const pb = footprintBounds(parent.footprint)
  const halfX = Math.max(0, (pb.maxX - pb.minX - (rb.maxX - rb.minX)) / 2 - WALL_THICKNESS)
  const halfZ = Math.max(0, (pb.maxZ - pb.minZ - (rb.maxZ - rb.minZ)) / 2 - WALL_THICKNESS)
  // 父房间门口禁区（与渲染同源）：嵌套落点不得压住门
  const doorZoneRects = (
    computeDoorZones(removed.root.levels[0].rooms, {
      entrance: removed.root.entranceDir ?? 'south',
      entranceRoomId: removed.root.entranceRoomId,
    }).get(parent.id) ?? []
  ).map((z) => doorZoneRect(parent, z))
  const pc = footprintCenter(parent.footprint)
  const c = footprintCenter(room.footprint)
  // 候选角顺序：请求的 side 优先，其余 东北/西北/东南/西南 确定性尝试
  const requested = op.side ?? 'default'
  const order: Array<Dir | 'default'> = [
    requested,
    ...(['default', 'north', 'south', 'east', 'west'] as Array<Dir | 'default'>).filter(
      (s) => s !== requested,
    ),
  ]
  const cornerFor = (s: Dir | 'default'): { x: number; z: number } => NEST_CORNER[s]
  let corner = cornerFor(requested)
  for (const s of order) {
    const cand = cornerFor(s)
    const bb = {
      minX: pc.x + cand.x * halfX - (rb.maxX - rb.minX) / 2,
      maxX: pc.x + cand.x * halfX + (rb.maxX - rb.minX) / 2,
      minZ: pc.z + cand.z * halfZ - (rb.maxZ - rb.minZ) / 2,
      maxZ: pc.z + cand.z * halfZ + (rb.maxZ - rb.minZ) / 2,
    }
    const conflicts = doorZoneRects.some((z) => rectsOverlap(bb, z))
    if (!conflicts) {
      corner = cand
      break
    }
  }
  const moved = translateRoom(room, pc.x + corner.x * halfX - c.x, pc.z + corner.z * halfZ - c.z)
  return mapRoom(removed, parent.id, (p) => ({ ...p, nestedRooms: [...p.nestedRooms, moved] }))
}

export function applyAddAdjacency(
  scene: SceneModel,
  op: Extract<Op, { op: 'addAdjacency' }>,
): SceneModel {
  return moveAdjacent(scene, op.neighborId, { roomId: op.roomId, dir: op.side }, 'addAdjacency')
}

// ---------------------------------------------------------------------------
// P4 拆房 / 合并（平面图编辑产出，LLM 也可用）
// ---------------------------------------------------------------------------

/**
 * splitRoom：把矩形房间沿轴线（axis 'x' 竖切 / 'z' 横切）在 position（世界坐标）处切成两间。
 * 原房间保留 id 与西/南部分，新房间排到东/北侧（name 可选，默认「原名2」）；
 * 家具/嵌套房间按中心归属两半；显式开洞按边重映射（跨切线丢弃）；
 * 共墙自动开一扇门——门加在共享墙的**渲染侧**（sharedWallOwner，与墙体方案同源），
 * 避免门开在非渲染侧变成静默空操作（坑 43 同源）。非矩形房间/切线太靠边抛错跳过。
 */
export function applySplitRoom(
  scene: SceneModel,
  op: Extract<Op, { op: 'splitRoom' }>,
): SceneModel {
  const room = findRoom(scene, op.id)
  if (!room) throw new Error(`房间「${op.id}」不存在`)
  const newId = createId()
  const newName = op.name ?? `${room.name}2`
  const split = splitRoomLayout(room, op.axis, op.position, newId, newName)
  if (!split) {
    throw new Error('只有矩形房间可以拆分，且切线两侧需各 ≥ 1m')
  }
  // 共墙自动开一扇门：加在渲染共享墙的一侧（坑 43：非渲染侧开洞是静默空操作）
  const ownerIsA = sharedWallOwner(split.a, split.b)
  const owner = ownerIsA ? split.a : split.b
  const dir = sharedWallEdgeDir(op.axis, ownerIsA)
  const oBounds = footprintBounds(owner.footprint)
  // 共享墙边长 = 垂直于切线方向的房间跨度
  const edgeLen = op.axis === 'x' ? oBounds.maxZ - oBounds.minZ : oBounds.maxX - oBounds.minX
  const w = Math.min(DOOR_WIDTH, Math.max(0.3, edgeLen - 2 * WALL_THICKNESS))
  const from = (edgeLen - w) / 2
  const opening = {
    edgeIndex: edgeDirIndex(owner.footprint, dir),
    from,
    to: from + w,
    width: w,
  }
  const withDoor: RoomNode = { ...owner, doors: [...owner.doors, opening] }
  const parts = ownerIsA ? [withDoor, split.b] : [split.a, withDoor]
  // replaceRoom 按 id 精确匹配：先解析为真实 id（findRoom 支持按名称引用，坑 71）
  return replaceRoom(scene, room.id, parts)
}

/**
 * mergeRoom：合并两个并集为矩形的相邻房间（keep 保留 id/名称，remove 并入）。
 * 家具/嵌套房间保持世界坐标；显式开洞重映射（共墙上的开洞丢弃）；
 * remove 是入户房间时入口迁移到 keep。非矩形/并集非矩形抛错跳过。
 */
export function applyMergeRoom(
  scene: SceneModel,
  op: Extract<Op, { op: 'mergeRoom' }>,
): SceneModel {
  if (op.keep === op.remove) throw new Error('keep 与 remove 不能是同一个房间')
  // keep/remove 均先解析为真实 id（findRoom 支持按名称引用），后续 id-only 变更函数才能命中（坑 71）
  let keep = findRoom(scene, op.keep)
  let remove = findRoom(scene, op.remove)
  if (!keep) throw new Error(`房间「${op.keep}」不存在`)
  if (!remove) throw new Error(`房间「${op.remove}」不存在`)
  let keepId = keep.id
  let removeId = remove.id
  // keep 嵌套在 remove 内：removeNode(remove) 会连 keep 一起删掉，先交换角色
  if (isDescendantOf(remove, keep.id)) {
    const tmp = keep
    keep = remove
    remove = tmp
    const tmpId = keepId
    keepId = removeId
    removeId = tmpId
  }
  const merged = mergeRoomsLayout(keep, remove)
  if (!merged) throw new Error('两个房间并集不是合法矩形，无法合并（需矩形且共享完整共墙）')
  // 先删 remove（含其嵌套），再原地替换 keep 为合并结果
  let root = removeNode(scene.root, removeId) as SceneModel['root']
  if (root.entranceRoomId === removeId) {
    root = { ...root, entranceRoomId: keepId }
  }
  const replaced = {
    ...scene,
    root,
  }
  return replaceRoom(replaced, keepId, [merged])
}

/** 把 id 房间移到 relativeTo 房间的 dir 侧相邻（moveRoom / addAdjacency 共用）。
 *  嵌套房间（如主卧卫生间）会被提升到顶层再贴靠——"移出来/取消内嵌"语义（坑 48）。 */
function moveAdjacent(
  scene: SceneModel,
  id: string,
  relativeTo: { roomId: string; dir: Dir } | undefined,
  opName: string,
): SceneModel {
  if (!relativeTo) throw new Error(`${opName} 缺少 relativeTo（必须指定贴靠哪个房间）`)
  const room = findRoom(scene, id)
  if (!room) throw new Error(`房间「${id}」不存在`)
  const target = findRoom(scene, relativeTo.roomId)
  if (!target) throw new Error(`relativeTo 房间「${relativeTo.roomId}」不存在`)
  // 名称引用下字符串可能不相等：按解析后的真实 id 判自引用（坑 71）
  if (target.id === room.id) throw new Error('relativeTo 不能指向自身')
  const b = footprintBounds(room.footprint)
  const halfL = (b.maxX - b.minX) / 2
  const halfW = (b.maxZ - b.minZ) / 2
  // 嵌套房间 → 提升到顶层（保持世界坐标，追加到顶层末尾），再贴靠
  const lifted = scene.root.levels[0].rooms.some((r) => r.id === room.id)
    ? scene
    : {
        ...scene,
        root: liftToTopLevel(scene.root, room),
      }
  const picked = pickFreePlacement(lifted, room.id, target, relativeTo.dir, b, halfL, halfW)
  return {
    ...lifted,
    root: updateNodePosition(lifted.root, room.id, {
      x: picked.x,
      y: room.height / 2,
      z: picked.z,
    }) as SceneModel['root'],
  }
}

/** 贴靠落点选择（坑 48）：请求方向优先；与其他顶层房间（除自身）重叠时按 北/南/东/西
 *  依次尝试第一个空位（避免贴到走廊或别的房间上造成重叠）；全部冲突回退请求方向。 */
function pickFreePlacement(
  scene: SceneModel,
  id: string,
  target: RoomNode,
  requestedDir: Dir,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  halfL: number,
  halfW: number,
): { x: number; z: number } {
  const dirs: Dir[] = [requestedDir, 'north', 'south', 'east', 'west']
  const seen = new Set<Dir>()
  for (const d of dirs) {
    if (seen.has(d)) continue
    seen.add(d)
    const base = adjacentCenter(target, d, halfL, halfW)
    const aligned = alignAdjacentPlacement(scene, d, target, b, base.x, base.z)
    const bb = {
      minX: aligned.x - halfL,
      maxX: aligned.x + halfL,
      minZ: aligned.z - halfW,
      maxZ: aligned.z + halfW,
    }
    const conflicts = scene.root.levels[0].rooms.some((r) => {
      if (r.id === id) return false
      return rectsOverlap(bb, footprintBounds(r.footprint))
    })
    if (!conflicts) return aligned
  }
  const base = adjacentCenter(target, requestedDir, halfL, halfW)
  return alignAdjacentPlacement(scene, requestedDir, target, b, base.x, base.z)
}

// ---------------------------------------------------------------------------
// RoomSpec → RoomNodeV2（macro / addRoom 共用）
// ---------------------------------------------------------------------------

function specToRoomV2(spec: RoomSpec): RoomNodeV2 {
  const furniture: FurnitureNodeV2[] = (spec.furniture ?? []).map((f): FurnitureNodeV2 => {
    const dims = f.dimensions ?? DEFAULT_FURNITURE_DIMS
    return {
      id: f.id ?? createId(),
      type: 'furniture',
      name: f.name,
      dimensions: dims,
      position: f.position ?? { x: 0, y: dims.height / 2, z: 0 },
      rotationY: f.rotationY,
      description: f.description,
    }
  })
  return {
    id: spec.id ?? createId(),
    type: 'room',
    name: spec.name,
    dimensions: {
      length: spec.dimensions?.length ?? DEFAULT_ROOM_DIMS.length,
      width: spec.dimensions?.width ?? DEFAULT_ROOM_DIMS.width,
      height: spec.dimensions?.height ?? DEFAULT_ROOM_DIMS.height,
    },
    position: spec.position,
    side: spec.side,
    relativeTo: spec.relativeTo,
    // 显式足迹透传（custom 模式由 resolveCustom 使用，L 形/U 形直接表达）
    footprint: spec.footprint,
    children: [...furniture, ...(spec.nestedRooms ?? []).map(specToRoomV2)],
  }
}
