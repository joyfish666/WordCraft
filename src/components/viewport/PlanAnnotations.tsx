import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import { roomFaceColor } from '../../lib/palette'
import { dimensionLines, houseBounds, roomLabelText, walkRooms } from '../../lib/planGeometry'
import { useModelStore } from '../../store/useModelStore'
import { useSettingsStore } from '../../store/useSettingsStore'

/**
 * 2D 俯视平面图的标注层（仅 planMode 渲染）：
 * - 每个房间中心显示「名称 长×宽」标签，颜色与 3D 一致（roomFaceColor）；
 * - 整屋外廓显示尺寸线（总长/总宽），绘制在包围盒外、墙顶之上。
 */
export function PlanAnnotations() {
  const scene = useModelStore((s) => s.scene)
  const selectedId = useModelStore((s) => s.selectedId)
  const focusId = useModelStore((s) => s.focusId)
  const colorMode = useSettingsStore((s) => s.colorMode)

  // 标签/尺寸线高度：墙顶以上（墙高 = 整屋高度），避免被墙体遮挡
  const labelY = scene ? scene.root.dimensions.height + 1 : 4
  const bounds = useMemo(() => (scene ? houseBounds(scene) : null), [scene])
  const rooms = useMemo(() => (scene ? walkRooms(scene.root) : []), [scene])
  const dims = useMemo(
    () => (bounds ? dimensionLines(bounds, { y: labelY }) : []),
    [bounds, labelY],
  )

  if (!scene || !bounds) return null

  return (
    <>
      {rooms.map(({ node, siblingIndex, depth }) => {
        const color = roomFaceColor(node.name, siblingIndex, colorMode)
        const isActive = node.id === selectedId || node.id === focusId
        return (
          <Html
            key={node.id}
            position={[node.position.x, labelY, node.position.z]}
            center
            pointerEvents="none"
            zIndexRange={[9, 0]}
          >
            <div
              className={`plan-label ${depth > 1 ? 'plan-label--nested' : ''} ${
                isActive ? 'plan-label--active' : ''
              }`}
            >
              <span className="plan-label__chip" style={{ background: color }} />
              <span>{roomLabelText(node.name, node.dimensions)}</span>
            </div>
          </Html>
        )
      })}

      {dims.map((line, i) => {
        const dx = line.to[0] - line.from[0]
        const dz = line.to[2] - line.from[2]
        const len = Math.hypot(dx, dz)
        const horizontal = Math.abs(dx) >= Math.abs(dz)
        const mid: [number, number, number] = [
          (line.from[0] + line.to[0]) / 2,
          line.from[1],
          (line.from[2] + line.to[2]) / 2,
        ]
        // 标签沿外廓方向再外移，避免压在尺寸线上
        const labelPos: [number, number, number] = horizontal
          ? [mid[0], mid[1], mid[2] + (mid[2] >= bounds.centerZ ? 0.5 : -0.5)]
          : [mid[0] + (mid[0] >= bounds.centerX ? 0.5 : -0.5), mid[1], mid[2]]
        const tickA: [number, number, number] = [line.from[0], line.from[1], line.from[2]]
        const tickB: [number, number, number] = [line.to[0], line.to[1], line.to[2]]
        return (
          <group key={i}>
            {/* 尺寸线主体 */}
            <mesh position={mid}>
              <boxGeometry args={horizontal ? [len, 0.03, 0.03] : [0.03, 0.03, len]} />
              <meshBasicMaterial color="#ffd93d" />
            </mesh>
            {/* 端部刻度 */}
            <mesh position={tickA}>
              <boxGeometry args={horizontal ? [0.03, 0.03, 0.2] : [0.2, 0.03, 0.03]} />
              <meshBasicMaterial color="#ffd93d" />
            </mesh>
            <mesh position={tickB}>
              <boxGeometry args={horizontal ? [0.03, 0.03, 0.2] : [0.2, 0.03, 0.03]} />
              <meshBasicMaterial color="#ffd93d" />
            </mesh>
            {/* 尺寸文案 */}
            <Html position={labelPos} center pointerEvents="none" zIndexRange={[9, 0]}>
              <div className="plan-dim">{line.label}</div>
            </Html>
          </group>
        )
      })}
    </>
  )
}
