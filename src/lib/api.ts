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

/** 生成请求的瞬态失败重试次数（仅连接建立前失败/429/5xx，流中段不重试） */
const MAX_STREAM_RETRIES = 1
/** 重试退避（毫秒），第 n 次 = 基数 × 2^n */
const STREAM_RETRY_BACKOFF_MS = 800

/** 带 HTTP 状态码的流式错误（用于区分可重试的 429/5xx 与其余错误） */
class StreamHttpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** 用户中止/超时中止产生的错误：不可重试，提示「请求超时」（与 describeNetworkError 口径一致） */
class StreamAbortedError extends Error {
  constructor() {
    super(t('error.timeout'))
  }
}

/**
 * 流读取中途中断（响应头已收到、body 读取失败）：**不可重试**——
 * 服务端可能已生成大部分内容（token 已计费），重试等于把同一请求再计一次费，
 * 且用户会先看到一段流式内容、随后被整段替换。与"连接建立前失败"必须区分开。
 */
class StreamInterruptedError extends Error {
  constructor(message: string) {
    super(message)
  }
}

/** 判断是否值得重试：仅「连接建立前失败」与 429/5xx；流已开始后的中断一律不重试 */
function isRetryableStreamError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false
  if (error instanceof StreamAbortedError) return false
  if (error instanceof StreamInterruptedError) return false
  if (error instanceof StreamHttpError) return error.status === 429 || error.status >= 500
  return true
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 以流式方式调用 chat/completions（SSE），逐段返回增量内容。
 * 适合推理型模型（如 DeepSeek v4 系列）：流式连接保持活跃，
 * 避免模型长时间思考导致非流式请求被连接超时/网络中断。
 * 瞬态失败（连接失败/429/5xx）自动重试一次（退避 800ms）；流中途中断不重试（避免重复计费）。
 * @returns 累积的完整回复文本
 */
export async function streamChatCompletion(
  options: ApiClientOptions,
  messages: ChatMessage[],
  onChunk?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
    try {
      return await streamChatAttempt(options, messages, onChunk, signal)
    } catch (error) {
      if (!isRetryableStreamError(error, signal)) throw error
      lastError = error
      await delay(STREAM_RETRY_BACKOFF_MS * 2 ** attempt)
    }
  }
  throw lastError
}

async function streamChatAttempt(
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
    // 中止（用户取消/兜底超时）不可重试：以专用错误透出「请求超时」，避免被自动重试
    if (
      signal?.aborted ||
      (typeof DOMException !== 'undefined' &&
        error instanceof DOMException &&
        error.name === 'AbortError')
    ) {
      throw new StreamAbortedError()
    }
    throw new Error(t('error.requestFailed', { detail: describeNetworkError(error) }))
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const detail = extractErrorMessage(text)
    throw new StreamHttpError(
      detail
        ? t('error.httpStatus', { status: response.status, detail })
        : t('error.httpNoDetail', { status: response.status }),
      response.status,
    )
  }
  if (!response.body) {
    throw new Error(t('error.noStream'))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  // 处理单行 SSE 数据；@param line 不含换行符
  const handleLine = (line: string): void => {
    const data = line.trim()
    if (!data.startsWith('data:')) return
    const payloadLine = data.slice(5).trim()
    if (payloadLine === '[DONE]') throw DONE_SENTINEL
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

  // 解析 SSE：data: {...} 行，以 data: [DONE] 结束
  while (true) {
    let chunk
    try {
      chunk = await reader.read()
    } catch (error) {
      // 流中途中断：内容可能已计费，绝不自动重试（isRetryableStreamError 拒绝 StreamInterruptedError）
      throw new StreamInterruptedError(
        t('error.streamInterrupted', { detail: describeNetworkError(error) }),
      )
    }
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      try {
        handleLine(line)
      } catch (sentinel) {
        if (sentinel === DONE_SENTINEL) return full
        throw sentinel
      }
    }
  }
  // 冲刷尾部：流结束未换行的残留字节（stream:true 模式下 UTF-8 尾字节可能暂存于解码器，
  // 不冲刷会丢最后一个字符——中文回复常见）
  if (buffer) {
    buffer += decoder.decode()
    for (const line of buffer.split('\n')) {
      try {
        handleLine(line)
      } catch (sentinel) {
        if (sentinel === DONE_SENTINEL) return full
        throw sentinel
      }
    }
  }
  return full
}

/** [DONE] 哨兵（用对象作异常避免与真实错误混淆） */
const DONE_SENTINEL = Symbol('sse-done')

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
