import type { Dimensions, Point2D, Position } from './model'

/**
 * v3 操作契约（P2 契约动词化，design.md §4）：大模型输出的增量修改指令。
 * 与整屋快照不同，ops 是「动词 + 参数」的操作序列：
 * - 每条独立容错（失败只跳过该条），LLM 再飘也不毁整屋；
 * - macro 复用旧布局引擎（corridor/living/custom 模板）；
 * - 多轮修改只输出必要操作，未提及的节点不动。
 */

/** 房间规格（addRoom / macro params 的房间描述，语义同 v2 房间：家具位置相对房间中心） */
export interface RoomSpec {
  id?: string
  name: string
  dimensions?: Partial<Dimensions>
  /** 布置意图（macro corridor/living 时生效） */
  side?: string
  /** 自定义足迹顶点环（custom 模式 / 直接替换时使用，世界坐标） */
  footprint?: Point2D[]
  /** custom 模式的绝对位置（房间中心） */
  position?: Position
  furniture?: FurnitureSpec[]
  nestedRooms?: RoomSpec[]
}

/** 家具规格（addRoom/addFurniture 的家具描述，position 相对所在房间中心） */
export interface FurnitureSpec {
  id?: string
  name: string
  dimensions?: Dimensions
  position?: Position
  rotationY?: number
  description?: string
}

/** 方向（相对某房间的方位） */
export type Dir = 'north' | 'south' | 'east' | 'west'

export type Op =
  | { op: 'setHouse'; name?: string; style?: string; entranceRoomId?: string; entranceDir?: Dir }
  | { op: 'macro'; name: 'corridor' | 'living' | 'custom'; params?: MacroParams }
  | {
      op: 'addRoom'
      id?: string
      name: string
      dimensions?: Partial<Dimensions>
      side?: string
      footprint?: Point2D[]
      relativeTo?: { roomId: string; dir: Dir }
      furniture?: FurnitureSpec[]
      nestedRooms?: RoomSpec[]
    }
  | {
      op: 'updateRoom'
      id: string
      patch: {
        name?: string
        dimensions?: Partial<Dimensions>
        side?: string
        footprint?: Point2D[]
      }
    }
  | { op: 'removeRoom'; id: string }
  | { op: 'moveRoom'; id: string; relativeTo?: { roomId: string; dir: Dir } }
  | { op: 'nestRoom'; id: string; into: string; side?: Dir }
  | {
      op: 'addFurniture'
      roomId: string
      id?: string
      name: string
      dimensions?: Dimensions
      position?: Position
      rotationY?: number
      description?: string
    }
  | {
      op: 'updateFurniture'
      roomId: string
      id: string
      patch: {
        name?: string
        dimensions?: Partial<Dimensions>
        position?: Partial<Position>
        rotationY?: number
      }
    }
  | { op: 'removeFurniture'; roomId: string; id: string }
  | {
      op: 'setOpenings'
      roomId: string
      side: Dir
      kind: 'door' | 'window'
      from?: number
      to?: number
    }
  | { op: 'addAdjacency'; roomId: string; neighborId: string; side: Dir }

/** macro 参数：复用旧布局引擎（design.md §4.2），rooms 语义同 v2 房间清单 */
export interface MacroParams {
  name?: string
  /** corridor 型参数 */
  corridor?: { width?: number; entranceRoomId?: string }
  /** living 型参数 */
  centerRoomId?: string
  rooms: RoomSpec[]
}

/** 大模型输出的完整操作序列 */
export interface SceneOps {
  version: 3
  ops: Op[]
}
