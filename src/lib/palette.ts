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

/** 走廊默认色（暖灰褐，与木地板邻接不突兀；共享墙优先按房间标色，走廊自身墙用此默认色） */
export const CORRIDOR_COLOR = '#a89e8c'
export const CORRIDOR_COLORBLIND = '#8d918a'

/** 入户门扇颜色（醒目的暖色，与室内门洞区分） */
export const ENTRANCE_DOOR_COLOR = '#e8644a'

/** 外墙基座勒脚色（深暖灰，压出建筑底部轮廓） */
export const PLINTH_COLOR = '#78705c'
/** 屋顶封檐板 / 女儿墙压顶色（浅暖白，与深色屋面板形成檐口层次） */
export const ROOF_TRIM_COLOR = '#e6e1d2'

/** 内墙统一色（暖白抹灰；房间识别色只保留在地板上，墙身中性化） */
export const WALL_INTERIOR_COLOR = '#f0ede4'
/** 外墙饰面色（近白抹灰，比内墙亮一档：建筑从地面中跳出） */
export const WALL_EXTERIOR_COLOR = '#f5f1e6'
/** 门套/窗套/踢脚线木色 */
export const TRIM_COLOR = '#8a6f4f'
/** 屋顶板/女儿墙色（深暖灰，与天空形成剪影对比） */
export const ROOF_COLOR = '#56503f'
/** 屋顶女儿墙略浅一档 */
export const ROOF_PARAPET_COLOR = '#605a48'
/** 室外地面（灰绿草地，与米色建筑形成冷暖对比） */
export const GROUND_COLOR = '#a8b795'
/** 入户石板小径色（暖砂岩，与草地冷暖对比） */
export const GROUND_PATH_COLOR = '#c7bda1'
/** 地板厚度侧面（外露处）深色 */
export const FLOOR_SIDE_COLOR = '#8d8570'

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

// ---------------------------------------------------------------------------
// 颜色工具（材质层用：hex 混合/变暗/淡化）
// ---------------------------------------------------------------------------

/** 解析 #rrggbb 为 [r,g,b]（0..255） */
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** 两色线性混合：t=0 → a，t=1 → b */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a)
  const [br, bg, bb] = parseHex(b)
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

/** 变暗：factor∈(0,1]（1=不变），值越小越暗 */
export function darkenHex(hex: string, factor: number): string {
  const [r, g, b] = parseHex(hex)
  return toHex(r * factor, g * factor, b * factor)
}

/** 向白色淡化：white∈(0,1) 为掺白比例，用于把识别色柔化成地板 tint */
export function softenTint(hex: string, white: number): string {
  return mixHex(hex, '#ffffff', white)
}

/** 踢脚线色：房间色加深，保留色相识别 */
export function skirtingColor(roomColorHex: string): string {
  return darkenHex(roomColorHex, 0.55)
}
