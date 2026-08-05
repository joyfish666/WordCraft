import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { HelpDialog } from '../components/ui/HelpDialog'
import { Button } from '../components/ui/Button'
import { SceneViewer, type SceneViewerHandle } from '../components/viewport/SceneViewer'
import { ChatGenerationError, generateModelFromChat } from '../lib/chat'
import { clearDebug, useDebugEntries, type DebugEntry } from '../lib/debugLog'
import { countNodes, getPathToNode, isContainer } from '../lib/modelTree'
import { createSampleModel } from '../lib/sampleModel'
import { toChatHistory, useChatStore, type ChatMessageItem } from '../store/useChatStore'
import { useModelStore } from '../store/useModelStore'
import { getActiveApiConfig, useSettingsStore } from '../store/useSettingsStore'
import type { ModelNode } from '../types/model'

/** 方向键平移视角的位移量（屏幕像素等效） */
const PAN_STEP = 15

/** 将调试日志导出为可复制的纯文本 */
function copyDebug(entries: DebugEntry[]): void {
  const text = entries
    .map((e) => `[${e.time}] [${e.level}] ${e.message}${e.detail ? `\n${e.detail}` : ''}`)
    .join('\n')
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => {})
  }
}

/** 助手消息的展示文本：携带模型时显示摘要，否则显示回复（跳过纯 JSON） */
function assistantDisplay(m: ChatMessageItem): string {
  if (m.model) {
    return `已生成「${m.model.root.name}」模型，共 ${countNodes(m.model.root)} 个模块。可点击模块查看尺寸，或用方向键移动视角。`
  }
  const content = m.content.trim()
  if (content && !content.startsWith('{')) return content
  return ''
}

export function HomePage() {
  const scene = useModelStore((s) => s.scene)
  const selectedId = useModelStore((s) => s.selectedId)
  const focusId = useModelStore((s) => s.focusId)
  const setScene = useModelStore((s) => s.setScene)
  const resetScene = useModelStore((s) => s.resetScene)
  const selectNode = useModelStore((s) => s.selectNode)
  const setFocus = useModelStore((s) => s.setFocus)

  const messages = useChatStore((s) => s.messages)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const addMessage = useChatStore((s) => s.addMessage)
  const clearConversation = useChatStore((s) => s.clearConversation)
  const setIsGenerating = useChatStore((s) => s.setIsGenerating)
  const hasApiKey = useSettingsStore((s) => s.activeKeyId != null)
  const debugMode = useSettingsStore((s) => s.debugMode)
  const debugEntries = useDebugEntries()

  const [draft, setDraft] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)
  const debugRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<SceneViewerHandle>(null)

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

  // 生成计时：避免长时间等待时误以为界面卡死
  useEffect(() => {
    if (!isGenerating) {
      setElapsed(0)
      return
    }
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(timer)
  }, [isGenerating])

  // 调试日志自动滚动到底部
  useEffect(() => {
    const el = debugRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [debugEntries])

  // 键盘平移视角：方向键 + WASD（不干扰输入框/文本框）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return
      const controls = viewportRef.current
      if (!controls) return
      let dx = 0
      let dy = 0
      switch (e.key.toLowerCase()) {
        case 'arrowleft':
        case 'a':
          dx = -PAN_STEP
          break
        case 'arrowright':
        case 'd':
          dx = PAN_STEP
          break
        case 'arrowup':
        case 'w':
          dy = PAN_STEP
          break
        case 'arrowdown':
        case 's':
          dy = -PAN_STEP
          break
        default:
          return
      }
      e.preventDefault()
      controls.pan(dx, dy)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
        thinking: config.thinking,
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

  const jumpToCrumb = (node: ModelNode) => {
    selectNode(node.id)
    if (node.type === 'house') setFocus(null)
    else if (node.type === 'room') setFocus(node.id)
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
          <Button variant="ghost" onClick={() => setHelpOpen(true)}>
            操作说明
          </Button>
        </div>
        <div className="home__toolbar-right">
          {focusId && (
            <Button
              variant="ghost"
              onClick={() => {
                setFocus(null)
                selectNode(null)
              }}
            >
              返回整屋
            </Button>
          )}
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
                    <div className="chat-msg__body">正在生成模型…（已 {elapsed} 秒）</div>
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
              {isGenerating ? `生成中…（已 ${elapsed}s）` : '生成模型'}
            </Button>
          </div>
        </section>

        <section className="panel home__viewport">
          <SceneViewer ref={viewportRef} />
        </section>
      </div>

      {debugMode && (
        <section className="debug-panel">
          <div className="debug-panel__header">
            <button className="debug-panel__toggle" onClick={() => setDebugOpen((o) => !o)}>
              {debugOpen ? '▾' : '▸'} 调试日志
            </button>
            <span className="debug-panel__count">{debugEntries.length} 条</span>
            <div className="debug-panel__actions">
              <Button
                variant="ghost"
                onClick={() => copyDebug(debugEntries)}
                disabled={debugEntries.length === 0}
              >
                复制
              </Button>
              <Button
                variant="ghost"
                onClick={clearDebug}
                disabled={debugEntries.length === 0}
              >
                清空
              </Button>
            </div>
          </div>
          {debugOpen && (
            <div className="debug-panel__body" ref={debugRef}>
              {debugEntries.length === 0 ? (
                <p className="debug-panel__empty">
                  暂无日志（调试模式已开启，生成模型或检测连通性时会记录）
                </p>
              ) : (
                debugEntries.map((e) => (
                  <div key={e.id} className={`debug-entry debug-entry--${e.level}`}>
                    <span className="debug-entry__time">{e.time}</span>
                    <span className="debug-entry__msg">{e.message}</span>
                    {e.detail && <pre className="debug-entry__detail">{e.detail}</pre>}
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      )}

      <footer className="home__statusbar">
        {crumbs.length > 0 && (
          <nav className="breadcrumb">
            {crumbs.map((node, i) => (
              <span key={node.id}>
                {i > 0 && <span className="breadcrumb__sep">/</span>}
                <button className="breadcrumb__link" onClick={() => jumpToCrumb(node)}>
                  {node.name}
                </button>
              </span>
            ))}
          </nav>
        )}

        <div className="move-controls">
          <span className="move-controls__title">视角</span>
          <Button
            variant="ghost"
            className="move-controls__btn"
            title="视角左移 (←)"
            onClick={() => viewportRef.current?.pan(-PAN_STEP, 0)}
          >
            ◀
          </Button>
          <Button
            variant="ghost"
            className="move-controls__btn"
            title="视角右移 (→)"
            onClick={() => viewportRef.current?.pan(PAN_STEP, 0)}
          >
            ▶
          </Button>
          <Button
            variant="ghost"
            className="move-controls__btn"
            title="视角上移 (↑)"
            onClick={() => viewportRef.current?.pan(0, PAN_STEP)}
          >
            ▲
          </Button>
          <Button
            variant="ghost"
            className="move-controls__btn"
            title="视角下移 (↓)"
            onClick={() => viewportRef.current?.pan(0, -PAN_STEP)}
          >
            ▼
          </Button>
          <Button variant="ghost" onClick={() => viewportRef.current?.resetView()}>
            复位视角
          </Button>
        </div>

        <span className="dim-info">
          {selected ? (
            <>
              已选：{selected.name} · 长 {selected.dimensions.length}m × 宽{' '}
              {selected.dimensions.width}m × 高 {selected.dimensions.height}m
              {isContainer(selected) ? ` · ${selected.children.length} 个子模块` : ''}
            </>
          ) : focusId ? (
            '已进入房间聚焦视图'
          ) : (
            '点击模型模块查看尺寸信息'
          )}
        </span>
      </footer>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
