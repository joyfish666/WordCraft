import { useT } from '../../i18n'
import { useSettingsStore } from '../../store/useSettingsStore'

/**
 * 语言切换按钮（全站唯一实现）：显示目标语言（中文时显示 EN，英文时显示 中文），点击切换。
 * 顶部工具栏与设置页共用同一组件与 .lang-btn 样式（单一来源，避免双实现样式分叉）。
 */
export function LanguageToggle({ className = 'lang-btn' }: { className?: string }) {
  const language = useSettingsStore((s) => s.language)
  const setLanguage = useSettingsStore((s) => s.setLanguage)
  const next = language === 'zh' ? 'en' : 'zh'
  const t = useT()
  const label = next === 'zh' ? t('lang.switchToZh') : t('lang.switchToEn')

  return (
    <button
      type="button"
      className={className}
      onClick={() => setLanguage(next)}
      title={label}
      aria-label={label}
    >
      {next === 'en' ? 'EN' : '中文'}
    </button>
  )
}
