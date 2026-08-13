import { Edges } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import {
  BACK_AXIS,
  buildFurnitureParts,
  facingFromRoom,
  furnitureKind,
  partsBounds,
} from '../../lib/furniturePresets'
import {
  boxWallGeometry,
  exteriorWallMaterial,
  furnitureMaterial,
  getTexture,
  getWorldUvTexture,
  materialParams,
  roomFloorMaterial,
  skirtingMaterial,
  TEXTURE_TILE_METERS,
} from '../../lib/materials'
import { footprintBounds, houseLevelsBounds, roomCenter, roomDims } from '../../lib/footprint'
import { isContainer } from '../../lib/modelTree'
import {
  ENTRANCE_DOOR_COLOR,
  PLINTH_COLOR,
  TRIM_COLOR,
  WALL_INTERIOR_COLOR,
  roomFaceColor,
} from '../../lib/palette'
import {
  DOOR_WIDTH,
  WALL_THICKNESS,
  defaultWallPlan,
  nestedDoorDirection,
  wallGroupPosition,
  wallPlanWithDoor,
  type DoorDirection,
  type WallPlan,
  type WallSegmentKind,
} from '../../lib/roomGeometry'
import { useModelStore } from '../../store/useModelStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { ColorMode } from '../../types/settings'
import type { FurnitureNode, ModelNode, Position, RoomNode } from '../../types/model'

/** 地板厚度：做成可见的实体板，墙体从地板顶面升起（墙的底部是地板） */
export const FLOOR_THICKNESS = 0.12
/** 墙/家具沉入地板顶面的嵌入量（2mm）：避免底面与地板顶面完全共面导致 z-fighting 闪烁 */
export const FLOOR_EMBED = 0.002
/** 墙/家具实际坐落的基准高度（地板顶面之下 2mm，底面藏进地板体积、永不渲染） */
export const FLOOR_TOP_Y = FLOOR_THICKNESS - FLOOR_EMBED

interface ShellMaterial {
  color: string
  transparent: boolean
  opacity: number
  depthWrite: boolean
  wireframe: boolean
}

interface WallSegmentBoxProps {
  from: number
  to: number
  height: number
  thickness: number
  kind: WallSegmentKind
  /** 是否为入户门（渲染醒目门扇） */
  entrance?: boolean
  material: ShellMaterial
  /** 该墙段是否属外墙（edge.shared=false）：外侧面用外墙饰面材质 */
  exterior: boolean
  /** 外向法线方向（决定外墙面在局部 ±z 的哪一侧、踢脚线/门套凸向室内哪侧） */
  dir: DoorDirection
  /** 房间识别色（踢脚线加深用；虚化时用中性灰） */
  roomColor: string
  /** 是否虚化（聚焦其他房间时），踢脚线等装饰换灰 */
  ghosted: boolean
}

/** 踢脚线高度（米） */
const SKIRTING_H = 0.08
/** 基座勒脚高度（米） */
const PLINTH_H = 0.28
/** 基座勒脚外凸（米） */
const PLINTH_PROTRUDE = 0.03

// 共面错位间隙（米）：z-fighting 只在「同法向 + 共面 + 重叠」的面之间发生
// （反向共面会被背面剔除，不会互掐）。墙底/勒脚/踢脚线/门套的底面都朝下、
// 外侧面都朝向房间内部墙面——必须逐一错开 1~2.5mm，肉眼不可见但彻底消除共面。
const BASE_CLEARANCE = 0.001
const POST_CLEAR = 0.0015
const PLINTH_CLEAR = 0.0025
/** 勒脚内侧面比踢脚线外侧面再深 0.5mm，两者不与墙面、也不互相共面 */
const PLINTH_INNER_CLEAR = 0.0015
/**
 * 踢脚线/勒脚端盖内收量（坑 88）：踢脚线与勒脚沿墙线通铺，其**端盖**与墙盒端盖
 * 在同一平面（同法向 + 共面 + 重叠）→ 每处墙转角三面互掐闪烁。端部各内收 2mm，
 * 端盖平面离开墙端平面，转角处不再共面（2mm 端缝是标准伸缩缝观感）。
 */
const END_CLEAR = 0.002

/**
 * 渲染沿局部 X 轴的一段墙。
 * - 'wall'：实体墙（外墙外侧面用饰面材质 + 按米平铺纹理，内面暖白抹灰；内侧踢脚线）
 * - 'door'：门洞（左右墙段 + 室内侧门套 + 入户门扇/门头标识；室内门保持空门洞）
 * - 'window'：窗洞（下窗台 + 半透明玻璃 + 实体窗框 + 上楣），永远渲染为开洞（坑 2 原则）
 */
function WallSegmentBox({
  from,
  to,
  height,
  thickness,
  kind,
  entrance,
  material,
  exterior,
  dir,
  roomColor,
  ghosted,
}: WallSegmentBoxProps) {
  if (kind === 'open') return null
  const len = to - from
  const center = (from + to) / 2
  // 外向法线在局部 +z（north/west 墙）或 -z（south/east 墙）；室内侧取反
  const outwardIsPlusZ = dir === 'north' || dir === 'west'
  const inward = outwardIsPlusZ ? -1 : 1

  // 墙材质：内面/隔墙统一暖白抹灰；虚化时沿用灰化色
  const wallMaterial = { ...material, color: ghosted ? material.color : WALL_INTERIOR_COLOR }
  // 外墙面材质需跟随透明/虚化/线框状态（聚焦看内部时外墙不能反而实心）
  const exteriorParams = {
    ...materialParams(exteriorWallMaterial()),
    transparent: material.transparent,
    opacity: material.opacity,
    depthWrite: material.depthWrite,
    wireframe: material.wireframe,
  }
  // 六面材质：±x 端面、±y 顶底面均为抹灰；±z 面中外侧面用外墙饰面
  const faceMats: Record<number, THREE.MeshStandardMaterialParameters> = {
    0: wallMaterial,
    1: wallMaterial,
    2: wallMaterial,
    3: wallMaterial,
    4: wallMaterial,
    5: wallMaterial,
  }
  const outwardIdx = outwardIsPlusZ ? 4 : 5
  faceMats[outwardIdx] = exteriorParams
  const exteriorGeo = exterior
    ? boxWallGeometry(len, height, thickness, TEXTURE_TILE_METERS.plasterWall)
    : null

  const trim = {
    transparent: material.transparent,
    opacity: material.opacity,
    depthWrite: material.depthWrite,
    wireframe: material.wireframe,
  }
  const skirtingParams = materialParams(skirtingMaterial(roomColor))

  if (kind === 'wall') {
    return (
      <>
        <mesh position={[center, height / 2, 0]} castShadow receiveShadow>
          {exteriorGeo ? (
            <primitive object={exteriorGeo} attach="geometry" />
          ) : (
            <boxGeometry args={[len, height, thickness]} />
          )}
          {exteriorGeo ? (
            <>
              {([0, 1, 2, 3, 4, 5] as const).map((i) => (
                <meshStandardMaterial key={i} attach={`material-${i}`} {...faceMats[i]} />
              ))}
            </>
          ) : (
            <meshStandardMaterial {...wallMaterial} />
          )}
        </mesh>
        {/* 基座勒脚：外墙底部深色压边，外凸墙面（门段留空）；
            底面 +2.5mm、内侧面深 1.5mm、端部内收 2mm——与墙底/踢脚线外侧面/墙端盖均不共面 */}
        {exterior && (
          <mesh
            position={[
              center,
              PLINTH_H / 2 + PLINTH_CLEAR,
              (outwardIsPlusZ ? 1 : -1) * (PLINTH_PROTRUDE / 2 + PLINTH_INNER_CLEAR / 2),
            ]}
            castShadow
          >
            <boxGeometry
              args={[
                len - END_CLEAR * 2,
                PLINTH_H,
                thickness + PLINTH_PROTRUDE - PLINTH_INNER_CLEAR,
              ]}
            />
            <meshStandardMaterial color={PLINTH_COLOR} roughness={0.9} {...trim} />
          </mesh>
        )}
        {/* 踢脚线：贴墙内侧，色 = 房间识别色加深；
            底面 +1mm、外侧面内收 1mm、端部内收 2mm——不与墙底/墙面/勒脚/墙端盖共面 */}
        <mesh
          position={[
            center,
            SKIRTING_H / 2 + BASE_CLEARANCE,
            inward * (thickness / 2 - 0.01 - BASE_CLEARANCE),
          ]}
          castShadow
        >
          <boxGeometry args={[len - END_CLEAR * 2, SKIRTING_H, 0.02]} />
          <meshStandardMaterial
            {...skirtingParams}
            color={ghosted ? '#a29a88' : skirtingParams.color}
            {...trim}
          />
        </mesh>
      </>
    )
  }
  if (kind === 'window') {
    // 窗洞：窗台（实体）+ 半透明玻璃（含实体窗框）+ 窗楣（实体）
    const sillH = Math.min(0.9, height)
    const paneH = Math.max(0, Math.min(1.2, height - sillH))
    const rest = Math.max(0, height - sillH - paneH)
    const frameTh = 0.05
    const frameW = 0.04
    return (
      <>
        {/* 基座勒脚延续（窗台下）；底面 +2.5mm、内侧面深 1.5mm、端部内收 2mm 不共面 */}
        {exterior && (
          <mesh
            position={[
              center,
              PLINTH_H / 2 + PLINTH_CLEAR,
              (outwardIsPlusZ ? 1 : -1) * (PLINTH_PROTRUDE / 2 + PLINTH_INNER_CLEAR / 2),
            ]}
            castShadow
          >
            <boxGeometry
              args={[
                len - END_CLEAR * 2,
                PLINTH_H,
                thickness + PLINTH_PROTRUDE - PLINTH_INNER_CLEAR,
              ]}
            />
            <meshStandardMaterial color={PLINTH_COLOR} roughness={0.9} {...trim} />
          </mesh>
        )}
        {sillH > 0 && (
          <mesh position={[center, sillH / 2, 0]} castShadow>
            <boxGeometry args={[len, sillH, thickness]} />
            <meshStandardMaterial {...wallMaterial} />
          </mesh>
        )}
        {paneH > 0 && (
          <>
            <mesh position={[center, sillH + paneH / 2, 0]}>
              <boxGeometry args={[len, paneH, 0.04]} />
              <meshStandardMaterial
                color="#3a4a55"
                metalness={0.85}
                roughness={0.12}
                transparent
                opacity={0.8}
                depthWrite={false}
              />
            </mesh>
            {/* 实体窗框：上下轨 + 左右立柱 + 大窗中梃（木色） */}
            <mesh position={[center, sillH + frameW / 2, 0]}>
              <boxGeometry args={[len, frameW, frameTh]} />
              <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} {...trim} />
            </mesh>
            <mesh position={[center, sillH + paneH - frameW / 2, 0]}>
              <boxGeometry args={[len, frameW, frameTh]} />
              <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} {...trim} />
            </mesh>
            <mesh position={[from + frameW / 2, sillH + paneH / 2, 0]}>
              <boxGeometry args={[frameW, paneH, frameTh]} />
              <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} {...trim} />
            </mesh>
            <mesh position={[to - frameW / 2, sillH + paneH / 2, 0]}>
              <boxGeometry args={[frameW, paneH, frameTh]} />
              <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} {...trim} />
            </mesh>
            {len >= 1.6 && (
              <mesh position={[center, sillH + paneH / 2, 0]}>
                <boxGeometry args={[frameW, paneH, frameTh]} />
                <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} {...trim} />
              </mesh>
            )}
          </>
        )}
        {rest > 0 && (
          <mesh position={[center, sillH + paneH + rest / 2, 0]} castShadow>
            <boxGeometry args={[len, rest, thickness]} />
            <meshStandardMaterial {...wallMaterial} />
          </mesh>
        )}
      </>
    )
  }
  // door 段：必定渲染为门洞（门段宽度即 DOOR_WIDTH，不再落入实心墙分支）
  const doorW = Math.min(DOOR_WIDTH, len)
  const sideLen = (len - doorW) / 2
  const leafH = Math.min(height, 2.1)
  // 门套：室内侧两立柱（去掉上横梁——门洞上沿不再有横杠）。
  // 立柱外侧面内收 1.5mm（比踢脚线 1mm 再深 0.5mm）、底面 +1.5mm——不与墙面/踢脚线共面。
  const casingZ = inward * (thickness / 2 - 0.025 - POST_CLEAR)
  const casing = (
    <>
      <mesh position={[from + 0.03, leafH / 2 + POST_CLEAR, casingZ]} castShadow>
        <boxGeometry args={[0.06, leafH, 0.05]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} {...trim} />
      </mesh>
      <mesh position={[to - 0.03, leafH / 2 + POST_CLEAR, casingZ]} castShadow>
        <boxGeometry args={[0.06, leafH, 0.05]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} {...trim} />
      </mesh>
    </>
  )
  return (
    <>
      {sideLen > 0 && (
        <>
          <mesh position={[from + sideLen / 2, height / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[sideLen, height, thickness]} />
            <meshStandardMaterial {...wallMaterial} />
          </mesh>
          <mesh position={[to - sideLen / 2, height / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[sideLen, height, thickness]} />
            <meshStandardMaterial {...wallMaterial} />
          </mesh>
          {/* 门洞两侧墙段也带踢脚线（贴室内侧）；底面 +1mm、外侧面内收 1mm、端部内收 2mm 不共面 */}
          <mesh
            position={[
              from + sideLen / 2,
              SKIRTING_H / 2 + BASE_CLEARANCE,
              inward * (thickness / 2 - 0.01 - BASE_CLEARANCE),
            ]}
          >
            <boxGeometry args={[sideLen - END_CLEAR * 2, SKIRTING_H, 0.02]} />
            <meshStandardMaterial
              {...skirtingParams}
              color={ghosted ? '#a29a88' : skirtingParams.color}
              {...trim}
            />
          </mesh>
          <mesh
            position={[
              to - sideLen / 2,
              SKIRTING_H / 2 + BASE_CLEARANCE,
              inward * (thickness / 2 - 0.01 - BASE_CLEARANCE),
            ]}
          >
            <boxGeometry args={[sideLen - END_CLEAR * 2, SKIRTING_H, 0.02]} />
            <meshStandardMaterial
              {...skirtingParams}
              color={ghosted ? '#a29a88' : skirtingParams.color}
              {...trim}
            />
          </mesh>
        </>
      )}
      {casing}
      {/* 入户门：实心暖色门扇（门头不再放标识牌） */}
      {entrance && (
        <mesh position={[center, leafH / 2, 0]} castShadow>
          <boxGeometry args={[doorW, leafH, 0.12]} />
          <meshStandardMaterial color={ENTRANCE_DOOR_COLOR} roughness={0.45} />
        </mesh>
      )}
    </>
  )
}

/**
 * 地板多边形：足迹在非共享边外扩一个墙厚（共享边到边界，邻居地板接续）。
 * 逐边求偏移线交点——正交多边形下与旧"矩形四边外扩"语义一致。
 */
function floorPolygon(room: RoomNode, plan: WallPlan): { x: number; z: number }[] {
  const edges = plan.edges
  const n = edges.length
  if (n < 3) return room.footprint
  const offset = edges.map((e) => {
    const t = e.shared ? 0 : WALL_THICKNESS
    const d = e.dir === 'north' || e.dir === 'east' ? t : -t
    return { axis: e.axis, line: e.line + d }
  })
  const pts: { x: number; z: number }[] = []
  for (let i = 0; i < n; i++) {
    const prev = offset[(i - 1 + n) % n]!
    const cur = offset[i]!
    if (prev.axis === cur.axis) continue // 退化（共线边）跳过
    pts.push({
      x: prev.axis === 'z' ? prev.line : cur.line,
      z: prev.axis === 'x' ? prev.line : cur.line,
    })
  }
  return pts.length >= 3 ? pts : room.footprint
}

/**
 * 墙体方案内容签名（按 WeakMap 缓存字符串实例）：
 * 拖拽预览每帧产生新场景引用 → 新 WallPlan 引用，但内容（共享标记/墙线/方向）不变。
 * floorShape 的 useMemo 若直接依赖 plan 引用会每帧重建地板几何；按内容签名命中则稳定。
 * 签名只取 floorPolygon 实际消费的字段（axis/line/shared/dir），语义变化必反映在签名中。
 */
const planKeyCache = new WeakMap<WallPlan, string>()
function wallPlanKey(plan: WallPlan): string {
  let key = planKeyCache.get(plan)
  if (!key) {
    key = plan.edges.map((e) => `${e.axis}@${e.line}@${e.shared ? 1 : 0}@${e.dir}`).join('|')
    planKeyCache.set(plan, key)
  }
  return key
}

interface RoomShellProps {
  room: RoomNode
  material: ShellMaterial
  isSelected: boolean
  plan: WallPlan
  /** 是否为嵌套在父房间内部的子房间（如卧室内卫生间）：地板略微抬高避免与父地板重叠 */
  nested?: boolean
  /** 截图净化：隐藏选中轮廓等辅助元素 */
  screenshotMode?: boolean
  /** 房间识别色（踢脚线/地板 tint 用） */
  roomColor: string
  /** 兄弟容器索引（地板材质按房间类型+索引取识别色 tint） */
  siblingIndex: number
  /** 是否虚化（聚焦其他房间时地板/踢脚线换灰） */
  ghosted: boolean
  /** 视觉模式（标准/色盲） */
  colorMode: ColorMode
}

/** 房间外壳：足迹实体地板（外扩覆盖墙脚）+ 沿足迹边分段实心墙（门洞/窗洞留空） */
function RoomShell({
  room,
  material,
  isSelected,
  plan,
  nested = false,
  screenshotMode = false,
  roomColor,
  siblingIndex,
  ghosted,
  colorMode,
}: RoomShellProps) {
  const H = room.height
  const bounds = footprintBounds(room.footprint)
  const bw = bounds.maxX - bounds.minX
  const bd = bounds.maxZ - bounds.minZ
  const cx = (bounds.minX + bounds.maxX) / 2
  const cz = (bounds.minZ + bounds.maxZ) / 2
  const baseY = 0
  // 墙底沉入地板顶面 2mm：墙底/勒脚/踢脚线底面不与地板顶面共面，消除连接处闪烁
  const wallBaseY = baseY + FLOOR_TOP_Y
  const floorLift = nested ? 0.012 : 0

  // 地板形状：Shape 位于 XY 平面，经 -90° X 旋转铺平到 XZ（shape 坐标 y = -世界 z）。
  // memo 依赖为 footprint 引用 + 墙体方案内容签名：拖拽家具预览每帧产生新 scene/新 plan
  // 引用，但足迹与墙线内容不变——形状与 ExtrudeGeometry 不重建（否则每帧每房间分配 + GC）。
  // 依赖故意只取 floorPolygon 实际消费的内容（wallPlanKey），非 plan/room 引用本身。
  const floorShape = useMemo(
    () => new THREE.Shape(floorPolygon(room, plan).map((p) => new THREE.Vector2(p.x, -p.z))),
    [room.footprint, wallPlanKey(plan)], // eslint-disable-line react-hooks/exhaustive-deps
  )
  // 地板材质：按房间类型匹配 木纹/瓷砖/混凝土，乘房间识别色淡化 tint
  const floor = roomFloorMaterial(room.name, colorMode, siblingIndex)

  const wall = (edge: (typeof plan.edges)[number], idx: number) => {
    const isX = edge.axis === 'x'
    const pos = wallGroupPosition(edge, wallBaseY)
    const exterior = !edge.shared
    return (
      <group key={idx} position={pos} rotation={isX ? [0, 0, 0] : [0, -Math.PI / 2, 0]}>
        {edge.segments.map((seg, i) => (
          <WallSegmentBox
            key={i}
            from={seg.from}
            to={seg.to}
            height={H}
            thickness={WALL_THICKNESS}
            kind={seg.kind}
            entrance={seg.entrance}
            material={material}
            exterior={exterior}
            dir={edge.dir}
            roomColor={roomColor}
            ghosted={ghosted}
          />
        ))}
      </group>
    )
  }

  return (
    <>
      {/* 足迹实体地板（嵌套子房间的地板略微抬高，避免与父地板重叠闪烁） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, baseY + floorLift, 0]} receiveShadow>
        <extrudeGeometry args={[floorShape, { depth: FLOOR_THICKNESS, bevelEnabled: false }]} />
        <meshStandardMaterial
          map={getWorldUvTexture(floor.map!)}
          color={ghosted ? '#cfc8b8' : floor.color}
          roughness={floor.roughness}
          side={THREE.DoubleSide}
          transparent={material.transparent}
          opacity={material.opacity}
          depthWrite={material.depthWrite}
          wireframe={material.wireframe}
        />
      </mesh>

      {/* 沿足迹边渲染墙段：轴 'x' 平放、轴 'z' -90° 旋转，局部方向与墙段坐标统一（避免镜像） */}
      {plan.edges.map((edge, idx) => wall(edge, idx))}

      {/* 选中轮廓（不参与射线检测：否则会挡在房间内部件上方，使部件点不到） */}
      {isSelected && !screenshotMode && (
        <mesh raycast={() => null} position={[cx, baseY + (FLOOR_THICKNESS + H) / 2, cz]}>
          <boxGeometry args={[bw, FLOOR_THICKNESS + H, bd]} />
          <meshBasicMaterial color="#3d7a48" wireframe transparent opacity={0.7} />
        </mesh>
      )}
    </>
  )
}

interface ModelNodeViewProps {
  node: ModelNode
  /** 兄弟容器索引，用于分配不同房间色（嵌套房间 = 父家具数 + 嵌套下标） */
  siblingIndex?: number
  /** 祖先节点 id，用于判断是否位于聚焦房间内 */
  ancestors?: string[]
  /** 各房间的分段墙体方案 */
  wallPlan?: Map<string, WallPlan>
  /** 父房间中心（嵌套房间据此决定门朝向父房间内部） */
  parentCenter?: Position
  /** 直接父房间（家具据此计算贴靠的墙来决定朝向） */
  parentRoom?: RoomNode
  /** 2D 平面图模式：家具改由 PlanEnhancements 的 2D 足迹呈现，跳过 3D 网格 */
  planMode?: boolean
}

/**
 * 递归渲染层级模型。
 * - 整屋视图：房间为足迹地板 + 沿边分段墙（门洞/窗洞/开放段），开放空间连通，外墙完整
 * - 聚焦视图（focusId 指向某房间）：该房间外壳透明化以便查看内部实体家具，
 *   其他房间外壳虚化；家具仍遵循 实体/虚化 两态
 */
export function ModelNodeView({
  node,
  siblingIndex = 0,
  ancestors = [],
  wallPlan,
  parentCenter,
  parentRoom,
  planMode = false,
}: ModelNodeViewProps) {
  const selectNode = useModelStore((s) => s.selectNode)
  const setFocus = useModelStore((s) => s.setFocus)
  const selectedId = useModelStore((s) => s.selectedId)
  const focusId = useModelStore((s) => s.focusId)
  const screenshotMode = useModelStore((s) => s.screenshotMode)
  const colorMode = useSettingsStore((s) => s.colorMode)
  const wireframeEnabled = useSettingsStore((s) => s.wireframe.enabled)

  const isSelected = node.id === selectedId
  const isFocusedRoom = focusId === node.id
  const inFocusedRoom = focusId !== null && ancestors.includes(focusId)
  const ghosted = focusId !== null && !isFocusedRoom && !inFocusedRoom

  const childAncestors = [...ancestors, node.id]

  const handleClick = () => {
    selectNode(node.id)
    // 点击房间进入聚焦视图；点击家具仅选中
    if (isContainer(node) && node.type === 'room') {
      setFocus(node.id)
    }
  }

  if (isContainer(node)) {
    if (node.type === 'house') {
      // 房屋线框盒（视觉轮廓）：由所有房间足迹包围盒计算，不参与射线检测
      const dims = houseBoundsFor(node)
      const level = node.levels[0]
      return (
        <>
          {!screenshotMode && level && (
            <mesh raycast={() => null} position={[dims.cx, dims.height / 2, dims.cz]}>
              <boxGeometry args={[dims.width, dims.height, dims.depth]} />
              <meshBasicMaterial color="#6f6858" wireframe transparent opacity={0.25} />
            </mesh>
          )}
          {level?.rooms.map((child, i) => (
            <ModelNodeView
              key={child.id}
              node={child}
              siblingIndex={i}
              ancestors={childAncestors}
              wallPlan={wallPlan}
              parentCenter={{ x: 0, y: 0, z: 0 }}
              planMode={planMode}
            />
          ))}
        </>
      )
    }

    // 房间外壳材质：整屋视图实心；聚焦房间透明以便查看内部；其他房间聚焦时虚化
    // 颜色与 2D 平面图共用 roomFaceColor，保证两种视图下房间颜色一致
    const baseColor = roomFaceColor(node.name, siblingIndex, colorMode)
    let material: ShellMaterial
    if (isFocusedRoom) {
      material = {
        color: baseColor,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        wireframe: wireframeEnabled,
      }
    } else if (ghosted) {
      material = {
        color: '#cfc8b8',
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        wireframe: wireframeEnabled,
      }
    } else {
      material = {
        color: baseColor,
        transparent: false,
        opacity: 1,
        depthWrite: true,
        wireframe: wireframeEnabled,
      }
    }

    const isNestedRoom = ancestors.length > 1
    // 嵌套房间：门朝向父房间中心（从父房间进嵌套房间）；顶层房间用共享墙方案或兜底
    const plan =
      wallPlan?.get(node.id) ??
      (isNestedRoom && parentCenter
        ? wallPlanWithDoor(node, nestedDoorDirection(node, parentCenter))
        : defaultWallPlan(node))

    const roomCenterPos = roomCenter(node)
    return (
      <group
        onClick={(e) => {
          // 停止冒泡：点击本房间的部件/子房间时不重新选中父房间
          e.stopPropagation()
          handleClick()
        }}
      >
        <RoomShell
          room={node}
          material={material}
          isSelected={isSelected}
          plan={plan}
          nested={isNestedRoom}
          screenshotMode={screenshotMode}
          roomColor={baseColor}
          siblingIndex={siblingIndex}
          ghosted={ghosted}
          colorMode={colorMode}
        />
        {node.furniture.map((child) => (
          <ModelNodeView
            key={child.id}
            node={child}
            ancestors={childAncestors}
            parentRoom={node}
            planMode={planMode}
          />
        ))}
        {node.nestedRooms.map((child, i) => (
          <ModelNodeView
            key={child.id}
            node={child}
            siblingIndex={node.furniture.length + i}
            ancestors={childAncestors}
            wallPlan={wallPlan}
            parentCenter={roomCenterPos}
            parentRoom={node}
            planMode={planMode}
          />
        ))}
      </group>
    )
  }

  // 家具：实体 vs 虚化两种状态（y 抬升一个地板厚度，使其立在地板顶面）
  // 按名称识别家具种类并拼装部件（床/衣柜/沙发…），未识别回退为单个整盒；
  // 朝向由家具在父房间内贴靠（或最近）的墙决定——床头板朝墙、柜门朝房间内
  // 平面图模式：3D 家具网格不渲染（由 PlanEnhancements 以 2D 足迹呈现）
  if (planMode) return null
  const kind = furnitureKind(node.name)
  const facing = parentRoom
    ? facingFromRoom(
        node,
        { position: roomCenter(parentRoom), dimensions: roomDims(parentRoom) },
        BACK_AXIS[kind],
      )
    : 'north'
  const parts = buildFurnitureParts(
    kind,
    node.dimensions.length,
    node.dimensions.height,
    node.dimensions.width,
    facing,
  )
  const bounds = partsBounds(parts)
  const outlineSize: [number, number, number] = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ]
  const outlineCenter: [number, number, number] = [
    (bounds.max[0] + bounds.min[0]) / 2,
    (bounds.max[1] + bounds.min[1]) / 2,
    (bounds.max[2] + bounds.min[2]) / 2,
  ]
  const showOutline = !screenshotMode && (isSelected || !ghosted)
  const furnitureNode = node as FurnitureNode
  return (
    <group
      position={[
        furnitureNode.position.x,
        furnitureNode.position.y + FLOOR_TOP_Y,
        furnitureNode.position.z,
      ]}
      onClick={(e) => {
        // 停止冒泡：选中部件而非冒泡到父房间
        e.stopPropagation()
        handleClick()
      }}
    >
      {parts.map((part, i) => {
        const mat = furnitureMaterial(kind, part.shade, colorMode)
        return (
          <mesh key={i} position={part.center} castShadow>
            {part.shape === 'cylinder' ? (
              <cylinderGeometry args={[part.size[0], part.size[0], part.size[1], 24]} />
            ) : (
              <boxGeometry args={part.size} />
            )}
            <meshStandardMaterial
              map={mat.map ? getTexture(mat.map) : undefined}
              color={mat.color}
              roughness={mat.roughness}
              metalness={mat.metalness}
              transparent={ghosted}
              opacity={ghosted ? 0.2 : 1}
              wireframe={wireframeEnabled}
            />
          </mesh>
        )
      })}
      {/* 并集包围盒轮廓（不参与射线检测：否则会挡在部件上，使部件点不到） */}
      {showOutline && (
        <mesh position={outlineCenter} raycast={() => null}>
          <boxGeometry args={outlineSize} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          <Edges color={isSelected ? '#3d7a48' : '#8f8877'} />
        </mesh>
      )}
    </group>
  )
}

/** 房屋线框盒：所有房间足迹并集 + 最高层高 */
function houseBoundsFor(node: Parameters<typeof houseLevelsBounds>[0]): {
  cx: number
  cz: number
  width: number
  depth: number
  height: number
} {
  const b = houseLevelsBounds(node)
  const height = Math.max(...node.levels.map((l) => l.height), 2.8)
  if (!b) return { cx: 0, cz: 0, width: 4, depth: 3, height }
  return {
    cx: (b.minX + b.maxX) / 2,
    cz: (b.minZ + b.maxZ) / 2,
    width: b.maxX - b.minX + WALL_THICKNESS * 2,
    depth: b.maxZ - b.minZ + WALL_THICKNESS * 2,
    height,
  }
}
