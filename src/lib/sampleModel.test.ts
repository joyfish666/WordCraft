import { describe, expect, it } from 'vitest'
import { createSampleModel } from './sampleModel'

describe('createSampleModel（示例模型）', () => {
  it('走布局引擎生成：整屋可迁移校验通过，房间与家具齐全', () => {
    const model = createSampleModel()
    expect(model.version).toBe(3)
    const rooms = model.root.levels[0].rooms
    // 6 个房间 + 1 条走廊（走廊也作为房间节点参与布局）
    expect(rooms.length).toBe(7)
    expect(rooms.some((r) => r.id === 'room-living')).toBe(true)
    expect(rooms.some((r) => r.name === '走廊')).toBe(true)
    // 主卧内嵌卫生间保留在嵌套数组
    const master = rooms.find((r) => r.id === 'room-master')!
    expect(master.nestedRooms.map((r) => r.name)).toEqual(['主卧卫生间'])
    // 家具随布局保留
    const living = rooms.find((r) => r.id === 'room-living')!
    expect(living.furniture.length).toBeGreaterThanOrEqual(3)
    // 入户房间标记（南外墙入户；entranceDir 缺省即 south）
    expect(model.root.entranceRoomId).toBe('room-living')
  })
})
