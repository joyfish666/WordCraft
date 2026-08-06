import { Edges } from '@react-three/drei'
import { isContainer } from '../../lib/modelTree'
import {
  ENTRANCE_DOOR_COLOR,
  ENTRANCE_MARKER_COLOR,
  FURNITURE_COLOR,
  FURNITURE_COLORBLIND,
  roomFaceColor,
} from '../../lib/palette'
import {
  DOOR_WIDTH,
  WALL_THICKNESS,
  defaultWallPlan,
  nestedDoorDirection,
  wallPlanWithDoor,
  type WallPlan,
  type WallSegmentKind,
} from '../../lib/roomGeometry'
import { useModelStore } from '../../store/useModelStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { ContainerNode, ModelNode, Position } from '../../types/model'

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
 */
function WallSegmentBox({ from, to, height, thickness, kind, entrance, material }: WallSegmentBoxProps) {
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

interface RoomShellProps {
  room: ContainerNode
  material: ShellMaterial
  isSelected: boolean
  plan: WallPlan
  /** 是否为嵌套在父房间内部的子房间（如卧室内卫生间）：地板略微抬高避免与父地板重叠 */
  nested?: boolean
  /** 截图净化：隐藏选中轮廓等辅助元素 */
  screenshotMode?: boolean
}

/** 房间外壳：实体地板 + 分段实心墙（共享/开放/门洞按段处理），外墙始终保留 */
function RoomShell({ room, material, isSelected, plan, nested = false, screenshotMode = false }: RoomShellProps) {
  const { length: L, width: W, height: H } = room.dimensions
  const cx = room.position.x
  const cz = room.position.z
  const baseY = room.position.y - H / 2
  const wallBaseY = baseY + FLOOR_THICKNESS
  const floorLift = nested ? 0.012 : 0

  // 地板：非共享边外扩一个墙厚；共享边到边界（邻居地板接续）
  const xmin = plan.west.shared ? cx - L / 2 : cx - L / 2 - WALL_THICKNESS
  const xmax = plan.east.shared ? cx + L / 2 : cx + L / 2 + WALL_THICKNESS
  const zmin = plan.south.shared ? cz - W / 2 : cz - W / 2 - WALL_THICKNESS
  const zmax = plan.north.shared ? cz + W / 2 : cz + W / 2 + WALL_THICKNESS

  const wall = (
    dir: keyof WallPlan,
    position: [number, number, number],
    rotation: [number, number, number],
  ) => (
    <group position={position} rotation={rotation}>
      {plan[dir].segments.map((seg, i) => (
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

  return (
    <>
      {/* 实体地板（嵌套子房间的地板略微抬高，避免与父地板重叠闪烁） */}
      <mesh position={[(xmin + xmax) / 2, baseY + FLOOR_THICKNESS / 2 + floorLift, (zmin + zmax) / 2]}>
        <boxGeometry args={[xmax - xmin, FLOOR_THICKNESS, zmax - zmin]} />
        <meshStandardMaterial {...material} />
      </mesh>

      {/* 四面墙：按分段渲染（开放段留空、共享段按持有方渲染） */}
      {wall('north', [cx, wallBaseY, cz + W / 2], [0, 0, 0])}
      {wall('south', [cx, wallBaseY, cz - W / 2], [0, 0, 0])}
      {/* 东/西墙用 -90° 旋转：使墙段局部坐标方向与 wallInfo 一致（否则镜像导致外墙段错位） */}
      {wall('east', [cx + L / 2, wallBaseY, cz], [0, -Math.PI / 2, 0])}
      {wall('west', [cx - L / 2, wallBaseY, cz], [0, -Math.PI / 2, 0])}

      {/* 选中轮廓（不参与射线检测：否则会挡在房间内部件上方，使部件点不到） */}
      {isSelected && !screenshotMode && (
        <mesh raycast={() => null} position={[cx, baseY + (FLOOR_THICKNESS + H) / 2, cz]}>
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
  /** 各房间的分段墙体方案 */
  wallPlan?: Map<string, WallPlan>
  /** 父房间中心（嵌套房间据此决定门朝向父房间内部） */
  parentCenter?: Position
}

/**
 * 递归渲染层级模型。
 * - 整屋视图：房间为实心墙体+地板（分段），门与墙同高，开放空间连通，外墙完整
 * - 聚焦视图（focusId 指向某房间）：该房间外壳透明化以便查看内部实体家具，
 *   其他房间外壳虚化；家具仍遵循 实体/虚化 两态
 */
export function ModelNodeView({
  node,
  siblingIndex = 0,
  ancestors = [],
  wallPlan,
  parentCenter,
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
      return (
        <>
          {/* 房屋线框盒仅作视觉轮廓，不参与射线检测：
              否则它横跨整屋且最高，每次点击部件/房间都会先命中它（先 deselect、清空聚焦）。
              空白处点击由 Canvas onPointerMissed 兜底取消选中。 */}
          {!screenshotMode && (
            <mesh
              raycast={() => null}
              position={[0, node.dimensions.height / 2, 0]}
            >
              <boxGeometry
                args={[node.dimensions.length, node.dimensions.height, node.dimensions.width]}
              />
              <meshBasicMaterial color="#8a93a5" wireframe transparent opacity={0.12} />
            </mesh>
          )}
          {node.children.map((child, i) => (
            <ModelNodeView
              key={child.id}
              node={child}
              siblingIndex={i}
              ancestors={childAncestors}
              wallPlan={wallPlan}
              parentCenter={node.position}
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
      material = { color: baseColor, transparent: true, opacity: 0.1, depthWrite: false, wireframe: wireframeEnabled }
    } else if (ghosted) {
      material = { color: '#2f3542', transparent: true, opacity: 0.18, depthWrite: false, wireframe: wireframeEnabled }
    } else {
      material = { color: baseColor, transparent: false, opacity: 1, depthWrite: true, wireframe: wireframeEnabled }
    }

    const isNestedRoom = ancestors.length > 1
    // 嵌套房间：门朝向父房间中心（从父房间进嵌套房间）；顶层房间用共享墙方案或兜底
    const plan =
      wallPlan?.get(node.id) ??
      (isNestedRoom && parentCenter ? wallPlanWithDoor(node, nestedDoorDirection(node, parentCenter)) : defaultWallPlan(node))

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
        {node.children.map((child, i) => (
          <ModelNodeView
            key={child.id}
            node={child}
            siblingIndex={i}
            ancestors={childAncestors}
            wallPlan={wallPlan}
            parentCenter={node.position}
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
      onClick={(e) => {
        // 停止冒泡：选中部件而非冒泡到父房间
        e.stopPropagation()
        handleClick()
      }}
    >
      <boxGeometry args={[node.dimensions.length, node.dimensions.height, node.dimensions.width]} />
      <meshStandardMaterial
        color={fill}
        transparent={ghosted}
        opacity={ghosted ? 0.2 : 1}
        wireframe={wireframeEnabled}
      />
      {!screenshotMode && (isSelected || !ghosted) && <Edges color={isSelected ? '#ffd93d' : '#8a93a5'} />}
    </mesh>
  )
}
