import { useT, type TKey } from '../../i18n'
import { IconHome } from './icons'

export interface EmptyStateCardProps {
  /** 是否已配置 API Key（未配置时提示可先加载示例模型体验） */
  hasApiKey: boolean
  /** 点击示例标签：把示例描述填入输入框（由 HomePage 展开抽屉并聚焦） */
  onExample: (text: string) => void
  /** 未配置 API Key 时显示的「加载示例模型」入口 */
  onLoadSample: () => void
}

const EXAMPLES: Array<{ label: TKey; prompt: TKey }> = [
  { label: 'home.example1Label', prompt: 'home.example1' },
  { label: 'home.example2Label', prompt: 'home.example2' },
  { label: 'home.example3Label', prompt: 'home.example3' },
]

/** 空态引导卡：无场景时悬浮于画布中央，提供一句话生成引导与可点击示例 */
export function EmptyStateCard({ hasApiKey, onExample, onLoadSample }: EmptyStateCardProps) {
  const t = useT()

  return (
    <div className="empty-card">
      <div className="empty-card__icon">
        <IconHome />
      </div>
      <h1 className="empty-card__title">{t('home.emptyTitle')}</h1>
      <p className="empty-card__desc">{t('home.emptyDesc')}</p>
      <div className="empty-card__chips">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.prompt}
            type="button"
            className="chip"
            onClick={() => onExample(t(ex.prompt))}
          >
            {t(ex.label)}
          </button>
        ))}
      </div>
      {!hasApiKey && (
        <div className="empty-card__api">
          <p className="empty-card__api-hint">{t('home.emptyApiHint')}</p>
          <button type="button" className="chip" onClick={onLoadSample}>
            {t('home.loadSample')}
          </button>
        </div>
      )}
      <p className="empty-card__foot">{t('home.emptyFoot')}</p>
    </div>
  )
}
