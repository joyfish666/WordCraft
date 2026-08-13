import { isCorridorName } from './roomGeometry'
import type { ColorMode } from '../types/settings'

/** 标准模式下相邻房间区分用色板 */
export const ROOM_COLORS = ['#4f7cff', '#34c98f', '#ff9f43', '#ff6b81', '#a55eea', '#ffd93d']

/** 色盲模式下高对比度色板 */
export const COLORBLIND_ROOM_COLORS = [
  '#1a1a2e',
  '#16213e',
  '#0f3460',
  '#533483',
  '#e94560',
  '#f5f5dc',
]

/** 家具 / 墙体默认色（浅色主题下取中深灰绿，保证在米色底上可辨） */
export const FURNITURE_COLOR = '#838a7c'
export const FURNITURE_COLORBLIND = '#6f6f6f'
/** 家具副部件色（床垫/桌腿/座面等）：中性偏深，标准与色盲模式下均与主色可辨 */
export const FURNITURE_PART_DARK = '#5b615c'
/** 家具深色强调部件（床头板/柜门/电视屏等）：与浅色主色对比鲜明，两种模式均可辨 */
export const FURNITURE_PART_INK = '#3f4550'

/** 走廊默认色（共享墙优先按房间标色，走廊自身墙用此默认色） */
export const CORRIDOR_COLOR = '#a0a594'
export const CORRIDOR_COLORBLIND = '#8d918a'

/** 入户门扇颜色（醒目的暖色，与室内门洞区分） */
export const ENTRANCE_DOOR_COLOR = '#e8644a'
/** 入户标识牌颜色（门洞上方浮动标记，浅色底上用深黄保证可辨） */
export const ENTRANCE_MARKER_COLOR = '#c8901e'

/** 按索引取房间颜色，超出色板长度自动循环 */
export function roomColor(index: number, colorMode: ColorMode): string {
  const palette = colorMode === 'colorblind' ? COLORBLIND_ROOM_COLORS : ROOM_COLORS
  return palette[index % palette.length]
}

/**
 * 房间面颜色：走廊用默认色，其余按兄弟索引取色板色。
 * 供 3D 渲染与 2D 平面图共用，保证两种视图下房间颜色一致。
 */
export function roomFaceColor(name: string, siblingIndex: number, colorMode: ColorMode): string {
  if (isCorridorName(name)) {
    return colorMode === 'colorblind' ? CORRIDOR_COLORBLIND : CORRIDOR_COLOR
  }
  return roomColor(siblingIndex, colorMode)
}
