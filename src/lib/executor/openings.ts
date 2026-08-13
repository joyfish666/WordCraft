import { footprintCenter } from '../footprint'
import { DOOR_WIDTH } from '../roomGeometry'
import { DEFAULT_WINDOW_WIDTH, findRoom, mapRoom } from './shared'
import type { Dir, Op } from '../../types/ops'
import type { RoomNode, SceneModel } from '../../types/model'

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

export function applySetOpenings(
  scene: SceneModel,
  op: Extract<Op, { op: 'setOpenings' }>,
): SceneModel {
  const room = findRoom(scene, op.roomId)
  if (!room) throw new Error(`房间「${op.roomId}」不存在`)
  // P4：UI 提供精确边下标（edgeIndex）；LLM 沿用 side（取该方向最长边，确定性）。
  // 跨字段约束「至少其一」在此兜底（schema 无法表达 refine，见 ops.schema 注释）
  let edge: { edgeIndex: number; length: number } | null = null
  if (op.edgeIndex !== undefined) edge = edgeByIndex(room, op.edgeIndex)
  else if (op.side !== undefined) edge = findEdgeBySide(room, op.side)
  else throw new Error('setOpenings 必须提供 side 或 edgeIndex 之一')
  if (!edge) {
    const via = op.edgeIndex !== undefined ? `边下标 ${op.edgeIndex}` : `${op.side} 向`
    throw new Error(`房间「${op.roomId}」没有 ${via}边`)
  }

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
