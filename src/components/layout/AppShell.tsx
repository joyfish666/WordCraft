import { NavLink, Outlet } from 'react-router-dom'
import { useT } from '../../i18n'
import { useSettingsStore } from '../../store/useSettingsStore'

export function AppShell() {
  const t = useT()
  const language = useSettingsStore((s) => s.language)
  const setLanguage = useSettingsStore((s) => s.setLanguage)

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo">言</span>
          <div className="sidebar__brand-text">
            <strong>言筑</strong>
            <span>WordCraft</span>
          </div>
        </div>
        <nav className="sidebar__nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-item ${isActive ? 'nav-item--active' : ''}`}
          >
            {t('nav.home')}
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-item ${isActive ? 'nav-item--active' : ''}`}
          >
            {t('nav.settings')}
          </NavLink>
        </nav>
        <div className="sidebar__footer">
          <span>{t('nav.footer')}</span>
          <button
            type="button"
            className="lang-toggle"
            onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
            title={language === 'zh' ? 'English' : '中文'}
            aria-label={language === 'zh' ? 'Switch to English' : '切换为中文'}
          >
            {language === 'zh' ? 'EN' : '中文'}
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
