import { z } from 'zod'
import type { ModelNodeV2, RoomNodeV2 } from '../types/model'

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
