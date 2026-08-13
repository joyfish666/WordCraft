import { t } from '../i18n'
import { logDebug } from './debugLog'
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
  /** o1 等部分模型不接受 max_tokens，连通性检测时降级重试用 */
  max_completion_tokens?: number
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

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_TEST_MODEL = 'deepseek-v4-flash'

/** 连通性检测请求的超时（毫秒） */
const CONNECTION_TIMEOUT_MS = 15_000

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
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  ) {
    return t('error.timeout')
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * 从 HTTP 错误信息中提取可读描述（fetch 路径统一使用）：
 * 优先服务商返回的 error.message，其次是 HTTP 状态码，最后回退到网络层错误原文。
 * @param error 网络层错误（fetch 抛出的原始错误）
 * @param status HTTP 状态码（有响应时传入，无响应为 null）
 * @param bodyText 响应体文本（可解析出服务商错误信息）
 */
export function describeHttpError(
  error: unknown,
  status: number | null = null,
  bodyText: string | null = null,
): string {
  if (bodyText) {
    const detail = extractErrorMessage(bodyText)
    if (detail) return status !== null ? t('error.httpStatus', { status, detail }) : detail
  }
  if (status !== null) return t('error.httpNoDetail', { status })
  if (error instanceof Error && error.message) return t('error.network', { detail: error.message })
  return t('error.networkFallback')
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
    throw new Error(t('error.requestFailed', { detail: describeNetworkError(error) }))
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const detail = extractErrorMessage(text)
    throw new Error(
      detail
        ? t('error.httpStatus', { status: response.status, detail })
        : t('error.httpNoDetail', { status: response.status }),
    )
  }
  if (!response.body) {
    throw new Error(t('error.noStream'))
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
      throw new Error(t('error.streamInterrupted', { detail: describeNetworkError(error) }))
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
 * 检测 API Key 连通性：发起一次极小的 chat/completions 请求。
 * 对常见的 401/403/404 等错误给出可读提示。
 * 部分模型（如 o1 系列）不认 max_tokens（HTTP 400），此时降级为 max_completion_tokens 重试一次。
 */
export async function testConnection(options: ApiClientOptions): Promise<ConnectionTestResult> {
  logDebug('连通性检测发起', {
    baseUrl: options.baseUrl ?? '(默认)',
    model: options.model ?? '(默认)',
    keySuffix: options.apiKey.slice(-4),
  })
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${options.apiKey}`,
  }
  const ping = async (tokenField: 'max_tokens' | 'max_completion_tokens'): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS)
    try {
      return await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: options.model ?? DEFAULT_TEST_MODEL,
          messages: [{ role: 'user', content: 'ping' }],
          [tokenField]: 1,
        } satisfies ChatCompletionRequest),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    let response = await ping('max_tokens')
    // 部分模型拒绝 max_tokens 参数（HTTP 400），降级为 max_completion_tokens 重试一次
    if (response.status === 400) {
      response = await ping('max_completion_tokens')
    }
    const bodyText = await response.text().catch(() => '')
    if (!response.ok) {
      let message: string
      if (response.status === 401 || response.status === 403) message = t('error.authFailed')
      else if (response.status === 404) message = t('error.modelMissing')
      else
        message = t('error.requestFailed', {
          detail: describeHttpError(new Error(), response.status, bodyText),
        })
      logDebug('连通性检测失败', message, 'error')
      return { ok: false, message }
    }
    let modelName: string | undefined
    try {
      modelName = (JSON.parse(bodyText) as { model?: string }).model
    } catch {
      // 空 body 或非 JSON 响应不解析模型名
    }
    logDebug('连通性检测成功', { model: modelName }, 'info')
    return {
      ok: true,
      message: t('error.connected', { model: modelName ?? t('error.unknownModel') }),
    }
  } catch (error) {
    const message = t('error.requestFailed', { detail: describeNetworkError(error) })
    logDebug('连通性检测失败', message, 'error')
    return { ok: false, message }
  }
}
