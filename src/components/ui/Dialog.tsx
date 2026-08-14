import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
  /** 说明文案 id（挂到消息区后经 aria-describedby 关联，读屏器读出完整语义） */
  descriptionId?: string
}

/** 对话框内可聚焦元素选择器（焦点陷阱 / 初始聚焦用） */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 通用模态对话框（a11y 收敛，坑 C9）：
 * - role="dialog" + aria-modal + aria-labelledby（标题关联）+ 可选 aria-describedby；
 * - Portal 到 document.body：祖先的 transform/filter/overflow 不再破坏 fixed 定位与滚动；
 * - 打开时锁定 body 滚动，关闭时恢复；
 * - Escape 关闭、遮罩点击关闭、内容点击不冒泡；
 * - 打开时聚焦首个可聚焦元素，关闭时焦点归还触发元素；
 * - Tab 焦点陷阱：焦点在首尾元素间循环，不逃出对话框。
 * 保留 .dialog-overlay/.dialog 结构，样式与既有对话框一致。
 */
export function Dialog({ open, onClose, title, children, className, descriptionId }: DialogProps) {
  const titleId = useId()
  const overlayRef = useRef<HTMLDivElement>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    lastFocusedRef.current = document.activeElement as HTMLElement | null
    overlayRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus()
    // 模态对话框打开时锁定背景滚动（原实现背景可滚动，与 aria-modal 语义不符）
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      // 关闭/卸载时焦点归还触发元素
      lastFocusedRef.current?.focus?.()
    }
  }, [open])

  if (!open) return null

  /** Tab 焦点陷阱：焦点逃出对话框时循环回内部 */
  const trapTab = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return
    const el = overlayRef.current
    if (!el) return
    const focusables = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    if (focusables.length === 0) {
      e.preventDefault()
      return
    }
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const overlay = (
    <div
      ref={overlayRef}
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClick={onClose}
      onKeyDown={(e) => {
        trapTab(e)
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className={`dialog ${className ?? ''}`} onClick={(e) => e.stopPropagation()}>
        <h3 id={titleId} className="dialog__title">
          {title}
        </h3>
        {children}
      </div>
    </div>
  )
  return createPortal(overlay, document.body)
}
