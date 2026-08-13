import { useState } from 'react'
import { useT, type TKey } from '../../i18n'
import type { PlanTool } from '../../store/useModelStore'

/** 平面图工具清单（桌面工具行与移动端弹出面板共用，i18n key 双语） */
const TOOLS: ReadonlyArray<{ tool: PlanTool; label: TKey; title: TKey }> = [
  { tool: 'select', label: 'plan.toolSelect', title: 'plan.toolSelectTitle' },
  { tool: 'move', label: 'plan.toolMove', title: 'plan.toolMoveTitle' },
  { tool: 'vertex', label: 'plan.toolVertex', title: 'plan.toolVertexTitle' },
  { tool: 'opening', label: 'plan.toolOpening', title: 'plan.toolOpeningTitle' },
  { tool: 'split', label: 'plan.toolSplit', title: 'plan.toolSplitTitle' },
  { tool: 'merge', label: 'plan.toolMerge', title: 'plan.toolMergeTitle' },
]

/** 当前工具的逐工具操作提示；选择工具无提示返回空串 */
function hintFor(t: ReturnType<typeof useT>, tool: PlanTool, kind: 'door' | 'window'): string {
  switch (tool) {
    case 'move':
      return t('plan.hintMove')
    case 'vertex':
      return t('plan.hintVertex')
    case 'opening':
      return t('plan.hintOpening', {
        kind: kind === 'door' ? t('plan.kindDoor') : t('plan.kindWindow'),
      })
    case 'split':
      return t('plan.hintSplit')
    case 'merge':
      return t('plan.hintMerge')
    default:
      return ''
  }
}

export interface PlanToolbarProps {
  planTool: PlanTool
  openingKind: 'door' | 'window'
  showPlanDims: boolean
  /** 移动端紧凑布局：渲染「工具」+「尺寸」独立按钮与弹出面板；桌面端为常驻工具行 */
  mobileCompact: boolean
  onSetPlanTool: (tool: PlanTool) => void
  onSetOpeningKind: (kind: 'door' | 'window') => void
  onToggleDims: () => void
}

/** 平面图编辑工具栏：桌面端常驻工具行；移动端「工具」按钮 + 弹出面板（选工具即关闭） */
export function PlanToolbar({
  planTool,
  openingKind,
  showPlanDims,
  mobileCompact,
  onSetPlanTool,
  onSetOpeningKind,
  onToggleDims,
}: PlanToolbarProps) {
  const t = useT()
  const [toolsOpen, setToolsOpen] = useState(false)
  const hint = hintFor(t, planTool, openingKind)

  // 切换工具时关闭移动端弹出面板
  const pickTool = (tool: PlanTool) => {
    onSetPlanTool(tool)
    setToolsOpen(false)
  }

  const dimsButton = (
    <button
      type="button"
      className={`plan-toolbar__dims segmented__btn ${showPlanDims ? 'segmented__btn--active' : ''}`}
      onClick={onToggleDims}
      title={t('plan.toggleDimsTitle')}
    >
      {t('plan.toggleDims')}
    </button>
  )

  const kindSwitch = (
    <div className="plan-toolbar__kind segmented" role="group" aria-label={t('plan.toolOpening')}>
      {(['door', 'window'] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          className={`segmented__btn ${openingKind === kind ? 'segmented__btn--active' : ''}`}
          onClick={() => onSetOpeningKind(kind)}
        >
          {kind === 'door' ? t('plan.kindDoor') : t('plan.kindWindow')}
        </button>
      ))}
    </div>
  )

  const toolButtons = (sheet: boolean) =>
    TOOLS.map(({ tool, label, title }) => (
      <button
        key={tool}
        type="button"
        className={
          sheet
            ? `plan-toolbar__sheet-btn ${planTool === tool ? 'plan-toolbar__sheet-btn--active' : ''}`
            : `segmented__btn ${planTool === tool ? 'segmented__btn--active' : ''}`
        }
        onClick={() => pickTool(tool)}
        title={t(title)}
      >
        {t(label)}
      </button>
    ))

  // 移动端：独立「工具」+「尺寸」常驻按钮（尺寸不进面板，避免点不到），工具面板弹出即选即关
  if (mobileCompact) {
    return (
      <>
        <button
          type="button"
          className={`plan-toolbar__menu-btn ${toolsOpen ? 'plan-toolbar__menu-btn--active' : ''}`}
          onClick={() => setToolsOpen((o) => !o)}
          title={t('plan.toolsTitle')}
        >
          {t('plan.tools')} {toolsOpen ? '▴' : '▾'}
        </button>
        {dimsButton}
        {toolsOpen && (
          <>
            <div className="plan-toolbar__backdrop" onClick={() => setToolsOpen(false)} />
            <div className="plan-toolbar__sheet">
              <div
                className="plan-toolbar__sheet-tools"
                role="toolbar"
                aria-label={t('plan.toolAria')}
              >
                {toolButtons(true)}
              </div>
              {planTool === 'opening' && kindSwitch}
              {hint && <div className="plan-toolbar__hint">{hint}</div>}
            </div>
          </>
        )}
      </>
    )
  }

  // 桌面端：常驻工具行 + 尺寸开关独立一行 + 操作提示条
  return (
    <>
      <div className="plan-toolbar__row">
        <div
          className="plan-toolbar__tools segmented"
          role="toolbar"
          aria-label={t('plan.toolAria')}
        >
          {toolButtons(false)}
        </div>
        {planTool === 'opening' && kindSwitch}
      </div>
      <div className="plan-toolbar__row">{dimsButton}</div>
      {hint && <div className="plan-toolbar__hint">{hint}</div>}
    </>
  )
}
