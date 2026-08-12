import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../../i18n'
import { Button } from './Button'

interface ErrorBoundaryState {
  error: Error | null
}

interface ErrorBoundaryProps {
  children: ReactNode
}

/**
 * 顶层错误边界：渲染异常（如持久化数据迁移失败）时不再白屏，
 * 展示可读错误与「重置本地数据」恢复入口（清空 localStorage + 重载）。
 * 说明：本地数据损坏是纯前端应用最常见的崩溃源，重置后应用可恢复使用。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[wordcraft] render error:', error, info.componentStack)
  }

  private handleReset = (): void => {
    try {
      localStorage.clear()
    } catch {
      // 隐私模式等场景可能抛错，忽略并直接重载
    }
    location.reload()
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-boundary">
        <h1 className="error-boundary__title">{t('error.boundaryTitle')}</h1>
        <p className="error-boundary__desc">{t('error.boundaryDesc')}</p>
        <p className="error-boundary__detail">{this.state.error.message}</p>
        <div className="error-boundary__actions">
          <Button variant="danger" onClick={this.handleReset}>
            {t('error.boundaryReset')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              this.setState({ error: null })
            }}
          >
            {t('error.boundaryRetry')}
          </Button>
        </div>
      </div>
    )
  }
}
