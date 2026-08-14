import { beforeEach, describe, expect, it } from 'vitest'
import { completeRoomFurniture, hasExcludedCompleteness } from './furnitureCompleteness'
import { furnitureKind } from './furniturePresets'
import { useSettingsStore } from '../store/useSettingsStore'
import type { FurnitureNode, RoomNode } from '../types/model'

/** 构造房间（家具 position 为绝对坐标，v3 语义） */
function room(children: FurnitureNode[]): RoomNode {
  return {
    id: 'r',
    type: 'room',
    name: '书房',
    footprint: [
      { x: -2, z: -2 },
      { x: 2, z: -2 },
      { x: 2, z: 2 },
      { x: -2, z: 2 },
    ],
    height: 2.8,
    doors: [],
    windows: [],
    furniture: children,
    nestedRooms: [],
  }
}

function f(id: string, name: string, x: number, z: number, description?: string): FurnitureNode {
  const dims =
    name === '床头柜'
      ? { length: 0.45, width: 0.4, height: 0.5 }
      : name === '茶几'
        ? { length: 1.2, width: 0.6, height: 0.45 }
        : name === '椅子' || name === '餐椅'
          ? { length: 0.45, width: 0.45, height: 0.8 }
          : { length: 2, width: 1.5, height: 0.5 }
  return {
    id,
    type: 'furniture',
    name,
    dimensions: dims,
    position: { x, y: dims.height / 2, z },
    ...(description !== undefined ? { description } : {}),
  }
}

describe('completeRoomFurniture 常配套件补全（坑 87）', () => {
  beforeEach(() => {
    // 语言显式设为中文：补全件名称随界面语言（jsdom 默认跟随系统为英文）
    useSettingsStore.setState({ language: 'zh' })
  })

  it('书桌 → 补 1 把椅子（使用者侧，书桌 -z 侧 0.6m）', () => {
    const desk = f('desk', '书桌', 0, 0)
    const out = completeRoomFurniture(room([desk]))
    expect(out).toHaveLength(2)
    const chair = out.find((x) => x.name === '椅子')!
    expect(furnitureKind(chair.name)).toBe('chair')
    expect(chair.position.x).toBeCloseTo(0, 5)
    expect(chair.position.z).toBeCloseTo(-0.6, 5)
    expect(chair.position.y).toBeCloseTo(0.4, 5) // 高度一半，底面贴地
  })

  it('梳妆台 → 补 1 把椅子', () => {
    const out = completeRoomFurniture(room([f('d', '梳妆台', 0, 0)]))
    expect(out.filter((x) => x.name === '椅子')).toHaveLength(1)
  })

  it('已有椅子时不重复补（幂等）', () => {
    const out1 = completeRoomFurniture(room([f('desk', '书桌', 0, 0)]))
    const out2 = completeRoomFurniture(room(out1)) // 第二轮
    expect(out2).toHaveLength(2) // 不再增加
    expect(out2.filter((x) => x.name === '椅子')).toHaveLength(1)
  })

  it('餐桌 → 长边两侧补 2 把餐椅；已有餐椅不重复', () => {
    const table = f('table', '餐桌', 0, 0)
    const out = completeRoomFurniture(room([table]))
    const chairs = out.filter((x) => x.name === '餐椅')
    expect(chairs).toHaveLength(2)
    // 餐桌长边（length 2 > width 1.5）沿 x：椅子在 x 两侧 1.35m（1 + 0.35）
    const xs = chairs.map((c) => c.position.x).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(-1.35, 5)
    expect(xs[1]).toBeCloseTo(1.35, 5)
    expect(chairs.every((c) => c.position.z === 0)).toBe(true)
    // 第二轮幂等
    expect(completeRoomFurniture(room(out))).toHaveLength(3)
  })

  it('圆桌 → 直径两侧补 2 把餐椅', () => {
    const out = completeRoomFurniture(room([f('rt', '圆桌', 0, 0)]))
    const chairs = out.filter((x) => x.name === '餐椅')
    expect(chairs).toHaveLength(2)
    const xs = chairs.map((c) => c.position.x).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(-(1 + 0.35), 5)
    expect(xs[1]).toBeCloseTo(1.35, 5)
  })

  it('床 → 床头两侧补 2 个床头柜（x 两侧，与床中心齐平）', () => {
    const bed = f('bed', '双人床', 0, 0)
    const out = completeRoomFurniture(room([bed]))
    const stands = out.filter((x) => x.name === '床头柜')
    expect(stands).toHaveLength(2)
    const xs = stands.map((s) => s.position.x).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(-(2 / 2 + 0.4 / 2 + 0.05), 5) // -1.25
    expect(xs[1]).toBeCloseTo(1.25, 5)
    expect(stands.every((s) => s.position.z === 0)).toBe(true)
    expect(stands.every((s) => s.position.y === 0.25)).toBe(true)
  })

  it('已有床头柜时不补', () => {
    const out = completeRoomFurniture(room([f('bed', '双人床', 0, 0), f('ns', '床头柜', -1.25, 0)]))
    expect(out.filter((x) => x.name === '床头柜')).toHaveLength(1)
  })

  it('沙发 → 前方补 1 个茶几（背侧反方向）', () => {
    const sofa = f('sofa', '沙发', 0, 0)
    const out = completeRoomFurniture(room([sofa]))
    const table = out.find((x) => x.name === '茶几')!
    expect(furnitureKind(table.name)).toBe('table')
    expect(table.position.z).toBeCloseTo(-0.6, 5)
  })

  it('description 含"不要"等排除词时整房间跳过补全（用户要求优先）', () => {
    const desk = f('desk', '书桌', 0, 0, '用户不要椅子')
    const out = completeRoomFurniture(room([desk]))
    expect(out).toHaveLength(1) // 不补椅子
    expect(hasExcludedCompleteness(room([desk]))).toBe(true)
    expect(hasExcludedCompleteness(room([f('desk', '书桌', 0, 0)]))).toBe(false)
    expect(hasExcludedCompleteness(room([f('desk', '书桌', 0, 0, '靠窗摆放')]))).toBe(false)
  })

  it('房间无家具或无可配套家具时返回原数组引用', () => {
    const empty = room([])
    expect(completeRoomFurniture(empty)).toBe(empty.furniture)
    const only = room([f('wc', '衣柜', 0, 0)])
    expect(completeRoomFurniture(only)).toBe(only.furniture)
  })

  it('多主家具各补各的配套（书桌+床：1 椅 + 2 床头柜）', () => {
    const out = completeRoomFurniture(room([f('desk', '书桌', -1, 0), f('bed', '双人床', 1, 0)]))
    expect(out.filter((x) => x.name === '椅子')).toHaveLength(1)
    expect(out.filter((x) => x.name === '床头柜')).toHaveLength(2)
  })
})
