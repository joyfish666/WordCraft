import { describe, expect, it } from 'vitest'
import { createSampleModel } from './sampleModel'
import { footprintBounds, footprintCenter, rectFootprint } from './footprint'
import {
  countNodes,
  findNodeById,
  getPathToNode,
  normalizeContainment,
  updateNodeFields,
  updateNodeFootprint,
  updateNodePosition,
} from './modelTree'
import type { FurnitureNode, RoomNode, SceneModel } from '../types/model'

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
    // 整屋 + 走廊 + 6 房间 + 内嵌卫生间 + 22 家具（18 源家具 + 常配套件补全 4：
    // 主卧床头柜×2、书桌椅、沙发茶几，坑 87——示例模型走 resolveLayout auto 路径）
    expect(countNodes(scene.root)).toBe(31)
  })

  it('updateNodePosition 不可变更新指定节点', () => {
    const next = updateNodePosition(scene.root, 'bed-master', { x: 9, y: 0.5, z: 9 })
    // 原树不受影响
    expect((findNodeById(scene.root, 'bed-master') as FurnitureNode).position.x).not.toBe(9)
    // 新树已更新，且其他节点位置不变
    expect((findNodeById(next, 'bed-master') as FurnitureNode).position).toEqual({
      x: 9,
      y: 0.5,
      z: 9,
    })
    expect((findNodeById(next, 'sofa-living') as FurnitureNode).position).toEqual(
      (findNodeById(scene.root, 'sofa-living') as FurnitureNode).position,
    )
  })

  it('updateNodePosition 平移房间足迹（中心对齐新位置）', () => {
    const master = findNodeById(scene.root, 'room-master') as RoomNode
    const oldCenter = roomCenterOf(master)
    const next = updateNodePosition(scene.root, 'room-master', {
      x: oldCenter.x + 1,
      y: 1.4,
      z: oldCenter.z,
    })
    const moved = findNodeById(next, 'room-master') as RoomNode
    expect(roomCenterOf(moved).x).toBeCloseTo(oldCenter.x + 1)
    expect(roomCenterOf(moved).z).toBeCloseTo(oldCenter.z)
    // 足迹尺寸不变
    expect(footprintSizeOf(moved)).toEqual(footprintSizeOf(master))
  })

  it('updateNodePosition 移动房间带动家具与嵌套房间（整体平移，相对关系不变）', () => {
    const bedBefore = (findNodeById(scene.root, 'bed-master') as FurnitureNode).position
    const bathBefore = footprintCenter(
      (findNodeById(scene.root, 'bath-master') as RoomNode).footprint,
    )
    const toiletBefore = (findNodeById(scene.root, 'toilet-master') as FurnitureNode).position
    const master = findNodeById(scene.root, 'room-master') as RoomNode
    const c = roomCenterOf(master)
    const dx = 1.5
    const dz = -0.75
    const next = updateNodePosition(scene.root, 'room-master', { x: c.x + dx, y: 1.4, z: c.z + dz })
    const bed = findNodeById(next, 'bed-master') as FurnitureNode
    const bath = findNodeById(next, 'bath-master') as RoomNode
    const toilet = findNodeById(next, 'toilet-master') as FurnitureNode
    // 家具与嵌套房间（含其家具）随房间平移同量位移
    expect(bed.position.x).toBeCloseTo(bedBefore.x + dx, 5)
    expect(bed.position.z).toBeCloseTo(bedBefore.z + dz, 5)
    expect(footprintCenter(bath.footprint).x).toBeCloseTo(bathBefore.x + dx, 5)
    expect(footprintCenter(bath.footprint).z).toBeCloseTo(bathBefore.z + dz, 5)
    expect(toilet.position.x).toBeCloseTo(toiletBefore.x + dx, 5)
    expect(toilet.position.z).toBeCloseTo(toiletBefore.z + dz, 5)
    // 嵌套房间仍被约束在父房间内部（相对关系不变）
    const mb = footprintBounds((findNodeById(next, 'room-master') as RoomNode).footprint)
    const bb = footprintBounds(bath.footprint)
    expect(bb.minX).toBeGreaterThanOrEqual(mb.minX - 1e-6)
    expect(bb.maxX).toBeLessThanOrEqual(mb.maxX + 1e-6)
  })

  it('updateNodeFields position 补丁移动房间同样带动家具', () => {
    const master = findNodeById(scene.root, 'room-master') as RoomNode
    const c = footprintCenter(master.footprint)
    const bedBefore = (findNodeById(scene.root, 'bed-master') as FurnitureNode).position
    const next = updateNodeFields(scene.root, 'room-master', { position: { x: c.x + 1, z: c.z } })
    const bed = findNodeById(next, 'bed-master') as FurnitureNode
    expect(bed.position.x).toBeCloseTo(bedBefore.x + 1, 5)
    expect(bed.position.z).toBeCloseTo(bedBefore.z, 5)
  })

  it('updateNodeFootprint 纯平移时带动家具，改形状时家具保持原位', () => {
    const master = findNodeById(scene.root, 'room-master') as RoomNode
    const bedBefore = (findNodeById(scene.root, 'bed-master') as FurnitureNode).position
    // 纯平移：所有顶点同量位移 → 家具随动
    const moved = updateNodeFootprint(
      scene.root,
      'room-master',
      master.footprint.map((p) => ({ x: p.x + 2, z: p.z + 1 })),
    )
    const bedMoved = findNodeById(moved, 'bed-master') as FurnitureNode
    expect(bedMoved.position.x).toBeCloseTo(bedBefore.x + 2, 5)
    expect(bedMoved.position.z).toBeCloseTo(bedBefore.z + 1, 5)
    // 改形状（仅北边外扩）：家具保持原位，等待 normalizeContainment 处理
    const resized = updateNodeFootprint(
      scene.root,
      'room-master',
      master.footprint.map((p, i) => (i === 2 ? { x: p.x, z: p.z + 1 } : p)),
    )
    const bedResized = findNodeById(resized, 'bed-master') as FurnitureNode
    expect(bedResized.position.x).toBeCloseTo(bedBefore.x, 5)
    expect(bedResized.position.z).toBeCloseTo(bedBefore.z, 5)
  })

  it('updateNodeFields 部分补丁合并更新（名称/尺寸/位置）', () => {
    const next = updateNodeFields(scene.root, 'bed-master', {
      name: '加大双人床',
      dimensions: { width: 1.8 },
    })
    expect(findNodeById(scene.root, 'bed-master')?.name).toBe('双人床')
    const bed = findNodeById(next, 'bed-master') as FurnitureNode
    expect(bed.name).toBe('加大双人床')
    // 示例模型应用家具常理后双人床已旋转（长宽交换为 1.5×2.0），只补 width → 1.8
    expect(bed.dimensions).toEqual({ length: 1.5, width: 1.8, height: 0.5 })
    expect(bed.position).toEqual((findNodeById(scene.root, 'bed-master') as FurnitureNode).position)
  })

  it('updateNodeFields 修改房间尺寸 → 足迹缩放、层高独立更新', () => {
    const master = findNodeById(scene.root, 'room-master') as RoomNode
    const before = footprintSizeOf(master)
    const next = updateNodeFields(scene.root, 'room-master', {
      dimensions: { length: before.length + 1, height: 3 },
    })
    const moved = findNodeById(next, 'room-master') as RoomNode
    const after = footprintSizeOf(moved)
    expect(after.length).toBeCloseTo(before.length + 1)
    expect(after.width).toBeCloseTo(before.width)
    expect(moved.height).toBe(3)
  })

  it('updateNodeFields 空补丁 / 未命中节点返回原树引用', () => {
    expect(updateNodeFields(scene.root, 'bed-master', {})).toBe(scene.root)
    expect(updateNodeFields(scene.root, 'not-exist', { name: 'x' })).toBe(scene.root)
  })

  it('normalizeContainment 将越墙的家具拉回房间内', () => {
    // 把主卧的双人床移到墙外（主卧 x 范围 -3.5~-0.5，内缩墙体 0.15）
    const sceneOut: SceneModel = {
      ...scene,
      root: {
        ...scene.root,
        levels: scene.root.levels.map((level) => ({
          ...level,
          rooms: level.rooms.map((r) =>
            r.id === 'room-master'
              ? {
                  ...r,
                  furniture: r.furniture.map((f) =>
                    f.id === 'bed-master' ? { ...f, position: { ...f.position, x: -3.4 } } : f,
                  ),
                }
              : r,
          ),
        })),
      },
    }
    const normalized = normalizeContainment(sceneOut)
    const bed = findNodeById(normalized.root, 'bed-master') as FurnitureNode
    const master = findNodeById(normalized.root, 'room-master') as RoomNode
    const mb = footprintBounds(master.footprint)
    // 拉回墙内（半宽 0.75，含墙厚内缩）
    expect(bed.position.x).toBeGreaterThanOrEqual(mb.minX + 0.15 + 0.75 - 1e-9)
    expect(bed.position.x).toBeLessThanOrEqual(mb.maxX - 0.15 - 0.75 + 1e-9)
    // 且不压嵌套卫生间占地（坑 47：旧实现钳制回墙边即止，可能压住内嵌卫生间）
    const bath = findNodeById(normalized.root, 'bath-master') as RoomNode
    const kb = footprintBounds(bath.footprint)
    const bedBox = {
      minX: bed.position.x - bed.dimensions.length / 2,
      maxX: bed.position.x + bed.dimensions.length / 2,
      minZ: bed.position.z - bed.dimensions.width / 2,
      maxZ: bed.position.z + bed.dimensions.width / 2,
    }
    const overlapsBath =
      bedBox.minX < kb.maxX - 1e-6 &&
      bedBox.maxX > kb.minX + 1e-6 &&
      bedBox.minZ < kb.maxZ - 1e-6 &&
      bedBox.maxZ > kb.minZ + 1e-6
    expect(overlapsBath).toBe(false)
    // 床仍贴北墙（z 不被推出范围）
    expect(bed.position.z).toBeCloseTo(2, 5)
  })

  it('normalizeContainment 把堵门的家具推出门口通道（手动编辑兜底）', () => {
    // 主卧床挪到主卧南墙门区中心（门区 x∈[-0.7,0.2]、z∈[1,2]，与渲染同源）
    const moved: SceneModel = {
      ...scene,
      root: {
        ...scene.root,
        levels: scene.root.levels.map((level) => ({
          ...level,
          rooms: level.rooms.map((r) =>
            r.id === 'room-master'
              ? {
                  ...r,
                  furniture: r.furniture.map((f) =>
                    f.id === 'bed-master'
                      ? { ...f, position: { ...f.position, x: -0.25, z: 1.5 } }
                      : f,
                  ),
                }
              : r,
          ),
        })),
      },
    }
    const normalized = normalizeContainment(moved)
    const bed = findNodeById(normalized.root, 'bed-master') as FurnitureNode
    const hx = bed.dimensions.length / 2
    const hz = bed.dimensions.width / 2
    const overlapsDoor =
      bed.position.x + hx > -0.7 + 1e-6 &&
      bed.position.x - hx < 0.2 - 1e-6 &&
      bed.position.z + hz > 1 + 1e-6 &&
      bed.position.z - hz < 2 - 1e-6
    expect(overlapsDoor).toBe(false)
    // 也不压嵌套卫生间占地（坑 47 保持）
    const bath = findNodeById(normalized.root, 'bath-master') as RoomNode
    const kb = footprintBounds(bath.footprint)
    const overlapsBath =
      bed.position.x + hx > kb.minX - 0.15 + 1e-6 &&
      bed.position.x - hx < kb.maxX + 0.15 - 1e-6 &&
      bed.position.z + hz > kb.minZ - 0.15 + 1e-6 &&
      bed.position.z - hz < kb.maxZ + 0.15 - 1e-6
    expect(overlapsBath).toBe(false)
    // 仍在主卧墙内
    const rm = findNodeById(normalized.root, 'room-master')
    const mb = footprintBounds((rm as RoomNode).footprint)
    expect(bed.position.x).toBeGreaterThanOrEqual(mb.minX + 0.15 + hx - 1e-9)
    expect(bed.position.z).toBeLessThanOrEqual(mb.maxZ - 0.15 - hz + 1e-9)
  })

  it('父房间内嵌套子房间：家具被推出其占地（真·内嵌）', () => {
    // 主卧 4×3 内嵌主卧卫生间（NE 角），床头柜初始落在卫生间占地（足迹+墙厚）内
    const nightstand: FurnitureNode = {
      id: 'stand',
      type: 'furniture',
      name: '床头柜',
      dimensions: { length: 0.5, width: 0.5, height: 0.5 },
      position: { x: 0.5, y: 0.25, z: 0.6 },
    }
    const bath: RoomNode = {
      id: 'bath',
      type: 'room',
      name: '主卧卫生间',
      footprint: rectFootprint(0.85, 0.6, 2, 1.5),
      height: 2.8,
      doors: [],
      windows: [],
      furniture: [],
      nestedRooms: [],
    }
    const master: RoomNode = {
      id: 'master',
      type: 'room',
      name: '主卧',
      footprint: rectFootprint(0, 0, 4, 3),
      height: 2.8,
      doors: [],
      windows: [],
      furniture: [nightstand],
      nestedRooms: [bath],
    }
    const sceneNested: SceneModel = {
      version: 3,
      root: {
        id: 'house',
        type: 'house',
        name: '屋',
        levels: [{ id: 'l1', height: 2.8, rooms: [master] }],
      },
    }
    const normalized = normalizeContainment(sceneNested)
    const stand = findNodeById(normalized.root, 'stand') as FurnitureNode
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
    const bathAfter = findNodeById(normalized.root, 'bath') as RoomNode
    const bathCenter = footprintCenter(bathAfter.footprint)
    expect(bathCenter.x).toBeCloseTo(0.85, 5)
    expect(bathCenter.z).toBeCloseTo(0.6, 5)
  })
})

function roomCenterOf(r: RoomNode): { x: number; z: number } {
  let sx = 0
  let sz = 0
  for (const p of r.footprint) {
    sx += p.x
    sz += p.z
  }
  const n = r.footprint.length
  return { x: n ? sx / n : 0, z: n ? sz / n : 0 }
}

function footprintSizeOf(r: RoomNode): { length: number; width: number } {
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
  return { length: maxX - minX, width: maxZ - minZ }
}
