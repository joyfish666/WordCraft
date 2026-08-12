import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { OrthographicCamera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { computePlanCamera, houseBounds } from '../../lib/planGeometry'
import { useModelStore } from '../../store/useModelStore'

interface PlanRigProps {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
}

/**
 * 2D 俯视取景：正交相机挂载后（或场景 / 视口变化时）自动取景整屋包围盒，
 * 并把本次取景记为 OrbitControls 的「复位视角」基准。
 * 正北（世界 +Z）朝上：camera.up = (0,0,1) + lookAt(整屋中心)。
 * 注意：effect 依赖取景几何的原始数值而非 scene 引用——拖拽预览每帧产生新 scene
 * 引用但包围盒不变，若依赖 scene 会每帧重取景并 saveState，视图持续跳变（坑 73）。
 */
export function PlanRig({ controlsRef }: PlanRigProps) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const scene = useModelStore((s) => s.scene)

  const bounds = useMemo(() => (scene ? houseBounds(scene) : null), [scene])
  // 取景几何的原始数值作依赖：包围盒不变（如拖拽平移房间）时 spec 引用不变，
  // effect 不重跑——否则拖拽预览每帧新 scene 引用会导致每帧重取景并 saveState，
  // 视图持续跳变（坑 73）
  const minX = bounds?.minX
  const maxX = bounds?.maxX
  const minZ = bounds?.minZ
  const maxZ = bounds?.maxZ
  const centerX = bounds?.centerX
  const centerZ = bounds?.centerZ
  const width = bounds?.width
  const height = bounds?.height
  const spec = useMemo(() => {
    if (
      minX === undefined ||
      maxX === undefined ||
      minZ === undefined ||
      maxZ === undefined ||
      centerX === undefined ||
      centerZ === undefined ||
      width === undefined ||
      height === undefined
    ) {
      return null
    }
    return computePlanCamera({ minX, maxX, minZ, maxZ, centerX, centerZ, width, height }, size)
  }, [minX, maxX, minZ, maxZ, centerX, centerZ, width, height, size])

  useEffect(() => {
    const controls = controlsRef.current
    const ortho = camera as OrthographicCamera
    if (!controls || !ortho.isOrthographicCamera || !spec) return
    camera.up.set(0, 0, 1)
    camera.position.set(spec.position[0], spec.position[1], spec.position[2])
    controls.target.set(spec.target[0], spec.target[1], spec.target[2])
    camera.zoom = spec.zoom
    camera.updateProjectionMatrix()
    controls.update()
    controls.saveState()
  }, [camera, spec, controlsRef])

  return null
}
