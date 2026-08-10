import { useEffect, useState, type ReactNode } from 'react'
import { useT } from '../../i18n'

/**
 * 竖屏横屏引导（移动端横屏限定，2026-08-10）。
 *
 * 阈值 A（与文档一致）：仅当「宽度 < 768px 且 高度 > 宽度」（窄屏竖放）时提示旋转，
 * 手机横屏 / iPad / 桌面均不受影响——桌面端宽高比正常时本组件不渲染任何内容。
 *
 * 实现：matchMedia 监听窄屏+竖屏媒体查询，切换时渲染全屏覆盖层（应用层仍挂载在
 * 下方，旋转回来即时恢复，不丢状态）。jsdom 无 matchMedia 时默认放行。
 */
const PORTRAIT_NARROW_QUERY = '(max-width: 767px) and (orientation: portrait)'

export function OrientationGuard({ children }: { children: ReactNode }) {
  const t = useT()
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(PORTRAIT_NARROW_QUERY)
    const update = () => setBlocked(mql.matches)
    update()
    // 现代浏览器走 matchMedia change；resize 兜底（旧 Safari 无 addEventListener 时仍能响应旋转）
    mql.addEventListener?.('change', update)
    window.addEventListener('resize', update)
    return () => {
      mql.removeEventListener?.('change', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return (
    <>
      {children}
      {blocked && (
        <div className="orientation-guard" role="alert" aria-label={t('orientation.title')}>
          <div className="orientation-guard__phone" aria-hidden="true" />
          <p className="orientation-guard__title">{t('orientation.title')}</p>
          <p className="orientation-guard__subtitle">{t('orientation.subtitle')}</p>
        </div>
      )}
    </>
  )
}
