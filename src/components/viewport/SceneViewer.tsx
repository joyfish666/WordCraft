import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useModelStore } from '../../store/useModelStore'
import { Viewport3D } from './Viewport3D'

export interface SceneViewerHandle {
  /** 复位视角：恢复初始相机位置 */
  resetView: () => void
}

/** R3F 场景容器：相机、灯光、视角控制与空白点击清理 */
export const SceneViewer = forwardRef<SceneViewerHandle, object>(function SceneViewer(_props, ref) {
  const controlsRef = useRef<OrbitControlsImpl>(null)

  useImperativeHandle(ref, () => ({
    resetView: () => controlsRef.current?.reset(),
  }))

  return (
    <Canvas
      className="scene-canvas"
      camera={{ position: [8, 7, 8], fov: 50 }}
      dpr={[1, 2]}
      onPointerMissed={() => {
        useModelStore.getState().selectNode(null)
        useModelStore.getState().setFocus(null)
      }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[6, 10, 6]} intensity={0.9} />
      <Viewport3D />
      <OrbitControls ref={controlsRef} makeDefault enableDamping />
    </Canvas>
  )
})
