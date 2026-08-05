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
  it('整屋包围盒来自整屋节点尺寸（示例 7×4）', () => {
    expect(houseBounds(scene)).toEqual({
      minX: -3.5,
      maxX: 3.5,
      minZ: -2,
      maxZ: 2,
      centerX: 0,
      centerZ: 0,
      width: 7,
      height: 4,
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
  it('递归收集所有房间，含嵌套，siblingIndex 与 3D 配色一致', () => {
    const rooms = walkRooms(scene.root)
    expect(rooms.map((r) => r.node.name)).toEqual(['走廊', '主卧', '客厅'])
    expect(rooms.map((r) => r.siblingIndex)).toEqual([0, 1, 2])
    expect(rooms.map((r) => r.depth)).toEqual([1, 1, 1])

    // 含嵌套房间：主卧内加一个卫生间 → 深度 2
    const nested = JSON.parse(JSON.stringify(scene)) as typeof scene
    ;(nested.root.children[1] as { children: unknown[] }).children.push({
      id: 'bath-master',
      type: 'room',
      name: '主卧卫生间',
      dimensions: { length: 1.5, width: 1.5, height: 2.8 },
      position: { x: -1, y: 1.4, z: -1 },
      children: [],
    })
    const all = walkRooms(nested.root)
    // 深度优先：推入主卧后立即递归，卫生间排在客厅之前
    expect(all).toHaveLength(4)
    expect(all.map((r) => r.node.name)).toEqual(['走廊', '主卧', '主卧卫生间', '客厅'])
    expect(all[2]).toMatchObject({ node: { name: '主卧卫生间' }, siblingIndex: 2, depth: 2 })
  })
})

describe('dimensionLines', () => {
  it('南侧总长 + 东侧总宽，位于包围盒外', () => {
    const bounds = houseBounds(scene)
    const lines = dimensionLines(bounds, { y: 3.5 })
    expect(lines).toHaveLength(2)
    expect(lines[0].label).toBe('总长 7m')
    expect(lines[0].from).toEqual([-3.5, 3.5, -2.6])
    expect(lines[0].to).toEqual([3.5, 3.5, -2.6])
    expect(lines[1].label).toBe('总宽 4m')
    expect(lines[1].from).toEqual([4.1, 3.5, -2])
    expect(lines[1].to).toEqual([4.1, 3.5, 2])
  })
})

describe('computePlanCamera', () => {
  it('正交取景使包围盒适配视口，居中于整屋', () => {
    const spec = computePlanCamera(houseBounds(scene), { width: 800, height: 600 })
    expect(spec.position).toEqual([0, 60, 0])
    expect(spec.target).toEqual([0, 0, 0])
    const fitX = 7 + 2
    const fitZ = 4 + 2
    expect(spec.zoom).toBeCloseTo(Math.min(800 / fitX, 600 / fitZ) * 0.9, 5)
  })

  it('空场景回退到取景原点', () => {
    const spec = computePlanCamera(null, { width: 800, height: 600 })
    expect(spec.position).toEqual([0, 60, 0])
    expect(spec.zoom).toBe(20)
  })
})
