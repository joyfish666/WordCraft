import { NavLink, Outlet } from 'react-router-dom'
import { useT } from '../../i18n'

export function AppShell() {
  const t = useT()

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
        <div className="sidebar__footer">{t('nav.footer')}</div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
