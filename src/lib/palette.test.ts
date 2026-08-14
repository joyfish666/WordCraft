import { describe, expect, it } from 'vitest'
import {
  CORRIDOR_COLOR,
  CORRIDOR_COLORBLIND,
  darkenHex,
  mixHex,
  roomColor,
  roomFaceColor,
  softenTint,
} from './palette'

describe('palette（房间配色）', () => {
  it('roomColor 按索引取色板色并循环', () => {
    expect(roomColor(0, 'standard')).toBe('#4f7cff')
    expect(roomColor(6, 'standard')).toBe('#4f7cff') // 超出色板长度循环
    expect(roomColor(0, 'colorblind')).toBe('#1a1a2e')
  })

  it('走廊房间用默认色（两种模式）', () => {
    expect(roomFaceColor('走廊', 0, 'standard')).toBe(CORRIDOR_COLOR)
    expect(roomFaceColor('走廊', 3, 'colorblind')).toBe(CORRIDOR_COLORBLIND)
  })

  it('普通房间按兄弟索引取色', () => {
    expect(roomFaceColor('客厅', 2, 'standard')).toBe(roomColor(2, 'standard'))
    expect(roomFaceColor('卧室', 1, 'colorblind')).toBe(roomColor(1, 'colorblind'))
  })
})

describe('palette 颜色工具（材质层）', () => {
  it('mixHex 线性混合', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#ff0000', '#00ff00', 1)).toBe('#00ff00')
    expect(mixHex('#102030', '#ffffff', 0)).toBe('#102030')
  })

  it('darkenHex 变暗（factor=1 不变）', () => {
    expect(darkenHex('#4f7cff', 0.55)).toBe('#2b448c')
    expect(darkenHex('#4f7cff', 1)).toBe('#4f7cff')
  })

  it('softenTint 向白色淡化', () => {
    expect(softenTint('#4f7cff', 0.5)).toBe('#a7beff')
    expect(softenTint('#ffffff', 1)).toBe('#ffffff')
  })
})
