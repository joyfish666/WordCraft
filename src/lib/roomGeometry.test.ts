import { describe, expect, it } from 'vitest'
import type { ContainerNode } from '../types/model'
import { computeWallPlan, doorDirection, isCorridorName } from './roomGeometry'

function room(
  id: string,
  name: string,
  x: number,
  z: number,
  len: number,
  wid: number,
  h = 2.8,
): ContainerNode {
  return {
    id,
    type: 'room',
    name,
    dimensions: { length: len, width: wid, height: h },
    position: { x, y: h / 2, z },
    children: [],
  }
}

describe('isCorridorName', () => {
  it('识别走廊/连廊/过道/通道', () => {
    expect(isCorridorName('走廊')).toBe(true)
    expect(isCorridorName('连廊')).toBe(true)
    expect(isCorridorName('过道')).toBe(true)
  })

  it('普通房间不是走廊', () => {
    expect(isCorridorName('主卧')).toBe(false)
    expect(isCorridorName('客厅')).toBe(false)
  })
})

describe('doorDirection（兜底门朝向）', () => {
  it('房间在整屋左侧时门朝东（指向中心）', () => {
    expect(doorDirection({ position: { x: -2, y: 1.4, z: 0 } })).toBe('east')
  })

  it('房间位于中心时默认朝北', () => {
    expect(doorDirection({ position: { x: 0, y: 1.4, z: 0 } })).toBe('north')
  })
})

describe('computeWallPlan（墙体方案）', () => {
  it('相邻房间共享墙只渲染一堵，并由非走廊房间持有', () => {
    const master = room('master', '主卧', -2, 0, 3, 3)
    const corridor = room('corridor', '走廊', 0, 0, 1, 4)
    const plan = computeWallPlan([master, corridor])
    const mp = plan.get('master')!
    const cp = plan.get('corridor')!
    // 主卧持有东墙：渲染且开门
    expect(mp.east.render).toBe(true)
    expect(mp.east.hasDoor).toBe(true)
    expect(mp.east.shared).toBe(true)
    // 走廊西墙不再渲染（共享墙去重）
    expect(cp.west.render).toBe(false)
    expect(cp.west.shared).toBe(true)
    // 走廊其他墙仍渲染
    expect(cp.north.render).toBe(true)
    expect(cp.south.render).toBe(true)
  })

  it('两个非走廊房间相邻时由 id 较小者持有共享墙', () => {
    const a = room('a', '客厅', 0, -1.5, 3, 3)
    const b = room('b', '主卧', 0, 1.5, 3, 3)
    const plan = computeWallPlan([a, b])
    expect(plan.get('a')!.north.render).toBe(true)
    expect(plan.get('a')!.north.hasDoor).toBe(true)
    expect(plan.get('b')!.south.render).toBe(false)
  })

  it('走廊两侧：封闭房间开门，开放房间与走廊开放连通', () => {
    const master = room('master', '主卧', -2, 0, 3, 3)
    const corridor = room('corridor', '走廊', 0, 0, 1, 4)
    const living = room('living', '客厅', 2, 0, 3, 3)
    const plan = computeWallPlan([master, corridor, living])
    // 主卧封闭：东墙朝走廊，渲染并开门
    expect(plan.get('master')!.east.render).toBe(true)
    expect(plan.get('master')!.east.hasDoor).toBe(true)
    // 客厅开放：与走廊之间不设墙（开放连通）
    expect(plan.get('living')!.west.render).toBe(false)
    expect(plan.get('corridor')!.east.render).toBe(false)
    // 走廊西墙由主卧持有（不重复渲染）
    expect(plan.get('corridor')!.west.render).toBe(false)
  })

  it('无相邻房间时兜底开一扇朝整屋中心的门', () => {
    const a = room('a', '客厅', 0, 0, 3, 3)
    const plan = computeWallPlan([a])
    expect(plan.get('a')!.north.hasDoor).toBe(true)
    expect(plan.get('a')!.east.render).toBe(true)
  })
})

describe('开放空间与入户门', () => {
  it('客厅与走廊之间不设墙（开放连通）', () => {
    const living = room('living', '客厅', 0, -1.5, 3, 3)
    const corridor = room('corridor', '走廊', 0, 0.5, 1, 1)
    const plan = computeWallPlan([living, corridor])
    expect(plan.get('living')!.north.render).toBe(false)
    expect(plan.get('corridor')!.south.render).toBe(false)
  })

  it('入户门开在指定房间的南外墙', () => {
    const living = room('living', '客厅', 0, -2, 3, 3)
    const master = room('master', '主卧', 0, 2, 3, 3)
    const plan = computeWallPlan([living, master], { entrance: 'south', entranceRoomId: 'living' })
    expect(plan.get('living')!.south.render).toBe(true)
    expect(plan.get('living')!.south.hasDoor).toBe(true)
  })
})
