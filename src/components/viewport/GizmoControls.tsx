import { TransformControls } from '@react-three/drei'
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { getSelectedNode, useModelStore } from '../../store/useModelStore'
import type { Dimensions, ModelNode, SceneModel } from '../../types/model'
import { FLOOR_THICKNESS } from './ModelNodeView'

/** 是否为可 Gizmo 编辑的实体（家具/墙体）：代理 y 需折算地板厚度；房间直接用其自身中心 */
function isFurnitureLike(n: ModelNode): boolean {
  return n.type === 'furniture' || n.type === 'wall'
}

interface GizmoControlsProps {
  /** 2D 平面图模式：不显示 Gizmo（正交俯视拖拽 Y 无意义） */
  planMode?: boolean
}

interface DragBase {
  baseScene: SceneModel | null
  dims: Dimensions | null
  isMesh: boolean
}

/**
 * Gizmo 辅助编辑（TransformControls，drei）：
 * - 用**代理 group** 作为受控对象，避免与 R3F 对 mesh `position` prop 的管理冲突；
 * - 家具/墙体代理中心抬一个地板厚度（与 ModelNodeView 的 mesh 一致），房间用其自身中心；
 * - 拖拽中 `previewSelected` 实时预览（不记历史、不约束），结束时 `commitDrag` 记一次历史并约束进墙内；
 * - drei 内部监听 `dragging-changed` 自动禁用 OrbitControls，无需手动处理。
 */
export function GizmoControls({ planMode = false }: GizmoControlsProps) {
  const scene = useModelStore((s) => s.scene)
  const selectedId = useModelStore((s) => s.selectedId)
  const gizmoMode = useModelStore((s) => s.gizmoMode)
  const screenshotMode = useModelStore((s) => s.screenshotMode)
  const previewSelected = useModelStore((s) => s.previewSelected)
  const commitDrag = useModelStore((s) => s.commitDrag)

  const proxyRef = useRef<THREE.Group>(null)
  const baseRef = useRef<DragBase>({ baseScene: null, dims: null, isMesh: false })
  const isDraggingRef = useRef(false)

  const selected = scene && selectedId ? getSelectedNode(scene, selectedId) : null

  // 未拖拽时把代理同步到选中节点的当前坐标（选择切换 / 外部编辑 / 撤销后跟随）；
  // 拖拽中由 TransformControls 直接驱动，跳过同步避免互相覆盖。
  useEffect(() => {
    if (isDraggingRef.current) return
    const g = proxyRef.current
    if (!g || !selected) return
    const isMesh = isFurnitureLike(selected)
    g.position.set(
      selected.position.x,
      selected.position.y + (isMesh ? FLOOR_THICKNESS : 0),
      selected.position.z,
    )
    g.scale.set(1, 1, 1)
  }, [selectedId, gizmoMode, selected])

  if (planMode || screenshotMode || !selected || selected.type === 'house') return null

  const handleMouseDown = () => {
    isDraggingRef.current = true
    const state = useModelStore.getState()
    baseRef.current = {
      baseScene: state.scene,
      dims: selected ? { ...selected.dimensions } : null,
      isMesh: isFurnitureLike(selected),
    }
  }

  const handleObjectChange = () => {
    const g = proxyRef.current
    const base = baseRef.current
    if (!g || !base) return
    if (gizmoMode === 'translate') {
      // 代理 y 抬了地板厚度，写回节点时还原
      previewSelected({
        position: {
          x: g.position.x,
          y: g.position.y - (base.isMesh ? FLOOR_THICKNESS : 0),
          z: g.position.z,
        },
      })
    } else if (base.dims) {
      // 缩放 = 拖拽开始时的基准尺寸 × 代理 scale（各轴独立，下限 0.1 对齐属性面板）
      const s = g.scale
      previewSelected({
        dimensions: {
          length: Math.max(0.1, base.dims.length * s.x),
          height: Math.max(0.1, base.dims.height * s.y),
          width: Math.max(0.1, base.dims.width * s.z),
        },
      })
    }
  }

  const handleMouseUp = () => {
    isDraggingRef.current = false
    commitDrag(baseRef.current.baseScene)
  }

  return (
    <>
      <group ref={proxyRef} />
      <TransformControls
        object={proxyRef as unknown as MutableRefObject<THREE.Object3D>}
        mode={gizmoMode}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onObjectChange={handleObjectChange}
      />
    </>
  )
}
