import { afterAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  boxWallGeometry,
  exteriorWallMaterial,
  furnitureMaterial,
  getTexture,
  getWorldUvTexture,
  planeGeometryWithUvs,
  roomFloorKind,
  roomFloorMaterial,
  skirtingMaterial,
  TEXTURE_TILE_METERS,
} from './materials'
import { GROUND_COLOR } from './palette'

// ---------------------------------------------------------------------------
// 草地「春天感」回归防线（坑 117 二轮，2026-08-14）：mock canvas 渲染草地纹理，
// 乘 GROUND_COLOR tint 后断言——嫩绿（饱和度/绿感）与花色点缀。
// 注意：必须放在最前（getTexture 是缓存单例，先于其他测试执行才能拿到真实绘制结果）。
// ---------------------------------------------------------------------------
describe('grassGround 草地纹理（春天感回归防线，坑 117）', () => {
  const SIZE = 256
  const px = new Uint8Array(SIZE * SIZE * 4)
  const origCreate = document.createElement.bind(document)

  function makeMockCtx() {
    let alpha = 1
    let fill: [number, number, number] = [0, 0, 0]
    const ctx: Record<string, unknown> = {
      get globalAlpha() {
        return alpha
      },
      set globalAlpha(v: number) {
        alpha = v
      },
      set fillStyle(v: string) {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v)
        if (m) fill = [Number(m[1]), Number(m[2]), Number(m[3])]
        else if (v.startsWith('#'))
          fill = [
            parseInt(v.slice(1, 3), 16),
            parseInt(v.slice(3, 5), 16),
            parseInt(v.slice(5, 7), 16),
          ]
      },
      fillRect(x: number, y: number, w: number, h: number) {
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const ix = Math.floor(x) + dx
            const iy = Math.floor(y) + dy
            if (ix < 0 || iy < 0 || ix >= SIZE || iy >= SIZE) continue
            const i = (iy * SIZE + ix) * 4
            px[i] = Math.round(px[i]! * (1 - alpha) + fill[0]! * alpha)
            px[i + 1] = Math.round(px[i + 1]! * (1 - alpha) + fill[1]! * alpha)
            px[i + 2] = Math.round(px[i + 2]! * (1 - alpha) + fill[2]! * alpha)
            px[i + 3] = 255
          }
        }
      },
    }
    return ctx
  }

  it('tint 乘算后为鲜嫩绿（高饱和度、G 主导）且带花色点缀——不是灰绿/枯黄', () => {
    document.createElement = ((tag: string, ...args: unknown[]) => {
      if (tag === 'canvas') {
        return {
          width: SIZE,
          height: SIZE,
          getContext: () => makeMockCtx(),
        } as unknown as HTMLCanvasElement
      }
      return origCreate(tag as 'div', ...(args as []))
    }) as typeof document.createElement

    getTexture('grassGround')
    const tint = [
      parseInt(GROUND_COLOR.slice(1, 3), 16) / 255,
      parseInt(GROUND_COLOR.slice(3, 5), 16) / 255,
      parseInt(GROUND_COLOR.slice(5, 7), 16) / 255,
    ]
    let sumR = 0
    let sumG = 0
    let sumB = 0
    let flowers = 0
    for (let i = 0; i < SIZE * SIZE; i++) {
      const r = Math.round(px[i * 4]! * tint[0]!)
      const g = Math.round(px[i * 4 + 1]! * tint[1]!)
      const b = Math.round(px[i * 4 + 2]! * tint[2]!)
      sumR += r
      sumG += g
      sumB += b
      // 淡黄小花（tint 后亮黄绿点）：G 高、R 明显高于 B（黄感）
      if (r > 130 && g > 170 && r - b > 60) flowers++
    }
    const n = SIZE * SIZE
    const avgR = sumR / n
    const avgG = sumG / n
    const avgB = sumB / n
    const max = Math.max(avgR, avgG, avgB)
    const min = Math.min(avgR, avgG, avgB)
    const sat = max === 0 ? 0 : (max - min) / max
    // 春天嫩绿：饱和度明显高于旧灰绿 tint（#a8b795 的 S≈0.19）、G 通道主导
    expect(sat).toBeGreaterThan(0.35)
    expect(avgG).toBeGreaterThan(avgR + 15)
    expect(avgG).toBeGreaterThan(avgB + 40)
    // 花色点缀存在但稀疏（不喧宾夺主）
    expect(flowers).toBeGreaterThan(100)
    expect(flowers / n).toBeLessThan(0.02)
  })

  afterAll(() => {
    // 恢复原 createElement（后续测试的 getTexture 走 jsdom 原生路径）
    document.createElement = origCreate
  })
})

describe('materials（程序化材质层）', () => {
  describe('roomFloorKind 房间类型 → 地板类别', () => {
    it('卫生间/厨房 → 瓷砖，走廊 → 木地板（融入暖色房间群），阳台 → 防腐木，其余 → 木地板', () => {
      expect(roomFloorKind('主卧卫生间')).toBe('tile')
      expect(roomFloorKind('卫生间')).toBe('tile')
      expect(roomFloorKind('厨房')).toBe('tile')
      expect(roomFloorKind('走廊')).toBe('wood')
      expect(roomFloorKind('阳台')).toBe('deck')
      expect(roomFloorKind('卧室')).toBe('wood')
      expect(roomFloorKind('客厅')).toBe('wood')
      // 未识别（英文名/自造词）回退木地板
      expect(roomFloorKind('Living Room')).toBe('wood')
    })
  })

  describe('roomFloorMaterial', () => {
    it('tint 为房间识别色淡化（非纯色）', () => {
      const m = roomFloorMaterial('卧室', 'standard', 0)
      expect(m.kind).toBe('wood')
      expect(m.map).toBe('woodFloor')
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(m.color).not.toBe('#ffffff')
      expect(m.roughness).toBeGreaterThan(0)
    })

    it('地板为世界米 UV（顶面 UV 即世界坐标，用带 repeat 的克隆纹理）', () => {
      expect(roomFloorMaterial('客厅', 'standard', 0).uvMode).toBe('world')
    })

    it('色盲模式 tint 与标准模式不同（明度/图案区分，不依赖色相）', () => {
      const standard = roomFloorMaterial('卧室', 'standard', 0)
      const colorblind = roomFloorMaterial('卧室', 'colorblind', 0)
      expect(colorblind.color).not.toBe(standard.color)
    })

    it('同一房间两种模式贴图一致（纹理种类不随模式变）', () => {
      expect(roomFloorMaterial('厨房', 'standard', 1).map).toBe(
        roomFloorMaterial('厨房', 'colorblind', 1).map,
      )
    })
  })

  describe('furnitureMaterial', () => {
    it('床：床架木纹、床垫织物', () => {
      expect(furnitureMaterial('bed', 'base', 'standard').map).toBe('woodGrain')
      expect(furnitureMaterial('bed', 'secondary', 'standard').map).toBe('fabric')
    })

    it('马桶 → 陶瓷（无贴图、低粗糙度）', () => {
      const m = furnitureMaterial('toilet', 'base', 'standard')
      expect(m.map).toBeUndefined()
      expect(m.roughness).toBeLessThan(0.5)
    })

    it('电视柜 → 电视屏为深色玻璃', () => {
      const m = furnitureMaterial('tvCabinet', 'dark', 'standard')
      expect(m.map).toBeUndefined()
      expect(m.metalness).toBeGreaterThan(0)
    })

    it('色盲模式统一中性灰、保留明度差异', () => {
      const base = furnitureMaterial('bed', 'base', 'colorblind')
      const dark = furnitureMaterial('bed', 'dark', 'colorblind')
      expect(base.color).toBe('#f0f0f0')
      expect(dark.color).toBe('#707070')
    })
  })

  describe('墙体材质', () => {
    it('内墙纯色抹灰、外墙抹灰纹理', () => {
      expect(exteriorWallMaterial().map).toBe('plasterWall')
    })

    it('踢脚线为房间色加深', () => {
      const m = skirtingMaterial('#4f7cff')
      expect(m.color).toBe('#2b448c')
    })
  })

  describe('getTexture 缓存与平铺', () => {
    it('同类贴图全局单例', () => {
      expect(getTexture('woodFloor')).toBe(getTexture('woodFloor'))
      expect(getTexture('woodFloor')).not.toBe(getTexture('fabric'))
    })

    it('base 纹理 repeat = 1（归一化 UV 几何自行按米拉伸，不叠加 repeat 避免 tile² 双重缩放）', () => {
      for (const kind of Object.keys(TEXTURE_TILE_METERS) as (keyof typeof TEXTURE_TILE_METERS)[]) {
        const tex = getTexture(kind)
        expect(tex.wrapS).toBe(THREE.RepeatWrapping)
        expect(tex.repeat.x).toBe(1)
      }
    })

    it('getWorldUvTexture：base 克隆、共享图像、repeat 按世界米倒置（地板顶面 UV 为世界坐标）', () => {
      for (const kind of Object.keys(TEXTURE_TILE_METERS) as (keyof typeof TEXTURE_TILE_METERS)[]) {
        const base = getTexture(kind)
        const tex = getWorldUvTexture(kind)
        expect(tex).not.toBe(base)
        expect(tex.repeat.x).toBeCloseTo(1 / TEXTURE_TILE_METERS[kind], 5)
        expect(tex.source).toBe(base.source)
        expect(getWorldUvTexture(kind)).toBe(tex)
      }
    })
  })

  describe('UV 拉伸工具', () => {
    it('boxWallGeometry：±z 面 UV 按段长/墙高拉伸', () => {
      const g = boxWallGeometry(3, 2.6, 0.15, 1.2)
      const uv = g.attributes.uv as THREE.BufferAttribute
      // 面内最大 u（沿段长）与最大 v（沿墙高）应为 段长/tile 与 墙高/tile
      for (const face of [
        [16, 17, 18, 19],
        [20, 21, 22, 23],
      ]) {
        const maxX = Math.max(...face.map((i) => uv.getX(i)))
        const maxY = Math.max(...face.map((i) => uv.getY(i)))
        expect(maxX).toBeCloseTo(3 / 1.2, 5)
        expect(maxY).toBeCloseTo(2.6 / 1.2, 5)
      }
      // 其余四面（端面/顶底）不参与拉伸
      const other = [0, 4, 8, 12]
      expect(Math.max(...other.map((i) => uv.getX(i)))).toBeLessThanOrEqual(1.0001)
    })

    it('planeGeometryWithUvs 按世界尺寸拉伸', () => {
      const g = planeGeometryWithUvs(10, 8, 2)
      const uv = g.attributes.uv as THREE.BufferAttribute
      const maxX = Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getX(i)))
      const maxY = Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getY(i)))
      expect(maxX).toBeCloseTo(5, 5) // (10/2)
      expect(maxY).toBeCloseTo(4, 5) // (8/2)
    })
  })
})
