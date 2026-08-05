import { useFrame, useThree } from '@react-three/fiber'
import { forwardRef, type RefObject } from 'react'
import { Quaternion, Vector3 } from 'three'

// 复用的临时对象，避免每帧分配
const compassQuat = new Quaternion()
const compassVec = new Vector3()

/**
 * R3F 传感器：每帧读取相机方位角，旋转罗盘玫瑰使 N 指向世界北（+Z）。
 * 通过 compassRef 直接更新 DOM，不触发 React 重渲染。
 */
export function CompassSensor({ compassRef }: { compassRef: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera)

  useFrame(() => {
    const el = compassRef.current
    if (!el) return
    // 世界北（+Z）变换到相机局部空间，取其在屏幕平面（x=右, y=上）的方位角
    compassQuat.copy(camera.quaternion).invert()
    compassVec.set(0, 0, 1).applyQuaternion(compassQuat)
    const angle = (Math.atan2(compassVec.x, compassVec.y) * 180) / Math.PI
    el.style.transform = `rotate(${angle}deg)`
  })

  return null
}

/** HTML 罗盘玫瑰：N/S/E/W 标签，随相机实时旋转 */
export const CompassRose = forwardRef<HTMLDivElement, object>(function CompassRose(_props, ref) {
  return (
    <div className="compass" ref={ref} aria-hidden="true">
      <span className="compass__label compass__label--n">N</span>
      <span className="compass__label compass__label--e">E</span>
      <span className="compass__label compass__label--s">S</span>
      <span className="compass__label compass__label--w">W</span>
      <span className="compass__cross" />
    </div>
  )
})
