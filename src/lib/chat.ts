import { sceneModelV2Schema } from '../schemas/model.schema'
import { logDebug } from './debugLog'
import { resolveLayout } from './layout'
import type { SceneModel } from '../types/model'
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

/** 指导大模型输出 v2 语义契约（房间/布局意图，无绝对坐标）的系统提示词 */
export function buildSystemPrompt(): string {
  return `你是一个 3D 空间结构建模助手。用户会用自然语言描述空间、房屋、房间与家具的布局需求。
请输出一个表示完整 3D 模型的 JSON 对象，严格遵守以下规则：

1. 只输出一个 JSON 对象，不要任何解释文字，不要 markdown 代码块。一切以用户明确要求为主，用户未明确时才按常理推断，不擅自改变用户已指定的内容。
2. 结构（version: 2）：{"version": 2, "root": {"id":"house1","type":"house","name":"整屋名","dimensions":{"length":数字,"width":数字,"height":数字},"position":{"x":0,"y":0,"z":0},"layout":{...},"children":[房间...]}}
   - 房间：{"id":"唯一字符串","type":"room","name":"房间名","dimensions":{"length","width","height"},"side":"...","children":[家具或子房间...]}
   - 家具：{"id":"唯一字符串","type":"furniture"（墙体为"wall"）,"name","dimensions","position"}
   - 房间内可嵌套子房间（如卧室内的"主卧卫生间"，用户说"里面有卫生间"时用嵌套表达，系统会渲染在父房间内部）；未嵌套的房间为顶层房间。卫生间命名归属连通（X卫生间 → X）。
   - 每个节点 id 全局唯一，重新生成时保持已有节点 id 不变，但尺寸、side、children 顺序、布局等可按用户最新要求修改。
3. layout 模式（根据用户需求二选一）：
   - 常规住宅（多个房间、需要连通）→ {"mode":"auto","template":"corridor","corridor":{"width":1.2,"entranceRoomId":"客厅的房间id"}}
     · 走廊沿东西向（X 轴）贯穿，入口房间会自动置于走廊南侧（地图下方），并在其南墙生成入户大门。
     · 每个房间填 "side":"left"（走廊南侧/地图下方）或 "right"（北侧），房间不要填 position；children 的顺序即沿走廊从入户端向内的排列。
   - 客厅居中/厅堂式 → {"mode":"auto","template":"living","centerRoomId":"客厅id"}
     · 客厅之外的其他房间填 "side":"north"|"south"|"east"|"west"（相对客厅），children 顺序即该边上的先后。
   - 用户明确要求非常规/自由/特殊形状布局 → {"mode":"custom"}，此时每个房间必须填绝对 position（y 为房间高度的一半）。
4. 尺寸约定（单位：米）：length 为沿走廊/沿边的尺寸（东西向），width 为进深（南北向），height 为层高（默认 2.8）。相邻房间的墙应贴合（间隙为 0）。
5. 家具 position 相对所在房间中心：x/z 为相对中心偏移，y 为家具高度的一半（底面贴房间地面）。家具摆放应合理（如床靠墙、衣柜贴墙、桌椅避开通道、中间留活动空间），只以所在房间为框架考虑、无需考虑整屋布局；家具不得超出房间范围、不得嵌入墙体、不得堵住门洞。
6. 惯例与墙体：客厅/餐厅/厨房为开放空间，与走廊之间不设墙（开放连通）；卧室/书房/卫生间等保留墙体与门；卧室与卧室之间不直接开门（经走廊/卫生间连通）。房屋外墙由系统自动保留（除入户门外不与外部相通），入户大门自动生成在入口房间南侧外墙的居中合理位置。客厅较大且近入口（南侧），卧室/书房/卫生间等沿走廊两侧分布，卫生间/储物间较小靠边；单间房无需走廊。
7. 每个房间默认有门（系统自动生成门洞，无需输出）。
8. 合理推断默认尺寸；用户未明确时可补充常见家具尺寸（如双人床约 2×1.5m、衣柜约 1.2×0.6m、沙发约 2×0.9m）。
9. 多轮修改：这是多轮对话。最新一条用户消息是对上一个模型的修改要求（如"卫生间移到卧室北部""客厅再大一点"）。你必须基于上一个模型输出**修改后**的完整 JSON——体现最新要求，不能原样重复上一次的输出。修改相对位置时，请通过调整 side、children 顺序、尺寸等方式表达（例如把卫生间排到所属卧室之后、或调整其朝向），使布局引擎能体现变化。`
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
  /** 通过校验并解析为绝对坐标的模型 */
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
 * 调用大模型生成模型：系统提示 + 多轮历史 + 用户输入 → 流式接收 → v2 校验 → 布局解析。
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

  logDebug('发送请求', {
    model: clientOptions.model ?? '(默认)',
    baseUrl: clientOptions.baseUrl ?? '(默认)',
    messagesCount: messages.length,
    lastUser: userInput,
  })

  let content: string
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS)
  try {
    content = await streamChatCompletion(clientOptions, messages, onChunk, controller.signal)
  } catch (error) {
    logDebug('模型请求失败', error instanceof Error ? error.message : String(error), 'error')
    throw new ChatGenerationError(
      `模型请求失败：${error instanceof Error ? error.message : String(error)}。可在设置页点「检测连通性」定位问题。`,
      'http',
    )
  } finally {
    clearTimeout(timer)
  }

  logDebug('收到模型原始回复', content, 'info')

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

  // 原始回复本身就是纯净 JSON 时，解析结果与之相同——跳过重复的大段 JSON，避免日志翻倍
  if (json.trim() !== content.trim()) {
    logDebug('模型回复 JSON 解析结果', raw, 'info')
  }

  const parsed = sceneModelV2Schema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('；')
    logDebug('v2 结构校验失败', issues, 'error')
    throw new ChatGenerationError(
      `模型返回的 JSON 不符合 v2 数据结构（${issues}），请重试`,
      'invalid-schema',
    )
  }

  logDebug('v2 结构校验通过', {
    layout: parsed.data.root.layout,
    rooms: parsed.data.root.children.map((r) => ({ id: r.id, name: r.name, side: r.side, dims: r.dimensions })),
  })

  const model = resolveLayout(parsed.data)
  return { reply: content, model }
}
