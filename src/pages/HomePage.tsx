import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { HelpDialog } from '../components/ui/HelpDialog'
import { Button } from '../components/ui/Button'
import { LanguageToggle } from '../components/ui/LanguageToggle'
import { ProjectLibraryDialog } from '../components/ui/ProjectLibraryDialog'
import { ShareDialog } from '../components/ui/ShareDialog'
import { PropertyPanel } from '../components/viewport/PropertyPanel'
import { SceneViewer, type SceneViewerHandle } from '../components/viewport/SceneViewer'
import { getProject, updateProject } from '../db/database'
import { useT } from '../i18n'
import { ChatGenerationError, generateModelFromChat } from '../lib/chat'
import { encodeShareCode } from '../lib/compression'
import { clearDebug, useDebugEntries, type DebugEntry } from '../lib/debugLog'
import { nodeDims, nodePosition } from '../lib/footprint'
import { migrateModel } from '../lib/migration'
import { countNodes, getPathToNode, isContainer } from '../lib/modelTree'
import { createSampleModel } from '../lib/sampleModel'
import { withWatermark } from '../lib/watermark'
import { toChatHistory, useChatStore, type ChatMessageItem } from '../store/useChatStore'
import { useModelStore, type PlanTool } from '../store/useModelStore'
import { useProjectStore } from '../store/useProjectStore'
import { useShareStore } from '../store/useShareStore'
import { getActiveApiConfig, useSettingsStore } from '../store/useSettingsStore'
import type { HouseNode, ModelNode, RoomNode, SceneModel } from '../types/model'

/** 方向键平移视角的位移量（屏幕像素等效） */
const PAN_STEP = 15

/** 容器子节点数（房间 = 家具 + 嵌套房间；整屋 = 顶层房间数） */
function childCount(node: HouseNode | RoomNode): number {
  if (node.type === 'house') return node.levels[0]?.rooms.length ?? 0
  return node.furniture.length + node.nestedRooms.length
}

/** 移动端紧凑布局判定（与 OrientationGuard 的 wc-compact 同条件，供工具栏渲染分支使用） */
function useMobileCompact(): boolean {
  const [compact, setCompact] = useState(
    () => window.innerWidth <= 760 || window.innerHeight <= 480,
  )
  useEffect(() => {
    const apply = () => setCompact(window.innerWidth <= 760 || window.innerHeight <= 480)
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])
  return compact
}

/** 将调试日志导出为可复制的纯文本 */
function copyDebug(entries: DebugEntry[]): void {
  const text = entries
    .map((e) => `[${e.time}] [${e.level}] ${e.message}${e.detail ? `\n${e.detail}` : ''}`)
    .join('\n')
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => {})
  }
}

/** 下载调试日志为 .log 文件（保存到浏览器下载目录，便于直接读取排查） */
function downloadDebug(entries: DebugEntry[]): void {
  const text = entries
    .map((e) => `[${e.time}] [${e.level}] ${e.message}${e.detail ? `\n${e.detail}` : ''}`)
    .join('\n')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `wordcraft-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
  a.click()
  URL.revokeObjectURL(url)
}

/** 助手消息的展示文本：携带模型时显示摘要，否则显示回复（跳过纯 JSON） */
function assistantDisplay(m: ChatMessageItem, t: ReturnType<typeof useT>): string {
  if (m.model) {
    return t('chat.generatedModel', { name: m.model.root.name, count: countNodes(m.model.root) })
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
  const undo = useModelStore((s) => s.undo)
  const redo = useModelStore((s) => s.redo)
  const canUndo = useModelStore((s) => s.past.length > 0)
  const canRedo = useModelStore((s) => s.future.length > 0)

  const messages = useChatStore((s) => s.messages)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const addMessage = useChatStore((s) => s.addMessage)
  const clearConversation = useChatStore((s) => s.clearConversation)
  const canUndoGeneration = useChatStore((s) => s.generationStack.length > 0)
  const setIsGenerating = useChatStore((s) => s.setIsGenerating)
  const hasApiKey = useSettingsStore((s) => s.activeKeyId != null)
  const debugMode = useSettingsStore((s) => s.debugMode)
  const debugEntries = useDebugEntries()

  const [draft, setDraft] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(true)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareCode, setShareCode] = useState<string | null>(null)
  const [shareShot, setShareShot] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'3d' | 'plan'>('3d')
  const planMode = viewMode === 'plan'
  const mobileCompact = useMobileCompact()
  const [planToolsOpen, setPlanToolsOpen] = useState(false)
  const planTool = useModelStore((s) => s.planTool)
  const openingKind = useModelStore((s) => s.openingKind)
  const showPlanDims = useModelStore((s) => s.showPlanDims)
  const setPlanTool = useModelStore((s) => s.setPlanTool)
  const setOpeningKind = useModelStore((s) => s.setOpeningKind)
  const setShowPlanDims = useModelStore((s) => s.setShowPlanDims)
  const logRef = useRef<HTMLDivElement>(null)
  const debugRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<SceneViewerHandle>(null)

  const t = useT()
  const projectDirty = useProjectStore((s) => s.dirty)

  // 项目库脏标记：记录"上次保存的场景"快照，场景变化与其不一致即视为有未保存修改。
  // 首次挂载（含持久化重载）视为已保存快照，避免误标脏。
  const lastSavedJsonRef = useRef<string | null>(null)
  const dirtyInitRef = useRef(false)
  useEffect(() => {
    if (!dirtyInitRef.current) {
      dirtyInitRef.current = true
      lastSavedJsonRef.current = scene ? JSON.stringify(scene) : null
      return
    }
    const currentProjectId = useProjectStore.getState().currentId
    if (currentProjectId === null) return
    const json = scene ? JSON.stringify(scene) : ''
    // 与已保存快照不一致 → 有未保存修改；撤销回到已保存状态时清除脏标记
    if (lastSavedJsonRef.current !== json) useProjectStore.getState().markDirty()
    else useProjectStore.getState().markSaved()
  }, [scene])

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

  // 键盘：方向键/WASD 平移视角；Ctrl+Z 撤销、Ctrl+Shift+Z / Ctrl+Y 重做。
  // 输入框/文本框聚焦时不拦截，让位给原生文本编辑（含原生撤销）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return

      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault()
          useModelStore.getState().undo()
          return
        }
        if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault()
          useModelStore.getState().redo()
          return
        }
      }

      const controls = viewportRef.current
      if (!controls) return
      let dx = 0
      let dy = 0
      // 方向与自然观感一致（W/↑=看向北/前，A/←=看向西/左）；属性面板微调按钮不受影响
      switch (e.key.toLowerCase()) {
        case 'arrowleft':
        case 'a':
          dx = PAN_STEP
          break
        case 'arrowright':
        case 'd':
          dx = -PAN_STEP
          break
        case 'arrowup':
        case 'w':
          dy = -PAN_STEP
          break
        case 'arrowdown':
        case 's':
          dy = PAN_STEP
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
      addMessage({ role: 'error', content: t('home.noApiKey') })
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
        currentScene: useModelStore.getState().scene,
        // P3 双向同步：手动编辑日志随上下文喂给 LLM，让 AI 基于用户改过的版本继续
        editOps: useChatStore.getState().editOps,
      })
      addMessage({ role: 'assistant', content: reply, model })
      // 记录生成前的场景，供「撤销生成」回退
      const prevScene = useModelStore.getState().scene
      if (prevScene) useChatStore.getState().pushGenerationHistory(prevScene)
      setScene(model)
      // 生成的是全新的未保存场景：解绑项目，重置已保存快照
      useProjectStore.getState().clearProject()
      lastSavedJsonRef.current = null
    } catch (error) {
      addMessage({
        role: 'error',
        content: error instanceof ChatGenerationError ? error.message : t('home.genFailed'),
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

  /** 丢弃当前场景前的未保存守卫。includeOrphan：是否也警告未入库的游离新场景 */
  const confirmDiscardUnsaved = (includeOrphan: boolean): boolean => {
    const { currentId, dirty } = useProjectStore.getState()
    if (currentId !== null && dirty) {
      return window.confirm(t('home.confirmDiscardProject'))
    }
    if (includeOrphan && currentId === null && useModelStore.getState().scene !== null) {
      return window.confirm(t('home.confirmDiscardScene'))
    }
    return true
  }

  const handleSave = async () => {
    const s = useModelStore.getState().scene
    if (!s) return
    const { currentId } = useProjectStore.getState()
    if (currentId !== null) {
      await updateProject(currentId, { data: JSON.stringify(s) })
      lastSavedJsonRef.current = JSON.stringify(useModelStore.getState().scene)
      useProjectStore.getState().markSaved()
    } else {
      // 无当前项目：打开项目库对话框，聚焦「新建项目」名称输入
      setProjectDialogOpen(true)
    }
  }

  const handleOpenProject = async (id: number, name: string) => {
    if (!confirmDiscardUnsaved(true)) return
    const rec = await getProject(id)
    if (!rec) return
    let parsed: unknown
    try {
      parsed = JSON.parse(rec.data)
    } catch {
      window.alert(t('home.alertCorrupt'))
      return
    }
    // 读取时迁移：旧项目（v1 盒子模型）自动升为 v3 足迹模型（design.md §3.4）
    const model = migrateModel(parsed)
    if (!model) {
      window.alert(t('home.alertInvalid'))
      return
    }
    setScene(model)
    lastSavedJsonRef.current = JSON.stringify(useModelStore.getState().scene)
    useProjectStore.getState().setProject(id, name)
    useChatStore.getState().clearGenerationHistory()
  }

  const handleProjectCreated = (id: number, name: string) => {
    lastSavedJsonRef.current = JSON.stringify(useModelStore.getState().scene)
    useProjectStore.getState().setProject(id, name)
  }

  /** 分享 / 导入：有模型时生成口令 + 截图水印并记录历史；无模型时仅打开对话框供粘贴口令还原 */
  const handleShare = async () => {
    const s = useModelStore.getState().scene
    if (s) {
      const code = encodeShareCode(JSON.stringify(s))
      const shot = (await viewportRef.current?.captureScreenshot?.()) ?? null
      const watermarked = shot ? await withWatermark(shot, code) : null
      setShareCode(code)
      setShareShot(watermarked)
      useShareStore.getState().addRecord({ name: s.root.name, code })
    } else {
      // 无模型：仍可打开对话框，粘贴他人口令导入模型
      setShareCode(null)
      setShareShot(null)
    }
    setShareOpen(true)
  }

  /** 从分享口令还原模型：未保存守卫 → setScene，成为游离场景（不属于任何项目） */
  const restoreFromShare = (model: SceneModel) => {
    if (!confirmDiscardUnsaved(true)) return
    setScene(model)
    useProjectStore.getState().clearProject()
    useChatStore.getState().clearGenerationHistory()
    lastSavedJsonRef.current = null
  }

  /** 撤销最近一次生成：恢复生成前的场景，并移除对话中对应的 user+assistant 对 */
  const undoGeneration = () => {
    const prev = useChatStore.getState().undoLastGeneration()
    if (!prev) return
    setScene(prev)
  }

  return (
    <div className="home">
      <header className="home__toolbar">
        <div className="home__toolbar-left">
          <Button
            variant="ghost"
            onClick={() => {
              if (!confirmDiscardUnsaved(true)) return
              useProjectStore.getState().clearProject()
              useChatStore.getState().clearGenerationHistory()
              lastSavedJsonRef.current = null
              setScene(createSampleModel())
            }}
          >
            {t('home.loadSample')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (!confirmDiscardUnsaved(false)) return
              useProjectStore.getState().clearProject()
              useChatStore.getState().clearGenerationHistory()
              lastSavedJsonRef.current = null
              resetScene()
            }}
            disabled={!scene}
          >
            {t('home.clearScene')}
          </Button>
          <span className="toolbar-sep" />
          <Button variant="ghost" onClick={undo} disabled={!canUndo} title={t('home.undoTitle')}>
            {t('home.undo')}
          </Button>
          <Button variant="ghost" onClick={redo} disabled={!canRedo} title={t('home.redoTitle')}>
            {t('home.redo')}
          </Button>
          <span className="toolbar-sep" />
          <Button
            variant="ghost"
            onClick={() => void handleSave()}
            disabled={!scene}
            title={projectDirty ? t('home.saveTitleDirty') : t('home.saveTitle')}
          >
            {t('home.save')}
          </Button>
          <Button variant="ghost" onClick={() => setProjectDialogOpen(true)}>
            {t('home.library')}
          </Button>
          <Button variant="ghost" onClick={() => void handleShare()} title={t('share.title')}>
            {t('home.share')}
          </Button>
          <Button variant="ghost" onClick={() => setHelpOpen(true)}>
            {t('home.help')}
          </Button>
        </div>
        <div className="home__toolbar-right">
          <LanguageToggle />
          {focusId && (
            <Button
              variant="ghost"
              onClick={() => {
                setFocus(null)
                selectNode(null)
              }}
            >
              {t('home.backToHouse')}
            </Button>
          )}
          {hasApiKey ? (
            <span className="badge badge--ok">{t('home.apiOk')}</span>
          ) : (
            <Link to="/settings" className="badge badge--warn">
              {t('home.apiMissing')}
            </Link>
          )}
        </div>
      </header>

      <div className="home__body">
        <section className="panel home__chat">
          <div className="home__chat-header">
            <h2 className="panel__title">{t('chat.title')}</h2>
            <Button
              variant="ghost"
              onClick={undoGeneration}
              disabled={!canUndoGeneration}
              title={t('chat.undoGenTitle')}
            >
              {t('chat.undoGen')}
            </Button>
            <Button variant="ghost" onClick={clearConversation} disabled={messages.length === 0}>
              {t('chat.clear')}
            </Button>
          </div>
          <div className="chat-log" ref={logRef}>
            {messages.length === 0 && !isGenerating ? (
              <p className="chat-log__hint">{t('chat.hint')}</p>
            ) : (
              <ul className="chat-log__list">
                {messages.map((m) => (
                  <li key={m.id} className={`chat-msg chat-msg--${m.role}`}>
                    <span className="chat-msg__label">
                      {m.role === 'user'
                        ? t('chat.roleMe')
                        : m.role === 'assistant'
                          ? t('chat.roleAssistant')
                          : t('chat.roleError')}
                    </span>
                    <div className="chat-msg__body">
                      {m.role === 'assistant' ? assistantDisplay(m, t) : m.content}
                    </div>
                  </li>
                ))}
                {isGenerating && (
                  <li className="chat-msg chat-msg--assistant">
                    <span className="chat-msg__label">{t('chat.roleAssistant')}</span>
                    <div className="chat-msg__body">{t('chat.generating', { elapsed })}</div>
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
              placeholder={t('chat.placeholder')}
              rows={3}
            />
            <Button onClick={() => void send()} disabled={!draft.trim() || isGenerating}>
              {isGenerating ? t('chat.generatingBtn', { elapsed }) : t('chat.generateBtn')}
            </Button>
          </div>
        </section>

        <section className="panel home__viewport">
          <div
            className="view-mode-toggle segmented"
            role="group"
            aria-label={t('home.viewModeAria')}
          >
            <button
              type="button"
              className={`segmented__btn ${!planMode ? 'segmented__btn--active' : ''}`}
              onClick={() => {
                setPlanToolsOpen(false)
                setViewMode('3d')
              }}
            >
              3D
            </button>
            <button
              type="button"
              className={`segmented__btn ${planMode ? 'segmented__btn--active' : ''}`}
              onClick={() => {
                setPlanToolsOpen(false)
                setViewMode('plan')
              }}
              title={t('home.viewPlanTitle')}
            >
              {t('home.viewPlan')}
            </button>
          </div>
          {planMode && (
            <div className="plan-toolbar">
              {mobileCompact ? (
                /* 移动端：单个「工具」按钮 + 弹出面板（选择即关闭），不再常驻遮挡平面图 */
                <>
                  <button
                    type="button"
                    className={`plan-toolbar__menu-btn ${planToolsOpen ? 'plan-toolbar__menu-btn--active' : ''}`}
                    onClick={() => setPlanToolsOpen((o) => !o)}
                    title={t('plan.toolsTitle')}
                  >
                    {t('plan.tools')} {planToolsOpen ? '▴' : '▾'}
                  </button>
                  {planToolsOpen && (
                    <>
                      <div className="plan-toolbar__backdrop" onClick={() => setPlanToolsOpen(false)} />
                      <div className="plan-toolbar__sheet">
                        <div className="plan-toolbar__sheet-tools" role="toolbar" aria-label={t('plan.toolAria')}>
                          {(
                            [
                              ['select', t('plan.toolSelect'), t('plan.toolSelectTitle')],
                              ['move', t('plan.toolMove'), t('plan.toolMoveTitle')],
                              ['vertex', t('plan.toolVertex'), t('plan.toolVertexTitle')],
                              ['opening', t('plan.toolOpening'), t('plan.toolOpeningTitle')],
                              ['split', t('plan.toolSplit'), t('plan.toolSplitTitle')],
                              ['merge', t('plan.toolMerge'), t('plan.toolMergeTitle')],
                            ] as Array<[PlanTool, string, string]>
                          ).map(([tool, label, title]) => (
                            <button
                              key={tool}
                              type="button"
                              className={`plan-toolbar__sheet-btn ${planTool === tool ? 'plan-toolbar__sheet-btn--active' : ''}`}
                              onClick={() => {
                                setPlanTool(tool)
                                setPlanToolsOpen(false)
                              }}
                              title={title}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        {planTool === 'opening' && (
                          <div className="plan-toolbar__kind segmented" role="group" aria-label={t('plan.toolOpening')}>
                            {(
                              [
                                ['door', t('plan.kindDoor')],
                                ['window', t('plan.kindWindow')],
                              ] as Array<['door' | 'window', string]>
                            ).map(([kind, label]) => (
                              <button
                                key={kind}
                                type="button"
                                className={`segmented__btn ${openingKind === kind ? 'segmented__btn--active' : ''}`}
                                onClick={() => setOpeningKind(kind)}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          className={`plan-toolbar__dims segmented__btn ${showPlanDims ? 'segmented__btn--active' : ''}`}
                          onClick={() => setShowPlanDims(!showPlanDims)}
                          title={t('plan.toggleDimsTitle')}
                        >
                          {t('plan.toggleDims')}
                        </button>
                        {planTool !== 'select' && (
                          <div className="plan-toolbar__hint">
                            {planTool === 'move'
                              ? t('plan.hintMove')
                              : planTool === 'vertex'
                                ? t('plan.hintVertex')
                                : planTool === 'opening'
                                  ? t('plan.hintOpening', {
                                      kind: openingKind === 'door' ? t('plan.kindDoor') : t('plan.kindWindow'),
                                    })
                                  : planTool === 'split'
                                    ? t('plan.hintSplit')
                                    : planTool === 'merge'
                                      ? t('plan.hintMerge')
                                      : ''}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : (
                /* 桌面端：常驻工具行（保持原样） */
                <>
                  <div className="plan-toolbar__row">
                    <div className="plan-toolbar__tools segmented" role="toolbar" aria-label={t('plan.toolAria')}>
                      {(
                        [
                          ['select', t('plan.toolSelect'), t('plan.toolSelectTitle')],
                          ['move', t('plan.toolMove'), t('plan.toolMoveTitle')],
                          ['vertex', t('plan.toolVertex'), t('plan.toolVertexTitle')],
                          ['opening', t('plan.toolOpening'), t('plan.toolOpeningTitle')],
                          ['split', t('plan.toolSplit'), t('plan.toolSplitTitle')],
                          ['merge', t('plan.toolMerge'), t('plan.toolMergeTitle')],
                        ] as Array<[PlanTool, string, string]>
                      ).map(([tool, label, title]) => (
                        <button
                          key={tool}
                          type="button"
                          className={`segmented__btn ${planTool === tool ? 'segmented__btn--active' : ''}`}
                          onClick={() => setPlanTool(tool)}
                          title={title}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {planTool === 'opening' && (
                      <div className="plan-toolbar__kind segmented" role="group" aria-label={t('plan.toolOpening')}>
                        {(
                          [
                            ['door', t('plan.kindDoor')],
                            ['window', t('plan.kindWindow')],
                          ] as Array<['door' | 'window', string]>
                        ).map(([kind, label]) => (
                          <button
                            key={kind}
                            type="button"
                            className={`segmented__btn ${openingKind === kind ? 'segmented__btn--active' : ''}`}
                            onClick={() => setOpeningKind(kind)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* 视图选项行：尺寸标注开关（不挤占工具行；房间内部尺寸线会覆盖在房间上，可关闭让平面图更清爽） */}
                  <div className="plan-toolbar__row">
                    <button
                      type="button"
                      className={`plan-toolbar__dims segmented__btn ${showPlanDims ? 'segmented__btn--active' : ''}`}
                      onClick={() => setShowPlanDims(!showPlanDims)}
                      title={t('plan.toggleDimsTitle')}
                    >
                      {t('plan.toggleDims')}
                    </button>
                  </div>
                  {/* 操作提示条：仅当前工具存在提示时渲染（空文案渲染会露出黑底空胶囊） */}
                  {planTool !== 'select' && (
                    <div className="plan-toolbar__hint">
                      {planTool === 'move'
                        ? t('plan.hintMove')
                        : planTool === 'vertex'
                          ? t('plan.hintVertex')
                          : planTool === 'opening'
                            ? t('plan.hintOpening', {
                                kind: openingKind === 'door' ? t('plan.kindDoor') : t('plan.kindWindow'),
                              })
                            : planTool === 'split'
                              ? t('plan.hintSplit')
                              : planTool === 'merge'
                                ? t('plan.hintMerge')
                                : ''}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <SceneViewer ref={viewportRef} planMode={planMode} />
          {selected && <PropertyPanel node={selected} />}
        </section>
      </div>

      {debugMode && (
        <section className="debug-panel">
          <div className="debug-panel__header">
            <button className="debug-panel__toggle" onClick={() => setDebugOpen((o) => !o)}>
              {debugOpen ? '▾' : '▸'} {t('home.debugLog')}
            </button>
            <span className="debug-panel__count">
              {t('home.debugCount', { count: debugEntries.length })}
            </span>
            <div className="debug-panel__actions">
              <Button
                variant="ghost"
                onClick={() => copyDebug(debugEntries)}
                disabled={debugEntries.length === 0}
              >
                {t('home.copy')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => downloadDebug(debugEntries)}
                disabled={debugEntries.length === 0}
                title={t('home.downloadTitle')}
              >
                {t('home.download')}
              </Button>
              <Button variant="ghost" onClick={clearDebug} disabled={debugEntries.length === 0}>
                {t('home.clear')}
              </Button>
            </div>
          </div>
          {debugOpen && (
            <div className="debug-panel__body" ref={debugRef}>
              {debugEntries.length === 0 ? (
                <p className="debug-panel__empty">{t('home.debugEmpty')}</p>
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
          <span className="move-controls__title">{t('home.viewTitle')}</span>
          <Button
            variant="ghost"
            className="move-controls__btn"
            title={t('home.panLeftTitle')}
            onClick={() => viewportRef.current?.pan(-PAN_STEP, 0)}
          >
            ◀
          </Button>
          <Button
            variant="ghost"
            className="move-controls__btn"
            title={t('home.panRightTitle')}
            onClick={() => viewportRef.current?.pan(PAN_STEP, 0)}
          >
            ▶
          </Button>
          <Button
            variant="ghost"
            className="move-controls__btn"
            title={t('home.panUpTitle')}
            onClick={() => viewportRef.current?.pan(0, PAN_STEP)}
          >
            ▲
          </Button>
          <Button
            variant="ghost"
            className="move-controls__btn"
            title={t('home.panDownTitle')}
            onClick={() => viewportRef.current?.pan(0, -PAN_STEP)}
          >
            ▼
          </Button>
          <Button variant="ghost" onClick={() => viewportRef.current?.resetView()}>
            {t('home.resetView')}
          </Button>
        </div>

        <span className="dim-info">
          {selected
            ? (() => {
                const dims = nodeDims(selected)
                const pos = nodePosition(selected)
                return (
                  <>
                    {t('home.selectedInfo', {
                      name: selected.name,
                      l: dims.length,
                      w: dims.width,
                      h: dims.height,
                      x: pos.x.toFixed(2),
                      z: pos.z.toFixed(2),
                    })}
                    {isContainer(selected)
                      ? t('home.selectedChildren', { count: childCount(selected) })
                      : ''}
                  </>
                )
              })()
            : focusId
              ? t('home.focusedHint')
              : t('home.selectHint')}
        </span>
      </footer>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ProjectLibraryDialog
        open={projectDialogOpen}
        onClose={() => setProjectDialogOpen(false)}
        onOpenProject={(id, name) => void handleOpenProject(id, name)}
        onProjectCreated={handleProjectCreated}
      />
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        code={shareCode}
        screenshot={shareShot}
        onRestore={restoreFromShare}
      />
    </div>
  )
}
