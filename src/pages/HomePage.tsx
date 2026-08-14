import { useMemo, useRef, useState } from 'react'
import { ChatDrawer, type ChatDrawerHandle } from '../components/ui/ChatDrawer'
import { useConfirm } from '../components/ui/useConfirm'
import { DebugPanel } from '../components/ui/DebugPanel'
import { EmptyStateCard } from '../components/ui/EmptyStateCard'
import { HelpDialog } from '../components/ui/HelpDialog'
import { HomeToolbar } from '../components/ui/HomeToolbar'
import { PlanToolbar } from '../components/ui/PlanToolbar'
import { ProjectLibraryDialog } from '../components/ui/ProjectLibraryDialog'
import { ShareDialog } from '../components/ui/ShareDialog'
import { PropertyPanel } from '../components/viewport/PropertyPanel'
import { SceneViewer, type SceneViewerHandle } from '../components/viewport/SceneViewer'
import { useDirtyTracking } from '../hooks/useDirtyTracking'
import { useGeneration } from '../hooks/useGeneration'
import { useMobileCompact } from '../hooks/useMobileCompact'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { safeProjectDb } from '../db/database'
import { useT } from '../i18n'
import { encodeShareCode } from '../lib/compression'
import { useDebugEntries } from '../lib/debugLog'
import { nodeDims, nodePosition } from '../lib/footprint'
import { migrateModel } from '../lib/migration'
import { getPathToNode, isContainer } from '../lib/modelTree'
import { createSampleModel } from '../lib/sampleModel'
import { withWatermark } from '../lib/watermark'
import { useChatStore } from '../store/useChatStore'
import { useModelStore } from '../store/useModelStore'
import { useProjectStore } from '../store/useProjectStore'
import { useShareStore } from '../store/useShareStore'
import { useSettingsStore } from '../store/useSettingsStore'
import type { HouseNode, ModelNode, RoomNode, SceneModel } from '../types/model'

/** 容器子节点数（房间 = 家具 + 嵌套房间；整屋 = 顶层房间数） */
function childCount(node: HouseNode | RoomNode): number {
  if (node.type === 'house') return node.levels[0]?.rooms.length ?? 0
  return node.furniture.length + node.nestedRooms.length
}

/** 助手消息的展示文本：携带模型时显示摘要，否则显示回复（跳过纯 JSON） */
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
  const clearConversation = useChatStore((s) => s.clearConversation)
  const canUndoGeneration = useChatStore((s) => s.generationStack.length > 0)
  const hasApiKey = useSettingsStore((s) => s.activeKeyId != null)
  const debugMode = useSettingsStore((s) => s.debugMode)
  const debugEntries = useDebugEntries()

  const [draft, setDraft] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareCode, setShareCode] = useState<string | null>(null)
  const [shareShot, setShareShot] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'3d' | 'plan'>('3d')
  const planMode = viewMode === 'plan'
  const mobileCompact = useMobileCompact()
  const [chatCollapsed, setChatCollapsed] = useState(true)
  const planTool = useModelStore((s) => s.planTool)
  const openingKind = useModelStore((s) => s.openingKind)
  const showPlanDims = useModelStore((s) => s.showPlanDims)
  const setPlanTool = useModelStore((s) => s.setPlanTool)
  const setOpeningKind = useModelStore((s) => s.setOpeningKind)
  const setShowPlanDims = useModelStore((s) => s.setShowPlanDims)
  const viewportRef = useRef<SceneViewerHandle>(null)
  const chatRef = useRef<ChatDrawerHandle>(null)

  const t = useT()
  const { confirm, alertMessage } = useConfirm()
  const projectDirty = useProjectStore((s) => s.dirty)

  // 项目库脏标记（坑 B7）：场景变化订阅只在「干净 → 变化」时做一次快照比对，
  // 拖拽等高频预览更新（previewSelected/previewFootprint 每帧换 scene 引用）不重复 stringify。
  useDirtyTracking(scene)

  // 对话生成链路：send / 撤销生成 / 生成计时（HomePage 抽离，坑 C12）
  const { send, undoGeneration, elapsed, isGenerating } = useGeneration({
    draft,
    setDraft,
    setChatCollapsed,
  })

  const selected = useMemo(() => {
    if (!scene || !selectedId) return null
    const path = getPathToNode(scene.root, selectedId)
    return path[path.length - 1] ?? null
  }, [scene, selectedId])

  const crumbs = useMemo(
    () => (scene && selectedId ? getPathToNode(scene.root, selectedId) : []),
    [scene, selectedId],
  )

  // 调试日志自动滚动到底部（由 DebugPanel 内部处理）
  useKeyboardShortcuts(viewportRef)

  const jumpToCrumb = (node: ModelNode) => {
    selectNode(node.id)
    if (node.type === 'house') setFocus(null)
    else if (node.type === 'room') setFocus(node.id)
  }

  /** 丢弃当前场景前的未保存守卫。includeOrphan：是否也警告未入库的游离新场景 */
  const confirmDiscardUnsaved = async (includeOrphan: boolean): Promise<boolean> => {
    const { currentId, dirty } = useProjectStore.getState()
    if (currentId !== null && dirty) {
      return confirm({
        title: t('home.discardTitle'),
        message: t('home.confirmDiscardProject'),
        danger: true,
      })
    }
    if (includeOrphan && currentId === null && useModelStore.getState().scene !== null) {
      return confirm({
        title: t('home.discardTitle'),
        message: t('home.confirmDiscardScene'),
        danger: true,
      })
    }
    return true
  }

  const handleSave = async () => {
    const s = useModelStore.getState().scene
    if (!s) return
    const { currentId } = useProjectStore.getState()
    if (currentId !== null) {
      // 落盘数据与脏标记快照同源：先序列化一次，避免 await 期间场景变化导致
      // 落盘旧数据、快照基线却是新场景（刷新后丢编辑且脏标记误显示为干净）
      const json = JSON.stringify(s)
      const ok = await safeProjectDb.update(currentId, { data: json })
      if (!ok) {
        await alertMessage({
          title: t('project.dbUnavailableTitle'),
          message: t('project.dbUnavailable'),
        })
        return
      }
      useProjectStore.getState().commitSavedScene(json)
    } else {
      // 无当前项目：打开项目库对话框，聚焦「新建项目」名称输入
      setProjectDialogOpen(true)
    }
  }

  const handleOpenProject = async (id: number, name: string) => {
    if (!(await confirmDiscardUnsaved(true))) return
    const rec = await safeProjectDb.get(id)
    if (!rec) return
    let parsed: unknown
    try {
      parsed = JSON.parse(rec.data)
    } catch {
      await alertMessage({ title: t('home.openFailedTitle'), message: t('home.alertCorrupt') })
      return
    }
    // 读取时迁移：旧项目（v1 盒子模型）自动升为 v3 足迹模型（design.md §3.4）
    const model = migrateModel(parsed)
    if (!model) {
      await alertMessage({ title: t('home.openFailedTitle'), message: t('home.alertInvalid') })
      return
    }
    setScene(model)
    useProjectStore.getState().setProject(id, name)
    useProjectStore.getState().commitSavedScene(JSON.stringify(useModelStore.getState().scene))
    useChatStore.getState().clearGenerationHistory()
  }

  const handleProjectCreated = (id: number, name: string) => {
    useProjectStore.getState().setProject(id, name)
    useProjectStore.getState().commitSavedScene(JSON.stringify(useModelStore.getState().scene))
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

  /** 独立截图：直接下载当前视角高清 PNG（不含水印/口令，与分享对话框的带水印截图不同） */
  const handleScreenshot = async () => {
    const shot = await viewportRef.current?.captureScreenshot?.()
    if (!shot) {
      await alertMessage({
        title: t('home.screenshotFailedTitle'),
        message: t('home.screenshotFailed'),
      })
      return
    }
    const a = document.createElement('a')
    a.href = shot
    a.download = `wordcraft-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`
    a.click()
  }

  /** 从分享口令还原模型：未保存守卫 → setScene，成为游离场景（不属于任何项目） */
  const restoreFromShare = async (model: SceneModel) => {
    if (!(await confirmDiscardUnsaved(true))) return
    setScene(model)
    useProjectStore.getState().clearProject()
    useChatStore.getState().clearGenerationHistory()
  }

  /** 空态示例标签：填入输入框并展开抽屉聚焦 */
  const applyExample = (text: string) => {
    setDraft(text)
    setChatCollapsed(false)
    chatRef.current?.focusInput()
  }

  /** 加载示例模型（顶栏按钮与空态卡共用）：未保存守卫 → 解绑项目 → setScene */
  const loadSample = async () => {
    if (!(await confirmDiscardUnsaved(true))) return
    useProjectStore.getState().clearProject()
    useChatStore.getState().clearGenerationHistory()
    setScene(createSampleModel())
  }

  return (
    <div className="home">
      <HomeToolbar
        canClear={scene !== null}
        canSave={scene !== null}
        canUndo={canUndo}
        canRedo={canRedo}
        undoTitle={t('home.undoTitle')}
        redoTitle={t('home.redoTitle')}
        saveTitle={projectDirty ? t('home.saveTitleDirty') : t('home.saveTitle')}
        chatCollapsed={chatCollapsed}
        hasApiKey={hasApiKey}
        onLoadSample={() => void loadSample()}
        onClearScene={() => {
          void (async () => {
            if (!(await confirmDiscardUnsaved(false))) return
            useProjectStore.getState().clearProject()
            useChatStore.getState().clearGenerationHistory()
            resetScene()
          })()
        }}
        onUndo={undo}
        onRedo={redo}
        onSave={() => void handleSave()}
        onOpenLibrary={() => setProjectDialogOpen(true)}
        onShare={() => void handleShare()}
        onScreenshot={() => void handleScreenshot()}
        onHelp={() => setHelpOpen(true)}
        onToggleChat={() => setChatCollapsed((c) => !c)}
      />

      <div className="home__body">
        <section className="home__viewport">
          <div className="view-toggle" role="group" aria-label={t('home.viewModeAria')}>
            <button
              type="button"
              className={`view-toggle__btn ${!planMode ? 'view-toggle__btn--active' : ''}`}
              onClick={() => setViewMode('3d')}
              aria-pressed={!planMode}
            >
              3D
            </button>
            <button
              type="button"
              className={`view-toggle__btn ${planMode ? 'view-toggle__btn--active' : ''}`}
              onClick={() => setViewMode('plan')}
              title={t('home.viewPlanTitle')}
              aria-pressed={planMode}
            >
              {t('home.viewPlan')}
            </button>
          </div>

          {planMode && (
            <div className="plan-toolbar">
              <PlanToolbar
                planTool={planTool}
                openingKind={openingKind}
                showPlanDims={showPlanDims}
                mobileCompact={mobileCompact}
                onSetPlanTool={setPlanTool}
                onSetOpeningKind={setOpeningKind}
                onToggleDims={() => setShowPlanDims(!showPlanDims)}
              />
            </div>
          )}

          <SceneViewer ref={viewportRef} planMode={planMode} />
          {!scene && (
            <EmptyStateCard
              hasApiKey={hasApiKey}
              onExample={applyExample}
              onLoadSample={() => void loadSample()}
            />
          )}
          {selected && <PropertyPanel node={selected} />}
        </section>
      </div>

      {debugMode && <DebugPanel entries={debugEntries} />}

      <ChatDrawer
        ref={chatRef}
        collapsed={chatCollapsed}
        messages={messages}
        isGenerating={isGenerating}
        elapsed={elapsed}
        canUndoGeneration={canUndoGeneration}
        canClear={messages.length > 0}
        hasApiKey={hasApiKey}
        draft={draft}
        onDraftChange={setDraft}
        onSend={() => void send()}
        onToggle={() => setChatCollapsed((c) => !c)}
        onUndoGeneration={undoGeneration}
        onClearConversation={clearConversation}
      />

      <footer className="statusbar">
        {crumbs.length > 0 && (
          <nav className="breadcrumb" aria-label={t('home.breadcrumbAria')}>
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

        {focusId && (
          <button
            type="button"
            className="breadcrumb__link"
            onClick={() => {
              setFocus(null)
              selectNode(null)
            }}
          >
            ↩ {t('home.backToHouse')}
          </button>
        )}

        <span className="statusbar__sep" />

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

        <div className="statusbar__right">
          <span>v{__APP_VERSION__}</span>
        </div>
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
