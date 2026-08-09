import { describe, expect, it } from 'vitest'
import { footprintBounds, footprintCenter, houseLevelsBounds, roomCenter, roomDims } from './footprint'
import { doorZoneRect } from './furniturePlacement'
import { diffSceneV2, emptyScene, executeOps, findRoom } from './executor'
import { findNodeById } from './modelTree'
import { edgeOf, computeWallPlan, computeAllWallPlans, computeDoorZones } from './roomGeometry'
import type { FurnitureNode, RoomNode, SceneModel, SceneModelV2 } from '../types/model'
import type { Op } from '../types/ops'

function run(ops: Op[], base: SceneModel | null = null): SceneModel {
  return executeOps(base ?? emptyScene(), ops).scene
}

/** 便捷：从场景中取顶层房间数组 */
function topRooms(scene: SceneModel): RoomNode[] {
  return scene.root.levels[0].rooms
}

describe('executeOps - macro 整体布局', () => {
  it('macro corridor 复用走廊引擎：房间沿走廊两侧、入口在南侧、带入户门', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'corridor',
        params: {
          name: '示例房',
          corridor: { width: 1.2, entranceRoomId: 'living' },
          rooms: [
            {
              id: 'living',
              name: '客厅',
              dimensions: { length: 4, width: 3, height: 2.8 },
              side: 'left',
            },
            {
              id: 'master',
              name: '主卧',
              dimensions: { length: 3, width: 3, height: 2.8 },
              side: 'right',
              furniture: [
                { id: 'bed', name: '双人床', dimensions: { length: 2, width: 1.5, height: 0.5 } },
              ],
            },
          ],
        },
      },
    ])
    expect(scene.root.name).toBe('示例房')
    expect(scene.root.entranceRoomId).toBe('living')
    expect(topRooms(scene).some((c) => c.name === '走廊')).toBe(true)
    // 整屋居中于原点
    const bounds = houseLevelsBounds(scene.root)!
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(0, 5)
    expect((bounds.minZ + bounds.maxZ) / 2).toBeCloseTo(0, 5)
    // 客厅（入口）在南侧
    const living = findNodeById(scene.root, 'living') as RoomNode
    expect(roomCenter(living).z).toBeLessThan(0)
    // 家具保留且被约束进墙内
    const bed = findNodeById(scene.root, 'bed') as FurnitureNode
    expect(bed).toBeDefined()
    expect(bed.dimensions.length).toBe(2)
    // 入户门开在入口房间南墙
    const plan = computeWallPlan(topRooms(scene), { entrance: 'south', entranceRoomId: 'living' })
    expect(
      edgeOf(plan.get('living')!, 'south')!.segments.some((s) => s.kind === 'door' && s.entrance),
    ).toBe(true)
  })

  it('macro living 客厅居中、其他房间环绕', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'living',
        params: {
          centerRoomId: 'living',
          rooms: [
            { id: 'living', name: '客厅', dimensions: { length: 4, width: 3, height: 2.8 } },
            {
              id: 'master',
              name: '主卧',
              dimensions: { length: 3, width: 3, height: 2.8 },
              side: 'north',
            },
          ],
        },
      },
    ])
    const living = findNodeById(scene.root, 'living') as RoomNode
    const master = findNodeById(scene.root, 'master') as RoomNode
    expect(roomCenter(master).z).toBeGreaterThan(roomCenter(living).z)
  })

  it('macro custom 支持显式 footprint 顶点环（L 形直接表达）', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'lr',
              name: 'L形客厅',
              footprint: [
                { x: -4, z: -3 },
                { x: 4, z: -3 },
                { x: 4, z: 1 },
                { x: 1, z: 1 },
                { x: 1, z: 3 },
                { x: -4, z: 3 },
              ],
            },
          ],
        },
      },
    ])
    const room = findNodeById(scene.root, 'lr') as RoomNode
    expect(room.footprint.length).toBe(6) // 顶点环保留，未被矩形化
    // L 形包围盒 8×6（整屋居中）
    const b = houseLevelsBounds(scene.root)!
    expect(b.maxX - b.minX).toBeCloseTo(8, 5)
    expect(b.maxZ - b.minZ).toBeCloseTo(6, 5)
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 5)
    expect((b.minZ + b.maxZ) / 2).toBeCloseTo(0, 5)
  })

  it('macro 保持整屋 id 不变（多轮稳定性）', () => {
    const base = { ...emptyScene(), root: { ...emptyScene().root, id: 'myhouse' } }
    const scene = run(
      [{ op: 'macro', name: 'custom', params: { rooms: [{ id: 'a', name: '房A' }] } }],
      base,
    )
    expect(scene.root.id).toBe('myhouse')
  })

  it('macro 缺省 params 时生成空整屋（不崩溃）', () => {
    const scene = run([{ op: 'macro', name: 'custom' }])
    expect(scene.root.levels[0].rooms).toEqual([])
    expect(scene.root.name).toBe('未命名房屋')
  })
})

describe('executeOps - 房间增删改', () => {
  it('addRoom 无 relativeTo 时排到整屋东侧（不重叠）', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'a',
              name: '房A',
              dimensions: { length: 3, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
            },
          ],
        },
      },
    ])
    const scene = run(
      [{ op: 'addRoom', id: 'b', name: '房B', dimensions: { length: 3, width: 3, height: 2.8 } }],
      base,
    )
    const a = findNodeById(scene.root, 'a') as RoomNode
    const b = findNodeById(scene.root, 'b') as RoomNode
    expect(roomCenter(b).x).toBeGreaterThan(roomCenter(a).x)
    // 不重叠（3 + 0.3 间隔 + 3，两侧各留半个房间）
    const ba = houseLevelsBounds(scene.root)!
    expect(ba.maxX - ba.minX).toBeCloseTo(6.3, 5)
  })

  it('addRoom relativeTo 贴到指定房间一侧（无缝共墙）', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'a',
              name: '房A',
              dimensions: { length: 4, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
            },
          ],
        },
      },
    ])
    const scene = run(
      [
        {
          op: 'addRoom',
          id: 'n',
          name: '北房',
          dimensions: { length: 3, width: 3, height: 2.8 },
          relativeTo: { roomId: 'a', dir: 'north' },
        },
      ],
      base,
    )
    const a = findNodeById(scene.root, 'a') as RoomNode
    const n = findNodeById(scene.root, 'n') as RoomNode
    const ab = houseLevelsBoundsOf(a)
    expect(roomCenter(n).z).toBeGreaterThan(ab.maxZ)
    // 共墙线重合（无缝）：新房间南墙 = 房A 北墙
    expect(roomCenter(n).z - roomDims(n).width / 2).toBeCloseTo(ab.maxZ, 5)
  })

  it('addRoom relativeTo 房间不存在时该条失败跳过', () => {
    const base = run([
      { op: 'macro', name: 'custom', params: { rooms: [{ id: 'a', name: '房A' }] } },
    ])
    const result = executeOps(base, [
      { op: 'addRoom', id: 'x', name: '孤儿', relativeTo: { roomId: 'ghost', dir: 'east' } },
      { op: 'addRoom', id: 'ok', name: '好房间' },
    ])
    expect(result.skipped.length).toBe(1)
    expect(result.skipped[0]).toContain('addRoom')
    expect(findNodeById(result.scene.root, 'x')).toBeNull()
    expect(findNodeById(result.scene.root, 'ok')).not.toBeNull()
    expect(result.applied).toBe(1)
  })

  it('addRoom id 重复时该条失败跳过', () => {
    const base = run([
      { op: 'macro', name: 'custom', params: { rooms: [{ id: 'a', name: '房A' }] } },
    ])
    const result = executeOps(base, [{ op: 'addRoom', id: 'a', name: '重复' }])
    expect(result.skipped.length).toBe(1)
  })

  it('updateRoom 修改名称与尺寸（房间被缩放、高度更新）', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'a',
              name: '房A',
              dimensions: { length: 3, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
            },
          ],
        },
      },
    ])
    const scene = run(
      [
        {
          op: 'updateRoom',
          id: 'a',
          patch: { name: '大客厅', dimensions: { length: 5, width: 4, height: 3 } },
        },
      ],
      base,
    )
    const a = findNodeById(scene.root, 'a') as RoomNode
    expect(a.name).toBe('大客厅')
    expect(roomDims(a).length).toBeCloseTo(5, 5)
    expect(roomDims(a).width).toBeCloseTo(4, 5)
    expect(a.height).toBe(3)
    // 楼层高度同步刷新
    expect(scene.root.levels[0].height).toBe(3)
  })

  it('updateRoom 空补丁 / 未命中房间时失败跳过', () => {
    const base = run([
      { op: 'macro', name: 'custom', params: { rooms: [{ id: 'a', name: '房A' }] } },
    ])
    const r1 = executeOps(base, [{ op: 'updateRoom', id: 'a', patch: {} }])
    expect(r1.skipped.length).toBe(1)
    const r2 = executeOps(base, [{ op: 'updateRoom', id: 'ghost', patch: { name: 'x' } }])
    expect(r2.skipped.length).toBe(1)
  })

  it('removeRoom 删除房间；删除入口房间时清空 entranceRoomId', () => {
    const base = run([
      {
        op: 'macro',
        name: 'corridor',
        params: {
          corridor: { entranceRoomId: 'living' },
          rooms: [
            { id: 'living', name: '客厅', side: 'left' },
            { id: 'm', name: '主卧', side: 'right' },
          ],
        },
      },
    ])
    const scene = run([{ op: 'removeRoom', id: 'living' }], base)
    expect(findNodeById(scene.root, 'living')).toBeNull()
    expect(findNodeById(scene.root, 'm')).not.toBeNull()
    expect(scene.root.entranceRoomId).toBeUndefined()
  })

  it('moveRoom 移到另一个房间的指定侧（relativeTo）', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'a',
              name: '房A',
              dimensions: { length: 4, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
            },
            {
              id: 'b',
              name: '房B',
              dimensions: { length: 3, width: 3, height: 2.8 },
              position: { x: 6, y: 1.4, z: 0 },
            },
          ],
        },
      },
    ])
    const scene = run(
      [{ op: 'moveRoom', id: 'b', relativeTo: { roomId: 'a', dir: 'south' } }],
      base,
    )
    const a = findNodeById(scene.root, 'a') as RoomNode
    const b = findNodeById(scene.root, 'b') as RoomNode
    const ab = houseLevelsBoundsOf(a)
    expect(roomCenter(b).z).toBeLessThan(ab.minZ)
    // 房B 北墙 = 房A 南墙（无缝）
    expect(roomCenter(b).z + roomDims(b).width / 2).toBeCloseTo(ab.minZ, 5)
  })

  it('moveRoom 缺 relativeTo 或目标不存在时失败跳过', () => {
    const base = run([
      { op: 'macro', name: 'custom', params: { rooms: [{ id: 'a', name: '房A' }] } },
    ])
    const r1 = executeOps(base, [{ op: 'moveRoom', id: 'a' }])
    expect(r1.skipped.length).toBe(1)
    const r2 = executeOps(base, [
      { op: 'moveRoom', id: 'a', relativeTo: { roomId: 'ghost', dir: 'east' } },
    ])
    expect(r2.skipped.length).toBe(1)
  })

  it('moveRoom 东侧贴靠时对齐走廊边线（宽度不同的房间不留缝隙）', () => {
    const base = run([
      {
        op: 'macro',
        name: 'corridor',
        params: {
          name: '示例房',
          corridor: { width: 1.2, entranceRoomId: 'living' },
          rooms: [
            { id: 'living', name: '客厅', side: 'left', dimensions: { length: 5, width: 4, height: 2.8 } },
            { id: 'master', name: '主卧', side: 'right', dimensions: { length: 4, width: 3.5, height: 2.8 } },
            { id: 'bed2', name: '次卧', side: 'right', dimensions: { length: 3.5, width: 3, height: 2.8 } },
          ],
        },
      },
    ])
    const scene = run(
      [{ op: 'moveRoom', id: 'bed2', relativeTo: { roomId: 'master', dir: 'east' } }],
      base,
    )
    const corridor = topRooms(base).find((r) => r.name === '走廊')!
    const bed2 = findNodeById(scene.root, 'bed2') as RoomNode
    const cb = footprintBounds(corridor.footprint)
    const bb = footprintBounds(bed2.footprint)
    // 次卧南边 = 走廊北边线（不再悬空 0.25m）
    expect(bb.minZ).toBeCloseTo(cb.maxZ, 5)
    // 且与主卧无缝相邻
    const master = findNodeById(scene.root, 'master') as RoomNode
    expect(bb.minX).toBeCloseTo(footprintBounds(master.footprint).maxX, 5)
  })

  it('addRoom 带 relativeTo 贴靠同样对齐走廊边线', () => {
    const base = run([
      {
        op: 'macro',
        name: 'corridor',
        params: {
          name: '示例房',
          corridor: { width: 1.2, entranceRoomId: 'living' },
          rooms: [
            { id: 'living', name: '客厅', side: 'left', dimensions: { length: 5, width: 4, height: 2.8 } },
            { id: 'master', name: '主卧', side: 'right', dimensions: { length: 4, width: 3.5, height: 2.8 } },
          ],
        },
      },
    ])
    const scene = run(
      [
        {
          op: 'addRoom',
          id: 'new',
          name: '新房间',
          dimensions: { length: 3, width: 2.5, height: 2.8 },
          relativeTo: { roomId: 'master', dir: 'east' },
        },
      ],
      base,
    )
    const corridor = topRooms(base).find((r) => r.name === '走廊')!
    const nb = footprintBounds((findNodeById(scene.root, 'new') as RoomNode).footprint)
    expect(nb.minZ).toBeCloseTo(footprintBounds(corridor.footprint).maxZ, 5)
  })

  it('addAdjacency 等价于 moveRoom（把 neighbor 移到 roomId 侧）', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'a',
              name: '房A',
              dimensions: { length: 4, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
            },
            {
              id: 'b',
              name: '房B',
              dimensions: { length: 3, width: 3, height: 2.8 },
              position: { x: 6, y: 1.4, z: 0 },
            },
          ],
        },
      },
    ])
    const scene = run([{ op: 'addAdjacency', roomId: 'a', neighborId: 'b', side: 'west' }], base)
    const a = findNodeById(scene.root, 'a') as RoomNode
    const b = findNodeById(scene.root, 'b') as RoomNode
    expect(roomCenter(b).x).toBeLessThan(houseLevelsBoundsOf(a).minX)
  })

  it('nestRoom 把顶层房间内嵌进父房间（默认东北角，家具随动）', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'master',
              name: '主卧',
              dimensions: { length: 4, width: 3.5, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
              furniture: [{ id: 'bed', name: '双人床', dimensions: { length: 2, width: 1.5, height: 0.5 } }],
            },
            {
              id: 'bath',
              name: '主卧卫生间',
              dimensions: { length: 2, width: 1.8, height: 2.8 },
              position: { x: 5, y: 1.4, z: 0 },
              furniture: [
                { id: 'toilet', name: '马桶', dimensions: { length: 0.6, width: 0.4, height: 0.7 } },
              ],
            },
          ],
        },
      },
    ])
    const scene = run([{ op: 'nestRoom', id: 'bath', into: 'master' }], base)
    const master = findNodeById(scene.root, 'master') as RoomNode
    const bath = findNodeById(scene.root, 'bath') as RoomNode
    // 从顶层移入嵌套
    expect(topRooms(scene).map((r) => r.id)).not.toContain('bath')
    expect(master.nestedRooms.map((r) => r.id)).toContain('bath')
    // 落在父房间内部（东北角：x/z 靠父包围盒正侧）
    const mb = houseLevelsBoundsOf(master)
    expect(footprintBounds(bath.footprint).minX).toBeGreaterThan(mb.minX)
    expect(footprintBounds(bath.footprint).maxX).toBeLessThanOrEqual(mb.maxX + 1e-6)
    expect(footprintBounds(bath.footprint).maxZ).toBeGreaterThan(mb.minZ)
    // 家具随房间整体平移（相对位置不变）
    const toilet = findNodeById(scene.root, 'toilet') as FurnitureNode
    const bathC = footprintCenter(bath.footprint)
    expect(toilet.position.x - bathC.x).toBeCloseTo(0, 5)
    // 主卧床被 normalizeContainment 推出嵌套占地
    const bed = findNodeById(scene.root, 'bed') as FurnitureNode
    expect(bed).toBeDefined()
  })

  it('nestRoom side 指定父房间其他角；落点避开父房间门口禁区', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'master',
              name: '主卧',
              dimensions: { length: 4, width: 3.5, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
            },
            {
              id: 'bath',
              name: '卫生间',
              dimensions: { length: 2, width: 1.8, height: 2.8 },
              position: { x: 5, y: 1.4, z: 0 },
            },
          ],
        },
      },
    ])
    const scene = run([{ op: 'nestRoom', id: 'bath', into: 'master', side: 'south' }], base)
    const master = findNodeById(scene.root, 'master') as RoomNode
    const bath = findNodeById(scene.root, 'bath') as RoomNode
    const mb = houseLevelsBoundsOf(master)
    const bb = footprintBounds(bath.footprint)
    // 完全在父房间内部（含墙厚余量）
    expect(bb.minX).toBeGreaterThan(mb.minX)
    expect(bb.maxX).toBeLessThan(mb.maxX)
    expect(bb.minZ).toBeGreaterThan(mb.minZ)
    expect(bb.maxZ).toBeLessThan(mb.maxZ)
    // 落点不压父房间门口禁区（坑 47：南墙有入户门、东墙有兜底门 → 避开，落到西北角）
    const zones = computeDoorZones(topRooms(scene), {
      entrance: scene.root.entranceDir ?? 'south',
      entranceRoomId: scene.root.entranceRoomId,
    }).get('master')!
    for (const z of zones.map((zone) => doorZoneRect(master, zone))) {
      const overlapsZone =
        bb.minX < z.maxX - 1e-6 && bb.maxX > z.minX + 1e-6 && bb.minZ < z.maxZ - 1e-6 && bb.maxZ > z.minZ + 1e-6
      expect(overlapsZone).toBe(false)
    }
  })

  it('nestRoom 非法输入跳过：目标不存在 / 嵌套自身 / 成环', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            { id: 'a', name: '房A', dimensions: { length: 4, width: 3, height: 2.8 }, position: { x: 0, y: 1.4, z: 0 } },
            { id: 'b', name: '房B', dimensions: { length: 2, width: 2, height: 2.8 }, position: { x: 6, y: 1.4, z: 0 } },
          ],
        },
      },
    ])
    const r1 = executeOps(base, [{ op: 'nestRoom', id: 'ghost', into: 'a' }])
    expect(r1.skipped.length).toBe(1)
    const r2 = executeOps(base, [{ op: 'nestRoom', id: 'b', into: 'ghost' }])
    expect(r2.skipped.length).toBe(1)
    const r3 = executeOps(base, [{ op: 'nestRoom', id: 'b', into: 'b' }])
    expect(r3.skipped.length).toBe(1)
    // 成环：先把 a 嵌进 b，再把 b 嵌进 a
    const nested = run([{ op: 'nestRoom', id: 'a', into: 'b' }], base)
    const r4 = executeOps(nested, [{ op: 'nestRoom', id: 'b', into: 'a' }])
    expect(r4.skipped.length).toBe(1)
    expect(r4.scene).toEqual(nested)
  })

  it('moveRoom 把嵌套房间移出父房间（取消内嵌）', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'bedroom',
              name: '主卧',
              dimensions: { length: 4, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
              nestedRooms: [
                { id: 'bath', name: '主卧卫生间', dimensions: { length: 2, width: 1.8, height: 2.8 }, side: 'north' },
              ],
            },
          ],
        },
      },
    ])
    const scene = run(
      [{ op: 'moveRoom', id: 'bath', relativeTo: { roomId: 'bedroom', dir: 'east' } }],
      base,
    )
    const bedroom = findNodeById(scene.root, 'bedroom') as RoomNode
    const bath = findNodeById(scene.root, 'bath') as RoomNode
    // 移出父房间，成为顶层房间
    expect(topRooms(scene).map((r) => r.id)).toContain('bath')
    expect(bedroom.nestedRooms.map((r) => r.id)).not.toContain('bath')
    // 贴靠主卧东侧（无缝共墙）
    expect(footprintBounds(bath.footprint).minX).toBeCloseTo(
      footprintBounds(bedroom.footprint).maxX,
      5,
    )
  })

  it('moveRoom 移出嵌套房间：请求方向被走廊占用时自动选空侧', () => {
    const base = run([
      {
        op: 'macro',
        name: 'corridor',
        params: {
          name: '示例房',
          corridor: { width: 1.2, entranceRoomId: 'living' },
          rooms: [
            { id: 'living', name: '客厅', side: 'left', dimensions: { length: 5, width: 4, height: 2.8 } },
            {
              id: 'master',
              name: '主卧',
              side: 'right',
              dimensions: { length: 4, width: 3.5, height: 2.8 },
              nestedRooms: [
                { id: 'bath', name: '主卧卫生间', dimensions: { length: 2, width: 1.8, height: 2.8 }, side: 'north' },
              ],
            },
          ],
        },
      },
    ])
    // 请求南侧（= 走廊位置，被占用）→ 自动选空侧（北）
    const scene = run(
      [{ op: 'moveRoom', id: 'bath', relativeTo: { roomId: 'master', dir: 'south' } }],
      base,
    )
    const bath = findNodeById(scene.root, 'bath') as RoomNode
    expect(topRooms(scene).map((r) => r.id)).toContain('bath')
    // 不与其他任何顶层房间重叠（含走廊）
    const bb = footprintBounds(bath.footprint)
    for (const r of topRooms(scene)) {
      if (r.id === 'bath') continue
      const rb = footprintBounds(r.footprint)
      const o = bb.minX < rb.maxX - 1e-6 && bb.maxX > rb.minX + 1e-6 && bb.minZ < rb.maxZ - 1e-6 && bb.maxZ > rb.minZ + 1e-6
      expect(o).toBe(false)
    }
  })

  it('addRoom relativeTo 被占用时同样自动选空侧', () => {
    const base = run([
      {
        op: 'macro',
        name: 'corridor',
        params: {
          name: '示例房',
          corridor: { width: 1.2, entranceRoomId: 'living' },
          rooms: [
            { id: 'living', name: '客厅', side: 'left', dimensions: { length: 5, width: 4, height: 2.8 } },
            { id: 'master', name: '主卧', side: 'right', dimensions: { length: 4, width: 3.5, height: 2.8 } },
          ],
        },
      },
    ])
    // 主卧南侧 = 走廊（占用）→ 自动选空侧（回退顺序北先于东，落到主卧北侧）
    const scene = run(
      [
        {
          op: 'addRoom',
          id: 'new',
          name: '新房间',
          dimensions: { length: 3, width: 2.5, height: 2.8 },
          relativeTo: { roomId: 'master', dir: 'south' },
        },
      ],
      base,
    )
    const nb = footprintBounds((findNodeById(scene.root, 'new') as RoomNode).footprint)
    const master = findNodeById(scene.root, 'master') as RoomNode
    const mb = footprintBounds(master.footprint)
    // 与主卧无缝共墙（贴靠主卧北侧：新房间南边 = 主卧北边）
    expect(nb.minZ).toBeCloseTo(mb.maxZ, 5)
    // 不与其他任何顶层房间重叠（含走廊）
    for (const r of topRooms(scene)) {
      if (r.id === 'new') continue
      const rb = footprintBounds(r.footprint)
      const o = nb.minX < rb.maxX - 1e-6 && nb.maxX > rb.minX + 1e-6 && nb.minZ < rb.maxZ - 1e-6 && nb.maxZ > rb.minZ + 1e-6
      expect(o).toBe(false)
    }
  })

  it('已嵌套的房间可再次被 nestRoom 移到另一个父房间', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'master',
              name: '主卧',
              dimensions: { length: 4, width: 3.5, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
              nestedRooms: [{ id: 'bath', name: '主卧卫生间', dimensions: { length: 2, width: 1.8, height: 2.8 } }],
            },
            {
              id: 'bed2',
              name: '次卧',
              dimensions: { length: 3, width: 3, height: 2.8 },
              position: { x: 6, y: 1.4, z: 0 },
            },
          ],
        },
      },
    ])
    const scene = run([{ op: 'nestRoom', id: 'bath', into: 'bed2' }], base)
    const master = findNodeById(scene.root, 'master') as RoomNode
    const bed2 = findNodeById(scene.root, 'bed2') as RoomNode
    expect(master.nestedRooms.map((r) => r.id)).not.toContain('bath')
    expect(bed2.nestedRooms.map((r) => r.id)).toContain('bath')
  })

  it('nestRoom 回归（坑 47）：落点避开父房间门洞、父房间家具被推出卫生间占地', () => {
    const base = run([
      {
        op: 'macro',
        name: 'corridor',
        params: {
          name: '三室一厅两卫一厨',
          corridor: { width: 1.2, entranceRoomId: '客厅' },
          rooms: [
            { id: '客厅', name: '客厅', side: 'left', dimensions: { length: 5, width: 4, height: 2.8 } },
            {
              id: '主卧',
              name: '主卧',
              side: 'left',
              dimensions: { length: 4, width: 3.5, height: 2.8 },
              furniture: [
                { id: 'bed', name: '双人床', dimensions: { length: 2, width: 1.5, height: 0.5 }, position: { x: 0, y: 0.25, z: -0.8 } },
                { id: 'stand', name: '床头柜', dimensions: { length: 0.5, width: 0.4, height: 0.5 }, position: { x: 1.2, y: 0.25, z: -0.8 } },
              ],
            },
            { id: '主卧卫生间', name: '主卧卫生间', side: 'left', dimensions: { length: 2, width: 1.8, height: 2.8 } },
            { id: '次卧', name: '次卧', side: 'right', dimensions: { length: 3.5, width: 3, height: 2.8 } },
          ],
        },
      },
    ])
    const scene = run([{ op: 'nestRoom', id: '主卧卫生间', into: '主卧' }], base)
    const master = findNodeById(scene.root, '主卧') as RoomNode
    const bath = findNodeById(scene.root, '主卧卫生间') as RoomNode
    const mb = houseLevelsBoundsOf(master)
    const bb = footprintBounds(bath.footprint)
    // 卫生间完全在主卧内部
    expect(bb.minX).toBeGreaterThan(mb.minX)
    expect(bb.maxX).toBeLessThan(mb.maxX)
    expect(bb.minZ).toBeGreaterThan(mb.minZ)
    expect(bb.maxZ).toBeLessThan(mb.maxZ)
    // 不压主卧的门洞（主卧北墙朝走廊全宽开门：门洞线在主卧北墙内侧 1m 深度内）
    const zones = computeDoorZones(topRooms(scene), {
      entrance: scene.root.entranceDir ?? 'south',
      entranceRoomId: scene.root.entranceRoomId,
    }).get('主卧')!
    for (const z of zones.map((zone) => doorZoneRect(master, zone))) {
      const overlapsZone =
        bb.minX < z.maxX - 1e-6 && bb.maxX > z.minX + 1e-6 && bb.minZ < z.maxZ - 1e-6 && bb.maxZ > z.minZ + 1e-6
      expect(overlapsZone).toBe(false)
    }
    // 家具与卫生间占地互不重叠
    for (const f of master.furniture) {
      const fb = {
        minX: f.position.x - f.dimensions.length / 2,
        maxX: f.position.x + f.dimensions.length / 2,
        minZ: f.position.z - f.dimensions.width / 2,
        maxZ: f.position.z + f.dimensions.width / 2,
      }
      const o = fb.minX < bb.maxX - 1e-6 && fb.maxX > bb.minX + 1e-6 && fb.minZ < bb.maxZ - 1e-6 && fb.maxZ > bb.minZ + 1e-6
      expect(o).toBe(false)
    }
  })
})

describe('executeOps - 家具操作', () => {
  const base = run([
    {
      op: 'macro',
      name: 'custom',
      params: {
        rooms: [
          {
            id: 'r',
            name: '客厅',
            dimensions: { length: 4, width: 3, height: 2.8 },
            position: { x: 0, y: 1.4, z: 0 },
          },
        ],
      },
    },
  ])

  it('addFurniture：相对房间中心偏移转为绝对坐标，y 为高度一半', () => {
    const scene = run(
      [
        {
          op: 'addFurniture',
          roomId: 'r',
          id: 'sofa',
          name: '沙发',
          dimensions: { length: 2, width: 0.9, height: 0.8 },
          position: { x: 0.5, y: 0.4, z: -0.3 },
        },
      ],
      base,
    )
    const room = findNodeById(scene.root, 'r') as RoomNode
    const sofa = room.furniture.find((f) => f.id === 'sofa')!
    expect(sofa).toBeDefined()
    expect(sofa.position.x).toBeCloseTo(roomCenter(room).x + 0.5, 5)
    expect(sofa.position.z).toBeCloseTo(roomCenter(room).z - 0.3, 5)
    expect(sofa.position.y).toBeCloseTo(0.4, 5)
  })

  it('addFurniture 缺省 id 时自动生成；id 重复时失败跳过', () => {
    const scene = run([{ op: 'addFurniture', roomId: 'r', name: '茶几' }], base)
    const room = findNodeById(scene.root, 'r') as RoomNode
    expect(room.furniture.length).toBe(1)
    expect(room.furniture[0].id.length).toBeGreaterThan(0)
    // 未占用 id → 成功
    const r2 = executeOps(scene, [{ op: 'addFurniture', roomId: 'r', id: 'sofa', name: '沙发' }])
    expect(r2.skipped).toHaveLength(0)
    expect(findNodeById(r2.scene.root, 'sofa')).not.toBeNull()
    // 占用 id → 该条跳过
    const r3 = executeOps(r2.scene, [{ op: 'addFurniture', roomId: 'r', id: 'sofa', name: '重复' }])
    expect(r3.skipped).toHaveLength(1)
  })

  it('updateFurniture：改名 / 改尺寸 / 相对位置更新', () => {
    const scene = run(
      [
        {
          op: 'addFurniture',
          roomId: 'r',
          id: 'sofa',
          name: '沙发',
          dimensions: { length: 2, width: 0.9, height: 0.8 },
          position: { x: 0.5, y: 0.4, z: -0.3 },
        },
        {
          op: 'updateFurniture',
          roomId: 'r',
          id: 'sofa',
          patch: { name: '大沙发', dimensions: { width: 1.2 }, position: { x: 0, z: 0.5 } },
        },
      ],
      base,
    )
    const room = findNodeById(scene.root, 'r') as RoomNode
    const sofa = room.furniture.find((f) => f.id === 'sofa')!
    expect(sofa.name).toBe('大沙发')
    expect(sofa.dimensions.width).toBe(1.2)
    expect(sofa.dimensions.length).toBe(2) // 未提及字段不变
    expect(sofa.position.x).toBeCloseTo(roomCenter(room).x, 5)
    expect(sofa.position.z).toBeCloseTo(roomCenter(room).z + 0.5, 5)
  })

  it('removeFurniture 删除家具；未命中时失败跳过', () => {
    const withSofa = run([{ op: 'addFurniture', roomId: 'r', id: 'sofa', name: '沙发' }], base)
    const scene = run([{ op: 'removeFurniture', roomId: 'r', id: 'sofa' }], withSofa)
    const room = findNodeById(scene.root, 'r') as RoomNode
    expect(room.furniture).toHaveLength(0)
    const r2 = executeOps(withSofa, [{ op: 'removeFurniture', roomId: 'r', id: 'ghost' }])
    expect(r2.skipped).toHaveLength(1)
  })
})

describe('executeOps - 开洞（setOpenings）', () => {
  it('门/窗默认居中开在指定墙面（矩形房间 edgeIndex 与顶点环顺序一致）', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'r',
              name: '卧室',
              dimensions: { length: 4, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
            },
          ],
        },
      },
      { op: 'setOpenings', roomId: 'r', side: 'east', kind: 'door' },
      { op: 'setOpenings', roomId: 'r', side: 'north', kind: 'window' },
    ])
    const room = findNodeById(scene.root, 'r') as RoomNode
    // 矩形足迹：0=南 1=东 2=北 3=西（坑 39 约定）
    expect(room.doors).toHaveLength(1)
    expect(room.doors[0].edgeIndex).toBe(1) // 东墙
    expect(room.doors[0].width).toBeCloseTo(0.9, 5) // 标准门宽
    expect(room.windows).toHaveLength(1)
    expect(room.windows[0].edgeIndex).toBe(2) // 北墙
    expect(room.windows[0].width).toBeCloseTo(1.5, 5)
    // 渲染覆盖层生效：东墙门段、北墙窗段
    const plan = computeAllWallPlans(topRooms(scene), { entrance: 'south' })
    expect(edgeOf(plan.get('r')!, 'east')!.segments.some((s) => s.kind === 'door')).toBe(true)
    expect(edgeOf(plan.get('r')!, 'north')!.segments.some((s) => s.kind === 'window')).toBe(true)
  })

  it('同边同种开洞替换；from/to 支持自定义区间并钳制', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'r',
              name: '卧室',
              dimensions: { length: 4, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
            },
          ],
        },
      },
      { op: 'setOpenings', roomId: 'r', side: 'east', kind: 'door' },
      { op: 'setOpenings', roomId: 'r', side: 'east', kind: 'door', from: 0.5, to: 1.5 },
    ])
    const room = findNodeById(scene.root, 'r') as RoomNode
    expect(room.doors).toHaveLength(1) // 替换而非叠加
    expect(room.doors[0].from).toBeCloseTo(0.5, 5)
    expect(room.doors[0].to).toBeCloseTo(1.5, 5)
  })

  it('房间不存在 / 无边方向时失败跳过', () => {
    const base = run([
      { op: 'macro', name: 'custom', params: { rooms: [{ id: 'r', name: '卧室' }] } },
    ])
    const r1 = executeOps(base, [
      { op: 'setOpenings', roomId: 'ghost', side: 'north', kind: 'door' },
    ])
    expect(r1.skipped.length).toBe(1)
  })

  it('setOpenings 可作用于嵌套房间', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'bedroom',
              name: '主卧',
              dimensions: { length: 4, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
              nestedRooms: [
                {
                  id: 'bath',
                  name: '主卧卫生间',
                  dimensions: { length: 2, width: 1.8, height: 2.8 },
                  side: 'north',
                },
              ],
            },
          ],
        },
      },
      { op: 'setOpenings', roomId: 'bath', side: 'south', kind: 'door' },
    ])
    const bath = findNodeById(scene.root, 'bath') as RoomNode
    expect(bath.doors).toHaveLength(1)
    expect(bath.doors[0].edgeIndex).toBe(0) // 南墙
  })
})

describe('executeOps - setHouse / 约束兜底 / 楼层高度', () => {
  it('setHouse 改名；空操作失败跳过', () => {
    const scene = run([{ op: 'setHouse', name: '新名字' }])
    expect(scene.root.name).toBe('新名字')
    const r = executeOps(emptyScene(), [{ op: 'setHouse' }])
    expect(r.skipped.length).toBe(1)
  })

  it('setHouse 迁移入户门：entranceRoomId 指向已有房间时入户门跟着移动', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'corridor',
        params: {
          name: '入口房',
          corridor: { width: 1.2, entranceRoomId: 'living' },
          rooms: [
            { id: 'living', name: '客厅', side: 'left', dimensions: { length: 4, width: 3, height: 2.8 } },
            { id: 'kitchen', name: '厨房', side: 'left', dimensions: { length: 4, width: 3, height: 2.8 } },
          ],
        },
      },
      { op: 'setHouse', entranceRoomId: 'kitchen' },
    ])
    expect(scene.root.entranceRoomId).toBe('kitchen')
    // 入户门渲染在厨房南外墙
    const plan = computeWallPlan(topRooms(scene), { entrance: 'south', entranceRoomId: scene.root.entranceRoomId })
    expect(edgeOf(plan.get('kitchen')!, 'south')!.segments.some((s) => s.kind === 'door' && s.entrance)).toBe(true)
    expect(edgeOf(plan.get('living')!, 'south')!.segments.some((s) => s.entrance)).toBe(false)
  })

  it('setHouse entranceRoomId 指向不存在的房间时跳过该条', () => {
    const r = executeOps(emptyScene(), [
      { op: 'macro', name: 'custom', params: { rooms: [{ id: 'a', name: '房A' }] } },
      { op: 'setHouse', entranceRoomId: 'ghost' },
    ])
    expect(r.skipped.length).toBe(1)
    expect(r.scene.root.entranceRoomId).toBeUndefined()
  })

  it('setHouse 改入户门方向：entranceDir 控制入口房间哪面外墙开门', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'corridor',
        params: {
          name: '入口房',
          corridor: { width: 1.2, entranceRoomId: 'living' },
          rooms: [
            { id: 'living', name: '客厅', side: 'left', dimensions: { length: 4, width: 3, height: 2.8 } },
            { id: 'kitchen', name: '厨房', side: 'left', dimensions: { length: 4, width: 3, height: 2.8 } },
          ],
        },
      },
      { op: 'setHouse', entranceRoomId: 'corridor', entranceDir: 'east' },
    ])
    expect(scene.root.entranceRoomId).toBe('corridor')
    expect(scene.root.entranceDir).toBe('east')
    // 走廊东端是外墙：入户门渲染在走廊东墙（不再在南墙）
    const plan = computeWallPlan(topRooms(scene), {
      entrance: scene.root.entranceDir!,
      entranceRoomId: scene.root.entranceRoomId,
    })
    const corridorEdge = edgeOf(plan.get('corridor')!, 'east')
    expect(corridorEdge!.segments.some((s) => s.kind === 'door' && s.entrance)).toBe(true)
    // 客厅南墙不再是入户门（普通房间门语义由共享判定负责）
    const livingEdge = edgeOf(plan.get('living')!, 'south')
    expect(livingEdge!.segments.some((s) => s.entrance)).toBe(false)
  })

  it('setHouse 只改方向不改房间；entranceDir 单独提交有效', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'corridor',
        params: {
          name: '入口房',
          corridor: { width: 1.2, entranceRoomId: 'living' },
          rooms: [
            { id: 'living', name: '客厅', side: 'left', dimensions: { length: 4, width: 3, height: 2.8 } },
          ],
        },
      },
      { op: 'setHouse', entranceDir: 'east' },
    ])
    expect(scene.root.entranceRoomId).toBe('living')
    expect(scene.root.entranceDir).toBe('east')
  })

  it('macro 整体重排保留用户设置的 entranceDir', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'corridor',
        params: {
          name: '入口房',
          corridor: { width: 1.2, entranceRoomId: 'living' },
          rooms: [{ id: 'living', name: '客厅', side: 'left', dimensions: { length: 4, width: 3, height: 2.8 } }],
        },
      },
      { op: 'setHouse', entranceDir: 'west' },
      {
        op: 'macro',
        name: 'corridor',
        params: {
          name: '入口房2',
          corridor: { width: 1.2, entranceRoomId: 'living' },
          rooms: [{ id: 'living', name: '客厅', side: 'left', dimensions: { length: 4, width: 3, height: 2.8 } }],
        },
      },
    ])
    expect(scene.root.entranceDir).toBe('west')
  })

  it('执行后家具被 normalizeContainment 约束进墙内', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'r',
              name: '卧室',
              dimensions: { length: 4, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
            },
          ],
        },
      },
      {
        op: 'addFurniture',
        roomId: 'r',
        name: '床',
        dimensions: { length: 2, width: 1.5, height: 0.5 },
        position: { x: 5, y: 0.25, z: 5 },
      },
    ])
    const room = findNodeById(scene.root, 'r') as RoomNode
    const bed = room.furniture[0]
    // 越墙坐标被拉回墙内（内缩墙厚）
    expect(bed.position.x).toBeGreaterThanOrEqual(houseLevelsBoundsOf(room).minX + 0.15)
    expect(bed.position.x).toBeLessThanOrEqual(houseLevelsBoundsOf(room).maxX - 0.15)
  })

  it('furnitureConventions 选项触发家具常理摆放（贴墙）', () => {
    const result = executeOps(
      emptyScene(),
      [
        {
          op: 'macro',
          name: 'custom',
          params: {
            rooms: [
              {
                id: 'r',
                name: '卧室',
                dimensions: { length: 5, width: 4, height: 2.8 },
                position: { x: 0, y: 1.4, z: 0 },
              },
            ],
          },
        },
        {
          op: 'addFurniture',
          roomId: 'r',
          name: '双人床',
          dimensions: { length: 2, width: 1.5, height: 0.5 },
        },
      ],
      { furnitureConventions: true },
    )
    const room = findNodeById(result.scene.root, 'r') as RoomNode
    const bed = room.furniture[0]
    const b = houseLevelsBoundsOf(room)
    // 床贴某面墙（内壁）
    const flush =
      Math.abs(bed.position.x - (b.minX + 0.15 + bed.dimensions.length / 2)) < 1e-6 ||
      Math.abs(bed.position.x - (b.maxX - 0.15 - bed.dimensions.length / 2)) < 1e-6 ||
      Math.abs(bed.position.z - (b.minZ + 0.15 + bed.dimensions.width / 2)) < 1e-6 ||
      Math.abs(bed.position.z - (b.maxZ - 0.15 - bed.dimensions.width / 2)) < 1e-6
    expect(flush).toBe(true)
  })
})

describe('diffSceneV2 - 快照容错路径', () => {
  function v2Scene(children: SceneModelV2['root']['children'], name = '示例房'): SceneModelV2 {
    return {
      version: 2,
      root: {
        id: 'h1',
        type: 'house',
        name,
        dimensions: { length: 7, width: 4, height: 2.8 },
        position: { x: 0, y: 0, z: 0 },
        layout: { mode: 'custom' },
        children,
      },
    }
  }

  function roomV2(
    id: string,
    name: string,
    length = 3,
    width = 3,
    furniture: { id: string; name: string }[] = [],
  ): SceneModelV2['root']['children'][number] {
    return {
      id,
      type: 'room',
      name,
      dimensions: { length, width, height: 2.8 },
      children: furniture.map((f) => ({
        id: f.id,
        type: 'furniture',
        name: f.name,
        dimensions: { length: 1, width: 0.5, height: 0.5 },
        position: { x: 0, y: 0.25, z: 0 },
      })),
    }
  }

  it('空场景 + 快照 → setHouse + addRoom 序列', () => {
    const ops = diffSceneV2(null, v2Scene([roomV2('a', '房A'), roomV2('b', '房B')]))
    expect(ops.some((o) => o.op === 'setHouse')).toBe(true)
    const adds = ops.filter((o) => o.op === 'addRoom')
    expect(adds.map((o) => o.op === 'addRoom' && o.id)).toEqual(['a', 'b'])
    const scene = executeOps(emptyScene(), ops).scene
    expect(scene.root.name).toBe('示例房')
    expect(topRooms(scene).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('已有场景 diff：改名 / 改尺寸 / 新增 / 删除 / 家具增删改', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          name: '旧名',
          rooms: [
            {
              id: 'a',
              name: '房A',
              dimensions: { length: 3, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
              furniture: [
                {
                  id: 'f1',
                  name: '旧家具',
                  dimensions: { length: 1, width: 0.5, height: 0.5 },
                  position: { x: 0, y: 0.25, z: 0 },
                },
              ],
            },
            {
              id: 'gone',
              name: '将删除',
              dimensions: { length: 3, width: 3, height: 2.8 },
              position: { x: 6, y: 1.4, z: 0 },
            },
          ],
        },
      },
    ])
    const target = v2Scene(
      [
        roomV2('a', '房A改名', 5, 4, [
          { id: 'f1', name: '新家具' },
          { id: 'f2', name: '新加的' },
        ]),
        roomV2('new', '新房间'),
      ],
      '新名字',
    )
    const ops = diffSceneV2(base, target)
    // 改名 + 更新
    expect(ops).toContainEqual({ op: 'setHouse', name: '新名字' })
    expect(ops).toContainEqual({
      op: 'updateRoom',
      id: 'a',
      patch: { name: '房A改名', dimensions: { length: 5, width: 4, height: 2.8 } },
    })
    // 家具：f1 改名（相对位置未变则无 position 补丁）、f2 新增
    expect(ops).toContainEqual({
      op: 'updateFurniture',
      roomId: 'a',
      id: 'f1',
      patch: { name: '新家具' },
    })
    expect(ops.some((o) => o.op === 'addFurniture' && o.id === 'f2')).toBe(true)
    // 删除 gone、新增 new
    expect(ops).toContainEqual({ op: 'removeRoom', id: 'gone' })
    expect(ops.some((o) => o.op === 'addRoom' && o.id === 'new')).toBe(true)

    const scene = executeOps(base, ops).scene
    expect(scene.root.name).toBe('新名字')
    const a = findNodeById(scene.root, 'a') as RoomNode
    expect(a.name).toBe('房A改名')
    expect(a.furniture.map((f) => f.id).sort()).toEqual(['f1', 'f2'])
    expect(findNodeById(scene.root, 'gone')).toBeNull()
    expect(findNodeById(scene.root, 'new')).not.toBeNull()
  })

  it('快照与当前完全一致时产出空操作序列（执行后场景不变）', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          name: '示例房',
          rooms: [
            {
              id: 'a',
              name: '房A',
              dimensions: { length: 3, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
            },
          ],
        },
      },
    ])
    const target = v2Scene([roomV2('a', '房A')])
    const ops = diffSceneV2(base, target)
    expect(ops).toEqual([])
  })
})

describe('executeOps - 端点行为', () => {
  it('嵌套房间也可被 updateRoom / removeRoom / moveRoom 命中', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'bedroom',
              name: '主卧',
              dimensions: { length: 4, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
              nestedRooms: [
                {
                  id: 'bath',
                  name: '主卧卫生间',
                  dimensions: { length: 2, width: 1.8, height: 2.8 },
                  side: 'north',
                },
              ],
            },
          ],
        },
      },
    ])
    const scene = run([{ op: 'updateRoom', id: 'bath', patch: { name: '内卫' } }], base)
    const bath = findNodeById(scene.root, 'bath') as RoomNode
    expect(bath.name).toBe('内卫')
    const removed = run([{ op: 'removeRoom', id: 'bath' }], base)
    expect(findNodeById(removed.root, 'bath')).toBeNull()
  })

  it('空 ops 数组 → 场景原样返回（仅 normalize）', () => {
    const base = run([
      { op: 'macro', name: 'custom', params: { rooms: [{ id: 'a', name: '房A' }] } },
    ])
    const result = executeOps(base, [])
    expect(result.applied).toBe(0)
    expect(result.scene.root.levels[0].rooms.map((r) => r.id)).toEqual(['a'])
  })

  it('findRoom 可命中嵌套房间', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            { id: 'bedroom', name: '主卧', nestedRooms: [{ id: 'bath', name: '主卧卫生间' }] },
          ],
        },
      },
    ])
    expect(findRoom(base, 'bath')?.id).toBe('bath')
    expect(findRoom(base, 'ghost')).toBeNull()
  })
})

function houseLevelsBoundsOf(room: RoomNode): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
} {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of room.footprint) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  return { minX, maxX, minZ, maxZ }
}
