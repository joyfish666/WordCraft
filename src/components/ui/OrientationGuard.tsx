import { useEffect, useState, type ReactNode } from 'react'
import { useT } from '../../i18n'

/**
 * 移动端适配（2026-08-10）：竖屏引导覆盖层 + 紧凑布局类。
 *
 * 全部用 JS 的 innerWidth/innerHeight（恒为 CSS 像素）判定，不用 matchMedia/媒体查询——
 * 小米系统浏览器等部分安卓浏览器对媒体查询的视口判定不可靠，实测横屏不命中。
 *
 * 1. 竖屏引导（阈值 A）：仅当「宽度 < 768px 且 高度 > 宽度」（窄屏竖放）时渲染全屏
 *    "请旋转"覆盖层；手机横屏 / iPad / 桌面均不拦截。应用层始终挂载在下方，
 *    旋转回来即时恢复，不丢状态。
 * 2. 紧凑布局：宽度 ≤760px 或 高度 ≤480px（任意宽度横屏手机，横屏高度恒 360-430px）
 *    时给 <html> 加 `wc-compact` 类，窄屏样式全部由该类门控（styles/global.css），
 *    桌面正常窗口（高度 ≥500px）永不命中。
 */
export function OrientationGuard({ children }: { children: ReactNode }) {
  const t = useT()
  const [blocked, setBlocked] = useState(false)
  // 临时调试信息条（定位小米浏览器移动端样式问题用，定位完成后删除）
  const [debug, setDebug] = useState('')

  useEffect(() => {
    const el = document.documentElement
    const apply = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      setBlocked(w < 768 && h > w)
      el.classList.toggle('wc-compact', w <= 760 || h <= 480)
      // 临时调试日志（定位后删除）
      console.log(
        '[wc-debug]',
        'viewport', `${w}x${h}`,
        'dpr', window.devicePixelRatio,
        'screen', `${window.screen.width}x${window.screen.height}`,
        'compact', el.classList.contains('wc-compact'),
        'blocked', w < 768 && h > w,
      )
    }
    apply()
    window.addEventListener('resize', apply)
    // 临时调试：每 500ms 刷新屏幕覆盖层信息（含平面图工具栏的计算样式），定位后删除
    const timer = window.setInterval(() => {
      const planbar = document.querySelector<HTMLElement>('.plan-toolbar')
      const cs = planbar ? getComputedStyle(planbar) : null
      let mmH480 = 'n/a'
      try {
        mmH480 = String(window.matchMedia('(max-height: 480px)').matches)
      } catch {
        // 无 matchMedia 环境忽略
      }
      setDebug(
        [
          'v3',
          `w=${window.innerWidth} h=${window.innerHeight}`,
          `dpr=${window.devicePixelRatio ?? 1}`,
          `screen=${window.screen.width}x${window.screen.height}`,
          `compact=${el.classList.contains('wc-compact')}`,
          `mm480=${mmH480}`,
          planbar ? `planbar dir=${cs?.flexDirection} top=${cs?.top}` : 'planbar=null',
        ].join(' | '),
      )
    }, 500)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', apply)
      el.classList.remove('wc-compact')
    }
  }, [])

  return (
    <>
      {children}
      <div className="wc-debug" aria-hidden="true">
        {debug}
      </div>
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
