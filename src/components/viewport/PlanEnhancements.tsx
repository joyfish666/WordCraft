import { Html, Line } from '@react-three/drei'
import { useMemo } from 'react'
import { BACK_AXIS, facingFromRoom, furnitureKind } from '../../lib/furniturePresets'
import { roomCenter, roomDims } from '../../lib/footprint'
import { ENTRANCE_DOOR_COLOR, FURNITURE_PART_INK } from '../../lib/palette'
import { computeAllWallPlans, type WallPlan } from '../../lib/roomGeometry'
import {
  doorArcPoints,
  doorLeafLine,
  roomDimLines,
  walkRooms,
  windowHatchLines,
  type DimLine,
} from '../../lib/planGeometry'
import { useModelStore } from '../../store/useModelStore'
import type { FurnitureNode, RoomNode, SceneModel } from '../../types/model'
import type { FacingDir } from '../../lib/furniturePresets'

/** 家具足迹层高度（略高于地板顶面 0.12，避免 z-fighting） */
const FP_Y = 0.14
/** 门窗符号层高度（高于足迹层，避免被足迹填充遮挡） */
const SYMBOL_Y = 0.25
/** 房间尺寸线高度（最高层，标签/刻度不与被标物重叠） */
const DIM_Y = 0.35

const DOOR_SYMBOL_COLOR = '#8a93a5'
const WINDOW_SYMBOL_COLOR = '#5bc0de'
const FOOTPRINT_FILL = '#e6e9f0'
const FOOTPRINT_LINE = '#7d8798'
const SELECTED_LINE = '#ffd93d'

/** 家具名称 → 足迹内部的朝向标记线（床画床头板、其余画背侧贴墙线） */
function orientationMarker(
  furniture: FurnitureNode,
  facing: FacingDir,
): { position: [number, number, number]; size: [number, number, number] } | null {
  const L = furniture.dimensions.length
  const W = furniture.dimensions.width
  const { x, z } = furniture.position
  const kind = furnitureKind(furniture.name)
  // 床：床头板在长轴端（跨短边，同 buildBedParts 语义）；其余：背侧贴墙线
  if (kind === 'bed') {
    const longIsX = L >= W
    if (longIsX) {
      const sx = facing === 'east' ? 1 : -1
      return { position: [x + sx * (L / 2 - 0.06), FP_Y, z], size: [0.06, 0.02, W * 0.9] }
    }
    const sz = facing === 'north' ? 1 : -1
    return { position: [x, FP_Y, z + sz * (W / 2 - 0.06)], size: [L * 0.9, 0.02, 0.06] }
  }
  const backInset = 0.05
  switch (facing) {
    case 'north':
      return { position: [x, FP_Y, z + W / 2 - backInset], size: [L - 0.1, 0.02, 0.06] }
    case 'south':
      return { position: [x, FP_Y, z - W / 2 + backInset], size: [L - 0.1, 0.02, 0.06] }
    case 'east':
      return { position: [x + L / 2 - backInset, FP_Y, z], size: [0.06, 0.02, W - 0.1] }
    case 'west':
      return { position: [x - L / 2 + backInset, FP_Y, z], size: [0.06, 0.02, W - 0.1] }
  }
}

/** 家具足迹：半透明填充 + 轮廓线 + 朝向标记，点击选中（平面图模式下 3D 家具网格不渲染） */
function FurnitureFootprint({
  furniture,
  room,
  selected,
}: {
  furniture: FurnitureNode
  room: RoomNode
  selected: boolean
}) {
  const selectNode = useModelStore((s) => s.selectNode)
  const { x, z } = furniture.position
  const L = furniture.dimensions.length
  const W = furniture.dimensions.width
  const facing = facingFromRoom(
    furniture,
    { position: roomCenter(room), dimensions: roomDims(room) },
    BACK_AXIS[furnitureKind(furniture.name)],
  )
  const marker = orientationMarker(furniture, facing)
  const outline: [number, number, number][] = [
    [x - L / 2, FP_Y, z - W / 2],
    [x + L / 2, FP_Y, z - W / 2],
    [x + L / 2, FP_Y, z + W / 2],
    [x - L / 2, FP_Y, z + W / 2],
    [x - L / 2, FP_Y, z - W / 2],
  ]
  const color = selected ? SELECTED_LINE : FOOTPRINT_LINE
  return (
    <group>
      <mesh
        position={[x, FP_Y, z]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => {
          e.stopPropagation()
          selectNode(furniture.id)
        }}
      >
        <planeGeometry args={[L, W]} />
        <meshBasicMaterial color={FOOTPRINT_FILL} transparent opacity={0.45} depthWrite={false} />
      </mesh>
      <Line points={outline} color={color} lineWidth={selected ? 2.5 : 1.5} />
      {marker && (
        <mesh position={marker.position} raycast={() => null}>
          <boxGeometry args={marker.size} />
          <meshBasicMaterial color={FURNITURE_PART_INK} />
        </mesh>
      )}
    </group>
  )
}

/** 房间尺寸线：线 + 端部刻度 + 文案（与整屋尺寸线同风格） */
function RoomDimLine({ line, horizontal }: { line: DimLine; horizontal: boolean }) {
  const dx = line.to[0] - line.from[0]
  const dz = line.to[2] - line.from[2]
  const len = Math.hypot(dx, dz)
  const mid: [number, number, number] = [
    (line.from[0] + line.to[0]) / 2,
    line.from[1],
    (line.from[2] + line.to[2]) / 2,
  ]
  return (
    <group>
      <mesh position={mid}>
        <boxGeometry args={horizontal ? [len, 0.02, 0.02] : [0.02, 0.02, len]} />
        <meshBasicMaterial color={SELECTED_LINE} />
      </mesh>
      <mesh position={line.from}>
        <boxGeometry args={horizontal ? [0.02, 0.02, 0.14] : [0.14, 0.02, 0.02]} />
        <meshBasicMaterial color={SELECTED_LINE} />
      </mesh>
      <mesh position={line.to}>
        <boxGeometry args={horizontal ? [0.02, 0.02, 0.14] : [0.14, 0.02, 0.02]} />
        <meshBasicMaterial color={SELECTED_LINE} />
      </mesh>
      <Html position={mid} center pointerEvents="none" zIndexRange={[9, 0]}>
        <div className="plan-dim">{line.label}</div>
      </Html>
    </group>
  )
}

/**
 * 2D 平面图增强层（仅 planMode 渲染，位于镜像 group 内；README 路线图「2D 平面图增强」，非 design.md P5）：
 * - 家具足迹：房间家具以俯视矩形呈现（填充 + 轮廓 + 朝向标记），点击可选中；
 * - 门窗符号：门扇线 + 开启弧线（入户门暖橙）、窗洞双线（浅蓝），与墙体方案同源；
 * - 房间尺寸线：顶层房间内部标注 长/宽（选择工具时显示，编辑时不干扰；工具栏「尺寸」开关可关闭）。
 * 3D 家具网格在平面图模式下由 ModelNodeView 跳过渲染（planMode 透传）。
 */
export function PlanEnhancements() {
  const scene = useModelStore((s) => s.scene)
  const selectedId = useModelStore((s) => s.selectedId)
  const planTool = useModelStore((s) => s.planTool)
  const showPlanDims = useModelStore((s) => s.showPlanDims)
  const screenshotMode = useModelStore((s) => s.screenshotMode)

  const rooms = useMemo(() => (scene ? walkRooms(scene.root) : []), [scene])
  const wallPlans = useMemo(() => {
    if (!scene) return new Map<string, WallPlan>()
    const house = scene.root as SceneModel['root']
    return computeAllWallPlans(house.levels[0]?.rooms ?? [], {
      entrance: house.entranceDir ?? 'south',
      entranceRoomId: house.entranceRoomId,
    })
  }, [scene])

  if (!scene || screenshotMode) return null

  return (
    <>
      {/* 家具足迹 */}
      {rooms.map(({ node }) =>
        node.furniture.map((f) => (
          <FurnitureFootprint
            key={f.id}
            furniture={f}
            room={node}
            selected={f.id === selectedId}
          />
        )),
      )}

      {/* 门窗符号（与 3D 墙体方案同源：门扇 + 弧线、窗洞双线） */}
      {Array.from(wallPlans.entries()).flatMap(([roomId, plan]) =>
        plan.edges.flatMap((edge) =>
          edge.segments.flatMap((seg) => {
            const key = `${roomId}-${edge.line}-${seg.from}`
            if (seg.kind === 'door') {
              const leaf = doorLeafLine(edge, seg, SYMBOL_Y)
              const arc = doorArcPoints(edge, seg, SYMBOL_Y)
              const color = seg.entrance ? ENTRANCE_DOOR_COLOR : DOOR_SYMBOL_COLOR
              return [
                <Line key={`${key}-leaf`} points={leaf} color={color} lineWidth={2} />,
                <Line key={`${key}-arc`} points={arc} color={color} lineWidth={1.5} />,
              ]
            }
            if (seg.kind === 'window') {
              return windowHatchLines(edge, seg, SYMBOL_Y).map((pts, i) => (
                <Line key={`${key}-w${i}`} points={pts} color={WINDOW_SYMBOL_COLOR} lineWidth={1.5} />
              ))
            }
            return []
          }),
        ),
      )}

      {/* 房间内部尺寸线（仅顶层房间、选择工具且未关闭尺寸显示时渲染，编辑工具下让位） */}
      {showPlanDims &&
        planTool === 'select' &&
        rooms
          .filter((r) => r.depth === 1)
          .flatMap(({ node }) => {
            // roomDimLines 恒返回「长度（水平）→ 宽度（竖直）」顺序，直接按序号判方向
            return roomDimLines(node, { y: DIM_Y }).map((line, i) => (
              <RoomDimLine key={`${node.id}-dim-${i}`} line={line} horizontal={i === 0} />
            ))
          })}
    </>
  )
}
