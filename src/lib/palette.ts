import type { ColorMode } from '../types/settings'

/** 标准模式下相邻房间区分用色板 */
export const ROOM_COLORS = ['#4f7cff', '#34c98f', '#ff9f43', '#ff6b81', '#a55eea', '#ffd93d']

/** 色盲模式下高对比度色板 */
export const COLORBLIND_ROOM_COLORS = ['#1a1a2e', '#16213e', '#0f3460', '#533483', '#e94560', '#f5f5dc']

/** 家具 / 墙体默认色 */
export const FURNITURE_COLOR = '#b8c0cc'
export const FURNITURE_COLORBLIND = '#d3d3d3'

/** 走廊默认色（共享墙优先按房间标色，走廊自身墙用此默认色） */
export const CORRIDOR_COLOR = '#b8c0cc'
export const CORRIDOR_COLORBLIND = '#c2c6cd'

/** 入户门扇颜色（醒目的暖色，与室内门洞区分） */
export const ENTRANCE_DOOR_COLOR = '#e8644a'
/** 入户标识牌颜色（门洞上方浮动标记，亮黄色） */
export const ENTRANCE_MARKER_COLOR = '#ffd93d'

/** 按索引取房间颜色，超出色板长度自动循环 */
export function roomColor(index: number, colorMode: ColorMode): string {
  const palette = colorMode === 'colorblind' ? COLORBLIND_ROOM_COLORS : ROOM_COLORS
  return palette[index % palette.length]
}
