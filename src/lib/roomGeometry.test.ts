import { describe, expect, it } from 'vitest'
import { doorDirection, isCorridorName } from './roomGeometry'

describe('isCorridorName', () => {
  it('识别走廊/连廊/过道/通道', () => {
    expect(isCorridorName('走廊')).toBe(true)
    expect(isCorridorName('连廊')).toBe(true)
    expect(isCorridorName('过道')).toBe(true)
    expect(isCorridorName('中庭通道')).toBe(true)
  })

  it('普通房间不是走廊', () => {
    expect(isCorridorName('主卧')).toBe(false)
    expect(isCorridorName('客厅')).toBe(false)
  })
})

describe('doorDirection', () => {
  it('房间在整屋左侧时门朝东（指向中心）', () => {
    expect(doorDirection({ position: { x: -2, y: 1.4, z: 0 } })).toBe('east')
  })

  it('房间在整屋右侧时门朝西', () => {
    expect(doorDirection({ position: { x: 2, y: 1.4, z: 0 } })).toBe('west')
  })

  it('房间在整屋上方时门朝南', () => {
    expect(doorDirection({ position: { x: 0, y: 1.4, z: 1.5 } })).toBe('south')
  })

  it('房间在整屋下方时门朝北', () => {
    expect(doorDirection({ position: { x: 0, y: 1.4, z: -1.5 } })).toBe('north')
  })

  it('房间位于中心时默认朝北', () => {
    expect(doorDirection({ position: { x: 0, y: 1.4, z: 0 } })).toBe('north')
  })
})
