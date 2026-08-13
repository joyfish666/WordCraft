import { useEffect, useState } from 'react'
import { isCompactViewport } from '../lib/viewport'

/**
 * 移动端紧凑布局判定（与 OrientationGuard 的 wc-compact 同条件，供组件渲染分支使用）。
 * JS 视口判定而非媒体查询（notes 坑 61）。
 */
export function useMobileCompact(): boolean {
  const [compact, setCompact] = useState(() =>
    isCompactViewport(window.innerWidth, window.innerHeight),
  )
  useEffect(() => {
    const apply = () => setCompact(isCompactViewport(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])
  return compact
}
