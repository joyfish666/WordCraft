import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createId } from '../lib/id'
import { safeLocalStorage } from '../lib/safeStorage'
import type { ApiKeyEntry, AppSettings, ColorMode, Language, ThinkingMode } from '../types/settings'

interface SettingsState extends AppSettings {
  /** 新增 API Key，返回新 Key 的 id */
  addApiKey: (entry: Omit<ApiKeyEntry, 'id' | 'createdAt'>) => string
  removeApiKey: (id: string) => void
  setActiveKey: (id: string | null) => void
  setDefaultBaseUrl: (url: string) => void
  setDefaultModel: (model: string) => void
  setThinking: (mode: ThinkingMode) => void
  setColorMode: (mode: ColorMode) => void
  toggleWireframe: () => void
  setWireframeLineWidth: (width: number) => void
  setShadows: (value: boolean) => void
  setDebugMode: (value: boolean) => void
  setLanguage: (lang: Language) => void
  /** 跟随系统语言更新：设置语言但不改变 languageFollowsSystem（系统语言变化事件用） */
  syncSystemLanguage: (lang: Language) => void
}

const STORAGE_KEY = 'wordcraft.settings'

/**
 * 系统语言检测：首选项以 zh 开头（zh-CN/zh-TW/zh-Hans…）→ 中文，其余 → 英文。
 * 仅用于「未手动切换语言」时的默认值/跟随系统更新。
 */
export function detectSystemLanguage(): Language {
  if (typeof navigator === 'undefined') return 'zh'
  const lang = (navigator.language || navigator.languages?.[0] || '').toLowerCase()
  return lang.startsWith('zh') ? 'zh' : 'en'
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiKeys: [],
      activeKeyId: null,
      defaultBaseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
      thinking: 'disabled',
      colorMode: 'standard',
      // 默认实体色块渲染（关闭线框），家具/房间呈现为有遮挡关系的实心方块
      wireframe: { enabled: false, lineWidth: 1 },
      // 实时阴影默认开启（低端设备可关）
      shadows: true,
      debugMode: false,
      // 默认跟随系统语言（用户手动切换后 languageFollowsSystem 置 false）
      language: detectSystemLanguage(),
      languageFollowsSystem: true,

      addApiKey: (entry) => {
        const id = createId()
        const newEntry: ApiKeyEntry = { ...entry, id, createdAt: Date.now() }
        set((state) => ({
          apiKeys: [...state.apiKeys, newEntry],
          // 首次添加时自动设为激活 Key
          activeKeyId: state.activeKeyId ?? id,
        }))
        return id
      },

      removeApiKey: (id) =>
        set((state) => {
          const apiKeys = state.apiKeys.filter((k) => k.id !== id)
          const activeKeyId =
            state.activeKeyId === id ? (apiKeys[0]?.id ?? null) : state.activeKeyId
          return { apiKeys, activeKeyId }
        }),

      setActiveKey: (id) => set({ activeKeyId: id }),
      setDefaultBaseUrl: (url) => set({ defaultBaseUrl: url }),
      setDefaultModel: (model) => set({ defaultModel: model }),
      setThinking: (mode) => set({ thinking: mode }),
      setColorMode: (mode) => set({ colorMode: mode }),

      toggleWireframe: () =>
        set((state) => ({ wireframe: { ...state.wireframe, enabled: !state.wireframe.enabled } })),

      setWireframeLineWidth: (width) =>
        set((state) => ({ wireframe: { ...state.wireframe, lineWidth: width } })),

      setShadows: (value) => set({ shadows: value }),

      setDebugMode: (value) => set({ debugMode: value }),
      setLanguage: (lang) => set({ language: lang, languageFollowsSystem: false }),
      syncSystemLanguage: (lang) => set({ language: lang }),
    }),
    {
      name: STORAGE_KEY,
      // 写入失败（配额/隐私模式）降级为静默跳过，不打断编辑（safeStorage.ts）
      storage: createJSONStorage(() => safeLocalStorage),
      version: 5,
      // v2 起默认关闭线框；v3 起新增语言字段（旧数据缺省跟随系统语言）；
      // v4 起新增屋顶/阴影开关；v5 起移除屋顶渲染（一层户型被檐口遮挡内部），
      // 旧存档里的 roof 字段一并剔除，避免残留进状态
      migrate: (persistedState) => {
        const persisted = persistedState as AppSettings & { roof?: boolean }
        const { roof, ...rest } = persisted
        void roof
        // 旧存档显式写过 language（本功能之前的版本都会持久化 language）→ 视为用户手动选择，
        // 不再跟随系统；从未写过 language 的存档 → 跟随系统语言
        const hasManualLanguage = Object.prototype.hasOwnProperty.call(persistedState, 'language')
        return {
          ...rest,
          wireframe: { enabled: false, lineWidth: 1 },
          language: rest.language ?? detectSystemLanguage(),
          languageFollowsSystem: rest.languageFollowsSystem ?? !hasManualLanguage,
          shadows: rest.shadows ?? true,
        }
      },
    },
  ),
)

/** 当前激活 API Key 的完整配置；无激活 Key 时返回 null */
export function getActiveApiConfig(
  state: Pick<
    SettingsState,
    'apiKeys' | 'activeKeyId' | 'defaultBaseUrl' | 'defaultModel' | 'thinking'
  >,
): { key: string; baseUrl: string; model: string; thinking: ThinkingMode } | null {
  const active = state.apiKeys.find((k) => k.id === state.activeKeyId)
  if (!active) return null
  return {
    key: active.key,
    baseUrl: active.baseUrl ?? state.defaultBaseUrl,
    model: state.defaultModel,
    thinking: state.thinking,
  }
}
