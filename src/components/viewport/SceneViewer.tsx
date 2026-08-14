import { OrbitControls, OrthographicCamera, Sky } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { flushSync } from 'react-dom'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { ACESFilmicToneMapping, PMREMGenerator, PerspectiveCamera, Vector3 } from 'three'
import type * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { OrthographicCamera as OrthographicCameraImpl } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { houseLevelsBounds } from '../../lib/footprint'
import { useModelStore } from '../../store/useModelStore'
import { useSettingsStore } from '../../store/useSettingsStore'
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

/**
 * 环境反射桥接：PMREMGenerator + RoomEnvironment（three 自带，零外部资源）
 * 写入 scene.environment，玻璃/金属材质获得可反射的内容。
 */
function EnvironmentBridge() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = env.texture
    scene.environmentIntensity = 0.4
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
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
  const screenshotSeqRef = useRef(0)
  const shadows = useSettingsStore((s) => s.shadows)
  const sceneModel = useModelStore((s) => s.scene)

  // 阴影贴图边界随房屋尺寸动态伸缩（过大浪费精度、过小截断阴影）。
  // 依赖取包围盒原始数值而非 scene 引用（坑 73 同款模式）：拖拽预览每帧产生新 scene
  // 但包围盒不变，bounds 对象保持稳定引用——否则 shadow-camera 四边 props 每帧换新值，
  // 方向光阴影相机每帧重算投影矩阵（拖拽热路径上的不必要重活）
  const houseB = sceneModel ? houseLevelsBounds(sceneModel.root) : null
  const shadowBounds = useMemo(() => {
    if (!houseB) return { left: -18, right: 18, top: 18, bottom: -18 }
    const half = Math.max(houseB.maxX - houseB.minX, houseB.maxZ - houseB.minZ) / 2 + 4
    return { left: -half, right: half, top: half, bottom: -half }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 数值依赖已覆盖 houseB 全部消费
  }, [houseB?.minX, houseB?.minZ, houseB?.maxX, houseB?.maxZ])

  useImperativeHandle(ref, () => ({
    resetView: () => controlsRef.current?.reset(),

    captureScreenshot: () =>
      new Promise<string | null>((resolve) => {
        const gl = glRef.current
        if (!gl) {
          resolve(null)
          return
        }
        const seq = ++screenshotSeqRef.current
        // 场景净化：隐藏网格/选中框/手柄/标注。用 flushSync 保证状态在读取绘制缓冲前
        // 已提交到 DOM——React 18 并发调度不保证「等两帧」内提交（主线程忙时可能延迟），
        // 只等 rAF 会截到带辅助元素的画面；两帧 rAF 留给 WebGL 帧循环绘制纯净画面。
        flushSync(() => {
          useModelStore.getState().setScreenshotMode(true)
        })
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            let url: string | null = null
            try {
              url = gl.domElement.toDataURL('image/png')
            } catch {
              url = null
            }
            // 竞态防护：快速连续触发两次截图时，先发请求的 rAF 链不得把后发请求的隐藏态
            // 复位（否则后发截图会截到已恢复的网格/选中框）；只有最新请求有权复位
            if (screenshotSeqRef.current === seq) {
              flushSync(() => {
                useModelStore.getState().setScreenshotMode(false)
              })
            }
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
        camera={{ position: [0, 9, -10], fov: 50, far: 10000 }}
        dpr={[1, 2]}
        // preserveDrawingBuffer：截图 toDataURL 需要读取绘制缓冲（antialias 默认已开）；
        // ACES 色调映射压住总光（ambient+hemi+dir ≈ 2.1），避免高光过曝；
        // shadows='soft'：PCFSoftShadowMap（设置开关关断时连 shadowMap 一起禁用）
        gl={{
          preserveDrawingBuffer: true,
          antialias: true,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        shadows={shadows ? 'soft' : false}
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
        {/* 程序化天空 + 地平线雾：雾色取淡绿白（坑 119 春天化，原暖白米黄让远景如冬日），地面边缘融进地平线（平面图模式保持纯净） */}
        {!planMode && (
          <>
            <Sky
              ref={(sky: (THREE.Mesh & { material: THREE.ShaderMaterial }) | null) => {
                if (sky?.material) sky.material.fog = false
              }}
              distance={3000}
              sunPosition={[6, 10, 6]}
              turbidity={5}
              rayleigh={1.8}
              mieCoefficient={0.003}
              mieDirectionalG={0.75}
            />
            <fog attach="fog" args={['#e7ecd9', 30, 120]} />
          </>
        )}
        <ambientLight intensity={0.35} />
        <hemisphereLight intensity={0.35} color="#f2f6ff" groundColor="#8d8570" />
        {/* 主光 + 实时阴影（设置可关；关闭时仅省阴影贴图开销） */}
        <directionalLight
          position={[6, 10, 6]}
          intensity={1.4}
          castShadow={shadows}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={shadowBounds.left}
          shadow-camera-right={shadowBounds.right}
          shadow-camera-top={shadowBounds.top}
          shadow-camera-bottom={shadowBounds.bottom}
          shadow-camera-near={1}
          shadow-camera-far={60}
          shadow-bias={-0.0004}
        />
        <ScreenshotBridge glRef={glRef} />
        <EnvironmentBridge />
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
