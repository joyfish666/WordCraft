import { cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { createSampleModel } from '../lib/sampleModel'
import { useModelStore } from '../store/useModelStore'
import { useSettingsStore } from '../store/useSettingsStore'
import type { SceneViewerHandle } from '../components/viewport/SceneViewer'
import type { RefObject } from 'react'

/**
 * useKeyboardShortcuts 单元测试：全局快捷键的触发与「让位」守卫
 * （坑 110：模态对话框打开时全部让位；INPUT/TEXTAREA 聚焦时让位给原生文本编辑）。
 * 全部通过真实 store 状态断言行为，不 mock undo/redo。
 */

function makeViewport(): {
  ref: RefObject<SceneViewerHandle | null>
  pan: ReturnType<typeof vi.fn>
  resetView: ReturnType<typeof vi.fn>
} {
  const pan = vi.fn()
  const resetView = vi.fn()
  const handle: SceneViewerHandle = {
    resetView,
    pan,
    captureScreenshot: vi.fn(async () => null),
  }
  return { ref: { current: handle }, pan, resetView }
}

function resetStores() {
  localStorage.clear()
  useModelStore.setState({
    scene: null,
    selectedId: null,
    focusId: null,
    stepSize: 0.5,
    gizmoMode: 'translate',
    planTool: 'select',
    openingKind: 'door',
    showPlanDims: true,
    screenshotMode: false,
    initialPositions: {},
    past: [],
    future: [],
  })
  useSettingsStore.setState({ language: 'zh' })
}

/** 造一条历史条目，使 undo/redo 可被触发（场景内容对断言无关，只验证栈位移） */
function pushPast() {
  useModelStore.setState({
    past: [{ scene: createSampleModel(), editOps: [] }],
  })
}

function pushFuture() {
  useModelStore.setState({
    future: [{ scene: createSampleModel(), editOps: [] }],
  })
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('useKeyboardShortcuts', () => {
  it('Ctrl+Z 触发撤销（清空 past 并恢复场景）', () => {
    const { ref } = makeViewport()
    renderHook(() => useKeyboardShortcuts(ref))
    pushPast()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(useModelStore.getState().past).toHaveLength(0)
  })

  it('Ctrl+Shift+Z 与 Ctrl+Y 均触发重做', () => {
    const { ref } = makeViewport()
    renderHook(() => useKeyboardShortcuts(ref))
    pushFuture()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(useModelStore.getState().future).toHaveLength(0)

    pushFuture()
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(useModelStore.getState().future).toHaveLength(0)
  })

  it('Ctrl+Z 带上 Alt 不触发（修饰键组合守卫）', () => {
    const { ref } = makeViewport()
    renderHook(() => useKeyboardShortcuts(ref))
    pushPast()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, altKey: true })
    expect(useModelStore.getState().past).toHaveLength(1)
  })

  it('R 键复位视角（不带修饰键）', () => {
    const { ref, resetView } = makeViewport()
    renderHook(() => useKeyboardShortcuts(ref))
    fireEvent.keyDown(window, { key: 'r' })
    expect(resetView).toHaveBeenCalledTimes(1)
  })

  it('Ctrl/Cmd+R 不劫持浏览器刷新', () => {
    const { ref, resetView } = makeViewport()
    renderHook(() => useKeyboardShortcuts(ref))
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'r', metaKey: true })
    expect(resetView).not.toHaveBeenCalled()
  })

  it('方向键与 WASD 平移视角', () => {
    const { ref, pan } = makeViewport()
    renderHook(() => useKeyboardShortcuts(ref))
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'w' })
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.keyDown(window, { key: 's' })
    fireEvent.keyDown(window, { key: 'd' })
    expect(pan).toHaveBeenCalledTimes(5)
    // 方向与自然观感一致：← 内容右移（dx>0）、w 内容上移（dy<0）
    expect(pan).toHaveBeenNthCalledWith(1, 15, 0)
    expect(pan).toHaveBeenNthCalledWith(2, 0, -15)
  })

  it('INPUT 聚焦时快捷键让位（不撤销、不复位）', () => {
    const { ref, resetView } = makeViewport()
    renderHook(() => useKeyboardShortcuts(ref))
    pushPast()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'r' })
    expect(useModelStore.getState().past).toHaveLength(1)
    expect(resetView).not.toHaveBeenCalled()
  })

  it('TEXTAREA 聚焦时同样让位（原生撤销不被劫持）', () => {
    const { ref } = makeViewport()
    renderHook(() => useKeyboardShortcuts(ref))
    pushPast()
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.focus()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(useModelStore.getState().past).toHaveLength(1)
  })

  it('模态对话框（role="dialog"）打开时全部让位（坑 110）', () => {
    const { ref, resetView, pan } = makeViewport()
    renderHook(() => useKeyboardShortcuts(ref))
    pushPast()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'r' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(useModelStore.getState().past).toHaveLength(1)
    expect(resetView).not.toHaveBeenCalled()
    expect(pan).not.toHaveBeenCalled()
  })

  it('卸载后移除监听（不再响应快捷键）', () => {
    const { ref, resetView } = makeViewport()
    const { unmount } = renderHook(() => useKeyboardShortcuts(ref))
    unmount()
    fireEvent.keyDown(window, { key: 'r' })
    expect(resetView).not.toHaveBeenCalled()
  })
})
