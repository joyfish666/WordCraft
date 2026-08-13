import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useT, type TKey } from '../../i18n'
import { countNodes } from '../../lib/modelTree'
import type { ChatMessageItem } from '../../store/useChatStore'
import { IconChevronUp } from './icons'

/** 助手消息的展示文本：携带模型时显示摘要，否则显示回复（跳过纯 JSON） */
function assistantDisplay(m: ChatMessageItem, t: ReturnType<typeof useT>): string {
  if (m.model) {
    return t('chat.generatedModel', { name: m.model.root.name, count: countNodes(m.model.root) })
  }
  const content = m.content.trim()
  if (content && !content.startsWith('{')) return content
  return ''
}

const ROLE_LABEL: Record<ChatMessageItem['role'], TKey> = {
  user: 'chat.roleMe',
  assistant: 'chat.roleAssistant',
  error: 'chat.roleError',
}

export interface ChatDrawerHandle {
  focusInput: () => void
}

export interface ChatDrawerProps {
  collapsed: boolean
  messages: ChatMessageItem[]
  isGenerating: boolean
  elapsed: number
  canUndoGeneration: boolean
  canClear: boolean
  hasApiKey: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onToggle: () => void
  onUndoGeneration: () => void
  onClearConversation: () => void
}

/** 底部聊天抽屉（push 布局）：折叠时仅剩输入条，展开时展示完整对话 */
export const ChatDrawer = forwardRef<ChatDrawerHandle, ChatDrawerProps>(function ChatDrawer(
  {
    collapsed,
    messages,
    isGenerating,
    elapsed,
    canUndoGeneration,
    canClear,
    hasApiKey,
    draft,
    onDraftChange,
    onSend,
    onToggle,
    onUndoGeneration,
    onClearConversation,
  },
  ref,
) {
  const t = useT()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
  }))

  // 消息/生成状态变化时自动滚动到底部
  useEffect(() => {
    const el = logRef.current
    if (el && typeof el.scrollTo === 'function') {
      try {
        el.scrollTo({ top: el.scrollHeight })
      } catch {
        // 部分环境（如 jsdom）不支持元素 scrollTo，静默忽略
      }
    }
  }, [messages, isGenerating])

  const canSend = draft.trim().length > 0 && !isGenerating

  return (
    <div className={`chat-bottom ${collapsed ? 'chat-bottom--collapsed' : ''}`}>
      <button
        type="button"
        className="chat-bottom__toggle"
        onClick={onToggle}
        title={collapsed ? t('home.chatExpandTitle') : t('home.chatCollapseTitle')}
        aria-expanded={!collapsed}
        aria-controls="chat-log"
      >
        <IconChevronUp />
      </button>

      <div
        className="chat-bottom__log"
        id="chat-log"
        role="log"
        aria-live="polite"
        aria-label={t('chat.ariaLog')}
        ref={logRef}
      >
        <div className="chat-bottom__log-inner">
          {messages.length === 0 && !isGenerating ? (
            <div className="chat-msg chat-msg--assistant">
              <span className="chat-msg__label">{t('chat.roleAssistant')}</span>
              <div className="chat-msg__body">{t('chat.hint')}</div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`chat-msg chat-msg--${m.role}`}>
                <span className="chat-msg__label">{t(ROLE_LABEL[m.role])}</span>
                <div className="chat-msg__body">
                  {m.role === 'assistant' ? assistantDisplay(m, t) : m.content}
                </div>
              </div>
            ))
          )}
          {isGenerating && (
            <div className="chat-msg chat-msg--assistant chat-msg--generating">
              <span className="chat-msg__label">{t('chat.roleAssistant')}</span>
              <div className="chat-msg__body">
                <span className="generating-dots">
                  <span />
                  <span />
                  <span />
                </span>
                {t('chat.generating', { elapsed })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="chat-bottom__actions">
        <button
          type="button"
          className="chat-bottom__action-btn"
          onClick={onUndoGeneration}
          disabled={!canUndoGeneration}
          title={t('chat.undoGenTitle')}
        >
          ↩ {t('chat.undoGen')}
        </button>
        <button
          type="button"
          className="chat-bottom__action-btn"
          onClick={onClearConversation}
          disabled={!canClear}
        >
          {t('chat.clear')}
        </button>
      </div>

      {!hasApiKey && (
        <div className="api-hint">
          <span>{t('chat.apiMissingHint')}</span>
        </div>
      )}

      <div className="chat-bottom__input">
        <textarea
          ref={inputRef}
          className="chat-bottom__textarea"
          rows={1}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.placeholder')}
        />
        <button type="button" className="chat-bottom__send" onClick={onSend} disabled={!canSend}>
          {isGenerating ? t('chat.generatingBtn', { elapsed }) : t('chat.generateBtn')}
        </button>
      </div>
    </div>
  )
})
