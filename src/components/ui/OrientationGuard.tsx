import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { isCompactViewport, isPortraitBlocked } from '../../lib/viewport'

/**
 * 移动端适配（2026-08-10）：竖屏引导覆盖层 + 紧凑布局类。
 *
 * 全部用 JS 的 innerWidth/innerHeight（恒为 CSS 像素）判定，不用 matchMedia/媒体查询——
 * 小米系统浏览器等部分安卓浏览器对媒体查询的视口判定不可靠，实测横屏漏命中。
 * 判定阈值与 HomePage 的 useMobileCompact 共用 lib/viewport.ts（坑 61）。
 *
 * 1. 竖屏引导（阈值 A）：仅当「宽度 < 768px 且 高度 > 宽度」（窄屏竖放）时渲染全屏
 *    "请旋转"覆盖层；手机横屏 / iPad / 桌面均不拦截。应用层始终挂载在下方，
 *    旋转回来即时恢复，不丢状态。
 * 2. 紧凑布局：宽度 ≤760px 或 高度 ≤480px（任意宽度横屏手机，横屏高度恒 360-430px）
 *    时给 <html> 加 `wc-compact` 类，窄屏样式全部由该类门控（styles/mobile.css），
 *    桌面正常窗口（高度 ≥500px）永不命中。
 */
export function OrientationGuard({ children }: { children: ReactNode }) {
  const t = useT()
  const [blocked, setBlocked] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = document.documentElement
    const apply = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      setBlocked(isPortraitBlocked(w, h))
      el.classList.toggle('wc-compact', isCompactViewport(w, h))
    }
    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      el.classList.remove('wc-compact')
    }
  }, [])

  // 覆盖层出现时把焦点移入：键盘用户 Tab 不到被遮挡的背景控件
  useEffect(() => {
    if (blocked) overlayRef.current?.focus()
  }, [blocked])

  /** 覆盖层内无可聚焦元素：Tab 留在覆盖层上，不逃逸到背景 */
  const trapTab = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Tab') e.preventDefault()
  }

  return (
    <>
      {children}
      {blocked && (
        <div
          ref={overlayRef}
          className="orientation-guard"
          role="alert"
          aria-label={t('orientation.title')}
          tabIndex={-1}
          onKeyDown={trapTab}
        >
          <div className="orientation-guard__phone" aria-hidden="true" />
          <p className="orientation-guard__title">{t('orientation.title')}</p>
          <p className="orientation-guard__subtitle">{t('orientation.subtitle')}</p>
        </div>
      )}
    </>
  )
}
