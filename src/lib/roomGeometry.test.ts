import { describe, expect, it } from 'vitest'
import type { ContainerNode } from '../types/model'
import {
  DOOR_WIDTH,
  computeAllWallPlans,
  computeWallPlan,
  doorDirection,
  isCorridorName,
  isOpenRoom,
  wallPlanWithDoor,
  type WallFace,
} from './roomGeometry'

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

  it('两个非走廊房间相邻时由 id 较小者持有（私密-开放之间不开门）', () => {
    const a = room('a', '客厅', 0, -1.5, 3, 3)
    const b = room('b', '主卧', 0, 1.5, 3, 3)
    const plan = computeWallPlan([a, b])
    // a（id 较小）持有共享墙；但私密房间（主卧）不直连开放空间（客厅）→ 墙实体不开门
    expect(rendersWall(plan.get('a')!.north)).toBe(true)
    expect(hasDoor(plan.get('a')!.north)).toBe(false)
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
  it('私密房间（卧室）不直连厨房等开放空间，只连走廊', () => {
    const corridor = room('corridor', '走廊', 0, 0.5, 6, 1)
    const kitchen = room('kitchen', '厨房', 0, 2.5, 3, 3)
    const bedroom = room('bedroom2', '次卧1', 3.25, 2.5, 3.5, 3)
    const plan = computeWallPlan([corridor, kitchen, bedroom])
    // 卧室南墙（朝走廊）开门
    expect(plan.get('bedroom2')!.south.segments.some((s) => s.kind === 'door')).toBe(true)
    // 卧室西墙（朝厨房）不开门（实心墙）
    expect(plan.get('bedroom2')!.west.segments.some((s) => s.kind === 'door')).toBe(false)
    expect(plan.get('bedroom2')!.west.segments.some((s) => s.kind === 'wall')).toBe(true)
  })

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

describe('computeAllWallPlans / nestedWallPlan（真·内嵌嵌套房间）', () => {
  // 父房间带嵌套子房间（如卧室内卫生间），嵌套房间按布局引擎 placeNested 放置于父房间角落。
  // 示例：主卧 4×3 于原点，主卧卫生间 2×1.5 靠东北角 → 北/东墙线距父墙线恰 WALL_THICKNESS。
  function parentWithBath() {
    const bath = room('bath', '主卧卫生间', 0.85, 0.6, 2, 1.5)
    const master = { ...room('master', '主卧', 0, 0, 4, 3), children: [bath] }
    return computeAllWallPlans([master])
  }

  it('角落嵌套：与父墙共线的边 open（由父墙围护），内部分隔墙实心，门朝父中心', () => {
    const plan = parentWithBath()
    const bath = plan.get('bath')!
    // 东北角：北/东与父墙线重合 → 全 open 且地板不外扩
    expect(rendersWall(bath.north)).toBe(false)
    expect(bath.north.shared).toBe(true)
    expect(rendersWall(bath.east)).toBe(false)
    expect(bath.east.shared).toBe(true)
    // 西/南为内部分隔墙：实心
    expect(rendersWall(bath.west)).toBe(true)
    expect(rendersWall(bath.south)).toBe(true)
    // 门朝父中心（西南 → west），仅此一面有门
    expect(hasDoor(bath.west)).toBe(true)
    expect(hasDoor(bath.south)).toBe(false)
    expect(hasDoor(bath.north)).toBe(false)
    expect(hasDoor(bath.east)).toBe(false)
  })

  it('父墙共享给邻居（父方案该处 open）时嵌套边仍 open（并集查到邻居墙）', () => {
    // 邻居 id 更小 → 邻居持有共享墙，父（master）东墙该处 open
    const bath = room('bath', '主卧卫生间', -1.15, 0.6, 2, 1.5)
    const master = { ...room('master', '主卧', -2, 0, 4, 3), children: [bath] }
    const neighbor = room('a', '次卧', 2, 0, 4, 3)
    const plan = computeAllWallPlans([master, neighbor])
    // 父东墙：共享给邻居持有 → open
    expect(hasOpen(plan.get('master')!.east)).toBe(true)
    expect(rendersWall(plan.get('master')!.east)).toBe(false)
    // 嵌套东墙（与共享墙线共线）仍被判定为已围护 → open，避免背靠背双重墙
    expect(rendersWall(plan.get('bath')!.east)).toBe(false)
  })

  it('父墙该处为开放连通（无墙）时，嵌套该边仍渲染实心墙', () => {
    // 客厅（开放）南墙与走廊开放连通（无墙）；嵌套卫生间靠南开放侧 → 该边不被覆盖
    const bath = room('bath', '卫生间', -0.35, 0.9, 2, 1.5)
    const living = { ...room('living', '客厅', 0, 1.5, 3, 3), children: [bath] }
    const corridor = room('corridor', '走廊', 0, -0.6, 3, 1.2)
    const plan = computeAllWallPlans([living, corridor])
    // 客厅南墙（朝走廊）开放连通
    expect(hasOpen(plan.get('living')!.south)).toBe(true)
    expect(rendersWall(plan.get('living')!.south)).toBe(false)
    // 嵌套南墙在开放连通侧：无外墙可依赖 → 渲染实心墙
    expect(rendersWall(plan.get('bath')!.south)).toBe(true)
    // 嵌套西墙贴客厅西外墙：被覆盖 → open
    expect(rendersWall(plan.get('bath')!.west)).toBe(false)
  })

  it('嵌套房间内移（墙线距父墙 > 墙厚）时四面实心、门朝父中心', () => {
    const bath = room('bath', '卫生间', 0.2, 0.2, 2, 1.5)
    const master = { ...room('master', '主卧', 0, 0, 4, 3), children: [bath] }
    const plan = computeAllWallPlans([master])
    const b = plan.get('bath')!
    expect(rendersWall(b.north)).toBe(true)
    expect(rendersWall(b.south)).toBe(true)
    expect(rendersWall(b.east)).toBe(true)
    expect(rendersWall(b.west)).toBe(true)
    // 门朝父中心（西南 → west）
    expect(hasDoor(b.west)).toBe(true)
    expect(hasDoor(b.north)).toBe(false)
  })

  it('嵌套之嵌套：子房间查到祖辈分隔墙为 open', () => {
    // 衣帽间位于卫生间西墙内侧（西墙与卫生间西分隔墙共线，且完全落在其范围内）
    const wardrobe = room('wardrobe', '衣帽间', 0.35, 0.6, 1, 1)
    const bath = { ...room('bath', '主卧卫生间', 0.85, 0.6, 2, 1.5), children: [wardrobe] }
    const master = { ...room('master', '主卧', 0, 0, 4, 3), children: [bath] }
    const plan = computeAllWallPlans([master])
    // 衣帽间西墙与卫生间西墙（内部分隔墙）共线 → 被围护 → open
    expect(rendersWall(plan.get('wardrobe')!.west)).toBe(false)
    // 衣帽间朝卫生间中心（正东 → east）开门
    expect(hasDoor(plan.get('wardrobe')!.east)).toBe(true)
  })

  it('部分覆盖：嵌套边跨过开放走廊/外墙交界 → 混合段（部分 open 部分 wall）', () => {
    // 客厅北墙：走廊只占用东半段（开放），西半段仍是外墙
    const bath = room('bath', '卫生间', 0.85, 2.1, 2, 1.5)
    const living = { ...room('living', '客厅', 0, 1.5, 4, 3), children: [bath] }
    const corridor = room('corridor', '走廊', 1, 3.6, 2, 1.2)
    const plan = computeAllWallPlans([living, corridor])
    // 客厅北墙有开放段（东）与外墙段（西）
    expect(hasOpen(plan.get('living')!.north)).toBe(true)
    expect(rendersWall(plan.get('living')!.north)).toBe(true)
    // 嵌套北墙跨过开放/外墙交界 → 混合段
    const north = plan.get('bath')!.north
    expect(hasOpen(north)).toBe(true)
    expect(rendersWall(north)).toBe(true)
  })

  it('退化：嵌套房间≈父房间（四面全被覆盖）不 crash，全 open 且不开门', () => {
    const bath = room('bath', '卫生间', 0, 0, 3.8, 2.8)
    const master = { ...room('master', '主卧', 0, 0, 4, 3), children: [bath] }
    const plan = computeAllWallPlans([master])
    const b = plan.get('bath')!
    expect(rendersWall(b.north)).toBe(false)
    expect(rendersWall(b.south)).toBe(false)
    expect(rendersWall(b.east)).toBe(false)
    expect(rendersWall(b.west)).toBe(false)
    expect(hasDoor(b.north)).toBe(false)
    expect(hasDoor(b.south)).toBe(false)
    expect(hasDoor(b.east)).toBe(false)
    expect(hasDoor(b.west)).toBe(false)
  })
})
