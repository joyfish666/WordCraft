import type { FurnitureNode, HouseNode, LevelNode, RoomNode, SceneModel } from '../types/model'
import { sceneModelV3Schema } from '../schemas/model.schema'
import { DEFAULT_HEIGHT } from './constants'
import { levelHeight, rectFootprint } from './footprint'

/**
 * 旧模型 → v3 迁移（v1 盒子模型 → v3 足迹模型），幂等且可测：
 * - 盒子房间 → 4 点足迹（矩形特例），position/dimensions 不再存储；
 * - 整屋 → levels 单层，entranceRoomId 保留；
 * - 家具统一为 'furniture' 类型（v1 的 'wall' 并入）。
 * 覆盖两条路径：本地项目库 JSON、分享口令 JSON（均以纯函数方式在此迁移）。
 * v3 输入原样返回（引用不变，幂等）；非法输入返回 null（调用方降级提示）。
 * 注：v3 分支同样过 zod 结构校验（sceneModelV3Schema），畸形口令/损坏数据不再放行。
 */
export function migrateModel(input: unknown): SceneModel | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  if (obj.version === 3) {
    // 结构校验通过才放行（校验成功即保证形状，返回原对象保持引用不变）
    return sceneModelV3Schema.safeParse(obj).success ? (obj as unknown as SceneModel) : null
  }
  if (obj.version !== 1) return null
  const root = obj.root as Record<string, unknown> | undefined
  if (!root || typeof root !== 'object') return null
  if (root.type !== 'house') return null
  return {
    version: 3,
    root: migrateHouse(root),
  }
}

function migrateHouse(house: Record<string, unknown>): HouseNode {
  const id = asString(house.id, 'house')
  const name = asString(house.name, '整屋')
  const children = Array.isArray(house.children) ? house.children : []
  const rooms = children.map((c) => migrateRoom(c)).filter((r): r is RoomNode => r !== null)
  const entranceRoomId = typeof house.entranceRoomId === 'string' ? house.entranceRoomId : undefined
  const dims = (house.dimensions ?? {}) as Record<string, unknown>
  const legacyHeight = asNum(dims.height, DEFAULT_HEIGHT)
  const height = Math.max(levelHeight(rooms), legacyHeight)
  const level: LevelNode = { id: `${id}-l1`, height, rooms }
  return {
    id,
    type: 'house',
    name,
    levels: [level],
    ...(entranceRoomId ? { entranceRoomId } : {}),
  }
}

function migrateRoom(node: unknown): RoomNode | null {
  if (!node || typeof node !== 'object') return null
  const r = node as Record<string, unknown>
  if (r.type !== 'room') return null
  const dims = r.dimensions as Record<string, unknown> | undefined
  const length = asNum(dims?.length, 3)
  const width = asNum(dims?.width, 3)
  const height = asNum(dims?.height, DEFAULT_HEIGHT)
  const pos = r.position as Record<string, unknown> | undefined
  const x = asNum(pos?.x, 0)
  const z = asNum(pos?.z, 0)
  const children = Array.isArray(r.children) ? r.children : []
  const furniture: FurnitureNode[] = []
  const nestedRooms: RoomNode[] = []
  for (const c of children) {
    if (!c || typeof c !== 'object') continue
    const cc = c as Record<string, unknown>
    if (cc.type === 'room') {
      const nested = migrateRoom(cc)
      if (nested) nestedRooms.push(nested)
    } else {
      const f = migrateFurniture(cc)
      if (f) furniture.push(f)
    }
  }
  return {
    id: asString(r.id, `room-${x}-${z}`),
    type: 'room',
    name: asString(r.name, '房间'),
    footprint: rectFootprint(x, z, length, width),
    height,
    doors: [],
    windows: [],
    furniture,
    nestedRooms,
  }
}

function migrateFurniture(node: Record<string, unknown>): FurnitureNode | null {
  const dims = node.dimensions as Record<string, unknown> | undefined
  const pos = node.position as Record<string, unknown> | undefined
  if (!dims || !pos) return null
  return {
    id: asString(node.id, 'furniture'),
    type: 'furniture',
    name: asString(node.name, '家具'),
    dimensions: {
      length: asNum(dims.length, 1),
      width: asNum(dims.width, 1),
      height: asNum(dims.height, 0.5),
    },
    position: {
      x: asNum(pos.x, 0),
      y: asNum(pos.y, 0.25),
      z: asNum(pos.z, 0),
    },
    ...(typeof node.rotationY === 'number' ? { rotationY: node.rotationY } : {}),
    ...(typeof node.description === 'string' ? { description: node.description } : {}),
  }
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

function asNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
