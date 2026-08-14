import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { ConfirmContext, type ConfirmOptions } from './useConfirm'

interface ConfirmDialogState extends ConfirmOptions {
  /** alert 模式：只显示主按钮 */
  showCancel: boolean
  resolve: (ok: boolean) => void
}

/** 排队中的对话框请求（provider 未卸载前保证每个调用方都能拿到结果） */
interface PendingDialog {
  options: ConfirmOptions
  showCancel: boolean
  resolve: (ok: boolean) => void
}

/**
 * 应用内确认/提示对话框（替代 window.confirm/window.alert）：
 * - 复用通用 Dialog（a11y：焦点陷阱/Escape/遮罩关闭/焦点归还），与暖色 UI 一致；
 * - Provider 挂在 main.tsx（ErrorBoundary 内），任意组件经 useConfirm() 调用；
 * - **请求排队**：异步处理链里连续触发 confirm/alertMessage 时，后续请求进入队列，
 *   当前对话框关闭后按序弹出——直接覆盖会导致前一个 Promise 永久悬挂（调用方 await 卡死）。
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const messageId = useId()
  const [state, setState] = useState<ConfirmDialogState | null>(null)
  // 当前对话框与待弹队列放 ref（渲染状态只是镜像）：避免在 setState 更新器里做
  // 队列出队等副作用（React 严格模式会双调用更新器）
  const currentRef = useRef<ConfirmDialogState | null>(null)
  const queueRef = useRef<PendingDialog[]>([])

  /** 弹下一个：当前框存在则渲染它；否则清空。队列条目须展开为渲染态（title/message 在顶层） */
  const advance = useCallback(() => {
    const next = queueRef.current.shift() ?? null
    currentRef.current = next
      ? { ...next.options, showCancel: next.showCancel, resolve: next.resolve }
      : null
    setState(currentRef.current)
  }, [])

  /** 入队并立即弹出（队列空时） */
  const enqueue = useCallback(
    (entry: PendingDialog) => {
      queueRef.current.push(entry)
      if (!currentRef.current) advance()
    },
    [advance],
  )

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        enqueue({ options, showCancel: true, resolve })
      }),
    [enqueue],
  )

  const alertMessage = useCallback(
    (options: ConfirmOptions) =>
      new Promise<void>((resolve) => {
        enqueue({ options, showCancel: false, resolve: () => resolve() })
      }),
    [enqueue],
  )

  /** 统一关闭入口：确认/取消/遮罩/Escape 都经过这里，先 resolve 再弹下一个 */
  const close = useCallback(
    (ok: boolean): void => {
      currentRef.current?.resolve(ok)
      advance()
    },
    [advance],
  )

  // Provider 卸载时兜底：队列与当前框全部 resolve(false)，避免调用方 await 永久悬挂
  useEffect(() => {
    return () => {
      for (const q of queueRef.current) q.resolve(false)
      currentRef.current?.resolve(false)
      queueRef.current = []
      currentRef.current = null
    }
  }, [])

  return (
    <ConfirmContext.Provider value={{ confirm, alertMessage }}>
      {children}
      <Dialog
        open={state !== null}
        onClose={() => close(false)}
        title={state?.title ?? ''}
        className="dialog--confirm"
        descriptionId={messageId}
      >
        <p id={messageId} className="dialog__message">
          {state?.message}
        </p>
        <div className="dialog__actions">
          {state?.showCancel && (
            <Button variant="ghost" onClick={() => close(false)}>
              {state.cancelLabel ?? t('dialog.cancel')}
            </Button>
          )}
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {state?.confirmLabel ?? (state?.showCancel ? t('dialog.confirm') : t('dialog.ok'))}
          </Button>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  )
}
