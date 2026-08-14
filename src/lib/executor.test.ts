import { describe, expect, it } from 'vitest'
import {
  footprintBounds,
  footprintCenter,
  houseLevelsBounds,
  roomCenter,
  roomDims,
} from './footprint'
import { doorZoneRect } from './furniturePlacement'
import { diffSceneV2, emptyScene, executeOps, findRoom } from './executor'
import { opSchema } from '../schemas/ops.schema'
import { findNodeById } from './modelTree'
import {
  DOOR_WIDTH,
  edgeOf,
  computeWallPlan,
  computeAllWallPlans,
  computeDoorZones,
} from './roomGeometry'
import type { FurnitureNode, RoomNode, SceneModel, SceneModelV2 } from '../types/model'
import type { Op } from '../types/ops'

function run(ops: Op[], base: SceneModel | null = null): SceneModel {
  return executeOps(base ?? emptyScene(), ops).scene
}

/** 便捷：从场景中取顶层房间数组 */
function topRooms(scene: SceneModel): RoomNode[] {
  return scene.root.levels[0]!.rooms
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

  it('macro custom：房间用 relativeTo 贴靠（复现用户反馈：全塞一块）', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          name: '现代简约独栋小屋',
          rooms: [
            { name: '客厅', dimensions: { length: 6, width: 4, height: 2.8 } },
            {
              name: '主卧',
              dimensions: { length: 4, width: 3.5, height: 2.8 },
              relativeTo: { roomId: '客厅', dir: 'east' },
            },
            {
              name: '次卧',
              dimensions: { length: 3.5, width: 3, height: 2.8 },
              relativeTo: { roomId: '客厅', dir: 'west' },
            },
            {
              name: '厨房',
              dimensions: { length: 3, width: 2.5, height: 2.8 },
              relativeTo: { roomId: '客厅', dir: 'north' },
            },
          ],
        },
      },
    ])
    const rooms = topRooms(scene)
    const byName = (n: string) => rooms.find((r) => r.name === n)!
    // 主卧贴客厅东侧：主卧西边 = 客厅东边（无缝共墙）
    const living = byName('客厅')
    const master = byName('主卧')
    expect(master).toBeDefined()
    expect(footprintBounds(master.footprint).minX).toBeCloseTo(
      footprintBounds(living.footprint).maxX,
      5,
    )
    // 次卧贴客厅西侧
    const bed2 = byName('次卧')
    expect(footprintBounds(bed2.footprint).maxX).toBeCloseTo(
      footprintBounds(living.footprint).minX,
      5,
    )
    // 厨房贴客厅北侧
    const kitchen = byName('厨房')
    expect(footprintBounds(kitchen.footprint).minZ).toBeCloseTo(
      footprintBounds(living.footprint).maxZ,
      5,
    )
    // 四个房间不再重叠（修复前全部落在原点）
    for (const a of rooms) {
      for (const b of rooms) {
        if (a.id === b.id) continue
        const ab = footprintBounds(a.footprint)
        const bb = footprintBounds(b.footprint)
        const overlap =
          ab.minX < bb.maxX - 1e-6 &&
          ab.maxX > bb.minX + 1e-6 &&
          ab.minZ < bb.maxZ - 1e-6 &&
          ab.maxZ > bb.minZ + 1e-6
        expect(overlap).toBe(false)
      }
    }
  })

  it('macro custom：房间无 id 时，setOpenings/setHouse 可按名称引用（复现用户反馈）', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          name: '书房工作室',
          rooms: [{ name: '书房工作室', dimensions: { length: 5, width: 4, height: 2.8 } }],
        },
      },
      {
        op: 'setOpenings',
        roomId: '书房工作室',
        side: 'south',
        kind: 'window',
        from: 0.5,
        to: 4.5,
      },
      { op: 'setHouse', entranceRoomId: '书房工作室', entranceDir: 'south' },
    ])
    // setOpenings 按名称命中：南墙出现窗段
    const room = findRoom(scene, '书房工作室')!
    expect(room.windows.length).toBe(1)
    const plan = computeWallPlan(topRooms(scene), { entrance: 'south', entranceRoomId: room.id })
    const south = edgeOf(plan.get(room.id)!, 'south')!
    // 大窗保持完整一段（未被门劈开）
    const southWindows = south.segments.filter((s) => s.kind === 'window')
    expect(southWindows).toHaveLength(1)
    expect(southWindows[0]!.from).toBeCloseTo(0.5)
    expect(southWindows[0]!.to).toBeCloseTo(4.5)
    // setHouse 按名称命中：入口房间落位 + 入户门恒为 0.9m（南墙放不下时改到东墙）
    expect(scene.root.entranceRoomId).toBe(room.id)
    const entranceSeg = plan
      .get(room.id)!
      .edges.flatMap((e) => e.segments)
      .find((s) => s.entrance)!
    expect(entranceSeg).toBeDefined()
    expect(entranceSeg.to - entranceSeg.from).toBeCloseTo(DOOR_WIDTH)
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
    expect(scene.root.levels[0]!.rooms).toEqual([])
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

  it('addRoom position 指定绝对位置（房间中心，优先级高于 relativeTo）', () => {
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
    // position 与 relativeTo 同时给出时 position 生效（更显式，与 macro custom 语义一致）
    const scene = run(
      [
        {
          op: 'addRoom',
          id: 'p',
          name: '定位房',
          dimensions: { length: 2, width: 2, height: 2.8 },
          position: { x: 6, y: 1.4, z: 2 },
          relativeTo: { roomId: 'a', dir: 'east' },
        },
      ],
      base,
    )
    const p = findNodeById(scene.root, 'p') as RoomNode
    expect(roomCenter(p).x).toBeCloseTo(6, 5)
    expect(roomCenter(p).z).toBeCloseTo(2, 5)
  })

  it('addRoom 显式 footprint 优先于 position（以顶点环为准）', () => {
    const base = run([
      { op: 'macro', name: 'custom', params: { rooms: [{ id: 'a', name: '房A' }] } },
    ])
    const scene = run(
      [
        {
          op: 'addRoom',
          id: 'f',
          name: '足迹房',
          position: { x: 99, y: 1.4, z: 99 },
          footprint: [
            { x: 1, z: 1 },
            { x: 3, z: 1 },
            { x: 3, z: 3 },
            { x: 1, z: 3 },
          ],
        },
      ],
      base,
    )
    const f = findNodeById(scene.root, 'f') as RoomNode
    const b = footprintBounds(f.footprint)
    expect(b.minX).toBeCloseTo(1, 5)
    expect(b.minZ).toBeCloseTo(1, 5)
    expect(b.maxX).toBeCloseTo(3, 5)
    expect(b.maxZ).toBeCloseTo(3, 5)
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
    expect(scene.root.levels[0]!.height).toBe(3)
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
            {
              id: 'living',
              name: '客厅',
              side: 'left',
              dimensions: { length: 5, width: 4, height: 2.8 },
            },
            {
              id: 'master',
              name: '主卧',
              side: 'right',
              dimensions: { length: 4, width: 3.5, height: 2.8 },
            },
            {
              id: 'bed2',
              name: '次卧',
              side: 'right',
              dimensions: { length: 3.5, width: 3, height: 2.8 },
            },
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
            {
              id: 'living',
              name: '客厅',
              side: 'left',
              dimensions: { length: 5, width: 4, height: 2.8 },
            },
            {
              id: 'master',
              name: '主卧',
              side: 'right',
              dimensions: { length: 4, width: 3.5, height: 2.8 },
            },
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
              furniture: [
                { id: 'bed', name: '双人床', dimensions: { length: 2, width: 1.5, height: 0.5 } },
              ],
            },
            {
              id: 'bath',
              name: '主卧卫生间',
              dimensions: { length: 2, width: 1.8, height: 2.8 },
              position: { x: 5, y: 1.4, z: 0 },
              furniture: [
                {
                  id: 'toilet',
                  name: '马桶',
                  dimensions: { length: 0.6, width: 0.4, height: 0.7 },
                  position: { x: 0.55, y: 0.35, z: 0.5 },
                },
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
    // 家具随房间整体平移（相对位置不变；初始放在卫生间东北角以避开门口通道）
    const toilet = findNodeById(scene.root, 'toilet') as FurnitureNode
    const bathC = footprintCenter(bath.footprint)
    expect(toilet.position.x - bathC.x).toBeCloseTo(0.55, 5)
    expect(toilet.position.z - bathC.z).toBeCloseTo(0.5, 5)
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
        bb.minX < z.maxX - 1e-6 &&
        bb.maxX > z.minX + 1e-6 &&
        bb.minZ < z.maxZ - 1e-6 &&
        bb.maxZ > z.minZ + 1e-6
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
            {
              id: 'a',
              name: '房A',
              dimensions: { length: 4, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
            },
            {
              id: 'b',
              name: '房B',
              dimensions: { length: 2, width: 2, height: 2.8 },
              position: { x: 6, y: 1.4, z: 0 },
            },
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
            {
              id: 'living',
              name: '客厅',
              side: 'left',
              dimensions: { length: 5, width: 4, height: 2.8 },
            },
            {
              id: 'master',
              name: '主卧',
              side: 'right',
              dimensions: { length: 4, width: 3.5, height: 2.8 },
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
      const o =
        bb.minX < rb.maxX - 1e-6 &&
        bb.maxX > rb.minX + 1e-6 &&
        bb.minZ < rb.maxZ - 1e-6 &&
        bb.maxZ > rb.minZ + 1e-6
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
            {
              id: 'living',
              name: '客厅',
              side: 'left',
              dimensions: { length: 5, width: 4, height: 2.8 },
            },
            {
              id: 'master',
              name: '主卧',
              side: 'right',
              dimensions: { length: 4, width: 3.5, height: 2.8 },
            },
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
      const o =
        nb.minX < rb.maxX - 1e-6 &&
        nb.maxX > rb.minX + 1e-6 &&
        nb.minZ < rb.maxZ - 1e-6 &&
        nb.maxZ > rb.minZ + 1e-6
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
              nestedRooms: [
                {
                  id: 'bath',
                  name: '主卧卫生间',
                  dimensions: { length: 2, width: 1.8, height: 2.8 },
                },
              ],
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
            {
              id: '客厅',
              name: '客厅',
              side: 'left',
              dimensions: { length: 5, width: 4, height: 2.8 },
            },
            {
              id: '主卧',
              name: '主卧',
              side: 'left',
              dimensions: { length: 4, width: 3.5, height: 2.8 },
              furniture: [
                {
                  id: 'bed',
                  name: '双人床',
                  dimensions: { length: 2, width: 1.5, height: 0.5 },
                  position: { x: 0, y: 0.25, z: -0.8 },
                },
                {
                  id: 'stand',
                  name: '床头柜',
                  dimensions: { length: 0.5, width: 0.4, height: 0.5 },
                  position: { x: 1.2, y: 0.25, z: -0.8 },
                },
              ],
            },
            {
              id: '主卧卫生间',
              name: '主卧卫生间',
              side: 'left',
              dimensions: { length: 2, width: 1.8, height: 2.8 },
            },
            {
              id: '次卧',
              name: '次卧',
              side: 'right',
              dimensions: { length: 3.5, width: 3, height: 2.8 },
            },
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
        bb.minX < z.maxX - 1e-6 &&
        bb.maxX > z.minX + 1e-6 &&
        bb.minZ < z.maxZ - 1e-6 &&
        bb.maxZ > z.minZ + 1e-6
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
      const o =
        fb.minX < bb.maxX - 1e-6 &&
        fb.maxX > bb.minX + 1e-6 &&
        fb.minZ < bb.maxZ - 1e-6 &&
        fb.maxZ > bb.minZ + 1e-6
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
          // z 选 0.8 避开南墙入户门通道（门区会把它推出原位，见 normalizeContainment 门区避让）
          position: { x: 0.5, y: 0.4, z: 0.8 },
        },
      ],
      base,
    )
    const room = findNodeById(scene.root, 'r') as RoomNode
    const sofa = room.furniture.find((f) => f.id === 'sofa')!
    expect(sofa).toBeDefined()
    expect(sofa.position.x).toBeCloseTo(roomCenter(room).x + 0.5, 5)
    expect(sofa.position.z).toBeCloseTo(roomCenter(room).z + 0.8, 5)
    expect(sofa.position.y).toBeCloseTo(0.4, 5)
  })

  it('addFurniture 缺省 id 时自动生成；id 重复时失败跳过', () => {
    const scene = run([{ op: 'addFurniture', roomId: 'r', name: '茶几' }], base)
    const room = findNodeById(scene.root, 'r') as RoomNode
    expect(room.furniture.length).toBe(1)
    expect(room.furniture[0]!.id.length).toBeGreaterThan(0)
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
    expect(room.doors[0]!.edgeIndex).toBe(1) // 东墙
    expect(room.doors[0]!.width).toBeCloseTo(0.9, 5) // 标准门宽
    expect(room.windows).toHaveLength(1)
    expect(room.windows[0]!.edgeIndex).toBe(2) // 北墙
    expect(room.windows[0]!.width).toBeCloseTo(1.5, 5)
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
    expect(room.doors[0]!.from).toBeCloseTo(0.5, 5)
    expect(room.doors[0]!.to).toBeCloseTo(1.5, 5)
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
    expect(bath.doors[0]!.edgeIndex).toBe(0) // 南墙
  })

  it('P4 edgeIndex 精确指定边；非矩形同方向多边也能命中指定边', () => {
    // L 形足迹（西侧 3×3 + 东侧 1.5×1.5 缺口），南向两条边：边 0（西段）与边 2（东段）
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'r',
              name: '卧室',
              footprint: [
                { x: -1.5, z: -1.5 },
                { x: 0, z: -1.5 },
                { x: 0, z: 0 },
                { x: 1.5, z: 0 },
                { x: 1.5, z: 1.5 },
                { x: -1.5, z: 1.5 },
              ],
            },
          ],
        },
      },
    ])
    const scene = executeOps(base, [
      { op: 'setOpenings', roomId: 'r', side: 'south', kind: 'door', edgeIndex: 2 },
    ]).scene
    const room = findNodeById(scene.root, 'r') as RoomNode
    expect(room.doors).toHaveLength(1)
    expect(room.doors[0]!.edgeIndex).toBe(2) // 精确命中东段南墙而非最长的西段南墙
  })

  it('setOpenings 可只给 edgeIndex 不给 side（契约可选化后 schema 放行、执行器正常）', () => {
    const base = run([
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
    ])
    // zod 校验层：edgeIndex-only 合法（此前 schema 强索 side，UI 只能 as Op 绕过）
    expect(
      opSchema.safeParse({ op: 'setOpenings', roomId: 'r', kind: 'door', edgeIndex: 1 }).success,
    ).toBe(true)
    const scene = executeOps(base, [
      { op: 'setOpenings', roomId: 'r', kind: 'door', edgeIndex: 1 },
    ]).scene
    const room = findNodeById(scene.root, 'r') as RoomNode
    expect(room.doors).toHaveLength(1)
    expect(room.doors[0]!.edgeIndex).toBe(1) // 东墙
    // 删除路径同样支持 edgeIndex-only
    const s1 = executeOps(scene, [
      { op: 'setOpenings', roomId: 'r', kind: 'door', edgeIndex: 1, remove: true },
    ]).scene
    expect((findNodeById(s1.root, 'r') as RoomNode).doors).toHaveLength(0)
  })

  it('setOpenings side 与 edgeIndex 均缺省时该条失败跳过（跨字段兜底在执行器）', () => {
    const base = run([
      { op: 'macro', name: 'custom', params: { rooms: [{ id: 'r', name: '卧室' }] } },
    ])
    const result = executeOps(base, [{ op: 'setOpenings', roomId: 'r', kind: 'door' as const }])
    expect(result.applied).toBe(0)
    expect(result.skipped.length).toBe(1)
    expect(result.skipped[0]).toContain('side 或 edgeIndex')
  })

  it('P4 remove: true 删除同边同种开洞（可只删重叠区间）', () => {
    const base = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'r',
              name: '卧室',
              dimensions: { length: 5, width: 3, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
            },
          ],
        },
      },
      { op: 'setOpenings', roomId: 'r', side: 'south', kind: 'window', from: 3.0, to: 4.5 },
      { op: 'setOpenings', roomId: 'r', side: 'east', kind: 'door' },
    ])
    // 区间不重叠 → 不动
    const s0 = executeOps(base, [
      {
        op: 'setOpenings',
        roomId: 'r',
        side: 'south',
        kind: 'window',
        from: 0.0,
        to: 0.5,
        remove: true,
      },
    ]).scene
    expect((findNodeById(s0.root, 'r') as RoomNode).windows).toHaveLength(1)
    // 区间重叠 → 只删命中者
    const s1 = executeOps(base, [
      {
        op: 'setOpenings',
        roomId: 'r',
        side: 'south',
        kind: 'window',
        from: 3.0,
        to: 4.5,
        remove: true,
      },
    ]).scene
    const r1 = findNodeById(s1.root, 'r') as RoomNode
    expect(r1.windows).toHaveLength(0)
    expect(r1.doors).toHaveLength(1) // 其他边/其他种类不受影响
    // 无 from/to → 整边清除
    const s2 = executeOps(base, [
      { op: 'setOpenings', roomId: 'r', side: 'south', kind: 'window', remove: true },
    ]).scene
    const r2 = findNodeById(s2.root, 'r') as RoomNode
    expect(r2.windows).toHaveLength(0)
    expect(r2.doors).toHaveLength(1)
  })
})

describe('executeOps - 拆房/合并（P4 splitRoom / mergeRoom）', () => {
  /** 构造一个 4×3 矩形房间（含家具/嵌套/开洞）的场景 */
  function baseRoomScene(): SceneModel {
    return run([
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
              furniture: [
                {
                  id: 'sofa',
                  name: '沙发',
                  dimensions: { length: 2, width: 0.9, height: 0.9 },
                  position: { x: -1, y: 0.45, z: 0 },
                },
              ],
              nestedRooms: [
                {
                  id: 'bath',
                  name: '主卧卫生间',
                  dimensions: { length: 1.5, width: 1.5, height: 2.8 },
                  side: 'east',
                },
              ],
            },
          ],
        },
      },
      { op: 'setOpenings', roomId: 'r', side: 'south', kind: 'window', from: 0.5, to: 2.0 },
      { op: 'setOpenings', roomId: 'r', side: 'east', kind: 'door' },
    ])
  }

  it('splitRoom 竖切：原房间保留西半部分与 id，新房间在东侧，家具/嵌套按中心归属', () => {
    const scene = executeOps(baseRoomScene(), [
      { op: 'splitRoom', id: 'r', axis: 'x', position: 0.0 },
    ]).scene
    const rooms = topRooms(scene)
    expect(rooms).toHaveLength(2)
    const a = rooms.find((x) => x.id === 'r')!
    const b = rooms.find((x) => x.id !== 'r')!
    // a = 西侧 2×3，b = 东侧 2×3，无缝贴合
    const ab = footprintBounds(a.footprint)
    const bb = footprintBounds(b.footprint)
    expect(ab.maxX - ab.minX).toBeCloseTo(2, 5)
    expect(bb.maxX - bb.minX).toBeCloseTo(2, 5)
    expect(bb.minX).toBeCloseTo(ab.maxX, 5)
    expect(b.name).toBe('客厅2')
    // 家具按中心归属：沙发中心 x=-1 在 a 侧
    expect(a.furniture.map((f) => f.id)).toEqual(['sofa'])
    expect(b.furniture).toHaveLength(0)
    // 嵌套房间（卫生间在东侧，中心 x≈1.05）归 b
    expect(b.nestedRooms.map((n) => n.id)).toEqual(['bath'])
    expect(a.nestedRooms).toHaveLength(0)
  })

  it('splitRoom 开洞重映射：南墙窗（跨切线）丢弃、东墙门保留在新房间、共墙自动开一扇门', () => {
    const scene = executeOps(baseRoomScene(), [
      { op: 'splitRoom', id: 'r', axis: 'x', position: 0.0 },
    ]).scene
    const a = topRooms(scene).find((x) => x.id === 'r')!
    const b = topRooms(scene).find((x) => x.id !== 'r')!
    // 原南墙窗 0.5-2.0（world x ∈ [-1.5, 0]）恰好止于切线：留在 a
    expect(a.windows).toHaveLength(1)
    expect(b.windows).toHaveLength(0)
    // 原东墙门保留在 b（东墙 x=2 归 b）
    expect(b.doors.some((d) => d.edgeIndex === 1)).toBe(true)
    // 共墙自动开一扇门（渲染侧：客厅 id 'r' vs 客厅2 → 按 id 最小者渲染，门开在 a 的东墙或 b 的西墙）
    const sharedDoor = [...a.doors, ...b.doors].find((d) => d.edgeIndex === 1 || d.edgeIndex === 3)!
    expect(sharedDoor.width).toBeCloseTo(0.9, 5)
    // 渲染覆盖层生效：共墙上有门段
    const plan = computeAllWallPlans(topRooms(scene), { entrance: 'south' })
    const hasSharedDoor = [plan.get(a.id)!, plan.get(b.id)!].some((p) =>
      p.edges.some((e) => e.segments.some((s) => s.kind === 'door')),
    )
    expect(hasSharedDoor).toBe(true)
  })

  it('splitRoom 横切与自定义新房间名；非矩形/切线太靠边失败跳过', () => {
    const scene = executeOps(baseRoomScene(), [
      { op: 'splitRoom', id: 'r', axis: 'z', position: 0.0, name: '南厅' },
    ]).scene
    const rooms = topRooms(scene)
    expect(rooms).toHaveLength(2)
    const a = rooms.find((x) => x.id === 'r')!
    const b = rooms.find((x) => x.id !== 'r')!
    expect(b.name).toBe('南厅')
    // a = 南半 3×1.5，b = 北半 3×1.5
    expect(footprintBounds(a.footprint).maxZ - footprintBounds(a.footprint).minZ).toBeCloseTo(
      1.5,
      5,
    )
    expect(footprintBounds(b.footprint).maxZ - footprintBounds(b.footprint).minZ).toBeCloseTo(
      1.5,
      5,
    )
    expect(footprintBounds(a.footprint).maxZ).toBeCloseTo(footprintBounds(b.footprint).minZ, 5)
    // 切线太靠边（距西墙 0.1 < 1m）→ 跳过
    const bad = executeOps(baseRoomScene(), [
      { op: 'splitRoom', id: 'r', axis: 'x', position: -1.9 },
    ])
    expect(bad.skipped.length).toBe(1)
    expect(topRooms(bad.scene)).toHaveLength(1)
    // 非矩形房间 → 跳过
    const lShape = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'r',
              name: '卧室',
              footprint: [
                { x: 0, z: 0 },
                { x: 3, z: 0 },
                { x: 3, z: 3 },
                { x: 1.5, z: 3 },
                { x: 1.5, z: 1.5 },
                { x: 0, z: 1.5 },
              ],
            },
          ],
        },
      },
    ])
    const bad2 = executeOps(lShape, [{ op: 'splitRoom', id: 'r', axis: 'x', position: 1.5 }])
    expect(bad2.skipped.length).toBe(1)
  })

  it('mergeRoom 水平合并：并集为矩形，家具/嵌套并入，共墙开洞丢弃', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'a',
              name: '客厅',
              dimensions: { length: 3, width: 3, height: 2.8 },
              position: { x: -1.5, y: 1.4, z: 0 },
              furniture: [
                {
                  id: 'sofa',
                  name: '沙发',
                  dimensions: { length: 2, width: 0.9, height: 0.9 },
                  position: { x: -0.5, y: 0.45, z: 0 },
                },
              ],
            },
            {
              id: 'b',
              name: '餐厅',
              dimensions: { length: 3, width: 3, height: 2.8 },
              position: { x: 1.5, y: 1.4, z: 0 },
              furniture: [
                {
                  id: 'table',
                  name: '餐桌',
                  dimensions: { length: 1.2, width: 0.8, height: 0.75 },
                  position: { x: 0.5, y: 0.375, z: 0 },
                },
              ],
            },
          ],
        },
      },
      { op: 'setOpenings', roomId: 'a', side: 'east', kind: 'door' }, // 共墙上的门 → 合并后丢弃
      { op: 'setOpenings', roomId: 'a', side: 'south', kind: 'window', from: 0.5, to: 1.5 },
      { op: 'setOpenings', roomId: 'b', side: 'east', kind: 'door' },
    ])
    const merged = executeOps(scene, [{ op: 'mergeRoom', keep: 'a', remove: 'b' }]).scene
    expect(topRooms(merged)).toHaveLength(1)
    const room = topRooms(merged)[0]!
    expect(room.id).toBe('a')
    expect(room.name).toBe('客厅')
    const rb = footprintBounds(room.footprint)
    expect(rb.maxX - rb.minX).toBeCloseTo(6, 5)
    // 家具并入（绝对坐标不变）
    expect(room.furniture.map((f) => f.id).sort()).toEqual(['sofa', 'table'])
    // 共墙（a 的东墙）门丢弃；b 的东墙门保留并映射到合并后的东墙
    expect(room.doors).toHaveLength(1)
    expect(room.doors[0]!.edgeIndex).toBe(1)
    // a 的南墙窗局部区间不变（a 在最西侧，起点不变）
    expect(room.windows).toHaveLength(1)
    expect(room.windows[0]!.from).toBeCloseTo(0.5, 5)
    expect(room.windows[0]!.to).toBeCloseTo(1.5, 5)
  })

  it('mergeRoom 垂直合并 + remove 是入口房间时入口迁移；并集非矩形/房间缺失失败跳过', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'a',
              name: '主卧',
              dimensions: { length: 3, width: 2, height: 2.8 },
              position: { x: 0, y: 1.4, z: 1 },
            },
            {
              id: 'b',
              name: '主卧卫生间',
              dimensions: { length: 3, width: 2, height: 2.8 },
              position: { x: 0, y: 1.4, z: -1 },
            },
          ],
        },
      },
    ])
    // 手工把 b 设为入口房间
    const withEntrance = executeOps(scene, [
      { op: 'setHouse', entranceRoomId: 'b', entranceDir: 'south' },
    ]).scene
    const merged = executeOps(withEntrance, [{ op: 'mergeRoom', keep: 'a', remove: 'b' }]).scene
    expect(topRooms(merged)).toHaveLength(1)
    expect(merged.root.entranceRoomId).toBe('a') // 入口迁移到 keep
    // 并集非矩形（错位）→ 跳过
    const lShape = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'a',
              name: '卧室',
              footprint: [
                { x: 0, z: 0 },
                { x: 3, z: 0 },
                { x: 3, z: 3 },
                { x: 1.5, z: 3 },
                { x: 1.5, z: 1.5 },
                { x: 0, z: 1.5 },
              ],
            },
            {
              id: 'b',
              name: '书房',
              dimensions: { length: 2, width: 2, height: 2.8 },
              position: { x: 3.5, y: 1.4, z: 0.5 },
            },
          ],
        },
      },
    ])
    const bad = executeOps(lShape, [{ op: 'mergeRoom', keep: 'a', remove: 'b' }])
    expect(bad.skipped.length).toBe(1)
    // 房间缺失 → 跳过
    const ghost = executeOps(scene, [{ op: 'mergeRoom', keep: 'a', remove: 'ghost' }])
    expect(ghost.skipped.length).toBe(1)
  })

  it('mergeRoom keep 嵌套在 remove 内（并集非矩形）失败跳过且不丢房间；splitRoom 作用于嵌套房间', () => {
    const scene = run([
      {
        op: 'macro',
        name: 'custom',
        params: {
          rooms: [
            {
              id: 'bedroom',
              name: '主卧',
              dimensions: { length: 6, width: 4, height: 2.8 },
              position: { x: 0, y: 1.4, z: 0 },
              nestedRooms: [
                {
                  id: 'bath',
                  name: '主卧卫生间',
                  dimensions: { length: 2.8, width: 2.4, height: 2.8 },
                  side: 'east',
                },
              ],
            },
          ],
        },
      },
    ])
    // keep=bath 嵌套在 remove=bedroom 内：并集非矩形 → 跳过，且不能丢房间（交换角色保护）
    const merged = executeOps(scene, [{ op: 'mergeRoom', keep: 'bath', remove: 'bedroom' }])
    expect(merged.skipped.length).toBe(1)
    expect(topRooms(merged.scene)).toHaveLength(1)
    expect((findNodeById(merged.scene.root, 'bedroom') as RoomNode).nestedRooms).toHaveLength(1)
    // 拆分嵌套房间：卫生间竖切（其中心 x≈1.45）
    const bath = findNodeById(scene.root, 'bath') as RoomNode
    const bc = footprintCenter(bath.footprint)
    const split = executeOps(scene, [
      { op: 'splitRoom', id: 'bath', axis: 'x', position: bc.x },
    ]).scene
    const bedroom = findNodeById(split.root, 'bedroom') as RoomNode
    expect(bedroom.nestedRooms).toHaveLength(2)
    expect(bedroom.nestedRooms.some((n) => n.id === 'bath')).toBe(true)
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
            {
              id: 'living',
              name: '客厅',
              side: 'left',
              dimensions: { length: 4, width: 3, height: 2.8 },
            },
            {
              id: 'kitchen',
              name: '厨房',
              side: 'left',
              dimensions: { length: 4, width: 3, height: 2.8 },
            },
          ],
        },
      },
      { op: 'setHouse', entranceRoomId: 'kitchen' },
    ])
    expect(scene.root.entranceRoomId).toBe('kitchen')
    // 入户门渲染在厨房南外墙
    const plan = computeWallPlan(topRooms(scene), {
      entrance: 'south',
      entranceRoomId: scene.root.entranceRoomId,
    })
    expect(
      edgeOf(plan.get('kitchen')!, 'south')!.segments.some((s) => s.kind === 'door' && s.entrance),
    ).toBe(true)
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
            {
              id: 'living',
              name: '客厅',
              side: 'left',
              dimensions: { length: 4, width: 3, height: 2.8 },
            },
            {
              id: 'kitchen',
              name: '厨房',
              side: 'left',
              dimensions: { length: 4, width: 3, height: 2.8 },
            },
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
            {
              id: 'living',
              name: '客厅',
              side: 'left',
              dimensions: { length: 4, width: 3, height: 2.8 },
            },
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
          rooms: [
            {
              id: 'living',
              name: '客厅',
              side: 'left',
              dimensions: { length: 4, width: 3, height: 2.8 },
            },
          ],
        },
      },
      { op: 'setHouse', entranceDir: 'west' },
      {
        op: 'macro',
        name: 'corridor',
        params: {
          name: '入口房2',
          corridor: { width: 1.2, entranceRoomId: 'living' },
          rooms: [
            {
              id: 'living',
              name: '客厅',
              side: 'left',
              dimensions: { length: 4, width: 3, height: 2.8 },
            },
          ],
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
    const bed = room.furniture[0]!
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
    const bed = room.furniture[0]!
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
    furniture: { id: string; name: string; position?: { x: number; y: number; z: number } }[] = [],
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
        position: f.position ?? { x: 0, y: 0.25, z: 0 },
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
                  // 初始放 z=0.8 避开门口通道（normalizeContainment 会推出堵门家具，位置变化会引入 position 补丁）
                  position: { x: 0, y: 0.25, z: 0.8 },
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
          { id: 'f1', name: '新家具', position: { x: 0, y: 0.25, z: 0.8 } },
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

  it('快照新增房间时 addRoom 透传 position（修复按 position 布局的 custom 快照全部落到东侧）', () => {
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
    // v2 快照中新房间带显式 position（custom 布局）
    const target = v2Scene([
      roomV2('a', '房A'),
      {
        id: 'b',
        type: 'room',
        name: '房B',
        dimensions: { length: 2, width: 2, height: 2.8 },
        position: { x: 5, y: 1.4, z: 3 },
        children: [
          {
            id: 'bf',
            type: 'furniture',
            name: '柜子',
            dimensions: { length: 1, width: 0.5, height: 1 },
            position: { x: 0.4, y: 0.5, z: 0 },
            rotationY: 90,
            description: '高柜',
          },
        ],
      },
    ])
    const ops = diffSceneV2(base, target)
    const add = ops.find((o) => o.op === 'addRoom' && o.id === 'b')
    expect(add && add.op === 'addRoom' && add.position).toEqual({ x: 5, y: 1.4, z: 3 })
    // 家具规格全字段透传（此前 rotationY/description 在快照路径静默丢失）
    expect(add && add.op === 'addRoom' && add.furniture).toEqual([
      expect.objectContaining({ id: 'bf', rotationY: 90, description: '高柜' }),
    ])
    const scene = executeOps(base, ops).scene
    const b = findNodeById(scene.root, 'b') as RoomNode
    expect(roomCenter(b).x).toBeCloseTo(5, 5)
    expect(roomCenter(b).z).toBeCloseTo(3, 5)
    expect((b.furniture[0] as FurnitureNode).rotationY).toBe(90)
  })

  it('快照新增房间透传 relativeTo（贴靠定位不被丢成原点/东侧兜底）；已有家具 rotationY 变化产出补丁', () => {
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
              furniture: [
                {
                  id: 'f1',
                  name: '柜子',
                  dimensions: { length: 1, width: 0.5, height: 1 },
                  position: { x: 0, y: 0.5, z: 0.8 },
                  rotationY: 0,
                },
              ],
            },
          ],
        },
      },
    ])
    const target = v2Scene([
      {
        id: 'a',
        type: 'room',
        name: '房A',
        dimensions: { length: 3, width: 3, height: 2.8 },
        children: [
          {
            id: 'f1',
            type: 'furniture',
            name: '柜子',
            dimensions: { length: 1, width: 0.5, height: 1 },
            position: { x: 0, y: 0.5, z: 0.8 },
            rotationY: 90,
          },
        ],
      },
      {
        id: 'b',
        type: 'room',
        name: '房B',
        dimensions: { length: 2, width: 2, height: 2.8 },
        relativeTo: { roomId: 'a', dir: 'east' },
        children: [],
      },
    ])
    const ops = diffSceneV2(base, target)
    const add = ops.find((o) => o.op === 'addRoom' && o.id === 'b')
    expect(add && add.op === 'addRoom' && add.relativeTo).toEqual({ roomId: 'a', dir: 'east' })
    // 已存在家具的旋转修改必须进入补丁（此前快照路径静默丢弃 rotationY）
    expect(ops).toContainEqual({
      op: 'updateFurniture',
      roomId: 'a',
      id: 'f1',
      patch: { rotationY: 90 },
    })
    const scene = executeOps(base, ops).scene
    const a = findNodeById(scene.root, 'a') as RoomNode
    const b2 = findNodeById(scene.root, 'b') as RoomNode
    // b 贴靠在 a 东侧（无缝共墙），而不是落到原点/东侧兜底
    expect(roomCenter(b2).x).toBeCloseTo(roomCenter(a).x + 2.5, 5)
    expect((findNodeById(scene.root, 'f1') as FurnitureNode).rotationY).toBe(90)
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
    expect(result.scene.root.levels[0]!.rooms.map((r) => r.id)).toEqual(['a'])
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

  it('executeOps 对 null / 非对象条目逐条容错（不在 catch 内二次解引用崩溃）', () => {
    const base = run([
      { op: 'macro', name: 'custom', params: { rooms: [{ id: 'a', name: '房A' }] } },
    ])
    // 外部输入（分享口令/迁移脏数据）可能混入 null 与未知 op：整批不应崩溃，坏条目被跳过
    const result = executeOps(base, [
      null as unknown as Op,
      { op: 'unknownOp', id: 'a' } as unknown as Op,
      { op: 'setHouse', name: '新名' },
    ] as Op[])
    expect(result.applied).toBe(1)
    expect(result.skipped).toHaveLength(2)
    expect(result.scene.root.name).toBe('新名')
    expect(findNodeById(result.scene.root, 'a')).not.toBeNull()
  })
})

describe('executeOps - 按名称引用（坑 71：findRoom 名称回退与 id-only 变更函数统一）', () => {
  /** custom 基础场景：房A(4×3) 居中、房B(3×3) 在东侧 */
  function baseScene(): SceneModel {
    return run([
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
  }

  it('updateRoom 按名称引用：改名/改尺寸真正生效（原实现静默零变更）', () => {
    const scene = run([{ op: 'updateRoom', id: '房A', patch: { name: '大客厅' } }], baseScene())
    const a = findNodeById(scene.root, 'a') as RoomNode
    expect(a.name).toBe('大客厅')
    const sized = run(
      [{ op: 'updateRoom', id: '大客厅', patch: { dimensions: { length: 5, width: 5 } } }],
      scene,
    )
    const a2 = findNodeById(sized.root, 'a') as RoomNode
    expect(roomDims(a2).length).toBeCloseTo(5, 5)
    expect(roomDims(a2).width).toBeCloseTo(5, 5)
  })

  it('removeRoom 按名称引用：房间真正被删除，入口房间清空 entranceRoomId', () => {
    const scene = run([{ op: 'removeRoom', id: '房A' }], baseScene())
    expect(findNodeById(scene.root, 'a')).toBeNull()
    expect(findNodeById(scene.root, 'b')).not.toBeNull()
    const withEntrance = run([{ op: 'setHouse', name: 'x', entranceRoomId: 'a' }], baseScene())
    const removed = run([{ op: 'removeRoom', id: '房A' }], withEntrance)
    expect(findNodeById(removed.root, 'a')).toBeNull()
    expect(removed.root.entranceRoomId).toBeUndefined()
  })

  it('moveRoom 按名称引用：真正移动到目标房间一侧（原实现名称引用不移动）', () => {
    const scene = run(
      [{ op: 'moveRoom', id: '房B', relativeTo: { roomId: '房A', dir: 'south' } }],
      baseScene(),
    )
    const a = findNodeById(scene.root, 'a') as RoomNode
    const b = findNodeById(scene.root, 'b') as RoomNode
    expect(b.footprint.some((p) => p.z < a.footprint[0]!.z - 1)).toBe(true)
  })

  it('moveRoom 名称引用指向自身时失败跳过（相对引用与 id 引用等价）', () => {
    const result = executeOps(baseScene(), [
      { op: 'moveRoom', id: '房A', relativeTo: { roomId: '房A', dir: 'north' } },
    ])
    expect(result.skipped.length).toBe(1)
  })

  it('splitRoom 按名称引用：拆分真正生效（新房间名 = 原名2）', () => {
    const scene = run([{ op: 'splitRoom', id: '房A', axis: 'x', position: 0 }], baseScene())
    const a = findNodeById(scene.root, 'a') as RoomNode
    expect(a).not.toBeNull()
    const newRoom = topRooms(scene).find((r) => r.name === '房A2') as RoomNode
    expect(newRoom).not.toBeNull()
    // 房B 未被波及
    expect(findNodeById(scene.root, 'b')?.name).toBe('房B')
  })

  it('mergeRoom 按名称引用：合并真正生效（keep/remove 均按名称）', () => {
    // 相邻房间：房B 紧贴房A 东侧（共享整条边，并集为合法矩形）
    const adjacent = run([
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
              position: { x: 3.5, y: 1.4, z: 0 },
            },
          ],
        },
      },
    ])
    const scene = run([{ op: 'mergeRoom', keep: '房A', remove: '房B' }], adjacent)
    const a = findNodeById(scene.root, 'a') as RoomNode
    expect(a).not.toBeNull()
    expect(a.name).toBe('房A')
    expect(findNodeById(scene.root, 'b')).toBeNull()
    expect(roomDims(a).length).toBeCloseTo(7, 5)
  })

  it('nestRoom 按名称引用：真正内嵌', () => {
    const scene = run([{ op: 'nestRoom', id: '房B', into: '房A' }], baseScene())
    const a = findNodeById(scene.root, 'a') as RoomNode
    expect(a.nestedRooms.map((r) => r.id)).toContain('b')
    expect(findNodeById(scene.root, 'b')).not.toBeNull()
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
