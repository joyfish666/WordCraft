import { describe, expect, it } from 'vitest'
import {
  buildFurnitureParts,
  facingFromRoom,
  furnitureKind,
  partsBounds,
  type FurnitureKind,
  type FurniturePart,
} from './furniturePresets'

const ALL_KINDS: FurnitureKind[] = [
  'bed',
  'wardrobe',
  'desk',
  'sofa',
  'chair',
  'toilet',
  'sink',
  'fridge',
  'tvCabinet',
  'table',
  'roundTable',
  'bookcase',
  'washer',
  'bathtub',
  'nightstand',
  'dressingTable',
  'shoeCabinet',
  'stove',
  'oven',
  'microwave',
]

describe('furnitureKind', () => {
  it('识别各类家具及常见别名', () => {
    expect(furnitureKind('双人床')).toBe('bed')
    expect(furnitureKind('单人床')).toBe('bed')
    expect(furnitureKind('衣柜')).toBe('wardrobe')
    expect(furnitureKind('衣橱')).toBe('wardrobe')
    expect(furnitureKind('储物柜')).toBe('wardrobe')
    expect(furnitureKind('书桌')).toBe('desk')
    expect(furnitureKind('写字台')).toBe('desk')
    expect(furnitureKind('电脑桌')).toBe('desk')
    expect(furnitureKind('沙发')).toBe('sofa')
    expect(furnitureKind('餐椅')).toBe('chair')
    expect(furnitureKind('椅子')).toBe('chair')
    expect(furnitureKind('马桶')).toBe('toilet')
    expect(furnitureKind('洗手池')).toBe('sink')
    expect(furnitureKind('洗脸盆')).toBe('sink')
    expect(furnitureKind('冰箱')).toBe('fridge')
    expect(furnitureKind('电视柜')).toBe('tvCabinet')
    expect(furnitureKind('茶几')).toBe('table')
    expect(furnitureKind('餐桌')).toBe('table')
    expect(furnitureKind('圆桌')).toBe('roundTable')
    expect(furnitureKind('书架')).toBe('bookcase')
    expect(furnitureKind('书柜')).toBe('bookcase')
    expect(furnitureKind('洗衣机')).toBe('washer')
  })

  it('识别新增种类：浴缸/床头柜/梳妆台/鞋柜/灶台/烤箱/微波炉', () => {
    expect(furnitureKind('浴缸')).toBe('bathtub')
    expect(furnitureKind('浴盆')).toBe('bathtub')
    expect(furnitureKind('床头柜')).toBe('nightstand')
    expect(furnitureKind('床边柜')).toBe('nightstand')
    expect(furnitureKind('梳妆台')).toBe('dressingTable')
    expect(furnitureKind('化妆台')).toBe('dressingTable')
    expect(furnitureKind('鞋柜')).toBe('shoeCabinet')
    expect(furnitureKind('玄关柜')).toBe('shoeCabinet')
    expect(furnitureKind('灶台')).toBe('stove')
    expect(furnitureKind('燃气灶')).toBe('stove')
    expect(furnitureKind('烤箱')).toBe('oven')
    expect(furnitureKind('微波炉')).toBe('microwave')
    expect(furnitureKind('微波')).toBe('microwave')
  })

  it('含床字的小件不误套床造型；未识别家具回退 generic', () => {
    expect(furnitureKind('床尾凳')).toBe('generic')
    expect(furnitureKind('床幔')).toBe('generic')
    expect(furnitureKind('未知物品')).toBe('generic')
  })
})

describe('buildFurnitureParts', () => {
  it('generic 回退为单个整盒（与旧渲染一致）', () => {
    const parts = buildFurnitureParts('generic', 2, 0.5, 1.5)
    expect(parts).toHaveLength(1)
    expect(parts[0].center).toEqual([0, 0, 0])
    expect(parts[0].size).toEqual([2, 0.5, 1.5])
    expect(parts[0].shade).toBe('base')
  })

  it('每类家具部件数量符合预期', () => {
    const counts: Record<FurnitureKind, number> = {
      bed: 4,
      wardrobe: 3, // 箱体 + 两扇门（把手已移除，避免共面 z-fighting）
      desk: 5,
      sofa: 5,
      chair: 6,
      toilet: 3,
      sink: 3,
      fridge: 3, // 箱体 + 冷冻/冷藏门
      tvCabinet: 3,
      table: 5,
      roundTable: 3,
      bookcase: 6,
      washer: 3,
      bathtub: 3, // 外壳 + 内胆 + 水龙头
      nightstand: 3, // 柜体 + 抽屉面 + 顶板
      dressingTable: 6, // 桌面 + 四条桌腿 + 镜面
      shoeCabinet: 3, // 柜体 + 上下两扇门
      stove: 7, // 柜体 + 台面 + 4 炉头 + 控制条
      oven: 3, // 柜体 + 玻璃门 + 把手条
      microwave: 3, // 柜体 + 门 + 控制面板
      generic: 1,
    }
    for (const kind of ALL_KINDS) {
      expect(buildFurnitureParts(kind, 1.2, 0.75, 0.6), kind).toHaveLength(counts[kind])
    }
  })

  it('床的床头板与枕头为深色（标出头部方向），衣柜门为深色（缝明显）', () => {
    const bed = buildFurnitureParts('bed', 2, 0.5, 1.5)
    expect(bed.filter((p) => p.shade === 'dark').length).toBe(2) // 床头板 + 枕头
    const wardrobe = buildFurnitureParts('wardrobe', 1.2, 1.8, 0.6)
    expect(wardrobe.filter((p) => p.shade === 'dark').length).toBe(2) // 两扇门
  })
})

describe('包围盒约束（四朝向）', () => {
  // 每类只保留最小/最大两档（覆盖钳制上下限），去掉中间档避免重复
  const SIZES: Array<[string, FurnitureKind, number, number, number]> = [
    ['小床', 'bed', 0.8, 0.2, 0.6],
    ['大床', 'bed', 2.4, 0.6, 1.8],
    ['小衣柜', 'wardrobe', 0.5, 1.2, 0.4],
    ['大衣柜', 'wardrobe', 2, 2.4, 0.7],
    ['小书桌', 'desk', 0.6, 0.5, 0.4],
    ['大书桌', 'desk', 1.8, 0.8, 0.7],
    ['小沙发', 'sofa', 1.2, 0.5, 0.6],
    ['大沙发', 'sofa', 2.8, 1.0, 1.2],
    ['小椅子', 'chair', 0.4, 0.6, 0.4],
    ['高椅子', 'chair', 0.5, 1.0, 0.55],
    ['小马桶', 'toilet', 0.4, 0.6, 0.5],
    ['大马桶', 'toilet', 0.6, 0.85, 0.8],
    ['小洗手池', 'sink', 0.5, 0.6, 0.4],
    ['大洗手池', 'sink', 0.9, 0.9, 0.55],
    ['小冰箱', 'fridge', 0.5, 1.4, 0.5],
    ['大冰箱', 'fridge', 0.7, 1.8, 0.65],
    ['小电视柜', 'tvCabinet', 1.2, 0.4, 0.4],
    ['大电视柜', 'tvCabinet', 2, 0.5, 0.45],
    ['小餐桌', 'table', 0.8, 0.5, 0.5],
    ['大餐桌', 'table', 1.5, 0.75, 0.8],
    ['小圆桌', 'roundTable', 0.8, 0.5, 0.8],
    ['大圆桌', 'roundTable', 1.5, 0.75, 1.5],
    ['小书架', 'bookcase', 0.6, 1.2, 0.3],
    ['大书架', 'bookcase', 1.5, 2.0, 0.4],
    ['小洗衣机', 'washer', 0.5, 0.7, 0.5],
    ['大洗衣机', 'washer', 0.65, 0.9, 0.65],
    ['小浴缸', 'bathtub', 1.2, 0.5, 0.7],
    ['大浴缸', 'bathtub', 1.8, 0.7, 0.9],
    ['竖浴缸', 'bathtub', 0.7, 0.6, 1.6], // 长轴沿 z
    ['小床头柜', 'nightstand', 0.4, 0.4, 0.4],
    ['大床头柜', 'nightstand', 0.6, 0.6, 0.6],
    ['小梳妆台', 'dressingTable', 0.6, 0.5, 0.4],
    ['大梳妆台', 'dressingTable', 1.2, 0.75, 0.5],
    ['小鞋柜', 'shoeCabinet', 0.6, 0.8, 0.3],
    ['大鞋柜', 'shoeCabinet', 1.2, 1.1, 0.4],
    ['小灶台', 'stove', 0.6, 0.8, 0.5],
    ['大灶台', 'stove', 0.9, 0.85, 0.6],
    ['小烤箱', 'oven', 0.5, 0.5, 0.5],
    ['大烤箱', 'oven', 0.6, 0.6, 0.55],
    ['小微波炉', 'microwave', 0.45, 0.28, 0.3],
    ['大微波炉', 'microwave', 0.65, 0.32, 0.4],
  ]

  it.each(SIZES)(
    '%s：四朝向部件水平均在足迹内、底面贴地、顶部允许向上悬挑',
    (_label, kind, L, H, W) => {
      const facings = ['north', 'south', 'east', 'west'] as const
      for (const facing of facings) {
        for (const p of buildFurnitureParts(kind, L, H, W, facing)) {
          // 水平（x/z）必须钳制在 L×W 足迹内（墙碰撞/Gizmo 按足迹算）
          expect(p.center[0] - p.size[0] / 2, `facing=${facing}`).toBeGreaterThanOrEqual(
            -L / 2 - 1e-6,
          )
          expect(p.center[0] + p.size[0] / 2, `facing=${facing}`).toBeLessThanOrEqual(L / 2 + 1e-6)
          expect(p.center[2] - p.size[2] / 2, `facing=${facing}`).toBeGreaterThanOrEqual(
            -W / 2 - 1e-6,
          )
          expect(p.center[2] + p.size[2] / 2, `facing=${facing}`).toBeLessThanOrEqual(W / 2 + 1e-6)
          // 竖直：底面必须贴地；顶部允许向上悬挑（电视屏等，上方无墙不影响碰撞）
          expect(p.center[1] - p.size[1] / 2, `facing=${facing}`).toBeGreaterThanOrEqual(
            -H / 2 - 1e-6,
          )
          expect(p.center[1] + p.size[1] / 2, `facing=${facing}`).toBeLessThanOrEqual(
            H / 2 + 2 * H + 1e-6,
          )
        }
      }
    },
  )
})

describe('朝向', () => {
  it('床头板在长轴端（短边中间），朝贴靠的墙', () => {
    // 长轴 x（L=2 > W=1.5）
    const headLongX = (facing: Parameters<typeof buildFurnitureParts>[4]) =>
      buildFurnitureParts('bed', 2, 0.5, 1.5, facing).find((p) => p.shade === 'dark')!
    expect(headLongX('east').center[0]).toBeCloseTo(1 - 0.05, 5) // 东端
    expect(headLongX('west').center[0]).toBeCloseTo(-(1 - 0.05), 5) // 西端
    // 长轴 z（W=2 > L=1.5）
    const headLongZ = (facing: Parameters<typeof buildFurnitureParts>[4]) =>
      buildFurnitureParts('bed', 1.5, 0.5, 2, facing).find((p) => p.shade === 'dark')!
    expect(headLongZ('north').center[2]).toBeCloseTo(1 - 0.05, 5) // 北端
    expect(headLongZ('south').center[2]).toBeCloseTo(-(1 - 0.05), 5) // 南端
  })

  it('衣柜门朝房间内（背侧贴墙：朝北时门朝 -z，朝南时门朝 +z）', () => {
    const doors = (facing: Parameters<typeof buildFurnitureParts>[4]) =>
      buildFurnitureParts('wardrobe', 1.2, 1.8, 0.6, facing).filter((p) => p.shade === 'dark')
    expect(doors('north').every((d) => d.center[2] < 0)).toBe(true)
    expect(doors('south').every((d) => d.center[2] > 0)).toBe(true)
  })
})

describe('facingFromRoom', () => {
  const room = {
    position: { x: 0, y: 1.4, z: 0 },
    dimensions: { length: 4, width: 4, height: 2.8 },
  }
  // 长边沿 x（L=2 > W=0.9）：短轴 z，由南北墙距离决定
  const longX = (x: number, z: number) => ({
    position: { x, y: 0.4, z },
    dimensions: { length: 2, width: 0.9, height: 0.8 },
  })
  // 长边沿 z（W=2 > L=0.9）：短轴 x，由东西墙距离决定
  const longZ = (x: number, z: number) => ({
    position: { x, y: 0.4, z },
    dimensions: { length: 0.9, width: 2, height: 0.8 },
  })

  it('长边沿 x 时由最近的南北墙决定朝向', () => {
    expect(facingFromRoom(longX(0, 1.3), room)).toBe('north')
    expect(facingFromRoom(longX(0, -1.3), room)).toBe('south')
  })

  it('长边沿 z 时由最近的东西墙决定朝向', () => {
    expect(facingFromRoom(longZ(1.3, 0), room)).toBe('east')
    expect(facingFromRoom(longZ(-1.3, 0), room)).toBe('west')
  })

  it('转角衣柜（长边沿 z，贴东墙+南墙）应朝东，柜门开在大面', () => {
    // 旧「最近墙」逻辑会 tie 到南墙导致门开在小面；短轴规则应取东墙
    const corner = {
      position: { x: 1.3, y: 0.4, z: -1.3 },
      dimensions: { length: 0.9, width: 2, height: 2.4 },
    }
    expect(facingFromRoom(corner, room)).toBe('east')
    // 门应跨长轴 z（大面）、朝西（房间内），且门宽覆盖大面大部分
    const doors = buildFurnitureParts('wardrobe', 0.9, 2.4, 2, 'east').filter(
      (p) => p.shade === 'dark',
    )
    expect(doors).toHaveLength(2)
    expect(doors.every((d) => d.center[0] < 0)).toBe(true) // 西侧
    expect(doors[0].size[2]).toBeGreaterThan(0.8) // 沿 z 跨度 ≈ 大面宽的一半
  })

  it('长轴朝背（床）：由长轴方向上最近的墙决定朝向', () => {
    // 长边沿 x 的床：朝东/西；长边沿 z 的床：朝北/南
    expect(facingFromRoom(longX(0.9, 0), room, 'long')).toBe('east')
    expect(facingFromRoom(longX(-0.9, 0), room, 'long')).toBe('west')
    expect(facingFromRoom(longZ(0, 0.9), room, 'long')).toBe('north')
    expect(facingFromRoom(longZ(0, -0.9), room, 'long')).toBe('south')
  })
})

describe('partsBounds', () => {
  it('并集包围盒覆盖所有部件', () => {
    const parts: FurniturePart[] = [
      { center: [0, 0, 0], size: [2, 0.5, 1.5], shade: 'base' },
      { center: [0, 0.2, 0], size: [1, 0.1, 1], shade: 'secondary' },
    ]
    const bounds = partsBounds(parts)
    expect(bounds.min[0]).toBeCloseTo(-1, 5)
    expect(bounds.max[0]).toBeCloseTo(1, 5)
    expect(bounds.min[1]).toBeCloseTo(-0.25, 5)
    expect(bounds.max[1]).toBeCloseTo(0.25, 5)
  })

  it('generic 整盒的包围盒即整盒尺寸', () => {
    const parts = buildFurnitureParts('generic', 2, 0.5, 1.5)
    const bounds = partsBounds(parts)
    expect(bounds.min).toEqual([-1, -0.25, -0.75])
    expect(bounds.max).toEqual([1, 0.25, 0.75])
  })
})
