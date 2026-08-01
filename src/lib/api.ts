import axios from 'axios'

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
      const detail = error.response?.data?.error?.message
      return {
        ok: false,
        message: detail ? `请求失败：${detail}` : `请求失败（HTTP ${status ?? '未知'}）`,
      }
    }
    return { ok: false, message: `网络错误：${error instanceof Error ? error.message : String(error)}` }
  }
}
