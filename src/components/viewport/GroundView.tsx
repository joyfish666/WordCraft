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
 * 在所有墙体方案中找入户门段，返回其世界中心与外向法线方向。
 * （入口墙放不下 0.9m 门时系统会兜底换外墙——跟实际门段走，小径永远对准门。）
 */
function findEntranceDoor(
  wallPlan: Map<string, WallPlan>,
): { x: number; z: number; dir: DoorDirection } | null {
  for (const plan of wallPlan.values()) {
    for (const edge of plan.edges) {
      const seg = edge.segments.find((s) => s.entrance)
      if (!seg) continue
      const mid = (seg.from + seg.to) / 2
      return {
        x: edge.axis === 'x' ? edge.start + mid : edge.line,
        z: edge.axis === 'x' ? edge.line : edge.start + mid,
        dir: edge.dir,
      }
    }
  }
  return null
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

  const ground = useMemo(() => {
    if (!scene || planMode) return null
    const b = houseLevelsBounds(scene.root)
    if (!b) return null
    const w = b.maxX - b.minX + GROUND_MARGIN * 2
    const d = b.maxZ - b.minZ + GROUND_MARGIN * 2
    const geo = planeGeometryWithUvs(w, d, 2)

    const door = wallPlan ? findEntranceDoor(wallPlan) : null
    if (!door) return { geo, stones: [] }
    const vec = DIR_VECTOR[door.dir]
    const stones = Array.from({ length: STONE_COUNT }, (_, i) => {
      const dist = STONE_START + i * STONE_STEP
      return { x: door.x + vec.x * dist, z: door.z + vec.z * dist }
    })
    return { geo, stones }
  }, [scene, planMode, wallPlan])

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
