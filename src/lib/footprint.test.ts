import { describe, expect, it } from 'vitest'
import {
  collectLevelRooms,
  footprintBounds,
  footprintCenter,
  footprintDims,
  houseDims,
  houseLevelsBounds,
  levelHeight,
  nodeDims,
  nodePosition,
  rectFootprint,
  resizeFootprint,
  roomCenter,
  roomDims,
  translateFootprint,
} from './footprint'
import type { FurnitureNode, LevelNode, RoomNode } from '../types/model'

function room(id: string, cx: number, cz: number, len: number, wid: number, height = 2.8): RoomNode {
  return {
    id,
    type: 'room',
    name: id,
    footprint: rectFootprint(cx, cz, len, wid),
    height,
    doors: [],
    windows: [],
    furniture: [],
    nestedRooms: [],
  }
}

describe('rectFootprint / footprintBounds / footprintCenter / footprintDims', () => {
  it('矩形 → 4 点足迹（逆时针，西南起），包围盒/中心/尺寸一致', () => {
    const fp = rectFootprint(1, -2, 4, 3)
    expect(fp).toEqual([
      { x: -1, z: -3.5 },
      { x: 3, z: -3.5 },
      { x: 3, z: -0.5 },
      { x: -1, z: -0.5 },
    ])
    expect(footprintBounds(fp)).toEqual({ minX: -1, maxX: 3, minZ: -3.5, maxZ: -0.5 })
    expect(footprintCenter(fp)).toEqual({ x: 1, z: -2 })
    expect(footprintDims(fp)).toEqual({ length: 4, width: 3 })
  })

  it('空足迹不崩溃', () => {
    expect(footprintBounds([])).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 })
    expect(footprintCenter([])).toEqual({ x: 0, z: 0 })
    expect(footprintDims([])).toEqual({ length: 0, width: 0 })
  })
})

describe('translateFootprint / resizeFootprint', () => {
  it('平移足迹：全部顶点按增量移动', () => {
    const fp = rectFootprint(0, 0, 2, 2)
    const moved = translateFootprint(fp, 1.5, -0.5)
    expect(footprintCenter(moved)).toEqual({ x: 1.5, z: -0.5 })
  })

  it('缩放足迹：中心不变、包围盒尺寸精确改变', () => {
    const fp = rectFootprint(0, 0, 4, 3)
    const resized = resizeFootprint(fp, 6, 5)
    expect(footprintCenter(resized)).toEqual({ x: 0, z: 0 })
    expect(footprintDims(resized)).toEqual({ length: 6, width: 5 })
  })
})

describe('房间/整屋访问器', () => {
  it('roomCenter / roomDims 由足迹派生', () => {
    const r = room('r', 2, -1, 4, 3)
    expect(roomCenter(r)).toEqual({ x: 2, y: 1.4, z: -1 })
    expect(roomDims(r)).toEqual({ length: 4, width: 3, height: 2.8 })
  })

  it('nodePosition / nodeDims 覆盖 房间/家具/整屋', () => {
    const f: FurnitureNode = { id: 'f', type: 'furniture', name: '床', dimensions: { length: 2, width: 1.5, height: 0.5 }, position: { x: 1, y: 0.25, z: 2 } }
    expect(nodePosition(f)).toEqual({ x: 1, y: 0.25, z: 2 })
    expect(nodeDims(f)).toEqual({ length: 2, width: 1.5, height: 0.5 })
    const r = room('r', 0, 0, 4, 3)
    expect(nodePosition(r)).toEqual({ x: 0, y: 1.4, z: 0 })
    expect(nodeDims(r)).toEqual({ length: 4, width: 3, height: 2.8 })
  })

  it('houseLevelsBounds 为所有房间（含嵌套）足迹并集；houseDims 含楼层高', () => {
    const bath = room('bath', 0.8, 0.8, 2, 1.5)
    const master = { ...room('master', 0, 0, 4, 3), nestedRooms: [bath] }
    const level: LevelNode = { id: 'l1', height: 2.8, rooms: [master] }
    const house = { id: 'h', type: 'house' as const, name: '屋', levels: [level] }
    // 主卧足迹 [-2,2]×[-1.5,1.5]，嵌套卫生间延伸到 z=1.55 → 并集包含它
    const bounds = houseLevelsBounds(house)!
    expect(bounds).toEqual({ minX: -2, maxX: 2, minZ: -1.5, maxZ: 1.55 })
    expect(houseDims(house)).toEqual({ length: 4, width: 3.05, height: 2.8 })
  })

  it('levelHeight / collectLevelRooms', () => {
    const r1 = room('a', 0, 0, 2, 2, 3.2)
    const r2 = { ...room('b', 0, 0, 2, 2, 2.8), nestedRooms: [room('c', 0, 0, 1, 1, 2.5)] }
    const level: LevelNode = { id: 'l1', height: 2.8, rooms: [r1, r2] }
    expect(levelHeight(level.rooms)).toBe(3.2)
    expect(collectLevelRooms(level).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})
