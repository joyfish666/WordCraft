import { Edges } from '@react-three/drei'
import { isContainer } from '../../lib/modelTree'
import { FURNITURE_COLOR, FURNITURE_COLORBLIND, roomColor } from '../../lib/palette'
import { DOOR_WIDTH, WALL_THICKNESS, doorDirection, type DoorDirection } from '../../lib/roomGeometry'
import { useModelStore } from '../../store/useModelStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { ContainerNode, ModelNode } from '../../types/model'

const FLOOR_THICKNESS = 0.05

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
  doorWalls: DoorDirection[]
}

/** 房间外壳：实心地板 + 四面实心墙，门洞开在与相邻房间/走廊共用的墙上 */
function RoomShell({ room, material, isSelected, doorWalls }: RoomShellProps) {
  const { length: L, width: W, height: H } = room.dimensions
  const cx = room.position.x
  const cz = room.position.z
  const baseY = room.position.y - H / 2
  const centerY = baseY + H / 2
  const dirs = new Set(doorWalls)

  return (
    <>
      {/* 实心地板 */}
      <mesh position={[cx, baseY + FLOOR_THICKNESS / 2, cz]}>
        <boxGeometry args={[L, FLOOR_THICKNESS, W]} />
        <meshStandardMaterial {...material} />
      </mesh>
      {/* 南北墙（沿 X） */}
      <group position={[cx, baseY, cz + W / 2]}>
        <WallSegments
          length={L}
          height={H}
          thickness={WALL_THICKNESS}
          hasDoor={dirs.has('north')}
          material={material}
        />
      </group>
      <group position={[cx, baseY, cz - W / 2]}>
        <WallSegments
          length={L}
          height={H}
          thickness={WALL_THICKNESS}
          hasDoor={dirs.has('south')}
          material={material}
        />
      </group>
      {/* 东西墙（绕 Y 旋转 90°，沿 Z） */}
      <group position={[cx + L / 2, baseY, cz]} rotation={[0, Math.PI / 2, 0]}>
        <WallSegments
          length={W}
          height={H}
          thickness={WALL_THICKNESS}
          hasDoor={dirs.has('east')}
          material={material}
        />
      </group>
      <group position={[cx - L / 2, baseY, cz]} rotation={[0, Math.PI / 2, 0]}>
        <WallSegments
          length={W}
          height={H}
          thickness={WALL_THICKNESS}
          hasDoor={dirs.has('west')}
          material={material}
        />
      </group>
      {/* 选中轮廓 */}
      {isSelected && (
        <mesh position={[cx, centerY, cz]}>
          <boxGeometry args={[L, H, W]} />
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
  /** 各房间的开门方向（由相邻房间/走廊计算得到） */
  doorWalls?: Map<string, DoorDirection[]>
}

/**
 * 递归渲染层级模型。
 * - 整屋视图：房间为实心墙体+地板（门与墙同高），家具被墙体遮挡
 * - 聚焦视图（focusId 指向某房间）：该房间外壳透明化以便查看内部实体家具，
 *   其他房间外壳虚化；家具仍遵循 实体/虚化 两态
 */
export function ModelNodeView({
  node,
  siblingIndex = 0,
  ancestors = [],
  doorWalls,
}: ModelNodeViewProps) {
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
      // 整屋：细线边界轮廓（可点击返回整屋）+ 子房间
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
              doorWalls={doorWalls}
            />
          ))}
        </>
      )
    }

    // 房间外壳材质：整屋视图实心；聚焦房间透明以便查看内部；其他房间聚焦时虚化
    const fill = roomColor(siblingIndex, colorMode)
    let material: ShellMaterial
    if (isFocusedRoom) {
      material = { color: fill, transparent: true, opacity: 0.1, depthWrite: false, wireframe: wireframeEnabled }
    } else if (ghosted) {
      material = { color: '#2f3542', transparent: true, opacity: 0.18, depthWrite: false, wireframe: wireframeEnabled }
    } else {
      material = { color: fill, transparent: false, opacity: 1, depthWrite: true, wireframe: wireframeEnabled }
    }

    // 开门方向：优先用相邻房间/走廊计算的结果；无相邻房间时兜底朝整屋中心
    const computed = doorWalls?.get(node.id)
    const wallDoors =
      computed && computed.length > 0 ? [...new Set(computed)] : [doorDirection(node)]

    return (
      <group onClick={handleClick}>
        <RoomShell room={node} material={material} isSelected={isSelected} doorWalls={wallDoors} />
        {node.children.map((child, i) => (
          <ModelNodeView
            key={child.id}
            node={child}
            siblingIndex={i}
            ancestors={childAncestors}
            doorWalls={doorWalls}
          />
        ))}
      </group>
    )
  }

  // 家具 / 墙体：实体 vs 虚化两种状态
  const fill = colorMode === 'colorblind' ? FURNITURE_COLORBLIND : FURNITURE_COLOR
  return (
    <mesh
      position={[node.position.x, node.position.y, node.position.z]}
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
