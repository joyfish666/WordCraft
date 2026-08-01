import { Edges } from '@react-three/drei'
import { isContainer } from '../../lib/modelTree'
import {
  CORRIDOR_COLOR,
  CORRIDOR_COLORBLIND,
  FURNITURE_COLOR,
  FURNITURE_COLORBLIND,
  roomColor,
} from '../../lib/palette'
import {
  DOOR_WIDTH,
  WALL_THICKNESS,
  defaultWallPlan,
  isCorridorName,
  type WallPlan,
} from '../../lib/roomGeometry'
import { useModelStore } from '../../store/useModelStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { ContainerNode, ModelNode } from '../../types/model'

/** 地板厚度：做成可见的实体板，墙体从地板顶面升起（墙的底部是地板） */
const FLOOR_THICKNESS = 0.12

interface ShellMaterial {
  color: string
  transparent: boolean
  opacity: number
  depthWrite: boolean
  wireframe: boolean
}

interface WallSegmentsProps {
  length: number
  height: number
  thickness: number
  hasDoor: boolean
  material: ShellMaterial
}

/**
 * 沿局部 X 轴的一段墙。hasDoor 时在中部开出与墙等高的门洞
 * （左右墙段，缺口为空心，无门楣——门与墙同等高度）。
 */
function WallSegments({ length, height, thickness, hasDoor, material }: WallSegmentsProps) {
  if (!hasDoor) {
    return (
      <mesh>
        <boxGeometry args={[length, height, thickness]} />
        <meshStandardMaterial {...material} />
      </mesh>
    )
  }
  const sideLen = length / 2 - DOOR_WIDTH / 2
  if (sideLen <= 0) return null // 墙比门还窄，整体留空
  const sideCenter = (length / 2 + DOOR_WIDTH / 2) / 2
  return (
    <>
      <mesh position={[-sideCenter, height / 2, 0]}>
        <boxGeometry args={[sideLen, height, thickness]} />
        <meshStandardMaterial {...material} />
      </mesh>
      <mesh position={[sideCenter, height / 2, 0]}>
        <boxGeometry args={[sideLen, height, thickness]} />
        <meshStandardMaterial {...material} />
      </mesh>
    </>
  )
}

interface RoomShellProps {
  room: ContainerNode
  material: ShellMaterial
  isSelected: boolean
  plan: WallPlan
}

/** 房间外壳：实体地板（墙脚在其上）+ 四面实心墙（共享墙去重），门洞与墙同高 */
function RoomShell({ room, material, isSelected, plan }: RoomShellProps) {
  const { length: L, width: W, height: H } = room.dimensions
  const cx = room.position.x
  const cz = room.position.z
  const baseY = room.position.y - H / 2
  // 墙体从地板顶面升起
  const wallBaseY = baseY + FLOOR_THICKNESS

  // 地板：非共享边外扩一个墙厚（墙体底部落在其上）；共享边到边界即可（邻居地板接续）
  const xmin = plan.west.shared ? cx - L / 2 : cx - L / 2 - WALL_THICKNESS
  const xmax = plan.east.shared ? cx + L / 2 : cx + L / 2 + WALL_THICKNESS
  const zmin = plan.south.shared ? cz - W / 2 : cz - W / 2 - WALL_THICKNESS
  const zmax = plan.north.shared ? cz + W / 2 : cz + W / 2 + WALL_THICKNESS

  const wall = (
    key: string,
    position: [number, number, number],
    rotation: [number, number, number],
    length: number,
    hasDoor: boolean,
  ) => (
    <group key={key} position={position} rotation={rotation}>
      <WallSegments
        length={length}
        height={H}
        thickness={WALL_THICKNESS}
        hasDoor={hasDoor}
        material={material}
      />
    </group>
  )

  return (
    <>
      {/* 实体地板：可见的底板，墙体从其上竖起 */}
      <mesh position={[(xmin + xmax) / 2, baseY + FLOOR_THICKNESS / 2, (zmin + zmax) / 2]}>
        <boxGeometry args={[xmax - xmin, FLOOR_THICKNESS, zmax - zmin]} />
        <meshStandardMaterial {...material} />
      </mesh>

      {/* 南北墙（沿 X），底部在地板顶面 */}
      {plan.north.render && wall('north', [cx, wallBaseY, cz + W / 2], [0, 0, 0], L, plan.north.hasDoor)}
      {plan.south.render && wall('south', [cx, wallBaseY, cz - W / 2], [0, 0, 0], L, plan.south.hasDoor)}
      {/* 东西墙（绕 Y 旋转 90°，沿 Z） */}
      {plan.east.render && wall('east', [cx + L / 2, wallBaseY, cz], [0, Math.PI / 2, 0], W, plan.east.hasDoor)}
      {plan.west.render && wall('west', [cx - L / 2, wallBaseY, cz], [0, Math.PI / 2, 0], W, plan.west.hasDoor)}

      {/* 选中轮廓（含地板厚度） */}
      {isSelected && (
        <mesh position={[cx, baseY + (FLOOR_THICKNESS + H) / 2, cz]}>
          <boxGeometry args={[L, FLOOR_THICKNESS + H, W]} />
          <meshBasicMaterial color="#ffd93d" wireframe transparent opacity={0.7} />
        </mesh>
      )}
    </>
  )
}

interface ModelNodeViewProps {
  node: ModelNode
  /** 兄弟容器索引，用于分配不同房间色 */
  siblingIndex?: number
  /** 祖先节点 id，用于判断是否位于聚焦房间内 */
  ancestors?: string[]
  /** 各房间的墙体方案（共享墙去重与门洞位置） */
  wallPlan?: Map<string, WallPlan>
}

/**
 * 递归渲染层级模型。
 * - 整屋视图：房间为实心墙体+地板（门与墙同高），共享墙去重并按房间标色，家具被墙体遮挡
 * - 聚焦视图（focusId 指向某房间）：该房间外壳透明化以便查看内部实体家具，
 *   其他房间外壳虚化；家具仍遵循 实体/虚化 两态
 */
export function ModelNodeView({ node, siblingIndex = 0, ancestors = [], wallPlan }: ModelNodeViewProps) {
  const selectNode = useModelStore((s) => s.selectNode)
  const setFocus = useModelStore((s) => s.setFocus)
  const selectedId = useModelStore((s) => s.selectedId)
  const focusId = useModelStore((s) => s.focusId)
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
      return (
        <>
          <mesh
            position={[0, node.dimensions.height / 2, 0]}
            onClick={() => {
              selectNode(null)
              setFocus(null)
            }}
          >
            <boxGeometry
              args={[node.dimensions.length, node.dimensions.height, node.dimensions.width]}
            />
            <meshBasicMaterial color="#8a93a5" wireframe transparent opacity={0.12} />
          </mesh>
          {node.children.map((child, i) => (
            <ModelNodeView
              key={child.id}
              node={child}
              siblingIndex={i}
              ancestors={childAncestors}
              wallPlan={wallPlan}
            />
          ))}
        </>
      )
    }

    // 房间外壳材质：整屋视图实心；聚焦房间透明以便查看内部；其他房间聚焦时虚化
    const isCorridor = isCorridorName(node.name)
    const baseColor = isCorridor
      ? colorMode === 'colorblind'
        ? CORRIDOR_COLORBLIND
        : CORRIDOR_COLOR
      : roomColor(siblingIndex, colorMode)
    let material: ShellMaterial
    if (isFocusedRoom) {
      material = { color: baseColor, transparent: true, opacity: 0.1, depthWrite: false, wireframe: wireframeEnabled }
    } else if (ghosted) {
      material = { color: '#2f3542', transparent: true, opacity: 0.18, depthWrite: false, wireframe: wireframeEnabled }
    } else {
      material = { color: baseColor, transparent: false, opacity: 1, depthWrite: true, wireframe: wireframeEnabled }
    }

    const plan = wallPlan?.get(node.id) ?? defaultWallPlan(node)

    return (
      <group onClick={handleClick}>
        <RoomShell room={node} material={material} isSelected={isSelected} plan={plan} />
        {node.children.map((child, i) => (
          <ModelNodeView
            key={child.id}
            node={child}
            siblingIndex={i}
            ancestors={childAncestors}
            wallPlan={wallPlan}
          />
        ))}
      </group>
    )
  }

  // 家具 / 墙体：实体 vs 虚化两种状态（y 抬升一个地板厚度，使其立在地板顶面）
  const fill = colorMode === 'colorblind' ? FURNITURE_COLORBLIND : FURNITURE_COLOR
  return (
    <mesh
      position={[node.position.x, node.position.y + FLOOR_THICKNESS, node.position.z]}
      onClick={handleClick}
    >
      <boxGeometry args={[node.dimensions.length, node.dimensions.height, node.dimensions.width]} />
      <meshStandardMaterial
        color={fill}
        transparent={ghosted}
        opacity={ghosted ? 0.2 : 1}
        wireframe={wireframeEnabled}
      />
      {(isSelected || !ghosted) && <Edges color={isSelected ? '#ffd93d' : '#8a93a5'} />}
    </mesh>
  )
}
