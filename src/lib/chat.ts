import type { AxiosError } from 'axios'
import { sceneModelSchema } from '../schemas/model.schema'
import type { SceneModel } from '../types/model'
import { createApiClient, type ApiClientOptions, type ChatMessage } from './api'

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
2. JSON 层级结构（整屋 → 房间 → 家具）：
   - 根节点：{ "id": "唯一字符串", "type": "house", "name": "整屋名称", "dimensions": {"length": 数字, "width": 数字, "height": 数字}, "position": {"x": 0, "y": 0, "z": 0}, "children": [房间...] }
   - 房间节点：type 为 "room"，可包含 children（家具）。
   - 家具节点：type 为 "furniture"（墙体为 "wall"），不可包含 children。
   - 每个节点都包含 id（全局唯一，重新生成时必须保持已有节点 id 不变）、name、dimensions、position。
3. 坐标约定（单位：米）：
   - 整屋 position 恒为 (0,0,0)。
   - X 为长方向，Z 为宽方向，Y 为高方向，地面 y=0。
   - 所有 position 为世界绝对坐标；任意模块的 position.y 等于其 height 的一半（使底面贴地）。
   - 房间需完全位于整屋范围内，家具需完全位于其所属房间范围内，模块之间不要互相重叠。
4. 合理推断默认尺寸；用户未明确时可补充常见家具尺寸（如双人床约 2×1.5m、衣柜约 1.2×0.6m、沙发约 2×0.9m）。`
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

export interface GenerateResult {
  /** 模型原始回复 */
  reply: string
  /** 通过校验的层级模型 */
  model: SceneModel
}

/**
 * 调用大模型生成模型：系统提示 + 多轮历史 + 用户输入 → 校验 → 返回模型。
 * 发送前不进行有效性检测，由调用方确保已配置 API Key。
 */
export async function generateModelFromChat(
  options: ApiClientOptions & { history: ChatMessage[]; userInput: string },
): Promise<GenerateResult> {
  const { history, userInput, ...clientOptions } = options
  const client = createApiClient(clientOptions)

  let response
  try {
    response = await client.post('/chat/completions', {
      model: clientOptions.model ?? 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        ...history,
        { role: 'user', content: userInput },
      ],
      temperature: 0.2,
    })
  } catch (error) {
    const detail = (error as AxiosError<{ error?: { message?: string } }>).response?.data?.error
      ?.message
    throw new ChatGenerationError(
      detail ? `模型请求失败：${detail}` : '模型请求失败，请检查 API Key、Base URL 与网络',
      'http',
    )
  }

  const content: string = response?.data?.choices?.[0]?.message?.content ?? ''
  const json = extractModelJson(content)
  if (!json) {
    throw new ChatGenerationError('模型返回内容中未找到 JSON，请重试', 'no-json')
  }

  let parsed
  try {
    parsed = sceneModelSchema.safeParse(JSON.parse(json))
  } catch {
    throw new ChatGenerationError('模型返回的 JSON 无法解析，请重试', 'invalid-schema')
  }
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
