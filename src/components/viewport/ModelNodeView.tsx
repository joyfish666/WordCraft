import { Edges } from '@react-three/drei'
import * as THREE from 'three'
import {
  BACK_AXIS,
  buildFurnitureParts,
  facingFromRoom,
  furnitureKind,
  partsBounds,
} from '../../lib/furniturePresets'
import { footprintBounds, houseLevelsBounds, roomCenter, roomDims } from '../../lib/footprint'
import { isContainer } from '../../lib/modelTree'
import {
  ENTRANCE_DOOR_COLOR,
  ENTRANCE_MARKER_COLOR,
  FURNITURE_COLOR,
  FURNITURE_COLORBLIND,
  FURNITURE_PART_DARK,
  FURNITURE_PART_INK,
  roomFaceColor,
} from '../../lib/palette'
import {
  DOOR_WIDTH,
  WALL_THICKNESS,
  defaultWallPlan,
  nestedDoorDirection,
  wallGroupPosition,
  wallPlanWithDoor,
  type WallPlan,
  type WallSegmentKind,
} from '../../lib/roomGeometry'
import { useModelStore } from '../../store/useModelStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { FurnitureNode, ModelNode, Position, RoomNode } from '../../types/model'

/** 地板厚度：做成可见的实体板，墙体从地板顶面升起（墙的底部是地板） */
export const FLOOR_THICKNESS = 0.12

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
}

/**
 * 渲染沿局部 X 轴的一段墙。
 * - 'wall'：实体墙
 * - 'door'：门洞（左右墙段 + 入户门扇/门头标识；室内门保持空门洞）
 * - 'window'：窗洞（下窗台 + 半透明玻璃 + 上楣），永远渲染为开洞（坑 2 原则）
 */
function WallSegmentBox({
  from,
  to,
  height,
  thickness,
  kind,
  entrance,
  material,
}: WallSegmentBoxProps) {
  if (kind === 'open') return null
  const len = to - from
  const center = (from + to) / 2
  if (kind === 'wall') {
    return (
      <mesh position={[center, height / 2, 0]}>
        <boxGeometry args={[len, height, thickness]} />
        <meshStandardMaterial {...material} />
      </mesh>
    )
  }
  if (kind === 'window') {
    // 窗洞：窗台（实体）+ 半透明玻璃（内含镂空示意线框）+ 窗楣（实体）
    const sillH = Math.min(0.9, height)
    const paneH = Math.max(0, Math.min(1.2, height - sillH))
    const rest = Math.max(0, height - sillH - paneH)
    return (
      <>
        {sillH > 0 && (
          <mesh position={[center, sillH / 2, 0]}>
            <boxGeometry args={[len, sillH, thickness]} />
            <meshStandardMaterial {...material} />
          </mesh>
        )}
        {paneH > 0 && (
          <>
            <mesh position={[center, sillH + paneH / 2, 0]}>
              <boxGeometry args={[len, paneH, 0.04]} />
              <meshStandardMaterial color="#8fd0ff" transparent opacity={0.45} depthWrite={false} />
            </mesh>
            {/* 窗框示意（网格线框，与玻璃不同面避免共面闪烁） */}
            <mesh position={[center, sillH + paneH / 2, 0]}>
              <boxGeometry args={[len, paneH, thickness]} />
              <meshStandardMaterial
                color="#2f3542"
                wireframe
                transparent
                opacity={0.3}
                depthWrite={false}
              />
            </mesh>
          </>
        )}
        {rest > 0 && (
          <mesh position={[center, sillH + paneH + rest / 2, 0]}>
            <boxGeometry args={[len, rest, thickness]} />
            <meshStandardMaterial {...material} />
          </mesh>
        )}
      </>
    )
  }
  // door 段：必定渲染为门洞（门段宽度即 DOOR_WIDTH，不再落入实心墙分支）
  const doorW = Math.min(DOOR_WIDTH, len)
  const sideLen = (len - doorW) / 2
  const leafH = Math.min(height, 2.1)
  return (
    <>
      {sideLen > 0 && (
        <>
          <mesh position={[from + sideLen / 2, height / 2, 0]}>
            <boxGeometry args={[sideLen, height, thickness]} />
            <meshStandardMaterial {...material} />
          </mesh>
          <mesh position={[to - sideLen / 2, height / 2, 0]}>
            <boxGeometry args={[sideLen, height, thickness]} />
            <meshStandardMaterial {...material} />
          </mesh>
        </>
      )}
      {/* 入户门：实心暖色门扇 + 门头亮黄标识（在墙内，不悬浮） */}
      {entrance && (
        <>
          <mesh position={[center, leafH / 2, 0]}>
            <boxGeometry args={[doorW, leafH, 0.12]} />
            <meshStandardMaterial color={ENTRANCE_DOOR_COLOR} />
          </mesh>
          <mesh position={[center, leafH + 0.18, 0]}>
            <boxGeometry args={[doorW + 0.3, 0.16, 0.22]} />
            <meshStandardMaterial color={ENTRANCE_MARKER_COLOR} />
          </mesh>
        </>
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
    const prev = offset[(i - 1 + n) % n]
    const cur = offset[i]
    if (prev.axis === cur.axis) continue // 退化（共线边）跳过
    pts.push({
      x: prev.axis === 'z' ? prev.line : cur.line,
      z: prev.axis === 'x' ? prev.line : cur.line,
    })
  }
  return pts.length >= 3 ? pts : room.footprint
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
}

/** 房间外壳：足迹实体地板（外扩覆盖墙脚）+ 沿足迹边分段实心墙（门洞/窗洞留空） */
function RoomShell({
  room,
  material,
  isSelected,
  plan,
  nested = false,
  screenshotMode = false,
}: RoomShellProps) {
  const H = room.height
  const bounds = footprintBounds(room.footprint)
  const bw = bounds.maxX - bounds.minX
  const bd = bounds.maxZ - bounds.minZ
  const cx = (bounds.minX + bounds.maxX) / 2
  const cz = (bounds.minZ + bounds.maxZ) / 2
  const baseY = 0
  const wallBaseY = baseY + FLOOR_THICKNESS
  const floorLift = nested ? 0.012 : 0

  // 地板形状：Shape 位于 XY 平面，经 -90° X 旋转铺平到 XZ（shape 坐标 y = -世界 z）
  const floorShape = new THREE.Shape(
    floorPolygon(room, plan).map((p) => new THREE.Vector2(p.x, -p.z)),
  )

  const wall = (edge: (typeof plan.edges)[number], idx: number) => {
    const isX = edge.axis === 'x'
    const pos = wallGroupPosition(edge, wallBaseY)
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
          />
        ))}
      </group>
    )
  }

  return (
    <>
      {/* 足迹实体地板（嵌套子房间的地板略微抬高，避免与父地板重叠闪烁） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, baseY + floorLift, 0]}>
        <extrudeGeometry args={[floorShape, { depth: FLOOR_THICKNESS, bevelEnabled: false }]} />
        <meshStandardMaterial {...material} side={THREE.DoubleSide} />
      </mesh>

      {/* 沿足迹边渲染墙段：轴 'x' 平放、轴 'z' -90° 旋转，局部方向与墙段坐标统一（避免镜像） */}
      {plan.edges.map((edge, idx) => wall(edge, idx))}

      {/* 选中轮廓（不参与射线检测：否则会挡在房间内部件上方，使部件点不到） */}
      {isSelected && !screenshotMode && (
        <mesh raycast={() => null} position={[cx, baseY + (FLOOR_THICKNESS + H) / 2, cz]}>
          <boxGeometry args={[bw, FLOOR_THICKNESS + H, bd]} />
          <meshBasicMaterial color="#ffd93d" wireframe transparent opacity={0.7} />
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
              <meshBasicMaterial color="#8a93a5" wireframe transparent opacity={0.12} />
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
        color: '#2f3542',
        transparent: true,
        opacity: 0.18,
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
        />
        {node.furniture.map((child) => (
          <ModelNodeView key={child.id} node={child} ancestors={childAncestors} parentRoom={node} />
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
          />
        ))}
      </group>
    )
  }

  // 家具：实体 vs 虚化两种状态（y 抬升一个地板厚度，使其立在地板顶面）
  // 按名称识别家具种类并拼装部件（床/衣柜/沙发…），未识别回退为单个整盒；
  // 朝向由家具在父房间内贴靠（或最近）的墙决定——床头板朝墙、柜门朝房间内
  const fill = colorMode === 'colorblind' ? FURNITURE_COLORBLIND : FURNITURE_COLOR
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
        furnitureNode.position.y + FLOOR_THICKNESS,
        furnitureNode.position.z,
      ]}
      onClick={(e) => {
        // 停止冒泡：选中部件而非冒泡到父房间
        e.stopPropagation()
        handleClick()
      }}
    >
      {parts.map((part, i) => (
        <mesh key={i} position={part.center}>
          {part.shape === 'cylinder' ? (
            <cylinderGeometry args={[part.size[0], part.size[0], part.size[1], 24]} />
          ) : (
            <boxGeometry args={part.size} />
          )}
          <meshStandardMaterial
            color={
              part.shade === 'dark'
                ? FURNITURE_PART_INK
                : part.shade === 'secondary'
                  ? FURNITURE_PART_DARK
                  : fill
            }
            transparent={ghosted}
            opacity={ghosted ? 0.2 : 1}
            wireframe={wireframeEnabled}
          />
        </mesh>
      ))}
      {/* 并集包围盒轮廓（不参与射线检测：否则会挡在部件上，使部件点不到） */}
      {showOutline && (
        <mesh position={outlineCenter} raycast={() => null}>
          <boxGeometry args={outlineSize} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          <Edges color={isSelected ? '#ffd93d' : '#8a93a5'} />
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
