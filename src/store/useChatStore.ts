import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ChatMessage } from '../lib/api'
import { createId } from '../lib/id'
import { safeLocalStorage } from '../lib/safeStorage'
import type { SceneModel } from '../types/model'
import type { Op } from '../types/ops'

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
  /**
   * 手动编辑操作日志（P3 双向同步，design.md §5.1）：
   * 每次手动编辑（属性面板/Gizmo/位移微调）生成一条与对话同构的 op 追加进来，
   * 随多轮上下文喂给 LLM。会话内不持久化，上限 50 条。
   */
  editOps: Op[]
  /** 追加消息，返回消息 id */
  addMessage: (input: Omit<ChatMessageItem, 'id' | 'createdAt'>) => string
  clearConversation: () => void
  setIsGenerating: (value: boolean) => void
  /** 生成成功前记录当前场景（上限 20 步） */
  pushGenerationHistory: (scene: SceneModel) => void
  /** 撤销最近一次生成：弹出快照并移除对话最后一条 user+assistant 对，返回需恢复的场景；无历史返回 null */
  undoLastGeneration: () => SceneModel | null
  clearGenerationHistory: () => void
  /** 追加手动编辑操作日志（上限 50 条，会话内不持久化） */
  pushEditOps: (ops: Op[]) => void
  /** 清空手动编辑操作日志 */
  clearEditOps: () => void
}

const STORAGE_KEY = 'wordcraft.chat'

/** 生成历史栈上限：防止无界内存占用 */
const GENERATION_HISTORY_LIMIT = 20

/** 手动编辑操作日志上限（P3 §5.1）：防止无界增长 */
const EDIT_OPS_LIMIT = 50

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      isGenerating: false,
      generationStack: [],
      editOps: [],

      addMessage: (input) => {
        const id = createId()
        const item: ChatMessageItem = { ...input, id, createdAt: Date.now() }
        set((state) => ({ messages: [...state.messages, item] }))
        return id
      },

      clearConversation: () => set({ messages: [], generationStack: [], editOps: [] }),
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
          restored = state.generationStack[state.generationStack.length - 1]!
          return {
            generationStack: state.generationStack.slice(0, -1),
            messages: state.messages.slice(0, -2),
          }
        })
        return restored
      },

      clearGenerationHistory: () => set({ generationStack: [] }),

      pushEditOps: (ops) =>
        set((state) => ({
          editOps: [...state.editOps, ...ops].slice(-EDIT_OPS_LIMIT),
        })),

      clearEditOps: () => set({ editOps: [] }),
    }),
    {
      name: STORAGE_KEY,
      // 写入失败（配额/隐私模式）降级为静默跳过，不打断对话（safeStorage.ts）
      storage: createJSONStorage(() => safeLocalStorage),
      // 仅持久化对话记录；生成状态与历史栈均无需保存。
      // ⚠️ 消息内嵌的 model（整场景快照）不落盘（2026-08-13 审查批次后续，坑 75 姊妹）：
      // 多轮对话每轮各带一份完整 SceneModel，持久化会以每次 addMessage 全量重序列化的代价
      // 快速逼近 localStorage 5MB 配额；model 仅供会话内「撤销生成」使用（generationStack
      // 已覆盖），刷新后由场景摘要 + 编辑日志替代，无需还原。
      partialize: (state) => ({
        messages: state.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        })),
      }),
      // v3 持久化格式：消息不再携带 model（v2 存档在迁移时一并剥离，避免继续写回）
      version: 3,
      migrate: (persisted) => {
        const state = persisted as { messages?: ChatMessageItem[] }
        return {
          ...state,
          messages: (state.messages ?? []).map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          })),
        }
      },
    },
  ),
)

/**
 * 将对话记录转换为 API 所需的历史消息（跳过错误与空助手消息）。
 * P3 对话上下文改造（design.md §5.2）：助手消息中**纯 JSON 的 ops 原文**（整段状态快照）
 * 不再回传——当前状态由「场景摘要 + 手动编辑日志」完整表达，省 token（80%+）且手动编辑不丢失；
 * 用户消息与带文本的助手消息（如解释性回复）保留，多轮意图不断裂。
 */
export function toChatHistory(messages: ChatMessageItem[]): ChatMessage[] {
  return messages
    .filter((m): m is ChatMessageItem & { role: 'user' | 'assistant' } => {
      if (m.role !== 'user' && m.role !== 'assistant') return false
      const content = m.content.trim()
      if (content.length === 0) return false
      if (m.role === 'assistant' && content.startsWith('{')) return false // 上一轮 ops 原文 → 摘要替代
      return true
    })
    .map((m) => ({ role: m.role, content: m.content }))
}
