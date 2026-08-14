import { describe, expect, it } from 'vitest'
import { footprintBounds, rectFootprint } from './footprint'
import type { RoomNode, SceneModel } from '../types/model'
import {
  DOOR_WIDTH,
  computeAllWallPlans,
  computeAllWallPlansCached,
  computeWallPlan,
  doorDirection,
  edgeOf,
  bathroomOwner,
  footprintEdges,
  isCorridorName,
  isOpenRoom,
  isPrivateRoom,
  segmentWorldRange,
  wallGroupPosition,
  wallPlanWithDoor,
  type WallEdge,
} from './roomGeometry'

function room(
  id: string,
  name: string,
  x: number,
  z: number,
  len: number,
  wid: number,
  h = 2.8,
): RoomNode {
  return {
    id,
    type: 'room',
    name,
    footprint: rectFootprint(x, z, len, wid),
    height: h,
    doors: [],
    windows: [],
    furniture: [],
    nestedRooms: [],
  }
}

/** 该边是否有实体段（wall/door/window） */
function rendersWall(edge: WallEdge): boolean {
  return edge.segments.some((s) => s.kind !== 'open')
}

/** 该边是否有门洞 */
function hasDoor(edge: WallEdge | undefined): boolean {
  return edge?.segments.some((s) => s.kind === 'door') ?? false
}

/** 该边是否有留空段（开放连通） */
function hasOpen(edge: WallEdge | undefined): boolean {
  return edge?.segments.some((s) => s.kind === 'open') ?? false
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

  it('英文房间名正确分类（英文 UI 下 LLM 按英文提示词产出英文名）', () => {
    expect(isCorridorName('Hallway')).toBe(true)
    expect(isCorridorName('corridor')).toBe(true)
    expect(isCorridorName('Master Bedroom')).toBe(false)
    expect(isOpenRoom('Living Room')).toBe(true)
    expect(isOpenRoom('Dining Room')).toBe(true)
    expect(isOpenRoom('Kitchen')).toBe(true)
    expect(isOpenRoom('Master Bedroom')).toBe(false)
    expect(isOpenRoom('Bathroom Hallway')).toBe(false)
    expect(isPrivateRoom('Bedroom')).toBe(true)
    expect(isPrivateRoom('Study')).toBe(true)
    expect(isPrivateRoom('Guest Room')).toBe(true)
    expect(isPrivateRoom('Living Room')).toBe(false)
  })

  it('英文卫生间归属：Master Bathroom → Master（朝向所属房间开门）', () => {
    expect(bathroomOwner('Master Bathroom')).toBe('Master')
    expect(bathroomOwner('Guest Toilet')).toBe('Guest')
    expect(bathroomOwner('Bathroom')).toBeNull()
    expect(bathroomOwner('主卧卫生间')).toBe('主卧')
  })
})

describe('footprintEdges', () => {
  it('矩形 4 点足迹 → 4 条轴对齐边，方向/线/区间正确', () => {
    const r = room('r', '主卧', 0, 0, 3, 2)
    const edges = footprintEdges(r)
    expect(edges).toHaveLength(4)
    const south = edges.find((e) => e.dir === 'south')!
    expect(south.axis).toBe('x')
    expect(south.line).toBe(-1)
    expect(south.start).toBe(-1.5)
    expect(south.length).toBe(3)
    const north = edges.find((e) => e.dir === 'north')!
    expect(north.line).toBe(1)
    const east = edges.find((e) => e.dir === 'east')!
    expect(east.axis).toBe('z')
    expect(east.line).toBe(1.5)
    const west = edges.find((e) => e.dir === 'west')!
    expect(west.line).toBe(-1.5)
  })
})

describe('doorDirection（兜底门朝向）', () => {
  it('房间在整屋左侧时门朝东（指向中心）', () => {
    expect(doorDirection(room('a', '客厅', -2, 0, 3, 3))).toBe('east')
  })

  it('房间位于中心时默认朝北', () => {
    expect(doorDirection(room('a', '客厅', 0, 0, 3, 3))).toBe('north')
  })
})

describe('computeWallPlan（分段墙体）', () => {
  it('相邻房间共享墙只渲染一堵，并由非走廊房间持有（带门）', () => {
    const master = room('master', '主卧', -2, 0, 3, 3)
    const corridor = room('corridor', '走廊', 0, 0, 1, 4)
    const plan = computeWallPlan([master, corridor])
    const mEast = edgeOf(plan.get('master')!, 'east')!
    const cWest = edgeOf(plan.get('corridor')!, 'west')!
    expect(hasDoor(mEast)).toBe(true)
    expect(rendersWall(mEast)).toBe(true)
    // 走廊西墙与主卧相邻段留空（由主卧渲染），主卧未覆盖的两端仍为外墙
    expect(hasOpen(cWest)).toBe(true)
    expect(rendersWall(cWest)).toBe(true)
  })

  it('两个非走廊房间相邻时由 id 较小者持有（有走廊时私密-开放之间不开门）', () => {
    // 有走廊的房屋：主卧有走廊可开门，其与客厅的共享墙保持实体（坑 11 语义）
    const a = room('a', '客厅', 0, -1.5, 3, 3)
    const b = room('b', '主卧', 0, 1.5, 3, 3)
    const corridor = room('corridor', '走廊', 2, 0, 1, 4)
    const plan = computeWallPlan([a, b, corridor])
    // a（id 较小）持有共享墙；但私密房间（主卧）不直连开放空间（客厅）→ 墙实体不开门
    const aNorth = edgeOf(plan.get('a')!, 'north')!
    expect(rendersWall(aNorth)).toBe(true)
    expect(hasDoor(aNorth)).toBe(false)
    // 主卧朝走廊开门（私密房间只连走廊；主卧是共享墙持有方，门在 b 的东墙）
    expect(hasDoor(edgeOf(plan.get('b')!, 'east'))).toBe(true)
  })

  it('无走廊的自由布局：私密房间与开放空间直接开门（否则密封不可达）', () => {
    // 复现用户反馈：custom 布局（无走廊）主卧贴客厅北侧——若沿用"私密只连走廊"规则，
    // 主卧没有其他邻居将被完全封死，只能从卫生间进出（布局错乱）
    const a = room('a', '客厅', 0, -2.5, 6, 5)
    const b = room('b', '主卧', 0, 2, 4.5, 4)
    const bath = room('bath', '主卧卫生间', 3.25, 2, 2, 1.8)
    const plan = computeWallPlan([a, b, bath])
    // 主卧与客厅之间开门（共享墙持有方 a 的北墙渲染门段；客厅是开放空间不设墙）
    expect(hasDoor(edgeOf(plan.get('a')!, 'north'))).toBe(true)
    // 主卧与主卧卫生间之间开门（命名归属卫生间规则；b 是持有方，门在 b 的东墙）
    expect(hasDoor(edgeOf(plan.get('b')!, 'east'))).toBe(true)
  })

  it('走廊两侧：封闭房间开门，开放房间与走廊开放连通', () => {
    const master = room('master', '主卧', -2, 0, 3, 3)
    const corridor = room('corridor', '走廊', 0, 0, 1, 4)
    const living = room('living', '客厅', 2, 0, 3, 3)
    const plan = computeWallPlan([master, corridor, living])
    // 主卧封闭：东墙朝走廊，开门
    expect(hasDoor(edgeOf(plan.get('master')!, 'east'))).toBe(true)
    // 客厅开放：与走廊开放连通（不设墙）；走廊东墙与客厅相邻段留空
    expect(hasOpen(edgeOf(plan.get('living')!, 'west'))).toBe(true)
    expect(hasOpen(edgeOf(plan.get('corridor')!, 'east'))).toBe(true)
  })

  it('私密房间（卧室）之间不直接开门', () => {
    const a = room('a', '主卧', 0, -1.5, 3, 3)
    const b = room('b', '次卧', 0, 1.5, 3, 3)
    const plan = computeWallPlan([a, b])
    // 两侧都是卧室：墙保留但不开门
    const aNorth = edgeOf(plan.get('a')!, 'north')!
    expect(rendersWall(aNorth)).toBe(true)
    expect(hasDoor(aNorth)).toBe(false)
  })

  it('部分被相邻开放空间占用的墙，其余部分仍按外墙渲染（不向外部开口）', () => {
    // 走廊长 6，客厅只占用走廊南墙中间一段
    const corridor = room('corridor', '走廊', 0, 0.5, 6, 1)
    const living = room('living', '客厅', 0, -1.5, 3, 3)
    const plan = computeWallPlan([corridor, living])
    const south = edgeOf(plan.get('corridor')!, 'south')!
    // 与客厅相邻段开放连通，其余部分仍渲染为外墙
    expect(hasOpen(south)).toBe(true)
    expect(rendersWall(south)).toBe(true)
  })

  it('无相邻房间时兜底开一扇朝整屋中心的门', () => {
    const a = room('a', '客厅', 0, 0, 3, 3)
    const plan = computeWallPlan([a])
    expect(hasDoor(edgeOf(plan.get('a')!, 'north'))).toBe(true)
    expect(rendersWall(edgeOf(plan.get('a')!, 'east')!)).toBe(true)
  })
})

describe('wallPlanWithDoor（嵌套房间用）', () => {
  it('在指定方向开门，其余墙实体', () => {
    const a = room('a', '主卧', 0, 0, 3, 3)
    const plan = wallPlanWithDoor(a, 'north')
    expect(hasDoor(edgeOf(plan, 'north'))).toBe(true)
    expect(hasDoor(edgeOf(plan, 'south'))).toBe(false)
    expect(hasDoor(edgeOf(plan, 'east'))).toBe(false)
    expect(hasDoor(edgeOf(plan, 'west'))).toBe(false)
    expect(rendersWall(edgeOf(plan, 'north')!)).toBe(true)
  })
})

describe('入户门', () => {
  it('私密房间（卧室）不直连厨房等开放空间，只连走廊', () => {
    const corridor = room('corridor', '走廊', 0, 0.5, 6, 1)
    const kitchen = room('kitchen', '厨房', 0, 2.5, 3, 3)
    const bedroom = room('bedroom2', '次卧1', 3.25, 2.5, 3.5, 3)
    const plan = computeWallPlan([corridor, kitchen, bedroom])
    // 卧室南墙（朝走廊）开门
    expect(edgeOf(plan.get('bedroom2')!, 'south')!.segments.some((s) => s.kind === 'door')).toBe(
      true,
    )
    // 卧室西墙（朝厨房）不开门（实心墙）
    expect(edgeOf(plan.get('bedroom2')!, 'west')!.segments.some((s) => s.kind === 'door')).toBe(
      false,
    )
    expect(edgeOf(plan.get('bedroom2')!, 'west')!.segments.some((s) => s.kind === 'wall')).toBe(
      true,
    )
  })

  it('公共卫生间（归属房间不存在）与走廊开门，不与卧室开门', () => {
    const corridor = room('corridor', '走廊', 0, 0.5, 6, 1)
    const bedroom = room('bedroom2', '卧室2', 3.5, -1.0, 3, 3)
    const pub = room('publicbath', '公共卫生间', 1, -1.0, 2, 2)
    const plan = computeWallPlan([corridor, bedroom, pub])
    // 公共卫生间北墙朝走廊：开门
    expect(edgeOf(plan.get('publicbath')!, 'north')!.segments.some((s) => s.kind === 'door')).toBe(
      true,
    )
    // 与卧室2之间：不开门（实心墙）
    expect(edgeOf(plan.get('publicbath')!, 'east')!.segments.some((s) => s.kind === 'door')).toBe(
      false,
    )
    expect(edgeOf(plan.get('bedroom2')!, 'west')!.segments.some((s) => s.kind === 'door')).toBe(
      false,
    )
  })

  it('普通卫生间同时邻走廊与卧室时只开走廊门（单门优先级）', () => {
    const corridor = room('corridor', '走廊', 0, 0.5, 6, 1)
    const bedroom = room('bedroom1', '卧室1', 0.5, -1.0, 2, 2)
    const bath = room('bathroom1', '卫生间', -2.2, -1.0, 2, 2)
    const plan = computeWallPlan([corridor, bedroom, bath])
    const bathPlan = plan.get('bathroom1')!
    // 只开一扇门（走廊侧）
    const doorEdges = bathPlan.edges.filter((e) => e.segments.some((s) => s.kind === 'door'))
    expect(doorEdges).toHaveLength(1)
    expect(hasDoor(edgeOf(bathPlan, 'north'))).toBe(true) // 走廊在北
    // 与卧室之间为实心墙（卫生间侧与卧室侧都无门）
    expect(hasDoor(edgeOf(bathPlan, 'east'))).toBe(false)
    expect(hasDoor(edgeOf(plan.get('bedroom1')!, 'west'))).toBe(false)
  })

  it('卫生间只邻卧室（无走廊）时开一扇确定性门', () => {
    const bedroomA = room('bedroom_a', '卧室A', -1.25, 1.0, 2.5, 2.5)
    const bedroomB = room('bedroom_b', '卧室B', 1.25, 1.0, 2.5, 2.5)
    const bath = room('bathroom1', '卫生间', 0, -1.25, 2, 2)
    const plan = computeWallPlan([bedroomA, bedroomB, bath])
    const bathPlan = plan.get('bathroom1')!
    // 卫生间北墙邻两个卧室（无走廊）：只与 id 较小者开门，另一侧为实心墙
    const doorEdges = bathPlan.edges.filter((e) => e.segments.some((s) => s.kind === 'door'))
    expect(doorEdges).toHaveLength(1)
    const north = edgeOf(bathPlan, 'north')!
    expect(north.segments.filter((s) => s.kind === 'door')).toHaveLength(1)
    expect(north.segments.some((s) => s.kind === 'wall')).toBe(true)
  })

  it('全屋唯一卫生间（无走廊、无归属名）按公共卫生间：门开向客厅而非主卧（坑 86）', () => {
    // 复现用户反馈：custom 自由布局单卫生间同时邻客厅与主卧，旧规则按 id 最小（a_master）
    // 会把门开向主卧——卫生间变成"主卧专属"。唯一卫生间应视为公共卫生间，开向开放空间。
    const living = room('living', '客厅', -1.5, -1.5, 3, 3)
    const master = room('a_master', '主卧', 1.5, -1.5, 3, 3)
    const bath = room('bathroom1', '卫生间', 0, 1.0, 2, 2)
    const plan = computeWallPlan([master, living, bath])
    const bathPlan = plan.get('bathroom1')!
    // 单门且开向客厅（南墙的客厅段），不开向主卧（南墙主卧段为实心墙）
    const doorEdges = bathPlan.edges.filter((e) => e.segments.some((s) => s.kind === 'door'))
    expect(doorEdges).toHaveLength(1)
    expect(hasDoor(edgeOf(bathPlan, 'south'))).toBe(true)
    expect(hasDoor(edgeOf(plan.get('a_master')!, 'north'))).toBe(false)
    expect(hasDoor(edgeOf(bathPlan, 'north'))).toBe(false) // 北墙外墙无门
  })

  it('全屋唯一卫生间只邻私密房间时退化为邻居 id 最小（确定性兜底）', () => {
    const master = room('master', '主卧', -1.5, 1.0, 3, 3)
    const study = room('study', '书房', 1.5, 1.0, 3, 3)
    const bath = room('bathroom1', '卫生间', 0, -1.5, 2, 2)
    const plan = computeWallPlan([master, study, bath])
    const bathPlan = plan.get('bathroom1')!
    const doorEdges = bathPlan.edges.filter((e) => e.segments.some((s) => s.kind === 'door'))
    expect(doorEdges).toHaveLength(1)
    // 北墙邻两个私密房间：与 id 较小者（master）开门；书房侧为实心墙
    expect(hasDoor(edgeOf(bathPlan, 'north'))).toBe(true)
    expect(hasDoor(edgeOf(plan.get('study')!, 'south'))).toBe(false)
  })

  it('多个无归属卫生间（无走廊）维持旧规则：邻居 id 最小，不做公共特判（坑 86 边界）', () => {
    // 两个卫生间时"全屋唯一"前提不成立：bathA 同时邻客厅与卧室，门仍按旧确定性规则
    // 开向 id 最小的邻居（a_bedroom），而不是开向开放空间
    const living = room('living', '客厅', 0, -1.5, 4, 3)
    const bedroom = room('a_bedroom', '卧室', -3.6, -1.5, 2.8, 3)
    const bathA = room('bathroom_a', '卫生间', -2, 1.0, 2, 2)
    const bathB = room('bathroom_b', '卫生间', 2.3, 1.0, 2, 2)
    const plan = computeWallPlan([living, bedroom, bathA, bathB])
    // bathA 南墙邻 a_bedroom（id 最小者持有方）与 living：门在 a_bedroom 北墙
    expect(hasDoor(edgeOf(plan.get('a_bedroom')!, 'north'))).toBe(true)
    expect(hasDoor(edgeOf(plan.get('bathroom_a')!, 'south'))).toBe(false)
    // bathB 只邻 living：门开向 living
    expect(hasDoor(edgeOf(plan.get('bathroom_b')!, 'south'))).toBe(true)
  })

  it('入户门开在指定房间的南外墙（居中）并标记为入户', () => {
    const living = room('living', '客厅', 0, -2, 3, 3)
    const master = room('master', '主卧', 0, 2, 3, 3)
    const plan = computeWallPlan([living, master], { entrance: 'south', entranceRoomId: 'living' })
    const livingSouth = edgeOf(plan.get('living')!, 'south')!
    expect(hasDoor(livingSouth)).toBe(true)
    expect(rendersWall(livingSouth)).toBe(true)
    expect(livingSouth.segments.some((s) => s.entrance)).toBe(true)
  })

  it('客厅比厨房大：客厅东墙未被厨房覆盖的部分仍渲染为外墙', () => {
    const rooms = [
      room('living_room', '客厅', -2.7, -2.4, 6, 4.2),
      room('kitchen', '厨房', 1.8, -1.8, 3, 3),
    ]
    const plan = computeWallPlan(rooms)
    const east = edgeOf(plan.get('living_room')!, 'east')!
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
    const livingSouth = edgeOf(plan.get('living_room')!, 'south')!
    expect(hasDoor(livingSouth)).toBe(true)
    expect(livingSouth.segments.some((s) => s.entrance)).toBe(true)
    // 门段应为标准门宽（0.9m），确保渲染为真实门洞而非实心墙
    const doorSeg = livingSouth.segments.find((s) => s.kind === 'door')!
    expect(doorSeg.to - doorSeg.from).toBeCloseTo(DOOR_WIDTH)
  })

  it('大窗占满入口墙时：窗保持完整一段，入户门改到其他外墙且恒为 0.9m', () => {
    // 复现用户反馈：单房间南墙开 0.5~4.5 大窗——门与窗互不相让，
    // 南墙两侧实心段均 < 0.9m 放不下门，入户门按确定性顺序改到东墙，
    // 大窗不再被门劈成两段（历史：门挤小 / 窗被劈开，两个同根 bug）
    const study = room('study', '书房工作室', 0, 0, 5, 4)
    study.windows = [{ edgeIndex: 0, from: 0.5, to: 4.5, width: 4 }]
    const plan = computeWallPlan([study], { entrance: 'south', entranceRoomId: 'study' })
    // 南墙：窗保持完整一段（0.5~4.5），未被门分割
    const south = edgeOf(plan.get('study')!, 'south')!
    const windows = south.segments.filter((s) => s.kind === 'window')
    expect(windows).toHaveLength(1)
    expect(windows[0]!.from).toBeCloseTo(0.5)
    expect(windows[0]!.to).toBeCloseTo(4.5)
    // 入户门改到东墙（入口方向顺时针第一面放得下 0.9m 的外墙），宽度恒为标准门宽
    const east = edgeOf(plan.get('study')!, 'east')!
    const entranceSeg = east.segments.find((s) => s.entrance)!
    expect(entranceSeg).toBeDefined()
    expect(entranceSeg.to - entranceSeg.from).toBeCloseTo(DOOR_WIDTH)
    // 整屋只有一扇门（入户门），无兜底第二扇
    const doors = plan
      .get('study')!
      .edges.flatMap((e) => e.segments.filter((s) => s.kind === 'door'))
    expect(doors).toHaveLength(1)
  })

  it('入口墙仍有 ≥0.9m 实心段时，入户门留在入口墙（优先入口方向）', () => {
    // 南墙窗只占中间一段（0.5~3.5，墙长 5），两侧实心段各 0.5m；
    // 但窗右侧实心段 [3.5,5] 长 1.5m ≥ 0.9m → 门仍留在南墙（不换墙）
    const study = room('study', '书房工作室', 0, 0, 5, 4)
    study.windows = [{ edgeIndex: 0, from: 0.5, to: 3.5, width: 3 }]
    const plan = computeWallPlan([study], { entrance: 'south', entranceRoomId: 'study' })
    const south = edgeOf(plan.get('study')!, 'south')!
    const entranceSeg = south.segments.find((s) => s.entrance)!
    expect(entranceSeg).toBeDefined()
    expect(entranceSeg.to - entranceSeg.from).toBeCloseTo(DOOR_WIDTH)
    // 窗未被劈开：仍是完整一段
    const windows = south.segments.filter((s) => s.kind === 'window')
    expect(windows).toHaveLength(1)
    expect(windows[0]!.from).toBeCloseTo(0.5)
    expect(windows[0]!.to).toBeCloseTo(3.5)
  })
})

describe('computeAllWallPlans / nestedWallPlan（真·内嵌嵌套房间）', () => {
  // 父房间带嵌套子房间（如卧室内卫生间），嵌套房间按布局引擎 placeNested 放置于父房间角落。
  // 示例：主卧 4×3 于原点，主卧卫生间 2×1.5 靠东北角 → 北/东墙线距父墙线恰 WALL_THICKNESS。
  function parentWithBath() {
    const bath = room('bath', '主卧卫生间', 0.85, 0.6, 2, 1.5)
    const master = { ...room('master', '主卧', 0, 0, 4, 3), nestedRooms: [bath] }
    return computeAllWallPlans([master])
  }

  it('角落嵌套：与父墙共线的边 open（由父墙围护），内部分隔墙实心，门朝父中心', () => {
    const plan = parentWithBath()
    const bath = plan.get('bath')!
    // 东北角：北/东与父墙线重合 → 全 open 且地板不外扩
    expect(rendersWall(edgeOf(bath, 'north')!)).toBe(false)
    expect(edgeOf(bath, 'north')!.shared).toBe(true)
    expect(rendersWall(edgeOf(bath, 'east')!)).toBe(false)
    expect(edgeOf(bath, 'east')!.shared).toBe(true)
    // 西/南为内部分隔墙：实心
    expect(rendersWall(edgeOf(bath, 'west')!)).toBe(true)
    expect(rendersWall(edgeOf(bath, 'south')!)).toBe(true)
    // 门朝父中心（西南 → west），仅此一面有门
    expect(hasDoor(edgeOf(bath, 'west'))).toBe(true)
    expect(hasDoor(edgeOf(bath, 'south'))).toBe(false)
    expect(hasDoor(edgeOf(bath, 'north'))).toBe(false)
    expect(hasDoor(edgeOf(bath, 'east'))).toBe(false)
  })

  it('父墙共享给邻居（父方案该处 open）时嵌套边仍 open（并集查到邻居墙）', () => {
    // 邻居 id 更小 → 邻居持有共享墙，父（master）东墙该处 open
    const bath = room('bath', '主卧卫生间', -1.15, 0.6, 2, 1.5)
    const master = { ...room('master', '主卧', -2, 0, 4, 3), nestedRooms: [bath] }
    const neighbor = room('a', '次卧', 2, 0, 4, 3)
    const plan = computeAllWallPlans([master, neighbor])
    // 父东墙：共享给邻居持有 → open
    expect(hasOpen(edgeOf(plan.get('master')!, 'east'))).toBe(true)
    expect(rendersWall(edgeOf(plan.get('master')!, 'east')!)).toBe(false)
    // 嵌套东墙（与共享墙线共线）仍被判定为已围护 → open，避免背靠背双重墙
    expect(rendersWall(edgeOf(plan.get('bath')!, 'east')!)).toBe(false)
  })

  it('父墙该处为开放连通（无墙）时，嵌套该边仍渲染实心墙', () => {
    // 客厅（开放）南墙与走廊开放连通（无墙）；嵌套卫生间靠南开放侧 → 该边不被覆盖
    const bath = room('bath', '卫生间', -0.35, 0.9, 2, 1.5)
    const living = { ...room('living', '客厅', 0, 1.5, 3, 3), nestedRooms: [bath] }
    const corridor = room('corridor', '走廊', 0, -0.6, 3, 1.2)
    const plan = computeAllWallPlans([living, corridor])
    // 客厅南墙（朝走廊）开放连通
    expect(hasOpen(edgeOf(plan.get('living')!, 'south'))).toBe(true)
    expect(rendersWall(edgeOf(plan.get('living')!, 'south')!)).toBe(false)
    // 嵌套南墙在开放连通侧：无外墙可依赖 → 渲染实心墙
    expect(rendersWall(edgeOf(plan.get('bath')!, 'south')!)).toBe(true)
    // 嵌套西墙贴客厅西外墙：被覆盖 → open
    expect(rendersWall(edgeOf(plan.get('bath')!, 'west')!)).toBe(false)
  })

  it('嵌套房间内移（墙线距父墙 > 墙厚）时四面实心、门朝父中心', () => {
    const bath = room('bath', '卫生间', 0.2, 0.2, 2, 1.5)
    const master = { ...room('master', '主卧', 0, 0, 4, 3), nestedRooms: [bath] }
    const plan = computeAllWallPlans([master])
    const b = plan.get('bath')!
    expect(rendersWall(edgeOf(b, 'north')!)).toBe(true)
    expect(rendersWall(edgeOf(b, 'south')!)).toBe(true)
    expect(rendersWall(edgeOf(b, 'east')!)).toBe(true)
    expect(rendersWall(edgeOf(b, 'west')!)).toBe(true)
    // 门朝父中心（西南 → west）
    expect(hasDoor(edgeOf(b, 'west'))).toBe(true)
    expect(hasDoor(edgeOf(b, 'north'))).toBe(false)
  })

  it('嵌套之嵌套：子房间查到祖辈分隔墙为 open', () => {
    // 衣帽间位于卫生间西墙内侧（西墙与卫生间西分隔墙共线，且完全落在其范围内）
    const wardrobe = room('wardrobe', '衣帽间', 0.35, 0.6, 1, 1)
    const bath = { ...room('bath', '主卧卫生间', 0.85, 0.6, 2, 1.5), nestedRooms: [wardrobe] }
    const master = { ...room('master', '主卧', 0, 0, 4, 3), nestedRooms: [bath] }
    const plan = computeAllWallPlans([master])
    // 衣帽间西墙与卫生间西墙（内部分隔墙）共线 → 被围护 → open
    expect(rendersWall(edgeOf(plan.get('wardrobe')!, 'west')!)).toBe(false)
    // 衣帽间朝卫生间中心（正东 → east）开门
    expect(hasDoor(edgeOf(plan.get('wardrobe')!, 'east'))).toBe(true)
  })

  it('部分覆盖：嵌套边跨过开放走廊/外墙交界 → 混合段（部分 open 部分 wall）', () => {
    // 客厅北墙：走廊只占用东半段（开放），西半段仍是外墙
    const bath = room('bath', '卫生间', 0.85, 2.1, 2, 1.5)
    const living = { ...room('living', '客厅', 0, 1.5, 4, 3), nestedRooms: [bath] }
    const corridor = room('corridor', '走廊', 1, 3.6, 2, 1.2)
    const plan = computeAllWallPlans([living, corridor])
    // 客厅北墙有开放段（东）与外墙段（西）
    expect(hasOpen(edgeOf(plan.get('living')!, 'north'))).toBe(true)
    expect(rendersWall(edgeOf(plan.get('living')!, 'north')!)).toBe(true)
    // 嵌套北墙跨过开放/外墙交界 → 混合段
    const north = edgeOf(plan.get('bath')!, 'north')!
    expect(hasOpen(north)).toBe(true)
    expect(rendersWall(north)).toBe(true)
  })

  it('退化：嵌套房间≈父房间（四面全被覆盖）不 crash，全 open 且不开门', () => {
    const bath = room('bath', '卫生间', 0, 0, 3.8, 2.8)
    const master = { ...room('master', '主卧', 0, 0, 4, 3), nestedRooms: [bath] }
    const plan = computeAllWallPlans([master])
    const b = plan.get('bath')!
    expect(rendersWall(edgeOf(b, 'north')!)).toBe(false)
    expect(rendersWall(edgeOf(b, 'south')!)).toBe(false)
    expect(rendersWall(edgeOf(b, 'east')!)).toBe(false)
    expect(rendersWall(edgeOf(b, 'west')!)).toBe(false)
    expect(hasDoor(edgeOf(b, 'north'))).toBe(false)
    expect(hasDoor(edgeOf(b, 'south'))).toBe(false)
    expect(hasDoor(edgeOf(b, 'east'))).toBe(false)
    expect(hasDoor(edgeOf(b, 'west'))).toBe(false)
  })
})

describe('显式开洞覆盖层（doors / windows）', () => {
  it('window 开洞把实心墙段切成 window 段（渲染为开洞）', () => {
    const r = {
      ...room('a', '主卧', 0, 0, 3, 3),
      windows: [{ edgeIndex: 0, from: 0.5, to: 1.5, width: 1 }], // 南墙（index 0）开窗
    }
    const plan = computeWallPlan([r])
    const south = edgeOf(plan.get('a')!, 'south')!
    expect(south.segments.some((s) => s.kind === 'window')).toBe(true)
    // 未开洞部分仍是实体墙
    expect(south.segments.some((s) => s.kind === 'wall')).toBe(true)
    // 其余边不受影响（无窗段）
    expect(edgeOf(plan.get('a')!, 'north')!.segments.some((s) => s.kind === 'window')).toBe(false)
    expect(edgeOf(plan.get('a')!, 'west')!.segments.every((s) => s.kind === 'wall')).toBe(true)
  })

  it('door 开洞覆盖推导的实心墙，且兜底门判定会避开已开洞房间', () => {
    const r = {
      ...room('a', '主卧', 0, 0, 3, 3),
      doors: [{ edgeIndex: 2, from: 1.05, to: 1.95, width: 0.9 }], // 北墙（index 2）开门
    }
    const plan = computeWallPlan([r])
    const north = edgeOf(plan.get('a')!, 'north')!
    expect(north.segments.some((s) => s.kind === 'door')).toBe(true)
    // 已有门 → 不再追加兜底门（其他墙保持实体）
    expect(edgeOf(plan.get('a')!, 'south')!.segments.every((s) => s.kind === 'wall')).toBe(true)
  })

  it('开洞区间越界/非法时静默跳过，不影响墙体', () => {
    const r = {
      ...room('a', '主卧', 0, 0, 3, 3),
      windows: [
        { edgeIndex: 9, from: 0, to: 1, width: 1 }, // 边不存在
        { edgeIndex: 0, from: 2, to: 2, width: 0 }, // 零宽
      ],
    }
    const plan = computeWallPlan([r])
    expect(edgeOf(plan.get('a')!, 'north')!.segments.some((s) => s.kind === 'window')).toBe(false)
    expect(edgeOf(plan.get('a')!, 'west')!.segments.every((s) => s.kind === 'wall')).toBe(true)
  })
})

describe('墙段坐标与渲染映射（坑 37/坑 41 回归）', () => {
  it('wallGroupPosition：轴 x 锚在 (start, y, line)，轴 z 锚在 (line, y, start)（边起点，非中点）', () => {
    expect(wallGroupPosition({ axis: 'x', start: 1, line: 2 }, 0.12)).toEqual([1, 0.12, 2])
    expect(wallGroupPosition({ axis: 'z', start: -4.85, line: -6 }, 0.12)).toEqual([
      -6, 0.12, -4.85,
    ])
  })

  it('segmentWorldRange：段局部以边起点为 0，世界 = start + [from, to]', () => {
    const roomA = room('a', '主卧', 0, 0, 4, 3)
    const edge = footprintEdges(roomA)[0]! // 南墙（沿 x，start 为 x 最小值）
    expect(edge.axis).toBe('x')
    expect(edge.start).toBeCloseTo(-2, 5)
    const whole = segmentWorldRange(edge, edge.segments[0]!)
    expect(whole.from).toBeCloseTo(-2, 5)
    expect(whole.to).toBeCloseTo(2, 5)
  })

  it('集成：所有房间的墙段世界区间必须落在其边的覆盖范围内，且与足迹边界一致', () => {
    const rooms = [
      { ...room('corridor', '走廊', 0, 0.25, 12, 1.2), furniture: [], nestedRooms: [] },
      { ...room('living', '客厅', -3, -2.6, 6, 4.5), furniture: [], nestedRooms: [] },
      { ...room('master', '主卧', -0.25, 2.85, 4.5, 4), furniture: [], nestedRooms: [] },
    ]
    const plan = computeWallPlan(rooms, { entrance: 'south', entranceRoomId: 'living' })
    for (const r of rooms) {
      const b = footprintBounds(r.footprint)
      const p = plan.get(r.id)!
      for (const e of p.edges) {
        // 渲染锚点 = 边起点（坑 41：锚中点会偏移半个边长）
        const pos = wallGroupPosition(e, 0.12)
        for (const s of e.segments) {
          if (s.kind === 'open') continue
          const world = segmentWorldRange(e, s)
          // 渲染覆盖（沿边轴）= 锚点 + 段区间
          const renderFrom = e.axis === 'x' ? pos[0] + s.from : pos[2] + s.from
          const renderTo = e.axis === 'x' ? pos[0] + s.to : pos[2] + s.to
          expect(renderFrom).toBeCloseTo(world.from, 9)
          expect(renderTo).toBeCloseTo(world.to, 9)
          // 段必须落在边的覆盖范围（足迹边界）内，不允许漂移出房间
          const coverFrom = e.axis === 'x' ? b.minX : b.minZ
          const coverTo = e.axis === 'x' ? b.maxX : b.maxZ
          expect(world.from).toBeGreaterThanOrEqual(coverFrom - 1e-6)
          expect(world.to).toBeLessThanOrEqual(coverTo + 1e-6)
        }
      }
    }
  })

  describe('computeAllWallPlansCached（坑 72 共享缓存）', () => {
    function scene(): SceneModel {
      return {
        version: 3,
        root: {
          type: 'house',
          id: 'h',
          name: '家',
          levels: [
            {
              id: 'l1',
              height: 2.8,
              rooms: [room('living', '客厅', 0, 0, 6, 4), room('master', '主卧', 3.25, 0, 3, 4)],
            },
          ],
          entranceRoomId: 'living',
          entranceDir: 'south',
        },
      }
    }

    it('同一场景引用只计算一次，返回同一 Map（渲染层三组件共享）', () => {
      const s = scene()
      const p1 = computeAllWallPlansCached(s, 'south', 'living')
      const p2 = computeAllWallPlansCached(s, 'south', 'living')
      expect(p2).toBe(p1)
      expect(p1.get('living')?.edges.length).toBeGreaterThan(0)
    })

    it('不同场景引用重新计算，结果与无缓存版本一致', () => {
      const s = scene()
      const cached = computeAllWallPlansCached(s, 'south', 'living')
      const fresh = computeAllWallPlans(s.root.levels[0]!.rooms, {
        entrance: 'south',
        entranceRoomId: 'living',
      })
      expect(cached.get('living')).toEqual(fresh.get('living'))
      expect(cached).not.toBe(fresh)
      // 修改场景结构 → 新引用 → 新结果（不命中旧缓存）
      const changed: SceneModel = { ...s, root: { ...s.root, entranceRoomId: 'master' } }
      const cached2 = computeAllWallPlansCached(changed, 'south', 'master')
      expect(cached2).not.toBe(cached)
    })

    it('内容签名缓存：新引用但内容相同（拖拽预览）时复用共享方案', () => {
      const s = scene()
      const p1 = computeAllWallPlansCached(s, 'south', 'living')
      // 模拟拖拽预览：同内容的新场景引用（仅根引用变化，足迹/开洞/入口不变）
      const s2: SceneModel = { ...s, root: { ...s.root, name: '同内容' } }
      const p2 = computeAllWallPlansCached(s2, 'south', 'living')
      expect(p2).toBe(p1)
      // 显式开洞变化 → 签名变化 → 重算
      const living = room('living', '客厅', 0, 0, 6, 4)
      living.windows = [{ edgeIndex: 1, from: 1, to: 2, width: 1 }]
      const s3: SceneModel = {
        ...s,
        root: {
          ...s.root,
          levels: [
            { ...s.root.levels[0]!, rooms: [living, room('master', '主卧', 3.25, 0, 3, 4)] },
          ],
        },
      }
      const p3 = computeAllWallPlansCached(s3, 'south', 'living')
      expect(p3).not.toBe(p1)
    })
  })
})
