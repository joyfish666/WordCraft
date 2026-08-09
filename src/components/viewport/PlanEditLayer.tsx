import { Line } from '@react-three/drei'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plane, Raycaster, Vector3 } from 'three'
import type * as THREE from 'three'
import { t } from '../../i18n'
import { executeOps } from '../../lib/executor'
import { footprintCenter } from '../../lib/footprint'
import { findNodeById } from '../../lib/modelTree'
import {
  collectWallHitEdges,
  dragVertexFootprint,
  hitWallOnEdge,
  nearestFootprintVertex,
  pointInFootprint,
  snapRoomTranslation,
  snapToGrid,
  WINDOW_WIDTH,
  type WallHitEdge,
} from '../../lib/planEdit'
import { walkRooms, type RoomPlanInfo } from '../../lib/planGeometry'
import { DOOR_WIDTH } from '../../lib/roomGeometry'
import { useModelStore } from '../../store/useModelStore'
import type { Op } from '../../types/ops'
import type { Point2D, RoomNode, SceneModel } from '../../types/model'

/**
 * 平面图自由编辑交互层（design.md §6，P4）——仅 planMode + 非截图时渲染。
 * 全部命中/几何计算走 planEdit.ts 纯函数，编辑产出与对话同构的 op
 * （applyPlanOps / commitPlanEdit 记历史 + 追加编辑日志）。
 * 指针 → 足迹坐标换算：本层渲染在 SceneViewer 的镜像 group 内（平面图 x 镜像），
 * 射线在世界 y=0 平面取交点后经 group.worldToLocal 还原为足迹坐标。
 */

/** 指针捕获（R3F 捕获语义：捕获期间 move/up 事件持续路由到起始对象） */
function capturePointer(e: ThreeEvent<PointerEvent>): void {
  const target = e.target as Element | null
  if (!target) return
  try {
    target.setPointerCapture?.(e.pointerId)
  } catch {
    // 部分环境不支持捕获，静默降级
  }
}

interface DragState {
  kind: 'vertex' | 'move'
  roomId: string
  vertexIndex?: number
  /** 拖拽开始时的场景（撤销快照 + 编辑 op diff 基准） */
  baseScene: SceneModel
  /** 拖拽开始时的指针足迹坐标（move 用：位移 = 当前 - 起点） */
  startLocal: Point2D
  /** 拖拽开始时房间的中心（move 预览的位移基准，避免预览叠加漂移） */
  startCenter?: Point2D
  /** 拖拽开始时房间的足迹（move 吸附的几何基准） */
  footprint?: Point2D[]
}

interface SplitState {
  roomId: string
  start: Point2D
}

interface PlanEditLayerProps {
  /** 镜像 group 的引用：指针世界坐标 → 足迹坐标 */
  groupRef: React.RefObject<THREE.Group | null>
}

/** 取房间足迹的中心点（move 拖拽位移基准） */
function roomCenter2D(room: RoomNode): Point2D {
  const c = footprintCenter(room.footprint)
  return { x: c.x, z: c.z }
}

export function PlanEditLayer({ groupRef }: PlanEditLayerProps) {
  const scene = useModelStore((s) => s.scene)
  const selectedId = useModelStore((s) => s.selectedId)
  const planTool = useModelStore((s) => s.planTool)
  const openingKind = useModelStore((s) => s.openingKind)
  const screenshotMode = useModelStore((s) => s.screenshotMode)

  const camera = useThree((s) => s.camera)
  const pointer = useThree((s) => s.pointer)
  const raycasterRef = useRef<Raycaster | null>(null)
  const planeRef = useRef<Plane>(new Plane(new Vector3(0, 1, 0), 0))
  const localOutRef = useRef(new Vector3())

  const [drag, setDrag] = useState<DragState | null>(null)
  const [split, setSplit] = useState<SplitState | null>(null)
  const [splitCur, setSplitCur] = useState<Point2D | null>(null)
  const [mergeKeepId, setMergeKeepId] = useState<string | null>(null)

  // 整屋所有房间（含嵌套，子房间在前优先命中）
  const rooms = useMemo<RoomPlanInfo[]>(() => {
    if (!scene) return []
    return walkRooms(scene.root).reverse()
  }, [scene])

  // 与渲染同源的墙段（含足迹边下标与段种类），供点墙放门窗/开洞标记
  const wallEdges = useMemo<WallHitEdge[]>(() => {
    if (!scene) return []
    return collectWallHitEdges(scene, scene.root.entranceDir ?? 'south', scene.root.entranceRoomId)
  }, [scene])

  // 切换工具时清理进行中的手势：拖拽中的预览场景要提交（否则只改场景不记历史）
  useEffect(() => {
    if (planTool !== 'merge') setMergeKeepId(null)
    if (planTool !== 'split') {
      setSplit(null)
      setSplitCur(null)
    }
    if (planTool !== 'vertex' && planTool !== 'move' && drag) {
      const d = drag
      setDrag(null)
      useModelStore.getState().commitPlanEdit(d.baseScene, d.roomId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planTool])

  if (!scene || planTool === 'select' || screenshotMode) return null

  /** 指针 → 足迹坐标（网格未吸附的原始值） */
  const localPoint = (): Point2D | null => {
    const raycaster = raycasterRef.current ?? new Raycaster()
    raycasterRef.current = raycaster
    raycaster.setFromCamera(pointer, camera)
    const out = localOutRef.current
    if (!raycaster.ray.intersectPlane(planeRef.current, out)) return null
    const local = groupRef.current?.worldToLocal(out) ?? out
    return { x: local.x, z: local.z }
  }

  const roomAtPoint = (x: number, z: number): RoomPlanInfo | null =>
    rooms.find((r) => pointInFootprint(r.node.footprint, x, z)) ?? null

  /** 供「移动」工具预览用的其他房间足迹（不含自身） */
  const otherFootprints = (selfId: string): Point2D[][] =>
    rooms.filter((r) => r.node.id !== selfId).map((r) => r.node.footprint)

  /** 拖拽预览：只更新场景，不记历史（结束时 commit） */
  const previewDrag = (p: Point2D): void => {
    if (!drag) return
    const store = useModelStore.getState()
    if (drag.kind === 'move') {
      if (!drag.footprint || !drag.startCenter) return
      const raw = { dx: p.x - drag.startLocal.x, dz: p.z - drag.startLocal.z }
      const snapped = snapRoomTranslation(drag.footprint, otherFootprints(drag.roomId), raw.dx, raw.dz)
      store.previewSelected({
        position: {
          x: drag.startCenter.x + snapped.dx,
          z: drag.startCenter.z + snapped.dz,
        },
      })
    } else if (drag.vertexIndex !== undefined) {
      const room = findNodeById(store.scene!.root, drag.roomId) as RoomNode | null
      if (!room) return
      const next = dragVertexFootprint(room.footprint, drag.vertexIndex, p)
      if (next) store.previewFootprint(drag.roomId, next)
    }
  }

  const onPlaneDown = (e: ThreeEvent<PointerEvent>): void => {
    e.stopPropagation()
    // 指针捕获：拖拽期间 move/up 全部路由到本对象，指针悬停手柄/移出对象也不中断
    capturePointer(e)
    const p = localPoint()
    if (!p) return
    const store = useModelStore.getState()
    const sceneNow = store.scene
    if (!sceneNow) return
    switch (planTool) {
      case 'move': {
        const hit = roomAtPoint(p.x, p.z)
        if (!hit) {
          store.selectNode(null)
          return
        }
        store.selectNode(hit.node.id)
        setDrag({
          kind: 'move',
          roomId: hit.node.id,
          baseScene: sceneNow,
          startLocal: p,
          startCenter: roomCenter2D(hit.node),
          footprint: hit.node.footprint,
        })
        break
      }
      case 'vertex': {
        const selected = selectedId ? (findNodeById(sceneNow.root, selectedId) as RoomNode | null) : null
        if (selected && selected.type === 'room') {
          const idx = nearestFootprintVertex(selected.footprint, p.x, p.z)
          if (idx !== null) {
            setDrag({
              kind: 'vertex',
              roomId: selected.id,
              vertexIndex: idx,
              baseScene: sceneNow,
              startLocal: p,
            })
            break
          }
        }
        const hit = roomAtPoint(p.x, p.z)
        if (hit) store.selectNode(hit.node.id)
        else store.selectNode(null)
        break
      }
      case 'opening': {
        const hit = hitWallOnEdge(wallEdges, p.x, p.z)
        if (!hit) return
        const { edge, seg, along } = hit
        const local = along - edge.start
        if (seg.kind === 'wall') {
          const width = openingKind === 'door' ? DOOR_WIDTH : WINDOW_WIDTH
          const from = Math.min(Math.max(local - width / 2, 0), edge.length)
          const to = Math.min(Math.max(local + width / 2, 0), edge.length)
          if (to - from < 1e-6) return
          store.applyPlanOps([
            {
              op: 'setOpenings',
              roomId: edge.roomId,
              side: edge.dir,
              kind: openingKind,
              edgeIndex: edge.ringIndex,
              from,
              to,
            },
          ])
        } else if (seg.kind === 'door' || seg.kind === 'window') {
          // 点击已有门/窗 → 删除（P4 补齐 setOpenings 无删除的边界，notes §4）
          store.applyPlanOps([
            {
              op: 'setOpenings',
              roomId: edge.roomId,
              side: edge.dir,
              kind: seg.kind,
              edgeIndex: edge.ringIndex,
              from: seg.from,
              to: seg.to,
              remove: true,
            },
          ])
        }
        break
      }
      case 'split': {
        const hit = roomAtPoint(p.x, p.z)
        if (!hit || hit.node.type !== 'room') return
        setSplit({ roomId: hit.node.id, start: { x: snapToGrid(p.x), z: snapToGrid(p.z) } })
        setSplitCur({ x: snapToGrid(p.x), z: snapToGrid(p.z) })
        break
      }
      case 'merge': {
        const hit = roomAtPoint(p.x, p.z)
        if (!hit) return
        if (mergeKeepId === null) {
          setMergeKeepId(hit.node.id)
        } else {
          const tryMerge = (keep: string, remove: string): boolean => {
            const result = executeOps(sceneNow, [{ op: 'mergeRoom', keep, remove } as Op])
            if (result.applied === 0) return false
            store.applyPlanOps([{ op: 'mergeRoom', keep, remove } as Op])
            return true
          }
          const ok =
            tryMerge(mergeKeepId, hit.node.id) || tryMerge(hit.node.id, mergeKeepId)
          if (!ok) window.alert(t('plan.mergeFail'))
          setMergeKeepId(null)
        }
        break
      }
      default:
        break
    }
  }

  const onPlaneMove = (): void => {
    const p = localPoint()
    if (!p) return
    if (drag) previewDrag(p)
    else if (split) setSplitCur(p)
  }

  const onPlaneUp = (): void => {
    if (drag) {
      const d = drag
      setDrag(null)
      useModelStore.getState().commitPlanEdit(d.baseScene, d.roomId)
      return
    }
    if (split && splitCur) {
      const roomId = split.roomId
      const a = split.start
      const b = { x: snapToGrid(splitCur.x), z: snapToGrid(splitCur.z) }
      const axis: 'x' | 'z' = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z) ? 'x' : 'z'
      const position = axis === 'x' ? b.x : b.z
      const before = useModelStore.getState().scene
      if (before) {
        const result = executeOps(before, [{ op: 'splitRoom', id: roomId, axis, position } as Op])
        if (result.applied === 0) window.alert(t('plan.splitFail'))
        else useModelStore.getState().applyPlanOps([{ op: 'splitRoom', id: roomId, axis, position } as Op])
      }
      setSplit(null)
      setSplitCur(null)
    }
  }

  const onPlaneLeave = (): void => {
    // 指针移出画布：结束拖拽但保留拆线预览
    if (drag) {
      const d = drag
      setDrag(null)
      useModelStore.getState().commitPlanEdit(d.baseScene, d.roomId)
    }
  }

  const onVertexDown = (e: ThreeEvent<PointerEvent>, roomId: string, index: number): void => {
    e.stopPropagation()
    capturePointer(e)
    const store = useModelStore.getState()
    const sceneNow = store.scene
    if (!sceneNow) return
    store.selectNode(roomId)
    setDrag({ kind: 'vertex', roomId, vertexIndex: index, baseScene: sceneNow, startLocal: { x: 0, z: 0 } })
  }

  /** 手柄拖拽的移动/结束：指针悬停手柄时事件路由到手柄对象（R3F 捕获语义） */
  const onVertexMove = (_e: ThreeEvent<PointerEvent>, roomId: string, index: number): void => {
    if (drag?.kind !== 'vertex' || drag.roomId !== roomId || drag.vertexIndex !== index) return
    const p = localPoint()
    if (!p) return
    previewDrag(p)
  }

  const onVertexUp = (_e: ThreeEvent<PointerEvent>, roomId: string): void => {
    if (drag?.kind !== 'vertex' || drag.roomId !== roomId) return
    const d = drag
    setDrag(null)
    useModelStore.getState().commitPlanEdit(d.baseScene, d.roomId)
  }

  const selectedRoom =
    selectedId && scene ? ((findNodeById(scene.root, selectedId) as RoomNode | null) ?? null) : null

  return (
    <>
      {/* 交互底板：透明大平面，承载所有工具的指针事件（在镜像 group 内） */}
      <mesh position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={onPlaneDown} onPointerMove={onPlaneMove} onPointerUp={onPlaneUp} onPointerLeave={onPlaneLeave}>
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* 门窗工具：已有门/窗标记（点击可删除，纯视觉不挡射线） */}
      {planTool === 'opening' &&
        wallEdges.map((edge) =>
          edge.segments
            .filter((s) => s.kind === 'door' || s.kind === 'window')
            .map((seg) => {
              const along = edge.start + (seg.from + seg.to) / 2
              const len = seg.to - seg.from
              const pos: [number, number, number] =
                edge.axis === 'x' ? [along, 0.6, edge.line] : [edge.line, 0.6, along]
              return (
                <mesh key={`${edge.roomId}-${edge.ringIndex}-${seg.from}`} position={pos} raycast={() => null}>
                  <boxGeometry args={edge.axis === 'x' ? [len, 0.12, 0.3] : [0.3, 0.12, len]} />
                  <meshBasicMaterial
                    color={seg.kind === 'door' ? '#ff9f43' : '#5bc0de'}
                    transparent
                    opacity={0.9}
                  />
                </mesh>
              )
            }),
        )}

      {/* 顶点工具：选中房间的角点手柄（拖拽改足迹形状） */}
      {planTool === 'vertex' &&
        selectedRoom &&
        selectedRoom.footprint.map((p, i) => (
          <mesh
            key={i}
            position={[p.x, 1.0, p.z]}
            onPointerDown={(e) => onVertexDown(e, selectedRoom.id, i)}
            onPointerMove={(e) => onVertexMove(e, selectedRoom.id, i)}
            onPointerUp={(e) => onVertexUp(e, selectedRoom.id)}
          >
            <sphereGeometry args={[0.16, 12, 12]} />
            <meshBasicMaterial color="#ffd93d" />
          </mesh>
        ))}

      {/* 拆房工具：预览切线（两点连线） */}
      {planTool === 'split' && split && splitCur && (
        <Line
          points={[
            [split.start.x, 0.8, split.start.z],
            [splitCur.x, 0.8, splitCur.z],
          ]}
          color="#ffd93d"
          lineWidth={3}
          raycast={() => null}
        />
      )}
      {/* 合并工具：第一个选中（保留）的房间高亮 */}
      {planTool === 'merge' &&
        mergeKeepId &&
        (() => {
          const keep = rooms.find((r) => r.node.id === mergeKeepId)
          if (!keep) return null
          const pts = keep.node.footprint
          return (
            <Line
              points={[...pts.map((p) => [p.x, 0.9, p.z] as [number, number, number]), [pts[0].x, 0.9, pts[0].z]]}
              color="#4ade80"
              lineWidth={3}
              raycast={() => null}
            />
          )
        })()}
    </>
  )
}
