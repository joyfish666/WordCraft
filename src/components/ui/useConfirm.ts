import { createContext, useContext } from 'react'

export interface ConfirmOptions {
  /** 对话框标题 */
  title: string
  /** 说明文案（支持 i18n 插值后的完整句子） */
  message: string
  /** 主按钮文案；缺省「确定」（alert 模式下为「好」） */
  confirmLabel?: string
  /** 取消按钮文案；缺省「取消」（alert 模式隐藏取消按钮） */
  cancelLabel?: string
  /** 危险操作（删除等）：主按钮用红色危险样式 */
  danger?: boolean
}

export interface ConfirmContextValue {
  /** 弹确认框：返回 Promise<boolean>，确定 resolve(true)、取消/遮罩/Escape resolve(false) */
  confirm: (options: ConfirmOptions) => Promise<boolean>
  /** 弹纯提示框：只有一个「好」按钮，resolve 后结束（替代 window.alert） */
  alertMessage: (options: ConfirmOptions) => Promise<void>
}

export const ConfirmContext = createContext<ConfirmContextValue | null>(null)

/** 获取 confirm/alertMessage；必须在 <ConfirmProvider> 树内使用 */
export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm 必须在 <ConfirmProvider> 内使用')
  return ctx
}
