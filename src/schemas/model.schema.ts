import { z } from 'zod'
import type { ContainerNode, ModelNode } from '../types/model'

/**
 * 大模型输出的层级化模型 JSON Schema（Phase 1 对话生成校验所用）。
 * 使用 z.lazy 处理「容器节点 ↔ 子节点」的循环引用。
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

export const furnitureNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['furniture', 'wall']),
  name: z.string().min(1),
  dimensions: dimensionsSchema,
  position: positionSchema,
  rotationY: z.number().optional(),
  description: z.string().optional(),
})

const baseContainerNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['room', 'house']),
  name: z.string().min(1),
  dimensions: dimensionsSchema,
  position: positionSchema,
})

/** 容器节点：由基础字段扩展出子节点数组（循环引用通过 lazy 惰性解析） */
export const containerNodeSchema: z.ZodType<ContainerNode> = baseContainerNodeSchema.extend({
  children: z.array(z.lazy(() => modelNodeSchema)),
})

export const modelNodeSchema: z.ZodType<ModelNode> = z.lazy(() =>
  z.union([containerNodeSchema, furnitureNodeSchema]),
)

export const sceneModelSchema = z.object({
  version: z.literal(1),
  root: containerNodeSchema,
})

export type ParsedSceneModel = z.infer<typeof sceneModelSchema>
