import { describe, expect, it } from 'vitest'
import { createSampleModel } from '../lib/sampleModel'
import {
  computePlanCamera,
  dimensionLines,
  fmt,
  houseBounds,
  roomLabelText,
  walkRooms,
} from './planGeometry'

const scene = createSampleModel()

describe('houseBounds', () => {
  it('整屋包围盒来自整屋节点尺寸（示例 12.3×10）', () => {
    expect(houseBounds(scene)).toEqual({
      minX: -6.15,
      maxX: 6.15,
      minZ: -5,
      maxZ: 5,
      centerX: 0,
      centerZ: 0,
      width: 12.3,
      height: 10,
    })
  })
})

describe('fmt / roomLabelText', () => {
  it('fmt 去掉尾零，最多 2 位小数', () => {
    expect(fmt(7)).toBe('7')
    expect(fmt(3.5)).toBe('3.5')
    expect(fmt(3.333)).toBe('3.33')
    expect(fmt(0.125)).toBe('0.13')
  })

  it('房间标签为 名称 长×宽', () => {
    expect(roomLabelText('主卧', { length: 3, width: 3, height: 2.8 })).toBe('主卧 3×3')
  })
})

describe('walkRooms', () => {
  it('递归收集所有房间，含嵌套，深度优先', () => {
    const rooms = walkRooms(scene.root)
    expect(rooms.map((r) => r.node.name)).toEqual([
      '走廊',
      '客厅',
      '厨房',
      '餐厅',
      '主卧',
      '主卧卫生间',
      '次卧',
      '公共卫生间',
    ])
    expect(rooms.map((r) => r.depth)).toEqual([1, 1, 1, 1, 1, 2, 1, 1])
    // 嵌套卫生间深度 2（随父房间之后立即递归）
    expect(rooms[5]).toMatchObject({ node: { name: '主卧卫生间' }, depth: 2 })
  })
})

describe('dimensionLines', () => {
  it('南侧总长 + 东侧总宽，位于包围盒外', () => {
    const bounds = houseBounds(scene)
    const lines = dimensionLines(bounds, { y: 3.5 })
    expect(lines).toHaveLength(2)
    expect(lines[0].label).toBe('总长 12.3m')
    expect(lines[0].from).toEqual([-6.15, 3.5, -5.6])
    expect(lines[0].to).toEqual([6.15, 3.5, -5.6])
    expect(lines[1].label).toBe('总宽 10m')
    expect(lines[1].from).toEqual([6.75, 3.5, -5])
    expect(lines[1].to).toEqual([6.75, 3.5, 5])
  })
})

describe('computePlanCamera', () => {
  it('正交取景使包围盒适配视口，居中于整屋', () => {
    const spec = computePlanCamera(houseBounds(scene), { width: 800, height: 600 })
    expect(spec.position).toEqual([0, 60, 0])
    expect(spec.target).toEqual([0, 0, 0])
    const fitX = 12.3 + 2
    const fitZ = 10 + 2
    expect(spec.zoom).toBeCloseTo(Math.min(800 / fitX, 600 / fitZ) * 0.9, 5)
  })

  it('空场景回退到取景原点', () => {
    const spec = computePlanCamera(null, { width: 800, height: 600 })
    expect(spec.position).toEqual([0, 60, 0])
    expect(spec.zoom).toBe(20)
  })
})
