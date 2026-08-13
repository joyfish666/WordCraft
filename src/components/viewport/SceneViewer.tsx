import { OrbitControls, OrthographicCamera } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { PerspectiveCamera, Vector3 } from 'three'
import type * as THREE from 'three'
import type { OrthographicCamera as OrthographicCameraImpl } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useModelStore } from '../../store/useModelStore'
import { CornerCompassRose, CornerCompassSensor, WorldCompass } from './Compass'
import { GizmoControls } from './GizmoControls'
import { PlanAnnotations } from './PlanAnnotations'
import { PlanEditLayer } from './PlanEditLayer'
import { PlanEnhancements } from './PlanEnhancements'
import { PlanRig } from './PlanRig'
import { Viewport3D } from './Viewport3D'

/** Canvas 内桥接：把 R3F renderer 存入父级 ref，供 captureScreenshot 读取 */
function ScreenshotBridge({ glRef }: { glRef: MutableRefObject<THREE.WebGLRenderer | null> }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    glRef.current = gl
  }, [gl, glRef])
  return null
}

export interface SceneViewerHandle {
  /** 复位视角：恢复初始相机位置 */
  resetView: () => void
  /**
   * 平移视角。约定：dx 为正 → 视角内容右移，dy 为正 → 视角内容上移。
   * （即按方向键/按钮时，场景随箭头方向移动）
   */
  pan: (dx: number, dy: number) => void
  /**
   * 截图当前视角：隐藏辅助元素（网格/选中框/手柄/标注）后生成 PNG dataURL；
   * 无 WebGL 环境（如测试）或失败时返回 null。
   */
  captureScreenshot: () => Promise<string | null>
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
  const glRef = useRef<THREE.WebGLRenderer | null>(null)
  const planGroupRef = useRef<THREE.Group>(null)

  useImperativeHandle(ref, () => ({
    resetView: () => controlsRef.current?.reset(),

    captureScreenshot: () =>
      new Promise<string | null>((resolve) => {
        const gl = glRef.current
        if (!gl) {
          resolve(null)
          return
        }
        // 场景净化：隐藏网格/选中框/手柄/标注，等两帧让 React 应用隐藏后再读取绘制缓冲
        useModelStore.getState().setScreenshotMode(true)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            let url: string | null = null
            try {
              url = gl.domElement.toDataURL('image/png')
            } catch {
              url = null
            }
            useModelStore.getState().setScreenshotMode(false)
            resolve(url)
          })
        })
      }),

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
        const targetDistance =
          offset.length() * Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360)
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
        // 初始视角：房屋正南侧斜向下，完整看到南立面（含入户门）。
        // 世界 +x=东、+z=北 为左手系（坑 26），内容组整体沿 X 镜像后，
        // 从南侧朝北看呈现「上北下南、左西右东」——与平面图（标准地图）一致。
        camera={{ position: [0, 9, -10], fov: 50 }}
        dpr={[1, 2]}
        // preserveDrawingBuffer：截图 toDataURL 需要读取绘制缓冲（antialias 默认已开）
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        onPointerMissed={() => {
          useModelStore.getState().selectNode(null)
          useModelStore.getState().setFocus(null)
        }}
      >
        {planMode && (
          <OrthographicCamera
            makeDefault
            near={1}
            far={300}
            zoom={20}
            position={[0, 60, 0]}
            up={[0, 0, 1]}
          />
        )}
        <ambientLight intensity={0.7} />
        <directionalLight position={[6, 10, 6]} intensity={0.9} />
        <ScreenshotBridge glRef={glRef} />
        {/* 世界坐标 +x=东、+z=北 是左手系（坑 26），内容整体沿 X 镜像：
            3D 与 2D 平面图一致呈现「上北下南、左西右东」（标准地图方向）——
            南视角正对入户门时东在右侧、北在远处上方。P4 编辑层在镜像组内渲染：
            指针世界坐标经 group.worldToLocal 还原为足迹坐标。 */}
        <group ref={planGroupRef} scale={[-1, 1, 1]}>
          <Viewport3D planMode={planMode} />
          {planMode && <PlanAnnotations />}
          {/* 平面图增强：家具足迹 + 门窗符号 + 房间尺寸线 */}
          {planMode && <PlanEnhancements />}
          {/* P4 平面图自由编辑交互层（选择/移动/顶点/门窗/拆房/合并） */}
          {planMode && <PlanEditLayer groupRef={planGroupRef} />}
          {/* 世界锚定罗盘（在镜像组内：任意视图方向均正确） */}
          <WorldCompass />
        </group>
        {/* Gizmo 渲染在镜像组之外（避免手柄方向/拖拽随镜像反转），
            代理坐标与读写处做 x 取反与镜像内容对齐（见 GizmoControls） */}
        <GizmoControls planMode={planMode} />
        {planMode && <PlanRig controlsRef={controlsRef} />}
        <CornerCompassSensor compassRef={compassRef} />
        <OrbitControls
          key={planMode ? 'ortho' : 'persp'}
          ref={controlsRef}
          makeDefault
          enableDamping
          enableRotate={!planMode}
        />
      </Canvas>
      {/* 右上角罗盘（覆盖层）：与世界锚定罗盘共存，随相机实时指示屏幕方向 */}
      <CornerCompassRose ref={compassRef} />
    </>
  )
})
