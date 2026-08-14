import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileCompact } from './useMobileCompact'

/**
 * useMobileCompact 单元测试（坑 61 同源语义）：按 JS 视口判定紧凑布局
 * （宽 ≤760 或 高 ≤480，与 OrientationGuard 的 wc-compact 条件一致），监听 resize。
 */

/** 设置 jsdom 视口尺寸（CSS 像素）并触发 resize 事件（OrientationGuard.test.tsx 同款手法） */
function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
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
  setViewport(1280, 800)
})

afterEach(() => {
  cleanup()
  setViewport(1280, 800)
})

describe('useMobileCompact', () => {
  it('桌面视口初始 false；窄屏（700×390）→ true；恢复宽视口 → false', () => {
    const { result } = renderHook(() => useMobileCompact())
    expect(result.current).toBe(false)
    setViewport(700, 390)
    expect(result.current).toBe(true)
    setViewport(1280, 800)
    expect(result.current).toBe(false)
  })

  it('高度 ≤480 也判紧凑（宽视口但横屏矮窗口）', () => {
    const { result } = renderHook(() => useMobileCompact())
    setViewport(1280, 460)
    expect(result.current).toBe(true)
  })

  it('边界阈值：宽 760 恰为紧凑，761 恢复', () => {
    const { result } = renderHook(() => useMobileCompact())
    setViewport(760, 800)
    expect(result.current).toBe(true)
    setViewport(761, 800)
    expect(result.current).toBe(false)
  })

  it('卸载时移除 resize 监听', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useMobileCompact())
    unmount()
    expect(removeSpy.mock.calls.some((c) => c[0] === 'resize')).toBe(true)
    removeSpy.mockRestore()
  })
})
