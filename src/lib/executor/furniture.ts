import { footprintCenter } from '../footprint'
import { createId } from '../id'
import { findNodeById } from '../modelTree'
import { DEFAULT_FURNITURE_DIMS, findRoom, mapRoom } from './shared'
import type { Op } from '../../types/ops'
import type { FurnitureNode, SceneModel } from '../../types/model'

// ---------------------------------------------------------------------------
// 家具
// ---------------------------------------------------------------------------

export function applyAddFurniture(
  scene: SceneModel,
  op: Extract<Op, { op: 'addFurniture' }>,
): SceneModel {
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

export function applyUpdateFurniture(
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

export function applyRemoveFurniture(
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
