import { useCallback, useState, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { ConfirmContext, type ConfirmOptions } from './useConfirm'

interface ConfirmDialogState extends ConfirmOptions {
  /** alert 模式：只显示主按钮 */
  showCancel: boolean
  resolve: (ok: boolean) => void
}

/**
 * 应用内确认/提示对话框（替代 window.confirm/window.alert）：
 * - 复用通用 Dialog（a11y：焦点陷阱/Escape/遮罩关闭/焦点归还），与暖色 UI 一致；
 * - Provider 挂在 main.tsx（ErrorBoundary 内），任意组件经 useConfirm() 调用。
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [state, setState] = useState<ConfirmDialogState | null>(null)

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ ...options, showCancel: true, resolve })
      }),
    [],
  )

  const alertMessage = useCallback(
    (options: ConfirmOptions) =>
      new Promise<void>((resolve) => {
        setState({ ...options, showCancel: false, resolve: () => resolve() })
      }),
    [],
  )

  /** 统一关闭入口：确认/取消/遮罩/Escape 都经过这里，先 resolve 再清状态 */
  const close = (ok: boolean): void => {
    setState((cur) => {
      cur?.resolve(ok)
      return null
    })
  }

  return (
    <ConfirmContext.Provider value={{ confirm, alertMessage }}>
      {children}
      <Dialog
        open={state !== null}
        onClose={() => close(false)}
        title={state?.title ?? ''}
        className="dialog--confirm"
      >
        <p className="dialog__message">{state?.message}</p>
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
