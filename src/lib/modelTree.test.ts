import { describe, expect, it } from 'vitest'
import { createSampleModel } from './sampleModel'
import {
  countNodes,
  findNodeById,
  getPathToNode,
  isContainer,
  normalizeContainment,
  updateNodeFields,
  updateNodePosition,
} from './modelTree'

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
    // 整屋 + 3 房间（含走廊） + 4 家具
    expect(countNodes(scene.root)).toBe(8)
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

  it('updateNodeFields 部分补丁合并更新（名称/尺寸/位置）', () => {
    const next = updateNodeFields(scene.root, 'bed-master', {
      name: '加大双人床',
      dimensions: { width: 1.8 },
    })
    expect(findNodeById(scene.root, 'bed-master')?.name).toBe('双人床')
    const bed = findNodeById(next, 'bed-master')
    expect(bed?.name).toBe('加大双人床')
    // 示例模型应用家具常理后双人床已旋转（长宽交换为 1.5×2.0），只补 width → 1.8
    expect(bed?.dimensions).toEqual({ length: 1.5, width: 1.8, height: 0.5 })
    expect(bed?.position).toEqual(findNodeById(scene.root, 'bed-master')?.position)
  })

  it('updateNodeFields 空补丁 / 未命中节点返回原树引用', () => {
    expect(updateNodeFields(scene.root, 'bed-master', {})).toBe(scene.root)
    expect(updateNodeFields(scene.root, 'not-exist', { name: 'x' })).toBe(scene.root)
  })

  it('normalizeContainment 将越墙的家具拉回房间内', () => {
    // 把主卧的双人床移到墙外（主卧 x 范围 -3.5~-0.5，内缩墙体 0.15）
    const sceneOut = {
      ...scene,
      root: {
        ...scene.root,
        children: scene.root.children.map((r) =>
          isContainer(r) && r.id === 'room-master'
            ? {
                ...r,
                children: r.children.map((f) =>
                  f.id === 'bed-master' ? { ...f, position: { ...f.position, x: -3.4 } } : f,
                ),
              }
            : r,
        ),
      },
    }
    const normalized = normalizeContainment(sceneOut)
    const bed = findNodeById(normalized.root, 'bed-master')!
    // 示例床已旋转为 1.5×2.0（半宽 0.75），可活动范围：x ∈ [-3.35+0.75, -0.65-0.75] = [-2.6, -1.4]
    expect(bed.position.x).toBe(-2.6)
    expect(bed.position.z).toBe(0)
  })
})
