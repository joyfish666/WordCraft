import { describe, expect, it } from 'vitest'
import { applyFurnitureConventions, isWallAnchored } from './furniturePlacement'
import { findNodeById } from './modelTree'
import type { ContainerNode, FurnitureNode, ModelNode, SceneModel } from '../types/model'

function furniture(id: string, name: string, length: number, width: number, x: number, z: number): FurnitureNode {
  return { id, type: 'furniture', name, dimensions: { length, width, height: 0.5 }, position: { x, y: 0.25, z } }
}

function room(id: string, length: number, width: number, x: number, z: number, children: ModelNode[]): ContainerNode {
  return { id, type: 'room', name: id, dimensions: { length, width, height: 2.8 }, position: { x, y: 1.4, z }, children }
}

/** 走廊（x 贯穿，z 中心 0）+ 若干顶层房间；房间贴走廊北侧时其南墙对走廊开门 */
function corridorHouse(rooms: ContainerNode[]): SceneModel {
  return {
    version: 1,
    root: {
      id: 'h',
      type: 'house',
      name: '示例房',
      dimensions: { length: 7, width: 6, height: 2.8 },
      position: { x: 0, y: 0, z: 0 },
      children: [
        {
          id: 'corridor',
          type: 'room',
          name: '走廊',
          dimensions: { length: 6, width: 1.2, height: 2.8 },
          position: { x: 0, y: 1.4, z: 0 },
          children: [],
        },
        ...rooms,
      ],
    },
  }
}

/** 贴走廊北侧的 3×3 卧室：南墙对走廊开门（门中心在卧室 x 中心） */
function bedroom(children: ModelNode[]): ContainerNode {
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
  it('靠墙家具贴墙并避让门口（床避到门对面的墙）', () => {
    const model = applyFurnitureConventions(corridorHouse([bedroom([furniture('bed', '双人床', 2, 1.5, 0, 0.5)])]))
    const bedroomNode = findNodeById(model.root, 'bedroom1') as ContainerNode
    const bed = findNodeById(model.root, 'bed')!
    // 门在卧室南墙（贴走廊），床避到北墙：北墙内壁 - 床半宽
    expect(bed.position.z).toBeCloseTo(
      bedroomNode.position.z + bedroomNode.dimensions.width / 2 - 0.15 - bed.dimensions.width / 2,
      5,
    )
  })

  it('大面积贴墙：长边沿墙，必要时旋转（交换长宽）', () => {
    const model = applyFurnitureConventions(corridorHouse([bedroom([furniture('wardrobe', '衣柜', 1.2, 0.6, 1.0, 2.0)])]))
    const wardrobe = findNodeById(model.root, 'wardrobe')!
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
    const bedroomNode = findNodeById(model.root, 'bedroom1') as ContainerNode
    const bed = findNodeById(model.root, 'bed')!
    const bath = findNodeById(model.root, 'bathroom1') as ContainerNode
    // 床避开门（南墙 x=0 门口）与卫生间，贴到东墙（旋转后长边沿墙）
    expect(bed.position.x).toBeCloseTo(
      bedroomNode.position.x + bedroomNode.dimensions.length / 2 - 0.15 - bed.dimensions.length / 2,
      5,
    )
    // 不与卫生间禁区（足迹 + 墙厚）重叠
    const kMaxX = bath.position.x + bath.dimensions.length / 2 + 0.15
    expect(bed.position.x - bed.dimensions.length / 2).toBeGreaterThanOrEqual(kMaxX - 1e-6)
    // 不堵门口：门口禁区的东缘（门宽 0.9 → 半宽 0.45）
    expect(bed.position.x - bed.dimensions.length / 2).toBeGreaterThanOrEqual(0.45 - 1e-6)
  })

  it('独立家具（茶几）不被贴墙，保持原位', () => {
    const model = applyFurnitureConventions(corridorHouse([bedroom([furniture('table', '茶几', 1.2, 0.6, 0.5, 2.5)])]))
    const table = findNodeById(model.root, 'table')!
    expect(table.position.x).toBeCloseTo(0.5, 5)
    expect(table.position.z).toBeCloseTo(2.5, 5)
  })

  it('嵌套房间内的家具也会被贴墙约束', () => {
    const master = room('bedroom1', 4.5, 3.5, 0, 2.35, [
      room('bathroom1', 2, 1.8, -1.1, 3.05, [furniture('toilet', '马桶', 0.5, 0.4, -1.1, 3.05)]),
    ])
    const model = applyFurnitureConventions(corridorHouse([master]))
    const bath = findNodeById(model.root, 'bathroom1') as ContainerNode
    const toilet = findNodeById(model.root, 'toilet')!
    // 马桶居中 → 贴卫生间南墙内壁（南墙最近，不旋转）
    expect(toilet.position.z).toBeCloseTo(bath.position.z - bath.dimensions.width / 2 + 0.15 + toilet.dimensions.width / 2, 5)
  })
})
