import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { OrientationGuard } from './components/ui/OrientationGuard'
import { useT } from './i18n'
import { HomePage } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'
import { useSettingsStore } from './store/useSettingsStore'

export default function App() {
  const language = useSettingsStore((s) => s.language)
  const t = useT()

  // 语言切换时同步 html lang、页面标题与 meta 描述
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    document.title = t('app.title')
    const meta = document.querySelector('meta[name="description"]')
    if (meta) meta.setAttribute('content', t('app.desc'))
  }, [language, t])

  return (
    <OrientationGuard>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </OrientationGuard>
  )
}
