/** 单个 API Key 记录 */
export interface ApiKeyEntry {
  id: string
  /** 用户可读名称，如 "DeepSeek 主账号" */
  name: string
  key: string
  /** 自定义 Base URL（为空时使用全局默认） */
  baseUrl?: string
  createdAt: number
}

/** 视觉模式：标准 / 色盲 */
export type ColorMode = 'standard' | 'colorblind'

/** 深度思考模式：enabled=开启 / disabled=关闭（更快）/ default=跟随模型默认 */
export type ThinkingMode = 'enabled' | 'disabled' | 'default'

/** 应用全局设置 */
export interface AppSettings {
  apiKeys: ApiKeyEntry[]
  activeKeyId: string | null
  /** 全局默认 Base URL，可覆盖单条 Key 的空值 */
  defaultBaseUrl: string
  /** 全局默认模型名（如 DeepSeek 用 deepseek-chat） */
  defaultModel: string
  /** 深度思考模式（推理型模型如 DeepSeek v4 默认开启，关闭后响应更快） */
  thinking: ThinkingMode
  colorMode: ColorMode
  wireframe: {
    enabled: boolean
    lineWidth: number
  }
}
