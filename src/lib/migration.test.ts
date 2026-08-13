import { describe, expect, it } from 'vitest'
import { migrateModel } from './migration'
import type { SceneModel } from '../types/model'

/** 一个完整的 v1 盒子模型（含嵌套房间、墙类型家具、入户房间标记） */
function v1Model(): unknown {
  return {
    version: 1,
    root: {
      id: 'house1',
      type: 'house',
      name: '温馨之家',
      dimensions: { length: 10, width: 8, height: 2.8 },
      position: { x: 0, y: 0, z: 0 },
      entranceRoomId: 'living',
      children: [
        {
          id: 'living',
          type: 'room',
          name: '客厅',
          dimensions: { length: 6, width: 4.5, height: 2.8 },
          position: { x: -2.25, y: 1.4, z: -2.35 },
          children: [
            {
              id: 'sofa',
              type: 'furniture',
              name: '沙发',
              dimensions: { length: 2.2, width: 0.9, height: 0.8 },
              position: { x: -2, y: 0.4, z: -1.5 },
            },
            {
              id: 'wall1',
              type: 'wall',
              name: '隔断',
              dimensions: { length: 1, width: 0.2, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
            },
          ],
        },
        {
          id: 'master',
          type: 'room',
          name: '主卧',
          dimensions: { length: 4, width: 3.5, height: 2.8 },
          position: { x: 3.5, y: 1.4, z: 2.35 },
          children: [
            {
              id: 'bed',
              type: 'furniture',
              name: '双人床',
              dimensions: { length: 2, width: 1.5, height: 0.5 },
              position: { x: 0, y: 0.25, z: 0 },
            },
            {
              id: 'bath',
              type: 'room',
              name: '主卧卫生间',
              dimensions: { length: 2, width: 1.8, height: 2.8 },
              position: { x: 4.5, y: 1.4, z: 3.2 },
              children: [
                {
                  id: 'toilet',
                  type: 'furniture',
                  name: '马桶',
                  dimensions: { length: 0.6, width: 0.4, height: 0.7 },
                  position: { x: 0, y: 0.35, z: 0 },
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

describe('migrateModel（v1 → v3）', () => {
  it('盒子房间 → 4 点足迹，尺寸/中心一致', () => {
    const model = migrateModel(v1Model())!
    const living = model.root.levels[0]!.rooms.find((r) => r.id === 'living')!
    expect(living.footprint).toHaveLength(4)
    // 足迹包围盒与 v1 中心/尺寸一致（float 噪声容忍）
    const minX = Math.min(...living.footprint.map((p) => p.x))
    const maxX = Math.max(...living.footprint.map((p) => p.x))
    const minZ = Math.min(...living.footprint.map((p) => p.z))
    const maxZ = Math.max(...living.footprint.map((p) => p.z))
    expect((minX + maxX) / 2).toBeCloseTo(-2.25, 5)
    expect((minZ + maxZ) / 2).toBeCloseTo(-2.35, 5)
    expect(maxX - minX).toBeCloseTo(6, 5)
    expect(maxZ - minZ).toBeCloseTo(4.5, 5)
    expect(living.height).toBe(2.8)
  })

  it('嵌套房间保留在嵌套数组、家具与墙类型归并为 furniture', () => {
    const model = migrateModel(v1Model())!
    const master = model.root.levels[0]!.rooms.find((r) => r.id === 'master')!
    expect(master.nestedRooms.map((r) => r.id)).toEqual(['bath'])
    const bath = master.nestedRooms[0]!
    expect(bath.furniture.map((f) => f.id)).toEqual(['toilet'])
    // v1 的 'wall' 类型并入 furniture
    const living = model.root.levels[0]!.rooms.find((r) => r.id === 'living')!
    expect(living.furniture.map((f) => f.id)).toEqual(['sofa', 'wall1'])
    expect(living.furniture.every((f) => f.type === 'furniture')).toBe(true)
  })

  it('整屋 → 单层，entranceRoomId 保留，层高取最大', () => {
    const model = migrateModel(v1Model())!
    expect(model.version).toBe(3)
    expect(model.root.levels).toHaveLength(1)
    expect(model.root.levels[0]!.rooms).toHaveLength(2)
    expect(model.root.entranceRoomId).toBe('living')
    expect(model.root.levels[0]!.height).toBe(2.8)
  })

  it('迁移幂等：migrate(migrate(v1)) 与 migrate(v1) 结构一致', () => {
    const once = migrateModel(v1Model())!
    const twice = migrateModel(once)!
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })

  it('v3 输入原样返回（引用不变）', () => {
    const v3: SceneModel = {
      version: 3,
      root: { id: 'h', type: 'house', name: '屋', levels: [{ id: 'l1', height: 2.8, rooms: [] }] },
    }
    expect(migrateModel(v3)).toBe(v3)
  })

  it('非法输入返回 null（不崩溃）', () => {
    expect(migrateModel(null)).toBeNull()
    expect(migrateModel('str')).toBeNull()
    expect(migrateModel({})).toBeNull()
    expect(migrateModel({ version: 99 })).toBeNull()
    expect(migrateModel({ version: 1, root: { type: 'room' } })).toBeNull()
    expect(migrateModel({ version: 3, root: null })).toBeNull()
  })

  it('畸形 v3 输入返回 null（结构校验放行闸门，坑 A1）', () => {
    // 缺少楼层
    expect(migrateModel({ version: 3, root: { id: 'h', type: 'house', name: '屋' } })).toBeNull()
    // 楼层为空数组
    expect(
      migrateModel({
        version: 3,
        root: { id: 'h', type: 'house', name: '屋', levels: [] },
      }),
    ).toBeNull()
    // 房间足迹顶点不足 4 个
    const badFootprint = {
      version: 3,
      root: {
        id: 'h',
        type: 'house',
        name: '屋',
        levels: [
          {
            id: 'l1',
            height: 2.8,
            rooms: [
              {
                id: 'r1',
                type: 'room',
                name: '客厅',
                footprint: [
                  { x: 0, z: 0 },
                  { x: 3, z: 0 },
                  { x: 3, z: 3 },
                ],
                height: 2.8,
                doors: [],
                windows: [],
                furniture: [],
                nestedRooms: [],
              },
            ],
          },
        ],
      },
    }
    expect(migrateModel(badFootprint)).toBeNull()
    // 缺家具/门/窗数组（字段类型错误）
    expect(
      migrateModel({
        version: 3,
        root: {
          id: 'h',
          type: 'house',
          name: '屋',
          levels: [
            {
              id: 'l1',
              height: 2.8,
              rooms: [
                {
                  id: 'r1',
                  type: 'room',
                  name: '客厅',
                  footprint: [
                    { x: 0, z: 0 },
                    { x: 3, z: 0 },
                    { x: 3, z: 3 },
                    { x: 0, z: 3 },
                  ],
                  height: 2.8,
                  doors: 'bad',
                  windows: [],
                  furniture: [],
                  nestedRooms: [],
                },
              ],
            },
          ],
        },
      }),
    ).toBeNull()
    // 合法 v3 放行（防误杀回归）
    expect(
      migrateModel({
        version: 3,
        root: {
          id: 'h',
          type: 'house',
          name: '屋',
          levels: [{ id: 'l1', height: 2.8, rooms: [] }],
        },
      }),
    ).not.toBeNull()
  })

  it('v1 字段缺失时兜底默认值（不崩溃）', () => {
    const model = migrateModel({ version: 1, root: { type: 'house', children: [] } })!
    expect(model.root.name).toBe('整屋')
    expect(model.root.levels[0]!.rooms).toHaveLength(0)
    expect(model.root.levels[0]!.height).toBe(2.8)
  })
})
