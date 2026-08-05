import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { forwardRef, useImperativeHandle, useRef } from 'react'
import { PerspectiveCamera, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useModelStore } from '../../store/useModelStore'
import { Viewport3D } from './Viewport3D'

export interface SceneViewerHandle {
  /** 复位视角：恢复初始相机位置 */
  resetView: () => void
  /**
   * 平移视角。约定：dx 为正 → 视角内容右移，dy 为正 → 视角内容上移。
   * （即按方向键/按钮时，场景随箭头方向移动）
   */
  pan: (dx: number, dy: number) => void
}

/** R3F 场景容器：相机、灯光、视角控制与空白点击清理 */
export const SceneViewer = forwardRef<SceneViewerHandle, object>(function SceneViewer(_props, ref) {
  const controlsRef = useRef<OrbitControlsImpl>(null)

  useImperativeHandle(ref, () => ({
    resetView: () => controlsRef.current?.reset(),

    pan: (dx, dy) => {
      const controls = controlsRef.current
      if (!controls) return
      const camera = controls.object as PerspectiveCamera
      const element = controls.domElement
      const clientHeight = element?.clientHeight
      if (!clientHeight || clientHeight <= 0) return

      // 复刻 OrbitControls 的屏幕空间平移：屏幕位移 → 相机与 target 的世界位移
      const offset = camera.position.clone().sub(controls.target)
      const targetDistance = offset.length() * Math.tan((camera.fov * Math.PI) / 360)
      const scale = (2 * targetDistance) / clientHeight

      const right = new Vector3().setFromMatrixColumn(camera.matrix, 0)
      const up = new Vector3()
      if (controls.screenSpacePanning) {
        up.setFromMatrixColumn(camera.matrix, 1)
      } else {
        up.setFromMatrixColumn(camera.matrix, 0).crossVectors(camera.up, up)
      }

      const panOffset = new Vector3()
      panOffset.addScaledVector(right, -dx * scale)
      panOffset.addScaledVector(up, -dy * scale)

      controls.target.add(panOffset)
      camera.position.add(panOffset)
      controls.update()
    },
  }))

  return (
    <Canvas
      className="scene-canvas"
      // 初始视角：房屋正南侧斜向下，完整看到南立面（含入户门）
      camera={{ position: [0, 9, -10], fov: 50 }}
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
