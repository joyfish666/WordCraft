import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
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
 */
export function PlanRig({ controlsRef }: PlanRigProps) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const scene = useModelStore((s) => s.scene)

  useEffect(() => {
    const controls = controlsRef.current
    const ortho = camera as OrthographicCamera
    if (!controls || !ortho.isOrthographicCamera) return
    const spec = computePlanCamera(scene ? houseBounds(scene) : null, size)
    camera.up.set(0, 0, 1)
    camera.position.set(spec.position[0], spec.position[1], spec.position[2])
    controls.target.set(spec.target[0], spec.target[1], spec.target[2])
    camera.zoom = spec.zoom
    camera.updateProjectionMatrix()
    controls.update()
    controls.saveState()
  }, [camera, size, scene, controlsRef])

  return null
}
