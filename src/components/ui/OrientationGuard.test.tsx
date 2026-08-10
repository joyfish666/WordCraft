import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from '../../store/useSettingsStore'
import { OrientationGuard } from './OrientationGuard'

/** 设置 jsdom 视口尺寸（CSS 像素）并触发 resize 事件 */
function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    configurable: true,
    writable: true,
  })
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

beforeEach(() => {
  localStorage.clear()
  useSettingsStore.setState({ language: 'zh' })
  setViewport(1280, 800)
  document.documentElement.classList.remove('wc-compact')
})

afterEach(() => {
  cleanup()
  document.documentElement.classList.remove('wc-compact')
})

describe('OrientationGuard（竖屏横屏引导 + 紧凑布局类）', () => {
  it('桌面视口：只渲染子内容，不渲染覆盖层、不加紧凑类', () => {
    render(
      <OrientationGuard>
        <p>app content</p>
      </OrientationGuard>,
    )
    expect(screen.getByText('app content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(document.documentElement.classList.contains('wc-compact')).toBe(false)
  })

  it('窄屏竖放（阈值 A：宽度 <768 且 高度 > 宽度）渲染全屏覆盖层，子内容保留在 DOM', () => {
    render(
      <OrientationGuard>
        <p>app content</p>
      </OrientationGuard>,
    )
    setViewport(390, 844)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('请旋转屏幕至横屏使用')).toBeInTheDocument()
    expect(screen.getByText('横屏模式提供最佳设计体验')).toBeInTheDocument()
    // 应用层仍挂载在下方，旋转回来即时恢复不丢状态
    expect(screen.getByText('app content')).toBeInTheDocument()
    // 窄屏同样满足紧凑布局条件（宽度 ≤760）
    expect(document.documentElement.classList.contains('wc-compact')).toBe(true)
  })

  it('横屏手机（如 844×390）不渲染覆盖层，但加紧凑布局类', () => {
    render(
      <OrientationGuard>
        <p>app content</p>
      </OrientationGuard>,
    )
    setViewport(844, 390)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(document.documentElement.classList.contains('wc-compact')).toBe(true)
  })

  it('旋转回横屏（窄屏竖放 → 宽屏横放）后覆盖层消失、紧凑类移除', () => {
    render(
      <OrientationGuard>
        <p>app content</p>
      </OrientationGuard>,
    )
    setViewport(390, 844)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    setViewport(1280, 800)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(document.documentElement.classList.contains('wc-compact')).toBe(false)
  })
})
