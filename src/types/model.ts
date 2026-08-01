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
}

/** 模型中的任意节点（容器或叶节点） */
export type ModelNode = ContainerNode | FurnitureNode

/** 完整场景模型（以整屋为根节点） */
export interface SceneModel {
  version: 1
  root: ContainerNode
}
