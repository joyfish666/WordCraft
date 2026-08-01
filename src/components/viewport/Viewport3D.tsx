import { useMemo } from 'react'
import { walk } from '../../lib/modelTree'
import { computeDoorWalls, type DoorDirection } from '../../lib/roomGeometry'
import { useModelStore } from '../../store/useModelStore'
import type { ContainerNode } from '../../types/model'
import { ModelNodeView } from './ModelNodeView'

/** 3D 场景内容：网格、坐标轴与当前模型（含房间相邻开门的计算） */
export function Viewport3D() {
  const scene = useModelStore((s) => s.scene)

  // 计算每个房间的开门方向：在共用墙上开向相邻房间/走廊
  const doorWalls = useMemo(() => {
    if (!scene) return new Map<string, DoorDirection[]>()
    const rooms: ContainerNode[] = []
    walk(scene.root, (n) => {
      if (n.type === 'room') rooms.push(n as ContainerNode)
    })
    return computeDoorWalls(rooms)
  }, [scene])

  return (
    <>
      <color attach="background" args={['#14161b']} />
      <gridHelper args={[20, 20, '#3a3f4b', '#272b34']} />
      <axesHelper args={[5]} />
      {scene && <ModelNodeView node={scene.root} doorWalls={doorWalls} />}
    </>
  )
}
