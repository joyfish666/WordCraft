import { describe, expect, it } from 'vitest'
import type { ContainerNode } from '../types/model'
import { DOOR_WIDTH, computeWallPlan, doorDirection, isCorridorName, isOpenRoom, wallPlanWithDoor, type WallFace } from './roomGeometry'

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

/** 该墙是否有实体段（wall/door） */
function rendersWall(face: WallFace): boolean {
  return face.segments.some((s) => s.kind !== 'open')
}

/** 该墙是否有门洞 */
function hasDoor(face: WallFace): boolean {
  return face.segments.some((s) => s.kind === 'door')
}

/** 该墙是否有留空段（开放连通） */
function hasOpen(face: WallFace): boolean {
  return face.segments.some((s) => s.kind === 'open')
}

describe('isCorridorName / isOpenRoom', () => {
  it('识别走廊与开放空间', () => {
    expect(isCorridorName('走廊')).toBe(true)
    expect(isCorridorName('主卧')).toBe(false)
    expect(isOpenRoom('客厅')).toBe(true)
    expect(isOpenRoom('餐厅')).toBe(true)
    expect(isOpenRoom('主卧')).toBe(false)
  })

  it('复合房间名（如"走廊卫生间"）不当作走廊/开放空间', () => {
    expect(isCorridorName('走廊卫生间')).toBe(false)
    expect(isOpenRoom('走廊卫生间')).toBe(false)
    expect(isCorridorName('主卧卫生间')).toBe(false)
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

describe('computeWallPlan（分段墙体）', () => {
  it('相邻房间共享墙只渲染一堵，并由非走廊房间持有（带门）', () => {
    const master = room('master', '主卧', -2, 0, 3, 3)
    const corridor = room('corridor', '走廊', 0, 0, 1, 4)
    const plan = computeWallPlan([master, corridor])
    expect(hasDoor(plan.get('master')!.east)).toBe(true)
    expect(rendersWall(plan.get('master')!.east)).toBe(true)
    // 走廊西墙与主卧相邻段留空（由主卧渲染），主卧未覆盖的两端仍为外墙
    expect(hasOpen(plan.get('corridor')!.west)).toBe(true)
    expect(rendersWall(plan.get('corridor')!.west)).toBe(true)
  })

  it('两个非走廊房间相邻时由 id 较小者持有', () => {
    const a = room('a', '客厅', 0, -1.5, 3, 3)
    const b = room('b', '主卧', 0, 1.5, 3, 3)
    const plan = computeWallPlan([a, b])
    expect(hasDoor(plan.get('a')!.north)).toBe(true)
    expect(rendersWall(plan.get('b')!.south)).toBe(false)
  })

  it('走廊两侧：封闭房间开门，开放房间与走廊开放连通', () => {
    const master = room('master', '主卧', -2, 0, 3, 3)
    const corridor = room('corridor', '走廊', 0, 0, 1, 4)
    const living = room('living', '客厅', 2, 0, 3, 3)
    const plan = computeWallPlan([master, corridor, living])
    // 主卧封闭：东墙朝走廊，开门
    expect(hasDoor(plan.get('master')!.east)).toBe(true)
    // 客厅开放：与走廊开放连通（不设墙）；走廊东墙与客厅相邻段留空
    expect(hasOpen(plan.get('living')!.west)).toBe(true)
    expect(hasOpen(plan.get('corridor')!.east)).toBe(true)
  })

  it('私密房间（卧室）之间不直接开门', () => {
    const a = room('a', '主卧', 0, -1.5, 3, 3)
    const b = room('b', '次卧', 0, 1.5, 3, 3)
    const plan = computeWallPlan([a, b])
    // 两侧都是卧室：墙保留但不开门
    expect(rendersWall(plan.get('a')!.north)).toBe(true)
    expect(hasDoor(plan.get('a')!.north)).toBe(false)
  })

  it('部分被相邻开放空间占用的墙，其余部分仍按外墙渲染（不向外部开口）', () => {
    // 走廊长 6，客厅只占用走廊南墙中间一段
    const corridor = room('corridor', '走廊', 0, 0.5, 6, 1)
    const living = room('living', '客厅', 0, -1.5, 3, 3)
    const plan = computeWallPlan([corridor, living])
    const south = plan.get('corridor')!.south
    // 与客厅相邻段开放连通，其余部分仍渲染为外墙
    expect(hasOpen(south)).toBe(true)
    expect(rendersWall(south)).toBe(true)
  })

  it('无相邻房间时兜底开一扇朝整屋中心的门', () => {
    const a = room('a', '客厅', 0, 0, 3, 3)
    const plan = computeWallPlan([a])
    expect(hasDoor(plan.get('a')!.north)).toBe(true)
    expect(rendersWall(plan.get('a')!.east)).toBe(true)
  })
})

describe('wallPlanWithDoor（嵌套房间用）', () => {
  it('在指定方向开门，其余墙实体', () => {
    const a = room('a', '主卧', 0, 0, 3, 3)
    const plan = wallPlanWithDoor(a, 'north')
    expect(hasDoor(plan.north)).toBe(true)
    expect(hasDoor(plan.south)).toBe(false)
    expect(hasDoor(plan.east)).toBe(false)
    expect(hasDoor(plan.west)).toBe(false)
    expect(rendersWall(plan.north)).toBe(true)
  })
})

describe('入户门', () => {
  it('公共卫生间（归属房间不存在）与走廊开门，不与卧室开门', () => {
    const corridor = room('corridor', '走廊', 0, 0.5, 6, 1)
    const bedroom = room('bedroom2', '卧室2', 3.5, -1.0, 3, 3)
    const pub = room('publicbath', '公共卫生间', 1, -1.0, 2, 2)
    const plan = computeWallPlan([corridor, bedroom, pub])
    // 公共卫生间北墙朝走廊：开门
    expect(plan.get('publicbath')!.north.segments.some((s) => s.kind === 'door')).toBe(true)
    // 与卧室2之间：不开门（实心墙）
    expect(plan.get('publicbath')!.east.segments.some((s) => s.kind === 'door')).toBe(false)
    expect(plan.get('bedroom2')!.west.segments.some((s) => s.kind === 'door')).toBe(false)
  })

  it('入户门开在指定房间的南外墙（居中）并标记为入户', () => {
    const living = room('living', '客厅', 0, -2, 3, 3)
    const master = room('master', '主卧', 0, 2, 3, 3)
    const plan = computeWallPlan([living, master], { entrance: 'south', entranceRoomId: 'living' })
    expect(hasDoor(plan.get('living')!.south)).toBe(true)
    expect(rendersWall(plan.get('living')!.south)).toBe(true)
    expect(plan.get('living')!.south.segments.some((s) => s.entrance)).toBe(true)
  })

  it('客厅比厨房大：客厅东墙未被厨房覆盖的部分仍渲染为外墙', () => {
    const rooms = [
      room('living_room', '客厅', -2.7, -2.4, 6, 4.2),
      room('kitchen', '厨房', 1.8, -1.8, 3, 3),
    ]
    const plan = computeWallPlan(rooms)
    const east = plan.get('living_room')!.east
    // 与厨房共享段开放连通
    expect(hasOpen(east)).toBe(true)
    // 客厅独有部分（超出厨房，z 更靠南）仍为外墙
    expect(rendersWall(east)).toBe(true)
    const wallSeg = east.segments.find((s) => s.kind === 'wall')!
    expect(wallSeg.from).toBeLessThan(wallSeg.to)
  })

  it('复现真实布局：客厅（南侧）南墙生成入户门', () => {
    // 与用户日志一致的已解析布局
    const rooms = [
      room('corridor', '走廊', 0, 0.25, 10.5, 1.2),
      room('living_room', '客厅', -2.25, -2.35, 6, 4),
      room('bedroom1', '主卧', -3.25, 2.6, 4, 3.5),
      room('bedroom2', '次卧', 0.5, 2.35, 3.5, 3),
      room('bedroom3', '书房', 3.75, 2.35, 3, 3),
    ]
    const plan = computeWallPlan(rooms, { entrance: 'south', entranceRoomId: 'living_room' })
    expect(hasDoor(plan.get('living_room')!.south)).toBe(true)
    expect(plan.get('living_room')!.south.segments.some((s) => s.entrance)).toBe(true)
    // 门段应为标准门宽（0.9m），确保渲染为真实门洞而非实心墙
    const doorSeg = plan.get('living_room')!.south.segments.find((s) => s.kind === 'door')!
    expect(doorSeg.to - doorSeg.from).toBeCloseTo(DOOR_WIDTH)
  })
})
