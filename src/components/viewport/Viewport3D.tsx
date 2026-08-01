import { useModelStore } from '../../store/useModelStore'
import { ModelNodeView } from './ModelNodeView'

/** 3D 场景内容：网格、坐标轴与当前模型 */
export function Viewport3D() {
  const scene = useModelStore((s) => s.scene)

  return (
    <>
      <color attach="background" args={['#14161b']} />
      <gridHelper args={[20, 20, '#3a3f4b', '#272b34']} />
      <axesHelper args={[5]} />
      {scene && <ModelNodeView node={scene.root} />}
    </>
  )
}
