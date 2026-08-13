import { findNodeById } from './modelTree'
import { footprintCenter } from './footprint'
import { sameFootprint } from './geometry'
import { EPSILON } from './constants'
import type { Op } from '../types/ops'
import type { Dimensions, Position, RoomNode, SceneModel } from '../types/model'

/**
 * 双向同步（design.md §5.1）：把一次手动编辑转换为与对话同构的操作（op）。
 * 手动编辑（属性面板/Gizmo/位移微调）在 useModelStore 提交时，用本函数把
 * 「编辑前场景 → 编辑后场景」diff 成一条 op，追加进 useChatStore 的编辑日志，
 * 随多轮上下文喂给 LLM——"我拖了个房间，再让 AI 继续改"。
 *
 * 约定：
 * - 房间位移/改尺寸 → updateRoom.patch.footprint（世界坐标顶点环，可精确回放）；
 * - 家具位移 → updateFurniture.patch.position（相对所在房间中心，v2 语义）；
 * - 无法表达（节点不存在 / 无实际变化）时返回空数组，调用方不记录。
 */

function dimsEqual(a: Dimensions, b: Dimensions): boolean {
  return (
    Math.abs(a.length - b.length) <= EPSILON &&
    Math.abs(a.width - b.width) <= EPSILON &&
    Math.abs(a.height - b.height) <= EPSILON
  )
}

function posEqual(a: Position, b: Position): boolean {
  return (
    Math.abs(a.x - b.x) <= EPSILON &&
    Math.abs(a.y - b.y) <= EPSILON &&
    Math.abs(a.z - b.z) <= EPSILON
  )
}

/** 递归查找家具所属房间（含嵌套），未找到返回 null */
function findFurnitureRoom(rooms: RoomNode[], id: string): RoomNode | null {
  for (const room of rooms) {
    if (room.furniture.some((f) => f.id === id)) return room
    const nested = findFurnitureRoom(room.nestedRooms, id)
    if (nested) return nested
  }
  return null
}

/** 把一次手动编辑（before → after）转换为操作序列；无实际变化或无法表达时返回空数组 */
export function editDiffToOps(before: SceneModel, after: SceneModel, id: string): Op[] {
  const beforeNode = findNodeById(before.root, id)
  const afterNode = findNodeById(after.root, id)
  if (!beforeNode || !afterNode) return []

  if (beforeNode.type === 'house' && afterNode.type === 'house') {
    if (beforeNode.name === afterNode.name) return []
    return [{ op: 'setHouse', name: afterNode.name, style: afterNode.style }]
  }

  if (beforeNode.type === 'room' && afterNode.type === 'room') {
    const patch: {
      name?: string
      dimensions?: Partial<Dimensions>
      footprint?: typeof afterNode.footprint
    } = {}
    if (beforeNode.name !== afterNode.name) patch.name = afterNode.name
    if (!sameFootprint(beforeNode.footprint, afterNode.footprint)) {
      patch.footprint = afterNode.footprint
    }
    if (beforeNode.height !== afterNode.height) {
      patch.dimensions = { ...patch.dimensions, height: afterNode.height }
    }
    if (
      patch.name === undefined &&
      patch.dimensions === undefined &&
      patch.footprint === undefined
    ) {
      return []
    }
    return [{ op: 'updateRoom', id, patch }]
  }

  if (beforeNode.type === 'furniture' && afterNode.type === 'furniture') {
    const room = findFurnitureRoom(after.root.levels[0]!.rooms, id)
    if (!room) return []
    const patch: {
      name?: string
      dimensions?: Partial<Dimensions>
      position?: Partial<Position>
    } = {}
    if (beforeNode.name !== afterNode.name) patch.name = afterNode.name
    if (!dimsEqual(beforeNode.dimensions, afterNode.dimensions)) {
      patch.dimensions = afterNode.dimensions
    }
    if (!posEqual(beforeNode.position, afterNode.position)) {
      // v2 语义：position 相对所在房间中心（x/z 偏移，y 为高度一半）
      const c = footprintCenter(room.footprint)
      patch.position = {
        x: afterNode.position.x - c.x,
        y: afterNode.position.y,
        z: afterNode.position.z - c.z,
      }
    }
    if (
      patch.name === undefined &&
      patch.dimensions === undefined &&
      patch.position === undefined
    ) {
      return []
    }
    return [{ op: 'updateFurniture', roomId: room.id, id, patch }]
  }

  return []
}
