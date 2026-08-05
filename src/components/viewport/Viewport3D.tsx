import { useMemo } from 'react'
import { computeWallPlan, type WallPlan } from '../../lib/roomGeometry'
import { useModelStore } from '../../store/useModelStore'
import type { ContainerNode, SceneModel } from '../../types/model'
import { ModelNodeView } from './ModelNodeView'

/** 入口方向固定在南侧（地图下方，-Z）；入户门开在入口房间南墙 */
const ENTRANCE_DIRECTION = 'south' as const

/** 3D 场景内容：网格、坐标轴与当前模型（含共享墙去重与门洞计算） */
export function Viewport3D() {
  const scene = useModelStore((s) => s.scene)

  // 计算顶层房间墙体方案：共享墙去重、开放空间不设墙、南外墙入户门
  // （嵌套子房间如卧室内卫生间不在其中，渲染时使用 defaultWallPlan）
  const wallPlan = useMemo(() => {
    if (!scene) return new Map<string, WallPlan>()
    const rooms: ContainerNode[] = []
    for (const child of scene.root.children) {
      if (child.type === 'room') rooms.push(child as ContainerNode)
    }
    const house = scene.root as SceneModel['root']
    return computeWallPlan(rooms, {
      entrance: ENTRANCE_DIRECTION,
      entranceRoomId: house.entranceRoomId,
    })
  }, [scene])

  return (
    <>
      <color attach="background" args={['#14161b']} />
      <gridHelper args={[20, 20, '#3a3f4b', '#272b34']} />
      <axesHelper args={[5]} />
      {scene && <ModelNodeView node={scene.root} wallPlan={wallPlan} />}
    </>
  )
}
