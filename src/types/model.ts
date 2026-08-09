/** 模块三维尺寸（单位：米） */
export interface Dimensions {
  /** 长（x 方向） */
  length: number
  /** 宽（z 方向） */
  width: number
  /** 高（y 方向） */
  height: number
}

/** 空间坐标（单位：米，整屋原点位于地面中心） */
export interface Position {
  x: number
  y: number
  z: number
}

/** 平面坐标（x/z，单位：米） */
export interface Point2D {
  x: number
  z: number
}

/** 叶节点模块（家具） */
export interface FurnitureNode {
  id: string
  type: 'furniture'
  name: string
  dimensions: Dimensions
  position: Position
  /** 绕 Y 轴旋转角度（弧度） */
  rotationY?: number
  /** 说明文字 */
  description?: string
}

/**
 * 显式开洞（门/窗）：定位到 footprint 的某条边（edgeIndex），
 * from/to 为该边沿边方向的局部区间（0..边长），width 为开洞宽度（冗余便于生成端使用）。
 */
export interface Opening {
  /** footprint 边下标（与 RoomNode.footprint 顶点环一一对应） */
  edgeIndex: number
  from: number
  to: number
  width: number
}

/** 房间（v3）：足迹几何为权威形状，矩形是 4 点特例；墙/门默认由代码推导，显式开洞走覆盖层 */
export interface RoomNode {
  id: string
  type: 'room'
  name: string
  /** 正交多边形足迹：世界坐标顶点环（相邻边垂直），矩形 = 4 个顶点 */
  footprint: Point2D[]
  /** 层高（米），独立于 footprint */
  height: number
  /** 显式门洞（渲染时覆盖推导结果） */
  doors: Opening[]
  /** 显式窗洞（渲染时覆盖推导结果） */
  windows: Opening[]
  /** 家具（绝对坐标，y 为高度一半，底面贴房间地面） */
  furniture: FurnitureNode[]
  /** 嵌套子房间（如卧室内卫生间） */
  nestedRooms: RoomNode[]
}

/** 楼层（Phase 5 预留多层；当前恒为单层） */
export interface LevelNode {
  id: string
  /** 楼层净高（米） */
  height: number
  rooms: RoomNode[]
}

/** 整屋（v3）：楼层列表 + 入户房间 id（迁移保留，在入口房间入口方向外墙生成入户门） */
export interface HouseNode {
  id: string
  type: 'house'
  name: string
  /** 风格（Phase 5 预留） */
  style?: string
  levels: LevelNode[]
  /** 入户房间 id，用于在外墙生成入户大门 */
  entranceRoomId?: string
  /** 入户门方向（入口房间哪面外墙开门，默认 south 南墙；setHouse 可改） */
  entranceDir?: 'north' | 'south' | 'east' | 'west'
}

/** 模型中的任意节点（容器或叶节点） */
export type ModelNode = HouseNode | RoomNode | FurnitureNode

/** 完整场景模型（以整屋为根节点，v3：足迹几何 + 显式开洞覆盖层） */
export interface SceneModel {
  version: 3
  root: HouseNode
}

// ---------------------------------------------------------------------------
// v2 语义契约（大模型输出，经 resolveLayout 解析为 v3 绝对坐标模型）
// ---------------------------------------------------------------------------

/** 家具 v2：位置相对所在房间中心，y 为家具高度一半（底面贴房间地面） */
export interface FurnitureNodeV2 {
  id: string
  type: 'furniture' | 'wall'
  name: string
  dimensions: Dimensions
  position: Position
  rotationY?: number
  description?: string
}

/** 房间子节点：家具/墙体，或嵌套的子房间（如卧室内的卫生间） */
export type RoomChildV2 = FurnitureNodeV2 | RoomNodeV2

/** v2 模型任意节点（房间或家具） */
export type ModelNodeV2 = FurnitureNodeV2 | RoomNodeV2

/** 房间 v2：auto 模式用 side 表达布置意图；custom 模式提供 position */
export interface RoomNodeV2 {
  id: string
  type: 'room'
  name: string
  dimensions: Dimensions
  /** custom 模式的绝对位置（房间中心） */
  position?: Position
  /** 自定义足迹顶点环（仅 custom 模式生效：L 形/U 形直接表达；世界坐标，整屋居中时随整体平移） */
  footprint?: Point2D[]
  /** 布置意图：corridor 模板为 'left'|'right'；living 模板为 'north'|'south'|'east'|'west' */
  side?: string
  /** 子节点：家具，或嵌套的子房间（如卧室内的卫生间，布局时自动拍平） */
  children: RoomChildV2[]
}

/** 布局说明：auto（代码平铺）或 custom（自由坐标） */
export type LayoutSpec =
  | {
      mode: 'auto'
      template: 'corridor'
      corridor?: { width?: number; entranceRoomId?: string }
    }
  | { mode: 'auto'; template: 'living'; centerRoomId: string }
  | { mode: 'custom' }

/** 整屋 v2 */
export interface HouseNodeV2 {
  id: string
  type: 'house'
  name: string
  dimensions: Dimensions
  position: Position
  layout: LayoutSpec
  children: RoomNodeV2[]
}

/** 大模型输出的 v2 场景 */
export interface SceneModelV2 {
  version: 2
  root: HouseNodeV2
}
