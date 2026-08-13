import { useMemo } from 'react'
import { computeAllWallPlansCached, type WallPlan } from '../../lib/roomGeometry'
import { useModelStore } from '../../store/useModelStore'
import type { SceneModel } from '../../types/model'
import { GroundView } from './GroundView'
import { ModelNodeView } from './ModelNodeView'

/** 入口方向（默认南侧/地图下方）；入户门开在入口房间该方向的外墙（setHouse.entranceDir 可改） */
function entranceDirection(house: SceneModel['root']): 'north' | 'south' | 'east' | 'west' {
  return house.entranceDir ?? 'south'
}

/** 3D 场景内容：网格、坐标轴与当前模型（含共享墙去重、门洞计算与嵌套房间分隔墙） */
export function Viewport3D({ planMode = false }: { planMode?: boolean }) {
  const scene = useModelStore((s) => s.scene)
  // 截图瞬间隐藏辅助元素（网格/坐标轴），只保留纯净模型
  const screenshotMode = useModelStore((s) => s.screenshotMode)

  // 计算整屋所有房间（含嵌套）的墙体方案：共享墙去重、开放空间不设墙、入口方向外墙入户门；
  // 嵌套子房间（如卧室内卫生间）由其分割墙方案独立渲染，与父墙共线处不再重复渲染。
  // 走共享缓存（坑 72）：与 PlanEnhancements / PlanEditLayer 同场景引用只算一次。
  const wallPlan = useMemo(() => {
    if (!scene) return new Map<string, WallPlan>()
    const house = scene.root as SceneModel['root']
    return computeAllWallPlansCached(scene, entranceDirection(house), house.entranceRoomId)
  }, [scene])

  return (
    <>
      {/* 平面图模式平色背景；3D 视图由 Sky + 雾构成天空（SceneViewer） */}
      {planMode && <color attach="background" args={['#d6cfbf']} />}
      {/* 网格放地面平面下方（地面存在时被覆盖；空场景时仍可见） */}
      {!screenshotMode && (
        <gridHelper position={[0, -0.03, 0]} args={[20, 20, '#a9a290', '#c8c1ac']} />
      )}
      {!screenshotMode && <axesHelper args={[5]} />}
      {scene && <ModelNodeView node={scene.root} wallPlan={wallPlan} planMode={planMode} />}
      {scene && <GroundView planMode={planMode} wallPlan={wallPlan} />}
    </>
  )
}
