import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { nodeDims, nodePosition } from '../../lib/footprint'
import { useT, type TKey } from '../../i18n'
import { useModelStore } from '../../store/useModelStore'
import type { Dimensions, ModelNode, Position } from '../../types/model'
import { Button } from '../ui/Button'

/** 数值展示：去掉多余尾零，最多 3 位小数 */
function fmt(n: number): string {
  return String(parseFloat(n.toFixed(3)))
}

/** 位置微调的步长档位（米） */
const STEP_OPTIONS = [0.1, 0.5, 1] as const

interface NumberFieldProps {
  label: string
  value: number
  min?: number
  step?: number
  /** Enter / blur 时提交 */
  onCommit: (value: number) => void
}

/** 数值输入框：本地草稿态，Enter/blur 提交；外部值变化（撤销/约束回弹）时同步回显 */
function NumberField({ label, value, min, step = 0.1, onCommit }: NumberFieldProps) {
  const [text, setText] = useState(fmt(value))
  useEffect(() => setText(fmt(value)), [value])

  const commit = () => {
    const n = parseFloat(text)
    if (!Number.isFinite(n) || (min !== undefined && n < min)) {
      setText(fmt(value))
      return
    }
    onCommit(n)
  }

  return (
    <label className="prop-field">
      <span className="prop-field__label">{label}</span>
      <input
        className="input prop-field__input"
        type="number"
        value={text}
        step={step}
        min={min}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
      />
    </label>
  )
}

interface NameFieldProps {
  value: string
  onCommit: (name: string) => void
}

/** 名称输入：Enter/blur 提交，空白忽略并回显原值 */
function NameField({ value, onCommit, label }: NameFieldProps & { label: string }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  const commit = () => {
    const trimmed = text.trim()
    if (trimmed && trimmed !== value) onCommit(trimmed)
    else setText(value)
  }

  return (
    <label className="prop-field">
      <span className="prop-field__label">{label}</span>
      <input
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
    </label>
  )
}

const TYPE_LABEL: Record<ModelNode['type'], TKey> = {
  house: 'property.typeHouse',
  room: 'property.typeRoom',
  furniture: 'property.typeFurniture',
}

export interface PropertyPanelProps {
  /** 当前选中的模块（房间 / 家具 / 整屋） */
  node: ModelNode
}

/**
 * 属性面板（浮在 3D 视口右侧）：选中模块后显示并可编辑名称 / 长宽高 / X·Y·Z 坐标。
 * 提交语义：Enter 或失焦时写入；位置微调按钮按步长移动；「复位位置」回到加载时快照。
 * 所有编辑都经由 useModelStore 记入撤销历史。
 */
export function PropertyPanel({ node }: PropertyPanelProps) {
  const updateSelected = useModelStore((s) => s.updateSelected)
  const selectNode = useModelStore((s) => s.selectNode)
  const translateSelected = useModelStore((s) => s.translateSelected)
  const resetSelectedPosition = useModelStore((s) => s.resetSelectedPosition)
  const stepSize = useModelStore((s) => s.stepSize)
  const setStepSize = useModelStore((s) => s.setStepSize)
  const gizmoMode = useModelStore((s) => s.gizmoMode)
  const setGizmoMode = useModelStore((s) => s.setGizmoMode)
  const initialPositions = useModelStore((s) => s.initialPositions)
  const t = useT()

  const canReset = initialPositions[node.id] !== undefined
  const patchDim = (key: keyof Dimensions, v: number) =>
    updateSelected({ dimensions: { [key]: v } })
  const patchPos = (key: keyof Position, v: number) => updateSelected({ position: { [key]: v } })
  // 房间尺寸/坐标为足迹派生值（展示用）；编辑提交时由 updateNodeFields 转为足迹缩放/平移
  const dims = nodeDims(node)
  const pos = nodePosition(node)

  // 面板可拖动（按住头部拖拽移动位置；会话内记住偏移，选中变化不重置）
  const [panelOffset, setPanelOffset] = useState<{ x: number; y: number } | null>(null)
  const dragState = useRef<{ baseX: number; baseY: number; startX: number; startY: number } | null>(
    null,
  )
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLElement>(null)

  /**
   * 把偏移钳制到视口容器内：面板头部（含标题/关闭按钮）必须保持可交互，不能被拖出视口。
   * 右边界按面板**实际渲染宽度**计算（读 DOM，而非硬编码 270px）——紧凑布局
   * （`.wc-compact .prop-panel`）下面板宽度为 240px，硬编码会把右边界算宽 30px，
   * 面板可被拖出视口或被复位回拉（拖拽偏移钳制，2026-08-14 审查发现）。
   */
  const clampOffset = (offset: { x: number; y: number }): { x: number; y: number } => {
    const host = document.querySelector('.home__viewport') as HTMLElement | null
    const panelW = panelRef.current?.offsetWidth ?? 0
    if (!host || panelW <= 0) return offset
    const hostW = host.clientWidth
    const hostH = host.clientHeight
    const margin = 8
    // y 方向至少露出头部 40px 供再次拖回
    return {
      x: Math.min(Math.max(offset.x, margin), Math.max(margin, hostW - panelW - margin)),
      y: Math.min(Math.max(offset.y, margin), Math.max(margin, hostH - 40 - margin)),
    }
  }

  // 窗口尺寸变化（缩放/横竖屏切换）时重新钳制：面板曾被拖到边缘、窗口变窄后
  // 可能整体出视口且头部不可见，无法拖回
  useEffect(() => {
    if (panelOffset === null) return
    const onResize = () => {
      setPanelOffset((cur) => (cur ? clampOffset(cur) : cur))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOffset !== null])

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const host = e.currentTarget.closest('.home__viewport') as HTMLElement | null
    const panel = e.currentTarget.closest('.prop-panel') as HTMLElement | null
    if (!host || !panel) return
    const hostRect = host.getBoundingClientRect()
    const rect = panel.getBoundingClientRect()
    const base = panelOffset ?? { x: rect.left - hostRect.left, y: rect.top - hostRect.top }
    dragState.current = { baseX: base.x, baseY: base.y, startX: e.clientX, startY: e.clientY }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragState.current
    if (!d) return
    setPanelOffset(
      clampOffset({ x: d.baseX + e.clientX - d.startX, y: d.baseY + e.clientY - d.startY }),
    )
  }
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragState.current = null
    setDragging(false)
    // 松手时把越界偏移拉回容器内（拖过头时面板不会被丢在视口外）
    setPanelOffset((cur) => (cur ? clampOffset(cur) : cur))
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <aside
      ref={panelRef}
      className={`prop-panel ${dragging ? 'prop-panel--dragging' : ''}`}
      style={panelOffset ? { left: panelOffset.x, top: panelOffset.y, right: 'auto' } : undefined}
    >
      <header
        className="prop-panel__header"
        title={t('property.dragTitle')}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="prop-panel__title-wrap">
          <span className="prop-panel__type">{t(TYPE_LABEL[node.type])}</span>
          <h3 className="prop-panel__title">{node.name}</h3>
        </div>
        <Button
          variant="ghost"
          className="prop-panel__close"
          title={t('property.closeTitle')}
          aria-label={t('property.closeTitle')}
          onClick={() => selectNode(null)}
        >
          ×
        </Button>
      </header>

      {/* Gizmo 手柄模式：移动 / 缩放（房间与家具均可 Gizmo 编辑，整屋不支持） */}
      {node.type !== 'house' && (
        <div className="prop-panel__section">
          <span className="prop-panel__section-title">{t('property.gizmoMode')}</span>
          <div className="segmented" role="group" aria-label={t('property.gizmoMode')}>
            <button
              type="button"
              className={`segmented__btn ${gizmoMode === 'translate' ? 'segmented__btn--active' : ''}`}
              onClick={() => setGizmoMode('translate')}
              aria-pressed={gizmoMode === 'translate'}
            >
              {t('property.gizmoTranslate')}
            </button>
            <button
              type="button"
              className={`segmented__btn ${gizmoMode === 'scale' ? 'segmented__btn--active' : ''}`}
              onClick={() => setGizmoMode('scale')}
              aria-pressed={gizmoMode === 'scale'}
            >
              {t('property.gizmoScale')}
            </button>
          </div>
        </div>
      )}

      <div className="prop-field">
        <NameField
          value={node.name}
          onCommit={(name) => updateSelected({ name })}
          label={t('property.name')}
        />
      </div>

      <div className="prop-panel__section">
        <span className="prop-panel__section-title">{t('property.dimSection')}</span>
        <div className="prop-panel__grid">
          <NumberField
            label={t('property.length')}
            value={dims.length}
            min={0.1}
            onCommit={(v) => patchDim('length', v)}
          />
          <NumberField
            label={t('property.width')}
            value={dims.width}
            min={0.1}
            onCommit={(v) => patchDim('width', v)}
          />
          <NumberField
            label={t('property.height')}
            value={dims.height}
            min={0.1}
            onCommit={(v) => patchDim('height', v)}
          />
        </div>
      </div>

      <div className="prop-panel__section">
        <span className="prop-panel__section-title">{t('property.posSection')}</span>
        <div className="prop-panel__grid">
          <NumberField label="X" value={pos.x} onCommit={(v) => patchPos('x', v)} />
          <NumberField label="Y" value={pos.y} onCommit={(v) => patchPos('y', v)} />
          <NumberField label="Z" value={pos.z} onCommit={(v) => patchPos('z', v)} />
        </div>
        <Button
          variant="ghost"
          className="prop-panel__reset"
          onClick={resetSelectedPosition}
          disabled={!canReset}
          title={canReset ? t('property.resetTitle') : t('property.resetUnavailable')}
        >
          {t('property.reset')}
        </Button>
      </div>

      <div className="prop-panel__section">
        <span className="prop-panel__section-title">{t('property.nudgeSection')}</span>
        <div className="prop-panel__step" role="group" aria-label={t('property.nudgeSection')}>
          {STEP_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={`step-btn ${stepSize === s ? 'step-btn--active' : ''}`}
              onClick={() => setStepSize(s)}
              aria-pressed={stepSize === s}
            >
              {s}m
            </button>
          ))}
        </div>
        {/* 方向与罗盘一致（世界锚定罗盘）：东=世界 +x、西=世界 -x、北=+z、南=-z。
            3D 内容整体沿 X 镜像（坑 26），南视角下东在屏幕右侧（上北下南、左西右东），
            与 2D 平面图（标准地图）一致。内部墙/走廊代码的 east=+x 与罗盘一致，无需镜像。 */}
        <div className="prop-nudge">
          <button
            type="button"
            className="prop-nudge__btn"
            title={t('property.nudgeEast')}
            onClick={() => translateSelected(stepSize, 0, 0)}
          >
            {t('property.east')}
          </button>
          <button
            type="button"
            className="prop-nudge__btn"
            title={t('property.nudgeNorth')}
            onClick={() => translateSelected(0, 0, stepSize)}
          >
            {t('property.north')}
          </button>
          <button
            type="button"
            className="prop-nudge__btn"
            title={t('property.nudgeUp')}
            onClick={() => translateSelected(0, stepSize, 0)}
          >
            {t('property.up')}
          </button>
          <button
            type="button"
            className="prop-nudge__btn"
            title={t('property.nudgeWest')}
            onClick={() => translateSelected(-stepSize, 0, 0)}
          >
            {t('property.west')}
          </button>
          <button
            type="button"
            className="prop-nudge__btn"
            title={t('property.nudgeSouth')}
            onClick={() => translateSelected(0, 0, -stepSize)}
          >
            {t('property.south')}
          </button>
          <button
            type="button"
            className="prop-nudge__btn"
            title={t('property.nudgeDown')}
            onClick={() => translateSelected(0, -stepSize, 0)}
          >
            {t('property.down')}
          </button>
        </div>
      </div>
    </aside>
  )
}
