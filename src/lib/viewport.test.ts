import { describe, expect, it } from 'vitest'
import { COMPACT_HEIGHT, COMPACT_WIDTH, isCompactViewport, isPortraitBlocked } from './viewport'

describe('viewport（移动端视口判定，坑 61 同源）', () => {
  it('紧凑视口：宽度 ≤760 或高度 ≤480 命中', () => {
    expect(isCompactViewport(390, 780)).toBe(true) // 竖屏手机
    expect(isCompactViewport(780, 400)).toBe(true) // 横屏手机
    expect(isCompactViewport(760, 500)).toBe(true) // 恰好等于阈值
    expect(isCompactViewport(1200, 800)).toBe(false) // 桌面
    expect(isCompactViewport(800, 500)).toBe(false)
  })

  it('竖屏引导：宽度 <768 且 高度 > 宽度才拦截', () => {
    expect(isPortraitBlocked(390, 780)).toBe(true)
    expect(isPortraitBlocked(780, 400)).toBe(false) // 横屏
    expect(isPortraitBlocked(390, 700)).toBe(true)
    expect(isPortraitBlocked(800, 900)).toBe(false) // iPad/桌面
  })

  it('阈值常量与 OrientationGuard 共享同一来源', () => {
    expect(COMPACT_WIDTH).toBe(760)
    expect(COMPACT_HEIGHT).toBe(480)
  })
})
