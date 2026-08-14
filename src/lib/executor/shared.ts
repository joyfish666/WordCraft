import { edgeMetaOf, findRoomInList } from '../geometry'
import { removeNode } from '../modelTree'
import { DEFAULT_HEIGHT } from '../constants'
import type { Dimensions, LevelNode, Point2D, RoomNode, SceneModel } from '../../types/model'

/** 房间规格缺省尺寸（米）：单一来源（原 executor.ts 顶层导出） */
export const DEFAULT_ROOM_DIMS: Dimensions = { length: 3, width: 3, height: DEFAULT_HEIGHT }
/** 家具规格缺省尺寸（米）：单一来源（原 executor.ts 顶层导出） */
export const DEFAULT_FURNITURE_DIMS: Dimensions = { length: 1, width: 0.5, height: 0.5 }
/** 窗洞缺省宽度（米）：单一来源（原 executor.ts 顶层导出） */
export const DEFAULT_WINDOW_WIDTH = 1.5

/** id 是否为 room 的嵌套后代（环检测用） */
export function isDescendantOf(room: RoomNode, id: string): boolean {
  return room.nestedRooms.some((n) => n.id === id || isDescendantOf(n, id))
}

/** 把房间替换为其所在容器内的若干新房间（顶层/嵌套均可，不可变更新） */
export function replaceRoom(scene: SceneModel, id: string, rooms: RoomNode[]): SceneModel {
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
  const level = scene.root.levels[0]!
  return {
    ...scene,
    root: { ...scene.root, levels: [{ ...level, rooms: replaceList(level.rooms) }] },
  }
}

/** 按方向找矩形足迹边下标（坑 39 约定：0=南 1=东 2=北 3=西；按几何方向解析） */
export function edgeDirIndex(fp: Point2D[], dir: 'north' | 'south' | 'east' | 'west'): number {
  for (let i = 0; i < fp.length; i++) {
    if (edgeMetaOf(fp, i)?.dir === dir) return i
  }
  throw new Error(`足迹没有 ${dir} 向边`)
}

/** 把嵌套房间提升到顶层（世界坐标不变，追加到顶层末尾） */
export function liftToTopLevel(root: SceneModel['root'], room: RoomNode): SceneModel['root'] {
  const removed = removeNode(root, room.id) as SceneModel['root']
  return {
    ...removed,
    levels: removed.levels.map((l, i) => (i === 0 ? { ...l, rooms: [...l.rooms, room] } : l)),
  }
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
  return findRoomInList(scene.root.levels[0]!.rooms, ref)
}

/** 不可变更新指定房间（含嵌套），fn 返回新房间 */
export function mapRoom(
  scene: SceneModel,
  roomId: string,
  fn: (r: RoomNode) => RoomNode,
): SceneModel {
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
export function refreshLevelHeight(scene: SceneModel): SceneModel {
  return {
    ...scene,
    root: {
      ...scene.root,
      levels: scene.root.levels.map((level): LevelNode => {
        const height = Math.max(...level.rooms.map((r) => r.height), DEFAULT_HEIGHT)
        return height === level.height ? level : { ...level, height }
      }),
    },
  }
}
