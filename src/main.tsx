import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ConfirmProvider } from './components/ui/ConfirmDialog'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import './styles/global.css'

// GitHub Pages 项目站点部署（vite base=/WordCraft/）：路由必须知道自己的 base 前缀，
// 否则 index.html 深链接还原脚本保留前缀后（/WordCraft/settings）路由匹配不上。
// 与 vite.config.ts 的 base 单一来源（import.meta.env.BASE_URL），改名仓库只需改 base。
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ConfirmProvider>
        <BrowserRouter basename={basename}>
          <App />
        </BrowserRouter>
      </ConfirmProvider>
    </ErrorBoundary>
  </StrictMode>,
)
