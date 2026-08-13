/**
 * 移动端视口判定（与 OrientationGuard 同源，供组件/内联脚本共享）。
 *
 * 全部用 JS 的 innerWidth/innerHeight（恒为 CSS 像素）判定，不用 matchMedia/媒体查询——
 * 小米系统浏览器等部分安卓浏览器对媒体查询的视口判定不可靠（notes 坑 61）。
 */

/** 紧凑布局阈值：宽度 ≤760 或 高度 ≤480（任意宽度横屏手机；桌面正常窗口高度 ≥500px 永不命中） */
export const COMPACT_WIDTH = 760
export const COMPACT_HEIGHT = 480

/** 竖屏引导阈值 A：宽度 <768 且 高度 > 宽度（窄屏竖放才拦；手机横屏/iPad/桌面均不命中） */
export const PORTRAIT_BLOCK_WIDTH = 768

/** 是否为紧凑布局视口（窄屏横屏手机）：给 <html> 加 wc-compact 类的判定条件 */
export function isCompactViewport(width: number, height: number): boolean {
  return width <= COMPACT_WIDTH || height <= COMPACT_HEIGHT
}

/** 是否为需要竖屏旋转引导的视口（窄屏竖放） */
export function isPortraitBlocked(width: number, height: number): boolean {
  return width < PORTRAIT_BLOCK_WIDTH && height > width
}
