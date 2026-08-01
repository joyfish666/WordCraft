import { Edges } from '@react-three/drei'
import { FURNITURE_COLOR, FURNITURE_COLORBLIND, roomColor } from '../../lib/palette'
import { isContainer } from '../../lib/modelTree'
import { useModelStore } from '../../store/useModelStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { ModelNode } from '../../types/model'

interface ModelNodeViewProps {
  node: ModelNode
  /** 兄弟容器索引，用于分配不同房间色 */
  siblingIndex?: number
}

/** 递归渲染层级模型：容器 → 半透明色块，家具 → 实体色块 */
export function ModelNodeView({ node, siblingIndex = 0 }: ModelNodeViewProps) {
  const selectNode = useModelStore((s) => s.selectNode)
  const selectedId = useModelStore((s) => s.selectedId)
  const colorMode = useSettingsStore((s) => s.colorMode)
  const wireframeEnabled = useSettingsStore((s) => s.wireframe.enabled)

  const isSelected = node.id === selectedId
  const edgeColor = isSelected ? '#ffd93d' : '#8a93a5'
  const handleSelect = () => selectNode(node.id)

  if (isContainer(node)) {
    // 整屋：渲染薄底板 + 子模块（房间）
    if (node.type === 'house') {
      return (
        <>
          <mesh>
            <boxGeometry args={[node.dimensions.length, 0.05, node.dimensions.width]} />
            <meshStandardMaterial color={edgeColor} transparent opacity={0.12} depthWrite={false} />
          </mesh>
          {node.children.map((child, i) => (
            <ModelNodeView key={child.id} node={child} siblingIndex={i} />
          ))}
        </>
      )
    }

    const fill = roomColor(siblingIndex, colorMode)
    return (
      <>
        <mesh
          position={[node.position.x, node.position.y, node.position.z]}
          onClick={handleSelect}
        >
          <boxGeometry
            args={[node.dimensions.length, node.dimensions.height, node.dimensions.width]}
          />
          <meshStandardMaterial
            color={fill}
            transparent
            opacity={isSelected ? 0.4 : 0.22}
            depthWrite={false}
            wireframe={wireframeEnabled}
          />
          <Edges color={edgeColor} />
        </mesh>
        {node.children.map((child, i) => (
          <ModelNodeView key={child.id} node={child} siblingIndex={i} />
        ))}
      </>
    )
  }

  const fill = colorMode === 'colorblind' ? FURNITURE_COLORBLIND : FURNITURE_COLOR
  return (
    <mesh
      position={[node.position.x, node.position.y, node.position.z]}
      onClick={handleSelect}
    >
      <boxGeometry args={[node.dimensions.length, node.dimensions.height, node.dimensions.width]} />
      <meshStandardMaterial color={fill} wireframe={wireframeEnabled} />
      {isSelected && <Edges color={edgeColor} />}
    </mesh>
  )
}
