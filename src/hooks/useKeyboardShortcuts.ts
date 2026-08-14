import { useEffect, type RefObject } from 'react'
import type { SceneViewerHandle } from '../components/viewport/SceneViewer'
import { useModelStore } from '../store/useModelStore'

/** 方向键平移视角的位移量（屏幕像素等效） */
const PAN_STEP = 15

/**
 * 全局键盘快捷键：方向键/WASD 平移视角；R 复位视角；Ctrl+Z 撤销、Ctrl+Shift+Z / Ctrl+Y 重做。
 * 输入框/文本框聚焦时不拦截，让位给原生文本编辑（含原生撤销）；
 * 模态对话框（ConfirmDialog/ShareDialog/项目库/帮助，均带 role="dialog"）打开时全部让位——
 * 否则对话框聚焦陷阱外的 Ctrl+Z/R 等仍会作用于背后的场景（撤销模型/复位视角），
 * 破坏性操作与对话框按钮语义脱节，对键盘用户尤其危险。
 */
export function useKeyboardShortcuts(viewportRef: RefObject<SceneViewerHandle | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      const active = document.activeElement
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return

      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault()
          useModelStore.getState().undo()
          return
        }
        if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault()
          useModelStore.getState().redo()
          return
        }
      }

      // 不带修饰键的 R 才复位视角；Ctrl/Cmd+R 留给浏览器刷新
      if (!mod && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        viewportRef.current?.resetView()
        return
      }

      const controls = viewportRef.current
      if (!controls) return
      let dx = 0
      let dy = 0
      // 方向与自然观感一致（W/↑=看向北/前，A/←=看向西/左）；属性面板微调按钮不受影响
      switch (e.key.toLowerCase()) {
        case 'arrowleft':
        case 'a':
          dx = PAN_STEP
          break
        case 'arrowright':
        case 'd':
          dx = -PAN_STEP
          break
        case 'arrowup':
        case 'w':
          dy = -PAN_STEP
          break
        case 'arrowdown':
        case 's':
          dy = PAN_STEP
          break
        default:
          return
      }
      e.preventDefault()
      controls.pan(dx, dy)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewportRef])
}
