import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../store/useSettingsStore'
import { OrientationGuard } from './OrientationGuard'

/** 伪造 matchMedia：matches 可变 + 记录监听器，便于模拟「旋转回横屏」的 change 事件 */
function createFakeMatchMedia(initialMatches: boolean) {
  const listeners = new Set<() => void>()
  let matches = initialMatches
  const mql = {
    get matches() {
      return matches
    },
    addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => mql))
  return {
    listeners,
    setMatches: (v: boolean) => {
      matches = v
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  useSettingsStore.setState({ language: 'zh' })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OrientationGuard（竖屏横屏引导）', () => {
  it('jsdom 无 matchMedia 时默认放行，只渲染子内容', () => {
    render(
      <OrientationGuard>
        <p>app content</p>
      </OrientationGuard>,
    )
    expect(screen.getByText('app content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('窄屏竖放（阈值 A）时渲染全屏覆盖层，子内容保留在 DOM', () => {
    createFakeMatchMedia(true)
    render(
      <OrientationGuard>
        <p>app content</p>
      </OrientationGuard>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('请旋转屏幕至横屏使用')).toBeInTheDocument()
    expect(screen.getByText('横屏模式提供最佳设计体验')).toBeInTheDocument()
    // 应用层仍挂载在下方，旋转回来即时恢复不丢状态
    expect(screen.getByText('app content')).toBeInTheDocument()
  })

  it('非窄屏竖放（横屏/平板/桌面）不渲染覆盖层', () => {
    createFakeMatchMedia(false)
    render(
      <OrientationGuard>
        <p>app content</p>
      </OrientationGuard>,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('app content')).toBeInTheDocument()
  })

  it('旋转回横屏（matchMedia change）后覆盖层消失', () => {
    const fake = createFakeMatchMedia(true)
    render(
      <OrientationGuard>
        <p>app content</p>
      </OrientationGuard>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    act(() => {
      fake.setMatches(false)
      fake.listeners.forEach((cb) => cb())
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
