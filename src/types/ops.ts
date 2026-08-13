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
  /** 贴靠到前文已列出的房间的 dir 侧（custom 模式，无缝共墙；roomId 可用 id 或名称） */
  relativeTo?: { roomId: string; dir: Dir }
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
      /** 绝对位置（房间中心，与 macro custom 房间规格的 position 同语义；优先级高于 relativeTo） */
      position?: Position
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
  /** P4 平面图编辑：把矩形房间沿轴线（axis 'x' = 竖切、'z' = 横切）切成两个房间，
   *  原房间保留 id 与西/南半部分，新房间排到东/北侧，共墙自动开一扇门 */
  | { op: 'splitRoom'; id: string; axis: 'x' | 'z'; position: number; name?: string }
  /** P4 平面图编辑：合并两个并集为矩形的相邻房间（keep 保留 id/名称/层高，remove 并入） */
  | { op: 'mergeRoom'; keep: string; remove: string }
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
      /** 方向（LLM 语义：取该方向最长边）；与 edgeIndex 二选一（P4 UI 用精确边下标） */
      side?: Dir
      kind: 'door' | 'window'
      from?: number
      to?: number
      /** P4 平面图编辑：精确指定 footprint 边下标（坑 39：矩形 0=南 1=东 2=北 3=西），
       *  省略时按 side 取该方向最长边（LLM 沿用 side 语义） */
      edgeIndex?: number
      /** P4：删除同边同种开洞；给定 from/to 时只删与之重叠的开洞，省略则整边清除 */
      remove?: boolean
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
