import { sameFootprint } from '../geometry'
import { footprintBounds, footprintCenter } from '../footprint'
import type { Op, RoomSpec } from '../../types/ops'
import type {
  Dimensions,
  FurnitureNodeV2,
  Point2D,
  Position,
  RoomNode,
  RoomNodeV2,
  SceneModel,
  SceneModelV2,
} from '../../types/model'

// ---------------------------------------------------------------------------
// 快照容错路径（design.md §4.2）：LLM 偶尔输出整屋快照（v2）时，
// 按 id diff 成 ops 再执行——改动半径与手写 ops 相同
// ---------------------------------------------------------------------------

/** 由 v2 房间构造 addRoom 可用的 RoomSpec（含嵌套与家具，全字段透传不丢数据） */
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
      .map((f) => ({
        id: f.id,
        name: f.name,
        dimensions: f.dimensions,
        position: f.position,
        rotationY: f.rotationY,
        description: f.description,
      })),
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
      // position/footprint/relativeTo 全量透传（历史坑：缺 position 时按 position 布局的
      // custom 快照房间全部落到"排东侧"兜底，静默几何错误；addRoom op 需显式携带）
      ops.push({
        op: 'addRoom',
        id: spec.id,
        name: spec.name!,
        dimensions: spec.dimensions,
        side: spec.side,
        footprint: spec.footprint,
        position: spec.position,
        furniture: spec.furniture,
        nestedRooms: spec.nestedRooms,
      })
    }
  }
  return ops
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
