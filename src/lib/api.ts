import axios from 'axios'
import type { ThinkingMode } from '../types/settings'

/** 聊天消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** OpenAI 兼容的 chat/completions 请求体 */
export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
}

/** API 客户端配置 */
export interface ApiClientOptions {
  apiKey: string
  /** 自定义 Base URL，为空使用默认值 */
  baseUrl?: string
  /** 连通性检测所用模型名 */
  model?: string
  /** 深度思考模式：为 'default' 时不传该字段（跟随服务商默认） */
  thinking?: ThinkingMode
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_TEST_MODEL = 'gpt-3.5-turbo'

/** 构建指向 OpenAI 兼容接口（OpenAI / DeepSeek / LocalAI 等）的 HTTP 客户端 */
export function createApiClient({ apiKey, baseUrl }: ApiClientOptions) {
  return axios.create({
    baseURL: (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    timeout: 30_000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  })
}

/** 从错误响应体中提取服务商返回的错误信息 */
function extractErrorMessage(text: string): string | null {
  try {
    const data = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    const message = data?.error?.message ?? data?.message
    return typeof message === 'string' && message.trim() ? message : null
  } catch {
    return text.trim() || null
  }
}

/** 描述 fetch 网络层错误（区分用户中止 / 超时 / 连接失败） */
function describeNetworkError(error: unknown): string {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
    return '请求超时，请检查网络或稍后重试'
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * 以流式方式调用 chat/completions（SSE），逐段返回增量内容。
 * 适合推理型模型（如 DeepSeek v4 系列）：流式连接保持活跃，
 * 避免模型长时间思考导致非流式请求被连接超时/网络中断。
 * @returns 累积的完整回复文本
 */
export async function streamChatCompletion(
  options: ApiClientOptions,
  messages: ChatMessage[],
  onChunk?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const payload = {
    model: options.model ?? DEFAULT_TEST_MODEL,
    messages,
    temperature: 0.2,
    stream: true,
    // 深度思考：仅在用户显式选择时透传（如 DeepSeek v4 的 thinking 参数）
    ...(options.thinking && options.thinking !== 'default'
      ? { thinking: { type: options.thinking } }
      : {}),
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    throw new Error(`请求失败：${describeNetworkError(error)}`)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const detail = extractErrorMessage(text)
    throw new Error(
      detail ? `HTTP ${response.status}：${detail}` : `HTTP ${response.status}，无详细错误信息`,
    )
  }
  if (!response.body) {
    throw new Error('网络错误：服务未返回数据流')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  // 解析 SSE：data: {...} 行，以 data: [DONE] 结束
  while (true) {
    let chunk
    try {
      chunk = await reader.read()
    } catch (error) {
      throw new Error(`网络错误：读取响应流中断（${describeNetworkError(error)}）`)
    }
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const data = line.trim()
      if (!data.startsWith('data:')) continue
      const payloadLine = data.slice(5).trim()
      if (payloadLine === '[DONE]') return full
      try {
        const json = JSON.parse(payloadLine) as {
          choices?: Array<{ delta?: { content?: string } }>
        }
        const delta = json.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta) {
          full += delta
          onChunk?.(delta)
        }
      } catch {
        // 忽略无法解析的 SSE 数据行
      }
    }
  }
  return full
}

/**
 * 从任意 axios 错误中提取可读描述：优先取服务商返回的 error.message，
 * 其次是 HTTP 状态码，最后回退到网络层错误原文（超时 / 连接失败等）。
 */
export function describeAxiosError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? null
    const data = error.response?.data as
      | { error?: { message?: unknown }; message?: unknown }
      | undefined
    const detail = data?.error?.message ?? data?.message
    if (typeof detail === 'string' && detail.trim()) {
      return status ? `HTTP ${status}：${detail}` : detail
    }
    if (status) return `HTTP ${status}，无详细错误信息`
    if (error.code === 'ECONNABORTED') return '请求超时，请检查网络或稍后重试'
    if (error.message) return `网络错误：${error.message}`
    return '网络错误，无法连接服务'
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * 检测 API Key 连通性：发起一次极小的 chat/completions 请求。
 * 对常见的 401/403/404 等错误给出可读提示。
 */
export async function testConnection(options: ApiClientOptions): Promise<ConnectionTestResult> {
  const client = createApiClient(options)
  try {
    const { data } = await client.post<{ model?: string }>('/chat/completions', {
      model: options.model ?? DEFAULT_TEST_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    } satisfies ChatCompletionRequest)
    return { ok: true, message: `连接成功：模型 ${data?.model ?? '未知'}` }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      if (status === 401 || status === 403) {
        return { ok: false, message: 'API Key 无效或无权限（401/403）' }
      }
      if (status === 404) {
        return { ok: false, message: 'API 可达，但模型不存在，请检查模型名与 Base URL' }
      }
      return { ok: false, message: `请求失败：${describeAxiosError(error)}` }
    }
    return { ok: false, message: describeAxiosError(error) }
  }
}
