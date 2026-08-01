import { Edges } from '@react-three/drei'
import { isContainer } from '../../lib/modelTree'
import { FURNITURE_COLOR, FURNITURE_COLORBLIND, roomColor } from '../../lib/palette'
import { useModelStore } from '../../store/useModelStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { ModelNode } from '../../types/model'

interface ModelNodeViewProps {
  node: ModelNode
  /** 兄弟容器索引，用于分配不同房间色 */
  siblingIndex?: number
  /** 祖先节点 id，用于判断是否位于聚焦房间内 */
  ancestors?: string[]
}

/**
 * 递归渲染层级模型。
 * - 整屋视图：房间为半透明色块，家具为实体
 * - 聚焦视图（focusId 指向某房间）：该房间取消体积盒仅留地板轮廓，内部家具实体化；
 *   其他房间及其家具虚化（低透明度），避免视觉遮挡与信息干扰
 */
export function ModelNodeView({ node, siblingIndex = 0, ancestors = [] }: ModelNodeViewProps) {
  const selectNode = useModelStore((s) => s.selectNode)
  const setFocus = useModelStore((s) => s.setFocus)
  const selectedId = useModelStore((s) => s.selectedId)
  const focusId = useModelStore((s) => s.focusId)
  const colorMode = useSettingsStore((s) => s.colorMode)
  const wireframeEnabled = useSettingsStore((s) => s.wireframe.enabled)

  const isSelected = node.id === selectedId
  const isFocusedRoom = focusId === node.id
  const inFocusedRoom = focusId !== null && ancestors.includes(focusId)
  // 聚焦状态下，不在聚焦房间内的模块全部虚化
  const ghosted = focusId !== null && !isFocusedRoom && !inFocusedRoom

  const edgeColor = isSelected ? '#ffd93d' : ghosted ? '#565d6d' : '#8a93a5'
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
      // 整屋：薄底板（聚焦时虚化）+ 子房间
      return (
        <>
          <mesh
            onClick={() => {
              selectNode(null)
              setFocus(null)
            }}
          >
            <boxGeometry args={[node.dimensions.length, 0.05, node.dimensions.width]} />
            <meshStandardMaterial
              color={edgeColor}
              transparent
              opacity={ghosted ? 0.05 : 0.12}
              depthWrite={false}
            />
          </mesh>
          {node.children.map((child, i) => (
            <ModelNodeView key={child.id} node={child} siblingIndex={i} ancestors={childAncestors} />
          ))}
        </>
      )
    }

    // 聚焦房间：隐藏体积盒，仅渲染地板轮廓，让内部家具清晰可见（无遮挡线条）
    if (isFocusedRoom) {
      return (
        <>
          <mesh position={[node.position.x, 0, node.position.z]}>
            <boxGeometry args={[node.dimensions.length, 0.03, node.dimensions.width]} />
            <meshStandardMaterial
              color={edgeColor}
              transparent
              opacity={isSelected ? 0.4 : 0.15}
              depthWrite={false}
            />
          </mesh>
          {node.children.map((child, i) => (
            <ModelNodeView key={child.id} node={child} siblingIndex={i} ancestors={childAncestors} />
          ))}
        </>
      )
    }

    // 普通/虚化房间
    const fill = roomColor(siblingIndex, colorMode)
    const opacity = ghosted ? 0.08 : isSelected ? 0.4 : 0.22
    return (
      <>
        <mesh
          position={[node.position.x, node.position.y, node.position.z]}
          onClick={handleClick}
        >
          <boxGeometry
            args={[node.dimensions.length, node.dimensions.height, node.dimensions.width]}
          />
          <meshStandardMaterial
            color={fill}
            transparent
            opacity={opacity}
            depthWrite={false}
            wireframe={wireframeEnabled}
          />
          <Edges color={edgeColor} />
        </mesh>
        {node.children.map((child, i) => (
          <ModelNodeView key={child.id} node={child} siblingIndex={i} ancestors={childAncestors} />
        ))}
      </>
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
      {(isSelected || !ghosted) && <Edges color={edgeColor} />}
    </mesh>
  )
}
