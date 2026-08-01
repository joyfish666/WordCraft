import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatMessage } from '../lib/api'
import { createId } from '../lib/id'
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
  /** 追加消息，返回消息 id */
  addMessage: (input: Omit<ChatMessageItem, 'id' | 'createdAt'>) => string
  clearConversation: () => void
  setIsGenerating: (value: boolean) => void
}

const STORAGE_KEY = 'wordcraft.chat'

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      isGenerating: false,

      addMessage: (input) => {
        const id = createId()
        const item: ChatMessageItem = { ...input, id, createdAt: Date.now() }
        set((state) => ({ messages: [...state.messages, item] }))
        return id
      },

      clearConversation: () => set({ messages: [] }),
      setIsGenerating: (value) => set({ isGenerating: value }),
    }),
    {
      name: STORAGE_KEY,
      // 仅持久化对话记录；生成状态无需保存
      partialize: (state) => ({ messages: state.messages }),
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
