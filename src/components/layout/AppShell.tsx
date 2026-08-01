import { NavLink, Outlet } from 'react-router-dom'

export function AppShell() {
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
            首页
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-item ${isActive ? 'nav-item--active' : ''}`}
          >
            设置
          </NavLink>
        </nav>
        <div className="sidebar__footer">纯前端 · 数据本地存储</div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
