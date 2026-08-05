import { useEffect, useState } from 'react'
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
function NameField({ value, onCommit }: NameFieldProps) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  const commit = () => {
    const trimmed = text.trim()
    if (trimmed && trimmed !== value) onCommit(trimmed)
    else setText(value)
  }

  return (
    <input
      className="input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

const TYPE_LABEL: Record<ModelNode['type'], TKey> = {
  house: 'property.typeHouse',
  room: 'property.typeRoom',
  furniture: 'property.typeFurniture',
  wall: 'property.typeWall',
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
  const initialPositions = useModelStore((s) => s.initialPositions)
  const t = useT()

  const canReset = initialPositions[node.id] !== undefined
  const patchDim = (key: keyof Dimensions, v: number) => updateSelected({ dimensions: { [key]: v } })
  const patchPos = (key: keyof Position, v: number) => updateSelected({ position: { [key]: v } })

  return (
    <aside className="prop-panel">
      <header className="prop-panel__header">
        <div className="prop-panel__title-wrap">
          <span className="prop-panel__type">{t(TYPE_LABEL[node.type])}</span>
          <h3 className="prop-panel__title">{node.name}</h3>
        </div>
        <Button
          variant="ghost"
          className="prop-panel__close"
          title={t('property.closeTitle')}
          onClick={() => selectNode(null)}
        >
          ×
        </Button>
      </header>

      <div className="prop-field">
        <span className="prop-field__label">{t('property.name')}</span>
        <NameField value={node.name} onCommit={(name) => updateSelected({ name })} />
      </div>

      <div className="prop-panel__section">
        <span className="prop-panel__section-title">{t('property.dimSection')}</span>
        <div className="prop-panel__grid">
          <NumberField label={t('property.length')} value={node.dimensions.length} min={0.1} onCommit={(v) => patchDim('length', v)} />
          <NumberField label={t('property.width')} value={node.dimensions.width} min={0.1} onCommit={(v) => patchDim('width', v)} />
          <NumberField label={t('property.height')} value={node.dimensions.height} min={0.1} onCommit={(v) => patchDim('height', v)} />
        </div>
      </div>

      <div className="prop-panel__section">
        <span className="prop-panel__section-title">{t('property.posSection')}</span>
        <div className="prop-panel__grid">
          <NumberField label="X" value={node.position.x} onCommit={(v) => patchPos('x', v)} />
          <NumberField label="Y" value={node.position.y} onCommit={(v) => patchPos('y', v)} />
          <NumberField label="Z" value={node.position.z} onCommit={(v) => patchPos('z', v)} />
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
        <div className="prop-panel__step">
          {STEP_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={`step-btn ${stepSize === s ? 'step-btn--active' : ''}`}
              onClick={() => setStepSize(s)}
            >
              {s}m
            </button>
          ))}
        </div>
        {/* 方向说明：默认南视角下世界 +x 投影在屏幕左侧、罗盘 E 在屏幕右侧（罗盘 E=世界 -x）。
            按钮按罗盘方向移动：东=-x、西=+x；北=+z、南=-z。内部墙/走廊的 east=+x 只是代码内部约定。 */}
        <div className="prop-nudge">
          <button type="button" className="prop-nudge__btn" title={t('property.nudgeWest')} onClick={() => translateSelected(stepSize, 0, 0)}>
            {t('property.west')}
          </button>
          <button type="button" className="prop-nudge__btn" title={t('property.nudgeNorth')} onClick={() => translateSelected(0, 0, stepSize)}>
            {t('property.north')}
          </button>
          <button type="button" className="prop-nudge__btn" title={t('property.nudgeEast')} onClick={() => translateSelected(-stepSize, 0, 0)}>
            {t('property.east')}
          </button>
          <button type="button" className="prop-nudge__btn" title={t('property.nudgeSouth')} onClick={() => translateSelected(0, 0, -stepSize)}>
            {t('property.south')}
          </button>
          <button type="button" className="prop-nudge__btn" title={t('property.nudgeUp')} onClick={() => translateSelected(0, stepSize, 0)}>
            {t('property.up')}
          </button>
          <button type="button" className="prop-nudge__btn" title={t('property.nudgeDown')} onClick={() => translateSelected(0, -stepSize, 0)}>
            {t('property.down')}
          </button>
        </div>
      </div>
    </aside>
  )
}
