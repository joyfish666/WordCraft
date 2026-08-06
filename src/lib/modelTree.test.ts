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
    // 床现贴南墙（z=-0.35，短边靠墙），仅 x 被拉回
    expect(bed.position.x).toBe(-2.6)
    expect(bed.position.z).toBeCloseTo(-0.35, 5)
  })

  it('父房间内嵌套子房间：家具被推出其占地（真·内嵌）', () => {
    // 主卧 4×3 内嵌主卧卫生间（NE 角），床头柜初始落在卫生间占地（足迹+墙厚）内
    const nightstand = {
      id: 'stand',
      type: 'furniture' as const,
      name: '床头柜',
      dimensions: { length: 0.5, width: 0.5, height: 0.5 },
      position: { x: 0.5, y: 0.25, z: 0.6 },
    }
    const bath = {
      id: 'bath',
      type: 'room' as const,
      name: '主卧卫生间',
      dimensions: { length: 2, width: 1.5, height: 2.8 },
      position: { x: 0.85, y: 1.4, z: 0.6 },
      children: [],
    }
    const master = {
      id: 'master',
      type: 'room' as const,
      name: '主卧',
      dimensions: { length: 4, width: 3, height: 2.8 },
      position: { x: 0, y: 1.4, z: 0 },
      children: [nightstand, bath],
    }
    const sceneNested = {
      version: 1 as const,
      root: {
        id: 'house',
        type: 'house' as const,
        name: '屋',
        dimensions: { length: 4, width: 3, height: 2.8 },
        position: { x: 0, y: 0, z: 0 },
        children: [master],
      },
    }
    const normalized = normalizeContainment(sceneNested)
    const stand = findNodeById(normalized.root, 'stand')!
    const hx = stand.dimensions.length / 2
    const hz = stand.dimensions.width / 2
    // 卫生间占地（足迹 + 墙厚）：x∈[-0.3,2.0]，z∈[-0.3,1.5]
    const keepMinX = 0.85 - (2 / 2 + 0.15)
    const keepMaxX = 0.85 + (2 / 2 + 0.15)
    const keepMinZ = 0.6 - (1.5 / 2 + 0.15)
    const keepMaxZ = 0.6 + (1.5 / 2 + 0.15)
    // 贴边允许浮点噪声（与坑 18 一致）：推出后应不再与占地重叠
    const EPS = 1e-6
    const outside =
      stand.position.x + hx <= keepMinX + EPS ||
      stand.position.x - hx >= keepMaxX - EPS ||
      stand.position.z + hz <= keepMinZ + EPS ||
      stand.position.z - hz >= keepMaxZ - EPS
    expect(outside).toBe(true)
    // 且仍在主卧墙内
    expect(stand.position.x).toBeGreaterThanOrEqual(-1.85 + hx)
    expect(stand.position.x).toBeLessThanOrEqual(1.85 - hx)
    // 嵌套房间本身位置不被挪动
    expect(findNodeById(normalized.root, 'bath')!.position).toEqual({ x: 0.85, y: 1.4, z: 0.6 })
  })
})
