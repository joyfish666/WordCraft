import { describe, expect, it } from 'vitest'
import { applyFurnitureConventions, isWallAnchored } from './furniturePlacement'
import { findNodeById } from './modelTree'
import { rectFootprint } from './footprint'
import type { FurnitureNode, RoomNode, SceneModel } from '../types/model'

function furniture(
  id: string,
  name: string,
  length: number,
  width: number,
  x: number,
  z: number,
): FurnitureNode {
  return {
    id,
    type: 'furniture',
    name,
    dimensions: { length, width, height: 0.5 },
    position: { x, y: 0.25, z },
  }
}

function room(
  id: string,
  length: number,
  width: number,
  x: number,
  z: number,
  children: (RoomNode | FurnitureNode)[],
): RoomNode {
  return {
    id,
    type: 'room',
    name: id,
    footprint: rectFootprint(x, z, length, width),
    height: 2.8,
    doors: [],
    windows: [],
    furniture: children.filter((c): c is FurnitureNode => c.type === 'furniture'),
    nestedRooms: children.filter((c): c is RoomNode => c.type === 'room'),
  }
}

/** 走廊（x 贯穿，z 中心 0）+ 若干顶层房间；房间贴走廊北侧时其南墙对走廊开门 */
function corridorHouse(rooms: RoomNode[]): SceneModel {
  return {
    version: 3,
    root: {
      id: 'h',
      type: 'house',
      name: '示例房',
      levels: [
        {
          id: 'l1',
          height: 2.8,
          rooms: [
            {
              id: 'corridor',
              type: 'room',
              name: '走廊',
              footprint: rectFootprint(0, 0, 6, 1.2),
              height: 2.8,
              doors: [],
              windows: [],
              furniture: [],
              nestedRooms: [],
            },
            ...rooms,
          ],
        },
      ],
    },
  }
}

/** 贴走廊北侧的 3×3 卧室：南墙对走廊开门（门中心在卧室 x 中心） */
function bedroom(children: (RoomNode | FurnitureNode)[]): RoomNode {
  return room('bedroom1', 3, 3, 0, 2.1, children)
}

describe('isWallAnchored', () => {
  it('靠墙家具默认贴墙；独立家具保持原位', () => {
    expect(isWallAnchored('双人床')).toBe(true)
    expect(isWallAnchored('衣柜')).toBe(true)
    expect(isWallAnchored('橱柜')).toBe(true)
    expect(isWallAnchored('茶几')).toBe(false)
    expect(isWallAnchored('餐桌')).toBe(false)
    expect(isWallAnchored('圆桌')).toBe(false)
  })
})

describe('applyFurnitureConventions', () => {
  it('床短边（床头）贴墙，且避让门口', () => {
    const model = applyFurnitureConventions(
      corridorHouse([bedroom([furniture('bed', '双人床', 2, 1.5, 0, 0.5)])]),
    )
    const bedroomNode = findNodeById(model.root, 'bedroom1') as RoomNode
    const bed = findNodeById(model.root, 'bed') as FurnitureNode
    // 门在卧室南墙（贴走廊）。床贴最近的西墙、床头朝墙（短边 1.5 贴墙），
    // 长边（2.0）垂直墙伸入室内，并沿墙滑到北侧避开门口
    expect(bed.dimensions.length).toBe(2)
    expect(bed.dimensions.width).toBe(1.5)
    const bb = roomBounds(bedroomNode)
    expect(bed.position.x).toBeCloseTo(bb.minX + 0.15 + bed.dimensions.length / 2, 5)
    // 不堵门口：床南缘 ≥ 门口禁区北缘（南内壁 + 门深 1.0）
    expect(bed.position.z - bed.dimensions.width / 2).toBeCloseTo(bb.minZ + 0.15 + 1, 5)
  })

  it('大面积贴墙：长边沿墙，必要时旋转（交换长宽）', () => {
    const model = applyFurnitureConventions(
      corridorHouse([bedroom([furniture('wardrobe', '衣柜', 1.2, 0.6, 1.0, 2.0)])]),
    )
    const wardrobe = findNodeById(model.root, 'wardrobe') as FurnitureNode
    // 衣柜贴近东墙：贴墙后长边（1.2）沿墙（z 轴）→ 长宽交换
    expect(wardrobe.dimensions.length).toBe(0.6)
    expect(wardrobe.dimensions.width).toBe(1.2)
    // 贴东墙内壁：x = 内壁 - 半长(0.3)
    expect(wardrobe.position.x).toBeCloseTo(1.35 - 0.3, 5)
  })

  it('床贴墙后沿墙滑动，避开嵌套卫生间与门口', () => {
    const master = room('bedroom1', 4.5, 3.5, 0, 2.35, [
      furniture('bed', '双人床', 2, 1.5, 0, 1.55),
      room('bathroom1', 2, 1.8, -1.1, 3.05, []),
    ])
    const model = applyFurnitureConventions(corridorHouse([master]))
    const bed = findNodeById(model.root, 'bed') as FurnitureNode
    const bath = findNodeById(model.root, 'bathroom1') as RoomNode
    // 床贴最近的南墙、床头朝墙（短边 1.5 贴墙），长边（2.0）伸入室内，
    // 并滑到门口东侧避开门口与卫生间
    expect(bed.dimensions.length).toBe(1.5)
    expect(bed.dimensions.width).toBe(2.0)
    // 不堵门口：床西缘 ≥ 门口东缘（门宽 0.9 → 半宽 0.45）
    expect(bed.position.x - bed.dimensions.length / 2).toBeGreaterThanOrEqual(0.45 - 1e-6)
    // 不与卫生间禁区（足迹 + 墙厚）重叠
    const kMaxX = roomBounds(bath).maxX + 0.15
    expect(bed.position.x - bed.dimensions.length / 2).toBeGreaterThanOrEqual(kMaxX - 1e-6)
  })

  it('独立家具（茶几）不被贴墙，保持原位', () => {
    const model = applyFurnitureConventions(
      corridorHouse([bedroom([furniture('table', '茶几', 1.2, 0.6, 0.5, 2.5)])]),
    )
    const table = findNodeById(model.root, 'table') as FurnitureNode
    expect(table.position.x).toBeCloseTo(0.5, 5)
    expect(table.position.z).toBeCloseTo(2.5, 5)
  })

  it('嵌套房间内的家具也会被贴墙约束', () => {
    const master = room('bedroom1', 4.5, 3.5, 0, 2.35, [
      room('bathroom1', 2, 1.8, -1.1, 3.05, [furniture('toilet', '马桶', 0.5, 0.4, -1.1, 3.05)]),
    ])
    const model = applyFurnitureConventions(corridorHouse([master]))
    const bath = findNodeById(model.root, 'bathroom1') as RoomNode
    const toilet = findNodeById(model.root, 'toilet') as FurnitureNode
    // 马桶居中 → 贴卫生间南墙内壁（南墙最近，不旋转）
    const bb = roomBounds(bath)
    expect(toilet.position.z).toBeCloseTo(bb.minZ + 0.15 + toilet.dimensions.width / 2, 5)
  })

  it('常配套件补全后摆放：书房书桌+床 → 补椅子与床头柜且全部在房间内不重叠', () => {
    const study = room('study', 4.5, 3.5, 0, 2.35, [
      furniture('desk', '书桌', 1.2, 0.6, -1.4, 1.5),
      furniture('bed', '双人床', 2, 1.5, 1.0, 1.2),
    ])
    const model = applyFurnitureConventions(corridorHouse([study]))
    const studyNode = findNodeById(model.root, 'study') as RoomNode
    const furnitureList = studyNode.furniture
    const names = furnitureList.map((f) => f.name)
    // 补全生效：书桌 → 椅子；床 → 2 床头柜
    expect(names.filter((n) => n === '椅子')).toHaveLength(1)
    expect(names.filter((n) => n === '床头柜')).toHaveLength(2)
    // 全部约束在房间内壁范围内（内缩墙厚）
    const bb = roomBounds(studyNode)
    const inner = {
      minX: bb.minX + 0.15,
      maxX: bb.maxX - 0.15,
      minZ: bb.minZ + 0.15,
      maxZ: bb.maxZ - 0.15,
    }
    for (const f of furnitureList) {
      const hx = f.dimensions.length / 2
      const hz = f.dimensions.width / 2
      expect(f.position.x - hx).toBeGreaterThanOrEqual(inner.minX - 1e-6)
      expect(f.position.x + hx).toBeLessThanOrEqual(inner.maxX + 1e-6)
      expect(f.position.z - hz).toBeGreaterThanOrEqual(inner.minZ - 1e-6)
      expect(f.position.z + hz).toBeLessThanOrEqual(inner.maxZ + 1e-6)
    }
    // 两两不重叠（容差 1e-6，贴边允许）
    for (let i = 0; i < furnitureList.length; i++) {
      for (let j = i + 1; j < furnitureList.length; j++) {
        const a = furnitureList[i]
        const b = furnitureList[j]
        const noOverlap =
          a.position.x + a.dimensions.length / 2 <= b.position.x - b.dimensions.length / 2 + 1e-6 ||
          a.position.x - a.dimensions.length / 2 >= b.position.x + b.dimensions.length / 2 - 1e-6 ||
          a.position.z + a.dimensions.width / 2 <= b.position.z - b.dimensions.width / 2 + 1e-6 ||
          a.position.z - a.dimensions.width / 2 >= b.position.z + b.dimensions.width / 2 - 1e-6
        expect(noOverlap).toBe(true)
      }
    }
  })

  it('description 明确排除配套时不补全（用户要求优先，坑 87 通道）', () => {
    const study = room('study', 4.5, 3.5, 0, 2.35, [
      { ...furniture('desk', '书桌', 1.2, 0.6, -1.4, 1.5), description: '用户不要椅子' },
      furniture('bed', '双人床', 2, 1.5, 1.0, 1.2),
    ])
    const model = applyFurnitureConventions(corridorHouse([study]))
    const studyNode = findNodeById(model.root, 'study') as RoomNode
    const names = studyNode.furniture.map((f) => f.name)
    expect(names.filter((n) => n === '椅子')).toHaveLength(0) // 整房间跳过
    expect(names.filter((n) => n === '床头柜')).toHaveLength(0)
  })
})

function roomBounds(r: RoomNode): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of r.footprint) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  return { minX, maxX, minZ, maxZ }
}
