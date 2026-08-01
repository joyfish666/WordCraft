import { describe, expect, it } from 'vitest'
import { createSampleModel } from './sampleModel'
import { countNodes, findNodeById, getPathToNode, updateNodePosition } from './modelTree'

const scene = createSampleModel()

describe('modelTree', () => {
  it('findNodeById 按 id 找到嵌套节点', () => {
    expect(findNodeById(scene.root, 'bed-master')?.name).toBe('双人床')
    expect(findNodeById(scene.root, 'not-exist')).toBeNull()
  })

  it('getPathToNode 返回从整屋到目标的全路径', () => {
    const path = getPathToNode(scene.root, 'sofa-living')
    expect(path.map((n) => n.name)).toEqual(['示例小屋', '客厅', '沙发'])
  })

  it('countNodes 统计全部模块', () => {
    // 整屋 + 2 房间 + 4 家具
    expect(countNodes(scene.root)).toBe(7)
  })

  it('updateNodePosition 不可变更新指定节点', () => {
    const next = updateNodePosition(scene.root, 'bed-master', { x: 9, y: 0.5, z: 9 })
    // 原树不受影响
    expect(findNodeById(scene.root, 'bed-master')?.position.x).not.toBe(9)
    // 新树已更新，且其他节点位置不变
    expect(findNodeById(next, 'bed-master')?.position).toEqual({ x: 9, y: 0.5, z: 9 })
    expect(findNodeById(next, 'sofa-living')?.position).toEqual(
      findNodeById(scene.root, 'sofa-living')?.position,
    )
  })
})
