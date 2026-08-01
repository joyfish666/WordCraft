import { containerNodeSchema, sceneModelSchema } from '../schemas/model.schema'
import type { ContainerNode, ModelNode, SceneModel } from '../types/model'
import {
  streamChatCompletion,
  type ApiClientOptions,
  type ChatMessage,
} from './api'

/** 生成链路中的业务错误，code 供 UI 层区分处理 */
export class ChatGenerationError extends Error {
  constructor(
    message: string,
    public code: 'no-json' | 'invalid-schema' | 'http',
  ) {
    super(message)
    this.name = 'ChatGenerationError'
  }
}

/** 指导大模型输出符合 Zod Schema 的层级化 JSON 的系统提示词 */
export function buildSystemPrompt(): string {
  return `你是一个 3D 空间结构建模助手。用户会用自然语言描述空间、房屋、房间与家具的布局需求。
请输出一个表示完整 3D 模型的 JSON 对象，并严格遵守以下规则：

1. 只输出一个 JSON 对象，不要输出任何解释文字，不要使用 markdown 代码块包裹。
2. JSON 层级结构（整屋 → 房间 → 家具），最外层必须是 {"version": 1, "root": {...}}：
   - 最外层示例：{"version": 1, "root": {"id": "house1", "type": "house", "name": "整屋名称", "dimensions": {"length": 数字, "width": 数字, "height": 数字}, "position": {"x": 0, "y": 0, "z": 0}, "children": [房间...] }}
   - 房间节点：type 为 "room"，可包含 children（家具）。
   - 家具节点：type 为 "furniture"（墙体为 "wall"），不可包含 children。
   - 每个节点都包含 id（全局唯一，重新生成时必须保持已有节点 id 不变）、name、dimensions、position。
3. 坐标约定（单位：米）：
   - 整屋 position 恒为 (0,0,0)。
   - X 为长方向，Z 为宽方向，Y 为高方向，地面 y=0。
   - 所有 position 为世界绝对坐标；任意模块的 position.y 等于其 height 的一半（使底面贴地）。
   - 房间需完全位于整屋范围内，家具需完全位于其所属房间范围内，模块之间不要互相重叠。
4. 合理推断默认尺寸；用户未明确时可补充常见家具尺寸（如双人床约 2×1.5m、衣柜约 1.2×0.6m、沙发约 2×0.9m）。
5. 走廊：当整屋包含两个或以上房间时，必须额外生成一条连接各房间的走廊/连廊（type 为 "room"，name 用"走廊"或"连廊"，长条形，通常布置在整屋中部或一侧，宽度约 1~1.2m），即使未提及；单间房无需走廊。各房间的门朝向走廊。
6. 门：每个房间默认有门（门洞），即使未提及；门宽约 0.9m，朝向走廊或相邻空间，房间靠走廊一侧不应被其他房间或家具堵死。`
}

/** 从模型回复中提取 JSON 字符串：支持纯 JSON、markdown 代码块、夹杂散文三种情况 */
export function extractModelJson(text: string): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{')) return trimmed
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) return fence[1].trim()
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1)
  return null
}

/**
 * 将一组容器/模块包装成整屋节点：按包围盒推断尺寸，并把子节点平移到整屋中心。
 * 用于模型输出「顶层数组」或「{ rooms: [...] }」等未按标准包装的情况。
 */
function wrapAsHouse(children: ModelNode[], name = '整屋'): ContainerNode {
  if (children.length === 0) {
    return {
      id: 'house-generated',
      type: 'house',
      name,
      dimensions: { length: 4, width: 3, height: 2.8 },
      position: { x: 0, y: 0, z: 0 },
      children,
    }
  }
  const halfW = (c: ModelNode) => c.dimensions.length / 2
  const halfD = (c: ModelNode) => c.dimensions.width / 2
  const minX = Math.min(...children.map((c) => c.position.x - halfW(c)))
  const maxX = Math.max(...children.map((c) => c.position.x + halfW(c)))
  const minZ = Math.min(...children.map((c) => c.position.z - halfD(c)))
  const maxZ = Math.max(...children.map((c) => c.position.z + halfD(c)))
  const maxH = Math.max(...children.map((c) => c.position.y + c.dimensions.height / 2))

  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2

  return {
    id: 'house-generated',
    type: 'house',
    name,
    dimensions: { length: maxX - minX, width: maxZ - minZ, height: maxH },
    position: { x: 0, y: 0, z: 0 },
    children: children.map((c) => ({
      ...c,
      position: { x: c.position.x - centerX, y: c.position.y, z: c.position.z - centerZ },
    })),
  }
}

/** 尝试把一个容器值解析为 ContainerNode */
function asContainer(value: unknown): ContainerNode | null {
  if (!value || typeof value !== 'object') return null
  const parsed = containerNodeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * 将 LLM 返回的任意 JSON 归一化为标准结构 { version: 1, root }。
 * 兼容常见的输出变体：标准包装、裸容器、{ house: {...} }、{ rooms: [...] }、顶层数组。
 * 无法识别时返回 null。
 */
export function normalizeModelPayload(raw: unknown): { version: 1; root: ContainerNode } | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>

    // 1) 标准结构 { version, root }
    const wrappedRoot = asContainer(obj.root)
    if (wrappedRoot) return { version: 1, root: wrappedRoot }

    // 2) 裸容器：本身就是 house/room 节点（可能夹杂非法 version 等冗余字段，zod 默认忽略）
    if (obj.type === 'house' || obj.type === 'room') {
      const root = asContainer(obj)
      if (root) return { version: 1, root }
    }

    // 3) { house: {...} }
    const houseNode = asContainer(obj.house)
    if (houseNode) return { version: 1, root: houseNode }

    // 4) { rooms: [...] } / { children: [...] }
    const children = Array.isArray(obj.rooms)
      ? obj.rooms
      : Array.isArray(obj.children)
        ? obj.children
        : []
    if (children.length > 0) {
      const rooms = children
        .map(asContainer)
        .filter((r): r is ContainerNode => r !== null)
      if (rooms.length > 0) {
        return {
          version: 1,
          root: wrapAsHouse(rooms, typeof obj.name === 'string' ? obj.name : '整屋'),
        }
      }
    }
  }

  // 5) 顶层数组：视为多个容器/模块
  if (Array.isArray(raw)) {
    const items = raw.map(asContainer).filter((r): r is ContainerNode => r !== null)
    if (items.length > 0) return { version: 1, root: wrapAsHouse(items) }
  }

  return null
}

export interface GenerateResult {
  /** 模型原始回复 */
  reply: string
  /** 通过校验的层级模型 */
  model: SceneModel
}

export interface GenerateOptions extends ApiClientOptions {
  history: ChatMessage[]
  userInput: string
  /** 流式返回时逐段回调（用于展示进度） */
  onChunk?: (delta: string) => void
}

/** 生成请求的整体兜底超时（流式连接自身保持活跃，此超时仅防挂死） */
const GENERATION_TIMEOUT_MS = 180_000

/**
 * 调用大模型生成模型：系统提示 + 多轮历史 + 用户输入 → 流式接收 → 校验 → 返回模型。
 * 使用 SSE 流式请求，兼容推理型模型（如 DeepSeek v4）的长思考时间。
 * 发送前不进行有效性检测，由调用方确保已配置 API Key。
 */
export async function generateModelFromChat(options: GenerateOptions): Promise<GenerateResult> {
  const { history, userInput, onChunk, ...clientOptions } = options
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...history,
    { role: 'user', content: userInput },
  ]

  let content: string
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS)
  try {
    content = await streamChatCompletion(clientOptions, messages, onChunk, controller.signal)
  } catch (error) {
    throw new ChatGenerationError(
      `模型请求失败：${error instanceof Error ? error.message : String(error)}。可在设置页点「检测连通性」定位问题。`,
      'http',
    )
  } finally {
    clearTimeout(timer)
  }

  const json = extractModelJson(content)
  if (!json) {
    throw new ChatGenerationError('模型返回内容中未找到 JSON，请重试', 'no-json')
  }

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ChatGenerationError('模型返回的 JSON 无法解析，请重试', 'invalid-schema')
  }

  // 归一化常见结构差异，再交给 Zod 严格校验
  const normalized = normalizeModelPayload(raw)
  if (!normalized) {
    throw new ChatGenerationError(
      '模型返回的数据结构无法识别：需要包含整屋 root 节点的 JSON（{ version: 1, root: {...} }）。请重试，或更换更强的模型。',
      'invalid-schema',
    )
  }

  const parsed = sceneModelSchema.safeParse(normalized)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('；')
    throw new ChatGenerationError(
      `模型返回的 JSON 不符合数据结构（${issues}），请重试`,
      'invalid-schema',
    )
  }

  return { reply: content, model: parsed.data }
}
