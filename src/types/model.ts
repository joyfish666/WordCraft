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

/** 叶节点模块（家具 / 墙体等不可再细分对象） */
export interface FurnitureNode {
  id: string
  type: 'furniture' | 'wall'
  name: string
  dimensions: Dimensions
  position: Position
  /** 绕 Y 轴旋转角度（弧度） */
  rotationY?: number
  /** 说明文字 */
  description?: string
}

/** 容器节点（房间 / 整屋），可包含子模块 */
export interface ContainerNode {
  id: string
  type: 'room' | 'house'
  name: string
  dimensions: Dimensions
  position: Position
  children: ModelNode[]
  /** 整屋的入户房间 id（仅 house 节点有意义），用于在外墙生成入户大门 */
  entranceRoomId?: string
}

/** 模型中的任意节点（容器或叶节点） */
export type ModelNode = ContainerNode | FurnitureNode

/** 完整场景模型（以整屋为根节点，绝对坐标，渲染/存储使用） */
export interface SceneModel {
  version: 1
  root: ContainerNode
}

// ---------------------------------------------------------------------------
// v2 语义契约（大模型输出，经 resolveLayout 解析为 v1 绝对坐标模型）
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

/** 房间 v2：auto 模式用 side 表达布置意图；custom 模式提供 position */
export interface RoomNodeV2 {
  id: string
  type: 'room'
  name: string
  dimensions: Dimensions
  /** custom 模式的绝对位置（房间中心） */
  position?: Position
  /** 布置意图：corridor 模板为 'left'|'right'；living 模板为 'north'|'south'|'east'|'west' */
  side?: string
  children: FurnitureNodeV2[]
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
