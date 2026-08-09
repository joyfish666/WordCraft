import { z } from 'zod'
import type { RoomSpec } from '../types/ops'

/**
 * 大模型输出的 v3 操作契约（ops）JSON Schema（design.md §4.1）。
 * Zod union 白名单 + id 引用校验；每条 op 独立解析，执行器逐条容错。
 */

const point2dSchema = z.object({ x: z.number(), z: z.number() })

const positionSchema = z.object({ x: z.number(), y: z.number(), z: z.number() })

const positionPatchSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional(),
})

const dimensionsSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
})

/** 尺寸补丁：可只改长/宽/高中任意一项 */
const dimensionsPatchSchema = z.object({
  length: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
})

const dirSchema = z.enum(['north', 'south', 'east', 'west'])

const relativeToSchema = z.object({ roomId: z.string().min(1), dir: dirSchema })

/** 家具规格（addRoom / addFurniture 共用） */
export const furnitureSpecSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  dimensions: dimensionsSchema.optional(),
  position: positionSchema.optional(),
  rotationY: z.number().optional(),
  description: z.string().optional(),
})

/** 房间规格（addRoom / macro params 共用，支持递归嵌套） */
export const roomSpecSchema: z.ZodType<RoomSpec> = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  dimensions: dimensionsPatchSchema.optional(),
  side: z.string().optional(),
  footprint: z.array(point2dSchema).min(4).optional(),
  position: positionSchema.optional(),
  furniture: z.array(furnitureSpecSchema).optional(),
  nestedRooms: z.array(z.lazy(() => roomSpecSchema)).optional(),
})

export const setHouseOpSchema = z.object({
  op: z.literal('setHouse'),
  name: z.string().min(1).optional(),
  style: z.string().optional(),
  // 迁移入户门：把大门改到指定房间（必须是已有房间）及入口房间的哪面外墙（默认 south 南墙）
  entranceRoomId: z.string().min(1).optional(),
  entranceDir: dirSchema.optional(),
})

export const macroOpSchema = z.object({
  op: z.literal('macro'),
  name: z.enum(['corridor', 'living', 'custom']),
  params: z
    .object({
      name: z.string().min(1).optional(),
      corridor: z
        .object({
          width: z.number().positive().optional(),
          entranceRoomId: z.string().optional(),
        })
        .optional(),
      centerRoomId: z.string().optional(),
      rooms: z.array(roomSpecSchema).default([]),
    })
    .optional(),
})

export const addRoomOpSchema = z.object({
  op: z.literal('addRoom'),
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  dimensions: dimensionsPatchSchema.optional(),
  side: z.string().optional(),
  footprint: z.array(point2dSchema).min(4).optional(),
  relativeTo: relativeToSchema.optional(),
  furniture: z.array(furnitureSpecSchema).optional(),
  nestedRooms: z.array(z.lazy(() => roomSpecSchema)).optional(),
})

export const updateRoomOpSchema = z.object({
  op: z.literal('updateRoom'),
  id: z.string().min(1),
  patch: z.object({
    name: z.string().min(1).optional(),
    dimensions: dimensionsPatchSchema.optional(),
    // side 为布置意图（执行器对已平铺房间不生效，见 executor 注释）
    side: z.string().optional(),
    footprint: z.array(point2dSchema).min(4).optional(),
  }),
})

export const removeRoomOpSchema = z.object({
  op: z.literal('removeRoom'),
  id: z.string().min(1),
})

export const moveRoomOpSchema = z.object({
  op: z.literal('moveRoom'),
  id: z.string().min(1),
  relativeTo: relativeToSchema.optional(),
})

/** 内嵌：把已有房间嵌套进另一个房间内部（如主卧卫生间 → 主卧），side 决定靠父房间哪个角 */
export const nestRoomOpSchema = z.object({
  op: z.literal('nestRoom'),
  id: z.string().min(1),
  into: z.string().min(1),
  side: dirSchema.optional(),
})

export const addFurnitureOpSchema = z.object({
  op: z.literal('addFurniture'),
  roomId: z.string().min(1),
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  dimensions: dimensionsSchema.optional(),
  position: positionSchema.optional(),
  rotationY: z.number().optional(),
  description: z.string().optional(),
})

export const updateFurnitureOpSchema = z.object({
  op: z.literal('updateFurniture'),
  roomId: z.string().min(1),
  id: z.string().min(1),
  patch: z.object({
    name: z.string().min(1).optional(),
    dimensions: dimensionsPatchSchema.optional(),
    position: positionPatchSchema.optional(),
    rotationY: z.number().optional(),
  }),
})

export const removeFurnitureOpSchema = z.object({
  op: z.literal('removeFurniture'),
  roomId: z.string().min(1),
  id: z.string().min(1),
})

export const setOpeningsOpSchema = z.object({
  op: z.literal('setOpenings'),
  roomId: z.string().min(1),
  side: dirSchema,
  kind: z.enum(['door', 'window']),
  from: z.number().optional(),
  to: z.number().optional(),
})

export const addAdjacencyOpSchema = z.object({
  op: z.literal('addAdjacency'),
  roomId: z.string().min(1),
  neighborId: z.string().min(1),
  side: dirSchema,
})

/** 全部 op 的判别联合（执行器逐条分发） */
export const opSchema = z.discriminatedUnion('op', [
  setHouseOpSchema,
  macroOpSchema,
  addRoomOpSchema,
  updateRoomOpSchema,
  removeRoomOpSchema,
  moveRoomOpSchema,
  nestRoomOpSchema,
  addFurnitureOpSchema,
  updateFurnitureOpSchema,
  removeFurnitureOpSchema,
  setOpeningsOpSchema,
  addAdjacencyOpSchema,
])

/** 完整 ops 输出：{"version":3,"ops":[...]} 或直接 ops 数组（宽松容错） */
export const sceneOpsSchema = z.object({
  version: z.literal(3),
  ops: z.array(opSchema),
})

export const opsArraySchema = z.array(opSchema)

export type ParsedOp = z.infer<typeof opSchema>
export type ParsedSceneOps = z.infer<typeof sceneOpsSchema>
