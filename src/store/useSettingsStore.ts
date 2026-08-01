import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ApiKeyEntry, AppSettings, ColorMode } from '../types/settings'

interface SettingsState extends AppSettings {
  /** 新增 API Key，返回新 Key 的 id */
  addApiKey: (entry: Omit<ApiKeyEntry, 'id' | 'createdAt'>) => string
  removeApiKey: (id: string) => void
  setActiveKey: (id: string | null) => void
  setDefaultBaseUrl: (url: string) => void
  setColorMode: (mode: ColorMode) => void
  toggleWireframe: () => void
  setWireframeLineWidth: (width: number) => void
}

const STORAGE_KEY = 'wordcraft.settings'

/** 生成唯一 id，兼容无 crypto.randomUUID 的运行环境 */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `key-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiKeys: [],
      activeKeyId: null,
      defaultBaseUrl: '',
      colorMode: 'standard',
      wireframe: { enabled: true, lineWidth: 1 },

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
          const activeKeyId = state.activeKeyId === id ? (apiKeys[0]?.id ?? null) : state.activeKeyId
          return { apiKeys, activeKeyId }
        }),

      setActiveKey: (id) => set({ activeKeyId: id }),
      setDefaultBaseUrl: (url) => set({ defaultBaseUrl: url }),
      setColorMode: (mode) => set({ colorMode: mode }),

      toggleWireframe: () =>
        set((state) => ({ wireframe: { ...state.wireframe, enabled: !state.wireframe.enabled } })),

      setWireframeLineWidth: (width) =>
        set((state) => ({ wireframe: { ...state.wireframe, lineWidth: width } })),
    }),
    { name: STORAGE_KEY },
  ),
)

/** 当前激活 API Key 的完整配置；无激活 Key 时返回 null */
export function getActiveApiConfig(
  state: Pick<SettingsState, 'apiKeys' | 'activeKeyId' | 'defaultBaseUrl'>,
): { key: string; baseUrl: string } | null {
  const active = state.apiKeys.find((k) => k.id === state.activeKeyId)
  if (!active) return null
  return { key: active.key, baseUrl: active.baseUrl ?? state.defaultBaseUrl }
}
