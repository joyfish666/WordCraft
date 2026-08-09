import { useMemo } from 'react'
import { computeAllWallPlans, type WallPlan } from '../../lib/roomGeometry'
import { useModelStore } from '../../store/useModelStore'
import type { RoomNode, SceneModel } from '../../types/model'
import { ModelNodeView } from './ModelNodeView'

/** 入口方向（默认南侧/地图下方）；入户门开在入口房间该方向的外墙（setHouse.entranceDir 可改） */
function entranceDirection(house: SceneModel['root']): 'north' | 'south' | 'east' | 'west' {
  return house.entranceDir ?? 'south'
}

/** 3D 场景内容：网格、坐标轴与当前模型（含共享墙去重、门洞计算与嵌套房间分隔墙） */
export function Viewport3D() {
  const scene = useModelStore((s) => s.scene)
  // 截图瞬间隐藏辅助元素（网格/坐标轴），只保留纯净模型
  const screenshotMode = useModelStore((s) => s.screenshotMode)

  // 计算整屋所有房间（含嵌套）的墙体方案：共享墙去重、开放空间不设墙、入口方向外墙入户门；
  // 嵌套子房间（如卧室内卫生间）由其分割墙方案独立渲染，与父墙共线处不再重复渲染。
  const wallPlan = useMemo(() => {
    if (!scene) return new Map<string, WallPlan>()
    const rooms: RoomNode[] = scene.root.levels[0]?.rooms ?? []
    const house = scene.root as SceneModel['root']
    return computeAllWallPlans(rooms, {
      entrance: entranceDirection(house),
      entranceRoomId: house.entranceRoomId,
    })
  }, [scene])

  return (
    <>
      <color attach="background" args={['#14161b']} />
      {!screenshotMode && <gridHelper args={[20, 20, '#3a3f4b', '#272b34']} />}
      {!screenshotMode && <axesHelper args={[5]} />}
      {scene && <ModelNodeView node={scene.root} wallPlan={wallPlan} />}
    </>
  )
}
