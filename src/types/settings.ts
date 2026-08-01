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

/** 应用全局设置 */
export interface AppSettings {
  apiKeys: ApiKeyEntry[]
  activeKeyId: string | null
  /** 全局默认 Base URL，可覆盖单条 Key 的空值 */
  defaultBaseUrl: string
  colorMode: ColorMode
  wireframe: {
    enabled: boolean
    lineWidth: number
  }
}
