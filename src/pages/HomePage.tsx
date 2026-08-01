import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SceneViewer } from '../components/viewport/SceneViewer'
import { Button } from '../components/ui/Button'
import { ChatGenerationError, generateModelFromChat } from '../lib/chat'
import { countNodes, getPathToNode, isContainer } from '../lib/modelTree'
import { createSampleModel } from '../lib/sampleModel'
import { toChatHistory, useChatStore, type ChatMessageItem } from '../store/useChatStore'
import { useModelStore } from '../store/useModelStore'
import { getActiveApiConfig, useSettingsStore } from '../store/useSettingsStore'

/** 助手消息的展示文本：携带模型时显示摘要，否则显示回复（跳过纯 JSON） */
function assistantDisplay(m: ChatMessageItem): string {
  if (m.model) {
    return `已生成「${m.model.root.name}」模型，共 ${countNodes(m.model.root)} 个模块。可点击模块查看尺寸，或继续对话调整细节。`
  }
  const content = m.content.trim()
  if (content && !content.startsWith('{')) return content
  return ''
}

export function HomePage() {
  const scene = useModelStore((s) => s.scene)
  const selectedId = useModelStore((s) => s.selectedId)
  const setScene = useModelStore((s) => s.setScene)
  const resetScene = useModelStore((s) => s.resetScene)
  const selectNode = useModelStore((s) => s.selectNode)

  const messages = useChatStore((s) => s.messages)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const addMessage = useChatStore((s) => s.addMessage)
  const clearConversation = useChatStore((s) => s.clearConversation)
  const setIsGenerating = useChatStore((s) => s.setIsGenerating)
  const hasApiKey = useSettingsStore((s) => s.activeKeyId != null)

  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(() => {
    if (!scene || !selectedId) return null
    const path = getPathToNode(scene.root, selectedId)
    return path[path.length - 1] ?? null
  }, [scene, selectedId])

  const crumbs = useMemo(
    () => (scene && selectedId ? getPathToNode(scene.root, selectedId) : []),
    [scene, selectedId],
  )

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

  const send = async () => {
    const input = draft.trim()
    if (!input || isGenerating) return
    const config = getActiveApiConfig(useSettingsStore.getState())
    setDraft('')
    if (!config) {
      addMessage({ role: 'error', content: '尚未配置 API Key，请先前往设置页配置后再试。' })
      return
    }
    // 先快照历史，避免把即将新增的用户消息重复发送
    const history = toChatHistory(useChatStore.getState().messages)
    addMessage({ role: 'user', content: input })
    setIsGenerating(true)
    try {
      const { reply, model } = await generateModelFromChat({
        apiKey: config.key,
        baseUrl: config.baseUrl,
        model: config.model,
        history,
        userInput: input,
      })
      addMessage({ role: 'assistant', content: reply, model })
      setScene(model)
    } catch (error) {
      addMessage({
        role: 'error',
        content: error instanceof ChatGenerationError ? error.message : '生成失败，请重试',
      })
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="home">
      <header className="home__toolbar">
        <div className="home__toolbar-left">
          <Button variant="ghost" onClick={() => setScene(createSampleModel())}>
            加载示例
          </Button>
          <Button variant="ghost" onClick={resetScene} disabled={!scene}>
            清空场景
          </Button>
        </div>
        <div className="home__toolbar-right">
          {hasApiKey ? (
            <span className="badge badge--ok">API Key 已配置</span>
          ) : (
            <Link to="/settings" className="badge badge--warn">
              未配置 API Key · 前往设置
            </Link>
          )}
        </div>
      </header>

      <div className="home__body">
        <section className="panel home__chat">
          <div className="home__chat-header">
            <h2 className="panel__title">对话生成</h2>
            <Button variant="ghost" onClick={clearConversation} disabled={messages.length === 0}>
              清空对话
            </Button>
          </div>
          <div className="chat-log" ref={logRef}>
            {messages.length === 0 && !isGenerating ? (
              <p className="chat-log__hint">
                在下方输入需求开始生成 3D 模型，支持多轮对话逐步完善细节。
              </p>
            ) : (
              <ul className="chat-log__list">
                {messages.map((m) => (
                  <li key={m.id} className={`chat-msg chat-msg--${m.role}`}>
                    <span className="chat-msg__label">
                      {m.role === 'user' ? '我' : m.role === 'assistant' ? '言筑' : '错误'}
                    </span>
                    <div className="chat-msg__body">
                      {m.role === 'assistant' ? assistantDisplay(m) : m.content}
                    </div>
                  </li>
                ))}
                {isGenerating && (
                  <li className="chat-msg chat-msg--assistant">
                    <span className="chat-msg__label">言筑</span>
                    <div className="chat-msg__body">生成中…</div>
                  </li>
                )}
              </ul>
            )}
          </div>
          <div className="chat-input">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder="例如：帮我设计一个 3×3 米的卧室，放一张双人床…"
              rows={3}
            />
            <Button onClick={() => void send()} disabled={!draft.trim() || isGenerating}>
              {isGenerating ? '生成中…' : '生成模型'}
            </Button>
          </div>
        </section>

        <section className="panel home__viewport">
          <SceneViewer />
        </section>
      </div>

      <footer className="home__statusbar">
        {crumbs.length > 0 && (
          <nav className="breadcrumb">
            {crumbs.map((node, i) => (
              <span key={node.id}>
                {i > 0 && <span className="breadcrumb__sep">/</span>}
                <button className="breadcrumb__link" onClick={() => selectNode(node.id)}>
                  {node.name}
                </button>
              </span>
            ))}
          </nav>
        )}
        <span className="dim-info">
          {selected ? (
            <>
              已选：{selected.name} · 长 {selected.dimensions.length}m × 宽{' '}
              {selected.dimensions.width}m × 高 {selected.dimensions.height}m
              {isContainer(selected) ? ` · ${selected.children.length} 个子模块` : ''}
            </>
          ) : (
            '点击模型模块查看尺寸信息'
          )}
        </span>
      </footer>
    </div>
  )
}
