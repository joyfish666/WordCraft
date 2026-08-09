import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { forwardRef, type RefObject } from 'react'
import { Vector3 } from 'three'
import { useT } from '../../i18n'
import { houseBounds } from '../../lib/planGeometry'
import { useModelStore } from '../../store/useModelStore'

// 复用的临时对象，避免每帧分配
const rightVec = new Vector3()
const upVec = new Vector3()
const dirVec = new Vector3()

/** 世界方向（东=+x、北=+z）与投影角度用的单位向量 */
const DIR_VECTORS: Record<string, [number, number, number]> = {
  n: [0, 0, 1],
  e: [1, 0, 0],
  s: [0, 0, -1],
  w: [-1, 0, 0],
}

/**
 * 右上角罗盘传感器：每帧把 N/E/S/W 各自世界方向投影到屏幕方位角，逐个写入对应标签
 * 的 CSS 变换（标签沿罗盘圆周独立定位，不再用刚性玫瑰——刚性玫瑰在斜视角下 E/W 会
 * 与内容错位，坑 26）。渲染内容整体沿 X 镜像（左手系补偿成标准地图方向），
 * 世界方向同步镜像（x 取反）后投影，标签与镜像后的内容方位一致。
 */
export function CornerCompassSensor({
  compassRef,
}: {
  compassRef: RefObject<HTMLDivElement | null>
}) {
  const camera = useThree((s) => s.camera)

  useFrame(() => {
    const el = compassRef.current
    if (!el) return
    rightVec.setFromMatrixColumn(camera.matrix, 0)
    upVec.setFromMatrixColumn(camera.matrix, 1)
    const labels = el.querySelectorAll<HTMLElement>('[data-dir]')
    for (const label of labels) {
      const d = DIR_VECTORS[label.dataset.dir ?? '']
      if (!d) continue
      dirVec.set(d[0], d[1], d[2])
      dirVec.x = -dirVec.x // 内容沿 X 镜像（坑 26）：世界方向同步镜像后投影
      const rx = dirVec.dot(rightVec)
      const ry = dirVec.dot(upVec)
      const angle = (Math.atan2(rx, ry) * 180) / Math.PI
      label.style.transform = `translate(-50%, -50%) rotate(${angle}deg) translateY(-44px) rotate(${-angle}deg)`
    }
  })

  return null
}

/** 右上角罗盘玫瑰（DOM 覆盖层）：四个标签初始居中，由传感器每帧定位到对应方位 */
export const CornerCompassRose = forwardRef<HTMLDivElement, object>(function CornerCompassRose(
  _props,
  ref,
) {
  const t = useT()
  return (
    <div className="corner-compass" ref={ref} aria-hidden="true">
      <span className="corner-compass__label corner-compass__label--n" data-dir="n">
        {t('compass.north')}
      </span>
      <span className="corner-compass__label corner-compass__label--e" data-dir="e">
        {t('compass.east')}
      </span>
      <span className="corner-compass__label corner-compass__label--s" data-dir="s">
        {t('compass.south')}
      </span>
      <span className="corner-compass__label corner-compass__label--w" data-dir="w">
        {t('compass.west')}
      </span>
      <span className="corner-compass__cross" />
    </div>
  )
})

/**
 * 世界锚定罗盘：N/E/S/W 标签钉在整屋包围盒外沿的四个世界方位（东=世界 +x、北=世界 +z）。
 * 任意视角（3D 任意朝向 / 2D 平面图，含平面图的镜像投影）下都指向真实东西南北，
 * 与入户门/房间几何一致。标签为 drei Html（DOM 覆盖层）：不进入 WebGL 截图缓冲，截图瞬间亦隐藏。
 */
export function WorldCompass() {
  const scene = useModelStore((s) => s.scene)
  const screenshotMode = useModelStore((s) => s.screenshotMode)
  const t = useT()

  if (screenshotMode) return null

  const bounds = scene ? houseBounds(scene) : null
  const cx = bounds ? (bounds.minX + bounds.maxX) / 2 : 0
  const cz = bounds ? (bounds.minZ + bounds.maxZ) / 2 : 0
  const halfW = bounds ? (bounds.maxX - bounds.minX) / 2 : 2
  const halfD = bounds ? (bounds.maxZ - bounds.minZ) / 2 : 1.5
  // 距包围盒外沿的间距：需让开整屋尺寸线的标签（线外移 0.6 + 标签再外移 0.5，
  // 标签自身含内边距约 0.6~1.9m 世界宽度，随缩放变化）——2.8m 保证各缩放档都不遮挡
  // 按各方向自己的半宽/半深定位（旧实现用 max 半宽，宽度 > 深度时东/西标签比南/北
  // 更贴近房屋，东字会盖住东侧「总宽」尺寸标签——坑：方向不对称）
  const margin = 2.8
  const y = (scene?.root.levels[0]?.height ?? 2.8) + 0.3

  const labels: Array<{ key: string; x: number; z: number; text: string }> = [
    { key: 'n', x: cx, z: cz + halfD + margin, text: t('compass.north') },
    { key: 'e', x: cx + halfW + margin, z: cz, text: t('compass.east') },
    { key: 's', x: cx, z: cz - halfD - margin, text: t('compass.south') },
    { key: 'w', x: cx - halfW - margin, z: cz, text: t('compass.west') },
  ]

  return (
    <>
      {labels.map((l) => (
        <Html
          key={l.key}
          position={[l.x, y, l.z]}
          center
          pointerEvents="none"
          zIndexRange={[19, 0]}
        >
          <span className={`world-compass__label world-compass__label--${l.key}`}>{l.text}</span>
        </Html>
      ))}
    </>
  )
}
