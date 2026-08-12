import { Outlet } from 'react-router-dom'

export function AppShell() {
  // 新 UI 无侧边栏：品牌与首页/设置导航移入各页顶栏（见 HomeToolbar / SettingsPage）
  return (
    <div className="shell">
      <Outlet />
    </div>
  )
}
