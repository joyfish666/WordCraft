import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Viewport3D } from './Viewport3D'

/** R3F 场景容器：相机、灯光与视角控制 */
export function SceneViewer() {
  return (
    <Canvas
      className="scene-canvas"
      camera={{ position: [8, 7, 8], fov: 50 }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[6, 10, 6]} intensity={0.9} />
      <Viewport3D />
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  )
}
