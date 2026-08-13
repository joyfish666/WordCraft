import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createId } from '../lib/id'
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
}

const STORAGE_KEY = 'wordcraft.settings'

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
      language: 'zh',

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
      setLanguage: (lang) => set({ language: lang }),
    }),
    {
      name: STORAGE_KEY,
      version: 5,
      // v2 起默认关闭线框；v3 起新增语言字段（旧数据缺省为中文）；
      // v4 起新增屋顶/阴影开关；v5 起移除屋顶渲染（一层户型被檐口遮挡内部），
      // 旧存档里的 roof 字段一并剔除，避免残留进状态
      migrate: (persistedState) => {
        const persisted = persistedState as AppSettings & { roof?: boolean }
        const { roof, ...rest } = persisted
        void roof
        return {
          ...rest,
          wireframe: { enabled: false, lineWidth: 1 },
          language: rest.language ?? 'zh',
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
