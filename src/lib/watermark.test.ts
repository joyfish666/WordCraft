import { afterEach, describe, expect, it, vi } from 'vitest'
import { withWatermark } from './watermark'

/** 最小 canvas 2D 上下文 mock（记录调用，不实际绘图） */
function fakeCanvas2D() {
  const calls: string[] = []
  const ctx = {
    drawImage: vi.fn(() => calls.push('drawImage')),
    fillText: vi.fn(() => calls.push('fillText')),
    set font(v: string) {
      calls.push(`font:${v}`)
    },
    set textAlign(v: string) {
      calls.push(`textAlign:${v}`)
    },
    set textBaseline(v: string) {
      calls.push(`textBaseline:${v}`)
    },
    set fillStyle(v: string) {
      calls.push(`fillStyle:${v}`)
    },
    toDataURL: vi.fn(() => 'data:image/png;base64,watermarked'),
  }
  return { ctx, calls }
}

function mockImageLoad() {
  class FakeImage {
    naturalWidth = 640
    naturalHeight = 480
    width = 640
    height = 480
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_: string) {
      this.onload?.()
    }
    get src(): string {
      return ''
    }
  }
  vi.stubGlobal('Image', FakeImage)
  return () => vi.unstubAllGlobals()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('withWatermark（截图水印）', () => {
  it('canvas 可用时绘制口令水印并返回新 dataURL', async () => {
    const { ctx, calls } = fakeCanvas2D()
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string): HTMLElement => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ctx,
          toDataURL: ctx.toDataURL,
        } as unknown as HTMLCanvasElement
      }
      return origCreate(tag)
    })
    const unstub = mockImageLoad()
    try {
      const result = await withWatermark('data:image/png;base64,orig', 'WC-123')
      expect(result).toBe('data:image/png;base64,watermarked')
      expect(calls).toContain('drawImage')
      expect(calls).toContain('fillText')
      expect(calls.some((c) => c.startsWith('font:'))).toBe(true)
    } finally {
      unstub()
    }
  })

  it('canvas 2D 不可用（jsdom 无实现）时降级返回原图', async () => {
    const unstub = mockImageLoad()
    try {
      const origCreate = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tag: string): HTMLElement => {
        if (tag === 'canvas') {
          return { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement
        }
        return origCreate(tag)
      })
      const result = await withWatermark('data:image/png;base64,orig', 'WC-123')
      expect(result).toBe('data:image/png;base64,orig')
    } finally {
      unstub()
    }
  })

  it('图片加载失败时降级返回原图', async () => {
    class FailImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_: string) {
        this.onerror?.()
      }
      get src(): string {
        return ''
      }
    }
    vi.stubGlobal('Image', FailImage)
    const result = await withWatermark('data:image/png;base64,orig', 'WC-123')
    expect(result).toBe('data:image/png;base64,orig')
  })
})
