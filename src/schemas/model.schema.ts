import { z } from 'zod'
import type {
  FurnitureNode,
  HouseNode,
  ModelNodeV2,
  RoomNode,
  RoomNodeV2,
  SceneModel,
} from '../types/model'

/**
 * 大模型输出的 v2 语义模型 JSON Schema。
 * 房间不携带绝对坐标（auto 模式由布局引擎平铺），家具位置相对所在房间中心；
 * 房间内可嵌套子房间（如卧室内的卫生间）。
 */
export const dimensionsSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
})

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
})

export const furnitureNodeV2Schema = z.object({
  id: z.string().min(1),
  type: z.enum(['furniture', 'wall']),
  name: z.string().min(1),
  dimensions: dimensionsSchema,
  position: positionSchema,
  rotationY: z.number().optional(),
  description: z.string().optional(),
})

export const roomNodeV2Schema: z.ZodType<RoomNodeV2> = z.object({
  id: z.string().min(1),
  type: z.literal('room'),
  name: z.string().min(1),
  dimensions: dimensionsSchema,
  position: positionSchema.optional(),
  footprint: z
    .array(z.object({ x: z.number(), z: z.number() }))
    .min(4)
    .optional(),
  side: z.string().optional(),
  children: z.array(z.lazy(() => modelNodeV2Schema)),
})

/** 房间或家具（用于房间的子节点，支持嵌套子房间） */
export const modelNodeV2Schema: z.ZodType<ModelNodeV2> = z.lazy(() =>
  z.union([roomNodeV2Schema, furnitureNodeV2Schema]),
)

export const layoutSpecSchema = z.union([
  z.object({
    mode: z.literal('auto'),
    template: z.literal('corridor'),
    corridor: z
      .object({
        width: z.number().positive().optional(),
        entranceRoomId: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    mode: z.literal('auto'),
    template: z.literal('living'),
    centerRoomId: z.string().min(1),
  }),
  z.object({ mode: z.literal('custom') }),
])

export const houseNodeV2Schema = z.object({
  id: z.string().min(1),
  type: z.literal('house'),
  name: z.string().min(1),
  dimensions: dimensionsSchema,
  position: positionSchema,
  // 布局缺省时按自由模式处理（宽松容错）
  layout: layoutSpecSchema.default({ mode: 'custom' }),
  children: z.array(roomNodeV2Schema).default([]),
})

export const sceneModelV2Schema = z.object({
  version: z.literal(2),
  root: houseNodeV2Schema,
})

export type ParsedSceneModelV2 = z.infer<typeof sceneModelV2Schema>

// ---------------------------------------------------------------------------
// v3 足迹模型（本地持久化 / 分享口令的数据入口校验，migration 与导入路径使用）
// ---------------------------------------------------------------------------

export const point2DSchema = z.object({ x: z.number(), z: z.number() })

/** 显式开洞（门/窗）：edgeIndex 为 footprint 边下标，from/to 为沿边局部区间 */
export const openingSchema = z.object({
  edgeIndex: z.number(),
  from: z.number(),
  to: z.number(),
  width: z.number(),
})

export const furnitureNodeV3Schema: z.ZodType<FurnitureNode> = z.object({
  id: z.string().min(1),
  type: z.literal('furniture'),
  name: z.string().min(1),
  dimensions: dimensionsSchema,
  position: positionSchema,
  rotationY: z.number().optional(),
  description: z.string().optional(),
})

export const roomNodeV3Schema: z.ZodType<RoomNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.literal('room'),
    name: z.string().min(1),
    footprint: z.array(point2DSchema).min(4),
    height: z.number(),
    doors: z.array(openingSchema),
    windows: z.array(openingSchema),
    furniture: z.array(furnitureNodeV3Schema),
    nestedRooms: z.array(roomNodeV3Schema),
  }),
)

export const levelNodeV3Schema = z.object({
  id: z.string().min(1),
  height: z.number(),
  rooms: z.array(roomNodeV3Schema),
})

export const houseNodeV3Schema: z.ZodType<HouseNode> = z.object({
  id: z.string().min(1),
  type: z.literal('house'),
  name: z.string().min(1),
  style: z.string().optional(),
  levels: z.array(levelNodeV3Schema).min(1),
  entranceRoomId: z.string().optional(),
  entranceDir: z.enum(['north', 'south', 'east', 'west']).optional(),
})

/** 完整 v3 场景（数据入口校验：本地项目库 / 分享口令，校验通过才放行） */
export const sceneModelV3Schema: z.ZodType<SceneModel> = z.object({
  version: z.literal(3),
  root: houseNodeV3Schema,
})
