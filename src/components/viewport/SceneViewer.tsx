import { OrbitControls, OrthographicCamera } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { forwardRef, useImperativeHandle, useRef } from 'react'
import { PerspectiveCamera, Vector3 } from 'three'
import type { OrthographicCamera as OrthographicCameraImpl } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useModelStore } from '../../store/useModelStore'
import { CompassRose, CompassSensor } from './Compass'
import { PlanAnnotations } from './PlanAnnotations'
import { PlanRig } from './PlanRig'
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

interface SceneViewerProps {
  /** 2D 俯视平面图模式：正交俯视相机、禁旋转、显示标注；false 为常规 3D */
  planMode?: boolean
}

/**
 * R3F 场景容器：相机、灯光、视角控制与空白点击清理。
 * planMode 时切到正交俯视相机（drei OrthographicCamera makeDefault 自动替换 state.camera，
 * OrbitControls 用 key 强制重挂载以绑定新相机），并叠加平面图标注。
 */
export const SceneViewer = forwardRef<SceneViewerHandle, SceneViewerProps>(function SceneViewer(
  { planMode = false },
  ref,
) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const compassRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    resetView: () => controlsRef.current?.reset(),

    pan: (dx, dy) => {
      const controls = controlsRef.current
      if (!controls) return
      const camera = controls.object
      const element = controls.domElement
      const clientHeight = element?.clientHeight
      if (!clientHeight || clientHeight <= 0) return

      // 屏幕位移 → 世界位移。正交相机可见宽度 = 视口宽 / zoom（drei frustum 恒等于像素尺寸）；
      // 透视相机按距离与 fov 换算。
      let scale: number
      if ((camera as OrthographicCameraImpl).isOrthographicCamera) {
        scale = 1 / (camera as OrthographicCameraImpl).zoom
      } else {
        const offset = camera.position.clone().sub(controls.target)
        const targetDistance = offset.length() * Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360)
        scale = (2 * targetDistance) / clientHeight
      }

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
    <>
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
        {planMode && (
          <OrthographicCamera makeDefault near={1} far={300} zoom={20} position={[0, 60, 0]} up={[0, 0, 1]} />
        )}
        <ambientLight intensity={0.7} />
        <directionalLight position={[6, 10, 6]} intensity={0.9} />
        <Viewport3D />
        {planMode && <PlanAnnotations />}
        {planMode && <PlanRig controlsRef={controlsRef} />}
        <CompassSensor compassRef={compassRef} />
        <OrbitControls
          key={planMode ? 'ortho' : 'persp'}
          ref={controlsRef}
          makeDefault
          enableDamping
          enableRotate={!planMode}
        />
      </Canvas>
      {/* 实时东西南北罗盘（覆盖在视口右上角） */}
      <CompassRose ref={compassRef} />
    </>
  )
})
