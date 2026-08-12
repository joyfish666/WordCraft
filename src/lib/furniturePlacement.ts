import { footprintBounds } from './footprint'
import { furnitureKind } from './furniturePresets'
import {
  DOOR_CLEARANCE,
  DOOR_WIDTH,
  WALL_THICKNESS,
  computeDoorZones,
  type DoorZoneInfo,
} from './roomGeometry'
import type { FurnitureNode, RoomNode, SceneModel } from '../types/model'

/**
 * 家具常理摆放：对生成模型做一次确定性兜底，让家具符合日常习惯。
 *
 * 核心规则（仅在大模型未显式要求时才生效，属"未明确才按常理"）：
 * - **靠墙家具**（床/衣柜/橱柜/冰箱/书桌/沙发等，未命中独立词表默认靠墙）：
 *   - 贴到**最近的墙**（保持平行于墙的坐标，只把垂直坐标拉到贴墙）；
 *   - **大面积贴墙**：长边（max(长,宽)）沿墙摆放，必要时交换长宽实现 90° 旋转；
 *   - 再**沿墙滑动**避开三类禁区：嵌套子房间占地（如卧室内卫生间）、**房间门口通道**、已放置的其他家具。
 * - **独立家具**（茶几/餐桌/圆桌/椅子等）：保持原位，仅约束进墙内并避让上述禁区。
 * - 结果保证在房间内缩墙厚后的范围内，最后由调用方再跑一次 normalizeContainment 兜底。
 *
 * 与布局引擎一致：**大模型只出语义，代码算几何**。这里的"常理"同样由代码确定性保证，
 * 不依赖大模型的提示词遵循度。
 */

/** 平面坐标（y 保持不变，家具只调整 x/z） */
type XZ = { x: number; z: number }

/** 重叠判定容差（米）：贴边/共墙视为不重叠，仅处理真实穿透 */
const EPS = 1e-6

/** 独立放置（不贴墙）的家具：名字含这些词时保持中心/原位，仅约束进墙内 */
const FREE_STANDING_RE = /茶几|餐桌|饭桌|圆桌|咖啡桌|地毯|椅子|凳子|吧台|岛台/

/** 是否默认贴墙放置（未命中独立词表时按靠墙处理） */
export function isWallAnchored(name: string): boolean {
  return !FREE_STANDING_RE.test(name)
}

/** 房间内缩墙厚后的可活动范围（足迹包围盒内缩） */
interface InnerBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

function innerBounds(room: RoomNode): InnerBounds {
  const b = footprintBounds(room.footprint)
  return {
    minX: b.minX + WALL_THICKNESS,
    maxX: b.maxX - WALL_THICKNESS,
    minZ: b.minZ + WALL_THICKNESS,
    maxZ: b.maxZ - WALL_THICKNESS,
  }
}

/** 嵌套子房间的禁止进入区：房间足迹包围盒 + 墙厚外扩，家具不得与之重叠 */
function keepOutRect(room: RoomNode): InnerBounds {
  const b = footprintBounds(room.footprint)
  return {
    minX: b.minX - WALL_THICKNESS,
    maxX: b.maxX + WALL_THICKNESS,
    minZ: b.minZ - WALL_THICKNESS,
    maxZ: b.maxZ + WALL_THICKNESS,
  }
}

/** 房间门口的禁入区：从门所在墙内壁向室内 DOOR_CLEARANCE 深、门宽（含少量余量）宽。
 *  导出供 executor 的 nestRoom 落点避让门口复用（坑 47）。 */
export function doorZoneRect(room: RoomNode, zone: DoorZoneInfo): InnerBounds {
  const b = footprintBounds(room.footprint)
  const halfW = DOOR_WIDTH / 2
  switch (zone.dir) {
    case 'north': {
      const line = b.maxZ - WALL_THICKNESS
      return { minX: zone.along - halfW, maxX: zone.along + halfW, minZ: line - DOOR_CLEARANCE, maxZ: line }
    }
    case 'south': {
      const line = b.minZ + WALL_THICKNESS
      return { minX: zone.along - halfW, maxX: zone.along + halfW, minZ: line, maxZ: line + DOOR_CLEARANCE }
    }
    case 'east': {
      const line = b.maxX - WALL_THICKNESS
      return { minX: line - DOOR_CLEARANCE, maxX: line, minZ: zone.along - halfW, maxZ: zone.along + halfW }
    }
    case 'west': {
      const line = b.minX + WALL_THICKNESS
      return { minX: line, maxX: line + DOOR_CLEARANCE, minZ: zone.along - halfW, maxZ: zone.along + halfW }
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/** 家具（半宽 hx/hz）是否与禁止进入区重叠（容差 EPS：贴边不算重叠） */
function overlaps(fx: number, fz: number, hx: number, hz: number, k: InnerBounds): boolean {
  return (
    fx + hx > k.minX + EPS &&
    fx - hx < k.maxX - EPS &&
    fz + hz > k.minZ + EPS &&
    fz - hz < k.maxZ - EPS
  )
}

/**
 * 沿墙滑动避开禁区：保持贴墙轴不变，仅调整平行于墙的坐标。
 * 对每个被占住的禁区，算出向负/正向各需要移动多少，取较小且仍在界内的方向。
 * **迭代滑到干净为止**：单趟只按起点重叠的禁区求避让量，会"避开 A 却撞上 B"
 * （如沿北墙滑开卫生间时撞进已放置的床）；每轮移动后重新检查全部禁区，
 * 移动到已访问过的位置（来回震荡）或无法改进时返回 null（调用方换墙或退化）。
 */
function slideAlongWall(
  fx: number,
  fz: number,
  hx: number,
  hz: number,
  alongAxis: 'x' | 'z',
  bounds: InnerBounds,
  keepOuts: InnerBounds[],
): XZ | null {
  const a0 = alongAxis === 'x' ? fx : fz
  const ha = alongAxis === 'x' ? hx : hz
  const minA = alongAxis === 'x' ? bounds.minX + hx : bounds.minZ + hz
  const maxA = alongAxis === 'x' ? bounds.maxX - hx : bounds.maxZ - hz
  if (minA > maxA) return null // 房间比家具还小

  const clampA = (v: number) => Math.min(Math.max(v, minA), maxA)
  // 单禁区重叠判定（沿墙轴 + 垂直轴同时穿透才计重叠）
  const overlapsK = (a: number, k: InnerBounds): boolean => {
    const kMin = alongAxis === 'x' ? k.minX : k.minZ
    const kMax = alongAxis === 'x' ? k.maxX : k.maxZ
    const kO = alongAxis === 'x' ? k.minZ : k.minX
    const kP = alongAxis === 'x' ? k.maxZ : k.maxX
    const perp = alongAxis === 'x' ? fz : fx
    const hp = alongAxis === 'x' ? hz : hx
    return (
      a + ha > kMin + EPS &&
      a - ha < kMax - EPS &&
      perp + hp > kO + EPS &&
      perp - hp < kP - EPS
    )
  }
  const overlapsAt = (a: number): boolean => keepOuts.some((k) => overlapsK(a, k))

  let a = a0
  const visited = new Set<number>()
  for (let iter = 0; iter < 16; iter++) {
    if (!overlapsAt(a)) {
      return alongAxis === 'x' ? { x: a, z: fz } : { x: fx, z: a }
    }
    if (visited.has(a)) return null // 震荡：两个禁区在两侧反复横跳
    visited.add(a)
    let needNeg = 0
    let needPos = 0
    for (const k of keepOuts) {
      if (!overlapsK(a, k)) continue
      const kMin = alongAxis === 'x' ? k.minX : k.minZ
      const kMax = alongAxis === 'x' ? k.maxX : k.maxZ
      needNeg = Math.max(needNeg, a + ha - kMin)
      needPos = Math.max(needPos, kMax + ha - a)
    }
    const candNeg = clampA(a - needNeg)
    const candPos = clampA(a + needPos)
    const okNeg = a - needNeg >= minA - EPS
    const okPos = a + needPos <= maxA - EPS
    let next: number | null = null
    if (okNeg && okPos) next = needNeg <= needPos ? candNeg : candPos
    else if (okNeg) next = candNeg
    else if (okPos) next = candPos
    if (next === null) return null // 两个方向都出界
    if (Math.abs(next - a) < EPS) return null // 被夹住无法移动（仍重叠）
    a = next
  }
  return null
}

/** 最小穿透推挤：把家具沿穿透最小的轴推出禁区，最多迭代 3 次后约束进墙内 */
function pushOutOfKeepOuts(
  ox: number,
  oz: number,
  hx: number,
  hz: number,
  keepOuts: InnerBounds[],
  bounds: InnerBounds,
): XZ {
  let x = ox
  let z = oz
  for (let iter = 0; iter < 3; iter++) {
    let moved = false
    for (const k of keepOuts) {
      if (!overlaps(x, z, hx, hz, k)) continue
      const cx = (k.minX + k.maxX) / 2
      const cz = (k.minZ + k.maxZ) / 2
      const penX = hx + (k.maxX - k.minX) / 2 - Math.abs(x - cx)
      const penZ = hz + (k.maxZ - k.minZ) / 2 - Math.abs(z - cz)
      if (penX <= penZ) {
        x += x >= cx ? penX : -penX
      } else {
        z += z >= cz ? penZ : -penZ
      }
      moved = true
    }
    if (!moved) break
  }
  x = clamp(x, bounds.minX + hx, bounds.maxX - hx)
  z = clamp(z, bounds.minZ + hz, bounds.maxZ - hz)
  return { x, z }
}

/**
 * 靠墙家具的放置：按距离从近到远尝试四面墙——
 * 大面积贴墙（长边沿墙，必要时交换长宽）+ 沿墙滑动避开禁区；全部被挡时退化最小穿透推挤。
 */
function placeWallAnchored(
  f: FurnitureNode,
  bounds: InnerBounds,
  keepOuts: InnerBounds[],
): { pos: XZ; swapDims: boolean } {
  const L = f.dimensions.length
  const W = f.dimensions.width
  const hx = L / 2
  const hz = W / 2
  const ox = f.position.x
  const oz = f.position.z

  const candidates: { along: 'x' | 'z'; sign: -1 | 1; d: number }[] = [
    { along: 'x', sign: -1, d: Math.abs(oz - (bounds.minZ + hz)) }, // 南
    { along: 'x', sign: 1, d: Math.abs(oz - (bounds.maxZ - hz)) }, // 北
    { along: 'z', sign: -1, d: Math.abs(ox - (bounds.minX + hx)) }, // 西
    { along: 'z', sign: 1, d: Math.abs(ox - (bounds.maxX - hx)) }, // 东
  ]
  candidates.sort((a, b) => a.d - b.d)

  for (const cand of candidates) {
    // 大面积贴墙：长边（max(L,W)）沿墙；必要时交换长宽（90° 旋转）。
    // 床例外：**短边（床头）贴墙**——长边垂直于墙伸入室内（床头朝墙是常理），
    // 否则床长边沿墙、床头在长边端平行于墙，不是常规摆法。
    const baseSwap = cand.along === 'x' ? W > L : L > W
    const swap = furnitureKind(f.name) === 'bed' ? !baseSwap : baseSwap
    const el = swap ? W : L
    const ew = swap ? L : W
    const ehx = el / 2
    const ehz = ew / 2
    // 贴墙：垂直轴固定为墙面位置，平行轴保持当前坐标（先约束到界内）
    let x: number
    let z: number
    if (cand.along === 'x') {
      z = cand.sign === -1 ? bounds.minZ + ehz : bounds.maxZ - ehz
      x = clamp(ox, bounds.minX + ehx, bounds.maxX - ehx)
    } else {
      x = cand.sign === -1 ? bounds.minX + ehx : bounds.maxX - ehx
      z = clamp(oz, bounds.minZ + ehz, bounds.maxZ - ehz)
    }
    const slid = slideAlongWall(x, z, ehx, ehz, cand.along, bounds, keepOuts)
    if (slid) return { pos: slid, swapDims: swap }
  }
  const pos = pushOutOfKeepOuts(ox, oz, hx, hz, keepOuts, bounds)
  return { pos, swapDims: false }
}

/** 递归处理一个房间：先处理嵌套房间，再约束本房间内的家具（按顺序逐个放置并互相避让） */
function visitRoom(
  node: RoomNode,
  doorZones: Map<string, DoorZoneInfo[]>,
): RoomNode {
  const keepOuts: InnerBounds[] = []
  const nestedRooms = node.nestedRooms.map((child) => {
    keepOuts.push(keepOutRect(child))
    return visitRoom(child, doorZones)
  })

  const bounds = innerBounds(node)
  const roomDoors = (doorZones.get(node.id) ?? []).map((z) => doorZoneRect(node, z))
  const placedBoxes: InnerBounds[] = []
  const furniture = node.furniture.map((child) => {
    const f = child
    const keep = [...placedBoxes, ...keepOuts, ...roomDoors]
    const { pos, swapDims } = isWallAnchored(f.name)
      ? placeWallAnchored(f, bounds, keep)
      : {
          pos: pushOutOfKeepOuts(
            f.position.x,
            f.position.z,
            f.dimensions.length / 2,
            f.dimensions.width / 2,
            keep,
            bounds,
          ),
          swapDims: false,
        }
    // 记录放置后的占地（旋转后按有效尺寸），供后续家具避让
    const el = swapDims ? f.dimensions.width : f.dimensions.length
    const ew = swapDims ? f.dimensions.length : f.dimensions.width
    placedBoxes.push({ minX: pos.x - el / 2, maxX: pos.x + el / 2, minZ: pos.z - ew / 2, maxZ: pos.z + ew / 2 })
    if (swapDims) {
      return {
        ...f,
        position: { ...f.position, x: pos.x, z: pos.z },
        dimensions: { length: el, width: ew, height: f.dimensions.height },
        rotationY: (f.rotationY ?? 0) + Math.PI / 2,
      }
    }
    if (pos.x === f.position.x && pos.z === f.position.z) return f
    return { ...f, position: { ...f.position, x: pos.x, z: pos.z } }
  })
  return { ...node, furniture, nestedRooms }
}

/** 对整个场景应用家具常理摆放（不可变，仅调整家具位置/朝向） */
export function applyFurnitureConventions(scene: SceneModel): SceneModel {
  const level = scene.root.levels[0]
  if (!level) return scene
  const rooms = level.rooms
  // 与渲染同源的门口位置：避免家具堵住房间门（含入户门；方向随 entranceDir，默认南）
  const doorZones = computeDoorZones(rooms, {
    entrance: scene.root.entranceDir ?? 'south',
    entranceRoomId: scene.root.entranceRoomId,
  })
  return {
    ...scene,
    root: {
      ...scene.root,
      levels: [{ ...level, rooms: rooms.map((r) => visitRoom(r, doorZones)) }],
    },
  }
}
