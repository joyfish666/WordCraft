import type { ColorMode } from '../types/settings'

/** 标准模式下相邻房间区分用色板 */
export const ROOM_COLORS = ['#4f7cff', '#34c98f', '#ff9f43', '#ff6b81', '#a55eea', '#ffd93d']

/** 色盲模式下高对比度色板 */
export const COLORBLIND_ROOM_COLORS = ['#1a1a2e', '#16213e', '#0f3460', '#533483', '#e94560', '#f5f5dc']

/** 家具 / 墙体默认色 */
export const FURNITURE_COLOR = '#b8c0cc'
export const FURNITURE_COLORBLIND = '#d3d3d3'

/** 按索引取房间颜色，超出色板长度自动循环 */
export function roomColor(index: number, colorMode: ColorMode): string {
  const palette = colorMode === 'colorblind' ? COLORBLIND_ROOM_COLORS : ROOM_COLORS
  return palette[index % palette.length]
}
