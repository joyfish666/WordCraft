import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatMessage } from '../lib/api'
import { createId } from '../lib/id'
import { migrateModel } from '../lib/migration'
import type { SceneModel } from '../types/model'

export type ChatRole = 'user' | 'assistant' | 'error'

export interface ChatMessageItem {
  id: string
  role: ChatRole
  content: string
  /** 助手消息可携带已生成的模型 */
  model?: SceneModel | null
  createdAt: number
}

interface ChatState {
  messages: ChatMessageItem[]
  isGenerating: boolean
  /** 各次生成成功前的场景快照（会话内，不持久化），用于「撤销生成」回到生成前的场景 */
  generationStack: SceneModel[]
  /** 追加消息，返回消息 id */
  addMessage: (input: Omit<ChatMessageItem, 'id' | 'createdAt'>) => string
  clearConversation: () => void
  setIsGenerating: (value: boolean) => void
  /** 生成成功前记录当前场景（上限 20 步） */
  pushGenerationHistory: (scene: SceneModel) => void
  /** 撤销最近一次生成：弹出快照并移除对话最后一条 user+assistant 对，返回需恢复的场景；无历史返回 null */
  undoLastGeneration: () => SceneModel | null
  clearGenerationHistory: () => void
}

const STORAGE_KEY = 'wordcraft.chat'

/** 生成历史栈上限：防止无界内存占用 */
const GENERATION_HISTORY_LIMIT = 20

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      isGenerating: false,
      generationStack: [],

      addMessage: (input) => {
        const id = createId()
        const item: ChatMessageItem = { ...input, id, createdAt: Date.now() }
        set((state) => ({ messages: [...state.messages, item] }))
        return id
      },

      clearConversation: () => set({ messages: [], generationStack: [] }),
      setIsGenerating: (value) => set({ isGenerating: value }),

      pushGenerationHistory: (scene) =>
        set((state) => ({
          generationStack: [...state.generationStack, scene].slice(-GENERATION_HISTORY_LIMIT),
        })),

      undoLastGeneration: () => {
        let restored: SceneModel | null = null
        set((state) => {
          if (state.generationStack.length === 0) return state
          // 仅当最后一条是"携带模型的助手消息"时才允许撤销（连同其前一条用户消息一起移除）
          const last = state.messages[state.messages.length - 1]
          if (!last || last.role !== 'assistant' || !last.model) return state
          restored = state.generationStack[state.generationStack.length - 1]
          return {
            generationStack: state.generationStack.slice(0, -1),
            messages: state.messages.slice(0, -2),
          }
        })
        return restored
      },

      clearGenerationHistory: () => set({ generationStack: [] }),
    }),
    {
      name: STORAGE_KEY,
      // 仅持久化对话记录；生成状态与历史栈均无需保存
      partialize: (state) => ({ messages: state.messages }),
      // v3 数据模型：旧持久化消息携带的 v1 模型读取时迁移
      version: 2,
      migrate: (persisted) => {
        const state = persisted as { messages?: { model?: unknown }[] }
        return {
          ...state,
          messages: (state.messages ?? []).map((m) =>
            m.model ? { ...m, model: migrateModel(m.model) } : m,
          ),
        }
      },
    },
  ),
)

/** 将对话记录转换为 API 所需的历史消息（跳过错误与空助手消息） */
export function toChatHistory(messages: ChatMessageItem[]): ChatMessage[] {
  return messages
    .filter(
      (m): m is ChatMessageItem & { role: 'user' | 'assistant' } =>
        (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0,
    )
    .map((m) => ({ role: m.role, content: m.content }))
}
