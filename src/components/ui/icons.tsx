import type { SVGProps } from 'react'

function Svg(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props} />
}

/** 加载示例模型（下载语义） */
export function IconSample(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z" />
    </Svg>
  )
}

/** 清空场景（垃圾桶） */
export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6 19c0 1.1.9 2 2 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </Svg>
  )
}

export function IconUndo(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62A7.94 7.94 0 0112.5 10c3.53 0 6.43 2.61 7.03 6h2.02c-.62-4.46-4.36-8-8.55-8z" />
    </Svg>
  )
}

export function IconRedo(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M11.5 8c2.65 0 5.05.99 6.9 2.6L22 7v9h-9l3.62-3.62A7.94 7.94 0 0011.5 10c-3.53 0-6.43 2.61-7.03 6H2.45c.62-4.46 4.36-8 8.55-8z" />
    </Svg>
  )
}

export function IconChat(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
    </Svg>
  )
}

export function IconShare(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0018 8a3 3 0 10-3-3c0 .24.04.47.09.7L8.04 9.81A2.99 2.99 0 006 9a3 3 0 000 6c1.19 0 2.24-.66 2.79-1.64l7.12 4.16c-.05.21-.08.43-.08.65a2.92 2.92 0 002.92 2.92 2.92 2.92 0 002.92-2.92 2.92 2.92 0 00-2.92-2.92z" />
    </Svg>
  )
}

export function IconCamera(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.65 0-3 1.35-3 3s1.35 3 3 3 3-1.35 3-3-1.35-3-3-3z" />
    </Svg>
  )
}

export function IconHelp(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
    </Svg>
  )
}

export function IconSave(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M17 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z" />
    </Svg>
  )
}

export function IconFolder(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z" />
    </Svg>
  )
}

export function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3L4 9v12h5v-7h6v7h5V9l-8-6z" />
    </Svg>
  )
}

export function IconGear(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.04 7.04 0 00-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84a.48.48 0 00-.48.41l-.36 2.54c-.59.22-1.13.53-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87a.48.48 0 00.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.36 1.03.67 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.27 1.12-.58 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.49-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.6 3.6 0 0112 15.6z" />
    </Svg>
  )
}

/** 抽屉展开/收起箭头（向上 = 收起到抽屉，展开时旋转 180°） */
export function IconChevronUp(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
    </Svg>
  )
}
