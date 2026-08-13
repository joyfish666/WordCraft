import { useT } from '../../i18n'
import { useSettingsStore } from '../../store/useSettingsStore'
import { Button } from './Button'

/**
 * 语言切换按钮：显示目标语言（中文时显示 EN，英文时显示 中文），点击切换。
 * 放在各页面顶部工具栏，保证显眼且常驻。
 */
export function LanguageToggle() {
  const language = useSettingsStore((s) => s.language)
  const setLanguage = useSettingsStore((s) => s.setLanguage)
  const next = language === 'zh' ? 'en' : 'zh'
  const t = useT()
  const label = next === 'zh' ? t('lang.switchToZh') : t('lang.switchToEn')

  return (
    <Button
      variant="ghost"
      className="lang-toggle-btn"
      onClick={() => setLanguage(next)}
      title={label}
      aria-label={label}
    >
      {next === 'en' ? 'EN' : '中文'}
    </Button>
  )
}
