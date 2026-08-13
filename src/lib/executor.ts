import { footprintBounds, footprintCenter, houseLevelsBounds } from './footprint'
import { applyFurnitureConventions, doorZoneRect } from './furniturePlacement'
import { createId } from './id'
import { makeRoom, resolveLayout } from './layout'
import {
  findNodeById,
  normalizeContainment,
  removeNode,
  translateRoomContents,
  updateNodeFields,
  updateNodeFootprint,
  updateNodePosition,
} from './modelTree'
import { mergeRoomsLayout, splitRoomLayout, sharedWallEdgeDir } from './planEdit'
import {
  isCorridorName,
  sharedWallOwner,
  WALL_THICKNESS,
  DOOR_WIDTH,
  computeDoorZones,
} from './roomGeometry'
import type { Dir, Op, RoomSpec } from '../types/ops'
import type {
  Dimensions,
  FurnitureNode,
  FurnitureNodeV2,
  HouseNode,
  HouseNodeV2,
  LevelNode,
  Point2D,
  Position,
  RoomNode,
  RoomNodeV2,
  SceneModel,
  SceneModelV2,
} from '../types/model'

/**
 * v3 确定性执行器（design.md §4.2）：把 LLM 输出的操作序列逐条应用到 v3 场景模型。
 * - 逐条独立 try/catch：任何一条失败只跳过该条并记录原因，绝不整屋回滚；
 * - 执行顺序 = 数组顺序（确定性，禁止依赖对象键序）；
 * - macro 直接映射旧布局引擎 resolveLayout（老引擎零浪费）；
 * - 全部执行完后统一过 normalizeContainment（+ 生成时家具常理兜底）。
 */

export const DEFAULT_ROOM_DIMS: Dimensions = { length: 3, width: 3, height: 2.8 }
export const DEFAULT_FURNITURE_DIMS: Dimensions = { length: 1, width: 0.5, height: 0.5 }
export const DEFAULT_WINDOW_WIDTH = 1.5

/** 空场景（尚无整屋时的起点，供生成链路使用） */
export function emptyScene(name = '未命名房屋'): SceneModel {
  return {
    version: 3,
    root: {
      id: 'house1',
      type: 'house',
      name,
      levels: [{ id: 'level-house1', height: 2.8, rooms: [] }],
    },
  }
}

export interface ExecuteResult {
  scene: SceneModel
  applied: number
  skipped: string[]
}

/** 执行一批操作：逐条容错，结束统一约束；返回最终场景与失败明细 */
export function executeOps(
  scene: SceneModel,
  ops: Op[],
  options?: { furnitureConventions?: boolean },
): ExecuteResult {
  let current = scene
  const skipped: string[] = []
  let applied = 0
  for (const op of ops) {
    try {
      current = applyOp(current, op)
      applied++
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      skipped.push(`第 ${applied + skipped.length + 1} 条 ${op.op}: ${detail}`)
    }
  }
  let result = normalizeContainment(current)
  // 生成时常理兜底（auto 模板批次）：贴墙摆放 + 避让禁区（resolveLayout 对 macro auto 已跑，此处幂等）
  if (options?.furnitureConventions) {
    result = applyFurnitureConventions(result)
    result = normalizeContainment(result)
  }
  result = refreshLevelHeight(result)
  return { scene: result, applied, skipped }
}

/** 执行单条操作；失败抛错（由 executeOps 捕获跳过），成功返回新场景 */
export function applyOp(scene: SceneModel, op: Op): SceneModel {
  switch (op.op) {
    case 'setHouse':
      return applySetHouse(scene, op)
    case 'macro':
      return applyMacro(scene, op)
    case 'addRoom':
      return applyAddRoom(scene, op)
    case 'updateRoom':
      return applyUpdateRoom(scene, op)
    case 'removeRoom':
      return applyRemoveRoom(scene, op)
    case 'moveRoom':
      return applyMoveRoom(scene, op)
    case 'nestRoom':
      return applyNestRoom(scene, op)
    case 'splitRoom':
      return applySplitRoom(scene, op)
    case 'mergeRoom':
      return applyMergeRoom(scene, op)
    case 'addFurniture':
      return applyAddFurniture(scene, op)
    case 'updateFurniture':
      return applyUpdateFurniture(scene, op)
    case 'removeFurniture':
      return applyRemoveFurniture(scene, op)
    case 'setOpenings':
      return applySetOpenings(scene, op)
    case 'addAdjacency':
      return applyAddAdjacency(scene, op)
  }
}

// ---------------------------------------------------------------------------
// 整屋
// ---------------------------------------------------------------------------

function applySetHouse(scene: SceneModel, op: Extract<Op, { op: 'setHouse' }>): SceneModel {
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

function applyMacro(scene: SceneModel, op: Extract<Op, { op: 'macro' }>): SceneModel {
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
  return { x: b.maxX + halfL + 0.3, z: (b.minZ + b.maxZ) / 2 }
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

function applyAddRoom(scene: SceneModel, op: Extract<Op, { op: 'addRoom' }>): SceneModel {
  if (op.id && findNodeById(scene.root, op.id)) throw new Error(`id「${op.id}」已存在`)
  const spec: RoomSpec = {
    id: op.id,
    name: op.name,
    dimensions: op.dimensions,
    side: op.side,
    footprint: op.footprint,
    furniture: op.furniture,
    nestedRooms: op.nestedRooms,
  }
  // 显式 footprint 时以顶点环为准（世界坐标），placement 仅影响家具锚点推导
  const placement = spec.footprint
    ? { x: 0, z: 0 }
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

function applyUpdateRoom(scene: SceneModel, op: Extract<Op, { op: 'updateRoom' }>): SceneModel {
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

function applyRemoveRoom(scene: SceneModel, op: Extract<Op, { op: 'removeRoom' }>): SceneModel {
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

function applyMoveRoom(scene: SceneModel, op: Extract<Op, { op: 'moveRoom' }>): SceneModel {
  return moveAdjacent(scene, op.id, op.relativeTo, 'moveRoom')
}

/** 内嵌落点符号（与布局引擎 placeNested 的角落规则一致：side → 父房间对应角，默认东北角） */
const NEST_CORNER: Record<Dir | 'default', { x: number; z: number }> = {
  north: { x: -1, z: 1 },
  south: { x: 1, z: -1 },
  east: { x: 1, z: 1 },
  west: { x: -1, z: -1 },
  default: { x: 1, z: 1 },
}

/** id 是否为 room 的嵌套后代（环检测用） */
function isDescendantOf(room: RoomNode, id: string): boolean {
  return room.nestedRooms.some((n) => n.id === id || isDescendantOf(n, id))
}

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
function applyNestRoom(scene: SceneModel, op: Extract<Op, { op: 'nestRoom' }>): SceneModel {
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
    const conflicts = doorZoneRects.some(
      (z) =>
        bb.minX < z.maxX - 1e-6 &&
        bb.maxX > z.minX + 1e-6 &&
        bb.minZ < z.maxZ - 1e-6 &&
        bb.maxZ > z.minZ + 1e-6,
    )
    if (!conflicts) {
      corner = cand
      break
    }
  }
  const moved = translateRoomContents(
    room,
    pc.x + corner.x * halfX - c.x,
    pc.z + corner.z * halfZ - c.z,
  )
  return mapRoom(removed, parent.id, (p) => ({ ...p, nestedRooms: [...p.nestedRooms, moved] }))
}

function applyAddAdjacency(scene: SceneModel, op: Extract<Op, { op: 'addAdjacency' }>): SceneModel {
  return moveAdjacent(scene, op.neighborId, { roomId: op.roomId, dir: op.side }, 'addAdjacency')
}

// ---------------------------------------------------------------------------
// P4 拆房 / 合并（平面图编辑产出，LLM 也可用）
// ---------------------------------------------------------------------------

/** 把房间替换为其所在容器内的若干新房间（顶层/嵌套均可，不可变更新） */
function replaceRoom(scene: SceneModel, id: string, rooms: RoomNode[]): SceneModel {
  const replaceList = (list: RoomNode[]): RoomNode[] => {
    const out: RoomNode[] = []
    for (const r of list) {
      if (r.id === id) {
        out.push(...rooms)
        continue
      }
      const nested = replaceList(r.nestedRooms)
      out.push({ ...r, nestedRooms: nested })
    }
    return out
  }
  const level = scene.root.levels[0]
  return {
    ...scene,
    root: { ...scene.root, levels: [{ ...level, rooms: replaceList(level.rooms) }] },
  }
}

/**
 * splitRoom：把矩形房间沿轴线（axis 'x' 竖切 / 'z' 横切）在 position（世界坐标）处切成两间。
 * 原房间保留 id 与西/南部分，新房间排到东/北侧（name 可选，默认「原名2」）；
 * 家具/嵌套房间按中心归属两半；显式开洞按边重映射（跨切线丢弃）；
 * 共墙自动开一扇门——门加在共享墙的**渲染侧**（sharedWallOwner，与墙体方案同源），
 * 避免门开在非渲染侧变成静默空操作（坑 43 同源）。非矩形房间/切线太靠边抛错跳过。
 */
function applySplitRoom(scene: SceneModel, op: Extract<Op, { op: 'splitRoom' }>): SceneModel {
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

/** 按方向找矩形足迹边下标（坑 39 约定：0=南 1=东 2=北 3=西；按几何方向解析） */
function edgeDirIndex(fp: Point2D[], dir: 'north' | 'south' | 'east' | 'west'): number {
  const n = fp.length
  const c = footprintCenter(fp)
  for (let i = 0; i < n; i++) {
    const a = fp[i]
    const b = fp[(i + 1) % n]
    const EPS = 1e-6
    if (Math.abs(a.z - b.z) < EPS) {
      if (dir === 'north' && a.z > c.z + EPS) return i
      if (dir === 'south' && a.z < c.z - EPS) return i
    } else {
      if (dir === 'east' && a.x > c.x + EPS) return i
      if (dir === 'west' && a.x < c.x - EPS) return i
    }
  }
  throw new Error(`足迹没有 ${dir} 向边`)
}

/**
 * mergeRoom：合并两个并集为矩形的相邻房间（keep 保留 id/名称，remove 并入）。
 * 家具/嵌套房间保持世界坐标；显式开洞重映射（共墙上的开洞丢弃）；
 * remove 是入户房间时入口迁移到 keep。非矩形/并集非矩形抛错跳过。
 */
function applyMergeRoom(scene: SceneModel, op: Extract<Op, { op: 'mergeRoom' }>): SceneModel {
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

/** 把嵌套房间提升到顶层（世界坐标不变，追加到顶层末尾） */
function liftToTopLevel(root: SceneModel['root'], room: RoomNode): SceneModel['root'] {
  const removed = removeNode(root, room.id) as SceneModel['root']
  return {
    ...removed,
    levels: removed.levels.map((l, i) => (i === 0 ? { ...l, rooms: [...l.rooms, room] } : l)),
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
      const rb = footprintBounds(r.footprint)
      return (
        bb.minX < rb.maxX - 1e-6 &&
        bb.maxX > rb.minX + 1e-6 &&
        bb.minZ < rb.maxZ - 1e-6 &&
        bb.maxZ > rb.minZ + 1e-6
      )
    })
    if (!conflicts) return aligned
  }
  const base = adjacentCenter(target, requestedDir, halfL, halfW)
  return alignAdjacentPlacement(scene, requestedDir, target, b, base.x, base.z)
}

// ---------------------------------------------------------------------------
// 家具
// ---------------------------------------------------------------------------

function applyAddFurniture(scene: SceneModel, op: Extract<Op, { op: 'addFurniture' }>): SceneModel {
  const room = findRoom(scene, op.roomId)
  if (!room) throw new Error(`房间「${op.roomId}」不存在`)
  if (op.id && findNodeById(scene.root, op.id)) throw new Error(`id「${op.id}」已存在`)
  const c = footprintCenter(room.footprint)
  const dims = op.dimensions ?? DEFAULT_FURNITURE_DIMS
  const item: FurnitureNode = {
    id: op.id ?? createId(),
    type: 'furniture',
    name: op.name,
    dimensions: dims,
    // v2 语义：x/z 相对房间中心偏移，y 为高度一半（底面贴地）
    position: {
      x: c.x + (op.position?.x ?? 0),
      y: op.position?.y ?? dims.height / 2,
      z: c.z + (op.position?.z ?? 0),
    },
    rotationY: op.rotationY,
    description: op.description,
  }
  return mapRoom(scene, op.roomId, (r) => ({ ...r, furniture: [...r.furniture, item] }))
}

function applyUpdateFurniture(
  scene: SceneModel,
  op: Extract<Op, { op: 'updateFurniture' }>,
): SceneModel {
  const room = findRoom(scene, op.roomId)
  if (!room) throw new Error(`房间「${op.roomId}」不存在`)
  const furniture = room.furniture.find((f) => f.id === op.id)
  if (!furniture) throw new Error(`家具「${op.id}」不存在`)
  const c = footprintCenter(room.footprint)
  return mapRoom(scene, op.roomId, (r) => ({
    ...r,
    furniture: r.furniture.map((f) => {
      if (f.id !== op.id) return f
      const next: FurnitureNode = { ...f }
      if (op.patch.name !== undefined) next.name = op.patch.name
      if (op.patch.dimensions) next.dimensions = { ...f.dimensions, ...op.patch.dimensions }
      if (op.patch.position) {
        next.position = {
          x: op.patch.position.x !== undefined ? c.x + op.patch.position.x : f.position.x,
          y: op.patch.position.y !== undefined ? op.patch.position.y : f.position.y,
          z: op.patch.position.z !== undefined ? c.z + op.patch.position.z : f.position.z,
        }
      }
      if (op.patch.rotationY !== undefined) next.rotationY = op.patch.rotationY
      return next
    }),
  }))
}

function applyRemoveFurniture(
  scene: SceneModel,
  op: Extract<Op, { op: 'removeFurniture' }>,
): SceneModel {
  const room = findRoom(scene, op.roomId)
  if (!room) throw new Error(`房间「${op.roomId}」不存在`)
  if (!room.furniture.some((f) => f.id === op.id)) throw new Error(`家具「${op.id}」不存在`)
  return mapRoom(scene, op.roomId, (r) => ({
    ...r,
    furniture: r.furniture.filter((f) => f.id !== op.id),
  }))
}

// ---------------------------------------------------------------------------
// 开洞（门/窗）
// ---------------------------------------------------------------------------

/** 按外向方向找足迹边：返回顶点环下标 + 局部区间（段局部坐标以边起点为 0，坑 37 约定） */
function findEdgeBySide(room: RoomNode, dir: Dir): { edgeIndex: number; length: number } | null {
  const fp = room.footprint
  const center = footprintCenter(fp)
  const n = fp.length
  const EPS = 1e-6
  let best: { edgeIndex: number; length: number } | null = null
  for (let i = 0; i < n; i++) {
    const a = fp[i]
    const b = fp[(i + 1) % n]
    const horizontal = Math.abs(a.z - b.z) < EPS
    const length = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.z - a.z)
    if (length < EPS) continue
    const edgeDir: Dir = horizontal
      ? a.z > center.z + EPS
        ? 'north'
        : 'south'
      : a.x > center.x + EPS
        ? 'east'
        : 'west'
    if (edgeDir !== dir) continue
    // 同方向可能有多个边（非矩形足迹）：取最长者（确定性）
    if (!best || length > best.length) best = { edgeIndex: i, length }
  }
  return best
}

/** 按足迹边下标取边（坑 39 约定：Opening.edgeIndex 引用 footprint 顶点环边序号；退化边返回 null） */
function edgeByIndex(room: RoomNode, index: number): { edgeIndex: number; length: number } | null {
  const fp = room.footprint
  const n = fp.length
  if (n === 0) return null
  const idx = ((index % n) + n) % n
  const a = fp[idx]
  const b = fp[(idx + 1) % n]
  if (Math.abs(a.z - b.z) < 1e-6) return { edgeIndex: idx, length: Math.abs(b.x - a.x) }
  if (Math.abs(a.x - b.x) < 1e-6) return { edgeIndex: idx, length: Math.abs(b.z - a.z) }
  return null
}

function applySetOpenings(scene: SceneModel, op: Extract<Op, { op: 'setOpenings' }>): SceneModel {
  const room = findRoom(scene, op.roomId)
  if (!room) throw new Error(`房间「${op.roomId}」不存在`)
  // P4：UI 提供精确边下标（edgeIndex）；LLM 沿用 side（取该方向最长边，确定性）
  const edge =
    op.edgeIndex !== undefined ? edgeByIndex(room, op.edgeIndex) : findEdgeBySide(room, op.side)
  if (!edge) throw new Error(`房间「${op.roomId}」没有 ${op.side} 向边`)

  if (op.remove) {
    // P4 删除开洞：同边同种；from/to 给定时只删与之重叠的开洞，省略则整边清除
    return mapRoom(scene, op.roomId, (r) => {
      const key = op.kind === 'door' ? 'doors' : 'windows'
      const rest = r[key].filter((o) => {
        if (o.edgeIndex !== edge.edgeIndex) return true
        if (op.from === undefined || op.to === undefined) return false
        return o.to <= op.from + 1e-6 || o.from >= op.to - 1e-6
      })
      return { ...r, [key]: rest }
    })
  }

  const width = op.kind === 'door' ? DOOR_WIDTH : DEFAULT_WINDOW_WIDTH
  let from = op.from ?? (edge.length - width) / 2
  let to = op.to ?? (edge.length + width) / 2
  from = Math.max(0, Math.min(from, edge.length))
  to = Math.max(0, Math.min(to, edge.length))
  if (to - from < 1e-6) throw new Error('开洞区间无效（from ≥ to）')
  const opening = { edgeIndex: edge.edgeIndex, from, to, width: to - from }
  return mapRoom(scene, op.roomId, (r) => {
    const key = op.kind === 'door' ? 'doors' : 'windows'
    // 覆盖层语义：同边同种开洞替换，其他开洞保留
    const others = r[key].filter((o) => o.edgeIndex !== opening.edgeIndex)
    return { ...r, [key]: [...others, opening] }
  })
}

// ---------------------------------------------------------------------------
// 树操作辅助
// ---------------------------------------------------------------------------

/**
 * 递归查找房间（含嵌套）。ref 优先按 id 精确匹配；LLM 常不给房间 id 而直接用房间名
 * 引用（如 setOpenings 的 roomId、setHouse 的 entranceRoomId、relativeTo 的 roomId），
 * 因此 id 未命中时回退按名称匹配（遍历顺序首次命中，确定性）。
 */
export function findRoom(scene: SceneModel, ref: string): RoomNode | null {
  const byId = (() => {
    const dfs = (room: RoomNode): RoomNode | null => {
      if (room.id === ref) return room
      for (const nested of room.nestedRooms) {
        const found = dfs(nested)
        if (found) return found
      }
      return null
    }
    for (const room of scene.root.levels[0].rooms) {
      const found = dfs(room)
      if (found) return found
    }
    return null
  })()
  if (byId) return byId
  const byName = (() => {
    const dfs = (room: RoomNode): RoomNode | null => {
      if (room.name === ref) return room
      for (const nested of room.nestedRooms) {
        const found = dfs(nested)
        if (found) return found
      }
      return null
    }
    for (const room of scene.root.levels[0].rooms) {
      const found = dfs(room)
      if (found) return found
    }
    return null
  })()
  return byName
}

/** 不可变更新指定房间（含嵌套），fn 返回新房间 */
function mapRoom(scene: SceneModel, roomId: string, fn: (r: RoomNode) => RoomNode): SceneModel {
  let touched = false
  const mapRoomNode = (room: RoomNode): RoomNode => {
    // 与 findRoom 同款：id 优先，未命中回退名称（LLM 常用房间名引用）
    if (room.id === roomId || room.name === roomId) {
      touched = true
      return fn(room)
    }
    return { ...room, nestedRooms: room.nestedRooms.map(mapRoomNode) }
  }
  const next: SceneModel = {
    ...scene,
    root: {
      ...scene.root,
      levels: scene.root.levels.map((level) => ({
        ...level,
        rooms: level.rooms.map(mapRoomNode),
      })),
    },
  }
  // 调用方均已先用 findRoom 校验存在（id 或名称），未命中仅理论情况：原样返回
  return touched ? next : scene
}

/** 刷新楼层高度 = 该层房间最大层高（op 改房间高度后同步） */
function refreshLevelHeight(scene: SceneModel): SceneModel {
  return {
    ...scene,
    root: {
      ...scene.root,
      levels: scene.root.levels.map((level): LevelNode => {
        const height = Math.max(...level.rooms.map((r) => r.height), 2.8)
        return height === level.height ? level : { ...level, height }
      }),
    },
  }
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

// ---------------------------------------------------------------------------
// 快照容错路径（design.md §4.2）：LLM 偶尔输出整屋快照（v2）时，
// 按 id diff 成 ops 再执行——改动半径与手写 ops 相同
// ---------------------------------------------------------------------------

/** 由 v2 房间构造 addRoom 可用的 RoomSpec（含嵌套与家具） */
function roomSpecFromV2(room: RoomNodeV2): RoomSpec {
  return {
    id: room.id,
    name: room.name,
    dimensions: room.dimensions,
    side: room.side,
    position: room.position,
    footprint: room.footprint,
    furniture: room.children
      .filter((c) => c.type !== 'room')
      .map((f) => ({ id: f.id, name: f.name, dimensions: f.dimensions, position: f.position })),
    nestedRooms: room.children.filter((c) => c.type === 'room').map(roomSpecFromV2),
  }
}

function dimsDiffer(a: Dimensions, b: Dimensions): boolean {
  return (
    Math.abs(a.length - b.length) > 1e-6 ||
    Math.abs(a.width - b.width) > 1e-6 ||
    Math.abs(a.height - b.height) > 1e-6
  )
}

function posDiffer(a: Position, b: Position): boolean {
  return Math.abs(a.x - b.x) > 1e-6 || Math.abs(a.y - b.y) > 1e-6 || Math.abs(a.z - b.z) > 1e-6
}

/** 把当前场景与 v2 快照 diff 成操作序列（确定性，按数组顺序）。
 * auto 模板布局直接映射 macro（与旧版 resolveLayout 行为一致：模板语义是整屋重排）；
 * custom 自由布局按 id 逐房间 diff，未变化的房间保持不动。 */
export function diffSceneV2(current: SceneModel | null, target: SceneModelV2): Op[] {
  const layout = target.root.layout
  if (layout.mode === 'auto') {
    const rooms = target.root.children.map(roomSpecFromV2)
    return [
      {
        op: 'macro',
        name: layout.template,
        params: {
          name: target.root.name,
          ...(layout.template === 'corridor'
            ? { corridor: layout.corridor }
            : { centerRoomId: layout.centerRoomId }),
          rooms,
        },
      },
    ]
  }
  const ops: Op[] = []
  if (!current || current.root.name !== target.root.name) {
    ops.push({ op: 'setHouse', name: target.root.name })
  }
  ops.push(...diffRooms(current?.root.levels[0].rooms ?? [], target.root.children))
  return ops
}

function diffRooms(currentRooms: RoomNode[], targetRooms: RoomNodeV2[]): Op[] {
  const ops: Op[] = []
  const targetById = new Map(targetRooms.map((r) => [r.id, r]))
  for (const cur of currentRooms) {
    const t = targetById.get(cur.id)
    if (!t) {
      ops.push({ op: 'removeRoom', id: cur.id })
      continue
    }
    const patch: { name?: string; dimensions?: Partial<Dimensions>; footprint?: Point2D[] } = {}
    if (cur.name !== t.name) patch.name = t.name
    const b = footprintBounds(cur.footprint)
    const targetDims = {
      length: t.dimensions.length,
      width: t.dimensions.width,
      height: t.dimensions.height,
    }
    if (
      Math.abs(b.maxX - b.minX - targetDims.length) > 1e-6 ||
      Math.abs(b.maxZ - b.minZ - targetDims.width) > 1e-6 ||
      Math.abs(cur.height - targetDims.height) > 1e-6
    ) {
      patch.dimensions = targetDims
    }
    if (t.footprint && !sameFootprint(cur.footprint, t.footprint)) {
      patch.footprint = t.footprint
    }
    if (patch.name || patch.dimensions || patch.footprint) {
      ops.push({ op: 'updateRoom', id: cur.id, patch })
    }
    ops.push(
      ...diffFurniture(cur, t.children.filter((c) => c.type !== 'room') as FurnitureNodeV2[]),
    )
    ops.push(
      ...diffRooms(cur.nestedRooms, t.children.filter((c) => c.type === 'room') as RoomNodeV2[]),
    )
  }
  for (const t of targetRooms) {
    if (!currentRooms.some((c) => c.id === t.id)) {
      const spec = roomSpecFromV2(t)
      ops.push({
        op: 'addRoom',
        id: spec.id,
        name: spec.name!,
        dimensions: spec.dimensions,
        side: spec.side,
        footprint: spec.footprint,
        furniture: spec.furniture,
        nestedRooms: spec.nestedRooms,
      })
    }
  }
  return ops
}

function sameFootprint(a: { x: number; z: number }[], b: { x: number; z: number }[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i].x - b[i].x) > 1e-6 || Math.abs(a[i].z - b[i].z) > 1e-6) return false
  }
  return true
}

function diffFurniture(currentRoom: RoomNode, targetFurniture: FurnitureNodeV2[]): Op[] {
  const ops: Op[] = []
  const tById = new Map(targetFurniture.map((f) => [f.id, f]))
  const c = footprintCenter(currentRoom.footprint)
  for (const f of currentRoom.furniture) {
    const t = tById.get(f.id)
    if (!t) {
      ops.push({ op: 'removeFurniture', roomId: currentRoom.id, id: f.id })
      continue
    }
    const patch: { name?: string; dimensions?: Partial<Dimensions>; position?: Partial<Position> } =
      {}
    if (f.name !== t.name) patch.name = t.name
    if (dimsDiffer(f.dimensions, t.dimensions)) patch.dimensions = t.dimensions
    // v2 家具 position 本身即「相对房间中心」，与当前绝对位置换算成相对后比较
    const curRel: Position = {
      x: f.position.x - c.x,
      y: f.position.y,
      z: f.position.z - c.z,
    }
    if (posDiffer(curRel, t.position)) {
      patch.position = { x: t.position.x, y: t.position.y, z: t.position.z }
    }
    if (patch.name || patch.dimensions || patch.position) {
      ops.push({ op: 'updateFurniture', roomId: currentRoom.id, id: f.id, patch })
    }
  }
  for (const t of targetFurniture) {
    if (!currentRoom.furniture.some((f) => f.id === t.id)) {
      ops.push({
        op: 'addFurniture',
        roomId: currentRoom.id,
        id: t.id,
        name: t.name,
        dimensions: t.dimensions,
        position: t.position,
        rotationY: t.rotationY,
      })
    }
  }
  return ops
}
