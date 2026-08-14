import { useMemo } from 'react'
import { houseLevelsBounds } from '../../lib/footprint'
import { getTexture, planeGeometryWithUvs } from '../../lib/materials'
import { GROUND_COLOR, GROUND_PATH_COLOR } from '../../lib/palette'
import type { DoorDirection, WallPlan } from '../../lib/roomGeometry'
import { useModelStore } from '../../store/useModelStore'

/** 地面四周留白（米） */
const GROUND_MARGIN = 6
/** 石板尺寸（米，与门宽 0.9 对齐） */
const STONE_SIZE = 0.9
/** 石板间距（米） */
const STONE_STEP = 0.95
/** 石板数量 */
const STONE_COUNT = 5
/** 入户墙线到第一块石板的距离（米） */
const STONE_START = 0.55

const DIR_VECTOR: Record<DoorDirection, { x: number; z: number }> = {
  north: { x: 0, z: 1 },
  south: { x: 0, z: -1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
}

/**
 * 室外地面几何缓存（按尺寸取整后的键）：
 * 拖拽预览每帧产生新 scene 引用，若每帧 new PlaneGeometry 会造成 GPU 缓冲泄漏
 * （外部对象经 prop 传入时 R3F 只赋值不 dispose，坑：GroundView 历史泄漏）。
 * 房屋尺寸是离散的，取整键命中率极高，缓存即可复用于整个应用生命周期。
 */
const groundGeoCache = new Map<string, ReturnType<typeof planeGeometryWithUvs>>()

function groundGeometry(w: number, d: number) {
  const key = `${w.toFixed(3)}:${d.toFixed(3)}`
  let geo = groundGeoCache.get(key)
  if (!geo) {
    geo = planeGeometryWithUvs(w, d, 2)
    groundGeoCache.set(key, geo)
  }
  return geo
}

interface EntranceDoor {
  x: number
  z: number
  dir: DoorDirection
}

/**
 * 在所有墙体方案中找入户门段，返回其世界中心与外向法线方向，
 * 以及用于内容签名比对的 key（防止每帧按引用失效导致石子路数组重建）。
 * （入口墙放不下 0.9m 门时系统会兜底换外墙——跟实际门段走，小径永远对准门。）
 */
function findEntranceDoor(wallPlan: Map<string, WallPlan>): {
  door: EntranceDoor | null
  key: string
} {
  let door: EntranceDoor | null = null
  for (const plan of wallPlan.values()) {
    for (const edge of plan.edges) {
      const seg = edge.segments.find((s) => s.entrance)
      if (!seg) continue
      const mid = (seg.from + seg.to) / 2
      door = {
        x: edge.axis === 'x' ? edge.start + mid : edge.line,
        z: edge.axis === 'x' ? edge.line : edge.start + mid,
        dir: edge.dir,
      }
      break
    }
    if (door) break
  }
  return { door, key: door ? `${door.x.toFixed(3)}:${door.z.toFixed(3)}:${door.dir}` : '' }
}

/** 石板小径数组缓存（按入户门内容签名） */
const stonesCache = new Map<string, { x: number; z: number }[]>()

function stonesFor(door: EntranceDoor): { x: number; z: number }[] {
  const key = `${door.x.toFixed(3)}:${door.z.toFixed(3)}:${door.dir}`
  let stones = stonesCache.get(key)
  if (!stones) {
    const vec = DIR_VECTOR[door.dir]
    stones = Array.from({ length: STONE_COUNT }, (_, i) => {
      const dist = STONE_START + i * STONE_STEP
      return { x: door.x + vec.x * dist, z: door.z + vec.z * dist }
    })
    stonesCache.set(key, stones)
  }
  return stones
}

/**
 * 室外地面（造型层）：
 * - 整屋包围盒 + 留白的大平面草地（灰绿 tint，接收阴影）；
 * - 入户门正前方铺一条石板小径（与门洞中心对齐，沿外墙法线向外）；
 * - 平面图模式隐藏（2D 视图保持纯净）。
 */
export function GroundView({
  planMode = false,
  wallPlan,
}: {
  planMode?: boolean
  wallPlan?: Map<string, WallPlan>
}) {
  const scene = useModelStore((s) => s.scene)

  // 依赖用内容签名（坑 73 模式）而非 scene/wallPlan 引用：拖拽预览每帧新引用，
  // 但内容（包围盒尺寸/入户门位置）不变时 geometry/石子数组稳定复用。
  const boundsKey = useMemo(() => {
    if (!scene || planMode) return null
    const b = houseLevelsBounds(scene.root)
    return b
      ? `${b.minX.toFixed(2)}:${b.minZ.toFixed(2)}:${b.maxX.toFixed(2)}:${b.maxZ.toFixed(2)}`
      : null
  }, [scene, planMode])

  const doorKey = useMemo(() => (wallPlan ? findEntranceDoor(wallPlan).key : ''), [wallPlan])

  const ground = useMemo(() => {
    if (!scene || planMode || !boundsKey) return null
    const b = houseLevelsBounds(scene.root)
    if (!b) return null
    const w = b.maxX - b.minX + GROUND_MARGIN * 2
    const d = b.maxZ - b.minZ + GROUND_MARGIN * 2
    const geo = groundGeometry(w, d)

    const door = wallPlan ? findEntranceDoor(wallPlan).door : null
    return { geo, stones: door ? stonesFor(door) : [] }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 内容签名已覆盖 scene/wallPlan 全部消费
  }, [scene, planMode, boundsKey, doorKey])

  if (!scene || planMode || !ground) return null
  return (
    <>
      {/* 草地平面（顶面在 -0.01，地板底面 0 恰好压在其上） */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        geometry={ground.geo}
        receiveShadow
        raycast={() => null}
      >
        <meshStandardMaterial
          map={getTexture('grassGround')}
          color={GROUND_COLOR}
          roughness={1}
          metalness={0}
        />
      </mesh>
      {/* 入户石板小径（与门洞中心对齐） */}
      {ground.stones.map((s, i) => (
        <mesh key={i} position={[s.x, 0.016, s.z]} castShadow raycast={() => null}>
          <boxGeometry args={[STONE_SIZE, 0.05, STONE_SIZE]} />
          <meshStandardMaterial color={GROUND_PATH_COLOR} roughness={0.9} />
        </mesh>
      ))}
    </>
  )
}
