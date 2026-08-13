import { describe, expect, it } from 'vitest'
import { CORRIDOR_COLOR, CORRIDOR_COLORBLIND, roomColor, roomFaceColor } from './palette'

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
