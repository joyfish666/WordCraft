import { useMemo } from 'react'
import { walk } from '../../lib/modelTree'
import { computeWallPlan, type WallPlan } from '../../lib/roomGeometry'
import { useModelStore } from '../../store/useModelStore'
import type { ContainerNode } from '../../types/model'
import { ModelNodeView } from './ModelNodeView'

/** 3D 场景内容：网格、坐标轴与当前模型（含共享墙去重与门洞计算） */
export function Viewport3D() {
  const scene = useModelStore((s) => s.scene)

  // 计算各房间墙体方案：共享墙去重、门洞开在相邻墙、走廊默认色
  const wallPlan = useMemo(() => {
    if (!scene) return new Map<string, WallPlan>()
    const rooms: ContainerNode[] = []
    walk(scene.root, (n) => {
      if (n.type === 'room') rooms.push(n as ContainerNode)
    })
    return computeWallPlan(rooms)
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
